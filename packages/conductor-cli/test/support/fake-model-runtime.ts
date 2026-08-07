/**
 * Builds a REAL `ModelRuntime` (the real ~40-provider vendor catalog from `@earendil-works/pi-ai`'s
 * `builtinProviders()`) fully isolated from this machine's actual credentials/config: `credentials`
 * defaults to a fresh `InMemoryCredentialStore` (never `DefaultAuthStorage`/this developer's real
 * `~/.pi/agent/auth.json`, which is `ModelRuntime.create`'s own default when `options.credentials` is
 * omitted -- `packages/coding-agent/src/core/model-runtime.ts:171`), and `modelsPath: null` skips
 * reading this developer's real `~/.pi/agent/models.json`. `allowModelNetwork` defaults to `false` so
 * catalog composition never makes a real network call -- the catalog itself (`builtinProviders()`) is a
 * synchronous, offline, generated dataset; only a per-provider *refresh* needs network, and none of the
 * Fase 7 Grupo A/D command tests ask for it.
 *
 * Shared across `login.test.ts`/`logout.test.ts`/`auth.test.ts`/`models.test.ts` -- unlike
 * `scratch.ts`/`fake-model.ts`'s documented "each file keeps an independent copy" convention, this one is
 * deliberately centralized: all four command test files need EXACTLY the same isolation contract, and a
 * divergence between ad-hoc copies (e.g. one forgetting `modelsPath: null`) would be a real, silent
 * test-pollution risk on a machine-dependent surface (credentials/model catalog), not a style nit.
 */

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { type CreateModelRuntimeOptions, ModelRuntime } from "@earendil-works/pi-coding-agent";

/** A fresh, empty, in-memory `CredentialStore` -- never touches this machine's real auth.json. */
export function createIsolatedCredentialStore(): InMemoryCredentialStore {
	return new InMemoryCredentialStore();
}

/**
 * `credentials` defaults to a fresh isolated store (see above) but can be overridden so a test can hold
 * onto the SAME store instance passed to the runtime -- needed whenever a test wants to read the
 * persistent layer directly afterwards, bypassing whatever in-process overlay `ModelRuntime` interposes
 * (`RuntimeCredentials`, `model-runtime.ts:171`) -- exactly the seam the F2 ghost-credential tests need.
 */
export async function createTestModelRuntime(
	overrides: Partial<CreateModelRuntimeOptions> = {},
): Promise<ModelRuntime> {
	return ModelRuntime.create({
		credentials: createIsolatedCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
		...overrides,
	});
}
