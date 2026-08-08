/**
 * Test-first (Gate 5) for R46/T65 -- THE CANARY. This is the single most important test in this stream:
 * the exact DEEPSEEK_API_KEY-shaped scenario from docs/conductor/gate3-addendum-fase7.md (T65, §7b item 1)
 * and ADR 0008-fase7-model-routing-and-providers.md §5.2 stage 4 ("nenhum ramo deste pipeline produz um
 * Model a partir de 'existe uma credencial para algum provedor'"; `findInitialModel` step 4,
 * model-resolver.ts:681-696, is NOT a call-site of this resolver).
 *
 * The incident being reopened-at-the-source (per the ADR's own framing, §1.2/§0 of the addendum): an
 * unintended DEEPSEEK_API_KEY in the process env let a session silently call a paid provider nobody
 * chose. R46 requires the resolver to NEVER treat "a provider has SOME credential, sourced from the
 * environment" as authorization -- only an explicit binding in the policy authorizes a (provider, model)
 * pair for a role. `conductor auth`/`getProviderAuthStatus` may (and should) REPORT the environment
 * credential; the RESOLVER must never act on it alone.
 *
 * Exercises the real `resolveModelForGate` over a snapshot this stream constructs -- never a stub/mock of
 * the function under test. Fails RED today because `../src/index.ts` does not exist yet.
 */

import { describe, expect, it } from "vitest";
import { resolveModelForGate } from "../src/index.ts";
import { baseContext, type ResolutionContextFixture, registerCandidate } from "./support/fixtures.ts";

const reachable = { state: "reachable" as const, checkedAt: "2026-08-07T00:00:00.000Z" };

/**
 * The canary shape: "deepseek" has a credential the resolver CAN see (source: "environment", configured
 * true -- simulating a DEEPSEEK_API_KEY the user exported for something unrelated), but NO binding in the
 * policy names deepseek for this role/gate. `authorizedByPolicy: false` is the ONLY thing an honest
 * ResolutionContext snapshot could ever report here (R46(i)): the presence of the credential does not,
 * by itself, become a binding.
 */
function contextWithUnauthorizedEnvCredentialOnly(role: "slow" | "default" = "slow"): ResolutionContextFixture {
	const ctx = baseContext({ gateModelRoles: { 9: { role, source: "builtin" } } });
	// No registerCandidate() call for deepseek at all -- there is no binding. We still need the
	// credential map to report it exists, because `conductor auth` has to be able to show it
	// (R46(ii)) -- that visibility is independent of whether the resolver is willing to use it.
	ctx.credentials.deepseek = { configured: true, source: "environment", authorizedByPolicy: false };
	ctx.availability.deepseek = reachable;
	// The model IS a real, resolvable catalog entry (so a hypothetical "auto-discover by known model"
	// shortcut can't be blamed for refusing merely because the model itself is unknown) -- the point is
	// authorization, not catalog validity.
	ctx.catalog["deepseek::deepseek-canary-model"] = {
		id: "deepseek-canary-model",
		name: "deepseek-canary-model",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
		contextWindow: 64_000,
		maxTokens: 8192,
	};
	return ctx;
}

describe("R46/T65 canary: the resolver NEVER authorizes a model by presence of an environment credential alone", () => {
	it("no binding names deepseek for the role -> refuses (never silently 'discovers' the env-credentialed provider)", () => {
		const ctx = contextWithUnauthorizedEnvCredentialOnly();

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			// Whatever the exact refusal is, it must never be a resolved model, and definitely never deepseek.
			expect(result.refusal.kind).not.toBe("unknown-model");
		}
	});

	it("when a DIFFERENT, properly-authorized provider exists alongside the env-credentialed-but-unauthorized deepseek, resolution picks the authorized one -- never deepseek", () => {
		const ctx = contextWithUnauthorizedEnvCredentialOnly();
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-properly-authorized",
			rank: 3,
			declaredIn: "project-policy",
			credential: { configured: true, source: "stored", authorizedByPolicy: true },
			availability: reachable,
		});

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(true);
		if (result.resolved) {
			expect(result.ref.provider).not.toBe("deepseek");
			expect(result.ref).toEqual({ provider: "anthropic", modelId: "claude-properly-authorized" });
		}
	});

	it("holds across every ResolveModelRequest.purpose (gate-open AND delegation) -- the incident originally happened via delegation (task.ts); this resolver's primary authorization path must close it identically for both", () => {
		for (const purpose of ["gate-open", "delegation"] as const) {
			const ctx = contextWithUnauthorizedEnvCredentialOnly();
			registerCandidate(ctx, "slow", {
				provider: "anthropic",
				modelId: "claude-properly-authorized",
				rank: 3,
				declaredIn: "project-policy",
				credential: { configured: true, source: "stored", authorizedByPolicy: true },
				availability: reachable,
			});

			const result = resolveModelForGate(
				{
					gate: 9,
					purpose,
					persona: purpose === "delegation" ? { name: "sdet", modelRole: "standard" } : undefined,
				},
				ctx as never,
			);

			expect(result.resolved, `purpose=${purpose}`).toBe(true);
			if (result.resolved) expect(result.ref.provider, `purpose=${purpose}`).toBe("anthropic");
		}
	});

	it("even when deepseek IS the only candidate with a resolvable model in the catalog, an unauthorized environment credential is still refused fail-closed rather than 'the best we have'", () => {
		// No fallback candidate at all this time -- deepseek is genuinely the only entry in the catalog,
		// still with zero binding. A resolver that fell back to "well, something has a key" here would be
		// reintroducing findInitialModel step 4 by another name.
		const ctx = contextWithUnauthorizedEnvCredentialOnly("default");

		const result = resolveModelForGate(
			{ gate: 9, persona: { name: "backend-engineer", modelRole: "standard" }, purpose: "delegation" },
			ctx as never,
		);

		expect(result.resolved).toBe(false);
	});
});
