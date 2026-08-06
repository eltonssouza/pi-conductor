/**
 * Test-first (Gate 5) for evidence Tier-1 resolution (`resolveEvidenceRef`/
 * `hasSufficientEvidenceForMandatoryGate`, src/gate-evidence.ts) — Fase 4 "Gates e evidências", ADR
 * 0005 §8/§18 appendix, gate2-spec-fase4.md Grupo C FR-5/FR-6, gate3-addendum-fase4.md T41, rule R25.
 *
 * Both functions are currently STUBS that unconditionally throw "not implemented" — every test below
 * fails RED for that one reason today (same precedent as gate-approval.test.ts / test/tools/task.test.ts).
 * Written against the REAL, locked contract (ADR 0005 §8) so each becomes the actual proof of R25 once
 * Gate 6 fills the body in.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type EvidenceProvenanceInfo,
	hasSufficientEvidenceForMandatoryGate,
	resolveEvidenceRef,
	type ResolveEvidenceRefContext,
} from "../src/gate-evidence.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function baseCtx(overrides: Partial<ResolveEvidenceRefContext> = {}): ResolveEvidenceRefContext {
	return {
		repoRoot: workspace.root,
		workspaceRoot: workspace.root,
		gitCommitExists: () => false,
		runtimeRecordedTestRunIds: new Set(),
		runtimeRecordedJournalEntryIds: new Set(),
		...overrides,
	};
}

describe("resolveEvidenceRef (R25 Tier-1: every variant has to resolve, fail-closed)", () => {
	describe("kind: git-commit", () => {
		it('ok:true, provenance "author-declared", when the sha resolves in this repo (git rev-parse succeeds)', () => {
			const ctx = baseCtx({ gitCommitExists: (_repoRoot, sha) => sha === "deadbeef" });

			const result = resolveEvidenceRef({ kind: "git-commit", sha: "deadbeef" }, ctx);

			expect(result).toEqual({ ok: true, provenance: "author-declared" });
		});

		it("ok:false (fail-closed) when the sha does not resolve -- a dangling commit ref is refused, never attached", () => {
			const ctx = baseCtx({ gitCommitExists: () => false });

			const result = resolveEvidenceRef({ kind: "git-commit", sha: "0000000" }, ctx);

			expect(result.ok).toBe(false);
			expect((result as { ok: false; reason: string }).reason.length).toBeGreaterThan(0);
		});
	});

	describe("kind: file", () => {
		it('ok:true, provenance "author-declared", for a real file inside the workspace (resolveRealPath/isWithinRoot)', () => {
			const filePath = join(workspace.root, "evidence.txt");
			writeFileSync(filePath, "proof");
			const ctx = baseCtx();

			const result = resolveEvidenceRef({ kind: "file", path: filePath }, ctx);

			expect(result).toEqual({ ok: true, provenance: "author-declared" });
		});

		it("ok:false for a file that does not exist -- a dangling ref is refused, never anexado silently", () => {
			const ctx = baseCtx();

			const result = resolveEvidenceRef({ kind: "file", path: join(workspace.root, "nope.txt") }, ctx);

			expect(result.ok).toBe(false);
		});

		it("ok:false for a real file that resolves OUTSIDE the workspace root (fail-closed containment, reuses isWithinRoot)", () => {
			const outside = createScratchWorkspace("conductor-runtime-outside-");
			try {
				const outsidePath = join(outside.root, "secret.txt");
				writeFileSync(outsidePath, "not evidence for this workspace");
				const ctx = baseCtx();

				const result = resolveEvidenceRef({ kind: "file", path: outsidePath }, ctx);

				expect(result.ok).toBe(false);
			} finally {
				outside.cleanup();
			}
		});
	});

	describe("kind: test-run (runtime-derived)", () => {
		it('ok:true, provenance "runtime-derived", when the id is one the runtime actually recorded', () => {
			const ctx = baseCtx({ runtimeRecordedTestRunIds: new Set(["run-42"]) });

			const result = resolveEvidenceRef({ kind: "test-run", id: "run-42" }, ctx);

			expect(result).toEqual({ ok: true, provenance: "runtime-derived" });
		});

		it("ok:false (fail-closed) for a test-run id the runtime never recorded -- an invented id is refused, not merely downgraded", () => {
			const ctx = baseCtx({ runtimeRecordedTestRunIds: new Set() });

			const result = resolveEvidenceRef({ kind: "test-run", id: "run-made-up" }, ctx);

			expect(result.ok).toBe(false);
		});
	});

	describe("kind: journal-entry (runtime-derived)", () => {
		it('ok:true, provenance "runtime-derived", when the id is one the runtime actually recorded', () => {
			const ctx = baseCtx({ runtimeRecordedJournalEntryIds: new Set(["j-1"]) });

			const result = resolveEvidenceRef({ kind: "journal-entry", id: "j-1" }, ctx);

			expect(result).toEqual({ ok: true, provenance: "runtime-derived" });
		});

		it("ok:false for a journal-entry id the runtime never recorded", () => {
			const ctx = baseCtx({ runtimeRecordedJournalEntryIds: new Set() });

			const result = resolveEvidenceRef({ kind: "journal-entry", id: "j-ghost" }, ctx);

			expect(result.ok).toBe(false);
		});
	});
});

describe("hasSufficientEvidenceForMandatoryGate (R25 golden rule: runtime-derived preferred to close a mandatory gate)", () => {
	it("false for an empty evidence list -- a mandatory gate is never approved empty (BR-6)", () => {
		expect(hasSufficientEvidenceForMandatoryGate([])).toBe(false);
	});

	it('false when EVERY attached item is "author-declared" -- a free-text/file/commit ref alone never closes a mandatory gate', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared" }, { provenance: "author-declared" }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});

	it('true as soon as at least one attached item is "runtime-derived", regardless of how many author-declared items also exist', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared" }, { provenance: "runtime-derived" }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it('true for a single "runtime-derived" item alone', () => {
		expect(hasSufficientEvidenceForMandatoryGate([{ provenance: "runtime-derived" }])).toBe(true);
	});
});
