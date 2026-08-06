/**
 * Pure policy for the `GateState` machine — NO I/O, NO UI, unit-testable against an in-memory
 * `GateState` alone (ADR 0005 §2 "Meio (política pura)"; §4 R23; §5 R24; §7 R26).
 *
 * GATE 5 (test-first): `evaluateAdvance`/`isMandatorySatisfied`/`evaluateCalibration` are STUBS
 * that throw "not implemented" — Gate 6 implements the bodies. `test/gate-state-policy.test.ts`
 * drives this real, locked interface directly (plain object fixtures, never a mock/double — Unit
 * Testing Principles §3.9/§3.12: "the real collaborator is cheap and in-process... a value object,
 * a pure calculator" is exactly a `GateState` fixture here) and fails RED for the single correct
 * reason: Gate 6 has not written the body yet.
 *
 * Binding contracts Gate 6 MUST satisfy (gate3-addendum-fase4.md R23/R24/R26, ADR §4/§5/§7):
 *
 *   R23 (piso obrigatório, T42) — `isMandatorySatisfied` treats a gate `g` in `mandatory` with
 *   `g < upToGate` as satisfied ONLY when its record is genuinely `status === "approved"` AND
 *   backed by (a) at least one `Evidence` item (BR-6: an obrigatório never closes "empty") AND
 *   (b) at least one `Approval` that is STRUCTURALLY keyed to (gate `g`, `state.demandId`,
 *   `state.branch`) — the `_is_approval`/D7-D8 anti-spoofing form of `gate_land.py`, never a
 *   substring match, never an `Approval` borrowed from a different gate/demand/branch. A `status`
 *   field that merely SAYS "approved" without that backing is untrusted, not authoritative.
 *
 *   R26 (verdict terminal, T46) — `evaluateAdvance` returns `{ kind: "approved" }` ONLY from a
 *   positive, successfully-evaluated pass; ANY uncertainty (a hostile/malformed `GateState`, an
 *   exception thrown mid-evaluation from a cause nobody anticipated) resolves to
 *   `{ kind: "could-not-verify" }` — NEVER a default/fallback/catch-all `"approved"`. This is the
 *   mirror-image, fail-CLOSED lesson `gate_land.py` learned the fail-OPEN way across 5 rounds of
 *   pentest (ADR §7 Ruling B): the property is TERMINAL, not an enumeration of anticipated causes.
 *
 *   R24 (teto de calibração, T45) — `evaluateCalibration` refuses (at the caller's REGISTRATION
 *   point, before any `Decision` is persisted) any `collapsedGates` that names a member of
 *   `mandatory` — the floor is intocável by calibration "regardless of how small the change looks"
 *   (BR-1), never partially allowed, never silently trimmed to the legal subset.
 */

import type { GateState } from "./gate-state.ts";

/**
 * Terminal, 3-shape verdict (R26) — `approved`/`refused` are both genuine, evaluated outcomes;
 * `could-not-verify` is the LOUD, registered "I don't know" — distinguishable from `refused` so an
 * operator never confuses "the gate genuinely did not pass" with "the state could not be read".
 * `refused`/`could-not-verify` both BLOCK advance (the fail-closed direction agrees on both), but
 * are never conflated into one shape.
 */
export type GateAdvanceVerdict =
	| { kind: "approved" }
	| { kind: "refused"; missingMandatoryGates: number[]; reason: string }
	| { kind: "could-not-verify"; reason: string };

/**
 * GATE 6 implementation notes (kept next to the code, not just in the file header):
 *
 * `isGateGenuinelyApproved` is the single low-level predicate both `isMandatorySatisfied` and
 * `evaluateAdvance`'s `missingMandatoryGates` list are built from — one home for "what does it mean
 * for gate N to be genuinely closed" (R23):
 *   1. `record.status === "approved"` — `not-started`/`rejected`/anything else fails the floor
 *      (FR-9 generalized: `rejected` blocks exactly as hard as `not-started`).
 *   2. `record.evidence.length > 0` — BR-6: an "approved" gate with zero evidence is not trusted,
 *      however the `status` field reads.
 *   3. At least one evidence item has `provenance === "runtime-derived"` — the R25 "golden rule"
 *      (gate-evidence.ts's own `hasSufficientEvidenceForMandatoryGate`, T41/BR-6): a mandatory gate
 *      never closes on author-declared evidence alone. This logic is intentionally NOT imported from
 *      `gate-evidence.ts` — that file is a parallel Gate 5/6 stream owned by another engineer in this
 *      session and still throws "not implemented"; importing its stub would make every test in this
 *      file RED for a reason outside this file's own scope. The predicate itself is one line and the
 *      contract is pinned by `EvidenceProvenanceInfo`'s own shape (`{ provenance }`), so duplicating
 *      it here is a deliberate, narrow trade-off — not a second, drifting design — with a TODO to
 *      delete this inline copy and import the real one once that stream lands.
 *   4. At least one `Approval` structurally keyed to (this gate, `state.demandId`, `state.branch`) —
 *      the anti-spoofing form of `gate_land.py`'s `_is_approval`/D7-D8 (R23(iv)): an `Approval`
 *      borrowed from a different gate, demand, or branch never counts, however well-formed.
 */
function isGateGenuinelyApproved(state: GateState, gate: number): boolean {
	const record = state.gates[gate];
	if (!record) return false;
	if (record.status !== "approved") return false;
	if (record.evidence.length === 0) return false;
	if (!record.evidence.some((item) => item.provenance === "runtime-derived")) return false;
	return record.approvals.some(
		(approval) => approval.gate === gate && approval.demandId === state.demandId && approval.branch === state.branch,
	);
}

/** The mandatory gates below `upToGate` that are NOT genuinely approved, ascending — the single
 * source both `isMandatorySatisfied` (boolean) and `evaluateAdvance` (the named `refused` list)
 * derive from, so the two can never disagree about which gates are missing. */
function collectMissingMandatoryGates(state: GateState, upToGate: number, mandatory: ReadonlySet<number>): number[] {
	const missing: number[] = [];
	for (const gate of mandatory) {
		if (gate < upToGate && !isGateGenuinelyApproved(state, gate)) missing.push(gate);
	}
	return missing.sort((a, b) => a - b);
}

/**
 * R26's terminal property, factored out so `evaluateAdvance` can wrap ONE call in its `try`: touches
 * every top-level field this module's contract cares about — including `currentGate`, which
 * `collectMissingMandatoryGates` itself never reads — deliberately. A hostile/corrupted `GateState`
 * (a getter that throws from a cause nobody anticipated) must resolve to `could-not-verify`
 * regardless of WHICH field the exception came from (gate3-addendum-fase4.md T46: "terminal, not an
 * enumeration of causes") — reading the field here, inside the guarded call, is what makes that hold
 * even for a field the mandatory-floor check would otherwise have no reason to touch.
 */
function assertWellFormedGateStateShape(state: GateState): void {
	if (typeof state.demandId !== "string" || typeof state.branch !== "string") {
		throw new TypeError("GateState.demandId/branch must be strings");
	}
	if (typeof state.currentGate !== "number" || !Number.isFinite(state.currentGate)) {
		throw new TypeError("GateState.currentGate must be a finite number");
	}
	if (typeof state.gates !== "object" || state.gates === null) {
		throw new TypeError("GateState.gates must be an object");
	}
}

/**
 * R23: is every mandatory gate below `upToGate` genuinely, non-forgeably satisfied? Pure — no I/O,
 * so a caller (evaluateAdvance, or `gate approve`'s own pre-check on the CLI side, out of this
 * file's scope) can call this against any in-memory `GateState`, including one built entirely by a
 * test fixture.
 *
 * Deliberately NOT wrapped in its own try/catch: per this file's header, a caller (evaluateAdvance)
 * is responsible for guaranteeing the terminal property across everything it calls, including this
 * function throwing on a hostile `state`. Calling this directly (as `gate approve`'s own CLI-side
 * pre-check might) without that wrapping is a caller choice out of this file's scope, not a gap here.
 */
export function isMandatorySatisfied(state: GateState, upToGate: number, mandatory: ReadonlySet<number>): boolean {
	return collectMissingMandatoryGates(state, upToGate, mandatory).length === 0;
}

/**
 * R26: can `state` advance to `targetGate`? Delegates the mandatory-floor question to
 * `isMandatorySatisfied`; the terminal property (an exception from an unanticipated cause resolves
 * to `could-not-verify`, never `approved`) is this function's OWN responsibility to guarantee —
 * `isMandatorySatisfied` throwing (or any other unexpected exception raised while reading `state`)
 * must never propagate out of this function as an uncaught crash, and must never be interpreted as
 * "nothing stood in the way".
 */
export function evaluateAdvance(
	state: GateState,
	targetGate: number,
	mandatory: ReadonlySet<number>,
): GateAdvanceVerdict {
	try {
		assertWellFormedGateStateShape(state);
		if (!isMandatorySatisfied(state, targetGate, mandatory)) {
			const missing = collectMissingMandatoryGates(state, targetGate, mandatory);
			return {
				kind: "refused",
				missingMandatoryGates: missing,
				reason: `mandatory gate(s) ${missing.join(", ")} below gate ${targetGate} are not genuinely approved`,
			};
		}
		return { kind: "approved" };
	} catch (error) {
		// R26 (ii)/(iii): ANY uncertainty -- I/O this function doesn't even do, a schema surprise, an
		// exception from a cause nobody anticipated -- resolves here, loud and registered, NEVER as a
		// silent default that reads as "approved". `approved` above is the ONLY line in this function
		// that can ever produce it, and it is reached only after a positive, successfully-evaluated
		// pass (ADR 0005 §7 Ruling B: no construction-token needed -- the union + this terminal test +
		// the fail-closed default here are the honest control).
		return {
			kind: "could-not-verify",
			reason: `unable to evaluate GateState for advance to gate ${targetGate}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

/**
 * R24: does `collapsedGates` respect the mandatory floor? Called by the (out-of-scope) `gate
 * calibrate` command BEFORE persisting a `CalibrationDecision` — a `{ ok: false }` result MUST
 * refuse the whole registration, never silently drop just the offending gate numbers and persist
 * the rest.
 */
export function evaluateCalibration(
	collapsedGates: number[],
	mandatory: ReadonlySet<number>,
): { ok: true } | { ok: false; offendingMandatory: number[] } {
	if (!Array.isArray(collapsedGates)) {
		// Fail closed on a malformed/uncertain argument (the same direction as R26, applied to input
		// validation): never treat "not even a proper list" as "nothing offends" -- refuse citing the
		// WHOLE mandatory floor as offending, rather than silently coercing or ignoring a bad caller.
		return { ok: false, offendingMandatory: Array.from(mandatory).sort((a, b) => a - b) };
	}
	const offending = Array.from(new Set(collapsedGates.filter((gate) => mandatory.has(gate)))).sort((a, b) => a - b);
	if (offending.length > 0) return { ok: false, offendingMandatory: offending };
	return { ok: true };
}
