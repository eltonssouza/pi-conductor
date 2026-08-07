/**
 * Gate 5 (test-first) for model-policy-trust-store.ts -- derives
 * docs/adr/0008-fase7-model-routing-and-providers.md §8.2 (D6, the TOFU-pin table) and the ADR's
 * own instruction at §16: "Mesma FORMA de PolicyTrustStore (policy-trust-store.ts:53-80). isTrusted
 * NUNCA lança." This suite mirrors test/policy-trust-store.test.ts's shape test-for-test, adapted to
 * the narrower `ModelPolicyTrustStore` contract.
 *
 * Judgment call (flagged, not silently assumed): the ADR's §16 appendix declares only the PUBLIC
 * runtime contract --
 *   `interface ModelPolicyTrustStore { isTrusted(contentHash: string): boolean }`
 *   `function loadModelPolicyTrustStore(filePath, options?: { onError?(e: unknown): void }): ModelPolicyTrustStore`
 * -- it does NOT export an on-disk document/entry type the way `PolicyTrustStoreDocument`/
 * `TrustEntry` are exported and used directly by policy-trust-store.test.ts's fixtures. Notably,
 * `isTrusted` here takes a single `contentHash` (no `kind` -- unlike `PolicyTrustStore`, whose pins
 * are split into "project"/"user-global" trust domains). This file assumes the on-disk shape is the
 * smallest change that still satisfies "mesma forma" while matching the narrower single-argument
 * `isTrusted`: `{ schema: 1, trusted: [{ contentHash, grantedAt }] }` (PolicyTrustStoreDocument
 * minus `kind`). Gate 6 owns the real on-disk shape; if it differs, only this file's
 * `writeTrustStore` fixture helper needs to change, not the fail-closed assertions below (they are
 * expressed entirely through the public `isTrusted`/`loadModelPolicyTrustStore` contract).
 *
 * Every test below MUST fail RED right now: model-policy-trust-store.ts does not exist yet (Gate 6
 * creates it). The failure signature expected here is a module-resolution error ("Cannot find
 * module '../src/model-policy-trust-store.ts'"), not an assertion failure -- deliberate per this
 * gate's brief.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModelPolicyTrustStore } from "../src/model-policy-trust-store.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

const HASH_A = "a".repeat(64); // sha256 hex digests are 64 hex chars -- fixture shape only, never a real key
const HASH_B = "b".repeat(64);

function trustStorePath(): string {
	return join(workspace.root, ".conductor", "model-policy-trust.json");
}

function writeTrustStore(document: { schema: 1; trusted: Array<{ contentHash: string; grantedAt: string }> }): void {
	mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
	writeFileSync(trustStorePath(), JSON.stringify(document));
}

describe("loadModelPolicyTrustStore -- fail-closed on every read path (mirrors PolicyTrustStore's R11a form)", () => {
	it("resolves isTrusted() to false when the store file does not exist yet, and never throws", () => {
		const store = loadModelPolicyTrustStore(trustStorePath());
		expect(() => store.isTrusted(HASH_A)).not.toThrow();
		expect(store.isTrusted(HASH_A)).toBe(false);
	});

	it("loadModelPolicyTrustStore itself does not throw for a missing file", () => {
		expect(() => loadModelPolicyTrustStore(trustStorePath())).not.toThrow();
	});

	it("resolves isTrusted() to false when the store file is not valid JSON", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(trustStorePath(), "{ this is not valid json");
		const store = loadModelPolicyTrustStore(trustStorePath());
		expect(() => store.isTrusted(HASH_A)).not.toThrow();
		expect(store.isTrusted(HASH_A)).toBe(false);
	});

	it("resolves isTrusted() to false when the store JSON does not match the expected schema", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(trustStorePath(), JSON.stringify({ schema: 1, trusted: "not-an-array" }));
		const store = loadModelPolicyTrustStore(trustStorePath());
		expect(store.isTrusted(HASH_A)).toBe(false);
	});

	it("resolves isTrusted() to false when the path is a directory, not a file (I/O error path), and never throws", () => {
		mkdirSync(trustStorePath(), { recursive: true }); // a directory at the exact path a file is expected
		expect(() => loadModelPolicyTrustStore(trustStorePath())).not.toThrow();
		const store = loadModelPolicyTrustStore(trustStorePath());
		expect(store.isTrusted(HASH_A)).toBe(false);
	});

	it("resolves isTrusted() to false for a hash that is simply not present in an otherwise well-formed store", () => {
		writeTrustStore({ schema: 1, trusted: [{ contentHash: HASH_A, grantedAt: "2026-08-07T00:00:00.000Z" }] });
		const store = loadModelPolicyTrustStore(trustStorePath());
		expect(store.isTrusted(HASH_B)).toBe(false);
	});

	// Explicit per this gate's brief: wrap the call so a THROWN exception fails this test rather than
	// being silently caught by a `.not.toThrow()` wrapper alone -- proves the fail-closed contract
	// holds even when the caller does not defensively wrap every call site.
	it("never throws across a malformed-file read followed directly by isTrusted() -- an uncaught throw here fails the test, not just a wrapped assertion", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(trustStorePath(), "not json at all {{{");
		let threw = false;
		let result: boolean | undefined;
		try {
			const store = loadModelPolicyTrustStore(trustStorePath());
			result = store.isTrusted(HASH_A);
		} catch {
			threw = true;
		}
		expect(threw).toBe(false);
		expect(result).toBe(false);
	});
});

describe("loadModelPolicyTrustStore -- the one positive case, and only the one positive case", () => {
	it("resolves isTrusted() to true for a contentHash that was previously granted", () => {
		writeTrustStore({ schema: 1, trusted: [{ contentHash: HASH_A, grantedAt: "2026-08-07T00:00:00.000Z" }] });
		const store = loadModelPolicyTrustStore(trustStorePath());
		expect(store.isTrusted(HASH_A)).toBe(true);
	});
});

// D6/T73: "corrupting or deleting the TrustStore makes the session LESS permissive, never more" --
// same failure direction as PolicyTrustStore's T28/R11, proven end-to-end rather than asserted in
// the abstract.
describe("loadModelPolicyTrustStore -- losing the ledger can only revoke trust, never grant it", () => {
	it("a hash trusted before the store is corrupted is NOT trusted after (no silent inheritance of old trust)", () => {
		writeTrustStore({ schema: 1, trusted: [{ contentHash: HASH_A, grantedAt: "2026-08-07T00:00:00.000Z" }] });
		expect(loadModelPolicyTrustStore(trustStorePath()).isTrusted(HASH_A)).toBe(true);

		writeFileSync(trustStorePath(), "{ corrupted after the fact");

		expect(loadModelPolicyTrustStore(trustStorePath()).isTrusted(HASH_A)).toBe(false);
	});

	it("a hash trusted before the store is deleted is NOT trusted after", () => {
		writeTrustStore({ schema: 1, trusted: [{ contentHash: HASH_A, grantedAt: "2026-08-07T00:00:00.000Z" }] });
		expect(loadModelPolicyTrustStore(trustStorePath()).isTrusted(HASH_A)).toBe(true);

		// Simulate deletion by pointing at a location that was never written.
		mkdirSync(join(workspace.root, ".conductor-emptied"), { recursive: true });
		const neverWritten = join(workspace.root, ".conductor-emptied", "model-policy-trust.json");

		expect(loadModelPolicyTrustStore(neverWritten).isTrusted(HASH_A)).toBe(false);
	});
});
