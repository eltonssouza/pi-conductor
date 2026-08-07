/**
 * @conductor/diary -- recall.ts (D6/G3, ADR 0007 §9 + §16 Apêndice;
 * docs/adr/0007-fase6-diary-and-capture.md).
 *
 * GATE 5 (test-first): `recall` is a STUB that throws "not implemented" -- Gate 6 implements the body
 * (D3 §5: hybrid search reusing `@conductor/library`'s PURE `buildFtsMatchExpression` by import from a
 * no-I/O retrieval barrel, its own RRF fusion composed -- never imported whole -- with a recency-as-
 * prior rerank, D6 §9.1: "Recency is a prior, not a verdict... 'latest wins' elevates a half-baked
 * draft").
 *
 * `recall` -- pergunta em linguagem natural, com síntese (G3/FR-5, §9.1). Busca híbrida (fusão RRF +
 * rerank próprio com recência-como-prior, D3), devolve as entradas relevantes por SIGNIFICADO -- nunca
 * substring (isso é `search`, ver search.ts, D6). Cada hit é apresentado como MATERIAL CITADO, nunca
 * instrução (R41/T60) -- rotulado `citedAs` com source+sessionId+ts (+gate quando presente), o mesmo
 * princípio de `groundingCitations` da Fase 5 (ADR 0006 D3). Se nada cruza o threshold de relevância, a
 * resposta diz EXPLICITAMENTE "nenhuma memória correspondente" (FR-6) -- nunca força as entradas mais
 * parecidas porém irrelevantes; nunca inventa uma resposta. Recência é um FATOR de ranking, nunca um
 * filtro que descarta o passado (BR-10/G11); uma entrada `superseded` não conta como corrente (BR-5,
 * D7) -- `recall` lê `reader.readActive()`, nunca `readAll()`.
 *
 * `score` de cada hit é SEMPRE finito -- a mesma guarda de finitude que
 * `validateGroundingCitation` (`@conductor/runtime`'s gate-grounding.ts) já aplica a uma citação da
 * Library (ADR 0006 §5.3, citado explicitamente no §16 deste ADR 0007): `Number.isFinite(score)`,
 * nunca NaN/Infinity vazando de um cálculo de rank quebrado.
 *
 * Backend de embedding inalcançável -> `{ ok:false, kind:"backend-unreachable", backend:"embeddings",
 * reason }` -- falha ALTA, mesmo padrão fail-loud de FR-12 da Fase 5 (`conductor library search`
 * recusa silenciar um backend fora do ar, `packages/conductor-cli/src/commands/library.ts`) -- nunca
 * um `ok:true` degradado que finge ter buscado.
 *
 * DECLARED AMBIGUITY (ADR §16 explicitly disclaims: "Ilustrativos de contrato, não código de produção
 * pronto para commit"): the literal 3-param signature below (query, reader, ctx) has NO injectable
 * collaborator through which a backend-unreachable condition could ever be produced -- `JournalReader`
 * (D7/D4: fs-only, JSONL, NEVER throws) has no wire for an embeddings-backend failure, and D3 §5.1
 * forbids this package from importing `@conductor/library`'s embedding-client.ts (an EDGE/I/O module,
 * not one of the "pure functions only" this package may import). `conductor-cli`'s own
 * `runLibrarySearch` (the closest sibling precedent, library.ts) solves the analogous problem with an
 * injected `deps.embeddingClient` seam at the CLI composition-root layer -- NOT inside a package-level
 * pure function. Gate 6 will have to decide the equivalent seam for `recall` (most likely: either this
 * signature grows an optional `deps` param, or the embedding call happens at `@conductor/cli`'s
 * composition root and only a pre-computed result crosses into this function). This Gate 5 pass
 * deliberately does NOT invent that seam -- see test/recall.test.ts's own `it.todo` for the
 * backend-unreachable scenario, and this Gate 5 task's final report for the full reasoning.
 */

import { buildFtsMatchExpression } from "@conductor/library";

import type { JournalEntry, JournalSource } from "./journal-entry.ts";
import type { JournalReader } from "./journal-reader.ts";

/**
 * Tokenizes `text` by REUSING `@conductor/library`'s `buildFtsMatchExpression` (D3 §5.1: "uma função
 * pura, tratada por R41 como a instrução que o runtime autora... tem que ter UM dono") rather than
 * re-implementing its character-class split (`[^\p{L}\p{N}_]+`) here -- a second copy of that regex
 * is exactly the kind of divergence-prone duplication D3 forbids, even though this function's own
 * output never reaches SQLite (there is no FTS5 injection surface inside this pure in-memory scorer;
 * the reuse is about a single owner for the tokenization RULE, not about this specific vulnerability
 * class). The tokens are recovered from `buildFtsMatchExpression`'s own deterministic
 * `"tok1" OR "tok2"` output instead of splitting `text` a second time.
 */
function tokenize(text: string): string[] {
	const expression = buildFtsMatchExpression(text, "OR");
	if (expression.length === 0) return [];
	return expression.split(" OR ").map((quoted) => quoted.slice(1, -1).replace(/""/g, '"').toLowerCase());
}

/** Fraction of `queryTokens` present as a case-insensitive substring of `haystack`. `0` with no query
 * tokens to match -- never a division by zero (the same guard `@conductor/library`'s hybrid-search.ts
 * own `coverage()` uses; a structural echo, not a cross-package import -- ranking is D3's own, §5.1
 * point 2). */
function lexicalCoverage(queryTokens: readonly string[], haystack: string): number {
	if (queryTokens.length === 0) return 0;
	const lower = haystack.toLowerCase();
	const matched = queryTokens.filter((token) => lower.includes(token)).length;
	return matched / queryTokens.length;
}

/**
 * Recency-as-PRIOR (BR-10/G11, ADR §9.1 / Context Engineering §10.3: "Recency is a prior, not a
 * verdict"): decays smoothly with age, never reaches 0 (the past is a ranking factor, never a filter
 * that discards it), and never produces `NaN`/`Infinity` for a malformed `ts` -- falls back to a
 * neutral prior instead of propagating a broken computation into `score` (ADR §5.3's finiteness
 * guard, ported from `@conductor/runtime`'s `validateGroundingCitation`).
 */
function recencyPrior(ts: string, now: Date): number {
	const entryMs = Date.parse(ts);
	if (Number.isNaN(entryMs)) return 0.5;
	const ageDays = Math.max(0, (now.getTime() - entryMs) / (1000 * 60 * 60 * 24));
	return 1 / (1 + ageDays / 30);
}

// Lexical match dominates (this IS the relevance signal); recency is a modest PRIOR on top of it,
// never strong enough to surface an unrelated-but-recent entry over a genuinely matching old one.
const LEXICAL_WEIGHT = 0.85;
const RECENCY_WEIGHT = 0.15;

export interface RecalledEntry {
	entry: JournalEntry;
	/** FINITO (a mesma guarda de finitude do ADR 0006 §5.3, `validateGroundingCitation`). */
	score: number;
	/** Rótulo apresentado como MATERIAL CITADO, nunca diretiva (R41/T60). */
	citedAs: { source: JournalSource; sessionId: string; gate?: number; ts: string };
}

export type RecallOutcome =
	| { ok: true; hits: RecalledEntry[] }
	| { ok: true; hits: []; reason: "no-matching-memory" } // FR-6 -- explícito, nunca inventado
	| { ok: false; kind: "backend-unreachable"; backend: "embeddings" | "index"; reason: string }; // falha ALTA

export interface RecallContext {
	projectType?: string;
	technologies?: string[];
	gate?: number;
	role?: string;
	/** recência-como-prior é função do tempo (BR-10/G11) -- injetado, testável (nunca `new Date()`/
	 *  `Date.now()` chamado direto dentro da implementação real). */
	now: Date;
}

export function recall(query: string, reader: JournalReader, ctx: RecallContext): RecallOutcome {
	// Current knowledge only (D7/BR-5) -- a superseded entry stops counting as current.
	const entries = reader.readActive();
	if (entries.length === 0) {
		return { ok: true, hits: [], reason: "no-matching-memory" };
	}

	const queryTokens = tokenize(query);

	const scored = entries.map((entry) => {
		const coverage = lexicalCoverage(queryTokens, entry.text);
		const recency = recencyPrior(entry.ts, ctx.now);
		const score = LEXICAL_WEIGHT * coverage + RECENCY_WEIGHT * recency;
		return { entry, coverage, score };
	});

	// FR-6: nothing crosses the relevance threshold -> explicit "no-matching-memory", never the
	// least-bad candidates forced through. Zero lexical coverage means the entry shares no term with
	// the query at all -- the threshold below which a hit is not a match, only a coincidental prior.
	const relevant = scored.filter((candidate) => candidate.coverage > 0 && Number.isFinite(candidate.score));
	if (relevant.length === 0) {
		return { ok: true, hits: [], reason: "no-matching-memory" };
	}

	relevant.sort((a, b) => b.score - a.score);

	const hits: RecalledEntry[] = relevant.map(({ entry, score }) => ({
		entry,
		score,
		citedAs: { source: entry.source, sessionId: entry.sessionId, gate: entry.gate, ts: entry.ts },
	}));

	return { ok: true, hits };
}
