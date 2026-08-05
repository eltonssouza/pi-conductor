# Gate 8 — Validation against the spec (Fase 0 — Descoberta e prova arquitetural)

**Demand:** rebuild the Conductor Coding Agent on top of the Pi agent runtime.
**Validator:** quality-assurance (Gate 8, independent verification — re-derived from repo state,
builder's self-report not trusted).
**Repo:** `C:\development\tools\pi`, branch `feature/fase0-descoberta-arquitetural`.
**Commits inspected:** `046e1d556` (Gate 1/3/4 docs), `4bd67d764` (Gate 5, RED), `5527c2597` (Gate 6, GREEN).
**Spec validated against:** `plano_desenvolvimento.md` §8, "Fase 0 — Descoberta e prova arquitetural".

---

## 1. Automated evidence (re-run independently, not reused from any prior report)

| Check | Command | Result |
|---|---|---|
| Unit/integration/acceptance suite | `cd packages/conductor-poc && npx vitest run` | **6 test files, 40 tests, all passed, exit 0** (7.44s first run, 5.53s repeat run) |
| Real-provider acceptance test | same run, `test/live-model.acceptance.test.ts` | `DEEPSEEK_API_KEY` was set in this environment → the test ran for real (not skipped): `✓ calls the real DeepSeek provider once with a trivial prompt (1442ms)`, asserting the response contains "OK". Confirmed by an isolated re-run with `--reporter=verbose`. |
| Repo CI gate | `cd C:\development\tools\pi && npm run check` (biome, pinned-deps, ts-imports, shrinkwrap, install-lock, `tsgo --noEmit`, browser-smoke) | **exit 0**, no errors, no warnings. Chain uses `&&`, so `tsgo --noEmit` passing is entailed by `check:browser-smoke` having run. |

Grounding (mandatory, per project rules): `cdt library "acceptance criteria validation living documentation definition of done verification test-driven specification" --gate 8` from the Conductor repo returned 5 passages, top match 0.639, sources **Spec-Driven Development — The Complete Book** and **Specification by Example — Complete Professional Guide**. Cited claim: a specification is "living documentation" only if it is *validated frequently against the real system* and *continuously refined* (Specification by Example — Complete Professional Guide, §3.1) — which is the standard applied below: every exit-criterion bullet is checked against an actual, currently-passing, re-run test, not against the builder's narrative.

---

## 2. Exit criterion ("O protótipo deve...") — bullet by bullet

| # | Criterion | Evidence (file:line) | Verdict | Notes |
|---|---|---|---|---|
| 1 | abrir uma sessão | `test/acceptance.test.ts:97-106` (`createConductorSession` + `bindExtensions`); implementation `src/session.ts:51-102` | **Met** | Session creation is not merely "does not throw" — the subsequent `prompt()` call and its 5-turn tool-calling loop (assertion below) only succeed if the session actually opened against the real `AgentSession`/`ModelRuntime`/`SessionManager` stack. |
| 2 | chamar um modelo | Mocked: `test/acceptance.test.ts:109,112` — `await conductorSession.session.prompt(...)` then `expect(fakeModel.callCount()).toBe(5)`. Real: `test/live-model.acceptance.test.ts:61,74-77` — real DeepSeek call, asserts the response text contains "OK". | **Met — strongly** | The mocked path asserts an *effect* (5 scripted turns actually consumed), not just "no exception". The real-provider test genuinely executed in this run (key present) and passed, so "one real call" is not merely theoretical/aspirational — it was observed to work. |
| 3 | ler um arquivo | `test/acceptance.test.ts:114-116` — `readDecision?.allowed).toBe(true)`; unit-level: `test/permission-gate.test.ts:67-87` (asserts `allowed:true`, no confirm prompt, and a real ISO timestamp). | **Met, but weakly covered** | These assertions confirm the permission-gate's *decision* to allow the read, and that the multi-turn loop proceeds past it. They do **not** assert that the tool's returned file content ("hello conductor") actually reached the model/session — `test/support/fake-model.ts:78-136` scripts responses purely by call-index (`Math.min(callCount, …)`), never by inspecting the prior tool result. Pi's own test suite is the right place for "does the read tool return correct bytes"; Conductor's PoC only needed to prove the gate doesn't block it, which it does. Flagged as weak-but-adequate for this criterion's intent. |
| 4 | editar um arquivo com aprovação | Approved: `test/acceptance.test.ts:118-121` — decision `allowed:true` **and** `readFileSync(...)).toBe("hello from Fase 0")` (real disk mutation, not a mock). Blocked: `test/acceptance.test.ts:125-128` — `allowed:false`, `reason` truthy, `existsSync(outsideMarker)).toBe(false)`. Unit level, genuinely adversarial: `test/workspace-policy.test.ts:130-149` creates a **real OS junction symlink** pointing outside the workspace and asserts the escape is denied. | **Met — strongly, on both halves** | See §4 below for the adversarial-test assessment in detail. |
| 5 | executar testes | `test/acceptance.test.ts:86-87,131-133` — a **trivial** `node -e "process.exit(0)"` command routed through the gated `bash` tool, asserting `allowed:true` and that approval (`ui.confirmCalls`) was required. | **Partially met — literal gap** | The suite proves the `bash` tool is correctly gated (containment N/A for bash per `src/permission-gate.ts:89-94`, approval required, fail-closed on timeout/no-UI — see `test/permission-gate.test.ts:219-247`), which is the mechanism a real test-run command would use. But **no test actually invokes a test runner** (`npm test`, `pytest`, etc.) through that gate — the acceptance test's own comment (`acceptance.test.ts:14`) calls it "a trivial, side-effect-free command", not a test execution. The capability is demonstrated; the literal act of "executar testes" is not. This should be called out to the builder/PO, not silently accepted. |
| 6 | persistir a sessão | `test/acceptance.test.ts:135-136` — `sessionFile` is truthy after `dispose()`; JSONL backing implied by `SessionManager.create()` (`src/session.ts:84-85`, Pi's own JSONL-backed `SessionManager`). | **Met** | Session-file existence plus the resume test below (which reads *only* from that file) is the meaningful proof, not the truthy check alone. |
| 7 | retomar a sessão | `test/acceptance.test.ts:142-163` — a **brand-new** `ModelRuntime`, a **brand-new** `SessionManager.open(sessionFile)`, and a **brand-new** `createConductorSession(...)` call (fresh permission-gate instance too), then `resumedSessionManager.getEntries()` is asserted to contain both `"hello from Fase 0"` (the prior approved edit) and `"walking skeleton complete"` (the prior final assistant turn). | **Met — strongly** | This is the strongest-evidenced criterion in the suite: it does not reuse any in-memory state from the original session handle, so the assertion can only pass if the JSONL file itself round-trips the prior turns/tool-results. |

**Exit criterion overall: 6 of 7 bullets solidly met; 1 (criterion 5, "executar testes") met only in the loose sense of "the bash tool works through the gate," not literally "a test suite was run." This is a real, if minor, gap that should be named explicitly rather than folded into "met."**

---

## 3. Entregáveis — existence and substance

| # | Entregável | Status | Evidence |
|---|---|---|---|
| 1 | ADR de adoção do Pi | **Delivered, substantive** | `docs/adr/0001-adopt-pi-as-runtime.md`, 36306 bytes. Contains a risk register (R1–R5+), and two addenda **inside the same file** (not separate files, contrary to the task brief's phrasing): "Adendo 0001-A — Reconciliação com o Gate 3" (line 379) and "Adendo 0001-B — Resolução das lacunas de layout A1/A2" (line 440). Real content, not a stub. |
| 2 | matriz Pi × Conductor | **Delivered, substantive** | `docs/conductor/pi-conductor-feature-matrix.md`, 20769 bytes, 28 capability rows with file:line citations into the recon doc and a compose/build/decline classification per row. |
| 3 | prova de conceito do CLI | **NOT delivered** | Confirmed: `packages/conductor-poc/package.json` has no `bin` field; `"main": "./src/index.ts"` is a library entry point, not an executable. `src/index.ts` only re-exports functions/types (confirmed by reading it in full). No file anywhere under `packages/conductor-poc` invokes Pi's own CLI/RPC channel (`pi --mode rpc`) either — the whole PoC is built on the SDK-level `createAgentSession()` API. See judgment below. |
| 4 | prova de conceito de uma tool customizada | **NOT delivered — not flagged by the builder** | Grepped the entire `src/` and `test/` trees for `registerTool`/`defineTool`: zero hits outside a comment. `src/session.ts:92` wires only Pi's **built-in** tools (`["read", "write", "edit", "bash"]`) — no custom tool is ever registered. The feature matrix itself documents this as undone: row 12 ("Custom tools") is rated **"mechanism yes, tools no"** and classified `build` (future work), not delivered here. This is a genuine missing entregável that the task's own framing did not call out — caught independently in this validation. |
| 5 | prova de conceito de uma extension | **Delivered, substantive** | `src/permission-gate.ts` is a real Pi extension via `pi.on("tool_call", …)` (`createPermissionGateExtension`, lines 107-144), not a stub — it implements a full decision table (read/write-edit/bash/unknown-tool) and is exercised by 13 unit tests in `test/permission-gate.test.ts` plus the acceptance test. |
| 6 | prova de conceito de sessão persistida | **Delivered, strongly** | See exit-criterion rows 6-7 above — persist + resume-from-disk-only is the best-covered capability in the suite. |
| 7 | lista de gaps upstream | **Delivered, substantive** | `docs/conductor/pi-upstream-gaps.md`, 15626 bytes, 8 numbered gaps + 2 additional (A1/A2), each with missing/why-it-matters/route, plus a routing-count summary table. |

**Entregáveis overall: 5 of 7 delivered and substantive; 2 of 7 (CLI PoC, custom-tool PoC) not delivered at all.** The task brief asked me to verify and judge only the CLI gap; independent verification surfaced a second, equally real gap (custom-tool PoC) that was not mentioned in the builder's framing.

---

## 4. Judgment — is the missing CLI PoC an acceptable Fase-0 gap?

Checked `plano_desenvolvimento.md` lines 1195-1263 directly. Fase 1's own **objectives** list `"criar CLI"` explicitly, and Fase 1's **entregáveis** are the actual commands (`conductor init`, `conductor doctor`, `conductor config`, `conductor chat`) — i.e., the plan itself draws the line between "Fase 0 proves the underlying pieces work" and "Fase 1 ships the product's own CLI." Read charitably, a Conductor-branded CLI binary is Fase-1 scope, and building one in Fase 0 would arguably be premature investment ahead of the architecture being locked.

However, that charitable reading does not fully clear the gap, for two reasons:
1. **Nothing in the delivered docs says this.** I grepped the ADR, gate1-discovery, gate3-threat-model, and the feature matrix for any explicit statement that "prova de conceito do CLI" was consciously descoped to Fase 1 — there is none. The entregável is simply absent, with no journal/ADR record of the decision to drop it. Per this project's own Gate 8 standard, an unexplained gap between spec and delivery is a **defect or a spec adjustment — it does not silently slip through**.
2. **Even a minimal PoC of Pi's own existing CLI/RPC channel was in scope and wasn't done.** "Prova de conceito do CLI" does not have to mean "Conductor ships `conductor chat`" — it could equally mean "prove Pi's own `pi --mode rpc` / CLI mode can be driven end-to-end," which is a channel Pi already ships today (confirmed present in `_recon-pi-architecture.md` §8, "CLI/TUI wiring"). The builder built exclusively against the **SDK** surface (`createAgentSession()`), and never exercised the CLI/RPC surface at all. Under either reading of the entregável, it is unmet.

**Judgment: this is a real miss, not a harmless scope simplification.** It does not block the Fase-0 exit criterion (which is the load-bearing gate per the task brief, and does not itself mention a CLI), but it should go back as an open item — either (a) add a minimal PoC exercising Pi's CLI/RPC mode before closing Fase 0, or (b) explicitly record in the ADR/journal that the CLI entregável is descoped to Fase 1, with a one-line rationale, so the gap is a documented decision rather than an omission. Recorded as a Gate 8 finding, not a silent pass.

The same reasoning applies, more sharply, to the **custom-tool PoC** (entregável #4): there is no Fase-1-scope argument available there — the plan explicitly lists it as a Fase-0 deliverable and nothing later in the plan reassigns it. This is the stronger of the two gaps.

---

## 5. Is the blocked-edit test genuinely adversarial?

**Yes, genuinely adversarial — not a happy-path-only test.** Two independent lines of evidence:

1. `test/permission-gate.test.ts:141-156` — a unit test that submits an `edit` call with `path: "../outside.txt"` and asserts `block:true`, a reason matching `/outside the workspace root/`, and (critically) that **zero** approval prompts fired (`ui.confirmCalls).toHaveLength(0)`) — proving containment is checked *before* the approval step, not as a fallback after a human clicks "approve."
2. `test/workspace-policy.test.ts:130-149` — a **stronger, filesystem-level** adversarial test: it creates a real directory *outside* the scratch workspace, then creates a real Windows junction symlink (`symlinkSync(outsideDir.root, linkPath, "junction")`) *inside* the workspace pointing at it, then asserts that resolving a path through that symlink is denied. This is a genuine symlink-escape attempt, not a string check. I independently verified two things this session, since the environment is Windows and junctions can silently no-op if creation fails: (a) a standalone Node script confirmed unprivileged junction creation succeeds on this machine, and (b) a targeted verbose re-run of `workspace-policy.test.ts` confirmed the symlink test actually executed and passed (`✓ … denies a symlink inside the workspace that resolves outside it`), not silently skipped by the test's own `try { … } catch { return; }` escape hatch for platforms where symlink creation requires elevation.
3. Additional adversarial coverage beyond the two explicit "blocked" cases named in the task: `test/permission-gate.test.ts:158-180` (protected-path deny-list, e.g. `~/.ssh`-style locations, checked independently of workspace containment) and `test/permission-gate.test.ts:182-199` (malformed/`undefined` path input must still deny, fail-closed, never throw past the handler).

This clears the bar `quality-assurance` looks for: an adversarial test attempts a real escape path (not a mock) and asserts denial with an observable side effect (`existsSync(outsideMarker)).toBe(false)` in the acceptance test), not merely that a function returned `false`.

---

## 6. Overall verdict

**The Fase-0 exit criterion (§8, "O protótipo deve...") is MET: 6 of 7 bullets solidly verified with re-run, passing, effect-asserting tests (not "ran without throwing"); 1 bullet ("executar testes") is met only in the loose/mechanistic sense and should be named as such, not silently counted as fully satisfied.**

**The Entregáveis list is 5 of 7 delivered and substantive.** Two are missing outright: the CLI PoC (arguably — but not documented as — Fase-1 scope) and the custom-tool PoC (no Fase-1 cover story available; a straightforward miss). Neither missing entregável invalidates the exit criterion itself, but both are open items that should not be waved through silently — they are exactly the kind of "spec vs. delivered" gap Gate 8 exists to surface.

**Automated evidence is real and green:** 40/40 tests passing (verified by two independent re-runs, including the gated real-provider test which genuinely executed against DeepSeek in this environment), `npm run check` exit 0 (biome, pinned-deps, ts-imports, shrinkwrap, install-lock, `tsgo --noEmit`, browser-smoke all green).

**Recommendation:** advance Gate 8 conditionally — record the two entregável gaps (CLI PoC, custom-tool PoC) and the "executar testes is mechanistic, not literal" note as open items in the journal, with an explicit decision (descope to Fase 1 with rationale, or backfill before closing Fase 0) rather than letting them pass unrecorded.

---

## 7. Orchestrator resolution (recorded after this validation, same gate)

Per this Gate 8's own recommendation: neither gap is waved through silently, and neither is
force-descoped with a rationale that doesn't hold up. Decision, made under `/cdt-auto`'s
auto-decision policy (technical, not a sign-off):

- **CLI/RPC PoC — partially descoped, with the honest half kept open.** The *branded* `conductor`
  CLI (init/doctor/config/chat) is genuinely Fase-1 scope per the plan's own §8 — that half is
  descoped, with this line as the recorded rationale (§6 point 1 above asked for exactly this: a
  documented decision, not silence). The *other* half of this gate's finding — that even Pi's own
  existing CLI/RPC channel was never exercised, despite being in scope either way — is **not**
  descoped. It is carried forward as the **first item** of the next `/cdt-auto --continue` pass on
  this demand, before any Fase-1 work starts.
- **Custom-tool PoC — left open, no cover story invented.** Gate 8 is explicit that the plan
  assigns this to Fase 0 with no later reassignment. There is no honest descope available.
  Carried forward as the **second item** of the next continuation pass, alongside the CLI/RPC PoC.
- **"executar testes" (exit criterion #7) — accepted as mechanistically met for Fase 0.** The
  walking skeleton's job was to prove the bash-tool gate enforces policy on a test-run invocation,
  which it does; asserting a *real* test framework's pass/fail output is meaningfully more scope
  (parsing runner output, handling failure) that belongs with the custom-tool work above, not as a
  blocking redo of this specific test.

**Net effect:** Fase 0 is NOT declared fully closed by this checkpoint. Its architecture
deliverables (ADR, matrix, gaps, threat model, discovery) and its exit criterion are done and
verified; two entregáveis remain explicitly open and are queued, not forgotten, at the top of the
continuation marker (`.cdt/auto/pi-conductor-fase0.continue.json`).
