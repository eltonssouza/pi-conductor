/**
 * Characterization test (Gate 5, Fase 7 D10/F3) for the REAL, currently-buggy behavior of
 * `createGovernedChildSessionSpawner` (`packages/conductor-runtime/src/tools/task.ts:541-547`):
 *
 *   const agentDir = join(input.workspaceRoot, ".conductor-agent");
 *   const baseModelRuntime = await ModelRuntime.create({
 *     authPath: join(agentDir, "auth.json"),
 *     modelsPath: join(agentDir, "models.json"),
 *     allowModelNetwork: false,
 *   });
 *
 * ADR 0008 (docs/adr/0008-fase7-model-routing-and-providers.md) finding F3 (§1.1) + decision D10 (§2,
 * §14.2) + the Gate 3 addendum's surface S2 (docs/conductor/gate3-addendum-fase7.md §15): pointing the
 * DELEGATED CHILD's own catalog/credential paths INSIDE the workspace is inert only because Fase 3's
 * GAP-5 fix makes the child inherit its `model` from the parent BY REFERENCE (the parent's own
 * already-resolved `Model`, `SpawnChildSessionInput.model`) — `.conductor-agent/models.json` is
 * constructed but never actually consulted for MODEL SELECTION today. It stops being inert the moment
 * Fase 7 wires per-role model resolution into delegation: a hostile clone that plants
 * `.conductor-agent/models.json` (an `openai-compatible` provider with an attacker `baseUrl` + inline
 * `apiKey`, both permitted by the vendor's `model-config.ts:195-196` schema) becomes a live
 * exfiltration path the moment the child's `ModelRuntime` is asked to resolve THAT provider by name.
 * See `test/workspace-policy-providers-protected.test.ts` for the companion test closing the same gap
 * at the path-authority layer (S1/S2, secure-defaults 64/65) — this file characterizes the SPAWNER
 * itself, the third of ADR §14.2's four declared changes to existing code.
 *
 * D10's fix (ADR §14.2 third row; §15 S2 mitigation): the spawner's `authPath`/`modelsPath` stop
 * pointing inside `workspaceRoot` and instead use the SAME per-machine defaults the PARENT process
 * already uses — `packages/conductor-cli/src/commands/chat.ts:148-151`'s own `defaultCreateModelRuntime`:
 *
 *   async function defaultCreateModelRuntime(): Promise<ModelRuntime> {
 *     // No authPath/modelsPath override: chat resolves credentials from Pi's global defaults ...
 *     return ModelRuntime.create({ allowModelNetwork: false });
 *   }
 *
 * i.e. no workspace-scoped override at all. This test asserts the SECURITY PROPERTY D10 requires
 * (never workspace-scoped) rather than one single prescribed call shape, because either of two
 * observably-different, equally-valid fixes satisfies chat.ts:151 parity: (a) omit authPath/modelsPath
 * entirely, letting `ModelRuntime.create`'s own internal default take over
 * (`packages/coding-agent/src/core/model-runtime.ts:172-173` / `auth-storage.ts:250`, both defaulting to
 * `join(getAgentDir(), "...")`), or (b) pass that same per-machine path explicitly. Asserting only the
 * property under test (never workspace-scoped) — not the implementation shape — avoids a fragile test
 * that would fail a CORRECT fix taking the other valid shape (Unit Testing Principles: prefer testing
 * observable behavior over implementation detail).
 *
 * This file drives the REAL, exported `createGovernedChildSessionSpawner` directly (not a
 * reimplementation of it — same technique `task-child-model-inheritance.test.ts` already established
 * for the GAP-5 finding) and intercepts exactly two seams: `ModelRuntime.create` (to CAPTURE the
 * `authPath`/`modelsPath` it was actually called with, without needing real credential files on disk)
 * and `createAgentSession` (to avoid a real model turn/network call, same as the sibling file) — every
 * other export of `@earendil-works/pi-coding-agent` (`DefaultResourceLoader`, `SessionManager`,
 * `getAgentDir`, ...) stays REAL.
 *
 * FAILS today: the real, unmodified `task.ts:541-547` always captures workspace-scoped paths.
 */

import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuditTrailWriter } from "../../src/audit-trail.ts";
import { createSharedBudget } from "../../src/shared-budget.ts";
import { isWithinRoot } from "../../src/workspace-policy.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "../support/workspace.ts";

interface CapturedModelRuntimeCreateOptions {
	authPath?: string;
	modelsPath?: string | null;
	allowModelNetwork?: boolean;
}

const state = vi.hoisted(() => ({
	capturedModelRuntimeOptions: undefined as CapturedModelRuntimeCreateOptions | undefined,
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		// Seam 1: capture what createGovernedChildSessionSpawner actually hands ModelRuntime.create,
		// without needing real ~/.pi/agent (or workspace) credential files on disk. The returned stand-in
		// only needs `streamSimple` to exist for shared-budget.ts's `createBudgetGuardedModelRuntime`
		// Proxy to be constructible -- it is never actually invoked, because seam 2 below short-circuits
		// before any real model turn.
		ModelRuntime: {
			...actual.ModelRuntime,
			create: vi.fn(async (options: CapturedModelRuntimeCreateOptions) => {
				state.capturedModelRuntimeOptions = options;
				return {
					streamSimple: () => {
						throw new Error("not reached: createAgentSession is mocked in this characterization test");
					},
				};
			}),
		},
		// Seam 2: same technique as task-child-model-inheritance.test.ts -- avoid a real model turn.
		createAgentSession: vi.fn(async () => ({
			session: {
				prompt: async () => {},
				getSessionStats: () => ({ tokens: { input: 0, output: 0, total: 0 } }),
				getLastAssistantText: () => "done",
			},
			extensionsResult: { registeredTools: [], slashCommands: [] },
		})),
	};
});

// Imported AFTER vi.mock (vitest hoists vi.mock calls above imports at transform time) so
// tools/task.ts's own `import { ModelRuntime, createAgentSession, ... } from "@earendil-works/pi-coding-agent"`
// binds to the mocked factory above.
const { createGovernedChildSessionSpawner } = await import("../../src/tools/task.ts");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");

const PARENT_MODEL = { provider: "conductor-fake", id: "conductor-fake-model-1", name: "Fake" } as Model<any>;

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
	state.capturedModelRuntimeOptions = undefined;
});

afterEach(() => {
	workspace.cleanup();
	vi.clearAllMocks();
});

it("D10/F3: the child's ModelRuntime is constructed with authPath/modelsPath OUTSIDE workspaceRoot (per-machine parity with chat.ts:148-151's defaultCreateModelRuntime) -- never a path under workspaceRoot/.conductor-agent, task.ts:541-547's current bug", async () => {
	const auditTrailWriter = createAuditTrailWriter(join(workspace.root, ".conductor", "audit.jsonl"));
	const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions", "tasks"));

	const spawn = createGovernedChildSessionSpawner(createSharedBudget(100_000));
	await spawn({
		role: { name: "software-engineer", tools: ["read"], canSpawn: [], modelRole: "standard" },
		prompt: "do something self-contained",
		depth: 1,
		workspaceRoot: workspace.root,
		effectivePolicy: {},
		auditTrailWriter,
		additionalProtectedPaths: [],
		yesFlagActive: false,
		sessionManager,
		model: PARENT_MODEL,
	});

	expect(state.capturedModelRuntimeOptions).toBeDefined();
	const { authPath, modelsPath } = state.capturedModelRuntimeOptions ?? {};

	// Today's actual, buggy values (task.ts:541-547) -- the exact T73/S2 attack surface this test
	// exists to close: authPath/modelsPath pointing inside a workspace a hostile clone controls.
	// This is what fails today (both equal these exact literals every single run).
	expect(authPath).not.toBe(join(workspace.root, ".conductor-agent", "auth.json"));
	expect(modelsPath).not.toBe(join(workspace.root, ".conductor-agent", "models.json"));

	// The actual security property (D10): NEVER resolves inside workspaceRoot at all -- catches a
	// fix that swaps in some OTHER workspace-scoped subdirectory just as much as today's literal
	// ".conductor-agent" one. `undefined` (the "omit the override, let ModelRuntime.create's own
	// per-machine default apply" fix) passes this check by construction, since it never resolves
	// into workspaceRoot in the first place.
	expect(authPath === undefined || !isWithinRoot(authPath, workspace.root)).toBe(true);
	expect(modelsPath === undefined || !isWithinRoot(modelsPath, workspace.root)).toBe(true);
}, 20_000);
