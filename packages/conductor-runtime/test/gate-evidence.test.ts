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

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type EvidenceProvenanceInfo,
	hasSufficientEvidenceForMandatoryGate,
	type ResolveEvidenceRefContext,
	resolveEvidenceRef,
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
		// ADR 0010 §9/D7 (5th EvidenceRef kind) -- this file's own subject is the 4 pre-existing kinds;
		// the delegation kind gets its own dedicated suite, gate-evidence-delegation.test.ts.
		runtimeRecordedDelegationSessionIds: new Set(),
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

describe("hasSufficientEvidenceForMandatoryGate (R25 golden rule: runtime-derived preferred; git-commit accepted as an interim Tier-1 fallback until Fase 6 ledgers exist)", () => {
	it("false for an empty evidence list -- a mandatory gate is never approved empty (BR-6)", () => {
		expect(hasSufficientEvidenceForMandatoryGate([])).toBe(false);
	});

	// GATE 8 LOOP-BACK NOTE: this test originally asserted `false` for ANY all-"author-declared"
	// evidence list, regardless of `ref.kind` -- correct at the time (this file's own header: Gate 5
	// wrote this test deliberately locking that OLD behavior), but Gate 8 ran the real CLI end-to-end and
	// found it made `status:"approved"` structurally UNREACHABLE for every mandatory gate, because the
	// only two kinds capable of ever producing "runtime-derived" (test-run/journal-entry) have no real
	// producer yet (no Fase 6 ledger exists). The orchestrator re-read R25/T41 and extended the golden
	// rule (src/gate-evidence.ts's own updated header/doc comment has the full reasoning): a genuinely
	// RESOLVED `git-commit` ref is now accepted alone. This test is NARROWED, not deleted, to keep
	// proving the part of the old claim that is still true -- a `file` ref alone (weaker anti-forgery:
	// only proves a path exists inside the workspace) still never closes a mandatory gate. The NEW
	// git-commit behavior gets its own dedicated tests below instead of silently overwriting this one.
	it('false when EVERY attached item is "author-declared" AND a "file" ref -- a file-only claim alone never closes a mandatory gate', () => {
		const evidence: EvidenceProvenanceInfo[] = [
			{ provenance: "author-declared", ref: { kind: "file" } },
			{ provenance: "author-declared", ref: { kind: "file" } },
		];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});

	// UPDATE (Fase 6, ADR 0007 §4.2 D2/R40/T59): this test originally used a "journal-entry" runtime-derived
	// item as its example — correct at the time (a journal-entry was still treated as equivalent to a
	// test-run for this predicate), but Fase 6's D2 fix narrows the runtime-derived branch to
	// `ref.kind === "test-run"` specifically, because a journal-entry proves a WRITE happened (existence),
	// never that a test actually ran (work). The fixture below is updated to "test-run" so this test keeps
	// proving its own stated claim ("true as soon as at least one attached item is runtime-derived[+test-run],
	// regardless of file-only items"); the journal-entry-alone-is-insufficient case now has its own dedicated
	// test, test/gate-evidence-journal-entry-not-sole.test.ts.
	it('true as soon as at least one attached item is "runtime-derived" test-run, regardless of how many file-only author-declared items also exist', () => {
		const evidence: EvidenceProvenanceInfo[] = [
			{ provenance: "author-declared", ref: { kind: "file" } },
			{ provenance: "runtime-derived", ref: { kind: "test-run" } },
		];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it('true for a single "runtime-derived" item alone', () => {
		expect(
			hasSufficientEvidenceForMandatoryGate([{ provenance: "runtime-derived", ref: { kind: "test-run" } }]),
		).toBe(true);
	});

	// GATE 8 LOOP-BACK: the new branch. A git-commit ref that resolved via `resolveEvidenceRef`'s own
	// `gitCommitExists` check (the ONLY producer of `provenance: "author-declared"`, never a
	// caller-supplied guess) is accepted alone -- interim, until Fase 6's runtime ledgers exist.
	it('true for a single "git-commit" item alone, even though its provenance is "author-declared" -- interim Tier-1 acceptance (Gate 8 loop-back re-read of R25/T41)', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared", ref: { kind: "git-commit" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it('a "file" ref together with a "git-commit" ref is sufficient -- the git-commit item alone already clears the bar (order of the two array entries must not matter)', () => {
		const evidence: EvidenceProvenanceInfo[] = [
			{ provenance: "author-declared", ref: { kind: "file" } },
			{ provenance: "author-declared", ref: { kind: "git-commit" } },
		];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it('a "journal-entry" ref that never actually resolved runtime-derived (hypothetical malformed caller passing "author-declared" for it) does NOT get the git-commit exception -- the exception is narrowly keyed to ref.kind === "git-commit", not to provenance alone', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared", ref: { kind: "journal-entry" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});
});
