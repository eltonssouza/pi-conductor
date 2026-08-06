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
import type { EffectivePolicyInput } from "./permission-engine.ts";
import { createPermissionGateExtension, type PermissionGateDecision } from "./permission-gate.ts";
import { ConductorResourceLoader, type Fase1ProjectConfig } from "./resource-loader.ts";
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
				approvalTimeoutMs: options.approvalTimeoutMs,
				onDecision: options.onDecision,
				policy: options.policy,
				yesFlagActive: options.yesFlagActive,
				extraExtensions: options.extraExtensions,
			}).pi
		: new DefaultResourceLoader({
				cwd: options.workspaceRoot,
				agentDir,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				extensionFactories: [
					createPermissionGateExtension({
						workspaceRoot: options.workspaceRoot,
						additionalProtectedPaths: mergedProtectedPaths,
						approvalTimeoutMs: options.approvalTimeoutMs,
						onDecision: options.onDecision,
						policy: options.policy,
						yesFlagActive: options.yesFlagActive,
					}),
					...(options.extraExtensions ?? []),
				],
			});
	await resourceLoader.reload();

	const sessionManager =
		options.sessionManager ?? SessionManager.create(options.workspaceRoot, join(agentDir, "sessions"));

	const customTools = options.customTools ?? [];

	const { session, extensionsResult }: CreateAgentSessionResult = await createAgentSession({
		cwd: options.workspaceRoot,
		agentDir,
		modelRuntime,
		model: options.model,
		tools: ["read", "write", "edit", "bash", ...customTools.map((tool) => tool.name)],
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
