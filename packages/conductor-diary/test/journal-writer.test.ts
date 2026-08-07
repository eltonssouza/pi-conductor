/**
 * Test-first (Gate 5) for the journal WRITER (src/journal-writer.ts) -- ADR
 * 0007-fase6-diary-and-capture.md D1/§3.1, D7/§8, D8/§10, §16.
 *
 * `openJournalWriter` is currently a STUB that throws "not implemented" -- every test below fails RED
 * for that one reason today (Gate 6 implements the body).
 *
 * These are REAL fs I/O tests against real scratch files -- the same style
 * `conductor-library/test/grounding-ledger.test.ts` already established for the sibling append-only log
 * this writer is modeled on.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JournalAddInput } from "../src/journal-entry.ts";
import { openJournalWriter } from "../src/journal-writer.ts";

const scratchDirs: string[] = [];

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-diary-writer-"));
	scratchDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (scratchDirs.length > 0) {
		const dir = scratchDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function sampleAddInput(overrides: Partial<JournalAddInput> = {}): JournalAddInput {
	return {
		kind: "decision",
		text: "usa JSONL append-only como fonte de verdade, indice SQLite como view derivada",
		sessionId: "session-0001",
		author: "sdet",
		gate: 5,
		source: "manual",
		...overrides,
	};
}

describe("JournalWriter.append (D1/§3.2, §16: mints id/schemaVersion/ts/provenance, throws on I/O failure)", () => {
	it("mints its own id, never one supplied by the caller (FR-4/BR-8) -- JournalAddInput carries no id field at all", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);

		const entry = writer.append(sampleAddInput());

		expect(entry.id).toEqual(expect.any(String));
		expect(entry.id.length).toBeGreaterThan(0);
	});

	it("stamps schemaVersion 1 and an ISO-8601 ts string, never a Date (the Fase-4 canonicalizer trap)", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);

		const entry = writer.append(sampleAddInput());

		expect(entry.schemaVersion).toBe(1);
		expect(entry.ts).toEqual(expect.any(String));
		expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
	});

	it("carries the input's own kind/text/sessionId/author/gate/source through unchanged", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const input = sampleAddInput({ kind: "error", text: "o index corrompeu em teste local", gate: 7 });

		const entry = writer.append(input);

		expect(entry).toMatchObject({
			kind: "error",
			text: "o index corrompeu em teste local",
			sessionId: input.sessionId,
			author: input.author,
			gate: 7,
			source: "manual",
		});
	});

	it("fills provenance best-effort and never throws merely because it is run outside a git repository (BR-3/FR-3)", () => {
		const dir = scratchDir();
		const entriesPath = join(dir, "entries.jsonl");
		const writer = openJournalWriter(entriesPath);

		// `dir` is a fresh OS temp directory with no .git ancestor -- chdir into it so any real Gate-6
		// git resolution genuinely fails to resolve, instead of coincidentally resolving against this
		// monorepo's own repo just because the test process's original cwd happens to be inside it. Not
		// a mock: this is the real "git does not resolve" condition BR-3/FR-3 describes, restored
		// afterwards (try/finally) so it never leaks into another test.
		const originalCwd = process.cwd();
		process.chdir(dir);
		let entry: ReturnType<typeof writer.append> | undefined;
		try {
			expect(() => {
				entry = writer.append(sampleAddInput());
			}).not.toThrow();
		} finally {
			process.chdir(originalCwd);
		}

		expect(entry).toBeDefined();
		expect(entry?.provenance).toBeTypeOf("object");
		for (const field of ["branch", "sha", "repo"] as const) {
			const value = entry?.provenance[field];
			if (value !== undefined) expect(value).toEqual(expect.any(String));
		}
	});

	it("is append-only and synchronous, with no lock/CAS in its contract (D1/§3.4): returns a plain JournalEntry, not a Promise, and multiple writes accumulate as separate lines, already durable with no await needed", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);

		const first = writer.append(sampleAddInput({ text: "first" }));
		writer.append(sampleAddInput({ text: "second" }));
		writer.append(sampleAddInput({ text: "third" }));

		expect(first).not.toBeInstanceOf(Promise);
		const lines = readFileSync(entriesPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[0]!).text).toBe("first");
		expect(JSON.parse(lines[1]!).text).toBe("second");
		expect(JSON.parse(lines[2]!).text).toBe("third");
	});

	it("throws on a genuine I/O failure instead of silently dropping the entry (same discipline as grounding-ledger.ts)", () => {
		const dir = scratchDir();
		const entriesPathThatIsActuallyADirectory = join(dir, "entries.jsonl");
		mkdirSync(entriesPathThatIsActuallyADirectory);

		let caught: unknown;
		try {
			const writer = openJournalWriter(entriesPathThatIsActuallyADirectory);
			writer.append(sampleAddInput());
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(Error);
		// Must be a genuine I/O failure (e.g. EISDIR), not this Gate-5 stub's own "not implemented"
		// placeholder -- guards against this test accidentally passing today for the wrong reason,
		// merely because the stub also throws (the same guard grounding-ledger.test.ts uses).
		expect((caught as Error).message).not.toMatch(/not implemented/i);
	});
});

describe("JournalWriter.supersede (D7/§8.1: append-only correction, never a mutation)", () => {
	it("on success, appends a NEW record that supersedes the original, carries the new text/mode, and inherits sessionId/gate/kind/author from the original", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const original = writer.append(
			sampleAddInput({ kind: "plan", sessionId: "session-xyz", author: "tech-lead", gate: 4 }),
		);

		const result = writer.supersede(original.id, "texto corrigido apos revisao", "update");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok:true");
		expect(result.entry.id).not.toBe(original.id);
		expect(result.entry.supersedes).toBe(original.id);
		expect(result.entry.editMode).toBe("update");
		expect(result.entry.text).toBe("texto corrigido apos revisao");
		expect(result.entry.sessionId).toBe(original.sessionId);
		expect(result.entry.gate).toBe(original.gate);
		expect(result.entry.kind).toBe(original.kind);
		expect(result.entry.author).toBe(original.author);
	});

	it("appends the correction as a new line, never rewriting/truncating the original's line", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const original = writer.append(sampleAddInput());

		writer.supersede(original.id, "corrigido", "invalidate");

		const lines = readFileSync(entriesPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]!).id).toBe(original.id);
	});

	it("refuses an originalId this log has never recorded, WITHOUT throwing (the KeyError analogue, edge case 6)", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		writer.append(sampleAddInput()); // some unrelated entry exists, but not the id below

		let result: ReturnType<typeof writer.supersede> | undefined;
		expect(() => {
			result = writer.supersede("never-recorded-id", "texto", "forget");
		}).not.toThrow();

		expect(result).toEqual({ ok: false, kind: "unknown-entry", id: "never-recorded-id" });
	});
});
