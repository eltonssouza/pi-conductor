/**
 * Test-first (Gate 5, Fase 6 "Diary e captura automática") for D2/R40/T59/GAP-6A (ADR 0007 §4 + §12.4,
 * docs/adr/0007-fase6-diary-and-capture.md): `hasSufficientEvidenceForMandatoryGate`'s runtime-derived
 * branch (`src/gate-evidence.ts:208-211`) must close a MANDATORY gate alone only for a `test-run` (a
 * genuinely observed test EXECUTION) -- NEVER for a `journal-entry` (a genuinely observed WRITE of free
 * text: existence, not work).
 *
 * `hasSufficientEvidenceForMandatoryGate`/`resolveEvidenceRef` are ALREADY fully implemented (Fase 4
 * Gate 6 landed, later widened by a Gate 8 loop-back to also accept a resolved `git-commit` alone --
 * see this same test/gate-evidence.test.ts's own header) -- this test targets a REAL, still-open gap in
 * that already-shipped predicate, not a stub throw. Confirmed against the CURRENT source before writing
 * this test (`src/gate-evidence.ts:208-211`):
 *
 *   export function hasSufficientEvidenceForMandatoryGate(evidence): boolean {
 *     if (evidence.some((item) => item.provenance === "runtime-derived")) return true;
 *     return evidence.some((item) => item.provenance === "author-declared" && item.ref.kind === "git-commit");
 *   }
 *
 * The first branch accepts ANY `provenance === "runtime-derived"` item, regardless of `ref.kind` -- so
 * a `journal-entry` item (which DOES resolve as "runtime-derived" once `resolveEvidenceRef`'s
 * `runtimeRecordedJournalEntryIds` seam is wired, Fase 6 G12/FR-25) satisfies that `some(...)` TODAY,
 * exactly like a `test-run` item would. This test fails RED today for precisely that reason: it asserts
 * `false` for a journal-entry-only evidence list, but the current code returns `true`.
 *
 * ADR 0007 §4.2's fix (the change this test locks in, applied at Gate 6 -- NOT this Gate 5 pass, per
 * this task's own instruction not to touch production code here):
 *
 *   if (evidence.some((item) => item.provenance === "runtime-derived" && item.ref.kind === "test-run")) return true;
 *   return evidence.some((item) => item.provenance === "author-declared" && item.ref.kind === "git-commit");
 *
 * `resolveEvidenceRef`/`ResolveEvidenceRefContext`/`EvidenceRef`/`EvidenceProvenance` themselves are
 * UNCHANGED by this ADR (§12.4: "Nada mais em código herdado muda") -- a `journal-entry` id the runtime
 * genuinely recorded still RESOLVES as `runtime-derived` (the seam FECHA, G12); what changes is only
 * what a resolved journal-entry item is allowed to close ALONE.
 */

import { describe, expect, it } from "vitest";
import { type EvidenceProvenanceInfo, hasSufficientEvidenceForMandatoryGate } from "../src/gate-evidence.ts";

describe("hasSufficientEvidenceForMandatoryGate -- a journal-entry is EXISTENCE, never TRABALHO, alone (D2/R40/T59)", () => {
	it('returns false for evidence containing ONLY a "runtime-derived" journal-entry item, with no test-run anywhere in the list -- FAILS today: the current predicate accepts ANY runtime-derived item, including journal-entry', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "runtime-derived", ref: { kind: "journal-entry" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(false);
	});

	it('still returns true for a "runtime-derived" test-run item alone -- the golden case D2 must NOT break (unchanged from before this ADR)', () => {
		const evidence: EvidenceProvenanceInfo[] = [{ provenance: "runtime-derived", ref: { kind: "test-run" } }];

		expect(hasSufficientEvidenceForMandatoryGate(evidence)).toBe(true);
	});
});
