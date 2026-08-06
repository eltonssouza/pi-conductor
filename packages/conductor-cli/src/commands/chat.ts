/**
 * `conductor chat` (docs/adr/0002-fase1-cli-foundation.md §7.4) -- the load-bearing command for
 * Fase 1's exit criterion: sessão persistente, prompt customizado, ferramentas básicas, TUI inicial
 * (plano_desenvolvimento.md §8).
 *
 * Composition root only -- each concern lives in its own testable module under `commands/chat/`:
 *   - session-resolution.ts: `.conductor/sessions/` scoping + `--resume` flag resolution.
 *   - tui-ui-context.ts: the real ExtensionUIContext adapter over `packages/tui` (T14 sanitization
 *     rendering, confirm/notify/status wired to a real TuiMainScreen).
 *   - status-line.ts: the five realistic §7.5 status fields, pure formatting.
 *   - transcript.ts: SessionEntry -> transcript line(s), reused for both resume-replay and live events.
 *   - theme.ts: minimal uncolored EditorTheme/SelectListTheme (see its own header for why).
 *
 * TUI pattern mirrored from `packages/coding-agent`'s own interactive mode
 * (src/modes/interactive/interactive-mode.ts): `TuiMainScreen` (preserves scrollback, matches
 * ADR §7.4's own choice over `TuiAltScreen`) + `Editor` for the input line + a `Container` transcript
 * + `session.bindExtensions({ uiContext, mode: "tui" })` + `session.subscribe(...)` for live events
 * (interactive-mode.ts:1801-1803, :3028-3032). Deliberately NOT the same scale: interactive-mode.ts
 * is ~5000 lines covering streaming deltas, markdown rendering, diffs, footers, and a dozen slash
 * commands none of which Fase 1's exit criterion asks for (ADR §7.4/§7.5). This file renders on
 * message/tool-call *completion* (`message_end`/`tool_execution_start`), not streaming deltas.
 *
 * `ModelRuntime` is built with Pi's global defaults (no `authPath`/`modelsPath` override) --
 * deliberately NOT scoped into `.conductor/` (ADR §5.2: credentials never live inside the project,
 * not even by accident of a convenience default). Only `agentDir` (-> `sessions/`) is scoped to
 * `.conductor/`, via the `sessionManager` `createConductorSession` already accepts separately.
 */

import {
	type ConductorConfig,
	ConfigNotFoundError,
	ConfigParseError,
	ConfigValidationError,
	type RoleRegistry,
	readConfig,
} from "@conductor/config";
import {
	createConductorSession,
	createSharedBudget,
	defaultProtectedPaths,
	type PermissionGateDecision,
} from "@conductor/runtime";
import type { Model } from "@earendil-works/pi-ai";
import { ModelRuntime, type SessionEntry, type SessionManager } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Editor,
	matchesKey,
	ProcessTerminal,
	type Terminal,
	Text,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { getGitStatus, resolveTimeoutMs } from "../git-status.ts";
import { resolveEffectivePolicy } from "./chat/policy-resolution.ts";
import {
	type ChatRole,
	describeUnknownChatRole,
	loadRealRoleRegistryAndSkills,
	ROOT_CALLER_ROLE_ID,
	resolveChatRoleFromRegistry,
	toTaskRoleRegistryView,
} from "./chat/role-resolution.ts";
import {
	parseResumeArgs,
	resolveConductorAgentDir,
	resolveConductorSessionsDir,
	resolveSessionManager,
	SessionNotFoundError,
} from "./chat/session-resolution.ts";
import { buildStatusLine } from "./chat/status-line.ts";
import { plainEditorTheme } from "./chat/theme.ts";
import { replayTranscript, summarizeEntryForTranscript } from "./chat/transcript.ts";
import { createConductorChatUiContext } from "./chat/tui-ui-context.ts";

const DEFAULT_CHAT_GIT_TIMEOUT_MS = 5000;
const EXIT_COMMANDS = new Set(["/exit", "/quit"]);

/**
 * Gate 6 real-wiring loop-back (Grupo G, ADR 0004 §5/§16 appendix): the ONE `SharedBudget` ceiling
 * for this `conductor chat` invocation's entire delegation tree (R16b -- constructed once, here, at
 * this composition root, never per-`task`-call). No `--task-budget` CLI flag exists yet (a real
 * follow-up, not invented speculatively here) -- this is a conservative, documented DEFAULT, not a
 * value the library prescribes: `SharedBudget` itself only has to be BOUNDED, never unbounded, to
 * satisfy the bulkhead reasoning `shared-budget.ts`'s own header already grounds (Stability Patterns
 * for Production / Release It! §3.3/§3.8/§3.12, "partition resources, shed the non-essential" --
 * `cdt library --gate 6`, top score 0.625); the library has no opinion on the exact token count, so
 * this number is an engineering judgment call, documented as one rather than left unexplained. Sized
 * at 50x `tools/task.ts`'s own `DEFAULT_TASK_TOKEN_ESTIMATE` (4_000) -- generous enough for a real
 * interactive session to delegate several non-trivial sub-tasks without hitting the ceiling
 * mid-conversation, while still finite (never `Infinity`/`Number.MAX_SAFE_INTEGER`, which would
 * defeat the whole point of a shared ceiling existing at all).
 */
const DEFAULT_CHAT_TASK_BUDGET_TOKENS = 200_000;

export interface ChatOptions {
	cwd: string;
	args: string[];
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
	/** Injectable for tests; defaults to a real ProcessTerminal (attached to the real process stdio). */
	terminal?: Terminal;
	/** Injectable for tests; defaults to the real global ModelRuntime (ADR §5.2: no `.conductor/`-scoped auth). */
	createModelRuntime?: () => Promise<ModelRuntime>;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The `--role <slug>` session-shape override (FR-20): a resolved role's `tools` REPLACES the
 * default allowlist outright and its `systemPrompt` REPLACES the Fase 1 config-derived one; omitted
 * entirely when no role was resolved (round A/B1's unrestricted shape, byte-for-byte unchanged).
 * Extracted as its own pure function so this mechanism is unit-testable directly against a
 * synthetic `ChatRole` with a non-empty `tools` list, independent of whether any REAL built-in role
 * currently declares one (none do today -- Gap 2's own finding, see role-resolution.ts's header) --
 * a test fixture standing in for a role's shape is not the "invent a tools list for a real role"
 * this phase's instructions warn against; it is the same test-double reasoning "Outside-In
 * Development" already grounds elsewhere in this codebase for isolating a mechanism from data nobody
 * has authored yet.
 */
export function buildRoleSessionOverrides(role: ChatRole | undefined): {
	toolsOverride?: string[];
	systemPromptOverride?: string;
} {
	return role !== undefined ? { toolsOverride: role.tools, systemPromptOverride: role.systemPrompt } : {};
}

function splitProviderModel(value: string): [string, string] {
	const slash = value.indexOf("/");
	if (slash === -1) return [value, ""];
	return [value.slice(0, slash), value.slice(slash + 1)];
}

async function defaultCreateModelRuntime(): Promise<ModelRuntime> {
	// No authPath/modelsPath override: chat resolves credentials from Pi's global defaults, exactly
	// like `doctor`'s own model-resolution check (ADR §5.2) -- never a `.conductor/`-scoped path.
	return ModelRuntime.create({ allowModelNetwork: false });
}

/** Everything needed to run the live TUI loop, gathered and validated before any terminal/UI object
 * is constructed -- kept separate from `runChat` so every failure path above this point can return a
 * clean exit code without ever touching a terminal. */
interface PreparedChat {
	config: ConductorConfig;
	model: Model<any>;
	modelRuntime: ModelRuntime;
	sessionManager: SessionManager;
	/** FR-19 (ADR 0003 §4): parsed fresh from this invocation's argv, never persisted. */
	yesFlagActive: boolean;
	/**
	 * `--role <slug>` (Fase 3, gate2-spec-fase3.md FR-1/FR-2): resolved here, one level up from
	 * `runChat`, so a bad role name fails prepareChat's own clean, terminal-free error path exactly
	 * like every other prepareChat failure (no `.conductor/config.json`, no matching model, ...) --
	 * never a session that starts anyway and then discovers the role doesn't exist. `undefined` when
	 * no `--role` flag was passed at all -- the unrestricted, round A/B1 session shape.
	 */
	role?: ChatRole;
	/**
	 * Gate 6 real-wiring loop-back: the REAL, file-backed Role Registry (`role-resolution.ts`'s
	 * `loadRealRoleRegistryAndSkills`), loaded exactly ONCE per invocation here and reused by
	 * `runChat` to build `task`'s `RoleRegistryView` -- regardless of whether `--role` was passed.
	 * `--role` resolution above and `task`'s own delegation authorization are two different consumers
	 * of the SAME registry snapshot, never two independent loads that could observe different on-disk
	 * state.
	 */
	roleRegistry: RoleRegistry;
	/**
	 * Gate 8 loop-back (G3/FR-5/FR-6): the real, contained (`filterSkillsWithinRoots`/R20) skill
	 * locations from the SAME scan that produced `roleRegistry` above -- `runChat` passes these
	 * straight through to `createConductorSession`'s `additionalSkillPaths` so a real `conductor chat`
	 * session actually has the 44 built-in skills (plus any project `.conductor/skills/`) available
	 * via Pi's own native progressive-disclosure mechanism, regardless of whether `--role` was passed.
	 */
	skillPaths: string[];
}

type PrepareResult = { ok: true; prepared: PreparedChat } | { ok: false; message: string };

async function prepareChat(options: ChatOptions): Promise<PrepareResult> {
	// argv parsing + --role resolution come FIRST, before any I/O (config read, model runtime
	// construction) -- both are pure/cheap, so a typo'd flag (an unrecognized argument, or a role id
	// that does not exist, FR-2) fails in microseconds rather than only after paying for a real
	// ModelRuntime.create() round trip (which, using Pi's global default credential paths when no
	// `createModelRuntime` override is supplied, can itself be slow/blocking) just to discover the
	// invocation was never going to proceed anyway.
	const parsedArgs = parseResumeArgs(options.args);
	if (!parsedArgs.ok) {
		return { ok: false, message: parsedArgs.error };
	}

	// Gate 6 real-wiring loop-back: loaded exactly ONCE per invocation, regardless of whether --role
	// was passed -- runChat reuses this same snapshot to build task's RoleRegistryView (Gap 1), and
	// --role resolution below is the OTHER consumer of it (never two independent loads that could
	// observe different on-disk state within the same invocation). Gate 8 loop-back (G3/FR-5/FR-6):
	// the same scan also produces the real, contained skill catalog runChat threads into
	// createConductorSession's additionalSkillPaths below.
	const { registry: roleRegistry, skillCatalog } = loadRealRoleRegistryAndSkills({ cwd: options.cwd });
	const skillPaths = skillCatalog.skills.map((skill) => skill.realPath);

	// --role <slug> (FR-1/FR-2): resolved before the session is ever opened -- an unknown role id is a
	// clean, terminal-free CLI error, never a session that starts anyway and only fails once the model
	// tries to act like a role that doesn't exist.
	let role: ChatRole | undefined;
	if (parsedArgs.roleId !== undefined) {
		const resolved = resolveChatRoleFromRegistry(roleRegistry, parsedArgs.roleId);
		if (resolved.status === "not-found") {
			return { ok: false, message: describeUnknownChatRole(resolved.roleId, roleRegistry, resolved.suggestion) };
		}
		// GAP 2 (orchestrator finding): NONE of the 37 real built-in roles declare a tools allowlist
		// yet (role-catalog.ts's own header) -- role.tools is `[]` for every one of them today. Silently
		// proceeding would open a real session with ZERO usable tools (not even `read`), which is a
		// confusing, effectively-broken command for any real role, not a security boundary anyone
		// intended. Fail closed WITH a clear, actionable signal instead (same "honest failure over a
		// silent, confusing bug" discipline the rest of this file already applies to every other
		// prepareChat failure) -- see role-resolution.ts's own header for why this is not "invent a
		// tools list to work around it".
		if (resolved.role.tools.length === 0) {
			return {
				ok: false,
				message:
					`conductor chat: role "${resolved.role.name}" does not declare a tools allowlist yet ` +
					"(no built-in role currently does -- an open, pending decision, see " +
					"src/commands/role-catalog.ts's header) -- refusing to start a session with zero usable " +
					"tools. Run `conductor chat` without --role.",
			};
		}
		role = resolved.role;
	}

	let config: ConductorConfig;
	try {
		config = readConfig(options.cwd);
	} catch (error) {
		if (error instanceof ConfigNotFoundError) {
			return {
				ok: false,
				message: "conductor chat: no .conductor/config.json found -- run `conductor init` first.",
			};
		}
		if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
			return { ok: false, message: `conductor chat: ${error.message}` };
		}
		return { ok: false, message: `conductor chat: could not read .conductor/config.json: ${describeError(error)}` };
	}

	let modelRuntime: ModelRuntime;
	try {
		modelRuntime = await (options.createModelRuntime ?? defaultCreateModelRuntime)();
	} catch (error) {
		return { ok: false, message: `conductor chat: could not initialize the model runtime: ${describeError(error)}` };
	}

	const [providerId, modelId] = splitProviderModel(config.provider.model);
	const model = modelRuntime.getModel(providerId, modelId);
	if (!model) {
		return {
			ok: false,
			message:
				`conductor chat: model "${config.provider.model}" was not found (provider "${providerId}"). ` +
				"Check `conductor config get provider.model`, or run `conductor doctor` to diagnose credentials.",
		};
	}

	const sessionsDir = resolveConductorSessionsDir(options.cwd);
	let sessionManager: SessionManager;
	try {
		sessionManager = await resolveSessionManager({
			workspaceRoot: options.cwd,
			sessionsDir,
			resume: parsedArgs.resume,
		});
	} catch (error) {
		if (error instanceof SessionNotFoundError) {
			return { ok: false, message: `conductor chat: ${error.message}` };
		}
		return { ok: false, message: `conductor chat: could not resolve the session: ${describeError(error)}` };
	}

	return {
		ok: true,
		prepared: {
			config,
			model,
			modelRuntime,
			sessionManager,
			yesFlagActive: parsedArgs.yesFlagActive,
			role,
			roleRegistry,
			skillPaths,
		},
	};
}

export async function runChat(options: ChatOptions): Promise<number> {
	const prepared = await prepareChat(options);
	if (!prepared.ok) {
		options.stderr.write(`${prepared.message}\n`);
		return 1;
	}
	const { config, model, modelRuntime, sessionManager, yesFlagActive, role, roleRegistry, skillPaths } =
		prepared.prepared;

	const agentDir = resolveConductorAgentDir(options.cwd);

	// GAP-B loop-back (Gate 8 finding): loadPolicyDocument/loadPolicyTrustStore/mergePolicies were
	// implemented and unit-tested but never called by any production path. `conductor chat` is that
	// call site -- see policy-resolution.ts's own header for why this composition lives here rather
	// than in @conductor/runtime.
	const policy = resolveEffectivePolicy(options.cwd);

	// --role <slug> (FR-1/FR-2, Fase 3): the role's own persona replaces the Fase 1 config-derived
	// system prompt, and its `tools` list REPLACES the round A/B1 default `["read","write","edit",
	// "bash"]` outright -- a role's `tools` is a closed allowlist (FR-20: "OBRIGATÓRIO ... nunca
	// 'undefined = tudo'"), not an addition to the default. `role.modelRole` selecting a concrete
	// model is an OPEN, DECLARED follow-up (same gap already named by the parallel Gate 6 task-tool
	// stream: "modelRole -> Model resolution ... no such registry exists anywhere in the codebase
	// yet"): this wiring does not invent one, so `model`/`config.provider.model` are left exactly as
	// resolved above regardless of `--role`.
	//
	// Gap 1 (orchestrator finding, Gate 6 real-wiring loop-back): `taskDelegation` was never built
	// here before -- `task` was implemented and unit-tested end to end, but no real `conductor chat`
	// invocation ever passed the collaborators `createConductorSession` requires to register it, so it
	// was reachable from NO real session. `callerRole` is the resolved `--role`'s own name when one was
	// given (its `canSpawn` list from the real, ported roles.py graph governs what it may delegate to);
	// otherwise it is `ROOT_CALLER_ROLE_ID`, the unrestricted top-level session's own identity (see
	// role-resolution.ts's header for the grounded reasoning on why that identity is not further
	// restricted by canSpawn the way a real, constrained role is).
	const callerRole = role !== undefined ? role.name : ROOT_CALLER_ROLE_ID;
	const sharedBudget = createSharedBudget(DEFAULT_CHAT_TASK_BUDGET_TOKENS);

	const decisions: PermissionGateDecision[] = [];
	const conductorSession = await createConductorSession({
		workspaceRoot: options.cwd,
		model,
		modelRuntime,
		agentDir,
		sessionManager,
		config,
		additionalProtectedPaths: config.workspace.additionalProtectedPaths,
		onDecision: (decision) => decisions.push(decision),
		policy,
		yesFlagActive,
		// Gate 8 loop-back (G3/FR-5/FR-6): the real, contained (R20) skill locations from
		// prepareChat's single scan -- see PreparedChat.skillPaths's own doc comment.
		additionalSkillPaths: skillPaths,
		taskDelegation: {
			roleRegistry: toTaskRoleRegistryView(roleRegistry),
			sharedBudget,
			callerRole,
		},
		...buildRoleSessionOverrides(role),
	});

	const terminal = options.terminal ?? new ProcessTerminal();
	const tui = new TuiMainScreen(terminal);
	const editor = new Editor(tui, plainEditorTheme);
	const transcript = new Container();
	const statusText = new Text("", 0, 0);

	tui.addChild(transcript);
	tui.addChild(statusText);
	tui.addChild(editor);
	tui.setFocus(editor);

	// "sessão persistente" done right (ADR §6/round B2 task): a resumed session's prior turns are
	// visible immediately, not just "a JSONL file exists on disk".
	for (const line of replayTranscript(sessionManager.getEntries())) {
		transcript.addChild(new Text(line));
	}

	const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });
	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "tui" });

	const protectedPathCount =
		defaultProtectedPaths(options.cwd).length + (config.workspace.additionalProtectedPaths?.length ?? 0);

	async function refreshStatus(): Promise<void> {
		const gitTimeout = resolveTimeoutMs(process.env.CONDUCTOR_CHAT_GIT_TIMEOUT_MS, DEFAULT_CHAT_GIT_TIMEOUT_MS);
		const git = await getGitStatus(options.cwd, gitTimeout);
		const stats = conductorSession.session.getSessionStats();
		ui.setStatus(
			"line",
			buildStatusLine({
				modelLabel: config.provider.model,
				git,
				totalTokensUsed: stats.tokens.total,
				contextUsage: conductorSession.session.getContextUsage(),
				protectedPathCount,
			}),
		);
	}
	await refreshStatus();

	// refreshStatus() spawns real `git` subprocesses (git-status.ts) with `cwd: options.cwd`.
	// Firing it without tracking the resulting promise would let a status refresh triggered by a
	// late event (the `finally` below, or agent_end/agent_settled) still be in flight -- an
	// unawaited child process -- at the moment `runChat` returns and the caller disposes the
	// session. On Windows this can hold the workspace directory's handle open long enough to break
	// an immediate cleanup (observed directly: a lingering `git` child process with `cwd` inside a
	// test's scratch directory blocked `rmSync` in test/commands/chat.test.ts until this was
	// tracked). `scheduleStatusRefresh` records the in-flight promise so shutdown can wait for it.
	let pendingStatusRefresh: Promise<void> = Promise.resolve();
	function scheduleStatusRefresh(): void {
		pendingStatusRefresh = refreshStatus().catch(() => {
			// Never let a background status refresh crash the session loop -- degrade silently for
			// this one refresh; the next one (after the next turn) tries again.
		});
	}

	let resolveExit: () => void = () => {};
	const exited = new Promise<void>((resolve) => {
		resolveExit = resolve;
	});

	function requestExit(): void {
		tui.stop();
		resolveExit();
	}

	const unsubscribe = conductorSession.session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			const syntheticEntry: SessionEntry = {
				type: "message",
				id: "",
				parentId: null,
				timestamp: new Date().toISOString(),
				message: event.message,
			} as SessionEntry;
			for (const line of summarizeEntryForTranscript(syntheticEntry)) {
				transcript.addChild(new Text(line));
			}
			tui.requestRender();
		} else if (event.type === "tool_execution_start") {
			transcript.addChild(new Text(`[running tool: ${event.toolName}]`));
			tui.requestRender();
		} else if (event.type === "agent_end" || event.type === "agent_settled") {
			scheduleStatusRefresh();
		}
	});

	editor.onSubmit = (text: string) => {
		const trimmed = text.trim();
		if (trimmed.length === 0) return;

		if (EXIT_COMMANDS.has(trimmed)) {
			requestExit();
			return;
		}

		editor.addToHistory?.(trimmed);
		editor.setText("");
		transcript.addChild(new Text(`> ${trimmed}`));
		editor.disableSubmit = true;
		tui.requestRender();

		conductorSession.session
			.prompt(trimmed)
			.catch((error: unknown) => {
				// Quality-baseline: an external call (the model provider) failing must degrade visibly,
				// never crash the whole TUI process or get silently swallowed.
				transcript.addChild(new Text(`[error] ${describeError(error)}`));
				tui.requestRender();
			})
			.finally(() => {
				editor.disableSubmit = false;
				scheduleStatusRefresh();
				tui.requestRender();
			});
	};

	tui.addInputListener((data) => {
		if (matchesKey(data, "ctrl+c")) {
			requestExit();
			return { consume: true };
		}
		return undefined;
	});

	tui.start();
	await exited;

	unsubscribe();
	await pendingStatusRefresh; // let any in-flight `git` subprocess finish before we dispose/return
	await terminal.drainInput();
	conductorSession.dispose();

	return 0;
}
