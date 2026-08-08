/**
 * The 5th `EvidenceRef` kind, `"delegation"` (ADR 0010 "Wiring de delegação real de subagentes em
 * runAuto" §9/D7, gate2-spec-auto-subagent-delegation.md FR-5/FR-5a/FR-5b, gate3-addendum
 * T83/R64/GAP-A/GAP-B).
 *
 * `resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate`'s `"delegation"` handling is a REAL
 * implementation (not a stub) landed by this demand's own Gate 5 pass -- see `src/gate-evidence.ts`'s
 * own updated header ("5TH KIND") for the full design. Every test below should be GREEN today, not
 * RED-for-a-stub-throw: this file is the actual regression proof of FR-5/FR-5a/FR-5b, mirroring
 * `gate-evidence.test.ts`'s own established pattern for `test-run`/`journal-entry` exactly (same
 * `baseCtx` shape, same ok:true/ok:false split).
 *
 * DELIBERATE DEVIATION FROM THE ADR'S OWN PROSE (flagged, not silently applied): ADR 0010 §9/D7's text
 * says `hasSufficientEvidenceForMandatoryGate`'s runtime-derived branch should become `test-run ||
 * journal-entry || delegation`. This suite (and `src/gate-evidence.ts`'s own implementation) applies
 * only `test-run || delegation` -- `journal-entry` remains EXCLUDED, exactly as ADR 0007 §4.2/D2/T59
 * (Fase 6) deliberately left it, guarded by THREE existing tests this change would otherwise break:
 * `gate-evidence-journal-entry-not-sole.test.ts` (this package), `@conductor/cli`'s
 * `gate-cli.acceptance.test.ts` ("R40/D2 non-regression"), and `@conductor/cli`'s `gate9-pentest.test.ts`
 * (a dedicated Gate-9 PENTEST regression: a FORGED journal-entry must never close a mandatory gate).
 * See `src/gate-evidence.ts`'s own header for the full reasoning; flagged back to the architect/user
 * for an explicit Gate 3/4 reconciliation of the two ADRs rather than silently picked either way.
 */

import { describe, expect, it } from "vitest";
import {
	type EvidenceProvenanceInfo,
	hasSufficientEvidenceForMandatoryGate,
	type ResolveEvidenceRefContext,
	resolveEvidenceRef,
} from "../src/gate-evidence.ts";

function baseCtx(overrides: Partial<ResolveEvidenceRefContext> = {}): ResolveEvidenceRefContext {
	return {
		repoRoot: "/tmp",
		workspaceRoot: "/tmp",
		gitCommitExists: () => false,
		runtimeRecordedTestRunIds: new Set(),
		runtimeRecordedJournalEntryIds: new Set(),
		runtimeRecordedDelegationSessionIds: new Set(),
		...overrides,
	};
}

describe('resolveEvidenceRef -- kind: "delegation" (5th EvidenceRef kind, FR-5/FR-5a, ADR 0010 D7)', () => {
	it('ok:true, provenance "runtime-derived", when the sessionId is one the runtime actually observed spawning', () => {
		const ctx = baseCtx({ runtimeRecordedDelegationSessionIds: new Set(["session-abc"]) });

		const result = resolveEvidenceRef(
			{ kind: "delegation", sessionId: "session-abc", role: "software-engineer" },
			ctx,
		);

		expect(result).toEqual({ ok: true, provenance: "runtime-derived" });
	});

	it("ok:false (fail-closed) for a sessionId the runtime never recorded -- an invented/forged id is refused, never merely downgraded", () => {
		const ctx = baseCtx({ runtimeRecordedDelegationSessionIds: new Set() });

		const result = resolveEvidenceRef(
			{ kind: "delegation", sessionId: "session-never-observed", role: "software-engineer" },
			ctx,
		);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toMatch(/never recorded by the runtime/i);
	});

	it("ok:false for a sessionId recorded under a DIFFERENT role's delegation -- role is carried for observability only, but a mismatched/absent sessionId still refuses (membership is keyed on sessionId alone, exactly like test-run/journal-entry's own id-only keying)", () => {
		const ctx = baseCtx({ runtimeRecordedDelegationSessionIds: new Set(["session-for-security-engineer"]) });

		const result = resolveEvidenceRef(
			{ kind: "delegation", sessionId: "session-for-a-different-gate", role: "security-engineer" },
			ctx,
		);

		expect(result.ok).toBe(false);
	});
});

describe("hasSufficientEvidenceForMandatoryGate -- delegation extends the runtime-derived branch (FR-5b, ADR 0010 D7)", () => {
	it('true for a single "delegation" item alone, provenance "runtime-derived" -- the same strength class as a test-run', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "runtime-derived", ref: { kind: "delegation" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it('true when a "delegation" item sits alongside file-only author-declared items -- the delegation item alone already clears the bar', () => {
		const evidence: EvidenceProvenanceInfo[] = [
			{ provenance: "author-declared", ref: { kind: "file" } },
			{ provenance: "runtime-derived", ref: { kind: "delegation" } },
		];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it('a "delegation" ref that never actually resolved runtime-derived (a hypothetical malformed caller passing "author-declared" for it) does NOT get the exception -- the branch is keyed to provenance==="runtime-derived" AND ref.kind==="delegation" together, never ref.kind alone', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared", ref: { kind: "delegation" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});

	it("REGRESSION: journal-entry alone still does NOT close a mandatory gate (ADR 0007 D2/T59 preserved -- deliberately NOT extended by this demand, see this file's own header)", () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "runtime-derived", ref: { kind: "journal-entry" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});

	it("REGRESSION: test-run alone is still sufficient, unchanged by adding the delegation branch", () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "runtime-derived", ref: { kind: "test-run" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it("REGRESSION: a resolved git-commit item alone is still sufficient (Gate 8 loop-back interim fallback), unchanged", () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared", ref: { kind: "git-commit" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});

	it("REGRESSION: a file-only item alone is still insufficient, unchanged", () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "author-declared", ref: { kind: "file" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});

	it("REGRESSION: an empty evidence list is still insufficient, unchanged (BR-6)", () => {
		expect(hasSufficientEvidenceForMandatoryGate([])).toBe(false);
	});
});

describe("resolveEvidenceRef -- REGRESSION: the 4 pre-existing kinds resolve identically with the new context field present", () => {
	it("git-commit: unchanged", () => {
		const ctx = baseCtx({ gitCommitExists: (_repoRoot, sha) => sha === "deadbeef" });
		expect(resolveEvidenceRef({ kind: "git-commit", sha: "deadbeef" }, ctx)).toEqual({
			ok: true,
			provenance: "author-declared",
		});
		expect(resolveEvidenceRef({ kind: "git-commit", sha: "0000000" }, ctx).ok).toBe(false);
	});

	it("test-run: unchanged", () => {
		const ctx = baseCtx({ runtimeRecordedTestRunIds: new Set(["run-42"]) });
		expect(resolveEvidenceRef({ kind: "test-run", id: "run-42" }, ctx)).toEqual({
			ok: true,
			provenance: "runtime-derived",
		});
		expect(resolveEvidenceRef({ kind: "test-run", id: "run-made-up" }, ctx).ok).toBe(false);
	});

	it("journal-entry: unchanged", () => {
		const ctx = baseCtx({ runtimeRecordedJournalEntryIds: new Set(["j-1"]) });
		expect(resolveEvidenceRef({ kind: "journal-entry", id: "j-1" }, ctx)).toEqual({
			ok: true,
			provenance: "runtime-derived",
		});
		expect(resolveEvidenceRef({ kind: "journal-entry", id: "j-ghost" }, ctx).ok).toBe(false);
	});
});
