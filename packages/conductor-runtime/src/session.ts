import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type CreateAgentSessionResult,
	createAgentSession,
	DefaultResourceLoader,
	type InlineExtension,
	ModelRuntime,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type AuditTrailWriter, createAuditTrailWriter } from "./audit-trail.ts";
import type { EffectivePolicyInput } from "./permission-engine.ts";
import { createPermissionGateExtension, type PermissionGateDecision } from "./permission-gate.ts";
import { ConductorResourceLoader, type Fase1ProjectConfig } from "./resource-loader.ts";
import type { SharedBudget } from "./shared-budget.ts";
import { createTaskTool, type RoleRegistryView } from "./tools/task.ts";
// Side-effecting import: installs the T29/R12c write-path redaction guard on SessionManager's shared
// prototype (see session-redaction-guard.ts's own header) before this module's createConductorSession()
// ever constructs a SessionManager below. This is the composition root for real (non-test) usage of
// this package -- conductor-cli's chat command reaches SessionManager only through here.
import "./session-redaction-guard.ts";

/**
 * Thin wiring for a Conductor-governed AgentSession (ADR 0001 §2: build against the stable
 * Agent/AgentSession surface, not AgentHarness v2).
 *
 * Loads exactly one extension by default: the first-party permission-gate. Per
 * gate3-threat-model.md §5 item 5 / §7, no third-party extensions/skills/prompts/themes are
 * discovered for the Fase 0 PoC (`noExtensions`/`noSkills`/... below) — allowlisting/sandboxing
 * of third-party packages is explicitly deferred to Fase 2. `extraExtensions` exists solely for
 * test infrastructure (e.g. registering a scripted fake model provider); production callers
 * should not pass it.
 *
 * Does NOT bind a UI context — callers must call `session.bindExtensions({ uiContext, mode })`
 * themselves (mirrors examples/sdk/13-session-runtime.ts). Until bound, `ctx.hasUI` is false and
 * the permission-gate's approval step fails closed (denies), which is the correct default: no
 * human channel, no approval.
 */

export interface CreateConductorSessionOptions {
	/** Absolute path to the workspace root. Must already exist. Never the real repo in tests. */
	workspaceRoot: string;
	model: Model<any>;
	modelRuntime?: ModelRuntime;
	sessionManager?: SessionManager;
	agentDir?: string;
	additionalProtectedPaths?: string[];
	approvalTimeoutMs?: number;
	/**
	 * Gate 8 loop-back (G3/FR-5/FR-6, gate2-spec-fase3.md Grupo C -- "progressive disclosure de
	 * skills"): directories (scanned recursively for `SKILL.md`, Pi's own `loadSkillsFromDir`
	 * convention) or individual skill files whose name+description+location should be available to
	 * this session via Pi's own native progressive-disclosure mechanism
	 * (`@earendil-works/pi-coding-agent`'s `formatSkillsForPrompt`/`skills.ts`: injects only
	 * name+description+`<location>` into the system prompt, instructs the model to use `read` for the
	 * full body -- see `resource-loader.ts`'s own header for why `noSkills: true` and this option are
	 * NOT in tension). This package never resolves its own built-in skills directory (ADR 0002 §3.1:
	 * `conductor-runtime` stays framework-agnostic, no dependency on `conductor-cli`'s
	 * `builtin-paths.ts`) -- the caller's own composition root (`conductor-cli`'s `chat.ts`, via
	 * `skill-catalog.ts`'s `loadBuiltinSkillCatalog`, already vetted through `filterSkillsWithinRoots`/
	 * R20) supplies the real, contained paths. Omitted or empty: byte-for-byte the same "zero skills"
	 * behavior every caller had before this loop-back.
	 */
	additionalSkillPaths?: string[];
	/** Test-only: extra inline extensions to load (e.g. a fake model provider registration). */
	extraExtensions?: InlineExtension[];
	/**
	 * Custom tools (e.g. Conductor-flavored tools such as conductor_note — see
	 * src/tools/conductor-note.ts) registered via the SDK's `customTools` option (recon
	 * `_recon-pi-architecture.md` §3 point 1). Each tool's name is automatically added to the
	 * active `tools` list alongside the four built-ins, so callers do not have to repeat every
	 * custom tool's name in a separate option (sdk.md:595's "include each custom ... tool name you
	 * want enabled" requirement — satisfied here so it can't be forgotten). Every custom tool still
	 * goes through the permission-gate exactly like the built-ins: it is the gate's job (see
	 * permission-gate.ts), not this wiring's, to decide whether a given tool name is allowed.
	 */
	customTools?: ToolDefinition[];
	onDecision?: (decision: PermissionGateDecision) => void;
	/**
	 * FR-3/FR-6/FR-7/FR-9/FR-10/FR-11/FR-23/FR-24 (ADR 0003 §5/§16, GAP-B loop-back): the merged,
	 * trust-checked `EffectivePolicy` for this workspace — loaded and merged by the caller (e.g.
	 * conductor-cli's `commands/chat/policy-resolution.ts`; this package cannot load
	 * `.conductor/policy.json` itself, ADR 0002 §3.1). `policy.protectedPaths` is unioned into
	 * `additionalProtectedPaths` below BEFORE either resourceLoader branch is built, so a policy.json
	 * restriction is enforced the same secure-by-default way `additionalProtectedPaths` already is —
	 * no caller of `createConductorSession` has to remember to do that split itself. The remaining
	 * fields (`allowlist`/`network`/`denyAllPrivileged`) are forwarded as-is to the permission-gate.
	 * Omitted entirely: behaves exactly like Fase 0/1 (no policy at all).
	 */
	policy?: EffectivePolicyInput;
	/**
	 * FR-19/FR-20/FR-21 (ADR 0003 §4, R8): forwarded to the permission-gate's own `--yes` handling.
	 * Defaults to `false` (`conductor chat` had no `--yes` flag before this loop-back closed FR-19..21).
	 */
	yesFlagActive?: boolean;
	/**
	 * When supplied, the resourceLoader is built through `ConductorResourceLoader` (resource-loader.ts,
	 * ADR 0002 §4) instead of the inline `DefaultResourceLoader` below, so the session's system prompt
	 * is the Fase 1 prompt built from real project config (ADR 0002 §7.4's "prompt customizado" exit
	 * criterion) -- `conductor chat` (round B2) is the first caller that needs this. Omitted by every
	 * other existing caller (round A's acceptance tests, conductor-cli's init/doctor/config, none of
	 * which open a live session with a custom prompt), which keeps this option's absence exactly
	 * equivalent to session.ts's behavior through round A/B1 -- additive, not a breaking change.
	 */
	config?: Fase1ProjectConfig;
	/**
	 * Restricts the session's own tool allowlist to exactly this list (plus whatever `customTools`
	 * contribute) instead of the round A/B1 default `["read", "write", "edit", "bash"]` -- the
	 * mechanism `conductor chat --role <slug>` uses to hold a role to its own declared `tools`
	 * (Fase 3, ADR 0004 §16 appendix `ConductorRole.tools`: "OBRIGATÓRIO ... nunca 'undefined = tudo'").
	 * Omitted entirely: every existing caller keeps the exact prior default, byte-for-byte.
	 */
	toolsOverride?: string[];
	/**
	 * Replaces the session's system prompt outright -- the mechanism `conductor chat --role <slug>`
	 * uses to make a role's own persona/`systemPrompt` the basis of the session, instead of
	 * `resource-loader.ts`'s Fase 1 `buildFase1SystemPrompt` (when `config` is set) or Pi's own
	 * default prompt (when it is not). Omitted entirely: both existing branches behave exactly as
	 * before.
	 */
	systemPromptOverride?: string;
	/**
	 * Registers the real `task` tool (Fase 3, ADR 0004 §2/§12; `tools/task.ts`'s `createTaskTool`) so
	 * this session can delegate to another Conductor role. Requires ALL of `roleRegistry`/
	 * `sharedBudget`/`callerRole` together -- `task` cannot function with only some of them (a
	 * registry with no shared budget could let a child spend unbounded tokens; a budget with no
	 * registry cannot resolve `canSpawn`/`tools` at all, ADR §5.2/§2.3's R16b). When this option is
	 * omitted, `task` is simply never added to the session's tools -- the same "additive, never a
	 * breaking change" contract every other optional field on this interface already keeps for every
	 * existing caller (round A/B1's acceptance tests, `init`/`doctor`/`config`, and `conductor chat`
	 * until its own composition root supplies these).
	 *
	 * INTEGRATION POINT (documented, not silently deferred): `roleRegistry` is the structural
	 * `RoleRegistryView` (`get`/`canSpawn`) `tools/task.ts` already defines -- `@conductor/runtime`
	 * deliberately never imports `@conductor/config`'s real Role Registry (ADR 0004 §12: "config ⊥
	 * runtime" preserved). The REAL, file-backed registry (37 roles ported from conductor-main's
	 * `roles.py`, split-trust via `RoleTrustStore`, validated acyclic via `delegation-graph.ts`) is a
	 * parallel Gate 6 stream in `@conductor/config` at the time this option was added -- a caller's own
	 * composition root (`@conductor/cli`'s `commands/chat.ts` / `role-resolution.ts`) is where that
	 * real registry gets built and threaded in here once that stream lands; this package never builds
	 * one itself.
	 */
	taskDelegation?: TaskDelegationOptions;
}

export interface TaskDelegationOptions {
	roleRegistry: RoleRegistryView;
	/** REQUIRED, never constructed by this function (R16b, ADR §5.2): the ONE `SharedBudget` for the
	 * whole delegation tree, supplied by the caller's own composition root. */
	sharedBudget: SharedBudget;
	/** The role currently running THIS session (the one whose model calls `task`). */
	callerRole: string;
	/** How many `task` levels already led to THIS session (0 for the user's own top-level session). */
	depth?: number;
	maxDepth?: number;
}

export interface ConductorSession {
	session: AgentSession;
	extensionsResult: CreateAgentSessionResult["extensionsResult"];
	dispose(): void;
}

export async function createConductorSession(options: CreateConductorSessionOptions): Promise<ConductorSession> {
	const agentDir = options.agentDir ?? join(options.workspaceRoot, ".conductor-agent");

	const modelRuntime =
		options.modelRuntime ??
		(await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		}));

	// FR-9/FR-10/BR-5 (GAP-B loop-back): a policy.json restriction is unioned into
	// additionalProtectedPaths here, ONCE, for whichever branch is taken below — the same
	// secure-by-default reasoning workspace-policy.ts's own defaultProtectedPaths() already applies
	// to its own fixed list ("cannot be omitted by a caller that forgets"). Harmless when
	// options.policy is absent: additionalProtectedPaths passes through unchanged.
	const mergedProtectedPaths = [
		...(options.additionalProtectedPaths ?? []),
		...(options.policy?.protectedPaths ?? []),
	];

	// FR-6/Gate 8 loop-back (Gate 4 decision, journal 2026-08-06): the `read` tool must be able to load
	// the body of any skill this session's system prompt already discloses by name+description+
	// `<location>` (FR-5) -- otherwise the model is instructed to do something it can never actually do
	// (Gate 8's second-pass finding: every one of the 44 built-in skills lives outside any user
	// workspaceRoot by construction, so every real `read` attempt was denied). Derived ONCE, here, from
	// the SAME `additionalSkillPaths` list already threaded to both resourceLoader branches below --
	// deliberately NOT a second, independently-settable option: `additionalSkillPaths` is already the
	// caller's own vetted (`filterSkillsWithinRoots`/R20-contained) list (see this option's own doc
	// comment above), so the roots of those entries ARE the extra read-allowance, never an invented
	// second source of truth. Only the `read` branch of the permission-gate ever consults this
	// (workspace-policy.ts's own doc comment on `additionalAllowedReadRoots`); write/edit/bash are
	// unaffected because neither branch below forwards it to anything but the read check.
	const additionalAllowedReadRoots = options.additionalSkillPaths ?? [];

	// R13/R14/T41 (ADR 0004 §2.2/§6/§8): constructed ONCE, explicitly, at this composition root --
	// the exact same default path `permission-gate.ts`'s own `createPermissionGateExtension` would
	// have built internally if left to its own default (`join(workspaceRoot, ".conductor",
	// "audit.jsonl")`), so every existing caller's behavior is byte-for-byte unchanged. Constructing
	// it here (rather than letting each branch below build its own) is what lets the SAME instance
	// also reach `createTaskTool` below when `taskDelegation` is supplied -- a delegation child's own
	// tool calls must land in the ONE audit trail this session's own gate already writes to, never a
	// second, unlinked writer that merely happens to point at the same file.
	const auditTrailWriter: AuditTrailWriter = createAuditTrailWriter(
		join(options.workspaceRoot, ".conductor", "audit.jsonl"),
	);

	// ADR 0002 §3.2/§4: when `config` is supplied, delegate resourceLoader construction to
	// ConductorResourceLoader (round B2's `conductor chat` wiring) so the Fase 1 system prompt is
	// injected. Otherwise, build the same inline DefaultResourceLoader this function has always
	// built (round A/B1 behavior, byte-for-byte unchanged) — no custom prompt, plain permission-gate.
	// Both branches produce the same secure defaults (Gate 3 item 5/§7): no third-party
	// extensions/skills/prompts/themes in the TCB, only the first-party permission-gate (plus, in
	// tests, extraExtensions such as a scripted fake model provider).
	const resourceLoader = options.config
		? new ConductorResourceLoader({
				workspaceRoot: options.workspaceRoot,
				agentDir,
				config: options.config,
				additionalProtectedPaths: mergedProtectedPaths,
				additionalAllowedReadRoots,
				approvalTimeoutMs: options.approvalTimeoutMs,
				onDecision: options.onDecision,
				policy: options.policy,
				yesFlagActive: options.yesFlagActive,
				extraExtensions: options.extraExtensions,
				auditTrailWriter,
				systemPromptOverride: options.systemPromptOverride,
				additionalSkillPaths: options.additionalSkillPaths,
			}).pi
		: new DefaultResourceLoader({
				cwd: options.workspaceRoot,
				agentDir,
				noExtensions: true,
				noSkills: true,
				// Gate 8 loop-back (G3/FR-5/FR-6): see this option's own doc comment above -- merged in
				// by the inner loader regardless of `noSkills` (resource-loader.ts's header explains why).
				additionalSkillPaths: options.additionalSkillPaths ?? [],
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				...(options.systemPromptOverride !== undefined
					? { systemPromptOverride: () => options.systemPromptOverride! }
					: {}),
				extensionFactories: [
					createPermissionGateExtension({
						workspaceRoot: options.workspaceRoot,
						additionalProtectedPaths: mergedProtectedPaths,
						additionalAllowedReadRoots,
						approvalTimeoutMs: options.approvalTimeoutMs,
						onDecision: options.onDecision,
						policy: options.policy,
						yesFlagActive: options.yesFlagActive,
						auditTrailWriter,
					}),
					...(options.extraExtensions ?? []),
				],
			});
	await resourceLoader.reload();

	const sessionManager =
		options.sessionManager ?? SessionManager.create(options.workspaceRoot, join(agentDir, "sessions"));

	// task (Fase 3, ADR 0004 §2/§12): registered ONLY when the caller supplied every collaborator
	// `createTaskTool` structurally needs (see `taskDelegation`'s own doc comment above for exactly
	// why partial wiring is refused rather than silently degraded). A fresh array, never a mutation of
	// `options.customTools` -- this function must not have an observable side effect on a value the
	// caller still owns.
	const customTools: ToolDefinition[] = [...(options.customTools ?? [])];
	if (options.taskDelegation) {
		customTools.push(
			createTaskTool({
				callerRole: options.taskDelegation.callerRole,
				depth: options.taskDelegation.depth,
				maxDepth: options.taskDelegation.maxDepth,
				roleRegistry: options.taskDelegation.roleRegistry,
				sharedBudget: options.taskDelegation.sharedBudget,
				workspaceRoot: options.workspaceRoot,
				effectivePolicy: options.policy ?? {},
				auditTrailWriter,
				additionalProtectedPaths: mergedProtectedPaths,
				yesFlagActive: options.yesFlagActive ?? false,
				// GAP-5 (quality-baseline, Fase 3 checkpoint): this SAME session's own already-resolved
				// `options.model` -- so every delegation child spawned from here inherits it by default,
				// instead of `createGovernedChildSessionSpawner` leaving the child's own `model` unset for
				// Pi's `findInitialModel` to auto-discover (and silently call) whatever provider happens to
				// have an API key present in the process environment. See tools/task.ts's
				// `SpawnChildSessionInput.model` doc comment for the full grounding.
				model: options.model,
			}),
		);
	}

	const baseTools = options.toolsOverride ?? ["read", "write", "edit", "bash"];

	const { session, extensionsResult }: CreateAgentSessionResult = await createAgentSession({
		cwd: options.workspaceRoot,
		agentDir,
		modelRuntime,
		model: options.model,
		tools: [...baseTools, ...customTools.map((tool) => tool.name)],
		customTools,
		resourceLoader,
		sessionManager,
	});

	return {
		session,
		extensionsResult,
		dispose: () => session.dispose(),
	};
}
