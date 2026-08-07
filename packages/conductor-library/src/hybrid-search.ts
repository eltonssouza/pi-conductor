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
/** Splits into lowercase tokens the same way `fts-query.ts` does, so rerank features and lexical
 * search agree on what counts as a "word". */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}_]+/u)
		.filter((token) => token.length > 0);
}

/** Fraction of `questionTokens` present (as a substring match) in `haystack`, case-insensitive.
 * `0` when there are no question tokens to match against -- never a division by zero. */
function coverage(questionTokens: readonly string[], haystack: string): number {
	if (questionTokens.length === 0) return 0;
	const lowerHaystack = haystack.toLowerCase();
	const matched = questionTokens.filter((token) => lowerHaystack.includes(token)).length;
	return matched / questionTokens.length;
}

/** Min-max normalizes `value` into `[min, max]` -> `[0, 1]`. When every candidate ties (`max ===
 * min`), the naive formula divides by zero and produces `NaN` -- this is the exact degenerate input
 * ADR §5.3/§17.2 names as a real (not hypothetical) bug. Guarded explicitly: a fully-tied set is
 * treated as uniformly at its own maximum (there is no weaker/stronger candidate to compare against),
 * never propagating `NaN`. */
function normalize(value: number, min: number, max: number): number {
	const range = max - min;
	return range === 0 ? 1 : (value - min) / range;
}

// Composite rerank weights (ADR §17.2: deterministic light rerank, NOT a cross-encoder). Not fixed by
// the docstring/ADR beyond naming the three features (lexical coverage, title match, normalized
// first-stage score) plus the RRF fusion signal itself; the library has no IR/ranking-specific
// guidance for this monorepo's stack (queried this Gate 6, only off-topic Software Construction /
// Spec-Driven Development passages returned at ~0.49-0.52 relevance -- library does not cover this).
// Chosen so the RRF consensus signal (both stages agreeing) dominates a single-stage top hit, per this
// function's own contract test, while still letting lexical coverage, title match, and the original
// first-stage score contribute.
const RRF_WEIGHT = 0.4;
const LEXICAL_COVERAGE_WEIGHT = 0.2;
const TITLE_MATCH_WEIGHT = 0.1;
const ORIGINAL_SCORE_WEIGHT = 0.3;

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
	const { rrfK, topK, threshold } = options;

	// Stage 1: reciprocal-rank fusion -- score(doc) = sum(1 / (k + rank)) over every list the doc
	// appears in (Context Engineering §4.4, k=60, rank 1-indexed).
	const rrfScores = new Map<string, number>();
	const byId = new Map<string, RetrievedPassage>();

	const accumulate = (list: readonly RetrievedPassage[]) => {
		list.forEach((passage, index) => {
			const rank = index + 1;
			const contribution = 1 / (rrfK + rank);
			rrfScores.set(passage.chunkId, (rrfScores.get(passage.chunkId) ?? 0) + contribution);
			if (!byId.has(passage.chunkId)) byId.set(passage.chunkId, passage);
		});
	};
	accumulate(lexical);
	accumulate(dense);

	const candidates = Array.from(byId.values());
	if (candidates.length === 0) return [];

	// Stage 2: light deterministic rerank over the fused set -- features the first stage did not use.
	const questionTokens = tokenize(question);

	const rrfValues = candidates.map((c) => rrfScores.get(c.chunkId) ?? 0);
	const rrfMin = Math.min(...rrfValues);
	const rrfMax = Math.max(...rrfValues);

	const originalScores = candidates.map((c) => c.score);
	const originalMin = Math.min(...originalScores);
	const originalMax = Math.max(...originalScores);

	const rescored = candidates.map((passage) => {
		const rrfNorm = normalize(rrfScores.get(passage.chunkId) ?? 0, rrfMin, rrfMax);
		const lexicalCoverage = coverage(questionTokens, passage.body);
		const titleMatch = coverage(questionTokens, `${passage.section} ${passage.source}`);
		const originalScoreNorm = normalize(passage.score, originalMin, originalMax);

		const finalScore =
			RRF_WEIGHT * rrfNorm +
			LEXICAL_COVERAGE_WEIGHT * lexicalCoverage +
			TITLE_MATCH_WEIGHT * titleMatch +
			ORIGINAL_SCORE_WEIGHT * originalScoreNorm;

		return { ...passage, score: finalScore };
	});

	// Stage 3: relevance threshold, applied AFTER fusion+rerank -- below it is DROPPED, never kept to
	// pad out topK (FR-5/BR-2, "the courage to retrieve nothing").
	const survivors = rescored.filter((passage) => passage.score >= threshold);

	// Sorted by descending final score, capped at topK.
	survivors.sort((a, b) => b.score - a.score);
	return survivors.slice(0, topK);
}
