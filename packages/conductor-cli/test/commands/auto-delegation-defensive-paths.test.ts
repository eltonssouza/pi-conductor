/**
 * Coverage-closing tests for `runGateDelegation` (`src/commands/auto.ts`, Gate 6 implementation of ADR
 * 0010) written during the Gate 6 quality-baseline pass (category 3: "every error path has a test").
 *
 * `test/commands/auto-delegation.test.ts` (the Gate 5 spec, not edited by this file) already covers N1
 * (tools-empty role refusal against the REAL role catalog), the success path, GAP-D, D8's context-limit
 * math, and D9's thrown-spawn degrade. Reviewing `runGateDelegation`'s own `GateDelegationOutcome` failure
 * table (ADR 0010 §11/D9) against that suite left two named, reachable failure branches with no direct
 * test:
 *
 *   1. **FR-1b (D2):** the lead role slug (`BUILTIN_GATE_ROLES[gate][0]`) is not registered at all in the
 *      injected `roleRegistry` (`role === undefined`) — distinct from N1's "resolves but with `tools:[]`"
 *      case. ADR §4/D2 names this explicitly: "role === undefined (scaffold incompleto do projeto) →
 *      needs-human (FR-1b)".
 *   2. **FR-7b (D6/D9):** `sharedBudget.reserve(...)` returns `null` (the budget is exhausted or
 *      unreadable) — a SECOND, distinct checkpoint from the loop's own top-of-gate reservation (ADR §8/D6:
 *      "um segundo ponto de checagem"). `GateDelegationOutcome` must degrade to `{kind:"stop",
 *      reason:"budget-exceeded"}`, never `"needs-human"` (the two stay distinct per D9's own table).
 *
 * These are written and verified AFTER `runGateDelegation`'s implementation (not strict red-green for
 * these two specific branches — the primary Gate-5 spec already carried that discipline for the function
 * as a whole); they exist to close a real, disclosed test-coverage gap rather than leave it silently
 * unassessed. `createGovernedChildSessionSpawner`/the Pi SDK are never reached by either scenario below
 * (both refuse before any spawn attempt), so neither test needs to mock `@earendil-works/pi-coding-agent`.
 *
 * Two other defensive branches in `runGateDelegation` (`BUILTIN_GATE_ROLES[gate]` missing an entry for
 * `gate`, and `GATE_DELEGATION_TEMPLATES[gate]` missing an entry) are deliberately NOT tested here: both
 * are structurally unreachable today given `BUILTIN_GATE_ROLES`/`GATE_DELEGATION_TEMPLATES`'s own closed,
 * asserted 1-14 domain (the latter cross-checked directly by `auto-delegation-templates.test.ts`) — the
 * same "exhaustiveness guard, not a reachable case" precedent `gate-evidence.ts`'s own `resolveEvidenceRef`
 * default branch already documents in this codebase.
 */

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EXIT_BUDGET_EXCEEDED, EXIT_STOPPED, runGateDelegation } from "../../src/commands/auto.ts";
import { alwaysSatisfiedModelResolutionPort } from "../support/model-resolution-port.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const { createAuditTrailWriter, createSharedBudget } = await import("@conductor/runtime");

const NOOP_WRITER = { write(_chunk: string): void {} };

describe("runGateDelegation -- FR-1b/D2: the lead role slug is not registered at all (distinct from N1's tools:[] case)", () => {
	it("refuses cleanly (kind:'stop', reason:'needs-human') and names the gate, never attempting a spawn", async () => {
		const project: ScratchProject = createScratchProject();
		try {
			const recordDelegationSessionId = vi.fn();
			const attachDelegationEvidence = vi.fn();

			const outcome = await runGateDelegation({
				gate: 6,
				io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
				// A role registry that has NOTHING registered -- simulates an incomplete project scaffold
				// (ADR 0010 §4/D2's own "scaffold incompleto" case), distinct from a role that resolves but
				// with tools:[] (N1, covered by auto-delegation.test.ts).
				roleRegistry: { get: () => undefined, canSpawn: () => false },
				modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
				sharedBudget: createSharedBudget(1_000_000),
				effectivePolicyInput: {},
				auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
				demandId: "demand-1",
				branch: "feature/demand-1",
				recordDelegationSessionId,
				attachDelegationEvidence,
			});

			expect(outcome.kind).toBe("stop");
			if (outcome.kind === "stop") {
				expect(outcome.reason).toBe("needs-human");
				expect(outcome.exitCode).toBe(EXIT_STOPPED);
				expect(outcome.detail).toMatch(/gate 6/);
			}
			expect(recordDelegationSessionId).not.toHaveBeenCalled();
			expect(attachDelegationEvidence).not.toHaveBeenCalled();
		} finally {
			project.cleanup();
		}
	});
});

describe("runGateDelegation -- FR-7b/D6/D9: the per-delegation budget reservation is exhausted", () => {
	it("refuses (kind:'stop', reason:'budget-exceeded', exitCode:EXIT_BUDGET_EXCEEDED) BEFORE any spawn attempt, distinct from needs-human", async () => {
		const project: ScratchProject = createScratchProject();
		try {
			const recordDelegationSessionId = vi.fn();
			const attachDelegationEvidence = vi.fn();

			const outcome = await runGateDelegation({
				gate: 6,
				io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
				// A role WITH tools, so this reaches D6's reserve() call rather than refusing earlier at D2.
				roleRegistry: {
					get: (id: string) =>
						id === "software-engineer"
							? {
									name: "software-engineer",
									tools: ["read", "write"],
									canSpawn: [],
									modelRole: "standard" as const,
								}
							: undefined,
					canSpawn: () => true,
				},
				modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
				// A zero-limit budget: reserve(DELEGATION_TOKEN_RESERVE_ESTIMATE) must return null (any
				// positive estimate exceeds a zero limit) -- SharedBudget's own documented contract
				// (shared-budget.ts: "an estimate that isn't ... denied outright").
				sharedBudget: createSharedBudget(0),
				effectivePolicyInput: {},
				auditTrailWriter: createAuditTrailWriter(join(project.root, ".conductor", "audit.jsonl")),
				demandId: "demand-1",
				branch: "feature/demand-1",
				recordDelegationSessionId,
				attachDelegationEvidence,
			});

			expect(outcome.kind).toBe("stop");
			if (outcome.kind === "stop") {
				expect(outcome.reason).toBe("budget-exceeded");
				expect(outcome.exitCode).toBe(EXIT_BUDGET_EXCEEDED);
				expect(outcome.detail.length).toBeGreaterThan(0);
			}
			expect(recordDelegationSessionId).not.toHaveBeenCalled();
			expect(attachDelegationEvidence).not.toHaveBeenCalled();
		} finally {
			project.cleanup();
		}
	});
});
