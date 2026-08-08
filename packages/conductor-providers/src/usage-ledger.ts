/**
 * `UsageLedgerWriter`/`UsageLedgerReader` -- R52/T71/D9 (docs/adr/0008-fase7-model-routing-and-
 * providers.md §11.2): the usage/cost ledger, molde VERBATIM from
 * `packages/conductor-library/src/grounding-ledger.ts` (ADR 0006 D13, cited directly by §11.2) -- same
 * asymmetric failure discipline:
 *
 *   - The WRITER (`openUsageLedgerWriter`) is SYNCHRONOUS and THROWS on a real I/O failure -- never
 *     swallows one. A `UsageRecord` that claims a call happened must correspond to a line this writer
 *     actually got to persist.
 *   - The READER (`openUsageLedgerReader`) NEVER throws: a missing directory, an unreadable file, a
 *     corrupted line, or a record whose own `projectId` does not match the reader's `projectId` all
 *     collapse to being excluded from `totals()` -- never abort the whole read.
 *   - `costUsd: number | null` -- `null` is the ONLY "unknown" value (BR-10/F1). A single matching
 *     record with an unknown price collapses the AGGREGATE `costUsd` to `null` too (never partially
 *     summed and never silently treated as zero) -- disclosed instead via `unpricedCalls`, so a caller
 *     sees "N calls of unknown cost" rather than a total that quietly under-counts.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageRecord } from "./types.ts";

export interface UsageLedgerWriter {
	/** Synchronous; THROWS on any real I/O failure -- never swallows one (same discipline as
	 * `grounding-ledger.ts`'s `appendQuery`/`appendUnreachable`). */
	append(record: Omit<UsageRecord, "id" | "at">): { id: string; at: string };
}

export function openUsageLedgerWriter(path: string): UsageLedgerWriter {
	return {
		append(record: Omit<UsageRecord, "id" | "at">): { id: string; at: string } {
			const id = randomUUID();
			const at = new Date().toISOString();
			const line = `${JSON.stringify({ ...record, id, at })}\n`;
			// mkdirSync is part of the fail-closed contract, same as grounding-ledger.ts: if the parent
			// exists as a non-directory, this throws synchronously and execution never reaches appendFileSync.
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, line, { encoding: "utf8", mode: 0o600, flag: "a" });
			return { id, at };
		},
	};
}

export interface UsageLedgerReader {
	/** NEVER throws: ausente/corrompido collapses to zeroed totals + `costUsd: null` (R52). */
	totals(filter: { gate?: number; role?: string; since?: Date }): {
		tokens: UsageRecord["tokens"];
		costUsd: number | null;
		unpricedCalls: number;
	};
}

interface RawUsageRecord {
	projectId?: unknown;
	gate?: unknown;
	role?: unknown;
	at?: unknown;
	tokens?: unknown;
	costUsd?: unknown;
	[key: string]: unknown;
}

/** Reads and parses every line of `path`, collapsing EVERY failure mode to an empty array rather than
 * throwing (R52, same single-try/catch-around-the-whole-read discipline as `grounding-ledger.ts`'s
 * `readEvents`): a missing directory, a missing file, a path that is a directory instead of a file, and a
 * permission error all fail closed identically. A corrupted individual LINE (invalid JSON) is skipped on
 * its own, so one bad line never aborts the read of every other valid line before and after it. */
function readRecords(path: string): RawUsageRecord[] {
	try {
		if (!existsSync(path)) return [];
		if (!statSync(path).isFile()) return [];
		const raw = readFileSync(path, "utf8");
		const records: RawUsageRecord[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (parsed !== null && typeof parsed === "object") records.push(parsed as RawUsageRecord);
			} catch {
				// Corrupted line -- skip it, keep reading the rest (R52).
			}
		}
		return records;
	} catch {
		// Missing/unreadable directory or file, or any other unexpected fs error: fail closed to "no
		// records", never throw.
		return [];
	}
}

function matchesFilter(
	record: RawUsageRecord,
	projectId: string,
	filter: { gate?: number; role?: string; since?: Date },
): boolean {
	if (record.projectId !== projectId) return false; // R36-style defense in depth.
	if (filter.gate !== undefined && record.gate !== filter.gate) return false;
	if (filter.role !== undefined && record.role !== filter.role) return false;
	if (filter.since !== undefined) {
		const at = typeof record.at === "string" ? Date.parse(record.at) : Number.NaN;
		if (Number.isNaN(at) || at < filter.since.getTime()) return false;
	}
	return true;
}

function recordTokens(record: RawUsageRecord): UsageRecord["tokens"] {
	const tokens = record.tokens as Partial<UsageRecord["tokens"]> | undefined;
	return {
		input: typeof tokens?.input === "number" ? tokens.input : 0,
		output: typeof tokens?.output === "number" ? tokens.output : 0,
		cacheRead: typeof tokens?.cacheRead === "number" ? tokens.cacheRead : 0,
		cacheWrite: typeof tokens?.cacheWrite === "number" ? tokens.cacheWrite : 0,
	};
}

export function openUsageLedgerReader(path: string, projectId: string): UsageLedgerReader {
	return {
		totals(filter: { gate?: number; role?: string; since?: Date }) {
			const matching = readRecords(path).filter((record) => matchesFilter(record, projectId, filter));

			const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
			let costUsd: number | null = 0;
			let unpricedCalls = 0;
			let any = false;

			for (const record of matching) {
				any = true;
				const recordTokensValue = recordTokens(record);
				tokens.input += recordTokensValue.input;
				tokens.output += recordTokensValue.output;
				tokens.cacheRead += recordTokensValue.cacheRead;
				tokens.cacheWrite += recordTokensValue.cacheWrite;

				if (typeof record.costUsd === "number") {
					if (costUsd !== null) costUsd += record.costUsd;
				} else {
					// BR-10/F1: a single unknown-price record collapses the AGGREGATE to "unknown" too --
					// never a partial sum that quietly excludes it, never zero.
					costUsd = null;
					unpricedCalls += 1;
				}
			}

			return { tokens, costUsd: any ? costUsd : null, unpricedCalls };
		},
	};
}
