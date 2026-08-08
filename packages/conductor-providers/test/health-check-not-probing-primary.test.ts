/**
 * Test-first (Gate 5) for D7 (ADR 0008-fase7-model-routing-and-providers.md §9, "Caminho quente: O
 * primário nunca é probado -- a chamada real É o health-check do primário"): a directly-authorized,
 * already-credentialed primary candidate is never handed to `AvailabilityCache.probe` during a
 * resolution -- there is no need to check reachability of a call you are about to place anyway (SLI 7,
 * §12: "Latência acrescentada ao turno em andamento pelo probe" has a **0 ms, zero-error-budget**
 * invariant target -- the only way to hit 0 ms is to never call probe() for the primary at all).
 *
 * Exercises the REAL public boundary end to end (`buildResolutionContext` then `resolveModelForGate`,
 * both from `../src/index.ts`) with a spy `AvailabilityCache` counting real calls -- never a mock of
 * either function under test itself.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { AvailabilityCache, ProviderAvailability } from "../src/index.ts";
import { buildResolutionContext, resolveModelForGate } from "../src/index.ts";

const alwaysTrustedStore = { isTrusted: (_contentHash: string) => true };

class SpyAvailabilityCache implements AvailabilityCache {
	probedProviders: string[] = [];
	private readonly cached = new Map<string, ProviderAvailability>();

	get(provider: string): ProviderAvailability | undefined {
		return this.cached.get(provider);
	}

	async probe(provider: string, _options: { timeoutMs: number; signal?: AbortSignal }): Promise<ProviderAvailability> {
		this.probedProviders.push(provider);
		const result: ProviderAvailability = { state: "reachable", checkedAt: new Date().toISOString() };
		this.cached.set(provider, result);
		return result;
	}
}

describe("D7: the primary is never probed when it is already directly authorized and its credential is already known-configured", () => {
	it("probe() is called zero times for the primary's provider across buildResolutionContext + resolveModelForGate", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("anthropic", async () => ({ type: "api_key" as const, key: "sk-ant-fake-test-only" }));
		const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });

		const availability = new SpyAvailabilityCache();

		const ctx = await buildResolutionContext({
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

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx);

		// Whether resolution succeeds or not for THIS specific model id (that depends on the generated
		// catalog's exact model list, not the point of this test), the claim under test is narrower and
		// unconditional: a directly-authorized, already-credentialed primary is never itself probed.
		expect(availability.probedProviders).not.toContain("anthropic");
		void result;
	});
});
