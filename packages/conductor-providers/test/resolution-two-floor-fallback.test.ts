/**
 * Test-first (Gate 5) for R47/R48/OQ#3 (D5, ADR 0008-fase7-model-routing-and-providers.md §7.1) -- the
 * two-floor fallback algorithm, exactly as the ADR states it:
 *
 *   floor := max(rank(gate), rank(persona)); activeProvider := the primary's provider
 *   Cok := { same provider AND rank >= floor }              -- ZERO consent needed, selects the first
 *   A   := { same provider, rank < floor }                  -- REJECTED always, never offered/consentible
 *   B   := { different provider, rank >= floor }             -- CONSENT-REQUIRED, never silently taken
 *   neither Cok nor a satisfiable A/B -> both-floors-unsatisfiable, disclosing BOTH sets
 *
 * "the two criteria are not ranked, they are ANDed -- when they diverge, the machine EXPOSES the
 * conflict, it does not resolve it silently" (§7.1, resolving spec gate2-spec-fase7.md's OQ#3).
 *
 * Every scenario below is only reached once the primary is genuinely unavailable (FR-16: fallback is
 * never a cost/speed optimization) -- modeled here as the primary's provider being "unreachable" in the
 * availability map, forcing the fallback evaluation.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { describe, expect, it } from "vitest";
import { resolveModelForGate } from "../src/index.ts";
import { baseContext, type ResolutionContextFixture, registerCandidate } from "./support/fixtures.ts";

const okCredential = { configured: true, source: "stored" as const, authorizedByPolicy: true };
const reachable = { state: "reachable" as const, checkedAt: "2026-08-07T00:00:00.000Z" };
const unreachable = {
	state: "unreachable" as const,
	checkedAt: "2026-08-07T00:00:00.000Z",
	detail: "connect ECONNREFUSED",
};

const MANDATORY_GATE = 9; // MANDATORY_GATES = {3,5,7,8,9} (@conductor/config builtin-roles-data.ts:305)

function contextWithUnavailablePrimary(): ResolutionContextFixture {
	const ctx = baseContext({ gateModelRoles: { [MANDATORY_GATE]: { role: "slow", source: "builtin" } } });
	registerCandidate(ctx, "slow", {
		provider: "anthropic",
		modelId: "claude-primary",
		rank: 3,
		declaredIn: "project-policy",
		credential: okCredential,
		availability: unreachable, // the primary is genuinely down -- fallback evaluation is legitimate.
	});
	ctx.availability.anthropic = unreachable;
	return ctx;
}

describe("D5 two-floor fallback: Cok (same provider AND rank >= floor) -- zero consent", () => {
	it("selects a same-provider, at-or-above-floor candidate automatically, with no consent-required refusal at all", () => {
		const ctx = contextWithUnavailablePrimary();
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-same-provider-strong",
			rank: 3, // >= floor (floor = rank(gate "slow") = 3)
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate(
			{ gate: MANDATORY_GATE, activeProvider: "anthropic", purpose: "gate-open" },
			ctx as never,
		);

		expect(result.resolved).toBe(true);
		if (result.resolved) {
			expect(result.ref).toEqual({ provider: "anthropic", modelId: "claude-same-provider-strong" });
			expect(result.fallbackOf?.consent).toBe("same-provider");
		}
	});
});

describe("D5 two-floor fallback: region A (same provider, rank < floor) -- rejected always, never offered/consentible", () => {
	it("a same-provider candidate below the tier floor is refused with below-tier-floor, never silently accepted", () => {
		const ctx = contextWithUnavailablePrimary();
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-same-provider-weak",
			rank: 0, // below floor=3
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate(
			{ gate: MANDATORY_GATE, activeProvider: "anthropic", purpose: "gate-open" },
			ctx as never,
		);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("below-tier-floor");
			if (result.refusal.kind === "below-tier-floor") {
				expect(result.refusal.candidate).toEqual({ provider: "anthropic", modelId: "claude-same-provider-weak" });
				expect(result.refusal.requiredRank).toBe(3);
				expect(result.refusal.bestRank).toBe(0);
			}
		}
	});
});

describe("D5 two-floor fallback: region B (cross-provider, rank >= floor) -- consent-required, never silently taken", () => {
	it("a cross-provider candidate at/above the tier floor is never auto-selected -- it refuses naming consent-required and the destination host", () => {
		const ctx = contextWithUnavailablePrimary();
		registerCandidate(ctx, "slow", {
			provider: "openai",
			modelId: "gpt-cross-provider-strong",
			rank: 3, // >= floor, but a DIFFERENT provider than activeProvider="anthropic"
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
			model: { baseUrl: "https://api.openai.com/v1" },
		});

		const result = resolveModelForGate(
			{ gate: MANDATORY_GATE, activeProvider: "anthropic", purpose: "gate-open" },
			ctx as never,
		);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("consent-required");
			if (result.refusal.kind === "consent-required") {
				expect(result.refusal.candidate).toEqual({ provider: "openai", modelId: "gpt-cross-provider-strong" });
				expect(result.refusal.destinationHost.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("D5 two-floor fallback: divergence -- no Cok candidate exists, only A and B -- fail-closed-and-discloses-both, never auto-picks either", () => {
	it("both-floors-unsatisfiable names BOTH sameProviderBelowTier and crossProviderAtTier -- the machine exposes the conflict, it never resolves it silently", () => {
		const ctx = contextWithUnavailablePrimary();
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-same-provider-weak",
			rank: 0, // region A
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});
		registerCandidate(ctx, "slow", {
			provider: "openai",
			modelId: "gpt-cross-provider-strong",
			rank: 3, // region B
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate(
			{ gate: MANDATORY_GATE, activeProvider: "anthropic", purpose: "gate-open" },
			ctx as never,
		);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("both-floors-unsatisfiable");
			if (result.refusal.kind === "both-floors-unsatisfiable") {
				expect(result.refusal.sameProviderBelowTier).toEqual([
					{ provider: "anthropic", modelId: "claude-same-provider-weak" },
				]);
				expect(result.refusal.crossProviderAtTier).toEqual([
					{ provider: "openai", modelId: "gpt-cross-provider-strong" },
				]);
			}
		}
	});
});
