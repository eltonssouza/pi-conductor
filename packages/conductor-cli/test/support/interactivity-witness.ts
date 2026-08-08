/**
 * `InteractivityWitness` (D3 layer 2, `commands/gate.ts`) doubles for tests whose subject is NOT the
 * TTY-crossing check itself -- mirrors `test/support/model-resolution-port.ts`'s own rationale.
 *
 * Gate 8 loop-back, finding 5: `PersistedGateStateStoreOptions.isInteractive` is REQUIRED (same
 * discipline as `modelResolutionPort`, ADR 0008 §21/D11 -- an optional field with a production default
 * nothing overrides in a test is exactly the shape that already made `modelResolutionPort`'s own
 * fail-closed check silently inert once). Making it required means every test that constructs the real
 * store must state explicitly whether it wants an "interactive" or "headless" double -- never silently
 * inherit `process.stdin.isTTY`, which is itself unstable across test runners/CI and exactly the kind of
 * ambiguity a security-relevant witness must never have.
 *
 * `alwaysInteractiveWitness()` is the explicit statement "this test's subject is NOT D3 layer 2" -- used
 * by tests whose subject is `approve()`'s happy path / idempotency / decision-kind / gate sequencing, not
 * the interactivity crossing itself. `neverInteractiveWitness()` is the double that actually exercises
 * the D3 layer 2 refusal (see `gate-store.test.ts`'s own "D3 layer 2" describe block).
 */

import type { InteractivityWitness } from "../../src/commands/gate.ts";

/** Always claims a real interactive TTY -- for tests whose subject is not D3 layer 2. */
export function alwaysInteractiveWitness(): InteractivityWitness {
	return () => true;
}

/** Always claims a headless/non-interactive process -- the shape a real autonomous/CI invocation
 * satisfies; use this to test D3 layer 2's refusal directly. */
export function neverInteractiveWitness(): InteractivityWitness {
	return () => false;
}
