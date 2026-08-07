/**
 * `@conductor/diary` -- the journal READER (BORDA: fs; NEVER throws -- the exact mold
 * `@conductor/library`'s `grounding-ledger.ts` reader already established, ported here per
 * docs/adr/0007-fase6-diary-and-capture.md D7/§8.2/§8.3, R44/T63/T59, and §4.3 for the Fase-4 interop).
 *
 * GATE 5 (test-first): `openJournalReader`/`readRecordedJournalEntryIds` are STUBS that throw "not
 * implemented" -- Gate 6 implements the bodies. This file ships the signatures
 * test/journal-reader.test.ts already compiles and tests against. `JournalEntry` is imported from
 * `./journal-entry.ts`, NOT redeclared here -- see that file's own header for the type-ownership
 * decision (a PARALLEL Gate 5 stream, `recall.ts`/`search.ts`/`digest.ts`/`capture.ts`, shares this same
 * package and claimed `journal-entry.ts` first; `recall.ts`/`search.ts` already import `JournalReader`
 * from this file).
 *
 * What Gate 6's bodies owe this contract (ADR §16/§8.2/§8.3/§4.3, verbatim):
 *
 *   - `readAll()` is the RAW history -- every entry ever appended, INCLUDING superseded originals (the
 *     analogue of `journal.py:_read_mirror`, which never filters). `log`/`digest`/export read this
 *     (digest.ts's own header already documents that it is the CALLER's choice, not renderDigest's, to
 *     pass `readAll()` here).
 *   - `readActive()` is CURRENT knowledge only -- an entry a later `supersedes` names is excluded (BR-5,
 *     the analogue of `journal.py:active_entries`). `recall.ts`/`search.ts` read this.
 *   - NEITHER throws (R44/T63, R36 ported): a missing directory, an unreadable file, or a corrupted
 *     individual line all collapse to "no entries" for that method -- a bad line is skipped on its own,
 *     the entries before and after it still read (the same single-try/catch-around-the-whole-read plus
 *     per-line try/catch discipline `grounding-ledger.ts`'s own `readEvents` already uses). The net
 *     effect (§6.3/D4): deleting the journal REVOKES the evidence it produced, it never FABRICATES any --
 *     a session becomes LESS permissive when the log disappears, never more.
 *   - `readRecordedJournalEntryIds(reader)` is the Fase-4 interop point (D2/G12/FR-25): the exact set the
 *     CLI (composition root) passes as `ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds`, so a
 *     `--ref journal-entry:<id>` typed by hand (never actually written by this runtime) is refused
 *     (R25). DECISION (the ADR's §4.3 does not name readAll vs. readActive explicitly, so this is a
 *     documented Gate-5 call, not an invented contract shape): it is built from `readAll()`, NOT
 *     `readActive()`. D2's whole point is "existence, not work" -- an id this runtime once minted is a
 *     genuine existence fact regardless of a LATER correction; §4/D2 already caps what a resolved
 *     `journal-entry` ref can prove (context/provenance, never sole closure of a mandatory gate, since
 *     `hasSufficientEvidenceForMandatoryGate` requires `ref.kind === "test-run"` for that) REGARDLESS of
 *     whether the cited entry is still active, so narrowing this set to `readActive()` would silently
 *     invent a NEW behaviour (supersede retroactively un-registering an id) the ADR's D7/D2 never
 *     describes, for zero security benefit the ADR actually asks for. FAIL-CLOSED either way: a reader
 *     that cannot read anything returns an EMPTY `Set`, never throws.
 */

import type { JournalEntry } from "./journal-entry.ts";

export interface JournalReader {
	/** Raw history -- ALL entries, including superseded ones. NEVER throws. */
	readAll(): readonly JournalEntry[];
	/** Current knowledge -- superseded entries excluded (BR-5). NEVER throws. */
	readActive(): readonly JournalEntry[];
}

/** Opens the journal at `entriesPath` for reading, scoped to `projectId` (kept for shape parity with
 * `grounding-ledger.ts`'s own reader factory and for Gate-6's future use; `JournalEntry` itself carries
 * no `projectId` field per §16 -- partitioning is a property of WHICH FILE the caller opens, D4/§6.1's
 * one-file-per-project-per-session layout, not a per-record filter here). NEVER throws once implemented. */
export function openJournalReader(entriesPath: string, projectId: string): JournalReader {
	throw new Error("not implemented");
}

/** Fase-4 interop (D2/G12/FR-25): the set of ids this runtime genuinely recorded, for
 * `ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds`. FAIL-CLOSED: an unreadable journal yields
 * an EMPTY set, never throws -- see this file's header for why `readAll()`, not `readActive()`. */
export function readRecordedJournalEntryIds(reader: JournalReader): ReadonlySet<string> {
	throw new Error("not implemented");
}
