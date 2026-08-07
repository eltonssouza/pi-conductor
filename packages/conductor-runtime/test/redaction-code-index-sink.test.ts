/**
 * Test-first (Gate 5, Fase 5) for REDACTION_SINKS' 7th sink, "codeIndex" (D6 §9.1, ADR 0006 §19,
 * `docs/adr/0006-fase5-library-and-grounding.md`): the code-aware index gets its own entry in the
 * closed enumeration `redaction.test.ts` already locks at six — applied BEFORE the embed, never after
 * (D6 §9.1: "ler arquivo -> redactSecrets(text) -> chunk -> embed -> upsert"; a secret embedded before
 * redaction stays recoverable by semantic similarity even if the text later shown is masked).
 *
 * `redactSecrets`/`REDACTION_SINKS` are ALREADY fully implemented (Fase 2 Gate 6 landed) — this test
 * targets the STILL-OPEN enumeration gap in that already-shipped closed list, not a stub throw: the
 * six-sink array is the mechanism ADR 0003 §6.2 built specifically so "the enumeration is complete" is
 * an assertable fact, not a paragraph in a doc that could quietly shrink or fail to grow.
 */

import { describe, expect, it } from "vitest";
import { REDACTION_SINKS } from "../src/redaction.ts";

// UPDATE (Fase 6, ADR 0007 §12.4/§16 D8): the enumeration this test pins legitimately grew again, from
// seven to eight ("diary", see test/redaction-diary-sink.test.ts for that sink's own dedicated test) —
// same class of change as this file's own six-to-seven update at Fase 5, not a defect in this file.
describe('REDACTION_SINKS — gains a 7th sink, "codeIndex" (D6 §9.1, ADR 0006 §19)', () => {
	it('contains "codeIndex" among the (now eight) entries', () => {
		expect(REDACTION_SINKS).toEqual(
			expect.arrayContaining([
				"transcript",
				"notify",
				"sessionJsonl",
				"auditTrail",
				"rethrownError",
				"sessionExport",
				"codeIndex",
			]),
		);
	});
});
