/**
 * Test-first (Gate 5) for the pure `GateState` policy (src/gate-state-policy.ts:
 * `evaluateAdvance`/`isMandatorySatisfied`/`evaluateCalibration`) — Fase 4 "Gates e evidências",
 * ADR 0005 §4/§5/§7/§18, gate2-spec-fase4.md FR-2/FR-3/FR-8, gate3-addendum-fase4.md T42/T45/T46,
 * rules R23/R24/R26.
 *
 * All three functions are currently STUBS that throw "not implemented" (src/gate-state-policy.ts) —
 * every test below drives the REAL, locked interface directly against plain `GateState` object
 * fixtures (Unit Testing Principles — Complete Professional Guide §3.9/§3.12: "the real collaborator
 * is cheap and in-process... a value object, a pure calculator" — a `GateState` fixture built by
 * `makeGateState()` below is exactly that case, so this file never substitutes a mock/double for
 * the thing under test or its input) and fails RED for the single correct reason: Gate 6 has not
 * written the body yet.
 */

import { describe, expect, it } from "vitest";
import type { GateRecord, GateState } from "../src/gate-state.ts";
import { evaluateAdvance, evaluateCalibration, isMandatorySatisfied } from "../src/gate-state-policy.ts";

const MANDATORY_GATES: ReadonlySet<number> = new Set([3, 5, 7, 8, 9]);
const DEMAND_ID = "demand-fase4";
const BRANCH = "feature/fase4-gates-e-evidencias";

function approvedRecord(gate: number, overrides: Partial<GateRecord> = {}): GateRecord {
	return {
		gate,
		status: "approved",
		evidence: [
			{
				gate,
				ref: { kind: "test-run", id: `run-${gate}` },
				provenance: "runtime-derived",
				recordedAt: "2026-08-06T00:00:00.000Z",
			},
		],
		decisions: [],
		risks: [],
		approvals: [
			{
				gate,
				demandId: DEMAND_ID,
				branch: BRANCH,
				method: "human",
				source: "session-abc",
				approvedAt: "2026-08-06T00:00:00.000Z",
			},
		],
		startedAt: "2026-08-05T00:00:00.000Z",
		completedAt: "2026-08-06T00:00:00.000Z",
		...overrides,
	};
}

function notStartedRecord(gate: number): GateRecord {
	return { gate, status: "not-started", evidence: [], decisions: [], risks: [], approvals: [] };
}

/** Builds a GateState where every mandatory gate below `upToGate` is genuinely approved
 * (evidence + correctly-keyed approval) — the "everything is fine" baseline other tests mutate one
 * field away from. */
function makeGateState(upToGate: number, overrides: Partial<GateState> = {}): GateState {
	const gates: Record<number, GateRecord> = {};
	for (let gate = 1; gate < upToGate; gate++) {
		gates[gate] = MANDATORY_GATES.has(gate) ? approvedRecord(gate) : notStartedRecord(gate);
	}
	gates[upToGate] = notStartedRecord(upToGate);
	return {
		demandId: DEMAND_ID,
		repoId: "repo-pi",
		branch: BRANCH,
		currentGate: upToGate - 1,
		gates,
		startedAt: "2026-08-05T00:00:00.000Z",
		...overrides,
	};
}

// ---------------------------------------------------------------------------------------------
// Test 5 (task brief) — piso obrigatório (R23/T42): gate start 6 refuses fail-closed if a
// mandatory gate below 6 is not approved, NAMING the missing one(s). Approving an "empty"
// mandatory (no evidence) is refused.
// ---------------------------------------------------------------------------------------------

describe("evaluateAdvance / isMandatorySatisfied — the mandatory floor (R23/T42, FR-2/FR-8)", () => {
	it("refuses `gate start 6` fail-closed, NAMING Gate 3 and Gate 5 as missing, when both are not-started", () => {
		const state = makeGateState(6, {
			gates: { ...makeGateState(6).gates, 3: notStartedRecord(3), 5: notStartedRecord(5) },
		});

		const verdict = evaluateAdvance(state, 6, MANDATORY_GATES);

		expect(verdict.kind).toBe("refused");
		if (verdict.kind === "refused") {
			expect(verdict.missingMandatoryGates.sort()).toEqual([3, 5]);
		}
	});

	it("refuses `gate start 6` fail-closed, naming ONLY Gate 3, when Gate 5 is genuinely approved but Gate 3 was rejected", () => {
		const base = makeGateState(6);
		const state: GateState = { ...base, gates: { ...base.gates, 3: { ...notStartedRecord(3), status: "rejected" } } };

		const verdict = evaluateAdvance(state, 6, MANDATORY_GATES);

		expect(verdict.kind).toBe("refused");
		if (verdict.kind === "refused") {
			expect(verdict.missingMandatoryGates).toEqual([3]);
		}
	});

	it("approves `gate start 6` when every mandatory gate below 6 (only Gate 3 and Gate 5, since 7/8/9 are above) is genuinely approved", () => {
		const state = makeGateState(6);

		const verdict = evaluateAdvance(state, 6, MANDATORY_GATES);

		expect(verdict.kind).toBe("approved");
	});

	it("BR-6/FR-8: a mandatory gate marked status:'approved' but carrying ZERO evidence is NOT treated as satisfying the floor — the status field alone is not authoritative", () => {
		const base = makeGateState(6);
		const emptyApproval = approvedRecord(3, { evidence: [] });
		const state: GateState = { ...base, gates: { ...base.gates, 3: emptyApproval } };

		expect(isMandatorySatisfied(state, 6, MANDATORY_GATES)).toBe(false);

		const verdict = evaluateAdvance(state, 6, MANDATORY_GATES);
		expect(verdict.kind).toBe("refused");
		if (verdict.kind === "refused") expect(verdict.missingMandatoryGates).toContain(3);
	});

	it("R25 golden rule integration: evidence that is present but ENTIRELY author-declared (never runtime-derived) does not satisfy a mandatory gate either — a free-text --ref alone never closes an obrigatório (gate-evidence.ts's hasSufficientEvidenceForMandatoryGate contract)", () => {
		const base = makeGateState(6);
		const onlyAuthorDeclared = approvedRecord(3, {
			evidence: [
				{
					gate: 3,
					ref: { kind: "file", path: "docs/some-doc.md" },
					provenance: "author-declared",
					recordedAt: "2026-08-06T00:00:00.000Z",
				},
			],
		});
		const state: GateState = { ...base, gates: { ...base.gates, 3: onlyAuthorDeclared } };

		expect(isMandatorySatisfied(state, 6, MANDATORY_GATES)).toBe(false);
	});

	// GATE 8 LOOP-BACK: re-read of R25/T41 (gate-evidence.ts's own updated header has the full
	// reasoning) -- a git-commit ref that genuinely RESOLVED (provenance "author-declared", the only
	// value resolveEvidenceRef ever produces for it) is now, alone, sufficient to satisfy the mandatory
	// floor at the FULL integration level (isMandatorySatisfied -> isGateGenuinelyApproved ->
	// hasSufficientEvidenceForMandatoryGate), not just at gate-evidence.ts's own unit level. This is the
	// exact scenario Gate 8 reproduced live and found blocked: a real commit sha attached to a mandatory
	// gate, with a genuine keyed Approval, still could not close it before this loop-back.
	it("R25 golden rule extension (Gate 8 loop-back): a genuinely RESOLVED git-commit ref alone (author-declared) DOES satisfy a mandatory gate -- interim Tier-1 acceptance until Fase 6's runtime ledgers exist", () => {
		const base = makeGateState(6);
		const gitCommitOnly = approvedRecord(3, {
			evidence: [
				{
					gate: 3,
					ref: { kind: "git-commit", sha: "deadbeefcafefeed0000000000000000000000" },
					provenance: "author-declared",
					recordedAt: "2026-08-06T00:00:00.000Z",
				},
			],
		});
		const state: GateState = { ...base, gates: { ...base.gates, 3: gitCommitOnly } };

		expect(isMandatorySatisfied(state, 6, MANDATORY_GATES)).toBe(true);

		const verdict = evaluateAdvance(state, 6, MANDATORY_GATES);
		expect(verdict.kind).toBe("approved");
	});

	it("R23(iv) anti-spoofing (the _is_approval/D7-D8 form of gate_land.py): an Approval structurally borrowed from a DIFFERENT gate does not count for Gate 3, even though it is otherwise well-formed and the record has evidence", () => {
		const base = makeGateState(6);
		const borrowedApproval = approvedRecord(3, {
			// This Approval is keyed to gate 5, not gate 3 — it must never be accepted as proof that
			// Gate 3 itself was approved, however coincidentally well-formed it looks.
			approvals: [
				{
					gate: 5,
					demandId: DEMAND_ID,
					branch: BRANCH,
					method: "human",
					source: "session-abc",
					approvedAt: "2026-08-06T00:00:00.000Z",
				},
			],
		});
		const state: GateState = { ...base, gates: { ...base.gates, 3: borrowedApproval } };

		expect(isMandatorySatisfied(state, 6, MANDATORY_GATES)).toBe(false);
	});

	it("R23(iv) anti-spoofing: an Approval borrowed from a DIFFERENT demandId/branch does not count, even when the gate number matches", () => {
		const base = makeGateState(6);
		const borrowedApproval = approvedRecord(3, {
			approvals: [
				{
					gate: 3,
					demandId: "some-other-demand",
					branch: "feature/some-other-branch",
					method: "human",
					source: "session-abc",
					approvedAt: "2026-08-06T00:00:00.000Z",
				},
			],
		});
		const state: GateState = { ...base, gates: { ...base.gates, 3: borrowedApproval } };

		expect(isMandatorySatisfied(state, 6, MANDATORY_GATES)).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------
// Test 4 (task brief) — verdict terminal (R26/T46): an unanticipated exception mid-evaluation
// also denies, never a permissive catch/default. Mirrors gate_land.py's own
// TestF10ArbitraryException (ADR 0005 §7 Ruling B).
// ---------------------------------------------------------------------------------------------

describe("evaluateAdvance — the terminal property (R26/T46): an unanticipated exception mid-evaluation denies, never approves", () => {
	it("a GateState whose `gates` property throws when READ (a hostile getter simulating a cause nobody anticipated) resolves to could-not-verify — NEVER approved, and never an uncaught crash out of evaluateAdvance itself", () => {
		const hostileState = makeGateState(6);
		Object.defineProperty(hostileState, "gates", {
			get(): never {
				throw new TypeError("simulated unanticipated failure reading GateState.gates");
			},
			configurable: true,
		});

		const verdict = evaluateAdvance(hostileState, 6, MANDATORY_GATES);

		expect(verdict.kind).toBe("could-not-verify");
		expect(verdict.kind).not.toBe("approved");
	});

	it("a GateState whose currentGate getter throws also resolves to could-not-verify, never approved (the property is TERMINAL — it does not matter WHICH field the unanticipated exception came from)", () => {
		const hostileState = makeGateState(6);
		Object.defineProperty(hostileState, "currentGate", {
			get(): never {
				throw new RangeError("simulated unanticipated failure reading GateState.currentGate");
			},
			configurable: true,
		});

		const verdict = evaluateAdvance(hostileState, 6, MANDATORY_GATES);

		expect(verdict.kind).toBe("could-not-verify");
		expect(verdict.kind).not.toBe("approved");
	});
});

// ---------------------------------------------------------------------------------------------
// Test 6 (task brief) — calibração nunca alcança o piso (R24/T45): a calibration that tries to
// collapse a mandatory gate is refused AT REGISTRATION, never silently accepted.
// ---------------------------------------------------------------------------------------------

describe("evaluateCalibration — the mandatory floor is intocável by calibration (R24/T45, BR-1)", () => {
	it("refuses a calibration that names a mandatory gate (Gate 3) among collapsedGates, naming Gate 3 as the offender", () => {
		const result = evaluateCalibration([1, 2, 3, 4], MANDATORY_GATES);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.offendingMandatory).toEqual([3]);
	});

	it("refuses a calibration naming MULTIPLE mandatory gates, naming all of them — never just the first offender found", () => {
		const result = evaluateCalibration([3, 5, 7, 8, 9, 1, 2], MANDATORY_GATES);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.offendingMandatory.sort((a, b) => a - b)).toEqual([3, 5, 7, 8, 9]);
	});

	it("accepts a calibration that collapses ONLY gates outside the mandatory floor ('small bug: collapse 1-2 and 10-14')", () => {
		const result = evaluateCalibration([1, 2, 10, 11, 12, 13, 14], MANDATORY_GATES);

		expect(result.ok).toBe(true);
	});

	it("accepts an empty collapse list (a calibration that declares nothing collapsed is trivially disjoint from the mandatory set)", () => {
		const result = evaluateCalibration([], MANDATORY_GATES);

		expect(result.ok).toBe(true);
	});
});
