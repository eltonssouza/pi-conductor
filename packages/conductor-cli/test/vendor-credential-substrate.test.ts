/**
 * Gate 5 RED -- F2 (ADR 0008 "Fase 7 -- model routing e provedores" §1.1 table + §10/D8;
 * gate3-addendum-fase7.md T69/T72/R50; gate2-spec-fase7.md BR-1/BR-9/FR-3). The spec/threat-model assumed
 * `conductor login`/`logout` could compose directly on `ModelRuntime.setRuntimeApiKey`/
 * `.removeRuntimeApiKey` to persist/remove a credential. Reading (and, below, exercising) the actual
 * vendor code contradicts that assumption in two concrete, present-tense ways:
 *
 * (a) `@earendil-works/pi-coding-agent`'s public module (`packages/coding-agent/src/index.ts:26`)
 *     re-exports `readStoredCredential` from `./core/auth-storage.ts` but NOT the `AuthStorage` class
 *     defined in that same file (`auth-storage.ts:228`, lock via `proper-lockfile`, `chmodSync(0o600)`,
 *     dir `0700`, atomic per-provider write). There is, today, no PUBLIC path from outside the vendor
 *     package to that hardened, persistent `CredentialStore`. D8's fix is exactly one export line
 *     (`export { AuthStorage } from "./core/auth-storage.ts";`) -- this test targets that gap directly.
 *
 * (b) `RuntimeCredentials` (`packages/coding-agent/src/core/runtime-credentials.ts`) is an in-memory-only
 *     overlay: `removeRuntimeApiKey` does exactly `this.overrides.delete(providerId)` -- it never calls
 *     through to the wrapped, real `CredentialStore`. `ModelRuntime.removeRuntimeApiKey`
 *     (`model-runtime.ts:541-547`) delegates straight into this class. A `logout` naively composed on
 *     that method alone produces exactly the "credencial-fantasma" (ghost credential) T72/FR-3/BR-9
 *     forbid: gone from the runtime's in-process view, still on disk. Exercised here directly against
 *     the REAL class -- no mocking.
 *
 * Both tests assert the CORRECT/intended behavior (never the current buggy one), so both fail for a real
 * reason today (Gate 5 discipline: every new test is RED before Gate 6 exists) rather than passively
 * documenting the bug as a green characterization test would. (a) turns GREEN once the vendor package
 * widens its export. (b) is a permanent regression guard proving *why* `runLogout` (Gate 6) must never
 * compose on `RuntimeCredentials`/`ModelRuntime.removeRuntimeApiKey` alone -- see `commands/logout.test.ts`'s
 * own F2(b2) test for the corresponding assertion against the not-yet-existing `runLogout` itself, which
 * is the test that actually needs to go green at Gate 6 (this file's (b) test exercises vendor code this
 * repo does not own and is not expected to fix; it exists to make the reason `runLogout` must be composed
 * differently undeniable, not to be "fixed" itself).
 */

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
// Deliberate, deep, cross-package import straight into the vendor's SOURCE file -- not through
// `@earendil-works/pi-coding-agent`'s public entry point. This is the point of the test:
// `RuntimeCredentials` is not, and per D8 is not planned to become, part of that package's public
// surface, so there is no other way to exercise the REAL class rather than a hand-written
// re-implementation of it (which would test our own double, not the vendor's actual behavior). Never do
// this from src/ production code (this repo's own "composition over fork" convention, restated at every
// prior Fase's Gate 4) -- acceptable here, and only here, because a Gate-5 characterization test's entire
// job is to pin down real, current vendor behavior that no public seam exposes.
import { RuntimeCredentials } from "../../coding-agent/src/core/runtime-credentials.ts";

describe("F2(a) -- @earendil-works/pi-coding-agent must export AuthStorage (D8's one-line fix)", () => {
	it("exposes AuthStorage as a constructible named export of the public module", async () => {
		// Dynamic import (deliberately not a static `import { AuthStorage } from "..."` at module scope):
		// a static import of a genuinely-missing named export can crash the ENTIRE test file at
		// module-evaluation time depending on how strictly the loader enforces ESM named-export linking
		// for this vendor package's built dist -- that would also take down the sibling F2(b) test below.
		// A dynamic import always resolves to the module namespace object itself (property access on a
		// namespace object never throws), so the failure below surfaces as a normal, isolated, readable
		// assertion failure instead -- still a fully legitimate RED signal, just one that keeps this
		// file's other test unaffected.
		const codingAgent: Record<string, unknown> = await import("@earendil-works/pi-coding-agent");

		// Sanity check first: this is genuinely "one symbol missing", never a wholesale resolution
		// failure that would make the assertion below meaningless -- the module DOES load today, and its
		// documented neighbor export (same source file, auth-storage.ts) already works.
		expect(typeof codingAgent.readStoredCredential).toBe("function");

		// The actual RED assertion -- fails today because AuthStorage is not exported yet.
		expect(typeof codingAgent.AuthStorage).toBe("function");
		expect(typeof (codingAgent.AuthStorage as { create?: unknown } | undefined)?.create).toBe("function");
	});
});

describe("F2(b) -- RuntimeCredentials.removeRuntimeApiKey only clears its in-memory overlay (the ghost-credential bug, T72)", () => {
	it("leaves the credential in the WRAPPED store after removeRuntimeApiKey, proving the overlay is the only thing cleared", async () => {
		const provider = "anthropic";
		const wrapped = new InMemoryCredentialStore();
		await wrapped.modify(provider, async () => ({ type: "api_key", key: "sk-ant-should-be-gone" }));

		const runtimeCredentials = new RuntimeCredentials(wrapped);
		runtimeCredentials.setRuntimeApiKey(provider, "sk-ant-runtime-override");
		expect(runtimeCredentials.hasRuntimeApiKey(provider)).toBe(true);

		runtimeCredentials.removeRuntimeApiKey(provider);

		// The in-memory overlay is correctly cleared...
		expect(runtimeCredentials.hasRuntimeApiKey(provider)).toBe(false);

		// ...but the assertion this test exists for: a fresh read from the underlying, wrapped store --
		// bypassing RuntimeCredentials entirely, exactly what a real logout must guarantee -- should also
		// be gone. It is NOT, today: this assertion fails, and the failure diff (still showing the
		// "sk-ant-should-be-gone" credential) IS the proof T72/FR-3/BR-9 are written against.
		await expect(wrapped.read(provider)).resolves.toBeUndefined();
	});
});
