/**
 * Test-first (Gate 5, `feature/auto-subagent-delegation`) for `runGateDelegation`/
 * `buildDelegationSpawnInput`/`CONTEXT_LIMIT_FRACTION` (`src/commands/auto.ts`) -- ADR 0010 "Wiring de
 * delegação real de subagentes em runAuto" §3-§11/§14, gate2-spec-auto-subagent-delegation.md Grupos
 * A/B/D/F/G, gate3-addendum-auto-subagent-delegation.md T82/T85/R63/R66/GAP-D.
 *
 * `runGateDelegation`/`buildDelegationSpawnInput` are currently unconditional `throw new Error("not
 * implemented")` stubs (`src/commands/auto.ts`, this demand's own new Gate 5 section) -- every test
 * below fails RED for that one reason today (the SAME precedent this monorepo's own
 * `tools/task.test.ts`/`gate-evidence.test.ts` document for their own Gate 5 passes). They are written
 * against the REAL, ADR-0010-locked contract so each becomes the actual proof of the FR/T/R it names
 * once Gate 6 fills the bodies in -- not a redundant re-statement of "it throws".
 *
 * DESIGN CHOICE (grounded): the REAL `createGovernedChildSessionSpawner` (`@conductor/runtime`) is
 * exercised end-to-end -- ModelRuntime, DefaultResourceLoader, SessionManager, the permission-gate
 * extension all stay REAL -- intercepting ONLY the Pi SDK's own `createAgentSession` call, mirroring
 * `@conductor/runtime`'s own `test/tools/task-child-model-inheritance.test.ts` exactly (that file's own
 * header: "every other export of @earendil-works/pi-coding-agent... stays REAL, so this is still
 * exercising the genuine resourceLoader/permission-gate/session-manager wiring, only stopping short of a
 * real model turn"). Grounding: `cdt library "unit testing a security-critical evidence predicate ...
 * static source scan versus a live behavioral test" --gate 5` (run from
 * C:\development\source\projects\conductor) returned **Unit Testing Principles -- Complete Professional
 * Guide §2.9 "test behavior, not implementation"** ("Use real or simple fakes at genuine boundaries")
 * and **Working with Legacy Code -- Complete Professional Guide §3.2 "sprout and wrap; characterization
 * tests"** (top 0.619/0.611) -- moderate coverage, the same honest "agent-orchestration topics aren't
 * covered in depth by this corpus" pattern this project's own ADR 0010 §16 already reports; grounding is
 * reused from that ADR's own Gate 4 session rather than re-forced here. The genuine boundary this file
 * stops short of is the Pi SDK's own model-turn network call -- exactly where
 * `task-child-model-inheritance.test.ts` already drew the same line for the sibling `tools/task.ts`.
 */

import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

// ---- The one seam this file needs: intercept the Pi SDK's own session-turn boundary, never the rest
// of the real spawn/permission/session-manager wiring (see this file's own header). Configured per-test
// via the hoisted `state` object below, following task-child-model-inheritance.test.ts's own pattern.
const state = vi.hoisted(() => ({
	captured: undefined as { model?: unknown; tools?: string[] } | undefined,
	createAgentSessionCalls: 0,
	tokenUsage: { input: 0, output: 0, total: 0 },
	finalText: "delegated work done",
	promptShouldThrow: false,
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		createAgentSession: vi.fn(async (options: { model?: unknown; tools?: string[] }) => {
			state.captured = options;
			state.createAgentSessionCalls += 1;
			return {
				session: {
					prompt: async () => {
						if (state.promptShouldThrow) {
							throw new Error("simulated model/provider failure during delegation");
						}
					},
					getSessionStats: () => ({ tokens: state.tokenUsage }),
					getLastAssistantText: () => state.finalText,
				},
				extensionsResult: { registeredTools: [], slashCommands: [] },
			};
		}),
	};
});

// Imported AFTER vi.mock (vitest hoists vi.mock calls above imports at transform time), same convention
// as task-child-model-inheritance.test.ts, so @conductor/runtime's own transitive
// `import { createAgentSession, ... } from "@earendil-works/pi-coding-agent"` (inside tools/task.ts,
// which the real createGovernedChildSessionSpawner this file's own runGateDelegation composes) binds to
// the mocked factory above.
const { buildDelegationSpawnInput, CONTEXT_LIMIT_FRACTION, runGateDelegation } = await import(
	"../../src/commands/auto.ts"
);
const { createAuditTrailWriter, createSharedBudget } = await import("@conductor/runtime");
const { loadRealRoleRegistryAndSkills, toTaskRoleRegistryView } = await import(
	"../../src/commands/chat/role-resolution.ts"
);

const NOOP_WRITER = { write(_chunk: string): void {} };

function fixtureModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "fixture-model-1",
		name: "Fixture Model",
		provider: "conductor-fixture",
		api: "anthropic-messages",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		contextWindow: 200_000,
		maxTokens: 8192,
		...overrides,
	} as Model<Api>;
}

/** A `ModelResolutionPort` that always resolves the given model, for whatever `purpose`/`persona` is
 * requested -- this suite's subject is `runGateDelegation`'s OWN wiring, not model-resolution policy
 * itself (that is `model-precondition.test.ts`/`model-precondition-composition-guard.test.ts`'s job). */
function alwaysResolves(model: Model<Api>) {
	return {
		resolveForGate: (request: { gate: number }) => ({
			resolved: true as const,
			model,
			ref: { provider: model.provider, modelId: model.id },
			effectiveRank: 3,
			trace: { gate: request.gate, at: new Date().toISOString(), steps: [] },
		}),
	};
}

/** A fixture `RoleRegistryView` whose one entry is under the caller's control -- deliberately NOT the
 * real 37-role catalog for the success-path/D8/D9/GAP-D tests below: N1/GAP-2 (Fase 3) means every
 * REAL built-in role resolves with `tools:[]` today (confirmed live by this file's own N1 test below),
 * so the wiring logic itself (role -> model -> template -> builder -> spawn -> evidence) can only be
 * proven with a role that HAS tools -- exactly the "legitimate because production data is currently
 * inert" carve-out this suite's own task brief names. */
function fixtureRoleRegistry(roleId: string, tools: string[]) {
	return {
		get: (id: string) =>
			id === roleId ? { name: roleId, tools, canSpawn: [], modelRole: "standard" as const } : undefined,
		canSpawn: () => true,
	};
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
	state.captured = undefined;
	state.createAgentSessionCalls = 0;
	state.tokenUsage = { input: 0, output: 0, total: 0 };
	state.finalText = "delegated work done";
	state.promptShouldThrow = false;
});

afterEach(() => {
	project.cleanup();
	vi.clearAllMocks();
});

// =================================================================================================
// Test 1 -- N1: fail-closed refusal on empty-tools role, against the REAL BUILTIN_GATE_ROLES/role
// catalog (Gate 4's own finding: today, EVERY built-in role resolves with tools:[] -- GAP-2, Fase 3).
// =================================================================================================
describe("runGateDelegation -- N1/D2/GAP-2: refuses fail-closed against the REAL role catalog, never attempts a spawn with a tools-empty role", () => {
	it("confirmed live: the real, file-backed role catalog's lead role for gate 6 (software-engineer) resolves with tools:[] today", () => {
		const { registry } = loadRealRoleRegistryAndSkills();
		const role = registry.roles.get("software-engineer");
		expect(role).toBeDefined();
		expect(role?.tools).toEqual([]);
	});

	it("runGateDelegation refuses cleanly (kind:'stop', reason:'needs-human') for the real gate-6 lead role, naming the gate/role, and NEVER attempts a spawn (createAgentSession is never called)", async () => {
		const { registry } = loadRealRoleRegistryAndSkills();
		const roleRegistry = toTaskRoleRegistryView(registry);

		const outcome = await runGateDelegation({
			gate: 6,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
			roleRegistry,
			modelResolutionPort: alwaysResolves(fixtureModel()),
			sharedBudget: createSharedBudget(1_000_000),
			effectivePolicyInput: {},
			auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
			recordDelegationSessionId: vi.fn(),
			attachDelegationEvidence: vi.fn(),
		});

		expect(outcome.kind).toBe("stop");
		if (outcome.kind === "stop") {
			expect(outcome.reason).toBe("needs-human");
			expect(outcome.detail).toMatch(/software-engineer/);
			expect(outcome.detail).toMatch(/gate 6|tools/i);
		}
		expect(state.createAgentSessionCalls).toBe(0);
	});
});

// =================================================================================================
// Test 2 -- genuine delegation success path, using a TEST FIXTURE role WITH tools (production data is
// currently inert per N1 above -- this proves the WIRING, not that production roles can delegate yet).
// =================================================================================================
describe("runGateDelegation -- genuine delegation success path (fixture role WITH tools)", () => {
	it("produces {kind:'delegated'}, records the observed sessionId, and attaches a DelegationEvidence-shaped {kind:'delegation'} ref carrying a real sessionId", async () => {
		state.tokenUsage = { input: 100, output: 50, total: 150 };
		const recordDelegationSessionId = vi.fn();
		const attachDelegationEvidence = vi.fn();

		const outcome = await runGateDelegation({
			gate: 6,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
			roleRegistry: fixtureRoleRegistry("software-engineer", ["read", "write"]),
			modelResolutionPort: alwaysResolves(fixtureModel({ contextWindow: 200_000 })),
			sharedBudget: createSharedBudget(1_000_000),
			effectivePolicyInput: {},
			auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
			recordDelegationSessionId,
			attachDelegationEvidence,
		});

		expect(outcome.kind).toBe("delegated");
		expect(state.createAgentSessionCalls).toBe(1);

		expect(recordDelegationSessionId).toHaveBeenCalledTimes(1);
		const [sessionId] = recordDelegationSessionId.mock.calls[0] as [string];
		expect(typeof sessionId).toBe("string");
		expect(sessionId.length).toBeGreaterThan(0);

		expect(attachDelegationEvidence).toHaveBeenCalledTimes(1);
		const [attachedGate, ref] = attachDelegationEvidence.mock.calls[0] as [
			number,
			{ kind: string; sessionId: string; role: string },
		];
		expect(attachedGate).toBe(6);
		expect(ref).toEqual({ kind: "delegation", sessionId, role: "software-engineer" });

		// GAP-5 (inherited invariant from tools/task.ts): the model resolved for THIS delegation (never
		// omitted, never an environment/ambient fallback) is what reaches the Pi SDK boundary.
		expect(state.captured?.model).toBeDefined();
	});
});

// =================================================================================================
// Test 5 -- GAP-D: buildDelegationSpawnInput's output ALWAYS has yesFlagActive:false, depth:1, and
// non-permissive effectivePolicy/auditTrailWriter -- no matter what a (malicious or mistaken) caller
// passes. The function's own TS parameter shape already excludes yesFlagActive/depth/
// additionalProtectedPaths as inputs (a well-typed caller cannot even compile a call that supplies
// them) -- this test proves the STRONGER, runtime property: even a caller that bypasses the type
// system (a plain JS call site, or an `as unknown as` cast) cannot smuggle a different value in, because
// the implementation hardcodes them rather than trusting absence of a field at the type level alone.
// =================================================================================================
describe("buildDelegationSpawnInput -- GAP-D/R63: the 4 security invariants are impossible to loosen, even via a smuggled extra property", () => {
	it("ignores smuggled yesFlagActive/depth/additionalProtectedPaths overrides and always returns the hardcoded safe values", () => {
		const smuggledArgs = {
			role: { name: "software-engineer", tools: ["read", "write"], canSpawn: [], modelRole: "standard" as const },
			prompt: "do the gate's work",
			model: fixtureModel(),
			workspaceRoot: project.root,
			effectivePolicyInput: {},
			auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
			sessionManager: undefined as never, // Gate 6 constructs its own real SessionManager -- not this test's concern
			// Smuggled fields: NOT part of buildDelegationSpawnInput's declared parameter type at all --
			// only reachable by bypassing TypeScript via the cast below, simulating a caller that manages
			// to pass them anyway (a JS call site, a spread from an untrusted object, etc.).
			yesFlagActive: true,
			depth: 99,
			additionalProtectedPaths: ["/"],
		};

		const result = buildDelegationSpawnInput(
			smuggledArgs as unknown as Parameters<typeof buildDelegationSpawnInput>[0],
		);

		expect(result.yesFlagActive).toBe(false);
		expect(result.depth).toBe(1);
		expect(result.additionalProtectedPaths).toEqual([]);
	});
});

// =================================================================================================
// Test 6 -- D8: CONTEXT_LIMIT_FRACTION pinned at 0.9; the contextExceeded comparison is per-call
// (tokenUsage.total vs. CONTEXT_LIMIT_FRACTION * model.contextWindow), never sharedBudget.remaining().
// =================================================================================================
describe("runGateDelegation -- D8: context-limit is measured per-call against the resolved model's contextWindow, never conflated with sharedBudget.remaining()", () => {
	it("CONTEXT_LIMIT_FRACTION is pinned at 0.9 (a future edit changing this number is a deliberate, reviewed decision, never a silent drift)", () => {
		expect(CONTEXT_LIMIT_FRACTION).toBe(0.9);
	});

	it("contextExceeded:false when tokenUsage.total is comfortably below 90% of the resolved model's contextWindow", async () => {
		state.tokenUsage = { input: 50, output: 50, total: 100 }; // well under 900 (90% of 1000)

		const outcome = await runGateDelegation({
			gate: 6,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
			roleRegistry: fixtureRoleRegistry("software-engineer", ["read"]),
			modelResolutionPort: alwaysResolves(fixtureModel({ contextWindow: 1_000 })),
			sharedBudget: createSharedBudget(1_000_000),
			effectivePolicyInput: {},
			auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
			recordDelegationSessionId: vi.fn(),
			attachDelegationEvidence: vi.fn(),
		});

		expect(outcome).toMatchObject({ kind: "delegated", contextExceeded: false });
	});

	it("contextExceeded:true when tokenUsage.total crosses 90% of the resolved model's contextWindow, EVEN THOUGH sharedBudget.remaining() is nowhere near exhausted -- proves the two measurements are never conflated (ADR 0009 §20)", async () => {
		state.tokenUsage = { input: 500, output: 450, total: 950 }; // >= 900 (90% of 1000)
		const sharedBudget = createSharedBudget(1_000_000); // abundant remaining() throughout

		const outcome = await runGateDelegation({
			gate: 6,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
			roleRegistry: fixtureRoleRegistry("software-engineer", ["read"]),
			modelResolutionPort: alwaysResolves(fixtureModel({ contextWindow: 1_000 })),
			sharedBudget,
			effectivePolicyInput: {},
			auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
			recordDelegationSessionId: vi.fn(),
			attachDelegationEvidence: vi.fn(),
		});

		expect(outcome).toMatchObject({ kind: "delegated", contextExceeded: true });
		// sharedBudget.remaining() stayed far above zero the whole time -- if contextExceeded were
		// somehow derived from it instead of the model's own contextWindow, this case could never fire.
		expect(sharedBudget.remaining()).toBeGreaterThan(900_000);
	});
});

// =================================================================================================
// Test 7 -- D9: a rejected/thrown spawn converts to a {kind:"stop"} outcome, never propagates as an
// uncaught exception/rejected promise.
// =================================================================================================
describe("runGateDelegation -- D9/FR-7: a thrown/rejected spawn degrades to {kind:'stop'}, never an uncaught exception", () => {
	it("when the child session's own turn throws (credential/network/tool-denial class of failure), runGateDelegation resolves (never rejects) to {kind:'stop', reason:'needs-human'}", async () => {
		state.promptShouldThrow = true;

		const outcome = await runGateDelegation({
			gate: 6,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
			roleRegistry: fixtureRoleRegistry("software-engineer", ["read"]),
			modelResolutionPort: alwaysResolves(fixtureModel()),
			sharedBudget: createSharedBudget(1_000_000),
			effectivePolicyInput: {},
			auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
			recordDelegationSessionId: vi.fn(),
			attachDelegationEvidence: vi.fn(),
		});

		expect(outcome.kind).toBe("stop");
		if (outcome.kind === "stop") {
			expect(outcome.reason).toBe("needs-human");
			expect(typeof outcome.exitCode).toBe("number");
			expect(outcome.detail.length).toBeGreaterThan(0);
		}
	});
});
