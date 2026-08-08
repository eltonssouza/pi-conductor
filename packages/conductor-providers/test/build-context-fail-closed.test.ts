/**
 * Test-first (Gate 5) for R49(iii) (ADR 0008-fase7-model-routing-and-providers.md §6.3/§8.2, D3): "erro de
 * I/O/rede em qualquer etapa degrada para 'indisponível/ausente', nunca para 'disponível'" -- applied here
 * to the ONE async I/O boundary this package's public contract names: `buildResolutionContext`.
 *
 * This is a defense-in-depth test, and the comment matters: `AvailabilityCache.probe` is CONTRACTED
 * (ADR §16: "Probe barato... Nunca lança") to never throw. This test deliberately hands
 * `buildResolutionContext` an injected `AvailabilityCache` collaborator that VIOLATES that contract (its
 * `probe()` rejects, simulating a genuine internal error slipping through a misbehaving/third-party
 * implementation of the interface) -- and asserts `buildResolutionContext` still does not reject/throw,
 * and that a subsequent `resolveModelForGate` over the resulting context never treats the broken provider
 * as available. The point: even the composition root's OWN injected collaborators are not trusted blindly
 * -- the same fail-safe discipline `grounding-ledger.ts`/`policy-trust-store.ts` already apply elsewhere
 * in this monorepo (R44/R36, cited by this ADR's §8.2).
 *
 * Uses a REAL `ModelRuntime` (in-memory credential store, `allowModelNetwork: false`, no real network --
 * same construction already used by this repo's own tests, e.g.
 * packages/coding-agent/test/model-runtime-test-utils.ts) -- never a stub of the function actually under
 * test (`buildResolutionContext`/`resolveModelForGate`).
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { AvailabilityCache, ProviderAvailability } from "../src/index.ts";
import { buildResolutionContext, resolveModelForGate } from "../src/index.ts";

/** Satisfies ModelPolicyTrustStore (ADR §16, @conductor/config section) -- trivial, always-trusted fake;
 * this test is not about TOFU pinning, so a fixed answer is legitimate here (not a mock of the SUT). */
const alwaysTrustedStore = { isTrusted: (_contentHash: string) => true };

class ProbeThrowsAvailabilityCache implements AvailabilityCache {
	probedProviders: string[] = [];

	get(_provider: string): ProviderAvailability | undefined {
		return undefined; // nothing cached yet -- forces a probe if buildResolutionContext ever calls one.
	}

	async probe(provider: string, _options: { timeoutMs: number; signal?: AbortSignal }): Promise<ProviderAvailability> {
		this.probedProviders.push(provider);
		// Deliberately violates the interface's own "never lança" contract, simulating an internal error
		// (e.g. a DNS resolver crash, a malformed response the implementation failed to guard) slipping
		// through despite the contract -- this is what R49(iii) has to survive.
		throw new Error("simulated internal error inside a misbehaving AvailabilityCache.probe implementation");
	}
}

describe("R49(iii): buildResolutionContext degrades to 'unavailable', never throws, even when an injected AvailabilityCache.probe rejects", () => {
	it("does not reject/throw, and the resulting context never lets resolveModelForGate treat that provider as available", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("anthropic", async () => ({ type: "api_key" as const, key: "sk-ant-fake-test-only" }));
		const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });

		const availability = new ProbeThrowsAvailabilityCache();

		let caught: unknown;
		let ctx: Awaited<ReturnType<typeof buildResolutionContext>> | undefined;
		try {
			ctx = await buildResolutionContext({
				workspaceRoot: process.cwd(),
				modelRuntime,
				policy: {
					schema: 1,
					bindings: [{ role: "slow", provider: "anthropic", modelId: "claude-opus-4-8" }],
					egress: { crossProvider: "deny" },
				},
				trust: alwaysTrustedStore,
				availability,
			});
		} catch (error) {
			caught = error;
		}

		expect(caught, `buildResolutionContext must never throw/reject; it did: ${String(caught)}`).toBeUndefined();
		expect(ctx).toBeDefined();

		if (ctx) {
			const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx);
			// Whatever the exact refusal/selection is, a provider whose ONLY probe attempt threw must never
			// be reported as "reachable" in the trace -- an error must degrade to unavailable, never read as
			// "confirmed healthy".
			const availabilityStep = result.trace.steps.find(
				(step): step is Extract<typeof step, { stage: "availability" }> => step.stage === "availability",
			);
			if (availabilityStep) {
				const anthropicEntry = availabilityStep.perProvider.find((entry) => entry.provider === "anthropic");
				expect(anthropicEntry?.state).not.toBe("reachable");
			}
		}
	});
});
