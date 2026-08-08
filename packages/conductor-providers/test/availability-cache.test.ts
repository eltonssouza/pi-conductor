/**
 * Test-first (Gate 5) for R51/T70 (ADR 0008-fase7-model-routing-and-providers.md §9/§7.3, D7): the
 * `AvailabilityCache` is a cheap, bounded, non-blocking, never-throwing probe -- with concrete cooldown
 * numbers declared as tunable defaults, not invented constants (§7.3):
 *   probeTimeoutMs=2000, successTtlMs=60000, attemptsPerResolution=2,
 *   backoffBaseMs=500/factor=2/capMs=8000 (full jitter), cooldownBaseMs=30000/capMs=900000
 *   (`min(30s * 2^consecutiveFailures, 15min)`).
 *
 * JUDGMENT CALL flagged for Gate 6 (see this stream's final report): ADR §16 names the `AvailabilityCache`
 * INTERFACE and the `AVAILABILITY_DEFAULTS` constant, but never names an exported FACTORY function that
 * constructs a real, concrete `AvailabilityCache` -- only that something in `@conductor/providers` must,
 * since the interface is what `buildResolutionContext` receives as an injected collaborator. This file
 * assumes a plausible name, `createAvailabilityCache`, following this repo's own `create*`/`open*` naming
 * convention (createScratchWorkspace, openGroundingLedgerWriter/Reader) and accepting a `now`/`probeImpl`
 * seam -- the same "I/O at the edges, injectable" pattern `policy-loader.ts`/`role-loader.ts` already
 * document. If Gate 6 names it differently, only this file's import needs to change; the behavioral
 * claims below (timeout/never-throws/cooldown formula) do not depend on the name.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { describe, expect, it } from "vitest";
import { AVAILABILITY_DEFAULTS, createAvailabilityCache } from "../src/index.ts";

describe("AVAILABILITY_DEFAULTS (§7.3/§16 -- exact literal values, sobreponíveis pelo operador, não descobertas)", () => {
	it("matches the ADR's declared defaults exactly", () => {
		expect(AVAILABILITY_DEFAULTS).toEqual({
			probeTimeoutMs: 2_000,
			successTtlMs: 60_000,
			attemptsPerResolution: 2,
			backoffBaseMs: 500,
			backoffFactor: 2,
			backoffCapMs: 8_000,
			cooldownBaseMs: 30_000,
			cooldownCapMs: 15 * 60_000,
		});
	});
});

describe("AvailabilityCache.probe (R51: cheap, bounded, never throws)", () => {
	it("respects a short custom timeoutMs -- a probeImpl that never resolves still returns (does not hang past the timeout)", async () => {
		const hangingProbe = () => new Promise<never>(() => {}); // never settles on its own.
		const cache = createAvailabilityCache({ probeImpl: hangingProbe });

		const startedAt = Date.now();
		const result = await cache.probe("anthropic", { timeoutMs: 50 });
		const elapsedMs = Date.now() - startedAt;

		expect(elapsedMs).toBeLessThan(2_000); // generous upper bound -- must not hang for the full default 2s.
		expect(result.state).not.toBe("reachable");
	}, 10_000);

	it("never throws/rejects even when the underlying probe implementation rejects (simulated network error)", async () => {
		const rejectingProbe = () => Promise.reject(new Error("simulated ECONNREFUSED"));
		const cache = createAvailabilityCache({ probeImpl: rejectingProbe });

		let caught: unknown;
		let result: Awaited<ReturnType<typeof cache.probe>> | undefined;
		try {
			result = await cache.probe("anthropic", { timeoutMs: 2_000 });
		} catch (error) {
			caught = error;
		}

		expect(caught, `probe() must never reject; it did: ${String(caught)}`).toBeUndefined();
		expect(result?.state).toBe("unreachable");
	});
});

describe("AvailabilityCache cooldown escalation (R51/§7.3: min(30s * 2^consecutiveFailures, 15min), reset on first success)", () => {
	it("escalates the cooldown window across consecutive failures, capped at 15 minutes, using a controlled clock", async () => {
		let now = new Date("2026-08-07T00:00:00.000Z");
		const failingProbe = () => Promise.reject(new Error("simulated failure"));
		const cache = createAvailabilityCache({ probeImpl: failingProbe, now: () => now });

		// Failure 1: cooldown = min(30s * 2^1, 15min) = 60s (consecutiveFailures counted from 1 after the
		// first failure -- see the ADR's own formula; Gate 6 confirms the exact off-by-one against this test).
		await cache.probe("anthropic", { timeoutMs: 100 });
		const afterFirstFailure = cache.get("anthropic");
		expect(afterFirstFailure?.state).toBe("cooldown");

		// Advance the clock past the first cooldown window so a second probe attempt is even eligible.
		now = new Date(now.getTime() + 5 * 60_000);
		await cache.probe("anthropic", { timeoutMs: 100 });
		const afterSecondFailure = cache.get("anthropic");
		expect(afterSecondFailure?.state).toBe("cooldown");
		if (afterSecondFailure?.state === "cooldown" && afterFirstFailure?.state === "cooldown") {
			expect(afterSecondFailure.consecutiveFailures).toBeGreaterThan(afterFirstFailure.consecutiveFailures);
		}

		// Escalate enough times that the formula's cap (15 minutes) must bind.
		for (let i = 0; i < 10; i++) {
			now = new Date(now.getTime() + 20 * 60_000);
			await cache.probe("anthropic", { timeoutMs: 100 });
		}
		const afterManyFailures = cache.get("anthropic");
		if (afterManyFailures?.state === "cooldown") {
			const capMs = 15 * 60_000;
			const untilMs = new Date(afterManyFailures.until).getTime() - now.getTime();
			expect(untilMs).toBeLessThanOrEqual(capMs);
		}
	});

	it("a successful probe resets the cooldown -- a provider that recovers is not left in cooldown state", async () => {
		let shouldFail = true;
		let now = new Date("2026-08-07T00:00:00.000Z");
		const flakyProbe = () => (shouldFail ? Promise.reject(new Error("down")) : Promise.resolve());
		const cache = createAvailabilityCache({ probeImpl: flakyProbe, now: () => now });

		await cache.probe("anthropic", { timeoutMs: 100 });
		expect(cache.get("anthropic")?.state).toBe("cooldown");

		shouldFail = false;
		now = new Date(now.getTime() + 5 * 60_000);
		const recovered = await cache.probe("anthropic", { timeoutMs: 100 });

		expect(recovered.state).toBe("reachable");
		expect(cache.get("anthropic")?.state).toBe("reachable");
	});
});
