/**
 * Full-chain integration test (docs/adr/0002-fase1-cli-foundation.md §7.4; gate3-fase1-addendum.md
 * T14) -- Gate 5/9. Proves the chain round B2 is responsible for, end to end, against a REAL
 * `TuiMainScreen` renderer:
 *
 *   ConductorResourceLoader -> real AgentSession (via @conductor/runtime's createConductorSession)
 *   -> the permission-gate's tool_call hook -> conductor-runtime's confirmOrDeny() (sanitizes at the
 *   sink) -> commands/chat/tui-ui-context.ts's confirm() -> a real SelectList/Text render through a
 *   real TuiMainScreen.
 *
 * Every prior test of this chain (conductor-runtime's acceptance.test.ts/resource-loader.test.ts)
 * used `test-ui.ts`'s fake `ExtensionUIContext` -- a plain object that records calls, never renders
 * anything. This is round B2's chance to prove T14's sanitizer survives contact with an actual
 * terminal-rendering pipeline, not just a string-equality assertion (the task's own framing).
 */

import { join } from "node:path";
import { createConductorSession } from "@conductor/runtime";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Container, Editor, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, expect, it } from "vitest";
import { plainEditorTheme } from "../../../src/commands/chat/theme.ts";
import { createConductorChatUiContext } from "../../../src/commands/chat/tui-ui-context.ts";
import { registerFakeModel } from "../../support/fake-model.ts";
import { FakeTerminal } from "../../support/fake-terminal.ts";
import { createScratchProject, type ScratchProject } from "../../support/scratch.ts";

// Generous default -- see commands/chat.test.ts's identical comment: real session/subprocess
// machinery slows down under full-suite concurrent load.
async function waitUntil(predicate: () => boolean, timeoutMs = 15_000, intervalMs = 10): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitUntil: condition never became true");
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

it("a malicious ANSI escape sequence embedded in a tool's bash command is stripped before it ever " +
	"reaches the real terminal renderer, while the plain-text payload still renders and the " +
	"approval decision still resolves correctly", async () => {
	const agentDir = join(project.root, ".conductor");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
	});

	// The payload: a plain-text marker plus a CSI "clear screen + home cursor" escape sequence --
	// exactly the class of attack T14 names (repositioning the cursor / clearing the line to hide
	// or forge what the human approver sees). If sanitization works, "TOTALLY-SAFE-LOOKING-TEXT"
	// survives as inert text but the raw "\x1b[2J\x1b[H" bytes never reach the terminal.
	const maliciousCommand = "echo hello\x1b[2J\x1b[HTOTALLY-SAFE-LOOKING-TEXT";

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "bash", args: { command: maliciousCommand } }] },
		{ text: "done" },
	]);

	const terminal = new FakeTerminal();
	const tui = new TuiMainScreen(terminal);
	const editor = new Editor(tui, plainEditorTheme);
	const transcript = new Container();
	const statusText = new Text("", 0, 0);
	tui.addChild(transcript);
	tui.addChild(statusText);
	tui.addChild(editor);
	tui.setFocus(editor);
	tui.start();

	const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

	const decisions: Array<{ toolName: string; allowed: boolean }> = [];

	const conductorSession = await createConductorSession({
		workspaceRoot: project.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir,
		config: {
			project: { type: "backend", technologies: [] },
			provider: { model: "conductor-fake/conductor-cli-fake-1" },
		},
		onDecision: (decision) => decisions.push(decision),
	});
	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "tui" });

	const promptDone = conductorSession.session.prompt("run the marked bash command");

	// Wait for the real overlay to actually appear (the permission-gate's confirmOrDeny() ->
	// tui-ui-context's confirm() -> showChoiceOverlay chain has run at this point).
	await waitUntil(() => tui.hasOverlay());
	await waitUntil(() => terminal.allWrites().includes("TOTALLY-SAFE-LOOKING-TEXT"));

	// --- The T14 proof ---
	const written = terminal.allWrites();
	expect(written).toContain("TOTALLY-SAFE-LOOKING-TEXT"); // plain text: preserved
	expect(written).toContain("echo hello"); // plain text: preserved
	expect(written).not.toContain("\x1b[2J"); // the injected clear-screen CSI sequence: stripped
	expect(written).not.toContain("\x1b[H"); // the injected cursor-home CSI sequence: stripped

	// --- The chain still functions correctly end to end: approve, and the gate records it ---
	terminal.sendInput("\r"); // Enter confirms the default (first) selection: Approve
	await promptDone;

	expect(fakeModel.callCount()).toBe(2);
	const bashDecision = decisions.find((d) => d.toolName === "bash");
	expect(bashDecision?.allowed).toBe(true);

	conductorSession.dispose();
	tui.stop();
}, 30_000);

it("denying through the real TUI (Down, Enter) blocks the tool call via the same chain", async () => {
	const agentDir = join(project.root, ".conductor");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "bash", args: { command: "echo should-not-run" } }] },
		{ text: "done" },
	]);

	const terminal = new FakeTerminal();
	const tui = new TuiMainScreen(terminal);
	const editor = new Editor(tui, plainEditorTheme);
	const transcript = new Container();
	const statusText = new Text("", 0, 0);
	tui.addChild(transcript);
	tui.addChild(statusText);
	tui.addChild(editor);
	tui.setFocus(editor);
	tui.start();

	const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });
	const decisions: Array<{ toolName: string; allowed: boolean }> = [];

	const conductorSession = await createConductorSession({
		workspaceRoot: project.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir,
		config: {
			project: { type: "backend", technologies: [] },
			provider: { model: "conductor-fake/conductor-cli-fake-1" },
		},
		onDecision: (decision) => decisions.push(decision),
	});
	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "tui" });

	const promptDone = conductorSession.session.prompt("run the command");
	await waitUntil(() => tui.hasOverlay());

	terminal.sendInput("\x1b[B"); // Down -> Deny
	terminal.sendInput("\r");
	await promptDone;

	const bashDecision = decisions.find((d) => d.toolName === "bash");
	expect(bashDecision?.allowed).toBe(false);

	conductorSession.dispose();
	tui.stop();
}, 30_000);
