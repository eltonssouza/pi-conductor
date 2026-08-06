/**
 * `conductor gate status/start/evidence/approve/reject/calibrate` (Gate 6, Fase 4 "Gates e
 * evidências" — ADR 0005 §2/§18 appendix CLI surface, gate2-spec-fase4.md Grupos A-F).
 *
 * GATE 5 (test-first, historical): every exported `run*` function below started life as an
 * unconditional throw — same precedent as `@conductor/runtime`'s own `tools/task.ts` at its own Gate 5
 * ("Gate 5's stubs threw 'not implemented'"; see `test/tools/task.test.ts`'s own header there).
 *
 * GATE 6 (wiring closure): all six `run*` functions and `formatGateStatusReport` are implemented for
 * real below, each a thin proxy onto `GateStateStoreView` (never gate-state policy of its own — that
 * policy lives in the store). The real, PERSISTED adapter (`createPersistedGateStateStore`, backed by
 * `@conductor/runtime`'s `createGateStateStore`/`evaluateAdvance`/`evaluateCalibration`) now lives in
 * `./gate-store.ts` — the temporary, non-persisted `createInMemoryGateStateStore` this file used to
 * export (a `conductor gate status` that lost everything once the CLI process exited, not what Fase 4
 * promises) has been removed; `cli.ts`'s one call site now constructs the real adapter instead.
 * `GateStatusSnapshot` is still the CLI-local placeholder shape described below (not yet the
 * authoritative `GateState`), unchanged by this wiring pass — see `./gate-store.ts`'s own header for
 * how it projects the real `GateState`/`GateRecord` aggregate onto this shape.
 *
 * `GateStateStoreView` remains the seam this file depends on (never a concrete store type) — the same
 * decoupling pattern `RoleRegistryView` (`@conductor/runtime`'s `tools/task.ts`) already uses to keep
 * one package from importing another's internals directly (ADR 0004 §3.1). `GateStatusSnapshot`/
 * `GateRecordSnapshot`/`EvidenceAttachment` below remain a MINIMAL, CLI-LOCAL placeholder shape for
 * what `gate status` needs to render — NOT the authoritative `GateState`/`GateRecord` (ADR 0005 §18
 * appendix / `gate-state.ts`).
 *
 * `runGateEvidence` now calls `@conductor/runtime`'s `resolveEvidenceRef` for real (R25/T41): a
 * `--ref` MUST actually resolve (Tier-1: a real, abrível git commit / file / runtime-recorded
 * test-run / journal-entry) before this function ever attaches it to persisted `GateState` — fail-
 * closed, and the RESOLVED provenance (never a caller-declared guess) is what gets persisted.
 */

import {
	type Approval,
	type ApprovalMeta,
	type EvidenceProvenance,
	type EvidenceRef,
	type GateApprovalMethod,
	type ResolveEvidenceRefContext,
	resolveEvidenceRef,
} from "@conductor/runtime";

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
 * The seam this CLI layer depends on instead of a concrete `GateStateStore` type — `./gate-store.ts`'s
 * `createPersistedGateStateStore` is the real, production implementation (`cli.ts`'s one call site);
 * `test/support/fake-gate-store.ts` is the unit-test double. Every method may throw a
 * `GateCommandError` (fail-closed, BR-9/R26) — this file's own `run*` wrappers are responsible for
 * turning that into a clean CLI error, never letting a bare stack trace reach the user.
 */
export interface GateStateStoreView {
	status(demandId: string): GateStatusSnapshot;
	start(demandId: string, gate: number): GateStatusSnapshot;
	attachEvidence(demandId: string, gate: number, attachment: EvidenceAttachment): GateStatusSnapshot;
	/**
	 * `confirmResult` MUST already be the return value of `confirmOrDeny` (the one channel, R22/BR-8)
	 * — every implementation mints via `@conductor/runtime`'s `mintHumanApproval` internally; it never
	 * accepts a pre-built `Approval` from the caller (that would reopen T40c — a caller handing in an
	 * already-"human" `Approval` object it built itself).
	 */
	approve(
		demandId: string,
		gate: number,
		confirmResult: boolean,
		meta: Omit<ApprovalMeta, "gate" | "demandId" | "branch">,
	): GateStatusSnapshot;
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
	return options.store.status(options.demandId);
}

export function runGateStart(options: GateCommandOptions & { gate: number }): GateStatusSnapshot {
	return options.store.start(options.demandId, options.gate);
}

export function runGateEvidence(
	options: GateCommandOptions & {
		gate: number;
		attachment: EvidenceAttachment;
		/** REQUIRED, injected (same discipline as `store`/`confirm` above) — production wiring
		 * (`cli.ts`) builds this from real `cwd`/git context; tests inject a fixture. */
		evidenceContext: ResolveEvidenceRefContext;
	},
): GateStatusSnapshot {
	// R25/T41 (fail-closed): a --ref MUST actually resolve (Tier-1 -- a real, abrível object) before
	// this evidence is ever attached to persisted GateState. resolveEvidenceRef is the ONE place that
	// decision is made (gate-evidence.ts) -- this function never guesses or trusts a caller-declared
	// provenance; it OVERWRITES it with whatever resolveEvidenceRef genuinely determined.
	const resolution = resolveEvidenceRef(options.attachment.ref, options.evidenceContext);
	if (!resolution.ok) {
		throw new GateCommandError(`cannot attach evidence: ${resolution.reason}`);
	}
	const attachment: EvidenceAttachment = { ...options.attachment, provenance: resolution.provenance };
	return options.store.attachEvidence(options.demandId, options.gate, attachment);
}

/**
 * Resolves the CLI's `--gate <N>` sentinel (0 = "not supplied") to a concrete gate number by falling
 * back to the demand's own `currentGate` (ADR 0005 §18 CLI surface: `gate approve [--gate <N>]` /
 * `gate reject ... [--gate <N>]` are both documented as resolving from currentGate when omitted).
 * Fail-closed (BR-9 mirror): a demand with no current gate at all (currentGate <= 0, i.e. `gate start`
 * was never run) refuses rather than guessing gate 0 or gate 1.
 */
function resolveTargetGate(options: GateCommandOptions & { gate: number }): number {
	if (options.gate > 0) {
		return options.gate;
	}
	const current = options.store.status(options.demandId).currentGate;
	if (current <= 0) {
		throw new GateCommandError(
			"no current gate for this demand -- specify --gate <N> explicitly, or run `conductor gate start <N>` first",
		);
	}
	return current;
}

/** A confirmation channel — production wiring (Gate 6) is expected to be `confirmOrDeny`
 * (`@conductor/runtime`) bound to a real interactive UI; tests inject a fake. `runGateApprove`/
 * `runGateCalibrate` below never accept a raw `boolean` directly from a caller-supplied flag (no
 * `--yes` exists on this CLI surface at all, by design — ADR 0005 §18 appendix's own CLI grammar) —
 * only a channel that can be exercised the same way `confirmOrDeny` already is (headless -> false). */
export type ConfirmChannel = (title: string, message: string) => Promise<boolean>;

export async function runGateApprove(
	options: GateCommandOptions & { gate: number; confirm: ConfirmChannel; source: string },
): Promise<GateStatusSnapshot> {
	const gate = resolveTargetGate(options);
	// R22/BR-8: this IS the one real channel -- `options.confirm` (production wiring: `confirmOrDeny`
	// bound to a real interactive UI; headless callers pass a channel that always resolves `false`, per
	// `confirmOrDeny`'s own `!hasUI -> false`). The boolean this resolves to is handed straight to the
	// store, which is expected to mint via `mintHumanApproval` internally -- this function never builds
	// or claims an `Approval` itself.
	const confirmResult = await options.confirm(
		`Approve gate ${gate}?`,
		`Approve gate ${gate} for demand "${options.demandId}"?`,
	);
	return options.store.approve(options.demandId, gate, confirmResult, { source: options.source });
}

export function runGateReject(options: GateCommandOptions & { gate: number; reason: string }): GateStatusSnapshot {
	const gate = resolveTargetGate(options);
	return options.store.reject(options.demandId, gate, options.reason);
}

export async function runGateCalibrate(
	options: GateCommandOptions & { collapse: number[]; confirm: ConfirmChannel; source: string },
): Promise<GateStatusSnapshot> {
	// R24/ADR §5: a calibration is always a registered Decision (the store may still refuse it for
	// naming a mandatory gate) -- unlike `gate approve`, a `false` confirm result does not itself block
	// registration; it only marks WHO authorized the collapse (human vs. the autonomous loop), exactly
	// like any other `ApprovalMethod` tag (never ambiguous when read back later, ADR 0005 §5).
	const confirmResult = await options.confirm(
		"Register gate calibration?",
		`Collapse gate(s) ${options.collapse.join(", ")} for demand "${options.demandId}"?`,
	);
	const method: GateApprovalMethod = confirmResult === true ? "human" : "auto";
	return options.store.calibrate(options.demandId, options.collapse, method);
}

export function formatGateStatusReport(snapshot: GateStatusSnapshot): string {
	const lines: string[] = [
		`Demand: ${snapshot.demandId} (branch: ${snapshot.branch})`,
		`currentGate: ${snapshot.currentGate}`,
		`mandatoryGates: [${snapshot.mandatoryGates.join(", ")}]`,
		"",
	];

	if (snapshot.gates.length === 0) {
		lines.push("(no gate has been started yet for this demand)");
	} else {
		for (const record of snapshot.gates) {
			const mandatoryTag = snapshot.mandatoryGates.includes(record.gate) ? " [mandatory]" : "";
			const timing = [
				record.startedAt ? `startedAt=${record.startedAt}` : undefined,
				record.completedAt ? `completedAt=${record.completedAt}` : undefined,
			]
				.filter((part): part is string => part !== undefined)
				.join(" ");
			lines.push(
				`Gate ${record.gate}${mandatoryTag}: ${record.status}` +
					` (evidence=${record.evidenceCount}, decisions=${record.decisionsCount}, ` +
					`risks=${record.risksCount}, approvals=${record.approvalsCount})` +
					(timing ? ` ${timing}` : ""),
			);
		}
	}

	return `${lines.join("\n")}\n`;
}

/** Type re-export convenience for callers (e.g. `cli.ts`) that only need these runtime-owned unions,
 * not the whole `@conductor/runtime` barrel. */
export type { Approval, EvidenceProvenance, EvidenceRef, GateApprovalMethod };
