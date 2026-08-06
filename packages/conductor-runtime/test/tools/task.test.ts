/**
 * Test-first (Gate 5) for the `task` tool's orchestration (`runTask`, src/tools/task.ts) — Gate 2
 * spec Grupo D/F/G/H (FR-7/FR-8/FR-9, FR-13..FR-19), BR-5/BR-7/BR-9/BR-10; ADR 0004 §2/§5/§6;
 * gate3-addendum-fase3.md T30/T31/T34/T41/T42.
 *
 * `runTask` is currently a STUB that unconditionally throws "not implemented" (src/tools/task.ts) —
 * every test below fails RED for that one reason today. They are written against the REAL, locked
 * contract (ADR 0004 §16 appendix) so that once Gate 6 fills `runTask`'s body, each test becomes the
 * actual proof of the FR/BR it names — not a redundant re-statement of "it doesn't throw".
 *
 * Design choice (grounded): `runTask` is exercised DIRECTLY, with fakes for its collaborators
 * (`RoleRegistryView`, `SharedBudget`, `spawnChildSession`) — never through a full Pi `AgentSession` /
 * real model turn. This mirrors this package's own `permission-engine.ts` (`decide()`, a pure
 * function unit-tested directly in `permission-engine.test.ts`) vs. `permission-gate.ts` (the thin
 * `pi.on("tool_call")` wiring, tested separately in `permission-gate.test.ts`) — the same
 * policy-in-the-middle/IO-at-the-edges boundary this codebase already draws. Grounding: `cdt library
 * "unit test a shared budget/task orchestration function without a real model" --gate 5` (run from
 * C:\development\source\projects\conductor) returned **Unit Testing Principles — Complete
 * Professional Guide §2.3/§2.5** ("test the contract: given inputs, what outputs and side effects";
 * "test behavior, not implementation" via a real fake at a true boundary) and **§3.12** ("the real
 * collaborator is cheap and in-process ... substituting them adds setup, pins the collaboration
 * graph, buys no speed" — the reason the `SharedBudget`/`AuditTrailWriter` fakes below are either the
 * REAL, cheap, in-process implementations or minimal literal objects, never a heavyweight mock
 * framework), top **0.557**.
 *
 * T40 (budget race) has its own dedicated file (`shared-budget.test.ts`) — this file's budget-related
 * tests only cover the ORDERING contract (reserve happens before spawn, exhaustion denies gracefully),
 * not the concurrency guarantee itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuditTrailWriter } from "../../src/audit-trail.ts";
import type { EffectivePolicyInput } from "../../src/permission-engine.ts";
import type { BudgetReservation, SharedBudget } from "../../src/shared-budget.ts";
import {
	assertValidTaskToolResult,
	type ConductorRoleView,
	type CreateTaskToolOptions,
	type RoleRegistryView,
	runTask,
	type SpawnChildSessionInput,
	type SpawnChildSessionResult,
	type TaskToolParams,
} from "../../src/tools/task.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "../support/workspace.ts";

/**
 * GAP-5 (quality-baseline, Fase 3 checkpoint): a minimal, literal stand-in for the PARENT session's
 * own already-resolved `Model` -- these tests never drive a real model turn (every `spawnChildSession`
 * here is a fake), so only `provider`/`id` need to be realistic enough to assert reference/value
 * identity against. Deliberately a single shared constant, never rebuilt per test: the whole point of
 * the assertions below is "the SAME object the caller resolved", not "an object that happens to look
 * the same".
 */
const FAKE_PARENT_MODEL = { provider: "conductor-fake", id: "conductor-fake-model-1", name: "Fake" } as Model<any>;

// ---- Test fakes -------------------------------------------------------------------------------

type RoleFixture = { tools: string[]; canSpawn: string[] };

/** A minimal, literal RoleRegistryView -- deliberately NOT importing anything from the parallel
 * Gate 5 stream's in-flight Role Registry (@conductor/config); RoleRegistryView (ADR §16 appendix)
 * exists exactly to make this decoupling possible. */
function makeRoleRegistry(roles: Record<string, RoleFixture>): RoleRegistryView {
	const views: Record<string, ConductorRoleView> = Object.fromEntries(
		Object.entries(roles).map(([name, r]) => [
			name,
			{ name, tools: r.tools, canSpawn: r.canSpawn, modelRole: "standard" },
		]),
	);
	return {
		get: (roleId) => views[roleId],
		canSpawn: (from, to) => roles[from]?.canSpawn.includes(to) ?? false,
	};
}

/** A plain in-memory SharedBudget fake -- exercises runTask's ORDERING against the interface, not
 * SharedBudget's own concurrency contract (that is shared-budget.test.ts's job). Records every call
 * into the shared `calls` array so tests can assert relative ordering across collaborators. */
function makeRecordingBudget(limit: number, calls: string[]): SharedBudget {
	let spent = 0;
	return {
		limit,
		remaining: () => limit - spent,
		reserve: (estimate) => {
			calls.push("budget.reserve");
			if (!Number.isFinite(estimate) || estimate < 0 || estimate > limit - spent) return null;
			spent += estimate;
			return { estimatedCost: estimate };
		},
		settle: (_reservation, actual) => {
			calls.push("budget.settle");
			spent += actual.total - (_reservation as BudgetReservation).estimatedCost;
		},
	};
}

function fakeSpawnChildSession(
	calls: string[],
	impl: (input: SpawnChildSessionInput) => Promise<SpawnChildSessionResult>,
) {
	return vi.fn(async (input: SpawnChildSessionInput) => {
		calls.push("spawnChildSession");
		return impl(input);
	});
}

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

function baseOptions(overrides: Partial<CreateTaskToolOptions> & { calls?: string[] } = {}): CreateTaskToolOptions {
	const calls = overrides.calls ?? [];
	const effectivePolicy: EffectivePolicyInput = {};
	const auditTrailWriter = createAuditTrailWriter(join(workspace.root, ".conductor", "audit.jsonl"));
	const budget = overrides.sharedBudget ?? makeRecordingBudget(100_000, calls);
	const spawnChildSession =
		overrides.spawnChildSession ??
		fakeSpawnChildSession(calls, async () => ({
			finalText: "done",
			sessionId: "child-session-1",
			sessionFilePath: join(workspace.root, ".conductor-agent", "sessions", "child-session-1.jsonl"),
			tokenUsage: { input: 10, output: 10, total: 20 },
			filesTouched: [],
		}));

	return {
		callerRole: "tech-lead",
		depth: 0,
		maxDepth: 5,
		roleRegistry: makeRoleRegistry({
			"tech-lead": { tools: ["read", "bash"], canSpawn: ["software-engineer"] },
			"software-engineer": { tools: ["read", "write", "edit", "bash"], canSpawn: [] },
			"business-analyst": { tools: ["read"], canSpawn: [] },
			"security-engineer": { tools: ["read", "bash"], canSpawn: [] },
		}),
		sharedBudget: budget,
		workspaceRoot: workspace.root,
		effectivePolicy,
		auditTrailWriter,
		additionalProtectedPaths: [],
		yesFlagActive: false,
		// GAP-5: every test's "parent" is resolved to this same fake model unless a test overrides it.
		model: FAKE_PARENT_MODEL,
		spawnChildSession,
		...overrides,
	};
}

// ---- FR-13/14/15: authorization is decided BEFORE spawning/spending/calling the model ----------

describe("runTask: FR-13 — a role delegating to a target OUTSIDE its own canSpawn is denied before any spawn/budget/model activity", () => {
	it("denies business-analyst -> security-engineer (not in canSpawn), naming the target as not authorized, without ever reserving budget or spawning a child", async () => {
		const calls: string[] = [];
		const spawnChildSession = fakeSpawnChildSession(calls, async () => {
			throw new Error("must not be called: authorization must be decided before spawning");
		});
		const options = baseOptions({ calls, callerRole: "business-analyst", spawnChildSession });
		const params: TaskToolParams = { role: "security-engineer", prompt: "read the incident report" };

		const result = await runTask(params, options);

		expect(calls).toEqual([]); // neither budget.reserve nor spawnChildSession ever ran
		expect(spawnChildSession).not.toHaveBeenCalled();
		// `result.isError` cannot be accessed directly by TypeScript: TaskToolResult's success branch
		// (ADR 0004 §16 appendix) has NO `isError` key at all, not even `isError?: false` -- so a plain
		// `.isError` read requires narrowing first. `toHaveProperty` checks the runtime value without
		// requiring that static narrowing, matching this codebase's own preference for asserting on
		// observable shape over implementation-shaped type gymnastics in a test file.
		expect(result).toHaveProperty("isError", true);
		expect(result.content[0]?.text).toMatch(/security-engineer/);
		expect(result.content[0]?.text).toMatch(/not (authorized|allowed)|canSpawn/i);
	});
});

describe("runTask: FR-14 — a target role that does not exist is refused, never created ad hoc", () => {
	it("denies a task targeting an unknown role by name, distinctly from 'not authorized'", async () => {
		const calls: string[] = [];
		const spawnChildSession = fakeSpawnChildSession(calls, async () => {
			throw new Error("must not be called: an unknown role must never reach spawn");
		});
		const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession });
		const params: TaskToolParams = { role: "role-that-does-not-exist", prompt: "do something" };

		const result = await runTask(params, options);

		expect(calls).toEqual([]);
		expect(spawnChildSession).not.toHaveBeenCalled();
		expect(result).toHaveProperty("isError", true);
		expect(result.content[0]?.text).toMatch(/role-that-does-not-exist/);
		expect(result.content[0]?.text).not.toMatch(/not authorized|canSpawn/i); // distinct failure from FR-13
	});
});

describe("runTask: FR-15 — a delegation chain already at the configured maximum depth is refused before creating another level", () => {
	it("denies delegation when depth + 1 would exceed maxDepth, without spawning or spending budget", async () => {
		const calls: string[] = [];
		const spawnChildSession = fakeSpawnChildSession(calls, async () => {
			throw new Error("must not be called: depth cap must be enforced before spawn");
		});
		const options = baseOptions({ calls, callerRole: "tech-lead", depth: 5, maxDepth: 5, spawnChildSession });
		const params: TaskToolParams = { role: "software-engineer", prompt: "one level too many" };

		const result = await runTask(params, options);

		expect(calls).toEqual([]);
		expect(spawnChildSession).not.toHaveBeenCalled();
		expect(result).toHaveProperty("isError", true);
		expect(result.content[0]?.text).toMatch(/depth|deep|level/i);
	});
});

// ---- FR-16/FR-17: budget is checked BEFORE spawn, exhaustion is graceful -----------------------

describe("runTask: FR-16/FR-17 — budget is reserved before spawning, and exhaustion denies gracefully (no thrown exception escapes runTask)", () => {
	it("an authorized delegation reserves budget BEFORE spawning the child, and settles it after", async () => {
		const calls: string[] = [];
		const options = baseOptions({ calls, callerRole: "tech-lead" });
		const params: TaskToolParams = { role: "software-engineer", prompt: "fix the failing test" };

		await runTask(params, options);

		expect(calls).toEqual(["budget.reserve", "spawnChildSession", "budget.settle"]);
	});

	it("an already-exhausted budget denies the delegation as a graceful TaskToolResult, never a thrown exception, and never spawns a child", async () => {
		const calls: string[] = [];
		const exhaustedBudget: SharedBudget = {
			limit: 100,
			remaining: () => 0,
			reserve: () => {
				calls.push("budget.reserve");
				return null; // SharedBudget's own contract: exhaustion is null, never a throw
			},
			settle: () => calls.push("budget.settle"),
		};
		const spawnChildSession = fakeSpawnChildSession(calls, async () => {
			throw new Error("must not be called: exhausted budget must deny before spawn");
		});
		const options = baseOptions({ calls, callerRole: "tech-lead", sharedBudget: exhaustedBudget, spawnChildSession });
		const params: TaskToolParams = { role: "software-engineer", prompt: "fix the failing test" };

		const result = await runTask(params, options); // must resolve, never reject

		expect(calls).toEqual(["budget.reserve"]);
		expect(spawnChildSession).not.toHaveBeenCalled();
		expect(result).toHaveProperty("isError", true);
		expect(result.content[0]?.text).toMatch(/budget|exhaust/i);
	});
});

// ---- FR-7/BR-5: context isolation ---------------------------------------------------------------

describe("runTask: FR-7/BR-5 — the child's initial context is the target role's persona plus ONLY the task prompt, never the parent's conversation", () => {
	it("spawnChildSession receives exactly the task prompt and role -- no field carries parent conversation history", async () => {
		const calls: string[] = [];
		let capturedInput: SpawnChildSessionInput | undefined;
		const spawnChildSession = fakeSpawnChildSession(calls, async (input) => {
			capturedInput = input;
			return {
				finalText: "done",
				sessionId: "s1",
				sessionFilePath: join(workspace.root, "s1.jsonl"),
				tokenUsage: { input: 1, output: 1, total: 2 },
				filesTouched: [],
			};
		});
		const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession });
		const params: TaskToolParams = { role: "software-engineer", prompt: "fix the bug in foo.ts, ONLY this file" };

		await runTask(params, options);

		expect(capturedInput?.prompt).toBe("fix the bug in foo.ts, ONLY this file");
		// The interface itself (SpawnChildSessionInput, src/tools/task.ts) has no field for the
		// parent's own conversation -- this asserts the ACTUAL object passed at runtime never grew one
		// out-of-band (e.g. by closing over `options` and forwarding something extra).
		expect(Object.keys(capturedInput ?? {}).sort()).toEqual(
			[
				"additionalProtectedPaths",
				"auditTrailWriter",
				"depth",
				"effectivePolicy",
				"model",
				"role",
				"prompt",
				"sessionManager",
				"workspaceRoot",
				"yesFlagActive",
			].sort(),
		);
	});
});

// ---- FR-8: two-channel result --------------------------------------------------------------------

describe("runTask: FR-8 — content and details are two separate channels, never mixed", () => {
	it("content carries the child's own final answer as plain text; details is never JSON-dumped into content", async () => {
		const calls: string[] = [];
		const spawnChildSession = fakeSpawnChildSession(calls, async () => ({
			finalText: "Fixed the off-by-one error in foo.ts.",
			sessionId: "s1",
			sessionFilePath: join(workspace.root, "s1.jsonl"),
			tokenUsage: { input: 5, output: 5, total: 10 },
			filesTouched: ["foo.ts"],
		}));
		const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession });

		const result = await runTask({ role: "software-engineer", prompt: "fix foo.ts" }, options);

		expect(result.content[0]?.text).toBe("Fixed the off-by-one error in foo.ts.");
		expect(result.content[0]?.text).not.toMatch(/"transcript"|"tokenCost"|"filesTouched"/);
		expect(result.details).toBeDefined();
		expect(result.details.filesTouched).toEqual(["foo.ts"]);
	});
});

// ---- FR-18/19: evidence is mandatory and checkable ------------------------------------------------

describe("runTask: FR-18/FR-19 — the returned evidence carries a transcript reference, cost, and (when files changed) the file list", () => {
	it("a successful delegation's details include transcript {sessionId, filePath}, tokenCost, and budgetRemaining", async () => {
		const calls: string[] = [];
		const options = baseOptions({ calls, callerRole: "tech-lead" });

		const result = await runTask({ role: "software-engineer", prompt: "fix the bug" }, options);

		expect(result.details.transcript.sessionId).toBeTruthy();
		expect(result.details.transcript.filePath).toBeTruthy();
		expect(result.details.tokenCost.total).toBeGreaterThan(0);
		expect(typeof result.details.budgetRemaining).toBe("number");
	});

	it("when the task was to change files, a free-text claim with no files listed does NOT satisfy the evidence requirement", async () => {
		const calls: string[] = [];
		// The child CLAIMS success in free text but the runtime-observed file list is empty --
		// FR-19's own text: "uma declaração de texto livre ... sem nenhum arquivo listado não satisfaz
		// este requisito quando a tarefa era, precisamente, alterar arquivos."
		const spawnChildSession = fakeSpawnChildSession(calls, async () => ({
			finalText: "I fixed the bug and the tests pass now.",
			sessionId: "s1",
			sessionFilePath: join(workspace.root, "s1.jsonl"),
			tokenUsage: { input: 5, output: 5, total: 10 },
			filesTouched: [], // nothing the runtime actually observed being written
		}));
		const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession });

		const result = await runTask({ role: "software-engineer", prompt: "fix the bug in foo.ts" }, options);

		// A file-changing task whose runtime-observed filesTouched is empty must be flagged, not
		// silently accepted as a plain success just because the child's prose sounded confident.
		expect(result).toHaveProperty("isError", true);
	});
});

// ---- Evidence is a checkable predicate, not merely a type ------------------------------------------

describe("assertValidTaskToolResult — G6/BR-9/BR-10: evidence is an explicit, checkable requirement, not just a type", () => {
	it("rejects a result missing `details` entirely", () => {
		const malformed = { content: [{ type: "text", text: "done" }] };
		expect(() => assertValidTaskToolResult(malformed)).toThrow(/evidence|details/i);
	});

	it("rejects a result whose details is missing a transcript reference", () => {
		const malformed = {
			content: [{ type: "text", text: "done" }],
			details: {
				role: "software-engineer",
				depth: 1,
				tokenCost: { input: 1, output: 1, total: 2 },
				budgetRemaining: 99,
			},
		};
		expect(() => assertValidTaskToolResult(malformed)).toThrow(/transcript/i);
	});

	it("accepts a well-formed result with a full evidence payload", () => {
		const wellFormed = {
			content: [{ type: "text", text: "done" }],
			details: {
				transcript: { sessionId: "s1", filePath: "/tmp/s1.jsonl" },
				role: "software-engineer",
				depth: 1,
				tokenCost: { input: 1, output: 1, total: 2 },
				budgetRemaining: 99,
			},
		};
		expect(() => assertValidTaskToolResult(wellFormed)).not.toThrow();
	});
});

// ---- T42: the evidence transcript is never returned with a secret in clear ------------------------

describe("runTask: T42 (gate3-addendum-fase3.md §9) — the evidence transcript is never handed back with a secret in clear", () => {
	// Same canary fixture as test/session-redaction.regression.test.ts -- guaranteed-recognized by
	// the shared @conductor/secrets matcher family (known-prefix, not merely high-entropy).
	const CANARY_SECRET = "sk-ant-api03-CANARYCANARYCANARYCANARYCANARYCANARY";

	it("a child that touches a secret produces a details.transcript.filePath whose ON-DISK bytes do not contain the secret in clear (reuses the Fase-2 SessionManager write-path redaction guard, R12/T29, not a 7th sink)", async () => {
		const calls: string[] = [];
		const spawnChildSession = fakeSpawnChildSession(calls, async (input) => {
			// Simulates the child's own bash/read tool result echoing a credential into its transcript --
			// exactly session-redaction.regression.test.ts's fixture shape, applied to a CHILD's session.
			input.sessionManager.appendMessage({
				role: "user",
				content: "read the leaked credential file",
				timestamp: Date.now(),
			});
			input.sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: "1",
				toolName: "bash",
				content: [{ type: "text", text: `stdout: ANTHROPIC_API_KEY=${CANARY_SECRET}` }],
				isError: false,
				timestamp: Date.now(),
			});
			input.sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "found and reported the credential" }],
				api: "messages",
				provider: "anthropic",
				model: "claude-sonnet-5",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			});
			return {
				finalText: "found and reported the credential",
				sessionId: "child-secret-1",
				sessionFilePath: input.sessionManager.getSessionFile() as string,
				tokenUsage: { input: 5, output: 5, total: 10 },
				filesTouched: [],
			};
		});
		const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession });

		const result = await runTask({ role: "software-engineer", prompt: "find the leaked credential" }, options);

		expect(result.details.transcript.filePath).toBeTruthy();
		const persisted = readFileSync(result.details.transcript.filePath, "utf8");
		expect(persisted).not.toContain(CANARY_SECRET);
	});
});

// ---- BR-7: the child's own destructive tools remain gated -- wiring precondition -------------------

describe("runTask: BR-7 — the gate references handed to the child are the SAME objects the caller's own gate uses, never copied or omitted", () => {
	it("effectivePolicy, auditTrailWriter, workspaceRoot, additionalProtectedPaths, and yesFlagActive reach spawnChildSession UNCHANGED (reference equality where applicable) -- a subagent does not get its own, weaker gate state", async () => {
		const calls: string[] = [];
		let capturedInput: SpawnChildSessionInput | undefined;
		const spawnChildSession = fakeSpawnChildSession(calls, async (input) => {
			capturedInput = input;
			return {
				finalText: "done",
				sessionId: "s1",
				sessionFilePath: join(workspace.root, "s1.jsonl"),
				tokenUsage: { input: 1, output: 1, total: 2 },
				filesTouched: [],
			};
		});
		const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession, yesFlagActive: true });

		await runTask({ role: "software-engineer", prompt: "do it" }, options);

		expect(capturedInput?.effectivePolicy).toBe(options.effectivePolicy); // same reference, not a copy
		expect(capturedInput?.auditTrailWriter).toBe(options.auditTrailWriter); // SAME writer -- one audit trail
		expect(capturedInput?.workspaceRoot).toBe(options.workspaceRoot);
		expect(capturedInput?.additionalProtectedPaths).toEqual(options.additionalProtectedPaths);
		expect(capturedInput?.yesFlagActive).toBe(true); // forwarded, not silently reset to a safer-looking default
	});
});

// ---- GAP-5 (quality-baseline, Fase 3 checkpoint): the child NEVER resolves its own model ------------

describe(
	"runTask: GAP-5 — the child always receives the PARENT's own already-resolved model, by reference, " +
		"never undefined and never re-derived",
	() => {
		it("spawnChildSession's input.model is the EXACT SAME object as options.model — not a copy, not a lookalike, not undefined", async () => {
			const calls: string[] = [];
			let capturedInput: SpawnChildSessionInput | undefined;
			const spawnChildSession = fakeSpawnChildSession(calls, async (input) => {
				capturedInput = input;
				return {
					finalText: "done",
					sessionId: "s1",
					sessionFilePath: join(workspace.root, "s1.jsonl"),
					tokenUsage: { input: 1, output: 1, total: 2 },
					filesTouched: [],
				};
			});
			const options = baseOptions({ calls, callerRole: "tech-lead", spawnChildSession });

			await runTask({ role: "software-engineer", prompt: "do it" }, options);

			// Reference equality, the same discriminator BR-7 already uses for effectivePolicy/
			// auditTrailWriter above: this is not merely "a model with the same provider/id fields", it is
			// the literal object the caller resolved. Before the GAP-5 fix, `SpawnChildSessionInput` had no
			// `model` field at all and `createGovernedChildSessionSpawner` never passed one to the real
			// `createAgentSession` call, which is exactly what let Pi's own `findInitialModel` fallback
			// silently auto-discover (and call) an unconsented provider (see tools/task.ts's own
			// `SpawnChildSessionInput.model` and `createGovernedChildSessionSpawner` doc comments).
			expect(capturedInput?.model).toBe(options.model);
			expect(capturedInput?.model).toBe(FAKE_PARENT_MODEL);
			expect(capturedInput?.model).toBeDefined();
		});

		it("a DIFFERENT parent model is forwarded just as faithfully -- proving this is the caller's own resolved model, never a hardcoded/default fixture", async () => {
			const calls: string[] = [];
			let capturedInput: SpawnChildSessionInput | undefined;
			const spawnChildSession = fakeSpawnChildSession(calls, async (input) => {
				capturedInput = input;
				return {
					finalText: "done",
					sessionId: "s1",
					sessionFilePath: join(workspace.root, "s1.jsonl"),
					tokenUsage: { input: 1, output: 1, total: 2 },
					filesTouched: [],
				};
			});
			const anotherParentModel = { provider: "anthropic", id: "claude-real-model", name: "Real" } as Model<any>;
			const options = baseOptions({
				calls,
				callerRole: "tech-lead",
				spawnChildSession,
				model: anotherParentModel,
			});

			await runTask({ role: "software-engineer", prompt: "do it" }, options);

			expect(capturedInput?.model).toBe(anotherParentModel);
			expect(capturedInput?.model).not.toBe(FAKE_PARENT_MODEL);
		});
	},
);
