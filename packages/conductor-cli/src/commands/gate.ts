/**
 * `conductor gate status/start/evidence/approve/reject/calibrate` (Gate 5, Fase 4 "Gates e
 * evidências" — ADR 0005 §2/§18 appendix CLI surface, gate2-spec-fase4.md Grupos A-F).
 *
 * GATE 5 (test-first): every exported `run*` function below is an unconditional throw — same
 * precedent as `@conductor/runtime`'s own `tools/task.ts` at its own Gate 5 ("Gate 5's stubs threw
 * 'not implemented'"; see `test/tools/task.test.ts`'s own header there). Gate 6 fills these bodies in
 * for real. `formatGateStatusReport` is the one exception — pure rendering with no gate-state policy
 * of its own (the same kind of trivial, real, immediately-testable formatting `roles.ts`'s
 * `formatRolesListReport`/`skills.ts`'s `formatSkillsListReport` already are) — but even it is left as
 * a throwing stub here because its OWN shape (`GateStatusSnapshot`) is still a CLI-local placeholder
 * (see below), not the authoritative `GateState` the parallel stream owns; wiring it for real before
 * that shape is confirmed would risk baking in an accidental contract.
 *
 * Scope boundary (two parallel Fase 4 Gate 5 streams, ADR 0005 §2 "I/O na borda, política pura no
 * meio"): this file is the CLI's own thin surface, mirroring `roles.ts`/`skills.ts`'s own "thin CLI
 * surface over primitives" shape. It does NOT define `GateState`/`GateStateStore`/`mutateGateState`/
 * `evaluateAdvance`/`isMandatorySatisfied`/`evaluateCalibration` — a parallel Gate 5 stream (ADR 0005
 * §2-§9, `@conductor/runtime`'s `gate-state.ts`/`gate-state-store.ts`/`gate-state-policy.ts`/
 * `gate-state-mutation.ts`) owns those. `GateStateStoreView` below is the SEAM this file depends on
 * instead — the same decoupling pattern `RoleRegistryView` (`@conductor/runtime`'s `tools/task.ts`)
 * already uses to keep one package from importing another's in-flight internals (ADR 0004 §3.1).
 * `GateStatusSnapshot`/`GateRecordSnapshot`/`EvidenceAttachment` below are a MINIMAL, CLI-LOCAL
 * placeholder shape for what `gate status` needs to render — NOT the authoritative `GateState`/
 * `GateRecord` (ADR 0005 §18 appendix / `gate-state.ts`), which the other stream owns.
 *
 * PENDING INTEGRATION (documented, not silently glossed): once the parallel stream's real
 * `GateStateStore`/`mutateGateState`/`evaluateAdvance` land, this file needs a real adapter
 * implementing `GateStateStoreView` over them (replacing `createUnwiredGateStateStore` below), and
 * `GateStatusSnapshot` should likely be reshaped to mirror `GateState`/`GateRecord` more directly
 * (or `GateStateStoreView.status` could just return a `GateState` and let `formatGateStatusReport`
 * project it). The six `run*` functions' own call signatures should not need to change shape for that
 * swap — only the store's construction and (possibly) `GateStatusSnapshot`'s exact fields.
 */

import type { Approval, ApprovalMeta, EvidenceProvenance, EvidenceRef, GateApprovalMethod } from "@conductor/runtime";

export type GateStatus = "not-started" | "in-progress" | "blocked" | "needs-human" | "approved" | "rejected";

/** FR-5: `--ref` is mandatory and carries a provenance (R25); `note` is free text that NEVER
 * substitutes for `ref` (the CLI layer's own job is to refuse a bare `--note` before this shape is
 * ever constructed — see `runGateEvidence` below). */
export interface EvidenceAttachment {
	ref: EvidenceRef;
	provenance: EvidenceProvenance;
	note?: string;
}

export interface GateRecordSnapshot {
	gate: number;
	status: GateStatus;
	evidenceCount: number;
	decisionsCount: number;
	risksCount: number;
	approvalsCount: number;
	startedAt?: string;
	completedAt?: string;
}

/** FR-4: the minimum `gate status` must show to answer "can this demand advance?" without reopening
 * the session that produced the state. */
export interface GateStatusSnapshot {
	demandId: string;
	branch: string;
	currentGate: number;
	gates: GateRecordSnapshot[];
	mandatoryGates: number[];
}

export class GateCommandError extends Error {}

/**
 * The seam this CLI layer depends on instead of a concrete `GateStateStore` (which does not exist yet
 * as production wiring — pending integration, see this file's header). Every method may throw a
 * `GateCommandError` (fail-closed, BR-9/R26) — this file's own `run*` wrappers are responsible for
 * turning that into a clean CLI error, never letting a bare stack trace reach the user.
 */
export interface GateStateStoreView {
	status(demandId: string): GateStatusSnapshot;
	start(demandId: string, gate: number): GateStatusSnapshot;
	attachEvidence(demandId: string, gate: number, attachment: EvidenceAttachment): GateStatusSnapshot;
	/**
	 * `confirmResult` MUST already be the return value of `confirmOrDeny` (the one channel, R22/BR-8)
	 * — this method is expected to mint via `@conductor/runtime`'s `mintHumanApproval` internally once
	 * Gate 6 implements it; it never accepts a pre-built `Approval` from the caller (that would reopen
	 * T40c — a caller handing in an already-"human" `Approval` object it built itself).
	 */
	approve(demandId: string, gate: number, confirmResult: boolean, meta: Omit<ApprovalMeta, "gate" | "demandId" | "branch">): GateStatusSnapshot;
	reject(demandId: string, gate: number, reason: string): GateStatusSnapshot;
	/** `method` is supplied by the caller (`runGateCalibrate`), itself derived from the SAME
	 * confirm-channel discipline as `approve` (R22/R24: a calibration decision carries who/how decided,
	 * never ambiguous when read back — ADR 0005 §5). */
	calibrate(demandId: string, collapsedGates: number[], method: GateApprovalMethod): GateStatusSnapshot;
}

export interface GateCommandOptions {
	cwd: string;
	demandId: string;
	/** REQUIRED, injected — see this file's header on why no default is constructed here. */
	store: GateStateStoreView;
}

export function runGateStatus(options: GateCommandOptions): GateStatusSnapshot {
	throw new Error("runGateStatus: not implemented -- Gate 6 (Fase 4, ADR 0005 §18 CLI surface, FR-4)");
}

export function runGateStart(options: GateCommandOptions & { gate: number }): GateStatusSnapshot {
	throw new Error("runGateStart: not implemented -- Gate 6 (Fase 4, FR-1/FR-2/FR-3)");
}

export function runGateEvidence(
	options: GateCommandOptions & { gate: number; attachment: EvidenceAttachment },
): GateStatusSnapshot {
	throw new Error("runGateEvidence: not implemented -- Gate 6 (Fase 4, FR-5/FR-6, R25)");
}

/** A confirmation channel — production wiring (Gate 6) is expected to be `confirmOrDeny`
 * (`@conductor/runtime`) bound to a real interactive UI; tests inject a fake. `runGateApprove`/
 * `runGateCalibrate` below never accept a raw `boolean` directly from a caller-supplied flag (no
 * `--yes` exists on this CLI surface at all, by design — ADR 0005 §18 appendix's own CLI grammar) —
 * only a channel that can be exercised the same way `confirmOrDeny` already is (headless -> false). */
export interface ConfirmChannel {
	(title: string, message: string): Promise<boolean>;
}

export async function runGateApprove(
	options: GateCommandOptions & { gate: number; confirm: ConfirmChannel; source: string },
): Promise<GateStatusSnapshot> {
	throw new Error("runGateApprove: not implemented -- Gate 6 (Fase 4, FR-7/FR-8/FR-10/FR-11, R22/R23)");
}

export function runGateReject(options: GateCommandOptions & { gate: number; reason: string }): GateStatusSnapshot {
	throw new Error("runGateReject: not implemented -- Gate 6 (Fase 4, FR-9)");
}

export async function runGateCalibrate(
	options: GateCommandOptions & { collapse: number[]; confirm: ConfirmChannel; source: string },
): Promise<GateStatusSnapshot> {
	throw new Error("runGateCalibrate: not implemented -- Gate 6 (Fase 4, FR-3, R24)");
}

export function formatGateStatusReport(snapshot: GateStatusSnapshot): string {
	throw new Error("formatGateStatusReport: not implemented -- Gate 6 (Fase 4, FR-4)");
}

/**
 * Production placeholder composition (Gate 5): no real `GateStateStore` exists yet (pending
 * integration, see this file's header). Every method fails closed with a clear, honest message rather
 * than fabricating a working store or silently returning an empty/approved-looking snapshot (BR-9/R26
 * — "could-not-verify", never a default that reads as success). This is what `cli.ts`'s `gate`
 * dispatcher constructs today; it is replaced by a real adapter once the parallel stream's store lands.
 */
export function createUnwiredGateStateStore(): GateStateStoreView {
	const notWired = (): never => {
		throw new GateCommandError(
			"conductor gate: GateStateStore is not wired yet -- pending integration with the parallel " +
				"Fase 4 Gate 5 stream (ADR 0005 §2/§18). See docs/adr/0005-fase4-gate-state-machine.md.",
		);
	};
	return {
		status: notWired,
		start: notWired,
		attachEvidence: notWired,
		approve: notWired,
		reject: notWired,
		calibrate: notWired,
	};
}

/** Type re-export convenience for callers (e.g. `cli.ts`) that only need these runtime-owned unions,
 * not the whole `@conductor/runtime` barrel. */
export type { Approval, EvidenceProvenance, EvidenceRef, GateApprovalMethod };
