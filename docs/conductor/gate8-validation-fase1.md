# Gate 8 — Validation against the spec (Fase 1 — Fundação do produto)

**Demand:** rebuild the Conductor Coding Agent on top of the Pi agent runtime.
**Validator:** quality-assurance (Gate 8, independent verification — re-derived from repo state,
builder's self-report not trusted; same rigor as the Fase-0 validation, `docs/conductor/gate8-validation.md`,
used as calibration).
**Repo:** `C:\development\tools\pi`, branch `feature/fase1-fundacao-do-produto`.
**Commits inspected:** `85c12d4f1` (Gate 3/4 docs — threat-model addendum + ADR 0002), `aa6d423c1`
(Gate 5/6 round A — conductor-runtime/config/project), `9205d744b` (Gate 5/6 round B1 — conductor-cli
init/doctor/config + ResourceLoader), `95153c8dd` (Gate 5/6 round B2 — conductor chat, real TUI).
**Spec validated against:** `plano_desenvolvimento.md` §8, "Fase 1 — Fundação do produto"; reconciled
against `docs/adr/0002-fase1-cli-foundation.md` (Gate 4, binding architecture) and
`docs/conductor/gate3-fase1-addendum.md` (Gate 3, binding threats T11–T16).

---

## 1. Automated evidence (re-run independently, fresh — no number reused from any prior report)

| Check | Command | Result |
|---|---|---|
| `conductor-runtime` suite | `cd packages/conductor-runtime && npx vitest run` | **11 test files, 88 tests, all passed**, exit 0 (26.80s) |
| `conductor-config` suite | `cd packages/conductor-config && npx vitest run` | **6 test files, 90 tests, all passed**, exit 0 (0.39s) |
| `conductor-project` suite | `cd packages/conductor-project && npx vitest run` | **4 test files, 84 tests, all passed**, exit 0 (0.51s) |
| `conductor-cli` suite | `cd packages/conductor-cli && npx vitest run` | **11 test files, 113 tests, all passed**, exit 0 (40.25s) |
| **Total** | | **32 test files, 375 tests, all green** |
| Repo CI gate | `cd C:\development\tools\pi && npm run check` (biome, pinned-deps, ts-imports, shrinkwrap, install-lock, `tsgo --noEmit`, browser-smoke) | **exit 0**, no errors, no warnings (re-run twice, exit code captured explicitly both times). Chain uses `&&`, so `tsgo --noEmit` passing is entailed by `check:browser-smoke` having run. |
| Real CLI invocation | `node packages/conductor-cli/bin/conductor.js init/doctor/config show/config set/config get` in a **fresh scratch directory** (`C:\Users\elton\AppData\Local\Temp\gate8-fase1-scratch\my-project`, a synthetic Node/Express project, never seen by any test fixture) | See §2 and §6 below — real stdout/exit-code captured for every command, including two genuine defects found live (§6). |

Grounding (mandatory): `cdt library "acceptance criteria validation living documentation definition of
done verification test-driven specification" --gate 8` from the Conductor repo returned 5 passages, top
match **0.639**, same sources as the Fase-0 validation: **Spec-Driven Development — The Complete Book**
and **Specification by Example — Complete Professional Guide**. Same citation reused deliberately (a
fresh query returned the identical top result, confirming it, not just recycling it): "A specification
becomes living documentation only if two things hold: it is validated frequently against the real
system, and it is continuously refined" (Specification by Example — Complete Professional Guide, §3.1) —
the standard applied throughout this document: every criterion below is checked against a re-run,
passing, effect-asserting test or a live command I ran myself, never against the builder's narrative.

---

## 2. Exit criterion (`plano_desenvolvimento.md` §8, "O agente deve funcionar... com") — bullet by bullet

| # | Criterion | Evidence (file:line) | Verdict | Notes |
|---|---|---|---|---|
| 1 | detecção de stack | `packages/conductor-project/src/detect.ts`/`enroll.ts`, exercised via `conductor init` → `enrollProject(cwd)` (`packages/conductor-cli/src/commands/init.ts:58-66`). 41 fixture tests in `test/detect.test.ts` (Angular, React, Vue, Svelte, Next.js, Vite, NestJS, Fastify, Express incl. Angular-SSR exclusion, Java/Maven, Java/Gradle, Go, Ruby, PHP, Rust, Python×3, .NET, Flutter, Android+iOS, Xcode, monorepo/fullstack, `MAX_DEPTH` boundary, `node_modules` exclusion, malformed/BOM JSON, dedup). **Live-verified**: `conductor init` on a scratch Node/Express project produced `detected type: backend; technologies: Node.js`, matching the real `package.json`. | **Met — strongly** | Real effect (a file on disk reflecting the actual detected stack), not "did not throw". Also live-verified the **idempotent-merge** behavior (T16): re-running `init` re-detected `project.*`, backed up the prior file, and **preserved** the user-set `provider.model` I had set via `config set` moments earlier. |
| 2 | workspace limitado | Three independent test layers, all re-run green: pure function (`workspace-policy.test.ts`), gate-handler (`permission-gate.test.ts`, asserts **zero** `ui.confirmCalls` — blocked before a human ever sees it), and full-session integration with a real fake-model-driven `edit` tool call (`session-config.test.ts:133-169`). Fase-1-specific extension (T13): `defaultProtectedPaths(workspaceRoot)` (`packages/conductor-runtime/src/workspace-policy.ts:92-107`) unconditionally folds `.conductor/config.json`/`policy.json` into the protected set whenever a `workspaceRoot` is supplied — **not** opt-in via `additionalProtectedPaths`, so no future caller can forget it. Fase-0's symlink-escape adversarial test is inherited unchanged (see §5). | **Met — strongly** | This is a genuine security-relevant extension over Fase 0, not just carried forward: the policy file that governs the gate is itself made unwritable by the gate, closing the confused-deputy T13 names. Verified the mechanism is baked into the primitive itself (not a caller-supplied option), so it survives a future caller forgetting to wire it. |
| 3 | sessão persistente | `packages/conductor-cli/src/commands/chat/session-resolution.ts:22-28` (`resolveConductorAgentDir`/`resolveConductorSessionsDir` scope to `.conductor/sessions/`, never Pi's global `~/.pi/agent/sessions/`). `test/commands/chat/session-resolution.test.ts` drives **real** `SessionManager`/`createConductorSession` against a real scratch filesystem (never mocked) across fresh/recent/specific-id/id-prefix resume, including a negative case (`SessionNotFoundError`, not a silent fresh-start). Full-chain proof: `chat.test.ts:117-162` — a real `runChat()` call with a `FakeTerminal` and scripted model, ending on `/exit`, then asserting a `.jsonl` file actually exists under `.conductor/sessions/`. | **Met — strongly** | This is the criterion I was asked to scrutinize hardest. Confirmed directly: `expect(sessionFile).not.toContain(".pi")` (`session-resolution.test.ts:118`) is a real assertion against a real file path, not a mock. Resume is tested against **actual JSONL round-trips** (a second/third `driveOneTurn` call opens a brand-new `SessionManager`/session and reads back prior turns from disk), matching the rigor Fase 0's Gate 8 praised as its strongest-evidenced criterion. |
| 4 | prompt customizado | `buildFase1SystemPrompt(config)` (`packages/conductor-runtime/src/resource-loader.ts:82-93`) embeds `project.type`, `technologies`, and `provider.model` into the system prompt. Traced end to end: `session-config.test.ts:93` — `expect(fakeModel.lastSystemPrompt()).toContain(buildFase1SystemPrompt(config))`, a real captured request to a scripted model, not a mock of the prompt-builder. CLI-level: `conductor config set` (`commands/config.ts:171-205`) and `conductor chat` (`commands/chat.ts:106`) both funnel through the **same** `@conductor/config` `writeConfig`/`readConfig` functions (confirmed by direct source read) — so a value written by `config set` is read back by the identical code path `chat` uses, not a parallel one. **Live-verified**: I ran `config set provider.model openai/gpt-5-codex`, then `config show` reflected it. | **Met — strongly** | Genuinely traced, not just "a config field exists": the model-selection call (`modelRuntime.getModel(providerId, modelId)`, `chat.ts:128`) and the system-prompt text both derive from the same `config.provider.model` value, and `chat.test.ts:117-162` uses a **non-default** provider/model id (`conductor-fake/conductor-cli-fake-1`) written into config and shows it verbatim in the live status line, then successfully resolves and invokes that exact registered fake model. |
| 5 | ferramentas básicas | `packages/conductor-runtime/src/session.ts:132` — `tools: ["read", "write", "edit", "bash", ...customTools.map(...)]`, unconditional. `chat.ts`'s call to `createConductorSession` (`chat.ts:172-181`) passes no `tools` override at all. | **Met** | Confirmed directly from source that `chat` does **not** narrow the tool set inherited from `conductor-runtime` — the exact question I was asked to check. No test explicitly asserts "chat's session has all 4 tools" as a named case, but the omission of any override, combined with `session.ts`'s own unconditional default, makes this a straightforward source-level confirmation rather than one requiring a dedicated test. |
| 6 | TUI inicial | `packages/conductor-cli/test/commands/chat/tui-integration.test.ts` drives **real** `TuiMainScreen` + `Editor` + `Container` + `Text` + `SelectList` (the actual production classes, not stubs) through a **real** `createConductorSession`/`AgentSession`/permission-gate, with input arriving via `terminal.sendInput(...)` (simulated real keypresses: Enter, Down-arrow) and output verified via `terminal.allWrites()` (the exact string every `Terminal.write()` call received). | **Met, with an honestly-scoped limitation** | See §4 below for the detailed assessment — this is the criterion the task asked me to be most precise about. Short version: the render pipeline exercised is 100% real production code; only the bottom-most I/O boundary (`Terminal.write()` → an actual OS PTY) is swapped for `FakeTerminal`, a thin recorder. This is a legitimate, industry-standard technique (equivalent to testing an HTTP server via its response buffer instead of a live socket), not a mock of the TUI's own logic — but it is **not** a literal proof against an attached terminal, and I did not (could not, in this sandbox, without a model credential and a real PTY) drive `conductor chat` interactively myself end-to-end. Flagged precisely, not papered over. |

**Exit criterion overall: 6 of 6 bullets met**, 5 with strong, effect-asserting, re-run evidence; 1
("TUI inicial") met with a real integration proof against production rendering code but an honestly-named
headless-terminal limitation, not a literal PTY-attached demonstration.

---

## 3. Entregáveis — existence and substance

| # | Entregável | Status | Evidence |
|---|---|---|---|
| `conductor init` | **Delivered, substantive** | `packages/conductor-cli/src/commands/init.ts` (170 lines): real stack detection, config write, `.gitignore` generation, **idempotent merge** (T16), `--force` escape hatch with backup. Live-verified end to end (§2 row 1, §6). |
| `conductor doctor` | **Delivered, substantive** | `packages/conductor-cli/src/commands/doctor.ts`: 5 real checks (config validity, Node version, git state, library-if-configured, credential resolvability). Status-never-value discipline (T12) confirmed both from source (no credential value ever assigned to a printable field) and live output (`ANTHROPIC_API_KEY`-style presence-only reporting). |
| `conductor config` | **Delivered, substantive** | `packages/conductor-cli/src/commands/config.ts` (206 lines): `show`/`get`/`set`, allowlisted settable keys, validate-before-write (rejects unknown key or wrong type without touching disk — live-verified), backup-on-overwrite. |
| `conductor chat` | **Delivered, substantive — NOT a placeholder** | Read `cli.ts`'s dispatch directly: `case "chat": return await runChat({ cwd: io.cwd, args: rest, stdout: io.stdout, stderr: io.stderr });` (`cli.ts:144-145`). `runChat` (`commands/chat.ts`, 317 lines) wires a real `TuiMainScreen`, `Editor`, session resolution, status line (model/git/tokens/context/protected-path count), live transcript, and clean shutdown on `/exit`/Ctrl+C. This is definitively **not** the round-B1 "not yet implemented" stub — confirmed by reading the current file, not by trusting the build report. |

**Entregáveis: 4 of 4 delivered and substantive.**

---

## 4. "TUI inicial" — precise assessment of what is and is not proven

The task asked me to be exact here rather than round up. What `tui-integration.test.ts` and
`chat.test.ts` actually exercise:

- **Real:** `TuiMainScreen`, `Editor`, `Container`, `Text`, `SelectList` (all from `packages/tui`,
  unmodified production classes) — a real `createConductorSession`/`AgentSession` — the real
  permission-gate `pi.on("tool_call")` chokepoint — real `confirmOrDeny()` sanitization — real
  keypress-shaped input (`"\r"`, `"\x1b[B"`) delivered through `TuiMainScreen`'s own input-handling path.
- **Faked:** only the bottom-most `Terminal` interface — `FakeTerminal` (`test/support/fake-terminal.ts`)
  implements the exact same 13-method contract `ProcessTerminal` (the production implementation used by
  the real `bin/conductor.js`) implements, and simply appends every `write(data)` call to an array instead
  of writing to `process.stdout`. `FakeTerminal.write()` performs **no filtering, no ANSI parsing** — it
  is a pure recorder, so `terminal.allWrites()` is exactly the byte stream that would have gone to a real
  terminal. This is explicitly **not** the same strategy `packages/tui`'s own test suite uses to test
  itself pixel-accurately (`@xterm/headless`, per `fake-terminal.ts`'s own header comment) — it proves
  *data* correctness (right text, right component, malicious bytes absent), not pixel-perfect rendering.
- **Not exercised anywhere in this validation:** an actual OS-level PTY/attached terminal. I do not have
  one available in this sandbox, and building one was outside this task's scope. I also did not
  personally drive `conductor chat` interactively against a live model (no credential configured in this
  environment, and doing so was not requested) — I exercised `init`/`doctor`/`config` live myself (§6)
  but relied on the test suite's `FakeTerminal`-based proof, re-run and read in full, for the TUI layer
  itself.

**Verdict on this criterion: genuinely met at the "real rendering pipeline, recorded I/O boundary" level**
— stronger than Fase 0's bar (which ran everything headless via a fake `ExtensionUIContext` that never
rendered anything) but short of a literal terminal-attached demonstration. This is the same class of
honest caveat Fase 0's own Gate 8 applied to "executar testes" — named precisely rather than rounded up
to "fully met" or rounded down to "not met".

---

## 5. Fase-0 regression check — did anything already-proven get silently weakened?

Diffed every test file `git mv`'d/renamed from `packages/conductor-poc` to `packages/conductor-runtime`
against `develop`'s pre-Fase-1 baseline (not against the branch's own first commit, to rule out an
already-diverged comparison point):

| File | Diff vs. `develop` baseline | Verdict |
|---|---|---|
| `test/acceptance.test.ts` | `git diff develop:...poc... aa6d423c1:...runtime...` → **zero output, byte-identical** | No change at all — the walking-skeleton test Fase 0's Gate 8 scrutinized most closely is untouched. |
| `test/permission-gate.test.ts` | Purely additive (4 new T13/T14 `it()` blocks appended); zero existing lines modified | No weakening. |
| `test/workspace-policy.test.ts` | Purely additive (T13 `describe` block + 2 new `it()`s), plus one **cosmetic** rename (`"conductor-poc-outside-"` → `"conductor-runtime-outside-"` scratch-dir prefix string, matching the package rename itself) | No weakening — the only touched pre-existing line is a label string, not an assertion. |
| `test/confirm.test.ts` | Purely additive (a new `describe("terminal sanitization (T14)")` block appended after the last pre-existing test) | No weakening. |

**Confirmed: none of the 48 original Fase-0 walking-skeleton tests were altered in a way that reduces
what they prove.** Every diff against the `develop` baseline is either byte-identical or strictly
additive, with the single cosmetic exception noted above (a label, not a behavior).

---

## 6. Findings — two genuine defects surfaced (independent, not in either build report's framing)

Per this project's own Gate 8 standard, a divergence between what a threat model/ADR commits to and
what the code does is a **defect**, not a rounding error, however small its blast radius. Both below
were found by re-deriving evidence myself (source read + live reproduction), not by trusting a claim.

### 6.1 — T14 mitigation is narrower than its own binding scope: the chat transcript is unsanitized

**What was checked:** the task asked me to confirm/refute "text.ts does not sanitize" and assess whether
`confirmOrDeny()` is genuinely the "sole line of defense" as claimed.

**text.ts claim — CONFIRMED directly from source.** `packages/tui/src/components/text.ts:66`'s own code
comment states `wrapTextWithAnsi` "preserves ANSI codes but does NOT pad" — verified by reading
`render()` in full: no stripping/escaping of any control byte happens in `Text`. `visibleWidth()`
(`packages/tui/src/utils.ts:239-275`) parses escape sequences only to compute *display width*; it does
not remove them from the string `Text.render()` returns. `Text` is a pass-through for whatever bytes it
is given.

**`confirmOrDeny()` — CONFIRMED as the real sanitization sink for the approval dialog**, and
**`tui-integration.test.ts` — CONFIRMED as a genuinely adversarial, non-mocked proof for that specific
path**: it constructs a real CSI clear-screen+cursor-home sequence (`\x1b[2J\x1b[H`) embedded in a bash
command, drives it through the real permission-gate → `confirmOrDeny()` → `tui-ui-context.ts`'s
`confirm()` → a real `SelectList`/`Text` overlay render → `FakeTerminal.write()`, and asserts on the raw
captured bytes (plain text present, escape bytes absent) — not a string-equality mock. It also proves the
deny path via simulated real keypresses. This is not weaker than the build report's own framing.

**However — the "SOLE line of defense" claim (`tui-ui-context.ts:13`) is accurate only for the
confirm-dialog sink, and that is narrower than what T14 and ADR 0002 §7.4 actually commit to.**
`sanitizeForTerminal` (grep-verified, `packages/conductor-runtime/src/terminal-sanitize.ts`) is called
from exactly **one** place in the entire codebase: `confirm.ts:38-39`. But:

- ADR 0002 §7.4's own T14 mitigation text is explicit that **both** sinks need it: *"conductor-runtime's
  confirm.ts ... **e o adapter que conductor-cli escreve para desenhar ctx.ui.confirm()/o transcrito**
  sobre packages/tui devem escapar caracteres de controle C0/C1 e sequências CSI/OSC ... antes de
  passá-los para qualquer componente Text/Editor do Pi"* (emphasis added — "the transcript" is named
  explicitly, not implied).
- `gate3-fase1-addendum.md`'s T14 threat-table row itself names three vectors, not two: *"Saída de
  ferramenta / caminho / comando controlado pelo modelo"* — **tool output**, not just path/command.
- The actual implementation: `packages/conductor-cli/src/commands/chat/transcript.ts`'s
  `summarizeEntryForTranscript()` extracts raw assistant-message text and raw tool-result text
  (`extractText(message.content)`, lines 30-39, 70-73) with **zero** sanitization, and `chat.ts` feeds
  every line straight into `new Text(line)` appended to the live transcript `Container`
  (`chat.ts:197-198` on resume-replay, `chat.ts:258-261` on live `message_end`) — the same `Text`
  component confirmed above to pass raw bytes through unmodified, writing to the same real terminal sink
  the confirm dialog uses.
- `transcript.test.ts` has **zero** test cases for control-sequence handling (grep-verified: no
  `sanitiz`/`CSI`/`escape`/`\x1b` reference anywhere in the file).

**Reproduction:** a tool result whose content contains `\x1b[2J\x1b[H` (e.g. `bash`'s stdout from a
command that echoes such bytes, or `read` on a file that literally contains them — both entirely
plausible, unprivileged inputs) is truncated/formatted by `summarizeEntryForTranscript` and rendered via
`Text` into the live transcript **with the raw escape bytes intact** — there is no code path between the
tool result and the terminal write that removes them.

**Expected vs. actual:** ADR 0002 §7.4 (binding, Gate-4-approved) requires the transcript adapter to
sanitize model-controlled text before it reaches `Text`/`Editor`; the actual code does not.

**Which requirement it violates:** ADR 0002 §7.4's T14 mitigation (both sentences), and
`gate3-fase1-addendum.md`'s T14 threat definition (the "tool output" vector specifically).

**Severity: Medium-High.** It does not let an attacker forge an *approval decision* — the interactive
confirm overlay itself remains sanitized, so containment/approval integrity (the primary control) holds.
But it is a real, reachable, zero-test-coverage gap in a P2 threat's own binding mitigation, and the
"sole line of defense" framing in the shipped code's own comment overstates what is actually defended
(accurate for one sink, silent about the second one the same ADR named).

**Suggested test that would have caught it:** a `transcript.test.ts` (or a `chat.ts` integration test
mirroring `tui-integration.test.ts`'s pattern) asserting that a tool-result entry containing
`"\x1b[2J\x1b[HFAKE-SAFE-TEXT"` renders `"FAKE-SAFE-TEXT"` into the transcript but not the raw `\x1b[2J`
bytes — the same shape of test already proven to work for the confirm path.

### 6.2 — T11 known-secret-prefix check is fully anchored and can be bypassed with low-entropy padding

**What was checked:** live-tested `conductor config set` against secret-shaped values beyond the single
happy-path case the task named, as exploratory testing.

`packages/conductor-config/src/secret-detection.ts`'s `matchesKnownSecretPrefix()` (lines 71-74) uses
regexes anchored with `^...$` (e.g. `/^sk-ant-[A-Za-z0-9_-]{10,}$/`), matching only when the **entire**
field value **is** the secret pattern. The module's own header comment (line 15) states the intent
differently: *"a known secret/token prefix pattern (sk-, ghp_, AKIA, ...) is rejected wherever it
appears"* — i.e., substring matching, not full-string matching.

**Live reproduction:**

```
$ node bin/conductor.js config set provider.model "anthropic/sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE"
Set provider.model (...). Previous file backed up to ...
$ echo $?
0
```

The value was written to `.conductor/config.json` unredacted. The known-prefix regex did not fire
(anchored, and `"anthropic/sk-ant-..."` is not *equal to* the pattern). The entropy heuristic (the
module's second, independent defense) also did not fire, because I deliberately used a low-entropy
repeated-filler suffix (`"FAKE"` repeated) to stay under the 4.4-bits/char threshold.

**Note on real-world severity:** I also tested a *realistic* high-entropy 95-character random suffix in
the same "provider/sk-ant-..." shape — that one **was** correctly rejected by the entropy check, so a
genuine leaked API key (which is inherently high-entropy) is very likely still caught in practice. The
gap is specifically in the deterministic, documented "reject known prefixes wherever they appear"
guarantee, which has a demonstrated, reproducible counterexample independent of entropy.

**Which requirement it violates:** T11 (`gate3-fase1-addendum.md`, P1) / secure default 8; ADR 0002
§8.2 explicitly claims this ADR's implementation *"excede a mitigação pedida"* (exceeds what T11 asked
for) — the live counterexample shows the deterministic half of the defense has a real, if narrow, hole.

**Severity: Medium.** Practical exploitability requires deliberately crafting a low-entropy-padded value
containing a known prefix; a real accidental secret paste would very likely still be caught by the
entropy heuristic (verified above). But it is a reproducible violation of an explicit, documented
guarantee ("wherever it appears") in a P1-threat control, with a trivial fix (drop the `^`/`$` anchors,
or `.test()` against a substring search) and zero test coverage for the embedded case (grep-verified:
every existing `secret-detection.test.ts` case uses the secret pattern as the *entire* value, never
embedded).

**Suggested test that would have caught it:**
`expect(matchesKnownSecretPrefix("anthropic/sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true)` plus
a `config set` CLI-level case asserting the same embedded/padded shape is refused.

---

## 7. Overall verdict

**The Fase-1 exit criterion (§8, "O agente deve funcionar em um projeto real com...") is MET: 6 of 6
bullets verified with re-run, passing, effect-asserting tests and/or my own live CLI reproduction** — 5
strongly, 1 ("TUI inicial") with a precisely-named limitation (real production rendering code, recorded
I/O boundary rather than a literal attached PTY) that does not, in my judgment, invalidate the criterion
but should not be silently rounded up to "fully proven against a real terminal" either.

**All 4 entregáveis are delivered and substantive**, including `conductor chat`, independently confirmed
from `cli.ts`'s dispatch to be a real ~320-line implementation, not the round-B1 placeholder.

**Automated evidence is real and green:** 375/375 tests passing across 32 files in the 4 new packages
(re-run independently, not reused from any prior report), `npm run check` exit 0.

**Two genuine defects were found by independent verification, neither surfaced by either build report's
own framing:**
1. **T14's own binding scope (ADR 0002 §7.4, "o transcrito") is not fully implemented** —
   `sanitizeForTerminal()` protects the confirm-dialog sink only; the live chat transcript renders raw,
   unsanitized model/tool-controlled text through the same vulnerable `Text` component. Medium-High —
   real, reachable, zero test coverage, but does not defeat the approval gate itself.
2. **T11's "known prefix rejected wherever it appears" guarantee has a reproducible bypass** via
   low-entropy padding around an embedded secret prefix. Medium — a real leaked secret is very likely
   still caught by the entropy heuristic, but the deterministic half of the defense has a demonstrated
   hole with a trivial fix.

Neither defect blocks the exit criterion (the exit criterion does not name T11/T14 directly — those are
Gate-3/Gate-4 commitments layered on top), but per this project's own Gate 8 standard, **a divergence
between spec/ADR and delivered code becomes a defect, not a silent pass** — both are recorded as such
here rather than waved through.

**Fase-0 regression check: clean.** All inherited test files are either byte-identical to the `develop`
baseline or purely additive; no pre-existing assertion was weakened.

**Recommendation: advance Gate 8 conditionally** — same posture Fase 0's own Gate 8 took. Record both
defects (§6.1, §6.2) as open items in the journal with an explicit disposition (fix before Fase 2 starts,
given Fase 2's own stated objective is "implementar política fail-closed... redigir secrets" — both
defects sit squarely in Fase 2's own scope and are cheap, well-understood fixes) rather than letting them
pass unrecorded. The "TUI inicial" limitation (§4) should also be recorded honestly, not as a defect, but
as a known testing-depth boundary for whoever revisits TUI coverage next.
