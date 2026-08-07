/**
 * Test-first (Gate 5) for the journal READER (src/journal-reader.ts) -- ADR
 * 0007-fase6-diary-and-capture.md D7/§8.2/§8.3, R44/T63, §4.3, §16.
 *
 * `openJournalReader`/`readRecordedJournalEntryIds` are currently STUBS that throw "not implemented" --
 * every test below fails RED for that one reason today (Gate 6 implements the bodies).
 *
 * readAll/readActive are exercised against a REAL log populated through the REAL `JournalWriter` (not a
 * mock) wherever a supersede history is needed -- the same "prove the real reader agrees with what the
 * real writer actually persisted" discipline `grounding-ledger.test.ts` established for its own writer/
 * reader pair. The corrupted-line and missing-file tests write raw JSONL by hand, the same way
 * `grounding-ledger.test.ts` does, because a real writer has no way to produce invalid JSON on purpose.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JournalAddInput } from "../src/journal-entry.ts";
import { openJournalReader, readRecordedJournalEntryIds } from "../src/journal-reader.ts";
import { openJournalWriter } from "../src/journal-writer.ts";

const scratchDirs: string[] = [];

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-diary-reader-"));
	scratchDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (scratchDirs.length > 0) {
		const dir = scratchDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

const PROJECT_ID = "project0000000001";

function sampleAddInput(overrides: Partial<JournalAddInput> = {}): JournalAddInput {
	return {
		kind: "decision",
		text: "usa JSONL append-only como fonte de verdade",
		sessionId: "session-0001",
		author: "sdet",
		gate: 5,
		source: "manual",
		...overrides,
	};
}

describe("JournalReader.readAll / readActive (D7/§8.2/BR-5: raw history vs. current knowledge)", () => {
	it("readAll returns EVERY entry ever appended, including a superseded original (raw history, journal.py:_read_mirror analogue)", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const original = writer.append(sampleAddInput({ text: "primeira versao" }));
		const correction = writer.supersede(original.id, "versao corrigida", "update");
		if (!correction.ok) throw new Error("expected ok:true");
		const reader = openJournalReader(entriesPath, PROJECT_ID);

		const all = reader.readAll();

		expect(all.map((e) => e.id)).toEqual(expect.arrayContaining([original.id, correction.entry.id]));
		expect(all).toHaveLength(2);
	});

	it("readActive excludes a superseded original -- only the correction counts as current (BR-5, journal.py:active_entries analogue)", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const original = writer.append(sampleAddInput({ text: "primeira versao" }));
		const correction = writer.supersede(original.id, "versao corrigida", "update");
		if (!correction.ok) throw new Error("expected ok:true");
		const reader = openJournalReader(entriesPath, PROJECT_ID);

		const active = reader.readActive();

		expect(active.map((e) => e.id)).toEqual([correction.entry.id]);
		expect(active.some((e) => e.id === original.id)).toBe(false);
	});

	it("an entry never superseded appears in BOTH readAll and readActive", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const entry = writer.append(sampleAddInput());
		const reader = openJournalReader(entriesPath, PROJECT_ID);

		expect(reader.readAll().map((e) => e.id)).toContain(entry.id);
		expect(reader.readActive().map((e) => e.id)).toContain(entry.id);
	});
});

describe("JournalReader fail-closed discipline (R44/T63/R36 ported: never throws, every failure collapses to empty)", () => {
	it("returns [] (not a throw) from both readAll and readActive when the journal file does not exist at all", () => {
		const missingPath = join(scratchDir(), "projects", "nope", "entries.jsonl");
		const reader = openJournalReader(missingPath, PROJECT_ID);

		expect(() => reader.readAll()).not.toThrow();
		expect(reader.readAll()).toEqual([]);
		expect(() => reader.readActive()).not.toThrow();
		expect(reader.readActive()).toEqual([]);
	});

	it("skips a corrupted line and still returns valid entries before AND after it, never aborting the whole read", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		mkdirSync(join(entriesPath, ".."), { recursive: true });
		const before = rawEntryLine({ id: "entry-1", text: "antes da linha corrompida" });
		const after = rawEntryLine({ id: "entry-2", text: "depois da linha corrompida" });
		writeFileSync(entriesPath, `${before}\n{ this is not valid JSON at all ///\n${after}\n`);
		const reader = openJournalReader(entriesPath, PROJECT_ID);

		const all = reader.readAll();

		expect(all.map((e) => e.id)).toEqual(expect.arrayContaining(["entry-1", "entry-2"]));
		expect(all).toHaveLength(2);
	});

	it("never throws even against a journal file that is not JSONL at all (garbage content)", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		mkdirSync(join(entriesPath, ".."), { recursive: true });
		writeFileSync(entriesPath, "\x00\x01binary garbage, not text at all\xff\xfe");
		const reader = openJournalReader(entriesPath, PROJECT_ID);

		expect(() => reader.readAll()).not.toThrow();
		expect(reader.readAll()).toEqual([]);
	});
});

describe("readRecordedJournalEntryIds (D2/G12/FR-25: the Fase-4 interop, fail-closed)", () => {
	it("returns a Set with the ids of every entry the reader sees via readAll -- INCLUDING a superseded original's id (documented Gate-5 decision, see journal-reader.ts header: existence, not current-ness, is what Fase 4 needs)", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const original = writer.append(sampleAddInput());
		const correction = writer.supersede(original.id, "corrigido", "update");
		if (!correction.ok) throw new Error("expected ok:true");
		const reader = openJournalReader(entriesPath, PROJECT_ID);

		const ids = readRecordedJournalEntryIds(reader);

		expect(ids.has(original.id)).toBe(true);
		expect(ids.has(correction.entry.id)).toBe(true);
	});

	it("fails closed to an EMPTY Set (never throws) when the underlying journal is unreadable", () => {
		const missingPath = join(scratchDir(), "projects", "nope", "entries.jsonl");
		const reader = openJournalReader(missingPath, PROJECT_ID);

		let ids: ReadonlySet<string> | undefined;
		expect(() => {
			ids = readRecordedJournalEntryIds(reader);
		}).not.toThrow();

		expect(ids).toBeDefined();
		expect(ids?.size).toBe(0);
	});
});

function rawEntryLine(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		id: "entry-x",
		schemaVersion: 1,
		ts: "2026-08-07T12:00:00.000Z",
		sessionId: "session-0001",
		author: "sdet",
		kind: "decision",
		gate: 5,
		source: "manual",
		text: "linha bruta escrita a mao para testar corrupcao",
		provenance: {},
		...overrides,
	});
}
