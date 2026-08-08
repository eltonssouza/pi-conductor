/**
 * Test-first (Gate 5, Fase 8 "Autonomous mode") for `GateStateStoreView.approveAuto` (N1) and the
 * `InteractivityWitness` type (D3 layer 2) — both added to `src/commands/gate.ts` by this fase.
 * docs/adr/0009-fase8-autonomous-mode.md §1.1/§5.3/§14/§16, gate3-addendum-fase8.md T75/R56/T76-ish
 * (N1's own MANDATORY_GATES guard).
 *
 * Both the real adapter (`src/commands/gate-store.ts`) and the fake test double
 * (`test/support/fake-gate-store.ts`) still throw an unconditional "not implemented" for
 * `approveAuto` at this Gate 5 (see both files' own headers) -- every test in the first `describe`
 * block below therefore fails RED via that stub throw today, not via the named assertion it documents;
 * once Gate 6 wires the real MANDATORY_GATES guard into BOTH the real adapter and the fake, these
 * become the actual regression proof for N1.
 *
 * AMBIGUITY FLAGGED (not silently resolved): the D3-layer-2 "interactivity witness" mechanism (ADR
 * §5.3 -- `approve()`'s CONCRETE implementation in `gate-store.ts` must cross an injected
 * `isInteractive: () => boolean` against `confirmResult` before minting `method:"human"`) is
 * explicitly OUT of this Gate 5's touched-files scope: the task that produced this test suite
 * restricts changes to `commands/gate.ts` (interface + `InteractivityWitness` type export only) and
 * `workspace-policy.ts` -- `gate-store.ts`'s concrete `approve()` is Gate 6 scope, not touched here,
 * and `GateStateStoreView.approve()`'s SIGNATURE is explicitly left unchanged by this Gate 5 (the
 * existing six interface methods are untouched, per this file's own gate.ts header note). That means
 * this Gate 5 has no seam through which to inject a synthetic "true" confirm result under a
 * non-interactive witness and observe a real refusal -- the mechanism has no call site to test yet.
 * The second `describe` block below is therefore a narrower TYPE-CONTRACT smoke test only (the
 * exported shape is usable to build both a "yes" and a "no" witness) -- it is NOT the T75 security
 * proof; that proof can only be written once Gate 6 decides exactly where `isInteractive` is threaded
 * (most likely a constructor option on `PersistedGateStateStoreOptions`, per ADR §5.3's own prose),
 * and belongs in `gate-store.test.ts` at that point, mirroring how that file already tests `approve()`'s
 * real `confirmResult` behavior directly (see `createPersistedGateStateStore.approve` describe block
 * there). The closest THIS Gate 5 can honestly get to a T75 regression net is the headless-run
 * integration test in `auto-run.test.ts` ("a headless run never persists an Approval{method:human} for
 * a mandatory gate"), which exercises the OUTCOME the two-layer defense exists to guarantee, via
 * `runAuto` itself, even though it cannot isolate layer 2 from layer 1.
 */

import { MANDATORY_GATES } from "@conductor/config";
import { describe, expect, it } from "vitest";
import type { InteractivityWitness } from "../../src/commands/gate.ts";
import { createFakeGateStore } from "../support/fake-gate-store.ts";

const DEMAND = "demand-1";

describe("GateStateStoreView.approveAuto — N1: guarded by MANDATORY_GATES, never mints method:auto for a mandatory gate", () => {
	it.each([...MANDATORY_GATES].sort((a, b) => a - b))(
		"refuses to auto-approve mandatory gate %d, with a refusal that names it as mandatory -- NOT merely 'not implemented' (RED today: the current message is only the generic stub throw, which does not match /mandatory/i)",
		(gate) => {
			// Deliberately no store.start()/evidence/approve sequencing here: approveAuto's Gate-5 stub
			// throws unconditionally regardless of prior store state, so any setup needed to reach a
			// REALISTIC "gate is open" precondition would be inert today and is Gate 6's concern (that
			// setup already exists for the real `approve()` happy path in gate-store.test.ts). What this
			// test locks in NOW is the actual N1 CONTRACT -- a mandatory-gate refusal, not just any
			// throw -- via a message pattern the current generic "not implemented" stub genuinely does
			// NOT satisfy (proving this fails RED for the right reason, not merely "it throws").
			// `it.each` runs over the actual MANDATORY_GATES source of truth (never a hardcoded
			// {3,5,7,8,9} literal) so this test can never silently drift from it.
			const store = createFakeGateStore();
			expect(() => store.approveAuto(DEMAND, gate)).toThrow(/mandatory/i);
		},
	);

	it("the NON-mandatory happy path (gate 1) genuinely mints an auto approval -- RED today via the stub's uncaught throw, since store.approveAuto is called directly (not wrapped in toThrow)", () => {
		const store = createFakeGateStore();
		store.start(DEMAND, 1);
		expect(MANDATORY_GATES.has(1)).toBe(false);

		const snapshot = store.approveAuto(DEMAND, 1);

		// Unreachable today (the line above throws first) -- the real Gate-6 proof of N1's non-mandatory
		// happy path: a genuine method:"auto" Approval is minted and persisted.
		expect(snapshot.gates.find((g) => g.gate === 1)?.status).toBe("approved");
		expect(snapshot.gates.find((g) => g.gate === 1)?.approvalsCount).toBe(1);
	});
});

describe("InteractivityWitness — type-contract smoke test only (see this file's header: NOT the T75 security proof, which has no call site to test until Gate 6 wires gate-store.ts)", () => {
	it("is usable to construct a witness that always claims a real interactive TTY", () => {
		const alwaysInteractive: InteractivityWitness = () => true;
		expect(alwaysInteractive()).toBe(true);
	});

	it("is usable to construct a witness that always claims a headless/non-interactive process -- the shape the D3-layer-2 production default (`() => Boolean(process.stdin.isTTY && process.stdout.isTTY)`) must satisfy under a real CI/autonomous invocation", () => {
		const neverInteractive: InteractivityWitness = () => false;
		expect(neverInteractive()).toBe(false);
	});
});
