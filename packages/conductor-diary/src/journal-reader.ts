/**
 * `@conductor/diary` -- the journal READER (BORDA: fs; NEVER throws -- the exact mold
 * `@conductor/library`'s `grounding-ledger.ts` reader already established, ported here per
 * docs/adr/0007-fase6-diary-and-capture.md D7/§8.2/§8.3, R44/T63/T59, and §4.3 for the Fase-4 interop).
 *
 * GATE 6 (this implementation): `readAll`/`readActive` parse the JSONL file line-by-line, skipping any
 * line that fails to parse OR fails a shape check (a defense-in-depth pair -- `JSON.parse` catches
 * syntactic corruption, the shape check catches a syntactically valid but structurally wrong record,
 * e.g. a foreign JSONL file pointed at this path by mistake) -- never aborting the read of the entries
 * before/after it. A missing directory, a missing file, a path that is a directory instead of a file,
 * and a permission error all collapse to `[]` identically (the same single-try/catch-around-the-whole-
 * read discipline `grounding-ledger.ts:readEvents` already uses).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import type { EditMode, JournalEntry, JournalKind, JournalProvenance, JournalSource } from "./journal-entry.ts";

export interface JournalReader {
	/** Raw history -- ALL entries, including superseded ones. NEVER throws. */
	readAll(): readonly JournalEntry[];
	/** Current knowledge -- superseded entries excluded (BR-5). NEVER throws. */
	readActive(): readonly JournalEntry[];
}

const JOURNAL_KINDS: readonly JournalKind[] = ["reasoning", "decision", "plan", "error", "solution", "checkpoint"];
const JOURNAL_SOURCES: readonly JournalSource[] = ["manual", "capture", "document"];
const EDIT_MODES: readonly EditMode[] = ["update", "forget", "invalidate"];

/** A raw JSONL record, before it is known to match `JournalEntry`'s shape -- deliberately untyped past
 * this point (parsed JSON is `unknown` by nature), the same "shape-check then trust" discipline
 * `grounding-ledger.ts`'s own `RawLedgerEvent`/`toQueryView` apply to their parsed JSON. */
interface RawJournalRecord {
	[key: string]: unknown;
}

/**
 * Reads and parses every line of `path`, collapsing EVERY failure mode to an empty array rather than
 * throwing (R44/T63/R36 ported): a missing directory, a missing file, a path that is a directory instead
 * of a file, and a permission error all fail closed identically. A corrupted individual LINE (invalid
 * JSON) is skipped on its own -- caught line-by-line -- so one bad line never aborts the read of every
 * other, valid line before and after it.
 */
function readRawRecords(path: string): RawJournalRecord[] {
	try {
		if (!existsSync(path)) return [];
		if (!statSync(path).isFile()) return [];
		const raw = readFileSync(path, "utf8");
		const records: RawJournalRecord[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (parsed !== null && typeof parsed === "object") records.push(parsed as RawJournalRecord);
			} catch {
				// Corrupted line -- skip it, keep reading the rest (R44/T63/R36).
			}
		}
		return records;
	} catch {
		// Missing/unreadable directory or file, or any other unexpected fs error: fail closed to "no
		// entries", never throw (R44/T63 -- an unreadable journal is not proof of anything, so it must be
		// indistinguishable from an empty one to every caller of this reader).
		return [];
	}
}

function isJournalKind(value: unknown): value is JournalKind {
	return typeof value === "string" && (JOURNAL_KINDS as readonly string[]).includes(value);
}

function isJournalSource(value: unknown): value is JournalSource {
	return typeof value === "string" && (JOURNAL_SOURCES as readonly string[]).includes(value);
}

function toProvenance(value: unknown): JournalProvenance {
	if (value === null || typeof value !== "object") return {};
	const raw = value as Record<string, unknown>;
	const provenance: JournalProvenance = {};
	if (typeof raw.branch === "string") provenance.branch = raw.branch;
	if (typeof raw.sha === "string") provenance.sha = raw.sha;
	if (typeof raw.repo === "string") provenance.repo = raw.repo;
	return provenance;
}

/** Shape-checks a raw parsed record against every field `JournalEntry` requires, returning `null` for
 * anything that does not match (the same "skip, never throw, never fabricate a field" discipline
 * `grounding-ledger.ts:toQueryView` applies to its own sink). `gate`/`supersedes`/`editMode` are
 * optional -- present only when the raw record actually carries a validly-shaped value for them. */
function toJournalEntry(record: RawJournalRecord): JournalEntry | null {
	if (
		typeof record.id !== "string" ||
		record.schemaVersion !== 1 ||
		typeof record.ts !== "string" ||
		typeof record.sessionId !== "string" ||
		typeof record.author !== "string" ||
		!isJournalKind(record.kind) ||
		!isJournalSource(record.source) ||
		typeof record.text !== "string"
	) {
		return null;
	}

	const entry: JournalEntry = {
		id: record.id,
		schemaVersion: 1,
		ts: record.ts,
		sessionId: record.sessionId,
		author: record.author,
		kind: record.kind,
		source: record.source,
		text: record.text,
		provenance: toProvenance(record.provenance),
	};
	if (typeof record.gate === "number") entry.gate = record.gate;
	if (typeof record.supersedes === "string") entry.supersedes = record.supersedes;
	if (typeof record.editMode === "string" && (EDIT_MODES as readonly string[]).includes(record.editMode)) {
		entry.editMode = record.editMode as EditMode;
	}
	return entry;
}

function parseEntries(path: string): JournalEntry[] {
	const entries: JournalEntry[] = [];
	for (const record of readRawRecords(path)) {
		const entry = toJournalEntry(record);
		if (entry) entries.push(entry);
	}
	return entries;
}

/** An entry `id` is excluded from the ACTIVE set the moment some OTHER entry's `supersedes` names it
 * (BR-5, `journal.py:active_entries`'s analogue) -- a chain of two-or-more corrections still leaves only
 * the last, most-recent entry standing, since every earlier link in the chain is named by exactly one
 * later `supersedes`. */
function excludeSuperseded(all: readonly JournalEntry[]): JournalEntry[] {
	const supersededIds = new Set<string>();
	for (const entry of all) {
		if (entry.supersedes !== undefined) supersededIds.add(entry.supersedes);
	}
	return all.filter((entry) => !supersededIds.has(entry.id));
}

/** Opens the journal at `entriesPath` for reading, scoped to `projectId` (kept for shape parity with
 * `grounding-ledger.ts`'s own reader factory and for Gate-6's future use; `JournalEntry` itself carries
 * no `projectId` field per §16 -- partitioning is a property of WHICH FILE the caller opens, D4/§6.1's
 * one-file-per-project-per-session layout, not a per-record filter here). NEVER throws. */
export function openJournalReader(entriesPath: string, _projectId: string): JournalReader {
	return {
		readAll(): readonly JournalEntry[] {
			return parseEntries(entriesPath);
		},
		readActive(): readonly JournalEntry[] {
			return excludeSuperseded(parseEntries(entriesPath));
		},
	};
}

/** Fase-4 interop (D2/G12/FR-25): the set of ids this runtime genuinely recorded, for
 * `ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds`. FAIL-CLOSED: an unreadable journal yields
 * an EMPTY set, never throws -- see this file's header for why `readAll()`, not `readActive()`. Wraps
 * `reader.readAll()` in its own try/catch as a belt-and-braces measure (mirroring
 * `gate-evidence.ts:resolveEvidenceRef`'s own "wraps every branch in a try/catch... not required for
 * this to be safe on its own"): `readAll()` never throws by contract, but a future reader implementation
 * that violated that contract must still not be able to turn this fail-closed interop point into a
 * thrown exception. */
export function readRecordedJournalEntryIds(reader: JournalReader): ReadonlySet<string> {
	try {
		return new Set(reader.readAll().map((entry) => entry.id));
	} catch {
		return new Set();
	}
}
