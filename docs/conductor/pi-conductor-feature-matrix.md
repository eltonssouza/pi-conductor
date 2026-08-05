# Pi × Conductor feature matrix (Gate 4 — Fase 0 artifact)

**Demand:** rebuild the Conductor Coding Agent on top of the Pi agent runtime.
**Author:** solutions-architect (Gate 4, architecture).
**Evidence base:** `_recon-pi-architecture.md` (completed Pi technical recon — the "recon §N"
and `file:line` citations below all point into it), `plano_desenvolvimento.md` §4 (functional
scope) and §6 (repo layout), `gate1-discovery.md` §3 (dual-harness product constraint).
**Companion:** `pi-upstream-gaps.md` (the upstream gap list).

This matrix answers one question per capability the plan's §4 requires: **does Pi give it to us
today, what must Conductor add, where does that code live, and is it compose / build / decline.**
Per `gate1-discovery.md` §1.5 it records where Pi **does not** reach, not only where it does.

---

## Legend

**Pi-today column** — `yes` (Pi ships it, usable now) · `partial` (a primitive/substrate exists
but not the capability) · `no` (absent, confirmed) · `n/a` (not a runtime concern at all).

**Classification** — the relationship of the capability to the Pi runtime, derived (per grounding
below) from the prioritized drivers *time-to-market, TCO, and lock-in*:

- **compose** — reuse Pi's existing capability directly through the SDK / extension / tool / skill
  surface. Thin adapter + config only; Pi does the heavy lifting. Lowest cost, fastest.
- **build** — new Conductor code (a `packages/*` module or an `extensions/*` module) written **on
  Pi primitives**. This is where Conductor's differentiating governance lives.
- **decline** — do **not** route this through Pi: either decline to adopt Pi's version of it (an
  unstable/pre-release surface we must not couple to) or the capability is runtime-independent and
  is delivered outside Pi entirely. Recorded so the decision is explicit, not implicit.

**Repo home** — paths use the `plano_desenvolvimento.md` §6 layout (bare `packages/<name>/`,
`extensions/<name>/`, `content/<name>/`, `apps/cli/`). Where §4.6's `conductor-*` package grouping
is clearer I note it in parentheses.

---

## The matrix

| # | Capability (plan §4) | Pi today (recon citation) | What Conductor must add | Repo home (§6) | Class |
|---|---|---|---|---|---|
| 1 | **Agent loop + streaming** | **yes** — `Agent`/`AgentSession` + `createAgentSession()`; streaming via `session.subscribe()`→`text_delta`. `sdk.md:16-34,262-328`; recon §1 | A session adapter attaching `ConductorSessionMetadata` (gate/role/demand/budget — plan §7.5). No loop code. | `packages/runtime`, `packages/sdk` | compose |
| 2 | **Tool calling (parallel/sequential)** | **yes** — `AgentTool.executionMode?: "sequential"\|"parallel"` per-tool. `types.ts:379-403`; recon §3 | Register Conductor tools with correct `executionMode`; nothing on the loop. | `packages/tools` | compose |
| 3 | **Cancellation / interrupt** | **yes** — `session.abort()`/`agent.abort()`; `ctx.signal` in handlers; RPC `abort`/`steer`. `sdk.md:106-107`; recon §1,§5 | Wire abort into TUI `/exit` and autonomous budget/sign-off triggers. | `packages/runtime`, `packages/tui` | compose |
| 4 | **Retry / fallback between providers** | **partial** — same-model transient retry only (`set_auto_retry`, `rpc.md:426-451`); **no cross-provider fallback**. recon §7, gap #7 | A provider-fallback policy (tier floor, egress consent, tool-compat, ctx floor, cooldown, budget, data residency — plan §4.15). | `extensions/model-router`, `packages/providers` | build |
| 5 | **Model switching mid-session** | **yes** — `setModel()`/`cycleModel()`/`scopedModels`; RPC `set_model`. `sdk.md:66-112,367-429`; recon §1,§7 | Drive the switch from the gate/role model-role resolver (row 25); the switch itself is composed. | `packages/runtime`, `extensions/model-router` | compose |
| 6 | **Role switching mid-session** | **no** — no role concept (gap #3). Primitives exist: `before_agent_start` rewrites system prompt per-turn, `setActiveTools()`. `extensions.md:521-556`; recon §2,§7 | `ConductorRole` objects (§4.4) + registry; a `/role` switch that swaps system-prompt + active tools + model-role via those hooks. | `packages/roles`, `content/roles`, `extensions/gate-controller` | build |
| 7 | **Gate switching mid-session** | **no** — no gate/phase concept (gap #3). Primitive: `pi.registerCommand()`, session metadata, `custom` entries. recon §2,§9 | The 14-gate machine + `/gate` command + gate metadata on the session (see row 17). | `packages/gates`, `extensions/gate-controller` | build |
| 8 | **Auto-compaction** | **yes** — `compact`/`set_auto_compaction`; `CompactionEntry` with `retainedTail`. `session-format.md:229-249,320-342`; recon §4,§5 | Compaction trigger at ~90% ctx in autonomous mode; ensure redaction + progressive-disclosure unload survive it (thin policy). | `packages/sessions` | compose |
| 9 | **Checkpoints** | **partial** — compaction entries + `pi.appendEntry()`/labels are a substrate; no named checkpoint with gate/evidence semantics. recon §4, gap #5 | `checkpoint` tool + auto-checkpoint extension; checkpoint = recoverable marker bound to gate/evidence. Schema is Conductor's. **Build on stable JSONL, not AgentHarness v2** (row 10b). | `extensions/auto-checkpoint`, `packages/tools`, `packages/sessions` | build |
| 10 | **Session resume** | **yes** — `SessionManager.continueRecent()/.open()`, JSONL persistence; RPC `switch_session`. `session-format.md:1-27`; recon §4 | `conductor session resume <id>` mapping; re-attach Conductor metadata on resume. | `packages/sessions`, `apps/cli` | compose |
| 10b | **Durable / crash-safe resumable engine (lanes, operation-log)** | **partial/unstable** — this is exactly `AgentHarness` v2, whose ops (`prompt/resume/compact/…`) are **all stubs → `HarnessNotImplemented`**. `agent-harness.ts:360-464`; recon §0,§4, gap #6 | For MVP, a **thin durable/checkpoint layer over the stable `Agent`/`AgentSession`+JSONL surface, behind a Conductor-owned port (ACL)**; migrate onto Pi's engine when it ships. Do **not** depend on the stub. | `packages/sessions` (port), later swap adapter | decline |
| 11 | **Session fork / branch** | **yes** — id/parentId tree; `/fork`,`/clone`, `SessionManager.branch()/branchWithSummary()`, `AgentSessionRuntime.fork()`. `session-format.md:386-439`; recon §4 | `conductor session branch/tree` commands; subagent sessions as child branches (feeds row 15). | `packages/sessions`, `apps/cli` | compose |
| 12 | **Custom tools** (`ast_search` `ast_edit` `diagnostics` `git` `journal` `library` `ask_user` `checkpoint` `hub` `eval` `mcp`) | **mechanism yes, tools no** — `defineTool()`/`pi.registerTool()` full shape, override of built-ins. `sdk.md:565-597`, `extensions.md:1921-1979`; recon §3. **No `risk`/`permission` field on `AgentTool`** (gap #2) | Implement each tool: ast_* (tree-sitter/LSP), diagnostics (LSP/compiler), git (git CLI), journal/library/checkpoint/gate (Conductor services), `ask_user` (`ctx.ui.confirm/input`), mcp (MCP client), hub/eval new. | `packages/tools` (+ `memory`,`library`,`mcp`) | build |
| 13 | **Permission system** (read/write/exec/network/security + protected paths) | **no** — confirmed explicit: *"Pi does not include a built-in permission system…"* `README.md:37-45`, `security.md:31-37`; recon §9, gaps #1/#2. Primitive: `tool_call` hook is a true pre-exec block/modify gate | The **entire** policy engine: 5-level model, fail-closed default-deny, protected-paths config, name+arg risk classifier, egress events, allowlists. 100% new on the hook. | `packages/policies`, `extensions/permission-gate`, `extensions/protected-paths` (§4.6 `conductor-security`) | build |
| 14 | **37 roles as native objects** | **no** — gap #3. Primitives: system-prompt override, `setActiveTools`, skills. recon §2,§7 | `ConductorRole` contract (§4.4) + registry + loader (`ConductorResourceLoader`, §7.4); migrate 37 roles. | `packages/roles`, `content/roles` | build |
| 15 | **Subagent delegation (acyclic graph + shared budget)** | **no** — Pi keeps core small, leaves subagents to extensions (plan §4.5). Substrate: session fork = child sessions (recon §4) | `task` tool; `canSpawn` acyclic-graph validation; isolated child context; shared token-budget accounting. | `packages/tools` (task), `packages/roles` (graph), `packages/sessions` (budget) | build |
| 16 | **44 skills with progressive disclosure** | **yes (superset)** — native Agent-Skills-standard loader, progressive disclosure, cross-harness path aliasing (can point at `~/.claude/skills`). `skills.md:5-90,143-189`; recon §6 | Point Pi's `skills` setting at Conductor's dir; add gate/areas frontmatter + lint. Existing `.claude/skills/*/SKILL.md` plausibly load as-is. | `packages/skills`, `content/skills` | compose |
| 17 | **14-gate state machine + persisted evidence** | **no** — no workflow/gate concept; `custom` entries are generic substrate. recon §9, gaps #3/#5 | The whole `GateState` machine (§4.7), evidence schema, per-gate recall→ground→delegate→record→halt protocol, exit criteria. | `packages/gates`, `extensions/gate-controller`, `content/gates` | build |
| 18 | **Execution modes** (interactive / one-shot / gate / role / autonomous / headless-CI / RPC / SDK) | **partial** — interactive(TUI), print `-p`, `--mode json`, `pi --mode rpc`, `createAgentSession` SDK all exist (recon §8,§5,§1); **no gate/role/autonomous modes** | `--gate`/`--role`/`auto` as CLI wrappers over the composed base modes; autonomous loop = gate-controller + auto-checkpoint + budget. **Multi-session service transport → decline the experimental CBOR stack, use RPC mode** (gap #8). | `apps/cli`, `packages/rpc`, `packages/sdk`, `extensions/gate-controller` | build |
| 19 | **Session-tree management** (list/show/resume/branch/tree/handoff/export) | **partial** — tree + list/show/branch/tree exist (recon §4); **no `handoff`, no redacted `export`, no secret redaction** (plan §4.9) | `handoff`/`export` with per-section redaction (session-redaction extension); `conductor session *` surface; subagent-session separation. Redaction is a safety invariant (§10 #9). | `packages/sessions`, `extensions/session-redaction`, `apps/cli` | build |
| 20 | **Library (RAG / grounding)** | **no** — Pi ships no RAG/corpus (recon has none; skills ≠ corpus, §6). Conductor-only | Full Library: hybrid search (vector+lexical+code+RRF), mandatory citations, incremental+offline index, `library` tool + `conductor library` cmds. Migrate current bge-m3 + SQLite backend. | `packages/library`, `packages/tools` | build |
| 21 | **Diary (dynamic memory + auto-capture)** | **partial substrate** — `custom` entries/`appendEntry()` are a substrate only; no journal schema, no auto-capture. recon gap #5; plan §4.10 flags auto-capture as priority gap | Diary subsystem (decisions/errors/solutions/risks/approvals + temporal + entity graph + RRF); **auto-capture** hooking loop events (`message_*`,`tool_call`,`agent_end`); `journal` tool + `conductor journal` cmds. | `packages/memory`, `extensions/memory-capture`, `packages/tools` | build |
| 22 | **Intelligence / adaptation layer** | **no** — no cross-project pattern detection, RAG-confidence, contradiction detection, adaptive depth, knowledge graph (plan §4.12). Conductor-only | Migrate the intelligence modules. **NB:** §6 layout has no dedicated package — flag; place under `packages/learning` (+ `packages/memory` for the graph). | `packages/learning`, `packages/memory` | build |
| 23 | **Self-learning pipeline** | **no** — no distill/promote pipeline (plan §4.13). Conductor already has the `self-learning` skill + `learn distill` hook | `conductor learn inspect/distill/validate/promote/reject`; promotion rule (verification + known failure + discarded dead-end + reproducible + no-secrets + reuse criteria); SessionEnd hook. | `packages/learning`, `content/skills` | build |
| 24 | **MCP client + server** | **no (recon silent — not investigated)** — treat as absent for Pi; Conductor already ships `cdt mcp` (client + memories server). plan §4.14 | MCP client (GitHub/Jira/Slack/DB/observability/browser/secrets/cloud) with per-connector policy; MCP server exposing `library_search`/`journal_*`/`gate_status`/`gate_evidence`/`session_search`/`skill_search`/`project_context`. | `packages/mcp` (§4.6 `conductor-mcp`), `packages/policies` | build |
| 25 | **Model routing (roles/tiers + fail-closed on missing critical model)** | **no** — no model-role/tier concept; `scopedModels` is only a candidate pool; no fail-closed. `models.md:257-298`, `sdk.md:391-397`; recon §7, gap #4 | Role→tier table (strategic/planning/standard/fast/lightweight/security/review), gate→role→pool→availability resolver, **fail-closed refusal** when a critical gate (e.g. 9) has no compatible model (§10 #5,#16). `model_select` hook is the seam. | `extensions/model-router`, `packages/providers` | build |
| 26 | **TUI status surface** | **partial (framework only)** — `packages/tui` is a standalone, decoupled TUI framework (VStack/HStack/ScrollView, diff render, images); renders a coding-agent UI, **not** Conductor's status fields. `tui/README.md`; recon §8 | Conductor status widgets + data plumbing (active gate/role/model-role/budget/subagents/permission level/pending risks/RAG+memory status/checkpoints — §4.16) on Pi's TUI primitives; `/gate /role /budget /approve /deny …` + visual modes. | `packages/tui`/`packages/ui` (§4.6 `conductor-ui`) reusing Pi `tui` | build |
| 27 | **Dual-harness emission (Claude Code / Codex / Cursor)** | **n/a** — not a Pi feature at any layer; runtime-independent. Current Conductor already does it via `CLAUDE.md` + `.claude/agents` + `.claude/skills` scaffolding. `gate1-discovery.md` §3 | Keep/port the emitter: render canonical `content/` (roles/skills/gates/rules/commands) to third-party formats. **§6 layout has no emitter package — flag.** Decision (Gate 4): Python emitter alongside TS core, or rewrite to consume `content/`. Touches **no** Pi internals. | `content/` (source) + new `packages/emit` or `packages/project`; or existing Python emitter | decline |

---

## Bucket totals

| Class | Count | Rows |
|---|---:|---|
| **compose** | 8 | 1, 2, 3, 5, 8, 10, 11, 16 |
| **build** | 18 | 4, 6, 7, 9, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26 |
| **decline** | 2 | 10b (AgentHarness v2), 27 (dual-harness emission) |
| **total** | 28 | (27 required capabilities + row 10b, the durable-execution dependency split out) |

The shape is the thesis of `gate1-discovery.md` H1 made concrete: the **compose** wins are all
undifferentiated runtime plumbing (loop, streaming, tool-call batching, model switch, compaction,
resume, fork, and — the standout — skills, where Pi's loader is a *superset* of Conductor's need).
Every **build** row is governance, policy, memory, or evidence — Conductor's actual value. The two
**decline** rows are the two places where routing through Pi would be a mistake: coupling to an
unstable engine (10b) or forcing a runtime-independent capability into the runtime (27).

---

## Notes on the contested / mixed rows

- **Row 10b (durable execution) — the load-bearing decline.** `AgentHarness` v2 is the *one Pi
  subsystem designed for exactly Conductor's need* (lanes, durable operation-log, crash recovery),
  which makes adopting it the tempting-but-wrong move: its operational methods are stubs today
  (`agent-harness.ts:360-464`) and the CHANGELOG marks it pre-release/breaking (recon §4). We
  therefore build the MVP checkpoint/resume/evidence foundation on the **stable**
  `Agent`/`AgentSession`+JSONL surface, **behind a Conductor-owned port** so the engine can be
  swapped for Pi's when it ships — the adapter/anti-corruption discipline in the grounding. This
  decision colours rows 9, 10, 17, 19. It is the highest-risk gap in `pi-upstream-gaps.md`.

- **Rows 13 / 25 — the two fail-closed builds.** Both encode the plan's fail-closed invariant on a
  Pi that is explicitly permissive by design (`security.md:31-37`). The `tool_call` hook (row 13)
  and `model_select` hook (row 25) are genuine pre-execution seams, but Pi supplies *no* default
  posture, policy language, or risk metadata (gap #2) — Conductor writes the `if`-statements and
  owns the default-deny. Getting either fail-**open** is catastrophic (destructive exec on real
  infra; a silent downgrade of the Gate-9 security model), so they are build, never compose.

- **Row 18 — mixed transports.** Interactive/print/JSON/RPC/SDK are composed as-is; the
  gate/role/autonomous/headless-CI-gate modes are the net-new governance layer. The "drive Pi as a
  persistent multi-session service" ambition is **declined** for MVP (the CBOR `protocol/server/
  client` stack is experimental with no built-in coding-agent service, recon §5, gap #8); RPC mode
  (subprocess-per-session) covers headless/CI.

- **Row 26 — reuse the framework, build the surface.** Pi's `tui` package is reusable rendering
  machinery (compose-able), but every field Conductor's status line shows (gate, role, model-role,
  budget, subagents, permission level, pending risks, RAG/memory status) is data Pi has no concept
  of — so the row is build, with the framework as a composed dependency.

- **Layout gaps surfaced by this matrix** (feed `pi-upstream-gaps.md` §Additional): §6's repo
  layout has **no home for the intelligence/adaptation layer** (row 22) and **no emitter package**
  (row 27) — both are Conductor-internal omissions in the plan, not Pi gaps.

---

## Grounding (library, Gate 4)

Queried from `C:\development\source\projects\conductor` via `cdt library "<q>" --gate 4`.

1. *"integration pattern trade-offs: build vs buy vs compose when adopting an external runtime as a
   foundation; when to wrap a third-party system with an adapter/anti-corruption layer vs fork it"*
   → **Solution Architecture — Complete Professional Guide**, §3.2 / §3.5 / §3.7 and Part II
   ("Designing") on **cloud, cost, and integration trade-offs**: solutions are *derived from
   prioritized drivers (cost ceiling, scale, time-to-market, compliance) and the chosen trade-offs
   are recorded so they can be revisited*, and every integration choice carries a **lock-in / cost
   risk** to name. Used to define the compose/build/decline buckets as a driver-prioritized
   derivation (time-to-market + TCO + lock-in), and to justify recording each classification rather
   than leaving it implicit.

2. *"anti-corruption layer and adapter/gateway pattern to isolate a system from an external
   dependency so the vendor can be swapped or upgraded without corrupting the core domain"*
   → **Architecture Boundaries and the Dependency Rule — Complete Professional Guide**, §1.7
   (*introduce a port the use case owns and move the concrete call to an adapter*) and
   **Domain-Driven Design — Complete Professional Guide**, §2.4 (**anti-corruption layer** at the
   integration boundary between bounded contexts). Used to justify **row 10b's port/ACL over the
   unstable `AgentHarness`** and the general "Conductor owns the port, Pi sits behind an adapter"
   posture — the compose rows still call Pi through a Conductor-owned seam so the runtime stays
   swappable.
   → **Object-Oriented Thinking — Complete Professional Guide**, §2.12 ("When not to hide behind an
   interface" — the split *pays where implementations really change — swapping a vendor — [and] what
   costs more than it returns is the reflex of one interface per class*). Used as the counter-weight:
   we wrap Pi where the surface is unstable (10b) but **compose directly** where it is stable and a
   superset (row 16 skills), rather than reflexively abstracting every compose win.
   → **Messaging and Integration Patterns — Complete Professional Guide**, §1.12 / §2.12 (*a
   synchronous call with a timeout and a retry has fewer moving parts*; *decomposition earns itself
   when the flow has real variation*). Used to keep the compose rows thin — no messaging/abstraction
   layer where a direct SDK call suffices.
   → **Enterprise Application Architecture Patterns — Complete Professional Guide**, §2.2 (*layers
   localize change and risk … clean layering lets teams swap implementations*). Used to justify the
   plan's orchestration-over-runtime layering (plan §5) that the whole matrix assumes.

**Coverage note:** the corpus answers the build-vs-compose/adapter question well from the general
architecture books above; it returned nothing Pi-specific (as expected — Pi is not in the corpus),
so all Pi facts are cited to the recon, not the library. No citation was forced.
