/**
 * Test-first (Gate 5) for R48/T67 -- the tier floor is UNIVERSAL and ABSOLUTE across all 14 gates, not
 * only the 5 mandatory ones.
 *
 * The Gate-5 task brief flagged this as an ambiguity to verify rather than assume ("check the ADR's exact
 * rule here rather than assuming"). The ADR's own §7.1 (D5) algorithm settles it explicitly:
 *
 *   "A -> REJEITADO sempre (R48/T67). Não é oferecido, não é consentível, NEM NOS 9 NÃO-OBRIGATÓRIOS."
 *   ("A -> rejected always. Not offered, not consentible, NOT EVEN IN THE 9 NON-MANDATORY GATES.")
 *
 * -- and §6.3 draws the actual line precisely: what DIFFERS between the 5 mandatory {3,5,7,8,9} and the
 * other 9 is the veto on AUTOMATIC fallback (absolute in the 5, opt-in-only in the 9) -- never the tier
 * floor itself, which is universal in both. So this file asserts the SAME refusal (below-tier-floor) for
 * both a mandatory gate (9) and a non-mandatory one (11), given the identical below-tier-only candidate
 * shape -- proving gate criticality never relaxes the floor.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { MANDATORY_GATES } from "@conductor/config";
import { describe, expect, it } from "vitest";
import { resolveModelForGate } from "../src/index.ts";
import { baseContext, type ResolutionContextFixture, registerCandidate } from "./support/fixtures.ts";

const okCredential = { configured: true, source: "stored" as const, authorizedByPolicy: true };
const reachable = { state: "reachable" as const, checkedAt: "2026-08-07T00:00:00.000Z" };

const MANDATORY_GATE = 9;
const NON_MANDATORY_GATE = 11;

function contextWithOnlyBelowTierCandidate(gate: number): ResolutionContextFixture {
	const ctx = baseContext({ gateModelRoles: { [gate]: { role: "slow", source: "builtin" } } });
	registerCandidate(ctx, "slow", {
		provider: "anthropic",
		modelId: "claude-below-tier",
		rank: 0, // floor for "slow" is 3 -- this candidate is unconditionally below it.
		declaredIn: "project-policy",
		credential: okCredential,
		availability: reachable,
	});
	return ctx;
}

describe("R48/T67: tier floor is a hard, universal invariant across ALL 14 gates -- not just the 5 mandatory ones", () => {
	it("sanity: gate 9 is in MANDATORY_GATES and gate 11 is not (fixture assumption double-checked against the real, shared constant)", () => {
		expect(MANDATORY_GATES.has(MANDATORY_GATE)).toBe(true);
		expect(MANDATORY_GATES.has(NON_MANDATORY_GATE)).toBe(false);
	});

	it("mandatory gate (9): the only candidate is below the tier floor -> refused below-tier-floor, never silently accepted", () => {
		const ctx = contextWithOnlyBelowTierCandidate(MANDATORY_GATE);

		const result = resolveModelForGate({ gate: MANDATORY_GATE, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(false);
		if (!result.resolved) expect(result.refusal.kind).toBe("below-tier-floor");
	});

	it("NON-mandatory gate (11): the SAME below-tier-only shape STILL refuses below-tier-floor -- gate criticality does not relax the floor", () => {
		const ctx = contextWithOnlyBelowTierCandidate(NON_MANDATORY_GATE);

		const result = resolveModelForGate({ gate: NON_MANDATORY_GATE, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(false);
		if (!result.resolved) expect(result.refusal.kind).toBe("below-tier-floor");
	});
});
