/**
 * Test-first (Gate 5) for `fuseAndRerank` (src/hybrid-search.ts) -- ADR 0006 D14/§17, FR-2/FR-5,
 * BR-2.
 *
 * `fuseAndRerank` is currently a STUB that throws "not implemented" -- every test below fails RED for
 * that one reason today (Gate 6 implements the body).
 *
 * No real embeddings/Ollama/SQLite anywhere in this file: `fuseAndRerank` is declared PURE (ADR
 * §11.1) precisely so RRF, the threshold, and the min-max normalization guard are testable against
 * synthetic candidate lists, which is what every test below does.
 */
import { describe, expect, it } from "vitest";
import { fuseAndRerank, type RetrievedPassage } from "../src/hybrid-search.ts";

function passage(overrides: Partial<RetrievedPassage> & Pick<RetrievedPassage, "chunkId" | "score">): RetrievedPassage {
	return {
		chunkHash: `hash-${overrides.chunkId}`,
		body: "placeholder body",
		source: "Some Book",
		section: "Some Section",
		path: "some/path.md",
		category: "architecture",
		...overrides,
	};
}

describe("fuseAndRerank (D14/FR-2: reciprocal-rank fusion, k=60)", () => {
	it("ranks a candidate BOTH retrieval stages agree on above one only a single stage found, even at similar raw rank", () => {
		// "consensus" is rank 1 in BOTH lists: RRF score = 1/(60+1) + 1/(60+1).
		// "dense-only" is rank 1 in the dense list alone: RRF score = 1/(60+1).
		// "lexical-only" is rank 1 in the lexical list alone: RRF score = 1/(60+1).
		// Regardless of the secondary light-rerank stage, consensus's fused signal from BOTH stages
		// must not lose to a single-stage top hit under any reasonable feature weighting when the
		// underlying content signals are held equal (bodies below are deliberately near-identical).
		const consensus = passage({ chunkId: "consensus", score: 0.9, body: "the bulkhead pattern isolates failures" });
		const denseOnly = passage({ chunkId: "dense-only", score: 0.9, body: "the bulkhead pattern isolates failures" });
		const lexicalOnly = passage({
			chunkId: "lexical-only",
			score: 0.9,
			body: "the bulkhead pattern isolates failures",
		});

		const lexical: RetrievedPassage[] = [consensus, lexicalOnly];
		const dense: RetrievedPassage[] = [consensus, denseOnly];

		const result = fuseAndRerank(lexical, dense, "bulkhead pattern", { rrfK: 60, topK: 10, threshold: 0 });

		expect(result.length).toBeGreaterThan(0);
		const consensusIndex = result.findIndex((p) => p.chunkId === "consensus");
		const denseOnlyIndex = result.findIndex((p) => p.chunkId === "dense-only");
		expect(consensusIndex).toBeGreaterThanOrEqual(0);
		expect(denseOnlyIndex).toBeGreaterThanOrEqual(0);
		expect(consensusIndex).toBeLessThan(denseOnlyIndex);
	});

	it("includes candidates contributed by EITHER stage, not just the winner of one (fusion actually happened)", () => {
		const lexical: RetrievedPassage[] = [passage({ chunkId: "lex-1", score: 0.8 })];
		const dense: RetrievedPassage[] = [passage({ chunkId: "dense-1", score: 0.8 })];

		const result = fuseAndRerank(lexical, dense, "some question", { rrfK: 60, topK: 10, threshold: 0 });

		const ids = result.map((p) => p.chunkId).sort();
		expect(ids).toEqual(["dense-1", "lex-1"]);
	});

	it("FR-5/BR-2: drops a candidate scoring below the threshold instead of padding topK with it", () => {
		const strong = passage({ chunkId: "strong", score: 0.95 });
		const weak = passage({ chunkId: "weak", score: 0.05 });

		const result = fuseAndRerank([strong, weak], [], "some question", { rrfK: 60, topK: 10, threshold: 0.5 });

		expect(result.map((p) => p.chunkId)).not.toContain("weak");
	});

	it('FR-5/BR-2: "the courage to retrieve nothing" -- an unreachable threshold returns an EMPTY array, never the least-bad candidates', () => {
		const candidates = [
			passage({ chunkId: "a", score: 0.4 }),
			passage({ chunkId: "b", score: 0.3 }),
			passage({ chunkId: "c", score: 0.2 }),
		];

		const result = fuseAndRerank(candidates, [], "some question", { rrfK: 60, topK: 10, threshold: 0.999 });

		expect(result).toEqual([]);
	});

	it("never returns a topK longer than requested, even with more qualifying candidates available", () => {
		const many = Array.from({ length: 20 }, (_, i) => passage({ chunkId: `c${i}`, score: 0.9 }));

		const result = fuseAndRerank(many, [], "some question", { rrfK: 60, topK: 5, threshold: 0 });

		expect(result.length).toBeLessThanOrEqual(5);
	});

	it("ADR §5.3/§17.2: a fully-tied candidate set never propagates NaN/Infinity out of the min-max normalization", () => {
		// Every candidate ties exactly -- max - min == 0, the exact degenerate input that makes a naive
		// min-max normalization divide by zero. This is the regression this ADR names explicitly: "the
		// finiteness guard is not defense against a hypothetical attacker, it is defense against THIS
		// bug" (§17.2).
		const tied = [
			passage({ chunkId: "a", score: 0.5 }),
			passage({ chunkId: "b", score: 0.5 }),
			passage({ chunkId: "c", score: 0.5 }),
		];

		expect(() => fuseAndRerank(tied, tied, "some question", { rrfK: 60, topK: 10, threshold: 0 })).not.toThrow();

		const result = fuseAndRerank(tied, tied, "some question", { rrfK: 60, topK: 10, threshold: 0 });
		for (const candidate of result) {
			expect(Number.isFinite(candidate.score)).toBe(true);
		}
	});
});
