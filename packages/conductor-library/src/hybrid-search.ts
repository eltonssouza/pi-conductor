/**
 * Reciprocal-rank fusion + light rerank + relevance threshold -- PURE (docs/adr/0006-fase5-library-
 * and-grounding.md D14, Apêndice §19; gate2-spec-fase5.md FR-2/FR-5/BR-2).
 *
 * GATE 5 (test-first): `fuseAndRerank` is a STUB that throws "not implemented" -- Gate 6 implements
 * the body. This file ships the signature test/hybrid-search.test.ts and corpus-store.ts's caller
 * already compile and test against.
 *
 * Pipeline this function is the middle two stages of (ADR §17.1):
 *   { FTS5 bm25 top-k , cosine flat top-k } -> RRF (k=60) -> light rerank over the fused top-N ->
 *   relevance threshold -> passages.
 *
 * RRF, `k=60`: Context Engineering -- Designing Information Environments for LLM Systems §4.4
 * "Hybrid Search: Dense and Lexical Are Complements" gives `rrf_merge(dense, lexical, k=60)`
 * literally -- `score(doc) = sum(1 / (k + rank))` over every list the doc appears in, so a candidate
 * that both retrieval stages agree on outranks one only one stage found, even at the same raw rank.
 *
 * The rerank stage is DECLAREDLY NOT a cross-encoder (ADR §17.2, hardware-budget decision, `--rerank
 * cross-encoder` is the opt-in path elsewhere in the package): a deterministic, pure re-score over
 * features the first stage did not use (lexical coverage, title match, normalized first-stage
 * scores).
 *
 * The min-max normalization inside that rerank is exactly why this function's contract requires
 * finite output scores (ADR §5.3/§17.2): `(x - min) / (max - min)` has a zero denominator whenever
 * every candidate in the fused set ties -- `NaN` "by ordinary arithmetic, on an ordinary day", no
 * attacker required. Downstream, `GroundingCitation.score` is validated finite before being persisted
 * into a `GateState` whose checksum throws on any non-finite number in the WHOLE state (ADR §5.3) --
 * so a `NaN` here would not just misrank one query, it would brick every future mutation of that
 * gate's state with a checksum error that never mentions citations. This function's contract is the
 * point where that bug either gets created or gets closed.
 *
 * The threshold (FR-5/BR-2) is applied AFTER fusion+rerank, over the final score: candidates below it
 * are DROPPED, never kept to pad out `topK` with a "best of the worst" (Context Engineering §4.6
 * "Selection: Top-k, Thresholds, and the Courage to Retrieve Nothing").
 */

/** An efemeral retrieval result -- never persisted as-is (ADR Apêndice §19: "EFÊMERO -- nunca
 * persistido (é a citação que persiste)"). `tech`/`version` are the FR-4 filter facets, carried
 * through for display; they do not participate in fusion/rerank scoring. */
export interface RetrievedPassage {
	chunkId: string;
	chunkHash: string;
	body: string;
	source: string;
	section: string;
	path: string;
	category: string;
	tech?: string;
	version?: string;
	score: number;
}

export interface FuseAndRerankOptions {
	/** RRF's own constant (ADR §17.1: `k=60`, Context Engineering §4.4's literal pseudocode). */
	rrfK: number;
	/** Maximum number of passages returned, after threshold filtering. */
	topK: number;
	/** Final-score cutoff (FR-5/BR-2): a candidate scoring below this is dropped, never kept to pad
	 * `topK`. A `threshold` high enough that nothing survives yields an EMPTY array -- never an error,
	 * and never the least-bad candidates dressed up as a real result. */
	threshold: number;
}

/**
 * Fuses two independently-ranked candidate lists (lexical FTS5 bm25, dense cosine) via reciprocal-
 * rank fusion, reranks the fused set with a light deterministic feature re-score, and applies the
 * relevance threshold -- returning at most `options.topK` passages, sorted by descending final score.
 *
 * Every returned `score` MUST be finite (`Number.isFinite`) -- a tied/degenerate candidate set must
 * never propagate `NaN`/`Infinity` out of this function (ADR §5.3/§17.2; see this file's header).
 */
export function fuseAndRerank(
	lexical: readonly RetrievedPassage[],
	dense: readonly RetrievedPassage[],
	question: string,
	options: FuseAndRerankOptions,
): RetrievedPassage[] {
	throw new Error("not implemented");
}
