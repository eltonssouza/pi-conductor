/**
 * Gate 6 real-wiring loop-back: proves `task` is actually reachable from a REAL `AgentSession`, not
 * merely implemented and unit-tested in isolation (`test/tools/task.test.ts`,
 * `test/permission-gate.task.test.ts`, `test/tools/task-sole-constructor.test.ts`).
 *
 * Before this file's own production change (`session.ts`'s new `taskDelegation` option +
 * `tools/task.ts`'s new `createTaskTool`), `createConductorSession`'s own `tools: [...]` array never
 * named "task" at all -- confirmed by reading session.ts before this change (line ~169:
 * `["read", "write", "edit", "bash", ...customTools.map(...)]`, with no `taskDelegation` concept and
 * no `task` ToolDefinition anywhere in `customTools`). No agent could ever actually call it. This
 * mirrors `test/custom-tool.acceptance.test.ts`'s own structure for `conductor_note`: drive a REAL
 * session end to end with a scripted fake model, and observe the REAL side effects (here: the
 * permission-gate's own decision log and the tool's real two-channel result), not just "prompt()
 * resolved without throwing".
 *
 * Both tests below deliberately stay on failure paths that never require a real child model turn
 * (denial, and an unknown target role) -- `runTask`'s own success/authorization-ordering logic is
 * already exhaustively covered against fakes in `test/tools/task.test.ts`; a real, model-driven
 * CHILD session would need a second scripted provider reachable from a freshly-constructed
 * `ModelRuntime` inside `createGovernedChildSessionSpawner` (a separate instance from this test's own
 * `modelRuntime`, since `registerFakeModel` only mutates the specific instance passed to it) -- out of
 * scope for proving reachability, which is this file's only job.
 */

import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createConductorSession } from "../../src/session.ts";
import { createSharedBudget } from "../../src/shared-budget.ts";
import type { RoleRegistryView } from "../../src/tools/task.ts";
import { registerFakeModel } from "../support/fake-model.ts";
import { createTestUiContext } from "../support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "../support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function makeRoleRegistry(roles: Record<string, string[]>): RoleRegistryView {
	return {
		get: (roleId) =>
			roles[roleId] ? { name: roleId, tools: ["read"], canSpawn: roles[roleId], modelRole: "standard" } : undefined,
		canSpawn: (from, to) => roles[from]?.includes(to) ?? false,
	};
}

it("registers 'task' as an actually-reachable tool of a real session -- denying the delegation still proves the REAL task branch of the permission-gate ran (ctx.ui.confirm() was really asked), not the generic no-policy-declared fallback every unregistered tool falls through to", async () => {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "task", args: { role: "software-engineer", prompt: "fix the bug" } }] },
		{ text: "delegation was not approved" },
	]);

	const decisions: Array<{ toolName: string; allowed: boolean; requiredApproval: boolean }> = [];
	const ui = createTestUiContext({ confirmResult: false });
	const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions"));

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		sessionManager,
		agentDir: workspace.agentDir,
		onDecision: (decision) => decisions.push(decision),
		taskDelegation: {
			roleRegistry: makeRoleRegistry({ "tech-lead": ["software-engineer"] }),
			sharedBudget: createSharedBudget(100_000),
			callerRole: "tech-lead",
		},
	});

	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("Delegate the bug fix to software-engineer.");

	// The fake model produced 2 turns -- the "task" tool call round-tripped through the session at
	// all (a model calling a tool name absent from the session's own `tools` list would never reach
	// this far as a real, gated decision).
	expect(fakeModel.callCount()).toBe(2);

	const taskDecision = decisions.find((d) => d.toolName === "task");
	expect(taskDecision).toBeDefined();
	expect(taskDecision?.requiredApproval).toBe(true);
	expect(taskDecision?.allowed).toBe(false);
	// The discriminator against the generic default-deny fallback (which never calls confirm() at
	// all, see permission-gate.ts's own final branch): a REAL "task" branch must have actually asked.
	expect(ui.confirmCalls.length).toBeGreaterThanOrEqual(1);
	expect(ui.confirmCalls[0]?.message ?? ui.confirmCalls[0]?.title).toContain("software-engineer");

	conductorSession.dispose();
});

it("omitting taskDelegation keeps 'task' unreachable at all -- the session's own tools list never names it, so the call never even reaches the permission-gate as a decision (documents the exact 'not wired yet' integration point taskDelegation exists to close, and proves this session.ts option -- not some ambient default -- is what makes 'task' callable in the first test above)", async () => {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "task", args: { role: "software-engineer", prompt: "fix the bug" } }] },
		{ text: "done" },
	]);

	const decisions: Array<{ toolName: string; allowed: boolean; requiredApproval: boolean; reason?: string }> = [];
	const ui = createTestUiContext({ confirmResult: true });
	const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions"));

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		sessionManager,
		agentDir: workspace.agentDir,
		onDecision: (decision) => decisions.push(decision),
		// No taskDelegation supplied -- "task" must not be reachable.
	});

	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("Delegate the bug fix to software-engineer.");

	// "task" never becomes a decision at all -- Pi's own SDK never dispatches a `tool_call` event for
	// a name absent from the session's `tools` allowlist, so the permission-gate (and this session's
	// `onDecision` hook) never even sees it. This is a STRONGER proof of "not reachable" than a
	// fail-closed decision would be: there is no decision, allowed or denied, to observe -- exactly
	// what "task" looked like everywhere in this codebase before `taskDelegation` was added.
	const taskDecision = decisions.find((d) => d.toolName === "task");
	expect(taskDecision).toBeUndefined();
	expect(ui.confirmCalls).toHaveLength(0);
	// The turn still round-trips (Pi handles the unrecognized tool call itself, e.g. surfacing a
	// tool-not-found result to the model) -- this test is about the gate never being consulted, not
	// about the session hanging or crashing.
	expect(fakeModel.callCount()).toBe(2);

	conductorSession.dispose();
});
