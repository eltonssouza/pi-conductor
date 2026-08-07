/**
 * Test-first (Gate 5) for R52/T71 (ADR 0008-fase7-model-routing-and-providers.md §11/D9): the usage/cost
 * ledger. Molde verbatim from `grounding-ledger.ts` (ADR 0006 D13, cited directly by §11.2): writer is
 * SYNCHRONOUS and THROWS on real I/O failure; reader NEVER throws -- missing/corrupted collapses to
 * costUsd: null (the ONLY "unknown" value; BR-10/F1 -- zero means zero, never invented). Real fs I/O
 * against real scratch files, including a deliberately corrupted line -- mirrors
 * packages/conductor-library/test/grounding-ledger.test.ts's own fixture/tmpdir pattern, per the task's
 * explicit instruction to reuse it.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openUsageLedgerReader, openUsageLedgerWriter, type UsageRecord } from "../src/index.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

const PROJECT_ID = "project0000000001";

let workspace: ScratchWorkspace;

afterEach(() => {
	workspace?.cleanup();
});

function sampleRecord(overrides: Partial<Omit<UsageRecord, "id" | "at">> = {}): Omit<UsageRecord, "id" | "at"> {
	return {
		projectId: PROJECT_ID,
		gate: 9,
		gateModelRole: "slow",
		provider: "anthropic",
		modelId: "claude-opus-test",
		tokens: { input: 1200, output: 340, cacheRead: 0, cacheWrite: 0 },
		costUsd: 0.0123,
		priced: {
			known: true,
			source: "vendor-catalog",
			rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		},
		...overrides,
	};
}

describe("UsageLedgerWriter (R52: append-only JSONL, synchronous, throws on real I/O failure)", () => {
	it("appends a usage record, returning a generated id and ISO-8601 timestamp", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		const writer = openUsageLedgerWriter(ledgerPath);

		const appended = writer.append(sampleRecord());

		expect(appended.id).toEqual(expect.any(String));
		expect(appended.at).toEqual(expect.any(String));
		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(1);
		const record = JSON.parse(lines[0]!);
		expect(record).toMatchObject({
			id: appended.id,
			at: appended.at,
			projectId: PROJECT_ID,
			provider: "anthropic",
			modelId: "claude-opus-test",
			costUsd: 0.0123,
		});
	});

	it("is append-only: multiple writes accumulate as separate lines, in order, never truncating earlier ones", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		const writer = openUsageLedgerWriter(ledgerPath);

		writer.append(sampleRecord({ gate: 3 }));
		writer.append(sampleRecord({ gate: 5 }));
		writer.append(sampleRecord({ gate: 9 }));

		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[0]!).gate).toBe(3);
		expect(JSON.parse(lines[1]!).gate).toBe(5);
		expect(JSON.parse(lines[2]!).gate).toBe(9);
	});

	it("records costUsd: null (never 0) when priced.known is false -- an absent price is reported, never invented (BR-10/F1)", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		const writer = openUsageLedgerWriter(ledgerPath);

		writer.append(
			sampleRecord({
				costUsd: null,
				priced: { known: false, reason: "declared-without-cost" },
				modelId: "custom-model-without-cost",
			}),
		);

		const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
		const record = JSON.parse(lines[0]!);
		expect(record.costUsd).toBeNull();
		expect(record.priced).toEqual({ known: false, reason: "declared-without-cost" });
	});

	it("throws on a genuine I/O failure instead of silently dropping the record (same discipline as grounding-ledger.ts)", () => {
		workspace = createScratchWorkspace();
		const ledgerPathThatIsActuallyADirectory = join(workspace.root, "usage.jsonl");
		mkdirSync(ledgerPathThatIsActuallyADirectory);

		let caught: unknown;
		try {
			const writer = openUsageLedgerWriter(ledgerPathThatIsActuallyADirectory);
			writer.append(sampleRecord());
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(Error);
		// Must be a genuine I/O failure (e.g. EISDIR), not this Gate-5 stream's own module-not-found --
		// guards against this test accidentally "passing" once src/ exists, for the wrong reason.
		expect((caught as Error).message).not.toMatch(/not implemented/i);
	});
});

describe("UsageLedgerReader.totals (R52: never throws; missing/corrupted collapses to costUsd: null, never 0)", () => {
	function writeRawLines(ledgerPath: string, lines: string[]): void {
		mkdirSync(join(ledgerPath, ".."), { recursive: true });
		writeFileSync(ledgerPath, `${lines.join("\n")}\n`);
	}

	function rawRecordLine(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			id: "usage-1",
			at: "2026-08-07T00:00:00.000Z",
			projectId: PROJECT_ID,
			gate: 9,
			gateModelRole: "slow",
			provider: "anthropic",
			modelId: "claude-opus-test",
			tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
			costUsd: 0.01,
			priced: {
				known: true,
				source: "vendor-catalog",
				rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
			},
			...overrides,
		});
	}

	it("sums tokens and cost across matching records for a real, well-formed ledger", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		writeRawLines(ledgerPath, [
			rawRecordLine({
				id: "usage-1",
				costUsd: 0.01,
				tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
			}),
			rawRecordLine({
				id: "usage-2",
				costUsd: 0.02,
				tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 },
			}),
		]);
		const reader = openUsageLedgerReader(ledgerPath, PROJECT_ID);

		const totals = reader.totals({ gate: 9 });

		expect(totals.costUsd).toBeCloseTo(0.03, 6);
		expect(totals.tokens.input).toBe(1500);
		expect(totals.tokens.output).toBe(300);
		expect(totals.unpricedCalls).toBe(0);
	});

	it("collapses costUsd to null (never 0) when at least one matching record has an unknown price -- an unpriced call is disclosed via unpricedCalls, never averaged away", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		writeRawLines(ledgerPath, [
			rawRecordLine({ id: "usage-1", costUsd: 0.01 }),
			rawRecordLine({
				id: "usage-2",
				costUsd: null,
				priced: { known: false, reason: "declared-without-cost" },
				modelId: "custom-model-without-cost",
			}),
		]);
		const reader = openUsageLedgerReader(ledgerPath, PROJECT_ID);

		const totals = reader.totals({ gate: 9 });

		expect(totals.costUsd).toBeNull();
		expect(totals.unpricedCalls).toBe(1);
	});

	it("returns a zeroed, non-throwing result when the ledger file/directory does not exist at all", () => {
		workspace = createScratchWorkspace();
		const missingPath = join(workspace.root, "projects", "nope", "usage.jsonl");
		const reader = openUsageLedgerReader(missingPath, PROJECT_ID);

		expect(() => reader.totals({})).not.toThrow();
		const totals = reader.totals({});
		expect(totals.costUsd).toBeNull();
		expect(totals.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	it("skips a corrupted line and still totals the valid records before AND after it, never aborting the whole read (same discipline as grounding-ledger.ts's reader)", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		writeRawLines(ledgerPath, [
			rawRecordLine({ id: "usage-1", costUsd: 0.01 }),
			"{ this is not valid JSON at all ///",
			rawRecordLine({ id: "usage-3", costUsd: 0.02 }),
		]);
		const reader = openUsageLedgerReader(ledgerPath, PROJECT_ID);

		expect(() => reader.totals({})).not.toThrow();
		const totals = reader.totals({});
		expect(totals.costUsd).toBeCloseTo(0.03, 6);
	});

	it("never throws even against a ledger file that is not JSONL at all (garbage content)", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		mkdirSync(join(ledgerPath, ".."), { recursive: true });
		writeFileSync(ledgerPath, "\x00\x01binary garbage, not text at all\xff\xfe");
		const reader = openUsageLedgerReader(ledgerPath, PROJECT_ID);

		expect(() => reader.totals({})).not.toThrow();
		expect(reader.totals({}).costUsd).toBeNull();
	});

	it("R36-style defense-in-depth: a record's OWN recorded projectId differing from the reader's projectId is excluded from totals", () => {
		workspace = createScratchWorkspace();
		const ledgerPath = join(workspace.root, "usage.jsonl");
		writeRawLines(ledgerPath, [rawRecordLine({ id: "usage-1", projectId: "some-other-project", costUsd: 0.5 })]);
		const reader = openUsageLedgerReader(ledgerPath, PROJECT_ID);

		const totals = reader.totals({});

		expect(totals.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});
});
