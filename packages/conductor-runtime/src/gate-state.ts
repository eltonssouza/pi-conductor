/**
 * GateState — the persisted governance state machine for the 14-gate Conductor flow (Fase 4,
 * "Gates e evidências"). Domain types ONLY (plano_desenvolvimento.md §4.7; gate2-spec-fase4.md §4
 * glossário; docs/adr/0005-fase4-gate-state-machine.md §18 appendix, the locked contract).
 *
 * GATE 5 (test-first): this file declares SHAPE only — no behavior. The pure policy functions
 * (evaluateAdvance/isMandatorySatisfied/evaluateCalibration, gate-state-policy.ts) and the I/O
 * boundary (GateStateStore/mutateGateState, gate-state-store.ts / gate-state-mutation.ts) are
 * Gate-5 STUBS in their own files that throw "not implemented" — Gate 6 implements the bodies.
 *
 * Two parallel Fase 4 Gate 5 streams (ADR 0005 §2 "I/O na borda, política pura no meio" — each
 * stream owns a different slice): sign-off minting (`gate-approval.ts`: `Approval`/`ApprovalMethod`/
 * `mintHumanApproval`/`mintAutoApproval`) and evidence Tier-1 resolution (`gate-evidence.ts`:
 * `EvidenceRef`/`EvidenceProvenance`/`resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate`)
 * already landed their own shared types — this file REUSES them by import rather than redeclaring
 * incompatible duplicates (the collision this header flags explicitly: an earlier draft of this
 * file defined its own local `Approval`/`EvidenceRef`/`EvidenceProvenance`, which would have fought
 * both sibling files' already-barreled exports of the identical names in `index.ts`). This file's
 * OWN scope is exactly what those two files' headers say it is: `GateState`/`GateRecord`/`Evidence`/
 * `Decision`/`CalibrationDecision`/`Risk` — the persisted aggregate and the record types the sibling
 * files' own primitives compose into, never `Approval`/`EvidenceRef` themselves.
 */

import type { Approval, ApprovalMethod } from "./gate-approval.ts";
import type { EvidenceProvenance, EvidenceRef } from "./gate-evidence.ts";
// GroundingCitation is canonically owned by gate-grounding.ts (Fase 5, ADR 0006 §5.2/§7.1/§19) — this
// file imports it FROM there rather than redeclaring it, the same "reuse by import" discipline this
// file's own header already documents for Approval/EvidenceRef. Type-only: gate-grounding.ts itself
// imports `GateState` FROM this file, so both edges are `import type` to keep the cycle fully erased
// at compile time (no runtime circular module dependency).
import type { GroundingCitation } from "./gate-grounding.ts";

/** plano_desenvolvimento.md §4.7 — the closed vocabulary describing where a demand sits within its
 * current gate. */
export type GateStatus = "not-started" | "in-progress" | "blocked" | "needs-human" | "approved" | "rejected";

export interface Evidence {
	gate: number;
	/** OBRIGATÓRIO (FR-5) and has to RESOLVE (R25, gate-evidence.ts:resolveEvidenceRef) — Tier-1,
	 * not a free-text claim. */
	ref: EvidenceRef;
	provenance: EvidenceProvenance;
	/** Free text — NEVER a substitute for `ref` (FR-5: `--note` alone, without `--ref`, is refused). */
	note?: string;
	/** BR-4/D3 (ADR 0006 §5.2): a technical decision behind this evidence should be traceable to a
	 * library citation — structured `GroundingCitation[]`, not a free-text `string[]` (ADR 0006 §7.1
	 * extends ADR 0005 §18's locked contract in exactly this field; §5.2 is why BOTH `Evidence` and
	 * `Decision` carry the structured form, not just one). */
	groundingCitations?: GroundingCitation[];
	/** ISO-8601 string — never a `Date` object (ADR §9.2's checksum gotcha: canonicalizeJson +
	 * a raw `Date` is a silent-corruption trap). */
	recordedAt: string;
}

export interface Decision {
	gate: number;
	/** ADR 0006 §7.1/D4 §6.3: gains "rejection" — `reject()` (conductor-cli's gate-store.ts) writes
	 * this instead of "decision" (a rejection is a state transition the rejecter judges, never a
	 * groundable technical decision — conflating the two was the imprecision D4 §6.3 fixes). */
	kind: "reasoning" | "decision" | "plan" | "calibration" | "rejection";
	text: string;
	/** R24: a calibration decision carries WHO/HOW decided (human vs. autonomous loop), same as any
	 * approval (gate-approval.ts's `ApprovalMethod`) — never ambiguous when read back later. */
	method: ApprovalMethod;
	/** ADR 0006 §5/§7.1 (D3): structured, never a free-text `string[]` — see `Evidence.groundingCitations`
	 * above for why both fields carry the same shape. The ONLY producer of a populated value here is
	 * `gate-grounding.ts`'s `recordGroundedDecision` (D4 §6.2, sole-mint by static scan). */
	groundingCitations?: GroundingCitation[];
	recordedAt: string;
}

/** R24/T45: `collapsedGates` MUST be disjoint from `MANDATORY_GATES` — `evaluateCalibration`
 * (gate-state-policy.ts) is the gatekeeper that refuses a violating value AT REGISTRATION time,
 * never silently after the fact. */
export interface CalibrationDecision extends Decision {
	kind: "calibration";
	collapsedGates: number[];
}

export interface Risk {
	gate: number;
	text: string;
	accepted: boolean;
	recordedAt: string;
}

export interface GateRecord {
	gate: number;
	status: GateStatus;
	evidence: Evidence[];
	decisions: Decision[];
	risks: Risk[];
	/** R23(iv)/T42: an `Approval` (gate-approval.ts) only counts for THIS gate when it is
	 * structurally keyed to (this record's `gate`, the owning `GateState.demandId`,
	 * `GateState.branch`) — `isMandatorySatisfied` (gate-state-policy.ts) is what enforces that
	 * keying check; this array itself does not filter. */
	approvals: Approval[];
	/** ISO-8601 strings. */
	startedAt?: string;
	completedAt?: string;
}

export interface GateState {
	demandId: string;
	repoId: string;
	branch: string;
	currentGate: number;
	/** History by gate — FR-1: a prior gate's record is NEVER overwritten when a later gate opens. */
	gates: Record<number, GateRecord>;
	calibration?: CalibrationDecision;
	startedAt: string;
	completedAt?: string;
}
