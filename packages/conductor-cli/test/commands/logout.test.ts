/**
 * Gate 5 RED -- `conductor logout` (ADR 0008 D8, §16 `runLogout`; gate2-spec-fase7.md FR-3/FR-4, BR-9,
 * edge case 3; gate3-addendum-fase7.md T72/R50/R53).
 *
 * `runLogout` does not exist yet (`../../src/commands/logout.ts`) -- the static import below makes THIS
 * WHOLE FILE fail to load ("Cannot find module") until Gate 6 creates it. That module-resolution failure
 * IS the RED signal for every test below; once Gate 6 exists, each test's own body is the real spec.
 *
 * The "read-before-delete against the real persistent store" test in the last `describe` block is F2(b2)
 * (ADR 0008 §1.1 F2 / D8): the companion to `vendor-credential-substrate.test.ts`'s F2(b) characterization
 * of `RuntimeCredentials.removeRuntimeApiKey`'s overlay-only bug. That file proves the vendor primitive
 * cannot be composed on alone; THIS test is the actual requirement Gate 6's `runLogout` must satisfy
 * instead -- it is the one expected to go green once Gate 6 lands, by composing over the persistent
 * `CredentialStore`/`AuthStorage` directly (D8), never over `ModelRuntime.removeRuntimeApiKey` alone.
 */

import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLogout } from "../../src/commands/logout.ts";
import { createIsolatedCredentialStore, createTestModelRuntime } from "../support/fake-model-runtime.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

const PROVIDER = "deepseek";

describe("runLogout <provider> -- FR-3, a stored credential is removed from the persistent store", () => {
	it("removes the credential and reports success", async () => {
		const store = createIsolatedCredentialStore();
		await store.modify(PROVIDER, async () => ({ type: "api_key", key: "sk-deepseek-to-be-removed" }));
		const modelRuntime = await createTestModelRuntime({ credentials: store });
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runLogout({ provider: PROVIDER, io, credentials: store, modelRuntime });

		expect(code).toBe(0);
		expect(stdout()).toMatch(new RegExp(PROVIDER));
		expect(stdout().toLowerCase()).toMatch(/removed|logged out|logout/);
		await expect(store.read(PROVIDER)).resolves.toBeUndefined();
	});
});

describe("runLogout <provider> -- FR-4/BR-9, no stored credential is reported explicitly, never a fake success", () => {
	it("reports there was nothing to remove, distinct from a real removal", async () => {
		const store = createIsolatedCredentialStore();
		const modelRuntime = await createTestModelRuntime({ credentials: store });
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runLogout({ provider: PROVIDER, io, credentials: store, modelRuntime });

		// BR-9: never fakes success on nothing-to-remove. Whatever exit code Gate 6 settles on, the
		// message must be UNAMBIGUOUSLY different from the "removed" case above -- a caller reading only
		// stdout must be able to tell the two apart.
		expect(stdout().toLowerCase()).toMatch(/nothing to remove|no credential|not (logged in|configured)/);
		expect(stdout().toLowerCase()).not.toMatch(/^removed\b/);
		expect(code).toBe(0); // "nothing to remove" is a normal, successful outcome -- not an error condition
	});
});

describe("runLogout <provider> -- edge case 3-adjacent, never throws on a mid-flow I/O failure", () => {
	/** A `CredentialStore` whose `delete` always rejects -- models a lock timeout / disk failure /
	 * interrupted write mid-logout without needing a real OAuth flow to interrupt. */
	class ThrowingDeleteStore implements CredentialStore {
		constructor(private readonly inner: CredentialStore) {}
		read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
			return this.inner.read(providerId, options);
		}
		list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
			return this.inner.list(options);
		}
		modify(
			providerId: string,
			fn: (current: Credential | undefined) => Promise<Credential | undefined>,
			options?: AuthOperationOptions,
		): Promise<Credential | undefined> {
			return this.inner.modify(providerId, fn, options);
		}
		delete(): Promise<void> {
			return Promise.reject(new Error("simulated I/O failure mid-logout"));
		}
	}

	it("returns a non-zero exit code and a message naming the failure, instead of throwing out of runLogout", async () => {
		const inner = createIsolatedCredentialStore();
		await inner.modify(PROVIDER, async () => ({ type: "api_key", key: "sk-deepseek-mid-flow" }));
		const throwing = new ThrowingDeleteStore(inner);
		const modelRuntime = await createTestModelRuntime({ credentials: inner });
		const { io, stderr } = createCapturingIo(project.root);

		// The point of this test: runLogout must resolve, not reject.
		await expect(runLogout({ provider: PROVIDER, io, credentials: throwing, modelRuntime })).resolves.not.toThrow();
		const code = await runLogout({ provider: PROVIDER, io, credentials: throwing, modelRuntime });

		expect(code).not.toBe(0);
		expect(stderr()).toContain(PROVIDER);
	});
});

describe("runLogout <provider> -- F2(b2), removes from the REAL persistent store, never just an in-process overlay (T72)", () => {
	it("a fresh read from the injected CredentialStore -- bypassing any ModelRuntime-internal overlay -- returns undefined after logout", async () => {
		const store = createIsolatedCredentialStore();
		await store.modify(PROVIDER, async () => ({ type: "api_key", key: "sk-deepseek-ghost-check" }));
		const modelRuntime = await createTestModelRuntime({ credentials: store });

		// Sanity: modelRuntime resolves this provider as configured BEFORE logout (via its own overlay +
		// the stored credential) -- confirms the setup is real, not accidentally already-empty.
		expect(modelRuntime.getProviderAuthStatus(PROVIDER).configured).toBe(true);

		const { io } = createCapturingIo(project.root);
		const code = await runLogout({ provider: PROVIDER, io, credentials: store, modelRuntime });
		expect(code).toBe(0);

		// The REAL assertion: read directly from `store` (the same instance handed to runLogout as
		// `credentials`), never through `modelRuntime`'s own view -- proving the persistent layer, not
		// merely an in-memory overlay, was the one actually mutated. This is exactly what
		// `vendor-credential-substrate.test.ts`'s F2(b) test shows `RuntimeCredentials.removeRuntimeApiKey`
		// alone does NOT achieve.
		await expect(store.read(PROVIDER)).resolves.toBeUndefined();
	});
});
