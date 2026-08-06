/**
 * mutateGateState — the check-and-write orchestration for a `GateState` mutation (ADR 0005 §3,
 * R27; gate3-addendum-fase4.md T43).
 *
 * GATE 5 (test-first): `mutateGateState` is a STUB that throws "not implemented" — Gate 6
 * implements the body. `test/gate-state-mutation.test.ts` drives this real, locked interface
 * directly and fails RED for the single correct reason: Gate 6 has not written the body yet.
 *
 * Signature deviation from ADR §18's illustrative form (declared, not silent — see
 * gate-state-store.ts's header for the same disclaimer): the ADR shows
 * `mutateGateState(demandId: string, mutate: (current: GateState) => GateState)`. A bare
 * `demandId` cannot alone locate `.conductor/gates/<sanitized-branch>--<hash8>.json` without
 * either (a) a directory scan keyed by content (`demandId` is checked AGAINST an envelope, never
 * used to compute its path — ADR §3.1's own "content, not filename, is the truth"), or (b) a
 * hidden global/default resolution of `gatesDir`/`branch`/`repoId` this function would have to
 * invent. Both are real production-wiring decisions the ADR explicitly leaves to Gate 6/CLI
 * (§18: "Ilustrativos de contrato, não código de produção pronto para commit"). This function
 * instead takes an already-constructed `GateStateStore` (gate-state-store.ts) — the CLI/production
 * call site resolves `demandId`/`repoId`/`branch`/`gatesDir` once (from git state + workspace
 * config, out of this Gate-5 scope) and constructs the store; `mutateGateState` is then a THIN,
 * independently-unit-testable wrapper around `store.mutate` that exists as its own named seam
 * (rather than only ever calling `store.mutate` directly) so a future caller can compose
 * cross-cutting behavior (retry-on-`could-not-verify`, telemetry, …) around EVERY mutation site in
 * one place — this is Gate 6's decision, not invented here; the current body only forwards.
 *
 * Behavioral contract Gate 6 MUST satisfy (unchanged from the ADR regardless of the signature
 * adaptation above):
 *   1. Synchronous end-to-end, ZERO `await`/microtask between acquiring the lock and completing the
 *      rename (the `shared-budget.ts:reserve()` pattern, T40 precedent) — this is what makes a
 *      SINGLE process's own mutation atomic by construction, not by a lock alone.
 *   2. Cross-process safety is `GateStateStore`'s job (the exclusive lock + CAS-on-`revision`
 *      backstop, gate-state-store.ts) — `mutateGateState` never re-implements it, never bypasses it.
 *   3. A bug INSIDE the caller's `mutate` callback THROWS out of this call — it is never caught and
 *      silently turned into a misleadingly generic `{ kind: "io-error" }`.
 */

import type { Result } from "@earendil-works/pi-agent-core";
import type { GateState } from "./gate-state.ts";
import type { GateStateMutationError, GateStateStore } from "./gate-state-store.ts";

export function mutateGateState(
	_store: GateStateStore,
	_mutate: (current: GateState) => GateState,
): Result<{ next: GateState; revision: number }, GateStateMutationError> {
	throw new Error("not implemented");
}
