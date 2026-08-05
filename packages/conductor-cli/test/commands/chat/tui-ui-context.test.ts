/**
 * `commands/chat/tui-ui-context.ts` (docs/adr/0002-fase1-cli-foundation.md §7.4) -- Gate 5 (red
 * first). Drives the REAL `TuiMainScreen` + `Editor` + `SelectList` stack from `packages/tui` behind
 * a recording `FakeTerminal` -- this is round B2's proof that T14's sanitizer (already unit-tested
 * against a plain function in conductor-runtime/test/terminal-sanitize.test.ts) also renders
 * correctly through the real terminal renderer, not just the `test-ui.ts` fake every test used
 * through round B1.
 */

import { Container, Editor, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { plainEditorTheme } from "../../../src/commands/chat/theme.ts";
import { createConductorChatUiContext } from "../../../src/commands/chat/tui-ui-context.ts";
import { FakeTerminal } from "../../support/fake-terminal.ts";

async function waitUntil(predicate: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitUntil: condition never became true");
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

describe("createConductorChatUiContext", () => {
	let terminal: FakeTerminal;
	let tui: TuiMainScreen;
	let editor: Editor;
	let transcript: Container;
	let statusText: Text;

	beforeEach(() => {
		terminal = new FakeTerminal();
		tui = new TuiMainScreen(terminal);
		editor = new Editor(tui, plainEditorTheme);
		transcript = new Container();
		statusText = new Text("", 0, 0);
		tui.addChild(transcript);
		tui.addChild(statusText);
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
	});

	afterEach(() => {
		tui.stop();
	});

	it("confirm() shows a real overlay and resolves true when Approve is selected (Enter, default selection)", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		const pending = ui.confirm("Approve write?", "write hello.txt");
		await waitUntil(() => tui.hasOverlay());

		terminal.sendInput("\r"); // Enter confirms the default (first) selection: Approve

		expect(await pending).toBe(true);
		expect(tui.hasOverlay()).toBe(false); // overlay is torn down after the decision
	});

	it("confirm() resolves false when Deny is explicitly selected (Down, Enter)", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		const pending = ui.confirm("Approve bash command?", "rm -rf /tmp/scratch");
		await waitUntil(() => tui.hasOverlay());

		terminal.sendInput("\x1b[B"); // Down -> Deny
		terminal.sendInput("\r"); // Enter

		expect(await pending).toBe(false);
	});

	it("confirm() fails closed (resolves false) on cancel (Escape) -- never treats cancel as approval", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		const pending = ui.confirm("Approve edit?", "edit config.json");
		await waitUntil(() => tui.hasOverlay());

		terminal.sendInput("\x1b"); // Escape

		expect(await pending).toBe(false);
	});

	it("confirm() renders the exact title/message it was given as a literal Text line (proves the sink does not re-escape or mangle an already-sanitized string)", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		const pending = ui.confirm("Approve write?", "write already-sanitized-path.txt");
		await waitUntil(() => tui.hasOverlay());
		// requestRender() is scheduled via process.nextTick (packages/tui/src/tui.ts), so the actual
		// write to the terminal lags one tick behind hasOverlay() becoming true.
		await waitUntil(() => terminal.allWrites().includes("write already-sanitized-path.txt"));

		terminal.sendInput("\r");
		await pending;
	});

	it("notify() appends a line to the live transcript container and renders it", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		ui.notify("Blocked write: outside workspace", "warning");

		expect(transcript.children.length).toBe(1);
		await waitUntil(() => terminal.allWrites().includes("Blocked write: outside workspace"));
	});

	it("setStatus() updates the status line component and is visible in what gets rendered", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		ui.setStatus("model", "model anthropic/claude-sonnet-5");
		ui.setStatus("git", "branch main (clean)");

		await waitUntil(() => terminal.allWrites().includes("branch main (clean)"));
		expect(terminal.allWrites()).toContain("model anthropic/claude-sonnet-5");
	});

	it("setStatus() with undefined clears a previously-set field", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });
		ui.setStatus("model", "model anthropic/claude-sonnet-5");
		await waitUntil(() => statusText.render(80).join("\n").includes("anthropic/claude-sonnet-5"));

		ui.setStatus("model", undefined);
		// The terminal's write HISTORY stays cumulative (it recorded the earlier render too), so this
		// asserts against the status component's CURRENT render output, not the terminal's full log.
		await waitUntil(() => !statusText.render(80).join("\n").includes("anthropic"));
	});

	it("getEditorText()/setEditorText() operate on the real chat input editor", () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });
		ui.setEditorText("draft message");
		expect(ui.getEditorText()).toBe("draft message");
		expect(editor.getText()).toBe("draft message");
	});

	it("select() resolves to the chosen option's own label (used standalone, not only via confirm)", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		const pending = ui.select("Pick one", ["alpha", "beta", "gamma"]);
		await waitUntil(() => tui.hasOverlay());

		terminal.sendInput("\x1b[B"); // Down -> beta
		terminal.sendInput("\r");

		expect(await pending).toBe("beta");
	});

	it("documented no-op members never throw and satisfy the ExtensionUIContext contract (structurally required, unreachable in Fase 1)", async () => {
		const ui = createConductorChatUiContext({ tui, editor, transcript, statusText });

		expect(() => ui.setWorkingMessage("x")).not.toThrow();
		expect(() => ui.setWorkingVisible(false)).not.toThrow();
		expect(() => ui.setFooter(undefined)).not.toThrow();
		expect(() => ui.setHeader(undefined)).not.toThrow();
		expect(ui.getEditorComponent()).toBeUndefined();
		expect(ui.getAllThemes()).toEqual([]);
		expect(ui.getTheme("dark")).toBeUndefined();
		expect(ui.setTheme("dark").success).toBe(false);
		expect(ui.getToolsExpanded()).toBe(false);
		ui.setToolsExpanded(true);
		expect(ui.getToolsExpanded()).toBe(true);
		await expect(ui.input("title")).resolves.toBeUndefined();
		await expect(ui.custom(() => new Text(""))).rejects.toThrow();
	});
});
