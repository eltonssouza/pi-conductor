/**
 * `AvailabilityCache` / `createAvailabilityCache` -- R51/D7/T70 (docs/adr/0008-fase7-model-routing-and-
 * providers.md §9/§7.3): a cheap, bounded, non-blocking, NEVER-throwing reachability probe, in-memory
 * only (no disk state -- D7's own words: persisting "provider X is bad" would create adulterable state).
 *
 * `AVAILABILITY_DEFAULTS` are the ADR's own literal numbers (§7.3/§16) -- declared PRODUCT DEFAULTS,
 * sobreponíveis pelo operador, never "discovered": probeTimeoutMs 2s, successTtlMs 60s,
 * attemptsPerResolution 2, backoff base 500ms/factor 2/cap 8s (full jitter -- the caller's job, this
 * module does not internally retry a single `probe()` call), cooldown `min(30s * 2^consecutiveFailures,
 * 15min)`, reset on the first success.
 *
 * `probe()`'s return value and the CACHED value (read via `.get()`) intentionally diverge on failure:
 * `probe()` returns "unreachable" -- what THIS attempt observed, useful for a human-facing message
 * ("connect ECONNREFUSED") -- while the cache stores "cooldown" with the escalated window, which is what
 * subsequent resolution/fallback evaluation actually needs (should this provider even be retried right
 * now?). A success collapses both to "reachable" -- no divergence needed there.
 */

import type { AvailabilityCache, ProviderAvailability } from "./types.ts";

/** The ADR's own literal defaults (§7.3/§16) -- a declared PRODUCT DEFAULT, sobreponível pelo operador,
 * never a discovered/invented constant (D1.6's same discipline applied to this fase's other numbers). */
export const AVAILABILITY_DEFAULTS = {
	probeTimeoutMs: 2_000,
	successTtlMs: 60_000,
	attemptsPerResolution: 2,
	backoffBaseMs: 500,
	backoffFactor: 2,
	backoffCapMs: 8_000,
	cooldownBaseMs: 30_000,
	cooldownCapMs: 15 * 60_000,
} as const;

export interface CreateAvailabilityCacheOptions {
	/** The actual network check -- injected so tests never touch a real network (R51: this is a seam,
	 * not production wiring). Takes no arguments deliberately: what endpoint to hit for a given provider
	 * is the composition root's business (it has the catalog/ModelRuntime), not this cache's. */
	probeImpl?: () => Promise<void>;
	/** Injectable clock (policy-loader.ts/role-loader.ts's own "I/O at the edges, injectable" pattern) --
	 * lets the cooldown-escalation tests control elapsed time deterministically. */
	now?: () => Date;
}

function defaultProbeImpl(): Promise<void> {
	// R51(i): without a real probe implementation wired by the composition root, this cache cannot know
	// how to reach any provider. Failing closed (never claiming reachability without evidence) is the
	// only safe default -- the same disposition an unimplemented probe would have anyway.
	return Promise.reject(new Error("no probe implementation configured for AvailabilityCache"));
}

/** Races `promise` against a `timeoutMs` timer; never rejects with the timer's own error, only ever
 * resolves ("ok") or rejects with whatever `promise` itself rejected with (or a timeout marker). */
function raceWithTimeout(promise: Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<"ok" | "timeout"> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve("timeout");
		}, timeoutMs);
		const onAbort = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve("timeout");
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		promise.then(
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve("ok");
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

export function createAvailabilityCache(options: CreateAvailabilityCacheOptions = {}): AvailabilityCache {
	const probeImpl = options.probeImpl ?? defaultProbeImpl;
	const now = options.now ?? (() => new Date());
	const cached = new Map<string, ProviderAvailability>();
	const consecutiveFailures = new Map<string, number>();

	return {
		get(provider: string): ProviderAvailability | undefined {
			return cached.get(provider);
		},

		async probe(
			provider: string,
			probeOptions: { timeoutMs: number; signal?: AbortSignal },
		): Promise<ProviderAvailability> {
			let succeeded: boolean;
			try {
				const outcome = await raceWithTimeout(probeImpl(), probeOptions.timeoutMs, probeOptions.signal);
				succeeded = outcome === "ok";
			} catch {
				// R51: probe() NEVER throws/rejects, regardless of what the injected implementation does.
				succeeded = false;
			}

			if (succeeded) {
				consecutiveFailures.delete(provider); // A recovery resets the escalation (§7.3).
				const result: ProviderAvailability = { state: "reachable", checkedAt: now().toISOString() };
				cached.set(provider, result);
				return result;
			}

			const failures = (consecutiveFailures.get(provider) ?? 0) + 1;
			consecutiveFailures.set(provider, failures);
			const windowMs = Math.min(
				AVAILABILITY_DEFAULTS.cooldownBaseMs * 2 ** failures,
				AVAILABILITY_DEFAULTS.cooldownCapMs,
			);
			const until = new Date(now().getTime() + windowMs).toISOString();
			cached.set(provider, { state: "cooldown", until, consecutiveFailures: failures });

			// The RETURN value reports what THIS probe attempt observed (a generic, injected probeImpl
			// carries no richer signal than "it failed or timed out" -- misconfigured/unauthenticated
			// classification, edge case 5, belongs to a composition-root probeImpl that inspects the real
			// HTTP status, not to this generic cache).
			return { state: "unreachable", checkedAt: now().toISOString(), detail: "probe failed or timed out" };
		},
	};
}
