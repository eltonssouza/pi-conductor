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
import { createPermissionGateExtension, type PermissionGateDecision } from "./permission-gate.ts";

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

	const permissionGate = createPermissionGateExtension({
		workspaceRoot: options.workspaceRoot,
		additionalProtectedPaths: options.additionalProtectedPaths,
		approvalTimeoutMs: options.approvalTimeoutMs,
		onDecision: options.onDecision,
	});

	const resourceLoader = new DefaultResourceLoader({
		cwd: options.workspaceRoot,
		agentDir,
		// Gate 3 secure default (item 5, §7): no third-party extensions/skills/prompts/themes in
		// the Fase 0 TCB — only this first-party permission-gate extension (plus, in tests,
		// extraExtensions such as a scripted fake model provider) is ever loaded.
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [permissionGate, ...(options.extraExtensions ?? [])],
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
