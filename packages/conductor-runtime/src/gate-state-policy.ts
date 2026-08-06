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
 * R23: is every mandatory gate below `upToGate` genuinely, non-forgeably satisfied? Pure — no I/O,
 * so a caller (evaluateAdvance, or `gate approve`'s own pre-check on the CLI side, out of this
 * file's scope) can call this against any in-memory `GateState`, including one built entirely by a
 * test fixture.
 */
export function isMandatorySatisfied(_state: GateState, _upToGate: number, _mandatory: ReadonlySet<number>): boolean {
	throw new Error("not implemented");
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
	_state: GateState,
	_targetGate: number,
	_mandatory: ReadonlySet<number>,
): GateAdvanceVerdict {
	throw new Error("not implemented");
}

/**
 * R24: does `collapsedGates` respect the mandatory floor? Called by the (out-of-scope) `gate
 * calibrate` command BEFORE persisting a `CalibrationDecision` — a `{ ok: false }` result MUST
 * refuse the whole registration, never silently drop just the offending gate numbers and persist
 * the rest.
 */
export function evaluateCalibration(
	_collapsedGates: number[],
	_mandatory: ReadonlySet<number>,
): { ok: true } | { ok: false; offendingMandatory: number[] } {
	throw new Error("not implemented");
}
