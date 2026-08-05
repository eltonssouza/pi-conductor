/**
 * Gate 5 (test-first) for policy-trust-store.ts -- derives T28/R11
 * (docs/conductor/gate3-addendum-fase2.md §9) plus the task's non-negotiable #3: "PolicyTrustStore
 * fail-closed -- store absent, corrupt, or hash-not-found -> ALWAYS isTrusted=false, NEVER throws an
 * exception a careless caller could catch-and-treat-as-true." Every test below MUST fail RED right
 * now: loadPolicyTrustStore() is a stub that throws "not implemented" (Gate 6 implements it).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicyTrustStore, type PolicyTrustStoreDocument } from "../src/policy-trust-store.ts";
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
	return join(workspace.root, ".conductor", "policy-trust.json");
}

function writeTrustStore(document: PolicyTrustStoreDocument): void {
	mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
	writeFileSync(trustStorePath(), JSON.stringify(document));
}

describe("loadPolicyTrustStore — R11a fail-closed on every read path", () => {
	it("resolves isTrusted() to false when the store file does not exist yet (never throws)", () => {
		const store = loadPolicyTrustStore(trustStorePath());
		expect(() => store.isTrusted("project", HASH_A)).not.toThrow();
		expect(store.isTrusted("project", HASH_A)).toBe(false);
	});

	it("loadPolicyTrustStore itself does not throw for a missing file", () => {
		expect(() => loadPolicyTrustStore(trustStorePath())).not.toThrow();
	});

	it("resolves isTrusted() to false when the store file is not valid JSON", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(trustStorePath(), "{ this is not valid json");
		const store = loadPolicyTrustStore(trustStorePath());
		expect(() => store.isTrusted("project", HASH_A)).not.toThrow();
		expect(store.isTrusted("project", HASH_A)).toBe(false);
	});

	it("resolves isTrusted() to false when the store JSON does not match the expected schema", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(trustStorePath(), JSON.stringify({ schema: 1, trusted: "not-an-array" }));
		const store = loadPolicyTrustStore(trustStorePath());
		expect(store.isTrusted("project", HASH_A)).toBe(false);
	});

	it("resolves isTrusted() to false when the path is a directory, not a file (I/O error path)", () => {
		mkdirSync(trustStorePath(), { recursive: true }); // a directory at the exact path a file is expected
		expect(() => loadPolicyTrustStore(trustStorePath())).not.toThrow();
		const store = loadPolicyTrustStore(trustStorePath());
		expect(store.isTrusted("project", HASH_A)).toBe(false);
	});

	it("resolves isTrusted() to false for a hash that is simply not present in an otherwise well-formed store", () => {
		writeTrustStore({
			schema: 1,
			trusted: [{ kind: "project", contentHash: HASH_A, grantedAt: "2026-08-05T00:00:00.000Z" }],
		});
		const store = loadPolicyTrustStore(trustStorePath());
		expect(store.isTrusted("project", HASH_B)).toBe(false);
	});
});

describe("loadPolicyTrustStore — the one positive case, and only the one positive case", () => {
	it("resolves isTrusted() to true for a kind+contentHash pair that was previously granted", () => {
		writeTrustStore({
			schema: 1,
			trusted: [{ kind: "project", contentHash: HASH_A, grantedAt: "2026-08-05T00:00:00.000Z" }],
		});
		const store = loadPolicyTrustStore(trustStorePath());
		expect(store.isTrusted("project", HASH_A)).toBe(true);
	});

	// Trust domains do not cross (least-privilege segregation, Secure and Reliable Systems Design
	// §3.3/§3.12 -- the same source cited for R3/R4's trust-ordering): a hash granted for the
	// "project" source must not be silently honored for "user-global" just because the digest
	// happens to match.
	it("does NOT cross trust-domain kinds -- a hash granted for 'project' is not trusted for 'user-global'", () => {
		writeTrustStore({
			schema: 1,
			trusted: [{ kind: "project", contentHash: HASH_A, grantedAt: "2026-08-05T00:00:00.000Z" }],
		});
		const store = loadPolicyTrustStore(trustStorePath());
		expect(store.isTrusted("user-global", HASH_A)).toBe(false);
	});
});

// T28/R11: "corrupting or deleting the TrustStore makes the session LESS permissive, never more" --
// the failure direction is the whole point of R11a; this test proves it end-to-end rather than
// asserting the rule in the abstract.
describe("loadPolicyTrustStore — losing the ledger can only revoke trust, never grant it (T28/R11)", () => {
	it("a hash trusted before the store is corrupted is NOT trusted after (no silent inheritance of old trust)", () => {
		writeTrustStore({
			schema: 1,
			trusted: [{ kind: "project", contentHash: HASH_A, grantedAt: "2026-08-05T00:00:00.000Z" }],
		});
		expect(loadPolicyTrustStore(trustStorePath()).isTrusted("project", HASH_A)).toBe(true);

		writeFileSync(trustStorePath(), "{ corrupted after the fact");

		expect(loadPolicyTrustStore(trustStorePath()).isTrusted("project", HASH_A)).toBe(false);
	});

	it("a hash trusted before the store is deleted is NOT trusted after", () => {
		writeTrustStore({
			schema: 1,
			trusted: [{ kind: "project", contentHash: HASH_A, grantedAt: "2026-08-05T00:00:00.000Z" }],
		});
		expect(loadPolicyTrustStore(trustStorePath()).isTrusted("project", HASH_A)).toBe(true);

		// Simulate deletion by pointing at a location that no longer exists -- rmSync the exact file.
		mkdirSync(join(workspace.root, ".conductor-emptied"), { recursive: true });
		const neverWritten = join(workspace.root, ".conductor-emptied", "policy-trust.json");

		expect(loadPolicyTrustStore(neverWritten).isTrusted("project", HASH_A)).toBe(false);
	});
});
