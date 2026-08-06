/**
 * Gate 5 (test-first) for policy-loader.ts -- derives FR-9/FR-10/FR-11/FR-23/FR-24 and BR-4/BR-5
 * (docs/conductor/gate2-spec-fase2.md), R3/R4 (docs/conductor/gate3-addendum-fase2.md T18/T19), and
 * the task's non-negotiables #1 (asymmetric merge) and #2 (trust-on-first-use by contentHash). Every
 * test below MUST fail RED right now: loadPolicyDocument() and mergePolicies() are stubs that throw
 * "not implemented" (Gate 6 implements the bodies).
 *
 * Test doubles: PolicyTrustStore is exercised with a plain in-process object literal, never a
 * mocking framework -- Unit Testing Principles §3.12 ("the real collaborator is cheap and
 * in-process... the habit to break is doubling one dependency per constructor call") — grounded in
 * this session's `cdt library "unit testing a pure merge function with asymmetric semantics..."
 * --gate 5` query (top 0.595). mergePolicies and loadPolicyDocument are themselves pure/IO-boundary
 * functions with no framework needed to isolate them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicyDocument, mergePolicies, type PolicyDocument, type PolicySource } from "../src/policy-loader.ts";
import type { PolicySourceKind, PolicyTrustStore } from "../src/policy-trust-store.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function policyPath(): string {
	return join(workspace.root, ".conductor", "policy.json");
}

function writePolicyFile(raw: string): void {
	mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
	writeFileSync(policyPath(), raw);
}

/** A trust store that only trusts the exact (kind, contentHash) pairs listed -- nothing else. */
function fakeTrustStore(trusted: Array<{ kind: PolicySourceKind; contentHash: string }>): PolicyTrustStore {
	return {
		isTrusted: (kind, contentHash) =>
			trusted.some((entry) => entry.kind === kind && entry.contentHash === contentHash),
	};
}

const NO_TRUST: PolicyTrustStore = fakeTrustStore([]);

// ---------------------------------------------------------------------------------------------
// loadPolicyDocument -- FR-23 ≠ FR-24 at the type level, contentHash for trust-on-first-use
// ---------------------------------------------------------------------------------------------

describe("loadPolicyDocument", () => {
	it("returns { status: 'absent' } when policy.json does not exist (FR-24 -- absent is not an error)", () => {
		expect(loadPolicyDocument(policyPath())).toEqual({ status: "absent" });
	});

	it("returns { status: 'invalid' } for syntactically malformed JSON (FR-23, edge case #1)", () => {
		writePolicyFile("{ this is not valid json");
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
		expect((result as { reason: string }).reason).toBeTruthy();
	});

	// Edge case #2 (gate2-spec-fase2.md §8): valid JSON but schema-invalid (e.g. an allowlist risk
	// outside "low"/"medium") gets the SAME treatment as a parse failure -- never "ignore the bad
	// field and continue with the rest".
	it("returns { status: 'invalid' } for well-formed JSON that fails the schema (edge case #2)", () => {
		writePolicyFile(JSON.stringify({ schema: 1, allowlist: [{ pattern: "rm -rf /", risk: "extreme" }] }));
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
	});

	it("never throws for a malformed file -- always returns a result, never propagates an exception", () => {
		writePolicyFile("not json at all {{{");
		expect(() => loadPolicyDocument(policyPath())).not.toThrow();
	});

	it("returns { status: 'loaded', policy, contentHash } for a well-formed policy.json", () => {
		const document: PolicyDocument = { schema: 1, protectedPaths: ["./secrets"] };
		writePolicyFile(JSON.stringify(document));
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("loaded");
		if (result.status === "loaded") {
			expect(result.policy.protectedPaths).toEqual(["./secrets"]);
			expect(result.contentHash).toBeTruthy();
		}
	});

	// Non-negotiable #2 (trust-on-first-use by contentHash, R3): identical bytes -> identical hash,
	// so a previously-granted trust entry is recognized again without re-prompting.
	it("produces the SAME contentHash for byte-identical content loaded twice (R3 -- trust recognized again)", () => {
		writePolicyFile(JSON.stringify({ schema: 1, protectedPaths: ["./secrets"] }));
		const first = loadPolicyDocument(policyPath());
		const second = loadPolicyDocument(policyPath());
		expect(first.status).toBe("loaded");
		expect(second.status).toBe("loaded");
		if (first.status === "loaded" && second.status === "loaded") {
			expect(first.contentHash).toBe(second.contentHash);
		}
	});

	// Non-negotiable #2, the other half: an edited file (even a semantically-trivial edit) must
	// produce a DIFFERENT hash, so a stale trust entry is never silently inherited (R3: "an altered
	// policy.json falls back to grants-ignored, never grants-honored-silently").
	it("produces a DIFFERENT contentHash after the file is edited (R3 -- must re-confirm, not inherit old trust)", () => {
		writePolicyFile(JSON.stringify({ schema: 1, protectedPaths: ["./secrets"] }));
		const before = loadPolicyDocument(policyPath());

		writePolicyFile(JSON.stringify({ schema: 1, protectedPaths: ["./secrets", "./more-secrets"] }));
		const after = loadPolicyDocument(policyPath());

		expect(before.status).toBe("loaded");
		expect(after.status).toBe("loaded");
		if (before.status === "loaded" && after.status === "loaded") {
			expect(before.contentHash).not.toBe(after.contentHash);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// mergePolicies -- R3/R4 asymmetric merge, BR-5 union-only restrictions, FR-23 denyAllPrivileged
// ---------------------------------------------------------------------------------------------

describe("mergePolicies — restrictions always union (BR-5/FR-10)", () => {
	it("unions protectedPaths from builtin defaults and every source, trusted or not", () => {
		const projectSource: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, protectedPaths: ["./build-secrets"] },
			contentHash: "hash-untrusted",
		};

		const result = mergePolicies({ protectedPaths: ["/home/.ssh"] }, [projectSource], NO_TRUST);

		expect(result.protectedPaths).toEqual(expect.arrayContaining(["/home/.ssh", "./build-secrets"]));
	});

	it("never allows a source to remove a builtin default protected path (BR-5)", () => {
		// A hostile/erroneous policy.json cannot express "remove ~/.ssh" through this schema at all
		// (protectedPaths is additive-only by construction) -- this test proves the INVARIANT, not
		// just the absence of a removal field: the default survives merge regardless of source content.
		const projectSource: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, protectedPaths: [] },
			contentHash: "hash-empty",
		};

		const result = mergePolicies({ protectedPaths: ["/home/.ssh"] }, [projectSource], NO_TRUST);

		expect(result.protectedPaths).toContain("/home/.ssh");
	});

	it("still unions restrictions from a source with an UNKNOWN contentHash (restrictions are unconditional on trust)", () => {
		const untrustedButRestrictive: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, protectedPaths: ["./wider-restriction"] },
			contentHash: "never-approved-hash",
		};

		const result = mergePolicies({ protectedPaths: [] }, [untrustedButRestrictive], NO_TRUST);

		expect(result.protectedPaths).toContain("./wider-restriction");
	});
});

describe("mergePolicies — grants require trust (R3/T18)", () => {
	it("ignores an allowlist grant from a source with an unrecognized contentHash", () => {
		const untrustedProject: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, allowlist: [{ pattern: "npm test", risk: "low" }] },
			contentHash: "hash-never-approved",
		};

		const result = mergePolicies({ protectedPaths: [] }, [untrustedProject], NO_TRUST);

		expect(result.allowlist).toEqual([]);
	});

	it("honors an allowlist grant once its exact contentHash is trusted (trust-on-first-use)", () => {
		const trustedProject: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, allowlist: [{ pattern: "npm test", risk: "low" }] },
			contentHash: "hash-approved",
		};
		const trustStore = fakeTrustStore([{ kind: "project", contentHash: "hash-approved" }]);

		const result = mergePolicies({ protectedPaths: [] }, [trustedProject], trustStore);

		expect(result.allowlist).toEqual([{ pattern: "npm test", risk: "low" }]);
	});

	// Non-negotiable #2 (trust-on-first-use by contentHash): the file was edited (new hash), so the
	// OLD trust entry (for the old hash) does not carry over -- the grant is ignored again until
	// re-confirmed for the new hash.
	it("does NOT honor a grant when the file's contentHash has changed since it was trusted (R3)", () => {
		const editedProject: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, allowlist: [{ pattern: "npm test", risk: "low" }] },
			contentHash: "hash-after-edit",
		};
		// Trust was granted for the hash BEFORE the edit -- a different hash entirely.
		const trustStore = fakeTrustStore([{ kind: "project", contentHash: "hash-before-edit" }]);

		const result = mergePolicies({ protectedPaths: [] }, [editedProject], trustStore);

		expect(result.allowlist).toEqual([]);
	});
});

describe("mergePolicies — asymmetric merge across sources: restrictions union, grants intersect trust-ordered (R4/T19)", () => {
	// This is the task's non-negotiable #1, verbatim: a project policy with a WIDER restriction than
	// the user-global one -> the union wins (more restrictive survives). A project policy trying to
	// GRANT something the user-global policy does not grant -> the intersection wins (a project
	// grant alone is NEVER sufficient).
	it("unions a project-only restriction into the effective policy even though user-global does not have it", () => {
		const userGlobal: PolicySource = {
			kind: "user-global",
			status: "loaded",
			policy: { schema: 1, protectedPaths: [] },
			contentHash: "user-hash",
		};
		const project: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, protectedPaths: ["./project-only-secret"] },
			contentHash: "project-hash",
		};
		const trustStore = fakeTrustStore([
			{ kind: "user-global", contentHash: "user-hash" },
			{ kind: "project", contentHash: "project-hash" },
		]);

		const result = mergePolicies({ protectedPaths: [] }, [userGlobal, project], trustStore);

		expect(result.protectedPaths).toContain("./project-only-secret");
	});

	it("does NOT grant a project-only allowlist entry that user-global does not also grant (a project grant alone never suffices)", () => {
		const userGlobal: PolicySource = {
			kind: "user-global",
			status: "loaded",
			policy: { schema: 1, allowlist: [{ pattern: "git status", risk: "low" }] },
			contentHash: "user-hash",
		};
		const project: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: {
				schema: 1,
				allowlist: [
					{ pattern: "git status", risk: "low" },
					{ pattern: "rm -rf ./tmp", risk: "low" },
				],
			},
			contentHash: "project-hash",
		};
		const trustStore = fakeTrustStore([
			{ kind: "user-global", contentHash: "user-hash" },
			{ kind: "project", contentHash: "project-hash" },
		]);

		const result = mergePolicies({ protectedPaths: [] }, [userGlobal, project], trustStore);

		// "git status" is granted by BOTH -> survives the intersection.
		expect(result.allowlist).toEqual(expect.arrayContaining([{ pattern: "git status", risk: "low" }]));
		// "rm -rf ./tmp" is granted ONLY by project -> excluded. Never `grants = union`.
		expect(result.allowlist).not.toEqual(expect.arrayContaining([{ pattern: "rm -rf ./tmp", risk: "low" }]));
		expect(result.allowlist).toHaveLength(1);
	});

	it("grants nothing at all when project grants something and user-global has no allowlist entries", () => {
		const userGlobal: PolicySource = {
			kind: "user-global",
			status: "loaded",
			policy: { schema: 1, allowlist: [] },
			contentHash: "user-hash",
		};
		const project: PolicySource = {
			kind: "project",
			status: "loaded",
			policy: { schema: 1, allowlist: [{ pattern: "anything", risk: "low" }] },
			contentHash: "project-hash",
		};
		const trustStore = fakeTrustStore([
			{ kind: "user-global", contentHash: "user-hash" },
			{ kind: "project", contentHash: "project-hash" },
		]);

		const result = mergePolicies({ protectedPaths: [] }, [userGlobal, project], trustStore);

		expect(result.allowlist).toEqual([]);
	});
});

describe("mergePolicies — FR-23 extended: denyAllPrivileged when any source is invalid", () => {
	it("is false when every source is absent (FR-24 is not an error condition)", () => {
		const result = mergePolicies({ protectedPaths: [] }, [{ kind: "project", status: "absent" }], NO_TRUST);
		expect(result.denyAllPrivileged).toBe(false);
	});

	it("is true the instant any source has status 'invalid'", () => {
		const result = mergePolicies(
			{ protectedPaths: [] },
			[{ kind: "project", status: "invalid", reason: "malformed JSON" }],
			NO_TRUST,
		);
		expect(result.denyAllPrivileged).toBe(true);
	});

	// ADR §5.2: "a bad source is never outvoted by a majority of good ones."
	it("is true even when a well-formed, fully-trusted source is present alongside an invalid one", () => {
		const goodSource: PolicySource = {
			kind: "user-global",
			status: "loaded",
			policy: { schema: 1 },
			contentHash: "good-hash",
		};
		const trustStore = fakeTrustStore([{ kind: "user-global", contentHash: "good-hash" }]);

		const result = mergePolicies(
			{ protectedPaths: [] },
			[goodSource, { kind: "project", status: "invalid", reason: "schema violation" }],
			trustStore,
		);

		expect(result.denyAllPrivileged).toBe(true);
	});
});
