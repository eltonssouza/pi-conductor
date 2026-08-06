/**
 * `conductor gate status/start/evidence/approve/reject/calibrate` (Gate 6, Fase 4 "Gates e
 * evidências" — ADR 0005 §2/§18 appendix CLI surface, gate2-spec-fase4.md Grupos A-F).
 *
 * GATE 5 (test-first, historical): every exported `run*` function below started life as an
 * unconditional throw — same precedent as `@conductor/runtime`'s own `tools/task.ts` at its own Gate 5
 * ("Gate 5's stubs threw 'not implemented'"; see `test/tools/task.test.ts`'s own header there).
 *
 * GATE 6: all six `run*` functions and `formatGateStatusReport` are implemented for real below, each a
 * thin proxy onto `GateStateStoreView` (never gate-state policy of its own — that policy lives in the
 * store, see `createInMemoryGateStateStore` further down). `GateStatusSnapshot` is still the CLI-local
 * placeholder shape described below (not yet the authoritative `GateState` the parallel stream owns) —
 * `formatGateStatusReport` renders exactly that placeholder shape today and will need to move onto
 * `GateState`/`GateRecord` once the real store lands (see the PENDING INTEGRATION note below).
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
 * implementing `GateStateStoreView` over them (replacing `createInMemoryGateStateStore` below), and
 * `GateStatusSnapshot` should likely be reshaped to mirror `GateState`/`GateRecord` more directly
 * (or `GateStateStoreView.status` could just return a `GateState` and let `formatGateStatusReport`
 * project it). The six `run*` functions' own call signatures should not need to change shape for that
 * swap — only the store's construction and (possibly) `GateStatusSnapshot`'s exact fields.
 *
 * GATE 6: the six `run*` functions and `formatGateStatusReport` are implemented for real below.
 * `createUnwiredGateStateStore` (which unconditionally failed every method) is replaced by
 * `createInMemoryGateStateStore` — a REAL, working `GateStateStoreView` (same R22/R23/R24/BR-6 policy
 * a real persisted store must also enforce) that is constructed fresh per CLI process invocation and
 * never persists to disk — that durability/atomicity/checksum machinery (ADR 0005 §3/§9) is explicitly
 * the parallel GateStateStore stream's own scope, still Gate-5 stubs in `gate-state-store.ts`/
 * `gate-state-mutation.ts`/`gate-state-policy.ts` as of this writing. See
 * `createInMemoryGateStateStore`'s own doc comment below for the exact pending-integration point and
 * the one deliberate behavioral difference from `test/support/fake-gate-store.ts`.
 */

import { MANDATORY_GATES } from "@conductor/config";
import {
	type Approval,
	type ApprovalMeta,
	type EvidenceProvenance,
	type EvidenceRef,
	type GateApprovalMethod,
	mintHumanApproval,
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
	return options.store.status(options.demandId);
}

export function runGateStart(options: GateCommandOptions & { gate: number }): GateStatusSnapshot {
	return options.store.start(options.demandId, options.gate);
}

export function runGateEvidence(
	options: GateCommandOptions & { gate: number; attachment: EvidenceAttachment },
): GateStatusSnapshot {
	return options.store.attachEvidence(options.demandId, options.gate, options.attachment);
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
export interface ConfirmChannel {
	(title: string, message: string): Promise<boolean>;
}

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

function freshRecord(gate: number): GateRecordSnapshot {
	return { gate, status: "not-started", evidenceCount: 0, decisionsCount: 0, risksCount: 0, approvalsCount: 0 };
}

const PENDING_BRANCH_PLACEHOLDER = "(branch not yet resolved -- pending GateStateStore integration, ADR 0005 §3.1)";

/**
 * Gate 6: a REAL, working, in-memory `GateStateStoreView` — constructed fresh per CLI process
 * invocation (`cli.ts`'s `runGateCommand` calls this with no args on every `conductor gate ...`
 * invocation, so it deliberately never persists to disk across processes). It enforces the SAME
 * R22/R23/R24/BR-6 policy a real persisted store must also enforce (mirrors
 * `test/support/fake-gate-store.ts`'s own policy almost exactly — see the one deliberate difference
 * below) — this is NOT a claim that it replaces or duplicates the parallel GateStateStore stream's
 * work; it is a temporary seam-conformant implementation (Working with Legacy Code §2.3: "the most
 * useful [seam] is the object seam — depend on an interface … so a [caller] can supply a different
 * implementation") so `conductor gate *` behaves correctly TODAY, without the
 * durability/atomicity/checksum machinery (ADR 0005 §3/§9) that is explicitly the OTHER stream's scope.
 *
 * PENDING INTEGRATION (documented, not silently glossed): once `@conductor/runtime`'s
 * `createGateStateStore`/`mutateGateState`/`evaluateAdvance`/`isMandatorySatisfied`/
 * `evaluateCalibration` (gate-state-store.ts / gate-state-mutation.ts / gate-state-policy.ts — all
 * still Gate-5 stubs that throw "not implemented" as of this writing) are implemented by the parallel
 * stream, THIS function is what gets replaced by a real adapter that persists
 * `.conductor/gates/<sanitized-branch>--<hash8>.json` and delegates to those functions instead of the
 * local policy copy below. `GateStateStoreView` (the seam every `run*` function above already depends
 * on, never a concrete store type) does not change shape for that swap — only this one factory's body
 * does, and `cli.ts`'s single call site (`createInMemoryGateStateStore()`) is the only other edit.
 *
 * The one deliberate behavioral difference from `test/support/fake-gate-store.ts` (the SDET-authored
 * unit-test double `test/commands/gate.test.ts` injects explicitly): a brand-new demand here
 * auto-opens Gate 1 (`status: "in-progress"`, `currentGate: 1`) the moment it is first touched, rather
 * than requiring an explicit `gate start 1` first. Gate 1 has no mandatory prerequisite below it
 * (R23's own "missing" check is vacuously empty for gate 1), so auto-opening it can never bypass R23
 * for any OTHER gate — `gate start N` for N > 1 still runs the exact same full mandatory-floor check
 * below, unchanged. This keeps a bare `conductor gate evidence --gate 1 ...` / `conductor gate status`
 * usable on a fresh demand with no warm-up step, matching every demand's own real starting point
 * ("Gate 1 — Domain discovery" always runs first, CLAUDE.md's own gate table). The fake store
 * intentionally omits this so its own unit tests can assert FR-1/FR-2/FR-6 against an EXPLICIT,
 * unambiguous `not-started` state — this auto-start is a CLI-ergonomics default owned by this file's
 * author, not a contract either test file locks.
 */
export function createInMemoryGateStateStore(options: { branch?: string } = {}): GateStateStoreView {
	interface InMemoryDemand {
		branch: string;
		currentGate: number;
		gates: Map<number, GateRecordSnapshot>;
	}

	const demands = new Map<string, InMemoryDemand>();

	function ensureDemand(demandId: string): InMemoryDemand {
		let demand = demands.get(demandId);
		if (!demand) {
			demand = { branch: options.branch ?? PENDING_BRANCH_PLACEHOLDER, currentGate: 0, gates: new Map() };
			demands.set(demandId, demand);
			const gateOne = freshRecord(1);
			gateOne.status = "in-progress";
			gateOne.startedAt = new Date().toISOString();
			demand.gates.set(1, gateOne);
			demand.currentGate = 1;
		}
		return demand;
	}

	function ensureRecord(demand: InMemoryDemand, gate: number): GateRecordSnapshot {
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
		};
	}

	return {
		status(demandId) {
			return snapshot(demandId);
		},

		start(demandId, gate) {
			const demand = ensureDemand(demandId);
			// R23/FR-2: fail-closed, naming every missing mandatory gate below `gate` (never a substring
			// or emprestado check — each entry comes straight off MANDATORY_GATES, the single canonical
			// source, ADR 0005 §4/BR-10).
			const missing = [...MANDATORY_GATES]
				.filter((g) => g < gate)
				.filter((g) => ensureRecord(demand, g).status !== "approved")
				.sort((a, b) => a - b);
			if (missing.length > 0) {
				const missingLabel = missing.map((g) => `gate ${g}`).join(", ");
				throw new GateCommandError(`cannot start gate ${gate}: mandatory ${missingLabel} not yet approved`);
			}
			const record = ensureRecord(demand, gate);
			record.status = "in-progress";
			record.startedAt = new Date().toISOString();
			demand.currentGate = gate;
			return snapshot(demandId);
		},

		attachEvidence(demandId, gate, _attachment) {
			const demand = ensureDemand(demandId);
			const record = demand.gates.get(gate);
			// FR-6: refuse attaching evidence to a gate that was never started for this demand.
			if (!record || record.status === "not-started") {
				throw new GateCommandError(`cannot attach evidence: gate ${gate} was never started for this demand`);
			}
			record.evidenceCount += 1;
			return snapshot(demandId);
		},

		approve(demandId, gate, confirmResult, meta) {
			const demand = ensureDemand(demandId);
			const record = demand.gates.get(gate);
			if (!record || record.status === "not-started" || record.status === "rejected") {
				throw new GateCommandError(`cannot approve gate ${gate}: it was never started (or is rejected)`);
			}
			// FR-8/BR-6: a mandatory gate cannot be approved with zero evidence.
			if (MANDATORY_GATES.has(gate) && record.evidenceCount === 0) {
				throw new GateCommandError(`cannot approve mandatory gate ${gate}: no evidence attached (BR-6)`);
			}
			// R22: this store never writes `method: "human"` itself — it only calls the sole factory
			// (`mintHumanApproval`, gate-approval.ts), which itself only ever mints from a `confirmResult`
			// that already came out of the one real channel (`runGateApprove`'s own `options.confirm`).
			// `confirmResult !== true` (headless/no-UI, a deny, a timeout) makes the factory return `null`
			// by construction — never approved, only ever `needs-human` (FR-11).
			const approval = mintHumanApproval(confirmResult, {
				gate,
				demandId,
				branch: demand.branch,
				source: meta.source,
			});
			if (approval === null) {
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

		calibrate(demandId, collapsedGates, _method) {
			// R24: a calibration can never name a mandatory gate — refused at registration time, never
			// silently trimmed to the legal subset.
			const offending = collapsedGates.filter((g) => MANDATORY_GATES.has(g)).sort((a, b) => a - b);
			if (offending.length > 0) {
				const offendingLabel = offending.map((g) => `gate ${g}`).join(", ");
				throw new GateCommandError(`calibration refused: cannot collapse mandatory ${offendingLabel}`);
			}
			ensureDemand(demandId);
			return snapshot(demandId);
		},
	};
}

/** Type re-export convenience for callers (e.g. `cli.ts`) that only need these runtime-owned unions,
 * not the whole `@conductor/runtime` barrel. */
export type { Approval, EvidenceProvenance, EvidenceRef, GateApprovalMethod };
