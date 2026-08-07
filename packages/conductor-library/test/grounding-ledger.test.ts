/**
 * Test-first (Gate 5) for the grounding ledger's WRITER and READER (src/grounding-ledger.ts) -- ADR
 * 0006 D13/§16, D7/D9 for its location, Apêndice §19; gate3-addendum-fase5.md R34/R35/R36.
 *
 * Every function under test is currently a STUB that throws "not implemented" -- every test below
 * fails RED for that one reason today (Gate 6 implements the bodies).
 *
 * These are the REAL implementations under test (real fs I/O against real scratch files, including a
 * deliberately corrupted line) -- the DIFFERENT test, in the PARALLEL Gate 5 stream scoped to
 * `@conductor/runtime`, exercises `recordGroundedDecision`/`recordUngroundedDecision` against a FAKE
 * `GroundingLedgerReader` instead; this file is what proves that fake's real counterpart actually
 * behaves the way that other test assumes.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	openGroundingLedgerReader,
	openGroundingLedgerWriter,
	type RagQueryEventInput,
	type RagUnreachableEventInput,
} from "../src/grounding-ledger.ts";

const scratchDirs: string[] = [];

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-library-ledger-"));
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

function sampleQueryInput(overrides: Partial<RagQueryEventInput> = {}): RagQueryEventInput {
	return {
		projectId: PROJECT_ID,
		question: "how should credentials be handled?",
		enrichedQuery: "no contexto de um projeto backend Python... how should credentials be handled?",
		mode: "hybrid",
		corpusVersion: "2026.08.01",
		embeddingModel: "bge-m3",
		gate: 3,
		role: "security-engineer",
		topScore: 0.736,
		hits: [
			{
				chunkHash: "sha256:abc123",
				source: "Security Engineering Principles",
				section: "2.9 Fail Safely",
				path: "17_security/security-engineering.md",
				category: "security_and_privacy",
				score: 0.736,
			},
		],
		...overrides,
	};
}

function sampleUnreachableInput(overrides: Partial<RagUnreachableEventInput> = {}): RagUnreachableEventInput {
	return {
		projectId: PROJECT_ID,
		backend: "embeddings",
		reason: "connect ECONNREFUSED 127.0.0.1:11434",
		...overrides,
	};
}

describe("GroundingLedgerWriter (D13/§16.1: append-only JSONL, synchronous, throws on I/O failure)", () => {
	it("appends a rag-query event with the exact fields ADR §16.1 specifies", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		const writer = openGroundingLedgerWriter(ledgerPath);

		const appended = writer.appendQuery(sampleQueryInput());

		expect(appended.id).toEqual(expect.any(String));
		expect(appended.at).toEqual(expect.any(String));
		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(1);
		const record = JSON.parse(lines[0]!);
		expect(record).toMatchObject({
			kind: "rag-query",
			id: appended.id,
			projectId: PROJECT_ID,
			question: "how should credentials be handled?",
			mode: "hybrid",
			corpusVersion: "2026.08.01",
			embeddingModel: "bge-m3",
			gate: 3,
			role: "security-engineer",
			topScore: 0.736,
			at: appended.at,
		});
		expect(record.hits).toEqual([expect.objectContaining({ chunkHash: "sha256:abc123", score: 0.736 })]);
	});

	it("appends a rag-unreachable event with the exact fields ADR §16.1 specifies", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		const writer = openGroundingLedgerWriter(ledgerPath);

		const appended = writer.appendUnreachable(sampleUnreachableInput());

		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(1);
		const record = JSON.parse(lines[0]!);
		expect(record).toMatchObject({
			kind: "rag-unreachable",
			id: appended.id,
			projectId: PROJECT_ID,
			backend: "embeddings",
			reason: "connect ECONNREFUSED 127.0.0.1:11434",
			at: appended.at,
		});
	});

	it("is append-only: multiple writes accumulate as separate lines, in order, never truncating earlier ones", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		const writer = openGroundingLedgerWriter(ledgerPath);

		writer.appendQuery(sampleQueryInput({ question: "first question" }));
		writer.appendUnreachable(sampleUnreachableInput({ reason: "first failure" }));
		writer.appendQuery(sampleQueryInput({ question: "third question" }));

		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[0]!).question).toBe("first question");
		expect(JSON.parse(lines[1]!).reason).toBe("first failure");
		expect(JSON.parse(lines[2]!).question).toBe("third question");
	});

	it("is synchronous: the written line is already on disk immediately after append returns, no await needed", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		const writer = openGroundingLedgerWriter(ledgerPath);

		writer.appendQuery(sampleQueryInput());

		// Reading back synchronously, in the same call stack, must already see the line -- proving
		// this is not buffered/async under the hood.
		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(1);
	});

	it("throws on a genuine I/O failure instead of silently dropping the event (same discipline as audit-trail.ts)", () => {
		const dir = scratchDir();
		const ledgerPathThatIsActuallyADirectory = join(dir, "events.jsonl");
		mkdirSync(ledgerPathThatIsActuallyADirectory);

		let caught: unknown;
		try {
			const writer = openGroundingLedgerWriter(ledgerPathThatIsActuallyADirectory);
			writer.appendQuery(sampleQueryInput());
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(Error);
		// Must be a genuine I/O failure (e.g. EISDIR), not this Gate-5 stub's own "not implemented"
		// placeholder -- guards against this test accidentally passing today for the wrong reason,
		// merely because the stub also throws.
		expect((caught as Error).message).not.toMatch(/not implemented/i);
	});
});

describe("GroundingLedgerReader (R36: never throws; every failure collapses to null, on BOTH methods)", () => {
	function writeRawLines(ledgerPath: string, lines: string[]): void {
		mkdirSync(join(ledgerPath, ".."), { recursive: true });
		writeFileSync(ledgerPath, `${lines.join("\n")}\n`);
	}

	function rawQueryLine(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			kind: "rag-query",
			id: "event-1",
			projectId: PROJECT_ID,
			question: "how should credentials be handled?",
			enrichedQuery: "enriched: how should credentials be handled?",
			mode: "hybrid",
			corpusVersion: "2026.08.01",
			embeddingModel: "bge-m3",
			gate: 3,
			role: "security-engineer",
			topScore: 0.736,
			hits: [
				{
					chunkHash: "sha256:abc123",
					source: "Security Engineering Principles",
					section: "2.9 Fail Safely",
					path: "17_security/security-engineering.md",
					category: "security_and_privacy",
					score: 0.736,
				},
			],
			at: "2026-08-06T12:00:00.000Z",
			...overrides,
		});
	}

	function rawUnreachableLine(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			kind: "rag-unreachable",
			id: "unreachable-1",
			projectId: PROJECT_ID,
			backend: "embeddings",
			reason: "connect ECONNREFUSED 127.0.0.1:11434",
			at: "2026-08-06T12:00:00.000Z",
			...overrides,
		});
	}

	it("resolves an existing rag-query event by id, scoped to the reader's own projectId", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		writeRawLines(ledgerPath, [rawQueryLine()]);
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		const view = reader.findQueryEvent("event-1");

		expect(view).toMatchObject({ id: "event-1", question: "how should credentials be handled?", mode: "hybrid" });
	});

	it("returns null (not throw) for an id that does not exist in the ledger", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		writeRawLines(ledgerPath, [rawQueryLine()]);
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		expect(reader.findQueryEvent("never-recorded")).toBeNull();
	});

	it("returns null (not throw) when the ledger file/directory does not exist at all", () => {
		const missingPath = join(scratchDir(), "projects", "nope", "events.jsonl");
		const reader = openGroundingLedgerReader(missingPath, PROJECT_ID);

		expect(() => reader.findQueryEvent("event-1")).not.toThrow();
		expect(reader.findQueryEvent("event-1")).toBeNull();
		expect(() => reader.findRecentUnreachable(new Date(), 15 * 60_000)).not.toThrow();
		expect(reader.findRecentUnreachable(new Date(), 15 * 60_000)).toBeNull();
	});

	it("skips a corrupted line and still resolves valid events before AND after it, never aborting the whole read", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		writeRawLines(ledgerPath, [
			rawQueryLine({ id: "event-1" }),
			"{ this is not valid JSON at all ///",
			rawQueryLine({ id: "event-3", question: "a different question" }),
		]);
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		expect(reader.findQueryEvent("event-1")).toMatchObject({ id: "event-1" });
		expect(reader.findQueryEvent("event-3")).toMatchObject({ id: "event-3", question: "a different question" });
	});

	it("R36 defense-in-depth: returns null when a matching id's OWN recorded projectId differs from the reader's projectId", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		writeRawLines(ledgerPath, [rawQueryLine({ id: "event-1", projectId: "some-other-project" })]);
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		expect(reader.findQueryEvent("event-1")).toBeNull();
	});

	it("findRecentUnreachable returns the event when it falls within the window", () => {
		const now = new Date("2026-08-06T12:10:00.000Z");
		const ledgerPath = join(scratchDir(), "events.jsonl");
		writeRawLines(ledgerPath, [rawUnreachableLine({ at: "2026-08-06T12:05:00.000Z" })]);
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		const view = reader.findRecentUnreachable(now, 15 * 60_000);

		expect(view).toMatchObject({ backend: "embeddings" });
	});

	it("findRecentUnreachable returns null when the only event is OUTSIDE the window (D13 §16.3: no permanent free pass)", () => {
		const now = new Date("2026-08-06T12:30:00.000Z");
		const ledgerPath = join(scratchDir(), "events.jsonl");
		// 20 minutes before `now`, outside a 15-minute window.
		writeRawLines(ledgerPath, [rawUnreachableLine({ at: "2026-08-06T12:10:00.000Z" })]);
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		expect(reader.findRecentUnreachable(now, 15 * 60_000)).toBeNull();
	});

	it("never throws even against a ledger file that is not JSONL at all (garbage content)", () => {
		const ledgerPath = join(scratchDir(), "events.jsonl");
		mkdirSync(join(ledgerPath, ".."), { recursive: true });
		writeFileSync(ledgerPath, "\x00\x01binary garbage, not text at all\xff\xfe");
		const reader = openGroundingLedgerReader(ledgerPath, PROJECT_ID);

		expect(() => reader.findQueryEvent("anything")).not.toThrow();
		expect(reader.findQueryEvent("anything")).toBeNull();
	});
});
