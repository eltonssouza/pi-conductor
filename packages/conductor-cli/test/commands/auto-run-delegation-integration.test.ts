/**
 * Loop-level integration tests for the `feature/auto-subagent-delegation` wiring (ADR 0010 §3.1/D1):
 * `runGateDelegation` is now called from INSIDE `runAuto`'s own per-gate loop, between step (b)
 * `runGateStart` and step (d) the secret-scan, exactly at the insertion point ADR 0010 §3.1 specifies.
 *
 * `test/commands/auto-delegation.test.ts`/`auto-delegation-defensive-paths.test.ts` already prove
 * `runGateDelegation`'s OWN logic in isolation (role selection, model resolution, the builder, D8's
 * context-limit math, D9's degrade-to-stop discipline). This file proves the WIRING: that `runAuto`
 * itself, driven end-to-end, actually reaches that function, actually routes its outcome through the
 * SAME `stopRun` machinery every other step in the loop uses, and actually attaches the evidence it
 * produces to the real, persisted `GateState` -- not just that the standalone function works when called
 * directly.
 *
 * Two `CliIO` fields make this possible: `roleRegistry`/`modelResolutionPort` (both TEST SEAMS ONLY,
 * `auto.ts`'s own `CliIO` doc comments) -- added by this demand because, without them, `runAuto` always
 * resolves the REAL, file-backed 37-role catalog, and EVERY real built-in role resolves with `tools:[]`
 * today (GAP-2, Fase 3, confirmed live by `auto-delegation.test.ts`'s own N1 test). A test driving
 * `runAuto` with no seam at all can therefore only ever observe the fail-closed refusal path (test A
 * below) -- proving genuine delegation SUCCESS end-to-end through the real loop needs a controllable
 * role/model, the same "object seam: depend on an interface so a test can supply a fixture" pattern
 * `cli.ts`'s own `CliIO.isInteractive`/`createModelRuntime` already established for other hard-to-fake
 * collaborators. Grounding: `cdt library "injecting an optional, backward-compatible test seam for a
 * hard-to-fake collaborator ... into a CLI composition root" --gate 6` (from
 * `C:\development\source\projects\conductor`) returned **Working with Legacy Code -- Complete
 * Professional Guide §2.3 "kinds of seams"** ("the object seam ... depend on an interface ... so a test
 * can supply [a fixture]") and **§2.10 "Anti-patterns: seams"** ("Prefer object seams ... Make the
 * seam-introducing edit as small as possible. Put time, randomness, and I/O behind seams routinely") --
 * top score 0.667, directly on point (stronger than most of this fase's own citations, which the
 * project's own diary already records as topping out around 0.55-0.61 for agent-orchestration topics).
 *
 * The Pi SDK's own `createAgentSession` is intercepted at module load (mirrors
 * `auto-delegation.test.ts`'s own established pattern exactly) so a genuine delegation spawn in test B/C
 * below never makes a real model/network call -- every other real collaborator
 * (`createGovernedChildSessionSpawner`, `SessionManager`, the permission-gate extension, the REAL
 * `runGateStart`/`runGateEvidence`/`store.approveAuto` composition) stays real.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

// ---- The one seam this file needs beyond CliIO's own: intercept the Pi SDK's own session-turn
// boundary, never the rest of the real spawn/permission/session-manager wiring -- same convention
// auto-delegation.test.ts already established, configured per-test via this hoisted `state`.
const state = vi.hoisted(() => ({
	createAgentSessionCalls: 0,
	tokenUsage: { input: 0, output: 0, total: 0 },
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		createAgentSession: vi.fn(async () => {
			state.createAgentSessionCalls += 1;
			return {
				session: {
					prompt: async () => {},
					getSessionStats: () => ({ tokens: state.tokenUsage }),
					getLastAssistantText: () => "delegated work done",
				},
				extensionsResult: { registeredTools: [], slashCommands: [] },
			};
		}),
	};
});

// Imported AFTER vi.mock (vitest hoists vi.mock above imports at transform time) -- same convention as
// auto-delegation.test.ts, so @conductor/runtime's own transitive
// `import { createAgentSession } from "@earendil-works/pi-coding-agent"` binds to the mock above.
const { EXIT_STOPPED, runAuto } = await import("../../src/commands/auto.ts");
const { createPersistedGateStateStore, resolveGateGitContext } = await import("../../src/commands/gate-store.ts");
const { alwaysInteractiveWitness } = await import("../support/interactivity-witness.ts");

const NOOP_WRITER = { write(_chunk: string): void {} };

function capturingWriter(): { write(chunk: string): void; text(): string } {
	const chunks: string[] = [];
	return {
		write: (chunk: string) => {
			chunks.push(chunk);
		},
		text: () => chunks.join(""),
	};
}

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
		contextWindow: 1_000,
		maxTokens: 8192,
		...overrides,
	} as Model<Api>;
}

/** Resolves every gate/persona to the same fixture model -- this suite's subject is the LOOP-LEVEL
 * wiring, not model-resolution policy itself (`model-precondition.test.ts`'s own job). */
function alwaysResolvesFixtureModel() {
	const model = fixtureModel();
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

/** A fixture `RoleRegistryView` whose only resolvable entry is gate 1's own real lead role slug
 * ("product-manager", `BUILTIN_GATE_ROLES[1][0]`) -- deliberately narrow (unlike a catalog that
 * resolves everything) so this test proves the delegation genuinely consulted the injected registry by
 * SLUG, not a blanket stand-in. */
function fixtureRoleRegistryWithTools(roleId: string, tools: string[]) {
	return {
		get: (id: string) =>
			id === roleId ? { name: roleId, tools, canSpawn: [], modelRole: "standard" as const } : undefined,
		canSpawn: () => true,
	};
}

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
		.toString()
		.trim();
}

function initRepoWithOneCommit(root: string, branch: string): void {
	git(["init", "--initial-branch", branch], root);
	git(["config", "user.email", "conductor-test@example.invalid"], root);
	git(["config", "user.name", "Conductor Test"], root);
	git(["commit", "--allow-empty", "-m", "initial"], root);
}

/** Mirrors auto-run.test.ts's own makeStore -- derives repoId/branch via the SAME
 * resolveGateGitContext(cwd) runAuto uses internally, so this store and runAuto's own internal store
 * are the identical on-disk file (Gate 8 loop-back, finding 2 -- inherited discipline). */
async function makeStore(root: string) {
	const gitContext = await resolveGateGitContext(root);
	return createPersistedGateStateStore({
		gatesDir: join(root, ".conductor", "gates"),
		repoId: gitContext.repoId,
		branch: gitContext.branch,
		modelResolutionPort: alwaysResolvesFixtureModel(),
		isInteractive: alwaysInteractiveWitness(),
	});
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
	initRepoWithOneCommit(project.root, "feature/demand-1");
	state.createAgentSessionCalls = 0;
	state.tokenUsage = { input: 0, output: 0, total: 0 };
});

afterEach(() => {
	project.cleanup();
	vi.clearAllMocks();
});

describe("runAuto -- ADR 0010 wiring, test A: the REAL (empty-tools) role catalog stops needs-human AT THE DELEGATION STEP of gate 1, a disclosed behavior change from Fase 8", () => {
	it("a fresh, low-risk-authorized run with NO roleRegistry seam (production shape) never even reaches step (f) approve -- it refuses at step (c), before any spawn, and gate 1 is never approved", async () => {
		const stderr = capturingWriter();

		const exitCode = await runAuto({
			demand: "demand-1",
			riskLow: true,
			io: {
				cwd: project.root,
				stdout: NOOP_WRITER,
				stderr,
				// Model resolution is stubbed (portable/hermetic across machines) but roleRegistry is
				// DELIBERATELY left unset -- this is the whole point of test A: production never sets
				// it, so runAuto falls back to loadRealRoleRegistryAndSkills, the REAL 37-role catalog.
				modelResolutionPort: alwaysResolvesFixtureModel(),
			},
		});

		// Before this demand: this exact scenario stopped needs-human too, but at step (f) approve
		// (Gate 8 loop-back finding 1 -- approveAuto's own evidence.length===0 guard). Since this
		// demand's wiring, the run never reaches (f) at all: runGateDelegation itself refuses at step
		// (c) because the real "product-manager" lead role (BUILTIN_GATE_ROLES[1][0]) resolves with
		// tools:[] (GAP-2/N1). The OBSERVABLE outcome (reason/exit code) is unchanged -- proving this is
		// a genuine behavior change in WHERE the run stops, never a change in the caller-visible
		// contract `auto-run.test.ts`'s own pre-existing tests already lock in.
		expect(exitCode).toBe(EXIT_STOPPED);
		expect(stderr.text()).toMatch(/gate 1 delegation stopped/i);
		expect(stderr.text()).toMatch(/product-manager/i);
		expect(stderr.text()).toMatch(/tools/i);
		// The real Pi SDK boundary was NEVER reached -- confirms the stop happened before any spawn
		// attempt, not merely that the run stopped for some other reason downstream.
		expect(state.createAgentSessionCalls).toBe(0);

		const store = await makeStore(project.root);
		const gate1 = store.status("demand-1").gates.find((g) => g.gate === 1);
		expect(gate1?.status).not.toBe("approved");
		// Zero evidence was ever attached -- delegation refused before it could call
		// attachDelegationEvidence, distinct from "evidence existed but approval itself failed".
		expect(gate1?.evidenceCount ?? 0).toBe(0);
	});
});

describe("runAuto -- ADR 0010 wiring, test B: a fixture role WITH tools genuinely delegates through the real loop and attaches real {kind:'delegation'} evidence", () => {
	it("gate 1 (non-mandatory) is approved for real, backed by genuine runtime-derived delegation evidence attached via runGateEvidence -- not a hollow/bare-evidence completion", async () => {
		state.tokenUsage = { input: 50, output: 50, total: 100 }; // well under 90% of the 1_000 fixture window

		const exitCode = await runAuto({
			demand: "demand-1",
			riskLow: true,
			io: {
				cwd: project.root,
				stdout: NOOP_WRITER,
				stderr: NOOP_WRITER,
				modelResolutionPort: alwaysResolvesFixtureModel(),
				// The ONE role this fixture resolves is gate 1's real lead role slug ("product-manager"),
				// WITH tools -- proving runGateDelegation, called from inside runAuto's real loop,
				// genuinely looked up BUILTIN_GATE_ROLES[1][0] against the injected registry.
				roleRegistry: fixtureRoleRegistryWithTools("product-manager", ["read", "write"]),
			},
		});

		// A genuine spawn happened (through the real createGovernedChildSessionSpawner, only the Pi SDK
		// boundary intercepted) -- this is the proof this is not a hollow completion.
		expect(state.createAgentSessionCalls).toBe(1);

		const store = await makeStore(project.root);
		const gate1 = store.status("demand-1").gates.find((g) => g.gate === 1);
		// Non-mandatory gate 1's own approveAuto guard (Gate 8 loop-back finding 1, unchanged by this
		// demand) requires evidence.length > 0 -- it is satisfied here by REAL delegation evidence
		// runGateDelegation attached via runGateEvidence -> resolveEvidenceRef, not a caller-declared
		// guess (resolveEvidenceRef would refuse a sessionId the runtime never actually observed).
		expect(gate1?.status).toBe("approved");
		expect(gate1?.evidenceCount ?? 0).toBeGreaterThan(0);

		// The run keeps going past gate 1 (gate 2's lead role, "product-owner", is NOT in this fixture's
		// registry, so it refuses at its own delegation step) -- exitCode reflects THAT later stop, not
		// gate 1's own outcome. What matters for this test is gate 1's real, evidence-backed approval
		// above; this assertion only pins that the run did not crash or silently fabricate a "landed".
		expect(exitCode).toBe(EXIT_STOPPED);
	});
});

describe("runAuto -- ADR 0010 wiring, test C: D8's context-limit fires for real through the loop, with a written checkpoint", () => {
	it("when the delegated child's own per-call token usage crosses 90% of its resolved model's context window, runAuto stops with stop_reason:'context-limit' AFTER gate 1 was genuinely approved, and writes the run checkpoint", async () => {
		state.tokenUsage = { input: 500, output: 450, total: 950 }; // >= 900 (90% of the 1_000 fixture window)

		const exitCode = await runAuto({
			demand: "demand-1",
			riskLow: true,
			io: {
				cwd: project.root,
				stdout: NOOP_WRITER,
				stderr: NOOP_WRITER,
				modelResolutionPort: alwaysResolvesFixtureModel(),
				roleRegistry: fixtureRoleRegistryWithTools("product-manager", ["read", "write"]),
			},
		});

		expect(exitCode).toBe(EXIT_STOPPED);
		expect(state.createAgentSessionCalls).toBe(1);

		// D8/§10 (ADR 0010): the crossing is checked at the GATE BOUNDARY (step h), after gate 1 was
		// already genuinely approved and pushed -- never mid-gate, never blocking the gate's own
		// conclusion. The delegation succeeded; the RUN still stops, because the child's own context
		// window is what "context-limit" measures, not whether the gate closed.
		const store = await makeStore(project.root);
		const gate1 = store.status("demand-1").gates.find((g) => g.gate === 1);
		expect(gate1?.status).toBe("approved");

		// The checkpoint is REAL, written to the protected `.conductor/auto/<slug>.continue.json` path
		// (RunCheckpoint's own doc comment) -- this is the FIRST scenario in this codebase's history
		// where a genuine `stop_reason:"context-limit"` checkpoint is ever produced (ADR 0009 §20,
		// closed by ADR 0010/D8).
		const checkpointPath = join(project.root, ".conductor", "auto", "demand-1.continue.json");
		expect(existsSync(checkpointPath)).toBe(true);
		const checkpoint = project.readJson<{ stop_reason: string; last_gate: number }>(
			".conductor/auto/demand-1.continue.json",
		);
		expect(checkpoint.stop_reason).toBe("context-limit");
		expect(checkpoint.last_gate).toBe(1);
	});
});
