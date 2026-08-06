/**
 * Gate 6 real-wiring loop-back -- proves the Fase 3 exit criterion end to end through the EXACT
 * composition `chat.ts` itself uses: `createConductorSession` with a real, file-backed
 * `taskDelegation` built from `role-resolution.ts`'s `loadRealRoleRegistry`/`toTaskRoleRegistryView`
 * (the same functions `chat.ts`'s own `prepareChat`/`runChat` call), never a hand-rolled, synthetic
 * `RoleRegistryView` like `@conductor/runtime`'s own `test/tools/task-registration.acceptance.test.ts`
 * (which proves `session.ts`'s wiring in isolation, against a 2-role fake graph, and deliberately
 * stays on failure paths that need no real child model turn -- see that file's own header). This is
 * the CLI package's own proof that Gap 1 (the orchestrator's finding: "chat.ts never actually builds
 * taskDelegation, so `task` is unreachable from the real product") is closed, using the REAL 37-role
 * catalog's REAL `canSpawn` graph, and that Gap 1's OTHER half -- "impedir uma delegação não
 * permitida" -- is enforced by `runTask`'s own internal authorization (not merely the permission-gate's
 * generic human-approval step every tool call already goes through).
 *
 * Two scenarios:
 *
 *   1. AUTHORIZED delegation from the unrestricted, no-`--role` top-level session
 *      (`ROOT_CALLER_ROLE_ID`, per `role-resolution.ts`'s own documented decision that this identity
 *      may reach any REGISTERED role) to a real, registered leaf role ("sdet"). The child spawner
 *      (`tools/task.ts`'s `createGovernedChildSessionSpawner`) constructs its OWN, separate
 *      `ModelRuntime` instance -- `registerFakeModel` only mutates the specific instance passed to it
 *      (task-registration.acceptance.test.ts's own header explains why this matters). This test
 *      intercepts the shared `ModelRuntime.create` static factory (a module-singleton within this test
 *      process, so the spy reaches every caller, including `tools/task.ts`'s own internal call) to
 *      register the SAME provider id ("conductor-fake") on the CHILD's own fresh runtime instance too
 *      -- GAP-5's fix (`createGovernedChildSessionSpawner` now ALWAYS passes the PARENT's own resolved
 *      `model` -- `fakeModel.model`, provider "conductor-fake" -- explicitly into the child's own
 *      `createAgentSession` call, never leaving it unset for Pi's `findInitialModel` to auto-discover a
 *      DIFFERENT provider on its own) means the child's own runtime must recognize that SAME provider
 *      id for the real turn to complete; registering a differently-named provider here (as an earlier
 *      revision of this fixture did, relying on the since-removed auto-discovery fallback to find it by
 *      name) would no longer be reachable at all. This proves a full round trip: real `canSpawn`
 *      authorization, a real spawned child session using the SAME model the parent resolved, and
 *      `DelegationEvidence` derived from that child's own real, disc-backed transcript (never the
 *      child's own prose, per R14/T34).
 *
 *   2. UNAUTHORIZED delegation: a real, constrained caller role ("business-analyst", a real leaf role
 *      with an empty `canSpawn` in `roles.py`/`builtin-roles-data.ts`) attempts to delegate to another
 *      real role outside its own `canSpawn`. Refused by `runTask`'s own internal check BEFORE any
 *      budget is spent or child session is created -- proven by the shared budget's `remaining()`
 *      being untouched and no `tasks/` child-session directory ever appearing on disk. This is a
 *      DIFFERENT layer than the permission-gate's own human-approval step (already covered by
 *      `task-registration.acceptance.test.ts`'s first test, where a human explicitly denies an
 *      OTHERWISE-authorized delegation) -- here the human approves the delegation ATTEMPT going ahead,
 *      and it is `runTask`'s own real `canSpawn` check, against the real ported graph, that refuses it.
 *
 * Every "task" call requires human approval unconditionally (`permission-gate.ts`'s own
 * `requiresApproval`/task branch) -- both scenarios below approve that first gate (equivalent to a
 * human saying "yes, let this delegation attempt proceed") so `runTask`'s own role-based authorization
 * logic is what is actually being observed.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createConductorSession, createSharedBudget } from "@conductor/runtime";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	loadRealRoleRegistry,
	ROOT_CALLER_ROLE_ID,
	toTaskRoleRegistryView,
} from "../../../src/commands/chat/role-resolution.ts";
import { registerFakeModel } from "../../support/fake-model.ts";
import { createScratchProject, type ScratchProject } from "../../support/scratch.ts";
import { createTestUiContext } from "../../support/test-ui.ts";

interface CapturedToolEvent {
	toolName: string;
	result: unknown;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 20_000, intervalMs = 10): Promise<void> {
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
	vi.restoreAllMocks();
});

it("an authorized delegation from the root (no --role) session reaches a real target role and " +
	"returns DelegationEvidence derived from the child's own real, disc-backed session", async () => {
	const agentDir = join(project.root, ".conductor");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const registry = loadRealRoleRegistry();
	// "sdet" is one of the 37 real, ported roles (builtin-roles-data.ts) -- a leaf (spawns: []), so
	// it needs no further canSpawn reasoning of its own for this test.
	const targetRole = "sdet";
	expect(registry.roles.has(targetRole)).toBe(true);

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "task", args: { role: targetRole, prompt: "Summarize the test strategy." } }] },
		{ text: "delegation completed" },
	]);

	// The child spawner's own `ModelRuntime.create(...)` call (tools/task.ts's
	// createGovernedChildSessionSpawner) is a SEPARATE instance from `modelRuntime` above --
	// installed AFTER the top-level runtime is created and scripted, so only the CHILD's own,
	// later call is intercepted. Restored in afterEach via vi.restoreAllMocks().
	//
	// GAP-5: registered under the SAME provider id ("conductor-fake") the PARENT's own model already
	// resolved to (`fakeModel.model.provider`) -- `createGovernedChildSessionSpawner` now passes that
	// exact model into the child's own `createAgentSession` call, so the child's own, separate
	// `ModelRuntime` instance must recognize that same provider for the real turn to dispatch. Its
	// scripted response is still distinctly its own (below), proving this is a genuinely SEPARATE
	// runtime instance carrying out the real work, not the parent's own turn being reused.
	const originalCreate = ModelRuntime.create.bind(ModelRuntime);
	vi.spyOn(ModelRuntime, "create").mockImplementation(async (opts) => {
		const runtime = await originalCreate(opts);
		registerFakeModel(runtime, "conductor-fake", [{ text: "child role completed the delegated work" }]);
		return runtime;
	});

	const sharedBudget = createSharedBudget(200_000);
	const events: CapturedToolEvent[] = [];

	const conductorSession = await createConductorSession({
		workspaceRoot: project.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir,
		taskDelegation: {
			roleRegistry: toTaskRoleRegistryView(registry),
			sharedBudget,
			callerRole: ROOT_CALLER_ROLE_ID,
		},
	});
	conductorSession.session.subscribe((event) => {
		if (event.type === "tool_execution_end") events.push({ toolName: event.toolName, result: event.result });
	});

	const ui = createTestUiContext({ confirmResult: true }); // approve the task call's own approval gate
	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("Delegate a test-strategy summary to the sdet role.");
	await waitUntil(() => events.some((e) => e.toolName === "task"));

	const taskEvent = events.find((e) => e.toolName === "task");
	expect(taskEvent).toBeDefined();
	const result = taskEvent!.result as {
		isError?: boolean;
		content: Array<{ type: string; text: string }>;
		details: {
			transcript: { sessionId: string; filePath: string };
			role: string;
			tokenCost: { total: number };
			budgetRemaining: number;
		};
	};

	expect(result.isError).not.toBe(true);
	expect(result.details.role).toBe(targetRole);
	// Evidence is derived from the CHILD's own real session, never a placeholder/forged value
	// (R14/T34): a real sessionId/filePath, and the file genuinely exists on disk.
	expect(result.details.transcript.sessionId).not.toBe("(no child session was spawned)");
	expect(existsSync(result.details.transcript.filePath)).toBe(true);
	expect(result.details.tokenCost.total).toBeGreaterThan(0);
	expect(result.details.budgetRemaining).toBeLessThan(sharedBudget.limit);
	expect(fakeModel.callCount()).toBe(2);

	conductorSession.dispose();
}, 30_000);

it("delegating to a role outside the real caller's own canSpawn is refused by runTask's own " +
	"authorization check before any budget is spent or child session is created", async () => {
	const agentDir = join(project.root, ".conductor");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const registry = loadRealRoleRegistry();
	// Real, ported data (roles.py / builtin-roles-data.ts), not an invented fixture:
	// "business-analyst" is a leaf role (spawns: []) -- it cannot delegate to anybody, including
	// "site-reliability-engineer", a real, separately-registered role.
	const callerRoleId = "business-analyst";
	const unauthorizedTarget = "site-reliability-engineer";
	const callerRole = registry.roles.get(callerRoleId);
	expect(callerRole).toBeDefined();
	expect(callerRole!.canSpawn).not.toContain(unauthorizedTarget);
	expect(registry.roles.has(unauthorizedTarget)).toBe(true);

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "task", args: { role: unauthorizedTarget, prompt: "do something" } }] },
		{ text: "delegation was refused" },
	]);

	const sharedBudget = createSharedBudget(200_000);
	const events: CapturedToolEvent[] = [];

	const conductorSession = await createConductorSession({
		workspaceRoot: project.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir,
		taskDelegation: {
			roleRegistry: toTaskRoleRegistryView(registry),
			sharedBudget,
			callerRole: callerRoleId,
		},
	});
	conductorSession.session.subscribe((event) => {
		if (event.type === "tool_execution_end") events.push({ toolName: event.toolName, result: event.result });
	});

	const ui = createTestUiContext({ confirmResult: true }); // approve the task call's own approval gate
	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("Delegate to an unauthorized role.");
	await waitUntil(() => events.some((e) => e.toolName === "task"));

	const taskEvent = events.find((e) => e.toolName === "task");
	expect(taskEvent).toBeDefined();
	const result = taskEvent!.result as {
		isError?: boolean;
		details: { transcript: { sessionId: string }; budgetRemaining: number };
	};

	expect(result.isError).toBe(true);
	// The pre-spawn denial sentinel (tools/task.ts's errorResult) -- never a real session id.
	expect(result.details.transcript.sessionId).toBe("(no child session was spawned)");
	// Budget untouched -- refused BEFORE reserve() was ever called.
	expect(sharedBudget.remaining()).toBe(sharedBudget.limit);
	expect(result.details.budgetRemaining).toBe(sharedBudget.limit);
	// No child session was ever created for this delegation attempt. The child spawner
	// (tools/task.ts's createGovernedChildSessionSpawner) always derives its own agentDir from
	// `workspaceRoot` directly (join(workspaceRoot, ".conductor-agent")), independent of whatever
	// `agentDir` the PARENT session itself was constructed with.
	const tasksDir = join(project.root, ".conductor-agent", "sessions", "tasks");
	if (existsSync(tasksDir)) {
		expect(readdirSync(tasksDir)).toHaveLength(0);
	}
	expect(fakeModel.callCount()).toBe(2);

	conductorSession.dispose();
}, 15_000);
