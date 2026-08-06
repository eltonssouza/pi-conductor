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
	store: GateStateStore,
	mutate: (current: GateState) => GateState,
): Result<{ next: GateState; revision: number }, GateStateMutationError> {
	// GATE 6: `store.mutate()` (gate-state-store.ts) already IS the check-and-write, zero-await,
	// lock+CAS-guarded, atomic-write implementation (R27) -- this function's own header explains why
	// it exists as a separate, thin, named seam anyway (so a future caller can compose cross-cutting
	// behavior -- retry-on-could-not-verify, telemetry -- around EVERY mutation call site in one
	// place) rather than every call site invoking `store.mutate` directly. No cross-cutting behavior
	// has been asked for yet (Gate 6 scope), so the body only forwards -- adding speculative
	// retry/telemetry here now would be exactly the un-asked-for complexity Gate 4's own "baixa
	// complexidade acidental" quality attribute (ADR 0005 §1.3 item 4) warns against.
	//
	// A bug INSIDE `mutate` throws straight out of `store.mutate(...)`, hence straight out of this
	// call too -- nothing here wraps it in a try/catch that could turn it into a misleadingly generic
	// `io-error` (contract point 3 above).
	return store.mutate(mutate);
}
