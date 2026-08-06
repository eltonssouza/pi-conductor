/**
 * Test-first (Gate 5) for `conductor gate status/start/evidence/approve/reject/calibrate`
 * (src/commands/gate.ts) — Fase 4 "Gates e evidências", ADR 0005 §2/§18 appendix CLI surface,
 * gate2-spec-fase4.md Grupos A-F.
 *
 * Every `run*` function under test is currently a STUB that unconditionally throws "not implemented"
 * (src/commands/gate.ts) — every test below fails RED for that one reason today, the same precedent
 * `@conductor/runtime`'s own `test/tools/task.test.ts` documents for `runTask` at its own Gate 5. They
 * are written against a working FAKE `GateStateStoreView` (`test/support/fake-gate-store.ts`) so that
 * once Gate 6 wires `run*` to a real store (the parallel GateStateStore stream's own work, integration
 * pending — see `commands/gate.ts`'s own header), each test becomes the actual proof of the FR it names
 * — not a redundant re-statement of "it doesn't throw".
 */

import type { ResolveEvidenceRefContext } from "@conductor/runtime";
import { describe, expect, it } from "vitest";
import {
	formatGateStatusReport,
	type GateStatusSnapshot,
	runGateApprove,
	runGateCalibrate,
	runGateEvidence,
	runGateReject,
	runGateStart,
	runGateStatus,
} from "../../src/commands/gate.ts";
import { createFakeGateStore } from "../support/fake-gate-store.ts";

const DEMAND = "demand-1";

/** A controllable `resolveEvidenceRef` context for unit-testing `runGateEvidence` in isolation --
 * `resolveEvidenceRef` itself is already exhaustively unit-tested against real fs/git collaborators in
 * `gate-evidence.test.ts`; these tests are about `runGateEvidence`'s OWN wiring (does it call
 * resolution, does it fail-closed, does it forward the RESOLVED provenance) — so a fixture whose
 * outcome is set directly by the test, never real I/O, is the right level here. */
function evidenceContext(overrides: Partial<ResolveEvidenceRefContext> = {}): ResolveEvidenceRefContext {
	return {
		repoRoot: "/tmp",
		workspaceRoot: "/tmp",
		gitCommitExists: () => false,
		runtimeRecordedTestRunIds: new Set(),
		runtimeRecordedJournalEntryIds: new Set(),
		...overrides,
	};
}

async function alwaysApprove(): Promise<boolean> {
	return true;
}
async function alwaysDeny(): Promise<boolean> {
	return false;
}

describe("runGateStatus (FR-4: full observable state without reopening the session)", () => {
	it("shows currentGate, per-gate status, mandatory gates, and counts", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1);

		const snapshot = runGateStatus({ cwd: "/tmp", demandId: DEMAND, store });

		expect(snapshot).toEqual<GateStatusSnapshot>({
			demandId: DEMAND,
			branch: "feature/fake-demand",
			currentGate: 1,
			mandatoryGates: [3, 5, 7, 8, 9],
			gates: [
				{
					gate: 1,
					status: "in-progress",
					evidenceCount: 0,
					decisionsCount: 0,
					risksCount: 0,
					approvalsCount: 0,
					startedAt: expect.any(String),
				},
			],
		});
	});
});

describe("runGateStart (FR-1/FR-2: sequential progression, mandatory gates enforced live)", () => {
	it("FR-1: opens the next gate when the prior one is approved, keeping the prior record in history", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1);
		store.approve(DEMAND, 1, true, { source: "test" });

		const snapshot = runGateStart({ cwd: "/tmp", demandId: DEMAND, store, gate: 2 });

		expect(snapshot.currentGate).toBe(2);
		expect(snapshot.gates.find((g) => g.gate === 1)?.status).toBe("approved");
		expect(snapshot.gates.find((g) => g.gate === 2)?.status).toBe("in-progress");
	});

	it("FR-2/R23: refuses to start a gate that skips an unapproved MANDATORY gate, naming it", () => {
		const store = createFakeGateStore();
		// Gate 3 is mandatory and has never been started -- starting gate 5 must be refused.

		expect(() => runGateStart({ cwd: "/tmp", demandId: DEMAND, store, gate: 5 })).toThrow(/gate 3/);
	});
});

describe("runGateEvidence (FR-5/FR-6, R25: evidence is a referenced attachment, never a bare claim)", () => {
	it("FR-5: attaches evidence with a ref to the current gate", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1); // gate 1 is not mandatory -- no prior-gate setup needed for this test

		const snapshot = runGateEvidence({
			cwd: "/tmp",
			demandId: DEMAND,
			store,
			gate: 1,
			attachment: { ref: { kind: "test-run", id: "run-1" }, provenance: "author-declared" },
			evidenceContext: evidenceContext({ runtimeRecordedTestRunIds: new Set(["run-1"]) }),
		});

		expect(snapshot.gates.find((g) => g.gate === 1)?.evidenceCount).toBe(1);
	});

	it("R25/T41: refuses (fail-closed) when the ref does not resolve, and never reaches the store at all", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1);

		expect(() =>
			runGateEvidence({
				cwd: "/tmp",
				demandId: DEMAND,
				store,
				gate: 1,
				attachment: { ref: { kind: "test-run", id: "run-never-recorded" }, provenance: "author-declared" },
				// Honestly empty -- "run-never-recorded" was never runtime-recorded, so this MUST refuse.
				evidenceContext: evidenceContext(),
			}),
		).toThrow(/cannot attach evidence/);
		// The refusal happened before the store was ever touched -- evidenceCount stays 0, never
		// incremented speculatively then rolled back.
		expect(store.getRaw(DEMAND)?.gates.get(1)?.evidenceCount).toBe(0);
	});

	it("FR-6: refuses evidence for a gate that was never started for this demand (evidence itself resolves fine -- the store's own FR-6 check is what refuses)", () => {
		const store = createFakeGateStore();

		expect(() =>
			runGateEvidence({
				cwd: "/tmp",
				demandId: DEMAND,
				store,
				gate: 11,
				attachment: { ref: { kind: "test-run", id: "run-x" }, provenance: "author-declared" },
				evidenceContext: evidenceContext({ runtimeRecordedTestRunIds: new Set(["run-x"]) }),
			}),
		).toThrow(/gate 11/);
	});
});

describe("runGateApprove (FR-7/FR-8/FR-10/FR-11, R22/R23: sign-off persists via the store)", () => {
	it("FR-7: approves the current gate when the confirm channel resolves true, persisting via the store", async () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1); // gate 1 is not mandatory -- approvable with no evidence, no prior setup

		const snapshot = await runGateApprove({
			cwd: "/tmp",
			demandId: DEMAND,
			store,
			gate: 1,
			confirm: alwaysApprove,
			source: "test",
		});

		expect(snapshot.gates.find((g) => g.gate === 1)?.status).toBe("approved");
		expect(store.getRaw(DEMAND)?.gates.get(1)?.approvalsCount).toBe(1);
	});

	it("FR-8/BR-6: refuses to approve a MANDATORY gate with zero evidence attached", async () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 3); // gate 3 is the FIRST mandatory gate -- no earlier mandatory gate to set up

		await expect(
			runGateApprove({ cwd: "/tmp", demandId: DEMAND, store, gate: 3, confirm: alwaysApprove, source: "test" }),
		).rejects.toThrow(/evidence/i);
	});

	it("FR-11: when the confirm channel denies (headless/no-UI), the gate becomes needs-human, never approved", async () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1);

		const snapshot = await runGateApprove({
			cwd: "/tmp",
			demandId: DEMAND,
			store,
			gate: 1,
			confirm: alwaysDeny,
			source: "test",
		});

		expect(snapshot.gates.find((g) => g.gate === 1)?.status).toBe("needs-human");
	});
});

describe("runGateReject (FR-9: rejection blocks subsequent advance)", () => {
	it("marks the gate rejected and persists via the store", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 3);

		const snapshot = runGateReject({ cwd: "/tmp", demandId: DEMAND, store, gate: 3, reason: "found a real gap" });

		expect(snapshot.gates.find((g) => g.gate === 3)?.status).toBe("rejected");
	});

	it("FR-2 generalized: a rejected mandatory gate blocks gate start N+1 exactly like not-started", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 3);
		store.reject(DEMAND, 3, "found a real gap");

		expect(() => runGateStart({ cwd: "/tmp", demandId: DEMAND, store, gate: 5 })).toThrow(/gate 3/);
	});
});

describe("runGateCalibrate (FR-3/R24: calibration can never collapse a mandatory gate)", () => {
	it("registers a calibration collapsing only non-mandatory gates", async () => {
		const store = createFakeGateStore();

		const snapshot = await runGateCalibrate({
			cwd: "/tmp",
			demandId: DEMAND,
			store,
			collapse: [1, 2, 4],
			confirm: alwaysApprove,
			source: "test",
		});

		expect(snapshot.demandId).toBe(DEMAND);
	});

	it("R24: refuses a calibration that names a mandatory gate, naming the offender", async () => {
		const store = createFakeGateStore();

		await expect(
			runGateCalibrate({
				cwd: "/tmp",
				demandId: DEMAND,
				store,
				collapse: [1, 3],
				confirm: alwaysApprove,
				source: "test",
			}),
		).rejects.toThrow(/gate 3|mandatory/i);
	});
});

describe("formatGateStatusReport (FR-4: renders the full observable state)", () => {
	it("renders demandId, currentGate, mandatory gates, and per-gate status/counts", () => {
		const snapshot: GateStatusSnapshot = {
			demandId: DEMAND,
			branch: "feature/fase4-gates-e-evidencias",
			currentGate: 5,
			mandatoryGates: [3, 5, 7, 8, 9],
			gates: [
				{ gate: 3, status: "approved", evidenceCount: 1, decisionsCount: 0, risksCount: 0, approvalsCount: 1 },
				{ gate: 5, status: "in-progress", evidenceCount: 0, decisionsCount: 0, risksCount: 0, approvalsCount: 0 },
			],
		};

		const text = formatGateStatusReport(snapshot);

		expect(text).toContain(DEMAND);
		expect(text).toContain("5"); // currentGate
		expect(text).toMatch(/3.*approved/is);
		expect(text).toMatch(/5.*in-progress/is);
	});
});
