/**
 * Fase-0 backfill — Gap 2 (custom-tool PoC), queued by gate8-validation.md §7 as the second item
 * of this continuation ("Custom-tool PoC — left open, no cover story invented"). Confirmed missing
 * by gate8-validation.md §3 row 4: `src/session.ts` only ever wired the four built-in tools
 * (`["read", "write", "edit", "bash"]`), and grepping the whole tree for `registerTool`/`defineTool`
 * turned up zero hits outside a comment.
 *
 * Unlike permission-gate.test.ts (which exercises the gate's decision function directly against a
 * synthetic event — see the "conductor_note" describe block there for the decision-table-level
 * proof), this file drives a REAL AgentSession end-to-end: a scripted fake model actually calls the
 * registered custom tool, and the tool's real side effect (a note appended to its own in-memory
 * list) is observed afterwards. Two things this specifically has to prove, per the task brief:
 *   1. The custom tool is reachable at all through createConductorSession's wiring (recon §3 point
 *      1 — customTools passed to createAgentSession()).
 *   2. It is NOT exempt from the permission-gate: approval is required and actually requested via
 *      ctx.ui.confirm(), exactly like write/edit/bash — a custom tool doesn't get a free pass just
 *      because it isn't one of the four built-ins.
 */

import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createConductorSession } from "../src/session.ts";
import { createConductorNoteTool } from "../src/tools/conductor-note.ts";
import { registerFakeModel } from "./support/fake-model.ts";
import { createTestUiContext } from "./support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

it("drives a session end-to-end through a registered custom tool, gated by the same permission-gate as the built-ins", async () => {
	const noteTool = createConductorNoteTool();

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "conductor_note", args: { note: "Fase 0 gap-2 backfill" } }] },
		{ text: "note recorded" },
	]);

	const decisions: Array<{ toolName: string; allowed: boolean; requiredApproval: boolean }> = [];
	const ui = createTestUiContext({ confirmResult: true });
	const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions"));

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		sessionManager,
		agentDir: workspace.agentDir,
		customTools: [noteTool.tool],
		onDecision: (decision) => decisions.push(decision),
	});

	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("Record a note about the Fase 0 gap-2 backfill.");

	// The fake model produced 2 turns — proves the tool call actually round-tripped through the
	// session, not just that prompt() resolved.
	expect(fakeModel.callCount()).toBe(2);

	// Went through the SAME gate as write/edit/bash: approval was required and actually requested.
	const noteDecision = decisions.find((d) => d.toolName === "conductor_note");
	expect(noteDecision?.allowed).toBe(true);
	expect(noteDecision?.requiredApproval).toBe(true);
	expect(ui.confirmCalls.length).toBeGreaterThanOrEqual(1);

	// The tool's real effect happened — not just "the call didn't throw".
	expect(noteTool.notes).toHaveLength(1);
	expect(noteTool.notes[0]?.note).toBe("Fase 0 gap-2 backfill");

	conductorSession.dispose();
});

it("denies the custom tool when the user does not approve — no note is recorded (fail closed, not fail open)", async () => {
	const noteTool = createConductorNoteTool();

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "conductor_note", args: { note: "should never be recorded" } }] },
		{ text: "done" },
	]);

	const ui = createTestUiContext({ confirmResult: false });
	const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions"));

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		sessionManager,
		agentDir: workspace.agentDir,
		customTools: [noteTool.tool],
	});

	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("Record a note.");

	expect(noteTool.notes).toHaveLength(0);

	conductorSession.dispose();
});
