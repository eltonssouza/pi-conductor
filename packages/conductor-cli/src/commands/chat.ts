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
	readConfig,
} from "@conductor/config";
import { createConductorSession, defaultProtectedPaths, type PermissionGateDecision } from "@conductor/runtime";
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
}

type PrepareResult = { ok: true; prepared: PreparedChat } | { ok: false; message: string };

async function prepareChat(options: ChatOptions): Promise<PrepareResult> {
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

	const parsedArgs = parseResumeArgs(options.args);
	if (!parsedArgs.ok) {
		return { ok: false, message: parsedArgs.error };
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
		prepared: { config, model, modelRuntime, sessionManager, yesFlagActive: parsedArgs.yesFlagActive },
	};
}

export async function runChat(options: ChatOptions): Promise<number> {
	const prepared = await prepareChat(options);
	if (!prepared.ok) {
		options.stderr.write(`${prepared.message}\n`);
		return 1;
	}
	const { config, model, modelRuntime, sessionManager, yesFlagActive } = prepared.prepared;

	const agentDir = resolveConductorAgentDir(options.cwd);

	// GAP-B loop-back (Gate 8 finding): loadPolicyDocument/loadPolicyTrustStore/mergePolicies were
	// implemented and unit-tested but never called by any production path. `conductor chat` is that
	// call site -- see policy-resolution.ts's own header for why this composition lives here rather
	// than in @conductor/runtime.
	const policy = resolveEffectivePolicy(options.cwd);

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
