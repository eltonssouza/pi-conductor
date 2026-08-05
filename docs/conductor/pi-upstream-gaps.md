# Pi upstream gap list (Gate 4 — Fase 0 artifact)

**Demand:** rebuild the Conductor Coding Agent on top of the Pi agent runtime.
**Author:** solutions-architect (Gate 4, architecture).
**Evidence base:** `_recon-pi-architecture.md` §"Gaps vs Conductor's needs" (the eight numbered
gaps below map 1:1 to it), plus two layout gaps this analysis surfaced. **Companion:**
`pi-conductor-feature-matrix.md`.

Each gap is turned into an actionable item: **what is missing**, **why it matters for Conductor**,
and a **route** — one of:

- **(a) Conductor-only, no Pi change** — buildable entirely as a Conductor `extensions/*` or
  `packages/*` module on Pi's existing primitives. Pi stays untouched.
- **(b) small, genuinely-upstreamable Pi API addition** — Pi lacks a *generic* seam that many
  embedders (not just Conductor) would want; propose it upstream per the plan's **§7.6 process**:
  ① open an issue → ② propose a *generic* API → ③ PR → ④ keep the patch isolated meanwhile →
  ⑤ document the divergence → ⑥ add a compatibility test → ⑦ remove the patch once upstream adopts.
  The API sketch is given.
- **(c) Conductor-only forever** — a governance/knowledge concept Pi will never own (gates,
  Library/Diary). No upstream, no Pi primitive gap; listed so nobody goes looking for one.

The plan's own bias-guard (`gate1-discovery.md` §1.5, *The Mom Test*): the point of this list is to
name what Pi **does not** do and what routing around it costs — not to confirm the adopt-Pi thesis.

---

## Gap 1 — No permission / policy engine

**Missing.** Pi ships *zero* built-in filesystem/process/network/credential restriction — stated
outright, and framed as intentional: *"Pi does not include a built-in permission system…"*
(`README.md:37-45`, `security.md:31-37`; recon §9). No default-deny, no protected-paths config, no
risk classification. Project trust gates config/extension *loading*, **not** tool-call execution.

**Why it matters.** Fail-closed security (plan §3.3) is a non-negotiable domain rule
(`gate1-discovery.md` §4.1): every write/exec/network/security operation without an explicit policy
must be denied. This is the single largest thing Conductor adds over raw Pi.

**Route: (a) Conductor-only, no Pi change.** The `tool_call` extension hook is a *confirmed true
pre-execution gate* — fires before the tool runs, can `{ block: true, reason }` or mutate
`event.input` (`extensions.md:751-790`; recon §2). Conductor builds the whole engine on it: 5-level
model, default-deny posture, protected-paths matcher, egress events, allowlists, plus `ctx.ui.
confirm()` for approval (works in both TUI and RPC, recon §5). No Pi change is required — the
primitive is sufficient. Lands in `packages/policies` + `extensions/permission-gate` +
`extensions/protected-paths`.

**Caveat to verify in the PoC.** The hook does *"no re-validation after your mutation"* and later
handlers see earlier mutations (`extensions.md:751-790`); Conductor's gate must be the **last**
`tool_call` handler and must treat the hook chain order as security-relevant (an invariant test).

---

## Gap 2 — No risk / permission metadata field on the tool interface

**Missing.** `AgentTool` (`types.ts:379-403`) has no `risk`/`requiresApproval`/`readOnly` field;
grepped and confirmed absent (recon §3). Risk classification has to live in a Conductor-side table
keyed by tool name + argument inspection, *decoupled from the tool declaration*.

**Why it matters.** Plan §4.2 wants every tool to declare a `ToolPolicy` (`permission`, `risk`,
`requiresApproval`, `allowedRoots`, `timeout`, `redactOutput`). With no field to carry it, a
custom tool's risk and its code live apart — easy to drift, and invariant §10 #6 ("every tool
declares a permission") becomes a lint over a side-table instead of a property of the tool.

**Route: (b) small, genuinely-upstreamable Pi API addition.** This is the cleanest upstream
candidate: an *optional, generic* metadata bag on the tool interface that Pi treats as opaque and
merely surfaces to hooks — useful to *any* embedder building approvals, not just Conductor.

```ts
// Proposed generic addition to Tool / AgentTool (packages/agent/src/types.ts)
export interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  // ...existing fields...
  /** Opaque, embedder-defined metadata. Pi does not interpret it; it is passed
   *  through verbatim on the tool_call event so permission/approval extensions
   *  can read a tool's declared posture without a name-keyed side table. */
  metadata?: Readonly<Record<string, unknown>>;
}
// and on the tool_call event context: expose event.tool.metadata to handlers.
```

Pi stays policy-agnostic (consistent with its stated design); Conductor puts its `ToolPolicy` in
`metadata` and reads it in the permission gate. **§7.6 process** applies: open the issue framing it
as "pass-through tool metadata for approval extensions", PR the ~15-line change, and until it lands,
Conductor keeps the side-table (route-(a) fallback) behind the same interface so removal is a no-op.
**Not a blocker** — (a) works today; (b) is a quality improvement.

---

## Gap 3 — No role / gate state machine

**Missing.** Pi has no concept of gates, phases, roles, or a governed workflow — a flat
extension-event/hook system only (recon §9, gap #3).

**Why it matters.** The 14-gate flow, per-gate recall→ground→delegate→record→halt protocol, and the
37 roles are the *entire product* (`gate1-discovery.md` §1.1). This is not a Pi shortfall to route
around; it is the layer Pi is deliberately not.

**Route: (c) Conductor-only forever.** Built as `packages/gates` + `packages/roles` +
`extensions/gate-controller`, using `pi.registerCommand()`, the lifecycle hooks, and `ctx.ui.
confirm()` as primitives. Pi will never own gates/roles and should not; no upstream, no API request.

---

## Gap 4 — No "model role" abstraction

**Missing.** Pi has *thinking levels* (`off…max`) but no named-tier/role concept. `scopedModels` is
a user-facing candidate pool, not a semantic per-gate role→model mapping (`models.md:257-298`,
`sdk.md:391-397`; recon §7, gap #4).

**Why it matters.** Conductor's gate→tier routing (strategic/standard/lightweight → `@plan`/
`@default`/`@slow`/`@smol`) and the fail-closed rule for critical gates (plan §4.15, §10 #5/#16)
have no home in `pi-ai`.

**Route: (a) Conductor-only, no Pi change.** Pi exposes a `model_select` extension hook plus
`setModel()`/`scopedModels` (recon §2, §7) — enough seam to build the router entirely Conductor-
side: a role→tier config table, a gate→role→pool→availability resolver, and the `model_select` hook
(or a pre-turn `setModel()`) to pick per gate. `scopedModels` is reused as the *candidate pool* per
role. Lands in `extensions/model-router` + `packages/providers`. No Pi change — the role semantics
are Conductor's domain and correctly do not belong in a generic provider layer.

---

## Gap 5 — No evidence / checkpoint / journal model beyond raw session entries

**Missing.** Pi's `custom` session entries (`pi.appendEntry()`) and labels are generic, low-level
persistence primitives — no built-in concept of "gate decision", "citation", "accepted risk", or
"evidence" (recon §4, gap #5).

**Why it matters.** "Evidence before conclusion" (plan §3.4) and the Diary's decision/risk/approval
records are core Conductor semantics; a gate closes on verifiable artifacts, never on model text.

**Route: (c) Conductor-only forever — on a Pi (a)-grade substrate.** The *schema* and its query/
report layer are Conductor's and Pi will never own them. But they sit **on** a perfectly adequate Pi
primitive (`appendEntry()` + labels + the append-only tree), so no Pi change is needed. Lands in
`packages/gates` (evidence), `packages/memory` (Diary). Listed as (c) so nobody proposes upstreaming
a "gate evidence" type to Pi — it would be wrong for Pi's scope.

---

## Gap 6 — No durable, resumable, crash-safe multi-turn engine, today  ⚠️ HIGHEST-RISK

**Missing.** The one Pi subsystem designed for exactly this — `AgentHarness` v2 (lanes + durable
operation-log + crash recovery) — has **all** operational methods stubbed to reject with
`HarnessNotImplemented` (`agent-harness.ts:360-464`), and its CHANGELOG marks it pre-release with
breaking changes and *removed* legacy repo APIs (recon §0, §4, gap #6). The stable alternative
(`Agent`/`AgentSession` + JSONL `SessionManager`) is fork/branch/resume-capable **today** but lacks
the lane/durable-log/crash-recovery guarantees.

**Why it matters.** Conductor's checkpoint, resume, autonomous-mode recovery, gate-evidence
persistence, and session-tree management (rows 9/10/17/19 of the matrix) all sit on the session/
durability foundation. This is a **structural dependency choice that is hard to reverse** — exactly
the ADR-worthy, quality-attribute-shaping decision `gate1-discovery.md` §1.3 flagged.

**Route: (a) Conductor-only now + adopt-upstream-later — NOT (b).** Do **not** propose an upstream
API here: Pi is *already building* the durable engine; the right move is not to hand Pi a design but
to (i) build the MVP durable/checkpoint layer on the **stable** `Agent`/`AgentSession`+JSONL surface,
(ii) put it **behind a Conductor-owned port / anti-corruption adapter** (`packages/sessions`) so the
engine is swappable, and (iii) track `AgentHarness` v2 upstream and migrate the adapter to it once it
ships and stabilizes. The §7.6 discipline still applies to the *tracking* (compatibility test against
the harness API as it firms up; documented divergence), but the deliverable is a Conductor adapter,
not a Pi PR.

**Why this is the highest-risk gap to get wrong.** The tempting failure is to build Conductor's
persistence/checkpoint/evidence foundation *directly against `AgentHarness` v2* because it is
literally designed for Conductor's shape — and it is non-functional and moving. That single wrong bet
would couple the product's core to a stubbed, breaking, pre-release interface and simultaneously
poison rows 9, 10, 17, and 19; unwinding it later is a rewrite, and staying on it is a de-facto fork
of an unreleased API (the plan's §14 "upstream divergence / permanent fork" risks, both rated High).
The anti-corruption-adapter route above is what the Gate-4 grounding
(Architecture Boundaries §1.7; DDD §2.4 ACL; Object-Oriented Thinking §2.12 — *hide behind an
interface exactly where the implementation will change*) prescribes, and it is why row 10b is
classified **decline** in the matrix. Runner-up on the **severity** axis is Gap 1 (a fail-*open*
permission bug is catastrophic) — but its path is clear and well-supported; Gap 6's danger is that the
wrong path looks like the right one.

---

## Gap 7 — No automatic model / provider fallback

**Missing.** Pi retries the *same* model on transient errors (`set_auto_retry`), but documents no
cross-provider failover chain anywhere (`ai/README.md`, `providers.md`, `models.md`; recon §7,
gap #7).

**Why it matters.** Plan §4.15 wants graceful degradation ("if `@slow` is unavailable, fall back to
`@default`") — but constrained by tier floor, egress consent, tool-compat, context floor, cooldown,
budget, and data residency. That is a *policy*, not a transport feature.

**Route: (a) Conductor-only, no Pi change.** Build the fallback policy in `extensions/model-router`
on top of Pi's same-model retry + `setModel()`. Deliberately **not (b)**: a generic provider-
fallback in `pi-ai` could not carry Conductor's egress-consent / data-residency / tier-floor
constraints without importing Conductor's policy model, which would be wrong for a generic provider
layer. Keep it Conductor-side.

---

## Gap 8 — No production "drive Pi as a persistent multi-session service" transport

**Missing.** RPC mode (`pi --mode rpc`, JSON/stdio) is stable but **subprocess-per-session**
(recon §5). The `protocol`/`server`/`client` (CBOR) stack is designed to be the long-lived service
surface but is *"Experimental … may change or be removed without notice"*, and **Pi ships no default
`PiServerService` wiring `coding-agent` behavior into `PiServer`** — the consumer must implement the
whole service (`server/README.md:36-38`; recon §5, gap #8).

**Why it matters.** Only relevant *if* Conductor needs a long-lived multi-session daemon (many
concurrent demands in one process). The plan's headless/CI, RPC, and SDK modes (§4.8) are all served
today by RPC mode + SDK; a daemon is not an MVP requirement.

**Route: (b) upstreamable *if/when needed* — MVP is (a) via RPC mode.** For MVP, **decline** the
experimental stack and use RPC mode / SDK (compose; matrix row 18). If a persistent daemon becomes a
real requirement, the genuinely-upstreamable contribution is a **default `PiServerService`
implementation that adapts `coding-agent`'s `AgentSession` onto `PiServer`** — something every
would-be Pi-as-a-service embedder needs and Pi conspicuously lacks:

```ts
// Proposed upstream: a shipped default service (packages/server or a new packages/coding-agent-server)
export function createCodingAgentService(opts: {
  sessionManager: SessionManager;
  modelRuntime: ModelRuntime;
}): PiServerService; // implements listSessions/listModels/createSession/openSession
                     // by delegating to createAgentSession(), instead of every consumer re-writing it.
```

**§7.6 process** applies fully (issue → generic PR → isolated patch → compat test → remove on
adoption). But gate this behind an actual daemon requirement — it is premature for the MVP, whose
concurrency need is met by one RPC subprocess per demand.

---

## Additional gaps (not in the recon list — surfaced by the feature matrix)

These are **Conductor-internal plan omissions**, not Pi shortfalls — route **(c)**, no Pi concern.

- **A1 — No home in the §6 repo layout for the intelligence/adaptation layer** (matrix row 22). The
  plan describes the capability (§4.12) but the §6 package list has no `intelligence` package. Decide
  at Gate 4: fold into `packages/learning` (+ `packages/memory` for the knowledge graph) or add a
  package. No Pi impact.
- **A2 — No emitter package in the §6 layout for dual-harness emission** (matrix row 27). The
  product-critical emission capability (`gate1-discovery.md` §3) has no package in §6. Decide at
  Gate 4: keep the current Python emitter alongside the TS core, or add `packages/emit` that renders
  the canonical `content/` to `.claude/` / `AGENTS.md` / Cursor formats. Runtime-independent — **it
  must never be routed through Pi** (matrix row 27 = decline). No Pi impact.

---

## Summary — routing counts

| Route | Gaps |
|---|---|
| **(a) Conductor-only, no Pi change** | 1, 4, 6 (now-layer), 7 |
| **(b) upstreamable Pi API (with §7.6)** | 2 (tool metadata pass-through — clean, small, do it), 8 (default `PiServerService` — only if a daemon is needed) |
| **(c) Conductor-only forever** | 3, 5, A1, A2 |

**Read of the whole list:** only **one** gap (#2) is a small, clearly-worth-doing upstream
contribution; one more (#8) is upstreamable but premature. Everything else is either Conductor's own
governance domain (c) or buildable on Pi's existing hooks with no upstream dependency (a). That is a
healthy adopt-by-composition profile — it means the plan's "composition before fork" stance
(plan §3.2, §7.6) is achievable without a standing fork, **provided Gap 6 is handled with the
anti-corruption adapter and not by building on the stubbed `AgentHarness` v2.**
