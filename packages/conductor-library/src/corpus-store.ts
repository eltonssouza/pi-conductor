/**
 * The corpus store: `node:sqlite` schema, FTS5 virtual table, BLOB vector storage, incremental
 * upsert -- BORDA: fs/sqlite (docs/adr/0006-fase5-library-and-grounding.md D1/D7/D8, §3.1, §11.1).
 *
 * GATE 6: implements the schema-bootstrap + read paths (`status`/`searchLexical`/`searchDense`) left
 * as a stub at Gate 5. Ingestion (`upsert` with `content_hash` dedup, FR-9) is still NOT implemented
 * here -- no Gate-5/Gate-6 test in this round exercises it (`library ingest` remains a "not
 * implemented" stub in `conductor-cli/src/commands/library.ts`), and inventing an ingestion pipeline
 * without a test that requires it would be speculative work this round's spec does not ask for
 * (YAGNI -- Pragmatic Programming Practices' own "build only what the current story needs"). This is
 * a conscious, named deferral, not an oversight: FR-9 is tracked as a separate follow-up round.
 *
 * The schema this module owns (ADR §3.1), created `IF NOT EXISTS` so opening a store never fails just
 * because `corpus.sqlite` (or its parent directory) does not exist yet -- confirmed empirically this
 * same Gate 6 session against a real `node:sqlite` `DatabaseSync`: it throws if the PARENT directory
 * is missing (hence the `mkdirSync` below) but happily creates the database FILE itself on first open:
 *   meta(key, value)               -- schemaVersion, corpusVersion, embeddingModel, embeddingDim, ...
 *   chunk(chunk_id, content_hash, source, section, path, category, tech, version, ordinal, body, vec)
 *   chunk_fts USING fts5(body, section, source, content=chunk, content_rowid=rowid)
 *
 * Score convention: every `RetrievedPassage.score` this store returns is HIGHER-IS-BETTER, matching
 * `hybrid-search.ts`'s own dense/cosine convention (that module's `fuseAndRerank` mixes lexical and
 * dense scores through the same min-max `normalize` helper, which only makes sense if both stages
 * agree on direction). SQLite FTS5's own `bm25()` is the opposite (LOWER is a better match) --
 * `searchLexical` below negates it at the boundary so no caller outside this file ever has to
 * remember that SQLite's convention differs from this package's.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildFtsMatchExpression } from "./fts-query.ts";
import type { RetrievedPassage } from "./hybrid-search.ts";

export interface CorpusStatus {
	chunkCount: number;
	/** `null` when the corpus has never been ingested (no `meta` row yet) -- never a thrown error. */
	corpusVersion: string | null;
	/** `null` when the corpus has never been ingested -- never a thrown error. */
	embeddingModel: string | null;
}

export interface CorpusStore {
	/** Aggregate counts for `library status` (FR-8). Always answerable, even against a freshly-created,
	 * completely empty corpus -- `chunkCount: 0`, never a thrown error. */
	status(): CorpusStatus;
	/** FTS5 bm25 search over `chunk_fts`, via `fts-query.ts`'s `buildFtsMatchExpression` (never a raw
	 * concatenated query string -- see that module's own header for why). Returns at most `k` passages,
	 * ordered by descending (higher-is-better) score. Empty `question`/an empty corpus/an unexpected
	 * FTS5 engine error all return an EMPTY array, never throw -- a single malformed query must never
	 * crash `library search`. */
	searchLexical(question: string, k: number): RetrievedPassage[];
	/** Cosine-similarity search over every chunk with a stored `vec` (dimension-mismatched rows are
	 * skipped, never thrown on). Returns at most `k` passages, ordered by descending score. An empty
	 * `queryVector`, an empty corpus, or an unexpected engine error all return an EMPTY array, never
	 * throw. */
	searchDense(queryVector: readonly number[], k: number): RetrievedPassage[];
	close(): void;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunk (
	chunk_id TEXT PRIMARY KEY,
	content_hash TEXT NOT NULL,
	source TEXT NOT NULL,
	section TEXT NOT NULL,
	path TEXT NOT NULL,
	category TEXT NOT NULL,
	tech TEXT,
	version TEXT,
	ordinal INTEGER NOT NULL,
	body TEXT NOT NULL,
	vec BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
	body, section, source, content=chunk, content_rowid=rowid
);
`;

interface RawChunkRow {
	chunk_id: string;
	content_hash: string;
	source: string;
	section: string;
	path: string;
	category: string;
	tech: string | null;
	version: string | null;
	body: string;
}

/** Logs an unexpected (never-expected-in-normal-operation) engine error to stderr with enough
 * context to diagnose it, then lets the caller fail closed (return `[]`) instead of crashing --
 * DELIBERATELY distinct from `grounding-ledger.ts`'s reader (R36), whose own silent swallow is a
 * documented SECURITY property (an unreadable ledger must be indistinguishable from an empty one to
 * every caller). This store's swallow exists only to keep an unexpected SQLite/FTS5 bug from crashing
 * `library search` -- for that purpose a log line is strictly an improvement, never a leak (no
 * secrets/PII pass through this path; `operation` and the engine's own error message are the only
 * fields written). Quality-baseline's own "no bare `catch` that swallows silently" bar (Observability
 * category) is why this exists rather than an empty `catch {}`. */
function logSwallowedStoreError(operation: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[conductor-library:corpus-store] ${new Date().toISOString()} operation=${operation} degraded-to-empty-result: ${message}`);
}

function toPassage(row: RawChunkRow, score: number): RetrievedPassage {
	return {
		chunkId: row.chunk_id,
		chunkHash: row.content_hash,
		body: row.body,
		source: row.source,
		section: row.section,
		path: row.path,
		category: row.category,
		tech: row.tech ?? undefined,
		version: row.version ?? undefined,
		score,
	};
}

/** Decodes a `vec` BLOB column (stored as raw IEEE-754 float32 bytes) back into a plain number array.
 * `null`/empty input decodes to an empty vector -- callers compare `.length` against the query
 * vector's own dimension before using it, so a mismatched/absent vector is skipped, never crashes. */
function decodeVector(blob: Uint8Array | null): number[] {
	if (blob === null || blob.byteLength === 0) return [];
	const floatCount = Math.floor(blob.byteLength / Float32Array.BYTES_PER_ELEMENT);
	const view = new Float32Array(blob.buffer, blob.byteOffset, floatCount);
	return Array.from(view);
}

/** Cosine similarity between two equal-length vectors. Guards the zero-denominator case (either
 * vector is all-zero) the same way `hybrid-search.ts`'s own `normalize` guards a tied min/max range --
 * a degenerate input must never propagate `NaN` out of this store (ADR §5.3's finite-score
 * requirement, which `RetrievedPassage.score` is bound by everywhere it is produced). */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const av = a[i]!;
		const bv = b[i]!;
		dot += av * bv;
		normA += av * av;
		normB += bv * bv;
	}
	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	return denominator === 0 ? 0 : dot / denominator;
}

/** Clamps a caller-supplied `k` to a non-negative integer -- defensive input validation at this
 * module's own boundary (never assumes an upstream caller already validated it), so a negative/
 * fractional/`NaN` `k` degrades to "no results" instead of an engine error or a negative `LIMIT`. */
function normalizeLimit(k: number): number {
	if (!Number.isFinite(k)) return 0;
	return Math.max(0, Math.trunc(k));
}

/**
 * Opens (creating the file and schema on demand, `IF NOT EXISTS`) the corpus store at `path`. Never
 * fails because the file or its parent directory does not exist yet -- a genuine I/O failure (e.g. an
 * unreadable/corrupted existing file, a permission error) still propagates as a thrown exception,
 * which `conductor-cli`'s `runLibraryCommand` already wraps in a try/catch at its call site.
 */
export function openCorpusStore(path: string): CorpusStore {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec(SCHEMA_SQL);

	function readMeta(key: string): string | null {
		const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
		return row?.value ?? null;
	}

	return {
		status(): CorpusStatus {
			const countRow = db.prepare("SELECT COUNT(*) as count FROM chunk").get() as { count: number };
			return {
				chunkCount: countRow.count,
				corpusVersion: readMeta("corpusVersion"),
				embeddingModel: readMeta("embeddingModel"),
			};
		},

		searchLexical(question: string, k: number): RetrievedPassage[] {
			const limit = normalizeLimit(k);
			if (limit === 0) return [];

			const matchExpression = buildFtsMatchExpression(question, "OR");
			if (matchExpression.length === 0) return [];

			try {
				const rows = db
					.prepare(
						`SELECT c.chunk_id, c.content_hash, c.source, c.section, c.path, c.category, c.tech, c.version, c.body,
							bm25(chunk_fts) as rank
						 FROM chunk_fts
						 JOIN chunk c ON c.rowid = chunk_fts.rowid
						 WHERE chunk_fts MATCH ?
						 ORDER BY rank
						 LIMIT ?`,
					)
					.all(matchExpression, limit) as unknown as (RawChunkRow & { rank: number })[];
				// bm25(): SQLite's own convention is LOWER-is-better -- negated here so this store's public
				// score convention (higher-is-better) is uniform across searchLexical/searchDense.
				return rows.map((row) => toPassage(row, -row.rank));
			} catch (error) {
				// An unexpected FTS5 engine error must never crash `library search` over a single query --
				// fail closed to "no lexical hits" (the same "expected failure is a return value, not a
				// thrown exception" discipline this package's grounding-ledger.ts reader already applies),
				// but -- unlike that reader's security-motivated silent swallow (R36) -- logged with context
				// first, since there is no security reason to hide an unexpected engine bug here.
				logSwallowedStoreError("searchLexical", error);
				return [];
			}
		},

		searchDense(queryVector: readonly number[], k: number): RetrievedPassage[] {
			const limit = normalizeLimit(k);
			if (limit === 0 || queryVector.length === 0) return [];

			try {
				const rows = db
					.prepare(
						`SELECT chunk_id, content_hash, source, section, path, category, tech, version, body, vec
						 FROM chunk WHERE vec IS NOT NULL`,
					)
					.all() as unknown as (RawChunkRow & { vec: Uint8Array | null })[];

				const scored: RetrievedPassage[] = [];
				for (const row of rows) {
					const vector = decodeVector(row.vec);
					// Dimension mismatch (e.g. a corpus embedded with a different model) is skipped, never
					// thrown on -- an inconsistent single row must not abort the whole search.
					if (vector.length !== queryVector.length) continue;
					scored.push(toPassage(row, cosineSimilarity(queryVector, vector)));
				}
				scored.sort((a, b) => b.score - a.score);
				return scored.slice(0, limit);
			} catch (error) {
				logSwallowedStoreError("searchDense", error);
				return [];
			}
		},

		close(): void {
			db.close();
		},
	};
}
