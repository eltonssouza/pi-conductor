# Pi architecture recon (for Conductor Gate 4)

Read-only technical recon of the Pi agent-harness monorepo (`C:\development\tools\pi`, branch
`feature/fase0-descoberta-arquitetural`), to inform the Gate 4 decision: rebuild Conductor's
Coding Agent on top of Pi as the runtime, adding Conductor's governance layer (roles, skills,
14-gate flow, memory, security policy) as `packages/conductor-*` extensions rather than forking
Pi's core. Facts only, with file citations. No adoption recommendation is made here.

---

## 0. Orientation facts

- Monorepo, npm workspaces, MIT license. Root `package.json:5-13` workspace globs:
  `packages/*`, `packages/session-backends/*`, plus four example-extension dirs under
  `packages/coding-agent/examples/extensions/*`.
- Packages actually present under `packages/`: `agent`, `ai`, `client`, `coding-agent`,
  `evals`, `protocol`, `server`, `tui`, and `session-backends/sqlite-node`
  (confirmed via `Glob packages/*/package.json` and `packages/session-backends/*/package.json`).
- `README.md:37-45` states plainly: **"Pi does not include a built-in permission system for
  restricting filesystem, process, network, or credential access. By default, it runs with the
  permissions of the user and process that launched it."** and points at
  `packages/coding-agent/docs/containerization.md` for three isolation patterns (Gondolin
  micro-VM, plain Docker, OpenShell).
- `AGENTS.md` is contributor/dev-workflow guidance (commit message format, test runner rules,
  gitflow-adjacent git hygiene for concurrent Pi sessions) — not relevant to the architecture
  questions, noted for completeness.
- `tui-plan.md` is an implementation-handoff design doc for a TUI alternate-screen layout system
  (VStack/HStack/ScrollView, wheel routing, image handling). Not decision-relevant to the SDK/
  extension/permission questions; skipped in depth.
- **Critical orientation finding** (drives most of the analysis below): the repo currently has
  **two separate, non-interchangeable "drive an agent" surfaces**:
  1. The **stable, working** one: `Agent` (package `agent`, i.e. `@earendil-works/pi-agent-core`)
     and `AgentSession`/`createAgentSession()` (package `coding-agent`). This is what the SDK
     docs, RPC mode, and the CLI actually run on today.
  2. The **in-progress, largely non-functional** one: `AgentHarness` v2
     (`packages/agent/src/harness/agent-harness.ts`), the subject of the 3165-line design doc
     `packages/agent/docs/harness-v2.md`. As of the branch's HEAD commit, `AgentHarness`'s
     operational methods (`prompt`, `steer`, `followUp`, `abort`, `resume`, `compact`,
     `navigateTree`, `skill`, `promptFromTemplate`, `nextRun`, `cancelQueued`, `recordUsage`,
     `createLane`) are **all stubs** that reject with `HarnessNotImplemented`
     (`packages/agent/src/harness/agent-harness.ts:360-464`, confirmed by grepping every call
     site of the internal `unavailable()` helper). Only read-only/config accessors work.

---

## 1. SDK / embeddable session control

**Working, documented today:** `createAgentSession()` in package `coding-agent`
(`@earendil-works/pi-coding-agent`), documented in full in
`packages/coding-agent/docs/sdk.md`.

```ts
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(), modelRuntime });
session.subscribe((event) => { ... });
await session.prompt("What files are in the current directory?");
```
(`packages/coding-agent/docs/sdk.md:16-34`)

`AgentSession` (the returned `session`) exposes (`packages/coding-agent/docs/sdk.md:66-112`):
- **Model selection**: `setModel(model)`, `cycleModel()`, `scopedModels` option; model resolution
  helpers `resolveCliModel()`/`resolveModelScopeWithDiagnostics()` (`sdk.md:367-429`).
- **Custom system prompt**: via `DefaultResourceLoader({ systemPromptOverride: () => "..." })`
  (`sdk.md:492-507`), or `--system-prompt`/`--append-system-prompt` CLI flags, or the
  `before_agent_start` extension hook which can rewrite the prompt per-turn
  (`packages/coding-agent/docs/extensions.md:521-556`).
- **Streaming output**: `session.subscribe(listener)` delivers `message_update` events with
  `assistantMessageEvent.type === "text_delta"` etc. (`sdk.md:262-328`).
- **Tool-call interception**: not on `AgentSession` itself — done via extensions
  (`pi.on("tool_call", ...)`, can return `{ block: true, reason }` and can mutate
  `event.input` in place) or via the lower-level `Agent` class's `beforeToolCall`/`afterToolCall`
  hooks (see Q2).
- **Cancellation**: `session.abort()` (`sdk.md:106-107`); also `ctx.signal` inside extension
  handlers for abort-aware nested async work (`extensions.md:991-1013`).
- **Session persistence/resume**: `SessionManager.inMemory()` / `.create(cwd)` /
  `.continueRecent(cwd)` / `.open(path)`, tree navigation (`getEntries/getTree/getPath/branch`),
  fork/clone via `AgentSessionRuntime.fork()` (`sdk.md:739-841`).

Underneath `AgentSession` is the lower-level `Agent` class from package `agent`
(`@earendil-works/pi-agent-core`), documented in `packages/agent/README.md`. This is the actual
stateful agent loop: `new Agent({ initialState, streamFn, beforeToolCall, afterToolCall,
shouldStopAfterTurn, ... })`, `agent.prompt()`, `agent.continue()`, `agent.steer()`,
`agent.followUp()`, `agent.abort()`, `agent.subscribe()` (`packages/agent/README.md:17-43,
176-243, 318-335`). This class is stable and is what `AgentSession` wraps.

**Not yet usable:** `AgentHarness` (durable multi-lane sessions, `prompt/steer/followUp/abort/
resume/compact/navigateTree` — see §0 and §4) is designed in
`packages/agent/docs/harness-v2.md` but its operational surface is stubbed
(`packages/agent/src/harness/agent-harness.ts:368-410`). The comparison point requested (Pi's
equivalent of Conductor's Python `AgentHost.say/begin_turn/build_context/call_model/run_tool/
spawn/set_gate`) is closest to `AgentHarness`'s *intended* design (lanes, hooks, effects — see
§4), but that design is not runnable yet. The **actually comparable, working** surface today is
`Agent`/`AgentSession`, which is a simpler single-thread prompt/tool loop with events and hooks,
not a durable multi-lane state machine.

---

## 2. Extension system

Extensions are TypeScript modules, one default-exported factory `(pi: ExtensionAPI) => void |
Promise<void>`, documented exhaustively in `packages/coding-agent/docs/extensions.md`. Loaded
via `jiti` (no separate compile step) from `~/.pi/agent/extensions/`, `.pi/extensions/`
(project, only after project trust), CLI `-e`/`--extension`, or settings.json `extensions`/
`packages` entries (`extensions.md:109-152`).

**Lifecycle hooks** (`extensions.md:273-931`): `project_trust`, `session_start/shutdown/
before_switch/before_fork`, `resources_discover`, `before_agent_start`, `agent_start/end/
settled`, `turn_start/end`, `message_start/update/end`, `context` (mutate messages pre-LLM-call),
`before_provider_headers`, `before_provider_request`, `after_provider_response`, `model_select`,
`thinking_level_select`, `tool_call`, `tool_result`, `user_bash`, `input`.

**Tool-call interception — confirmed, and it is a true pre-execution gate:**
```ts
pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    event.input.command = `source ~/.profile\n${event.input.command}`;       // modify
    if (event.input.command.includes("rm -rf"))
      return { block: true, reason: "Dangerous command" };                  // deny
  }
});
```
(`packages/coding-agent/docs/extensions.md:767-790`). Confirmed semantics
(`extensions.md:751-790`): fires *after* `tool_execution_start` but *before* the tool executes;
`event.input` is mutated in place and the mutation is used for the real execution ("no
re-validation is performed after your mutation"); handler return value only controls blocking
(`{ block: true, reason? }`); multiple handlers chain, later ones see earlier mutations. The
extensions.md example section is literally titled "Permission gates (confirm before `rm -rf`,
`sudo`, etc.)" and "Path protection (block writes to `.env`, `node_modules/`)" as intended use
cases (`extensions.md:18-27`).

At the lower `Agent`-class level (package `agent`), the equivalent is the `beforeToolCall` hook
in `AgentOptions`: `beforeToolCall: async ({ toolCall, args, context }) => { if (...) return {
block: true, reason: "..." } }` (`packages/agent/README.md:213-218, 492-493`), and there is a
symmetric `afterToolCall` for post-execution result patching (can set `terminate: true`, patch
`details`, etc.) (`agent/README.md:220-228`).

At the not-yet-functional `AgentHarness` v2 layer, the intended design (per
`packages/agent/docs/harness-v2.md:1367-1394`) is a `before_tool` hook (`{ args?, block?: {
reason } }`) plus `after_tool` (patch semantics), with the important design property that hook
results are persisted into the durable record log *before* the effect proceeds — but this layer
is aspirational, not running code, as of this checkout (§0).

**Extension API interface**: `ExtensionAPI` — `pi.on()`, `pi.registerTool()`,
`pi.registerCommand()`, `pi.registerShortcut()`, `pi.registerFlag()`, `pi.registerProvider()`,
`pi.sendMessage()`/`pi.sendUserMessage()`, `pi.appendEntry()`, `pi.exec()`,
`pi.getActiveTools()/setActiveTools()`, `pi.events` (cross-extension bus). Full listing:
`extensions.md:1331-1844`. Types exported from `@earendil-works/pi-coding-agent`
(`ExtensionAPI`, `ExtensionContext`, `ExtensionCommandContext`) per `extensions.md` table of
contents and `sdk.md:1152-1205`.

---

## 3. Custom tools

Two entry points, same underlying shape:

1. **SDK-level**, via `defineTool()` passed as `customTools` to `createAgentSession()`
   (`packages/coding-agent/docs/sdk.md:565-597`):
   ```ts
   const myTool = defineTool({
     name: "my_tool", label: "My Tool", description: "...",
     parameters: Type.Object({ input: Type.String() }),
     execute: async (toolCallId, params) => ({ content: [...], details: {} }),
   });
   ```
2. **Extension-level**, via `pi.registerTool({...})` (`extensions.md:1921-1979`), same shape plus
   optional `promptSnippet`/`promptGuidelines` (system-prompt integration),
   `prepareArguments()` (legacy-arg compat shim), `renderCall`/`renderResult` (custom TUI
   rendering), and `terminate: true` on the result to end the tool-batch loop early.

**Canonical tool interface** — `AgentTool<TParameters, TDetails>` in
`packages/agent/src/types.ts:379-403`, extending the base `Tool<TParameters>` from `pi-ai`:

```ts
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (toolCallId: string, params: Static<TParameters>, signal?: AbortSignal,
            onUpdate?: AgentToolUpdateCallback<TDetails>) => Promise<AgentToolResult<TDetails>>;
  executionMode?: ToolExecutionMode;   // "sequential" | "parallel", per-tool override
}
```

**No built-in risk/permission/danger metadata field exists on the tool interface.** I grepped
`packages/agent/src/types.ts` for `risk|permission|dangerous|sandbox|approval` around the
`AgentTool`/`AgentToolResult` definitions and found nothing. The only "safety" field anywhere
near a tool declaration is `replay?: "never" | "safe"` on the (not-yet-functional) harness-v2
tool type (`harness-v2.md:1799-1806`), which is about *crash-recovery replay idempotency*, not
about permission/risk classification. Error signaling is: throw from `execute()` → tool result
gets `isError: true`; returning a value never sets the error flag regardless of content
(`extensions.md:1983-1995`).

Built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) can be overridden by
registering a same-named tool; execution and rendering override independently
(`extensions.md:2046-2077`). Concurrent-write safety for custom tools that mutate files is
provided by `withFileMutationQueue()`, keyed on resolved/realpathed absolute path
(`extensions.md:1891-1919`) — this is the one existing "shared mutation queue" primitive.

---

## 4. Session persistence & resume

**Backends that exist and are wired up today** (confirmed via workspace glob and package.json
inspection):
- **In-memory** (`Memory` in harness-v2 terms; `SessionManager.inMemory()` at the coding-agent
  level) — no persistence, reference implementation.
- **JSONL** — the current, working, documented format: one file per session under
  `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl`, tree-structured via `id`/`parentId`
  per line, versioned (v1 legacy linear → v2 tree → v3 `hookMessage`→`custom` rename), auto-
  migrated on load (`packages/coding-agent/docs/session-format.md:1-27`). This is what
  `SessionManager` (coding-agent) and `pi`'s CLI actually read/write today.
- **SQLite** — package `@earendil-works/pi-session-backend-sqlite-node`
  (`packages/session-backends/sqlite-node/package.json`), a *separate* package from `agent` core
  "so the core package does not pull in runtime builtins or native SQLite dependencies by
  default. The backend accepts a runtime-specific SQLite factory..." (`packages/agent/
  README.md:11-13`). This is part of the harness-v2 storage design (§ below), not the legacy
  coding-agent session format.

**Fork/branch/checkpoint support (working, at the coding-agent/JSONL level):** Sessions are a
tree via `id`/`parentId`; `/tree` navigates in place; `/fork` and `/clone` create new files or
branches; `SessionManager.branch(entryId)`, `branchWithSummary()`, `createBranchedSession()`
(`session-format.md:386-439`). Compaction entries (`CompactionEntry`) act as checkpoints —
newer ones embed `retainedTail` (materialized post-compaction context) so context can be rebuilt
without walking pre-compaction history (`session-format.md:229-249, 320-342`).

**Harness v2 design (§0: NOT yet functional) — what it *intends* to add:**
`packages/agent/docs/harness-v2.md` (3165 lines) designs a fundamentally different durable model:
a session tree (shared, append-only, passive) + named **lanes** (a lane = a git-branch-like
named position that can run one operation at a time; interactive Pi uses one lane called `main`;
a Slack bot would use one lane per thread) + a durable **operation log** per lane (intent-before-
effect / result-after-effect records, so a crash mid-operation is provably recoverable) + global
facts (`harness-v2.md:1-206`). It defines three storage-contract implementations: Memory, JSONL
(`JsonlSessionRepo`), and SQLite (`harness-v2.md:1629-1755`), all behind one `SessionStorage`
contract (`harness-v2.md:1573-1627`). Recovery/replay semantics (§6-7 of the doc) are extremely
detailed (per-record-type crash-site tables, `findOpenOperations()`, replay-safety per tool call,
etc.) — this is a serious, carefully specified design, but it is a **design document describing
work in progress**, not a description of shipped behavior.

**Evidence this is actively, recently in flux** (git log on this exact checkout, newest first):
```
c38319ea1 fix(agent): share state between memory and JSONL sessions
a5953d2e1 feat(agent): validate harness recovery record logs
1022a9e82 fix(agent): list SQLite sessions without writer claims (#7655)
e77e2b751 fix(agent): correct JSONL fork entry semantics
651d5d6a5 partial harness v2/json backend (#7611)
591f22a61 feat(agent): add indexed harness recovery queries (#7646)
...
1d0c97471 feat(agent): implement harness v2 for in-memory storage (#7503)
```
These are literally the two commits named in the task brief ("share state between memory and
JSONL sessions", "validate harness recovery record logs") and they are the **tip of the current
branch** (`git log --oneline -3` on `feature/fase0-descoberta-arquitetural` shows only one
unrelated contributor-approval commit ahead of them). `packages/agent/CHANGELOG.md` under
`## [Unreleased]` states outright: *"Added a compile-complete `AgentHarness` v2 scaffold;
unfinished operation paths reject with `HarnessNotImplemented` while durable execution is
implemented."* and *"Removed the legacy JSONL and in-memory repository APIs. `InMemorySessionRepo`
is the reference v4 repository; JSONL v4 support will use the new `SessionRepo` contract."* This
directly corroborates the code-level finding in §0: `AgentHarness.prompt/steer/followUp/abort/
resume/compact/navigateTree/skill/promptFromTemplate/nextRun/cancelQueued/recordUsage/createLane`
all reject with `HarnessNotImplemented` at `packages/agent/src/harness/agent-harness.ts:368-464`.

**Implication for a "fork controlled" decision:** the durable/lane/fork-and-resume story that
most closely matches what Conductor's `AgentHost` needs (multi-turn, resumable, checkpointed,
crash-safe sessions with a clean effects boundary) is being actively rebuilt in Pi core right
now, in a breaking (`## Breaking Changes`), pre-release way, and is not usable yet. Building
Conductor's persistence/checkpoint layer against `AgentHarness` today would mean building against
an interface documented as unstable and largely unimplemented. The stable alternative
(`Agent`/`AgentSession` + JSONL `SessionManager`) is fork/branch/resume-capable today but lacks
the lane/durable-operation-log/crash-recovery guarantees the harness-v2 doc targets.

---

## 5. RPC / external control

Two independent transports exist, at different layers of maturity:

**A. RPC mode (`coding-agent`), stable and documented** —
`packages/coding-agent/docs/rpc.md`. Headless JSON-over-stdio:
```bash
pi --mode rpc [--no-session] [--session-dir <path>]
```
Framing: **strict JSONL, LF-only delimiter** — one JSON object per line on stdin (commands) and
stdout (responses + streamed events); explicitly warns that Node's `readline` is *not*
protocol-compliant because it also splits on `U+2028`/`U+2029` which can appear inside JSON
strings (`rpc.md:28-37`). Message shape: commands carry `{"type": "...", ...}` plus optional
`id` for correlation; responses are `{"type": "response", "command": "...", "success": bool,
"data"?, "error"?}`; events stream asynchronously and are not framed as responses
(`rpc.md:39-76`). Command surface: `prompt`/`steer`/`follow_up`/`abort`/`new_session`,
`get_state`/`get_messages`/`get_session_stats`, `set_model`/`cycle_model`/
`get_available_models`, `set_thinking_level`, `compact`/`set_auto_compaction`,
`bash`/`abort_bash`, `switch_session`/`fork`/`clone`/`get_entries`/`get_tree`,
`set_session_name`, `get_commands` (full list `rpc.md:39-830`). Also defines an **extension UI
sub-protocol** riding on the same channel (`extension_ui_request`/`extension_ui_response` for
`select`/`confirm`/`input`/`editor`/`notify`/`setStatus`/`setWidget`; `rpc.md:1144-1335`) — this
is the closest thing to a human-in-the-loop approval channel that exists in Pi today (see §9).
Also: `--mode json` (`packages/coding-agent/docs/json.md`) is a simpler one-way JSON-event-line
firehose for a single prompt/run, not a bidirectional command protocol.

**B. `packages/server` + `packages/protocol` + `packages/client` — experimental binary
protocol.** `packages/server/README.md:3` states outright: *"Experimental. This package is under
active development and may change or be removed without notice. Its APIs and behavior are not
yet stable."* Design: `packages/protocol/README.md` — a runtime-neutral, transport-neutral wire
format: 4-byte big-endian length prefix + one definite-length **CBOR** item (not JSON), a strict
RFC 8949 subset (`protocol/README.md:1-67`). `packages/server` exposes `PiServer`, composing
pluggable `PiServerListener`s (a `PiServerService` interface the *application* implements:
`listSessions/listModels/createSession/openSession`); ships a Unix-domain-socket listener
(`createUnixServer()`/`createUnixListener()`) but **"does not provide a standalone CLI or
coding-agent service. Applications supply the `PiServerService` implementation"**
(`server/README.md:36-38`). `packages/client`'s `PiClient` is the matching transport-neutral
client (`ByteTransport` abstraction; ships a Node/Bun Unix-socket transport as an explicit
subpath import `@earendil-works/pi-client/unix`) with session leases
(`acquireSession({mode:"exclusive"|"shared"})`), `subscribe()` for authoritative snapshots vs
`onEvent()` for transient progress (`packages/client/README.md`). This stack is clearly designed
to eventually be the "drive Pi as a service" surface, complete with a `pi-ai`↔protocol adapter
(`toProtocolModelMetadata()` etc., `server/README.md:44-48`), but per its own README it is
pre-stable and — unlike RPC mode — **there is no ready-made CLI entry point (`pi --mode
server`-style) that wires `coding-agent`'s actual agent behavior into `PiServer` today**; a
consumer has to supply the whole `PiServerService`.

**Net for Q5:** the production-ready external-control transport today is RPC mode
(`pi --mode rpc`, JSON/stdio). The CBOR/socket protocol stack (`protocol`/`server`/`client`) is a
second, more ambitious, explicitly experimental transport still being built out, architecturally
separate from RPC mode.

---

## 6. Skills / prompt templates

Pi has a **native, standards-based skill system**: `packages/coding-agent/docs/skills.md`.
Implements the public **Agent Skills standard** (agentskills.io) with one deliberate deviation —
Pi does not require a skill's `name` to match its parent directory, because "that standard
requirement is suboptimal for shared skill directories used across multiple agent harnesses"
(`skills.md:5-7, 143, 157`). A skill = a directory with `SKILL.md` (YAML frontmatter: `name`,
`description` required; optional `license`, `compatibility`, `metadata`, `allowed-tools`,
`disable-model-invocation`) plus arbitrary scripts/references/assets
(`skills.md:92-160`). Discovery locations mirror extensions: global (`~/.pi/agent/skills/`,
`~/.agents/skills/`), project (`.pi/skills/`, `.agents/skills/` walking up to repo root, only
after project trust), packages, settings.json, CLI `--skill` (`skills.md:20-41`). Mechanism is
**progressive disclosure**: only name+description are always in the system prompt (as XML per
the spec); the model uses `read` to load the full `SKILL.md` on demand, or a user/extension can
force it via `/skill:name` (`skills.md:64-90`). Pi explicitly documents cross-harness skill
interop: point `settings.json`'s `skills` array at `~/.claude/skills` or `~/.codex/skills` to
reuse Claude Code / Codex skills directly (`skills.md:43-62`) — i.e., Conductor's existing
`.claude/skills/` content is very likely directly loadable by Pi with zero translation, modulo
the frontmatter/description-length lint Pi applies (warns, doesn't block, except missing
`description` which is not loaded at all: `skills.md:176-189`).

**Prompt templates** are a separate, simpler mechanism: reusable Markdown files with `{{var}}`
placeholders, expanded on `/name` (`README.md` "Prompt Templates" section, and `sdk.md:710-737`
for the SDK override — `promptsOverride` on `DefaultResourceLoader`, or programmatic
`PromptTemplate` objects). This is closer to Conductor's slash-command layer than to its skills.

**Conclusion for Q6:** Conductor does **not** need to build a skill-loading mechanism from
scratch on top of raw system-prompt/tool-loading — Pi's skill system is a superset of what
Conductor would need (standards-conformant, progressive disclosure, cross-harness path aliasing)
and Conductor's own `.claude/skills/*/SKILL.md` files are plausibly reusable as-is via a
`skills` settings.json path entry, pending validation.

---

## 7. Model/provider abstraction (`packages/ai`)

`packages/ai/README.md` — `@earendil-works/pi-ai`, "Unified LLM API with provider collections,
automatic auth resolution, token and cost tracking." **~34 built-in providers** listed
(`ai/README.md:57-89`): OpenAI, Anthropic, Google/Vertex, Azure OpenAI, Amazon Bedrock, Mistral,
Groq, Cerebras, xAI, OpenRouter, Cloudflare (AI Gateway + Workers AI), Vercel AI Gateway,
DeepSeek, NVIDIA NIM, GitHub Copilot, OpenAI Codex, ZAI, MiniMax, Together AI, Baseten, Hugging
Face, Moonshot AI, OpenCode Zen/Go, Fireworks, Kimi, Xiaomi MiMo, Ant Ling, plus **any
OpenAI-compatible endpoint** (Ollama, vLLM, LM Studio) via config. Architecture: a **provider**
owns its model catalog + auth (API key or OAuth) + streaming behavior; internally, providers
share **API implementations** (wire protocols: `anthropic-messages`, `openai-completions`,
`openai-responses`, `google-generative-ai`) so most providers are thin config over a shared
transport (`ai/README.md:229-263`). A `Models` collection routes by `provider/modelId` and
resolves auth per-provider with a defined priority order: CLI flag → stored credential/OAuth →
env var → custom-provider key from `models.json` (`packages/coding-agent/docs/
providers.md:303-311`; the pi-ai-level order in `ai/README.md:323-355` is similar: runtime
override → `getAuth()` per-request explicit → stored → env).

**"Model role"/tier concept:** Pi has **thinking levels**, not a named-tier/role concept:
`off|minimal|low|medium|high|xhigh|max`, model-declared support via `thinkingLevelMap`
(`packages/coding-agent/docs/models.md:257-298`). There is **no first-class "strategic/standard/
lightweight" or named-role abstraction** anywhere in the provider layer. The closest analog is
**`scopedModels`**: a session-scoped allow-list of `{model, thinkingLevel?}` pairs resolved from
`--models` CLI patterns or `enabledModels` settings, used for `Ctrl+P` cycling
(`sdk.md:391-397`, `extensions.md:989`) — this is a *user-facing convenience list*, not a
semantic role mapping, and it's per-session/global, not per-gate.

**Fallback support:** No automatic cross-provider failover/fallback chain is documented anywhere
in `ai/README.md`, `providers.md`, or `models.md`. Retry exists but is same-model retry on
transient errors (`auto_retry_start/end` events, `set_auto_retry`, `rpc.md:426-451`), not
provider fallback. `Models.refresh()` deals with *catalog* freshness, not request-time fallback.

**How Conductor's per-gate model-role mapping (strategic/standard/lightweight → `@plan`/
`@default`/`@slow`/`@smol`) would plug in:** there is no existing seam for it. Conductor would
need to build its own mapping layer (e.g., a small config table + an extension/wrapper that
picks `model`+`thinkingLevel` per gate before calling `session.setModel()`/`pi.setModel()`), since
Pi's `Models` layer has no concept of "role" above the individual `provider/modelId:thinkingLevel`
tuple. `scopedModels`/`enabledModels` could be reused as the *candidate pool* per role, but the
role→pool assignment and the "pick from pool for this gate" logic is Conductor's to write.

Custom/local models and proxies are added via `~/.pi/agent/models.json` (declarative, per-provider,
supports `modelOverrides`, `samplingParams`, extensive OpenAI/Anthropic-compat flags —
`packages/coding-agent/docs/models.md`) or programmatically via `pi.registerProvider()`
(`extensions.md:1704-1843`) / `createProvider()` (`ai/README.md:987-1097`) for custom auth/
streaming.

---

## 8. CLI/TUI wiring (`coding-agent`, `tui`)

**Composition point:** `createAgentSession()` (see §1) is the single factory that wires model +
`ModelRuntime` (auth) + `SessionManager` (persistence) + tools (built-in allow-list, `customTools`,
extension-registered) + a `ResourceLoader` (extensions, skills, prompts, themes, context files)
into one `AgentSession`. The CLI itself (`pi` binary, `packages/coding-agent/package.json:9-11`
→ `dist/cli.js`) then hands that session to one of four **run modes**
(`packages/coding-agent/README.md:19, 458-489`; SDK exports documented in `sdk.md:1016-1140`):

| Mode | Entry | Output |
|---|---|---|
| Interactive (default) | `InteractiveMode` (SDK class) | Full TUI (package `tui`) |
| Print | `runPrintMode(runtime, { mode: "text", ... })` | Plain text, one-shot, exits after |
| JSON | `--mode json` | JSON-lines event firehose, one-way (`docs/json.md`) |
| RPC | `runRpcMode(runtime)` / `pi --mode rpc` | Bidirectional JSON/stdio (`docs/rpc.md`) |

`--mode json` and `-p`/`--print` are exactly the **"headless, non-interactive, machine-
parseable"** modes the recon asked about — `-p "prompt"` prints the final response and exits
(supports piped stdin: `cat README.md | pi -p "Summarize this text"`,
`coding-agent/README.md:547-550`); `--mode json` streams every internal event as one JSON object
per line (`json.md:1-91`). Neither is literally spelled `--plain --json`, but `-p` (plain,
non-interactive) and `--mode json` (structured) are the two flags that jointly cover that need,
and they can be combined conceptually (`-p` for one-shot plain text vs `--mode json` for
structured event stream — they are alternative output modes, not stackable flags).

The TUI package (`packages/tui`, `@earendil-works/pi-tui`) is a standalone, general-purpose
terminal-UI framework — differential rendering, `TuiMainScreen` (scrollback-preserving) vs
`TuiAltScreen` (fixed-viewport with app-owned scrolling, `VStack`/`HStack`/`ScrollView` layout
primitives, in-flux per `tui-plan.md`), synchronized-output (CSI 2026) flicker-free rendering,
Kitty/iTerm2 inline images, IME-aware focus handling (`packages/tui/README.md`). It is
consumed by `InteractiveMode` in `coding-agent` but has no coding-agent-specific coupling — it
could in principle be reused for a Conductor-specific TUI surface (e.g., gate-approval prompts)
independent of Pi's own interactive mode.

---

## 9. Built-in permission model — confirming the gap

Read `packages/coding-agent/docs/security.md` and `packages/coding-agent/docs/
containerization.md` in full, in addition to the README pointer.

**What is NOT there (confirmed explicitly, not just by absence):**
- **No sandbox.** `security.md:31-37`: *"Pi does not include a built-in sandbox. Built-in tools
  can read files, write files, edit files, and run shell commands with the permissions of the pi
  process. Extensions ... run with the same permissions."* Explicitly framed as an intentional
  design choice, not an oversight: *"A partial in-process sandbox would be easy to misunderstand
  as a security boundary while still depending on the host shell, filesystem, package managers,
  credentials, and extension code. Real isolation needs to come from the operating system or a
  virtualization/container boundary."*
- **Project trust is not a runtime permission gate.** `security.md:5-29`: "Project trust controls
  whether pi loads project-local settings, resources, packages, and extensions. **It is not a
  sandbox and it does not restrict what the model can ask tools to do** after you start working
  in a directory." It only gates whether `.pi/settings.json`, `.pi/extensions`, `.pi/skills`,
  `.pi/SYSTEM.md`, etc. are loaded at startup — a supply-chain/config-injection guard, not an
  in-session tool-call permission system.
- **Prompt injection is explicitly out of scope**: *"Prompt injection from repository files,
  comments, documentation, context files, or build output is expected local-agent risk and
  cannot be reliably prevented by pi."* (`security.md:37`). Also stated in the Security Policy
  framing (`security.md:59`): expected local-agent behavior, lack of sandbox, and extension/skill
  behavior are "generally outside the security boundary."
- **No CVE/vuln-report path for "the agent did what a local user could already do."**
  (`security.md:59`) — again reinforcing that permission enforcement is explicitly pushed to the
  embedder.

**What IS there, today, as building blocks (none of them is itself a permission system):**
- The `tool_call` extension hook (§2) — a genuine pre-execution intercept point with
  block/modify capability, sequential-preflight ordering guarantee, and explicit worked examples
  for exactly the permission-gate use case ("confirm before `rm -rf`, `sudo`", "block writes to
  `.env`, `node_modules/`") (`extensions.md:18-27, 751-790`). This is a **primitive an embedder
  can build a permission system out of**, not a permission system itself — there's no policy
  language, no protected-paths config, no default-deny posture; you write the `if` statements.
- `ctx.ui.confirm()`/`select()`/`input()` — a genuine, working **confirmation/approval prompt
  mechanism**, but it is opt-in per extension call site, not a framework-enforced gate. It works
  in TUI mode directly and in RPC mode via the `extension_ui_request`/`extension_ui_response`
  sub-protocol (§5; `rpc.md:1144-1335`), including a `timeout` with auto-resolve default — so a
  headless/RPC-driven Conductor *can* surface a real human-approval prompt through this channel,
  but again, only where an extension author chose to call it.
- Project trust (`security.md:5-29`, also `coding-agent/README.md:295-307`) — a load-time,
  directory-scoped, persisted (`~/.pi/agent/trust.json`) yes/no/ask decision, overridable via
  `--approve`/`--no-approve`, and interceptable by extensions via the `project_trust` event
  (first user/global or CLI extension to return `yes`/`no` wins). Governs config/extension/skill
  *loading*, not tool-call execution.
- **Containerization patterns** (`containerization.md`, full read): three documented patterns,
  none built into Pi itself, all external-boundary:
  1. **Gondolin extension** — keeps `pi` + provider auth on the host, routes built-in tools
     (`read/write/edit/bash/grep/find/ls`) and `!` shell commands into a local Linux micro-VM via
     an example extension (`examples/extensions/gondolin`); requires Node ≥23.6 + QEMU.
  2. **Plain Docker** — runs the whole `pi` process in a container; simplest; provider API keys
     enter the container; example `Dockerfile.pi` given in full.
  3. **OpenShell** — runs the whole `pi` process in an NVIDIA OpenShell policy-controlled sandbox
     (filesystem/process/network/credential/inference controls) via a gateway (local
     Docker/Podman/VM or remote Kubernetes); can keep raw provider API keys **outside** the
     sandbox via an inference-routing proxy (`https://inference.local`).

**Net for Q9:** the README's claim is confirmed precisely and is not exaggerated — there is
zero built-in filesystem/process/network/credential restriction, and the one thing that could be
mistaken for a permission system (project trust) explicitly is not one. The one primitive
confirmation/approval mechanism that does exist (`ctx.ui.confirm`, wired through both TUI and RPC
transports) is real and reusable, but it is a UI primitive an extension calls, not a policy
engine that intercepts by default.

---

## 10. Package/workspace conventions

Confirmed directly from root `package.json:2-13`:
```json
{
  "name": "pi-monorepo",
  "workspaces": [
    "packages/*",
    "packages/session-backends/*",
    "packages/coding-agent/examples/extensions/with-deps",
    "packages/coding-agent/examples/extensions/custom-provider-anthropic",
    "packages/coding-agent/examples/extensions/custom-provider-gitlab-duo",
    "packages/coding-agent/examples/extensions/sandbox",
    "packages/coding-agent/examples/extensions/gondolin"
  ]
}
```
The operative glob for new packages is plain `packages/*` — any new directory
`packages/<name>/` containing its own `package.json` is automatically picked up as an npm
workspace member, with no changes needed to the root manifest, matching how
`packages/session-backends/sqlite-node` already exists as a workspace member one level deeper
(covered by the separate `packages/session-backends/*` glob entry). Each existing package
follows the same shape: its own `package.json` (with `name: "@earendil-works/pi-<name>"`,
independent `scripts.build/test/clean`, pinned `engines.node: ">=22.19.0"`), a `README.md`, and
(for `coding-agent`) a `docs/` subfolder plus `CHANGELOG.md` under an `## [Unreleased]` header
per package (`AGENTS.md:105-115`). The root `npm run build` script
(`package.json:16`) is an explicit ordered chain (`tui → ai → agent → session-backends/sqlite-
node → protocol → client → server → coding-agent`) reflecting the actual dependency graph; a new
`packages/conductor-*` package would need to be appended to that chain only if other packages
depend on it at build time — a leaf package (e.g., a Conductor extension bundle with no other
in-repo consumers) would not need to touch it. Versioning is **lockstep**: "all packages share
one version; every release updates all together" (`AGENTS.md:123`) — a new sibling package
would either need to opt into that lockstep release flow or be excluded from `scripts/
release.mjs`/`version:*` scripts (not inspected in this recon).

This confirms new `conductor-*` packages can be added as pure siblings under `packages/` without
editing any existing Pi package, satisfying the "extension not fork" structural requirement at
the workspace level — orthogonal to whether the *code* inside those packages ends up depending
on the stable `Agent`/`AgentSession` surface or the unstable `AgentHarness` surface (§1, §4).

---

## Gaps vs Conductor's needs

Concrete list of what Pi does **not** provide, that Conductor's plan (permission engine,
protected paths, role/gate state machine, evidence/checkpoint model) would have to add itself,
built on Pi's primitives:

1. **No permission/policy engine at all** (§9). No default-deny posture, no protected-paths
   config, no risk classification on tools. Conductor's protected-paths / permission-gate layer
   is 100% new code on top of the `tool_call` (extension) / `beforeToolCall` (Agent-class) hooks.
2. **No risk/permission metadata field on the tool interface** (§3). `AgentTool` has no
   `dangerous`/`requiresApproval`/`readOnly` field; any risk classification has to live in
   Conductor's own tool registry/wrapper, keyed by tool name + arg inspection, not declared
   alongside the tool.
3. **No role/gate state machine.** Pi has no concept of gates, phases, or a governed workflow —
   it has a flat extension-event/hook system. Conductor's 14-gate flow, per-gate checkpointing,
   and "halt and ask for approval" protocol are entirely Conductor's to build, most naturally as
   an extension that uses `pi.registerCommand()`/hooks/`ctx.ui.confirm()` as primitives.
4. **No "model role" abstraction** (§7). Conductor's strategic/standard/lightweight →
   `@plan/@default/@slow/@smol` mapping has no home in `pi-ai`; `scopedModels` is the closest
   reusable primitive (a candidate pool), but the per-gate selection policy is new code.
5. **No evidence/checkpoint/journal model beyond raw session entries.** Pi's `custom` session
   entries (`pi.appendEntry()`) and labels (`pi.setLabel()`) are generic, low-level persistence
   primitives (§4, session-format.md) — they are a reasonable *substrate* for Conductor's journal/
   evidence records, but there is no built-in concept of "gate decision," "citation," or
   "accepted risk" — that schema and its query/report layer is Conductor's to define.
6. **No durable, resumable, crash-safe multi-turn execution engine, today.** The one Pi subsystem
   designed to give exactly this (`AgentHarness` v2, lanes, durable operation log) is mid-rebuild
   and its operational methods are stubbed (§0, §4). Conductor cannot build against it as a
   dependency yet without accepting a moving, currently-non-functional target; the stable
   `Agent`/`AgentSession` layer lacks the lane/durable-log/checkpoint guarantees but works today.
7. **No automatic model/provider fallback** (§7) — if Conductor's flow depends on graceful
   degradation across providers (e.g., "if `@slow` is unavailable, fall back to `@default`"),
   that retry/fallback policy must be written by Conductor; Pi only retries the *same* model on
   transient errors.
8. **No production-ready "drive Pi as a persistent service" transport with a built-in
   coding-agent implementation.** RPC mode (stdio, one process per session) is stable but is a
   subprocess-per-session model, not a long-lived multi-session service. The
   `protocol`/`server`/`client` stack is designed for that but is explicitly experimental and
   requires the consumer to implement `PiServerService` themselves — Pi ships no default
   implementation wiring `coding-agent` behavior into `PiServer` (§5).
