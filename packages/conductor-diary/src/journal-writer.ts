/**
 * `@conductor/diary` -- the journal WRITER (BORDA: fs; synchronous, THROWS on I/O failure -- the exact
 * mold `@conductor/library`'s `grounding-ledger.ts` writer already established for a sibling append-only
 * log, docs/adr/0007-fase6-diary-and-capture.md D1/§3.1, D7/§8, D8/§10).
 *
 * GATE 5 (test-first): `openJournalWriter` is a STUB that throws "not implemented" -- Gate 6 implements
 * the body. This file ships the signature test/journal-writer.test.ts already compiles and tests
 * against. Types (`JournalEntry`/`JournalAddInput`/`EditMode`) are imported from `./journal-entry.ts`,
 * NOT redeclared here -- see that file's own header for the type-ownership decision (a PARALLEL Gate 5
 * stream, `recall.ts`/`search.ts`/`digest.ts`/`capture.ts`, shares this same package and claimed
 * `journal-entry.ts` first).
 *
 * What Gate 6's body owes this contract (ADR §16, verbatim):
 *
 *   - `append` mints the `id` (randomUUID -- NEVER accepted from the caller, FR-4/BR-8), stamps
 *     `schemaVersion: 1`, an ISO-8601 `ts` (NEVER a `Date` -- the Fase-4 canonicalizer trap), and
 *     best-effort `provenance` (`branch?`/`sha?`/`repo?`, each field INDEPENDENTLY omitted -- never
 *     invented -- when git does not resolve; BR-3/FR-3). It deep-redacts every leaf string BEFORE the
 *     entry touches disk (D8/§10: the diary is the 8th closed `REDACTION_SINKS` value, reusing
 *     `redactSessionEntryForPersistence`/`deepRedact` from `@conductor/runtime` -- that wiring, and the
 *     resulting `@conductor/runtime` dependency, is Gate 6's job, not this stub's). It is synchronous
 *     end-to-end (`appendFileSync`, mode `0o600`, `flag: "a"`) and THROWS on any genuine I/O failure --
 *     never swallows one (the same reason `grounding-ledger.ts`'s own `appendEvent` has no try/catch of
 *     its own: a caller that believes an entry was recorded when the write actually failed silently is a
 *     worse lie than a thrown error).
 *   - `supersede` is the ONLY correction mechanism (D7/§8.1): a new append-only record, NEVER a mutation
 *     of the original line. It inherits `sessionId`/`gate`/`kind`/`author` from the original (a
 *     correction belongs to the same conversation/gate/topic-shape) and stamps FRESH provenance (a
 *     correction made from another branch/commit must say so, never silently inherit the original's). An
 *     `originalId` this writer's own log has never recorded is REFUSED -- `{ ok: false, kind:
 *     "unknown-entry", id }`, the analogue of `journal.py:edit_entry`'s `KeyError` -- NEVER producing a
 *     dangling `supersedes`, and NEVER throwing for that ordinary case (only a genuine I/O failure
 *     throws; an unresolved reference is an expected OUTCOME, the same "a value, not an exception"
 *     discipline `resolveEvidenceRef` already established in `@conductor/runtime`, ADR 0005).
 *
 * Concurrency (D1/§3.4, edge case 4): this writer assumes NO cross-process lock and NO CAS -- the "no
 * entry lost" property is delivered by the CALLER's choice of a per-session `entriesPath` (a partition),
 * never by a lock this module takes out. `appendFileSync` with `flag: "a"` is atomic for one line on the
 * same volume, the same guarantee `grounding-ledger.ts` already relies on for the same reason. Nothing in
 * this contract's shape (no lock handle, no CAS token, a synchronous return -- not a `Promise`) leaves
 * room for one to be smuggled in later without a signature change.
 */

import type { EditMode, JournalAddInput, JournalEntry } from "./journal-entry.ts";

export interface JournalWriter {
	/** Manual (`journal add`) or captured (D5's `curateCaptureEvent` output). Deep-redacts every leaf
	 * BEFORE persisting (D8/R43), mints the `id`, appends synchronously. THROWS on I/O failure -- never
	 * swallows one (the writer half of the `grounding-ledger.ts` mold). */
	append(input: JournalAddInput): JournalEntry;
	/** Append-only correction (D7): a new record with `supersedes`, inheriting session/gate/kind/author
	 * from the original, fresh provenance. Refuses (WITHOUT throwing) an `originalId` this log has never
	 * recorded. */
	supersede(
		originalId: string,
		newText: string,
		mode: EditMode,
	): { ok: true; entry: JournalEntry } | { ok: false; kind: "unknown-entry"; id: string };
}

/** Opens (creating the parent directory if necessary) the append-only JSONL journal at `entriesPath` for
 * writing. */
export function openJournalWriter(entriesPath: string): JournalWriter {
	throw new Error("not implemented");
}
