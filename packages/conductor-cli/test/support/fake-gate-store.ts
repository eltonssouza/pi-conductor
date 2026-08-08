/**
 * A working, in-memory `GateStateStoreView` fake for testing `commands/gate.ts`'s CLI commands
 * (Gate 5, Fase 4 "Gates e evidências"). This is a Fake Object (xUnit Test Patterns) — a lightweight
 * but genuinely working stand-in for the real `GateStateStore`/`evaluateAdvance`/`isMandatorySatisfied`
 * the parallel Fase 4 Gate 5 stream owns (`@conductor/runtime`'s `gate-state-store.ts`/
 * `gate-state-policy.ts`) — NOT a claim about what that real implementation will do, only enough
 * sequencing/mandatory-gate/evidence-count behavior to exercise `commands/gate.ts`'s OWN contract in
 * isolation, the same "fake the expensive/not-yet-ready collaborator" split
 * `packages/conductor-runtime/test/tools/task.test.ts` already documents for `RoleRegistryView`/
 * `SharedBudget` fakes there.
 *
 * PENDING INTEGRATION (documented, not silently glossed): once the real `GateStateStore` lands, this
 * fake stays as test infrastructure (a legitimate simpler double for CLI-layer tests that don't need to
 * re-prove atomicity/fail-closed-parsing/etc. — those live in the OTHER stream's own test suite), it
 * does not need to be deleted.
 *
 * `MANDATORY_GATES` is imported from `@conductor/config` (the parallel stream's own canonical
 * constant, `builtin-roles-data.ts` — ADR 0005 §4/R23/BR-10, `{3,5,7,8,9}`), now re-exported from that
 * package's `src/index.ts` barrel — the single source of truth this fake mirrors rather than
 * hardcodes, so it can never silently drift from the real floor.
 *
 * FASE 8 GATE 5 (docs/adr/0009-fase8-autonomous-mode.md §14/§16, N1): `approveAuto` below is an
 * unconditional Gate-5 throw, matching `../../src/commands/gate.ts`'s own `GateStateStoreView`
 * extension — this fake stays a stub for that one method until Gate 6 wires its real
 * `MANDATORY_GATES`-guarded behavior (see `test/commands/gate-approve-auto-mandatory-guard.test.ts`),
 * even though this file's other six methods below are already a genuinely working fake.
 */

import { MANDATORY_GATES } from "@conductor/config";
import {
	type EvidenceAttachment,
	GateCommandError,
	type GateRecordSnapshot,
	type GateStateStoreView,
	type GateStatusSnapshot,
} from "../../src/commands/gate.ts";

interface FakeDemand {
	branch: string;
	currentGate: number;
	gates: Map<number, GateRecordSnapshot>;
	calibration?: { collapsedGates: number[]; method: "human" | "auto" };
}

export interface FakeGateStore extends GateStateStoreView {
	/** Test-only inspection hook -- not part of the real `GateStateStoreView` contract. */
	getRaw(demandId: string): Readonly<FakeDemand> | undefined;
}

function freshRecord(gate: number): GateRecordSnapshot {
	return { gate, status: "not-started", evidenceCount: 0, decisionsCount: 0, risksCount: 0, approvalsCount: 0 };
}

export function createFakeGateStore(options: { branch?: string } = {}): FakeGateStore {
	const demands = new Map<string, FakeDemand>();

	function ensureDemand(demandId: string): FakeDemand {
		let demand = demands.get(demandId);
		if (!demand) {
			demand = { branch: options.branch ?? "feature/fake-demand", currentGate: 0, gates: new Map() };
			demands.set(demandId, demand);
		}
		return demand;
	}

	function ensureRecord(demand: FakeDemand, gate: number): GateRecordSnapshot {
		let record = demand.gates.get(gate);
		if (!record) {
			record = freshRecord(gate);
			demand.gates.set(gate, record);
		}
		return record;
	}

	function snapshot(demandId: string): GateStatusSnapshot {
		const demand = ensureDemand(demandId);
		return {
			demandId,
			branch: demand.branch,
			currentGate: demand.currentGate,
			gates: [...demand.gates.values()].sort((a, b) => a.gate - b.gate),
			mandatoryGates: [...MANDATORY_GATES].sort((a, b) => a - b),
			// Gate 8 (QA validation) finding, ADR 0005 §5 bullet 3 -- mirrors the real
			// createPersistedGateStateStore's own projectSnapshot (commands/gate-store.ts).
			...(demand.calibration ? { calibration: demand.calibration } : {}),
		};
	}

	return {
		status(demandId) {
			return snapshot(demandId);
		},

		start(demandId, gate) {
			const demand = ensureDemand(demandId);
			// FR-2/R23: recuse fail-closed, naming the missing mandatory gate(s), when a mandatory gate
			// below `gate` is not (yet) approved.
			const missing = [...MANDATORY_GATES]
				.filter((g) => g < gate)
				.filter((g) => ensureRecord(demand, g).status !== "approved")
				.sort((a, b) => a - b);
			if (missing.length > 0) {
				// Each missing entry is rendered as its own "gate N" token (not a bare joined number list)
				// so a caller/test matching on a specific missing gate (e.g. /gate 3/) can find it as a
				// literal substring regardless of how many other gates are also missing.
				const missingLabel = missing.map((g) => `gate ${g}`).join(", ");
				throw new GateCommandError(`cannot start gate ${gate}: mandatory ${missingLabel} not approved yet`);
			}
			const record = ensureRecord(demand, gate);
			record.status = "in-progress";
			record.startedAt = new Date().toISOString();
			demand.currentGate = gate;
			return snapshot(demandId);
		},

		attachEvidence(demandId, gate, _attachment: EvidenceAttachment) {
			const demand = ensureDemand(demandId);
			const record = demand.gates.get(gate);
			// FR-6: refuse attaching evidence to a gate that was never started for this demand.
			if (!record || record.status === "not-started") {
				throw new GateCommandError(`cannot attach evidence: gate ${gate} was never started for this demand`);
			}
			record.evidenceCount += 1;
			return snapshot(demandId);
		},

		approve(demandId, gate, confirmResult, _meta) {
			const demand = ensureDemand(demandId);
			const record = demand.gates.get(gate);
			if (!record || record.status === "not-started" || record.status === "rejected") {
				throw new GateCommandError(`cannot approve gate ${gate}: it was never started (or is rejected)`);
			}
			// FR-13/ADR 0005 §15: re-approving an already-approved gate is idempotent -- reaffirms the
			// existing state, never increments approvalsCount again (mirrors the real store's own guard,
			// commands/gate-store.ts).
			if (record.status === "approved") {
				return snapshot(demandId);
			}
			// FR-8/BR-6: a mandatory gate cannot be approved with zero evidence.
			if (MANDATORY_GATES.has(gate) && record.evidenceCount === 0) {
				throw new GateCommandError(`cannot approve mandatory gate ${gate}: no evidence attached (BR-6)`);
			}
			if (confirmResult !== true) {
				// FR-11: never approved -- needs-human, never silently left "in-progress".
				record.status = "needs-human";
				return snapshot(demandId);
			}
			record.status = "approved";
			record.completedAt = new Date().toISOString();
			record.approvalsCount += 1;
			return snapshot(demandId);
		},

		reject(demandId, gate, _reason) {
			const demand = ensureDemand(demandId);
			const record = ensureRecord(demand, gate);
			record.status = "rejected";
			record.decisionsCount += 1;
			return snapshot(demandId);
		},

		calibrate(demandId, collapsedGates, method) {
			// R24: a calibration can never name a mandatory gate.
			const offending = collapsedGates.filter((g) => MANDATORY_GATES.has(g)).sort((a, b) => a - b);
			if (offending.length > 0) {
				throw new GateCommandError(
					`calibration refused: cannot collapse mandatory gate(s) ${offending.join(", ")}`,
				);
			}
			const demand = ensureDemand(demandId);
			demand.calibration = { collapsedGates, method };
			return snapshot(demandId);
		},

		getRaw(demandId) {
			return demands.get(demandId);
		},

		approveAuto(_demandId, _gate) {
			// Fase 8 / N1, GATE 5: unconditional throw (plain Error, matching this whole codebase's
			// Gate-5 stub convention -- NOT a GateCommandError domain refusal) -- see this file's header.
			// Gate 6 replaces this with a real MANDATORY_GATES-guarded fake mirroring gate-store.ts's own
			// concrete behavior.
			throw new Error("not implemented");
		},
	};
}
