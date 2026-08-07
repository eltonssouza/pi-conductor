/**
 * Test-first (Gate 5, Fase 6 "Diary e captura automática") for `REDACTION_SINKS`' 8th sink, "diary"
 * (D8 §10.1, ADR 0007 §12.4 + §16, docs/adr/0007-fase6-diary-and-capture.md; closes T62/R43): every
 * write the Diary performs -- manual (`journal add`) AND automatic capture (D5) -- deep-redacts EVERY
 * leaf string (reusing `redactSessionEntryForPersistence`/`deepRedact`, R12a) before it ever touches
 * disk, never a spread-then-overwrite that redacts only `text` and leaks the other fields of a
 * multi-field captured entry (T62, the same lesson T57/R38 already taught this mechanism at Fase 5).
 *
 * `redactSecrets`/`REDACTION_SINKS` are ALREADY fully implemented (Fase 2/5 Gate 6 landed) -- this test
 * targets the STILL-OPEN enumeration gap in that already-shipped closed list, not a stub throw. Mirrors
 * the exact pattern `redaction-code-index-sink.test.ts` (Fase 5) already used for its own 7th-sink gap.
 */

import { describe, expect, it } from "vitest";
import { REDACTION_SINKS } from "../src/redaction.ts";

describe('REDACTION_SINKS -- gains an 8th sink, "diary" (D8 §10.1, ADR 0007 §12.4)', () => {
	it('has exactly eight entries -- the seven existing sinks plus the new "diary" -- FAILS today: the enumeration still has seven', () => {
		expect(REDACTION_SINKS).toHaveLength(8);
		expect(REDACTION_SINKS).toEqual(
			expect.arrayContaining([
				"transcript",
				"notify",
				"sessionJsonl",
				"auditTrail",
				"rethrownError",
				"sessionExport",
				"codeIndex",
				"diary",
			]),
		);
	});
});
