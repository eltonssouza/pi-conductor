/**
 * The grounding ledger: append-only JSONL of `rag-query`/`rag-unreachable` events -- BORDA: fs
 * (docs/adr/0006-fase5-library-and-grounding.md D13/§16, D7/D9 for its location; Apêndice §19;
 * gate3-addendum-fase5.md R34/R35/R36).
 *
 * GATE 5 (test-first): every exported function below is a STUB that throws "not implemented" -- Gate
 * 6 implements the bodies. This file ships the WRITER and the READER's signatures
 * test/grounding-ledger.test.ts already compiles and tests against.
 *
 * Two sides, deliberately asymmetric in their failure discipline (D13, R36):
 *
 *   - The WRITER (`openGroundingLedgerWriter`) is synchronous and LANCES on I/O failure -- the exact
 *     discipline `@conductor/runtime`'s `audit-trail.ts` already documents for its own append-only
 *     writer ("a caller that writes the event and only then performs the [dependent action] gets a
 *     real ordering guarantee for free from this synchronous contract, not from a race"). A `Decision`
 *     that CLAIMS a search happened must correspond to an event this writer actually got to persist;
 *     swallowing a write failure here would let a caller believe grounding was recorded when it was
 *     not.
 *   - The READER (`openGroundingLedgerReader`) NEVER throws (R36, portng `policy-trust-store.ts`'s own
 *     `loadPolicyTrustStore` discipline to this ledger): a missing directory, an unreadable file, a
 *     corrupted line, or an event whose own `projectId` does not match the reader's `projectId` all
 *     collapse to `null` from BOTH `findQueryEvent` and `findRecentUnreachable` -- and NEITHER is ever
 *     synthesized into the other kind (an unreadable ledger is not "the backend tried and failed";
 *     it is "there is no proof of anything", so both the grounded path and the FR-17
 *     indisponibilidade escape hatch are refused, and only an explicit, attributed human override
 *     (R35(i)(b)) can still advance -- that composition lives in `@conductor/runtime`'s
 *     `recordGroundedDecision`/`recordUngroundedDecision`, in the PARALLEL Gate 5 stream, not in this
 *     file; this file only has to make "cannot resolve" observationally indistinguishable from
 *     "resolved to nothing", which is exactly what returning `null` from both methods achieves).
 *
 * The two event kinds are separate TYPES here too (D11/§14.2's "never a boolean parameter that
 * confuses the two"), mirrored on both the writer's two `append*` methods and the reader's two `find*`
 * methods.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** One retrieval hit, as the runtime actually observed it (never as a caller declares it) -- the
 * per-hit fields `GroundingCitation` (in `@conductor/runtime`) is built from once a citation resolves
 * against a `rag-query` event by this id. */
export interface RagQueryHit {
	chunkHash: string;
	source: string;
	section: string;
	path: string;
	category: string;
	score: number;
}

export interface RagQueryEventInput {
	projectId: string;
	question: string;
	enrichedQuery: string;
	mode: "hybrid" | "lexical-only";
	corpusVersion: string;
	embeddingModel: string;
	gate?: number;
	role?: string;
	topScore: number;
	hits: readonly RagQueryHit[];
}

export interface RagUnreachableEventInput {
	projectId: string;
	backend: string;
	reason: string;
}

export interface AppendedEvent {
	id: string;
	/** ISO-8601 -- never a `Date` (the same gotcha `@conductor/runtime`'s checksum code already
	 * documents for persisted state, ADR 0005 §9.2). */
	at: string;
}

export interface GroundingLedgerWriter {
	/** Appends a `rag-query` event (ADR §16.1's exact JSONL shape) and returns its assigned id/
	 * timestamp. Synchronous; THROWS on any I/O failure -- never swallows one. */
	appendQuery(input: RagQueryEventInput): AppendedEvent;
	/** Appends a `rag-unreachable` event. Same synchronous, throwing discipline as `appendQuery`. */
	appendUnreachable(input: RagUnreachableEventInput): AppendedEvent;
}

/**
 * Appends `record` (already shaped as the exact JSONL fields ADR §16.1 specifies for its `kind`) as
 * one line, stamped with a fresh `id`/`at`. Synchronous end-to-end (`appendFileSync`, mode `0o600`,
 * `flag: "a"` -- never truncates, never rewrites a prior line, mirroring `audit-trail.ts`'s
 * `createAuditTrailWriter`): by the time this returns without throwing, the line is already durable
 * on disk, so a caller performing a dependent action right after gets a real ordering guarantee from
 * this synchronous contract, not from a race. Any I/O failure (e.g. `path` resolving to a directory,
 * a blocked parent, a full disk) propagates straight out -- this function has no try/catch of its
 * own, on purpose (D13/§16.1: "swallowing a write failure here would let a caller believe grounding
 * was recorded when it was not").
 */
function appendEvent(path: string, record: Record<string, unknown>): AppendedEvent {
	const id = randomUUID();
	const at = new Date().toISOString();
	const line = `${JSON.stringify({ ...record, id, at })}\n`;
	// mkdirSync is part of the fail-closed contract, same as audit-trail.ts: if the parent exists as
	// a non-directory, this throws synchronously and execution never reaches appendFileSync.
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, line, { encoding: "utf8", mode: 0o600, flag: "a" });
	return { id, at };
}

/** Opens (creating if necessary) the append-only JSONL ledger at `path` for writing. */
export function openGroundingLedgerWriter(path: string): GroundingLedgerWriter {
	return {
		appendQuery(input: RagQueryEventInput): AppendedEvent {
			return appendEvent(path, {
				kind: "rag-query",
				projectId: input.projectId,
				question: input.question,
				enrichedQuery: input.enrichedQuery,
				mode: input.mode,
				corpusVersion: input.corpusVersion,
				embeddingModel: input.embeddingModel,
				gate: input.gate,
				role: input.role,
				topScore: input.topScore,
				hits: input.hits,
			});
		},
		appendUnreachable(input: RagUnreachableEventInput): AppendedEvent {
			return appendEvent(path, {
				kind: "rag-unreachable",
				projectId: input.projectId,
				backend: input.backend,
				reason: input.reason,
			});
		},
	};
}

/** A `rag-query` event as a reader observes it (ADR Apêndice §19's `RagQueryEventView` shape --
 * mirrored here structurally so this package's reader satisfies `@conductor/runtime`'s
 * `GroundingLedgerReader` port by shape, without importing that package). */
export interface RagQueryEventView {
	id: string;
	question: string;
	enrichedQuery: string;
	mode: "hybrid" | "lexical-only";
	corpusVersion: string;
	embeddingModel: string;
	at: string;
	hits: readonly RagQueryHit[];
}

export interface RagUnreachableEventView {
	id: string;
	backend: string;
	reason: string;
	at: string;
}

export interface GroundingLedgerReader {
	/** Never throws (R36). Returns `null` for: not found, ledger missing/unreadable, a corrupted
	 * line, or a matching id whose OWN `projectId` differs from this reader's `projectId`. */
	findQueryEvent(queryEventId: string): RagQueryEventView | null;
	/** Never throws (R36). Returns the most recent `rag-unreachable` event recorded within
	 * `windowMs` of `now`, or `null` if there is none (including every failure case above). */
	findRecentUnreachable(now: Date, windowMs: number): RagUnreachableEventView | null;
}

/** A raw JSONL record, before it is known to match the caller's query -- deliberately untyped past
 * this point (parsed JSON is `unknown` by nature); each `find*` method below picks the fields it
 * needs and casts, the same "shape-check then trust" discipline `policy-trust-store.ts`'s
 * `isTrustStoreDocument` applies to its own parsed JSON. */
interface RawLedgerEvent {
	kind?: unknown;
	id?: unknown;
	projectId?: unknown;
	[key: string]: unknown;
}

/**
 * Reads and parses every line of `path`, collapsing EVERY failure mode to an empty array rather than
 * throwing (R36, same single-try/catch-around-the-whole-read discipline `policy-trust-store.ts`'s
 * `readTrustedEntries` already uses): a missing directory, a missing file, a path that is a
 * directory instead of a file, and a permission error all fail closed identically. A corrupted
 * individual LINE (invalid JSON) is skipped on its own -- caught line-by-line -- so one bad line
 * never aborts the read of every other, valid line before and after it.
 */
function readEvents(path: string): RawLedgerEvent[] {
	try {
		if (!existsSync(path)) return [];
		if (!statSync(path).isFile()) return [];
		const raw = readFileSync(path, "utf8");
		const events: RawLedgerEvent[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (parsed !== null && typeof parsed === "object") events.push(parsed as RawLedgerEvent);
			} catch {
				// Corrupted line -- skip it, keep reading the rest (R36).
			}
		}
		return events;
	} catch {
		// Missing/unreadable directory or file, or any other unexpected fs error: fail closed to "no
		// events", never throw (R36 -- an unreadable ledger is not proof of anything, so it must be
		// indistinguishable from an empty one to every caller of this reader).
		return [];
	}
}

function toQueryView(event: RawLedgerEvent): RagQueryEventView | null {
	if (
		typeof event.id !== "string" ||
		typeof event.question !== "string" ||
		typeof event.enrichedQuery !== "string" ||
		(event.mode !== "hybrid" && event.mode !== "lexical-only") ||
		typeof event.corpusVersion !== "string" ||
		typeof event.embeddingModel !== "string" ||
		typeof event.at !== "string"
	) {
		return null;
	}
	return {
		id: event.id,
		question: event.question,
		enrichedQuery: event.enrichedQuery,
		mode: event.mode,
		corpusVersion: event.corpusVersion,
		embeddingModel: event.embeddingModel,
		at: event.at,
		hits: (Array.isArray(event.hits) ? event.hits : []) as readonly RagQueryHit[],
	};
}

function toUnreachableView(event: RawLedgerEvent): RagUnreachableEventView | null {
	if (
		typeof event.id !== "string" ||
		typeof event.backend !== "string" ||
		typeof event.reason !== "string" ||
		typeof event.at !== "string"
	) {
		return null;
	}
	return { id: event.id, backend: event.backend, reason: event.reason, at: event.at };
}

/** Opens the ledger at `path` for reading, scoped to `projectId` (R36's defense-in-depth: an event
 * whose own recorded `projectId` does not match is treated the same as not found). */
export function openGroundingLedgerReader(path: string, projectId: string): GroundingLedgerReader {
	return {
		findQueryEvent(queryEventId: string): RagQueryEventView | null {
			const match = readEvents(path).find(
				(event) => event.kind === "rag-query" && event.id === queryEventId && event.projectId === projectId,
			);
			return match ? toQueryView(match) : null;
		},
		findRecentUnreachable(now: Date, windowMs: number): RagUnreachableEventView | null {
			const candidates = readEvents(path).filter(
				(event) => event.kind === "rag-unreachable" && event.projectId === projectId,
			);

			let best: RawLedgerEvent | null = null;
			let bestAt = -Infinity;
			for (const event of candidates) {
				const at = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
				if (Number.isNaN(at)) continue;
				// D13 §16.3: only events within the fixed window count -- no permanent free pass for a
				// single old event recorded once and never revisited.
				if (now.getTime() - at > windowMs) continue;
				if (at > bestAt) {
					bestAt = at;
					best = event;
				}
			}
			return best ? toUnreachableView(best) : null;
		},
	};
}
