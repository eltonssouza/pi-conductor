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

/** Opens (creating if necessary) the append-only JSONL ledger at `path` for writing. */
export function openGroundingLedgerWriter(path: string): GroundingLedgerWriter {
	throw new Error("not implemented");
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

/** Opens the ledger at `path` for reading, scoped to `projectId` (R36's defense-in-depth: an event
 * whose own recorded `projectId` does not match is treated the same as not found). */
export function openGroundingLedgerReader(path: string, projectId: string): GroundingLedgerReader {
	throw new Error("not implemented");
}
