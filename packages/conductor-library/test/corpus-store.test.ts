/**
 * Gate 8 -> Gate 6 loop-back (gate2-spec-fase5.md FR-4): `searchLexical`/`searchDense` parse
 * `--category`/`--tech`/`--version` all the way down to `library.ts`, but corpus-store.ts's own
 * search functions never accepted a filter parameter at all -- the `chunk` table already has the
 * columns (`category`/`tech`/`version`, corpus-store.ts's own SCHEMA_SQL), so this was a wiring gap,
 * not a missing capability. FR-4: "um filtro nunca é ignorado silenciosamente".
 *
 * No FR-9 `upsert`/ingest API exists yet (a deliberate, named deferral -- corpus-store.ts's own
 * header), so this test seeds the `chunk`/`chunk_fts` tables directly via a raw `node:sqlite`
 * connection against the same on-disk file `openCorpusStore` bootstraps -- the only seam available
 * today to get rows into the store for a read-path test. `chunk_fts` is an EXTERNAL CONTENT FTS5
 * table (`content=chunk, content_rowid=rowid`, corpus-store.ts's own SCHEMA_SQL): inserting into
 * `chunk` alone does not populate it, so the seed helper explicitly rebuilds the FTS index
 * (`INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild')`) after seeding, the standard SQLite FTS5
 * mechanism for syncing an external-content index from its content table.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpusStore } from "../src/corpus-store.ts";

let scratchDir: string;
let dbPath: string;

beforeEach(() => {
	scratchDir = mkdtempSync(join(tmpdir(), "conductor-library-corpus-store-"));
	dbPath = join(scratchDir, "corpus.sqlite");
});

afterEach(() => {
	rmSync(scratchDir, { recursive: true, force: true });
});

interface SeedChunk {
	chunkId: string;
	contentHash: string;
	source: string;
	section: string;
	path: string;
	category: string;
	tech?: string;
	version?: string;
	ordinal: number;
	body: string;
	/** Present only for chunks meant to be reachable via `searchDense`. */
	vec?: number[];
}

function encodeVector(vec: number[]): Uint8Array {
	const floats = Float32Array.from(vec);
	return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
}

/** Bootstraps the schema through the real `openCorpusStore` (never a duplicated copy of
 * corpus-store.ts's own `SCHEMA_SQL`), then reopens a raw connection to insert seed rows -- see this
 * file's header for why a raw connection is the only seam available with no FR-9 upsert API yet. */
function seedCorpus(chunks: readonly SeedChunk[]): void {
	const bootstrap = openCorpusStore(dbPath);
	bootstrap.close();

	const db = new DatabaseSync(dbPath);
	try {
		const insert = db.prepare(
			`INSERT INTO chunk (chunk_id, content_hash, source, section, path, category, tech, version, ordinal, body, vec)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const c of chunks) {
			insert.run(
				c.chunkId,
				c.contentHash,
				c.source,
				c.section,
				c.path,
				c.category,
				c.tech ?? null,
				c.version ?? null,
				c.ordinal,
				c.body,
				c.vec ? encodeVector(c.vec) : null,
			);
		}
		// External-content FTS5 table: rows inserted into `chunk` are not reflected in `chunk_fts`
		// without a sync trigger (none exists -- FR-9 ingestion territory). Rebuild from the content
		// table so searchLexical below has something to MATCH against.
		db.exec("INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild')");
	} finally {
		db.close();
	}
}

describe("corpus-store.ts searchLexical filters (FR-4, Gate 8 loop-back)", () => {
	it("with no filters, returns every chunk that matches the lexical query regardless of category", () => {
		seedCorpus([
			{
				chunkId: "a",
				contentHash: "h1",
				source: "Security Book",
				section: "S1",
				path: "a.md",
				category: "security_and_privacy",
				ordinal: 0,
				body: "circuit breaker pattern for resilience",
			},
			{
				chunkId: "b",
				contentHash: "h2",
				source: "Architecture Book",
				section: "S1",
				path: "b.md",
				category: "architecture",
				ordinal: 0,
				body: "circuit breaker pattern for resilience",
			},
		]);

		const store = openCorpusStore(dbPath);
		try {
			const results = store.searchLexical("circuit breaker", 10);
			expect(results.map((r) => r.chunkId).sort()).toEqual(["a", "b"]);
		} finally {
			store.close();
		}
	});

	it("with a --category filter, only returns chunks whose category matches -- never ignored silently", () => {
		seedCorpus([
			{
				chunkId: "a",
				contentHash: "h1",
				source: "Security Book",
				section: "S1",
				path: "a.md",
				category: "security_and_privacy",
				ordinal: 0,
				body: "circuit breaker pattern for resilience",
			},
			{
				chunkId: "b",
				contentHash: "h2",
				source: "Architecture Book",
				section: "S1",
				path: "b.md",
				category: "architecture",
				ordinal: 0,
				body: "circuit breaker pattern for resilience",
			},
		]);

		const store = openCorpusStore(dbPath);
		try {
			const results = store.searchLexical("circuit breaker", 10, { category: "security_and_privacy" });
			expect(results).toHaveLength(1);
			expect(results[0]?.chunkId).toBe("a");
		} finally {
			store.close();
		}
	});

	it("with a --tech/--version filter combined, only returns chunks matching BOTH facets", () => {
		seedCorpus([
			{
				chunkId: "a",
				contentHash: "h1",
				source: "Python Book",
				section: "S1",
				path: "a.md",
				category: "security_and_privacy",
				tech: "python",
				version: "3.13",
				ordinal: 0,
				body: "credential handling guidance",
			},
			{
				chunkId: "b",
				contentHash: "h2",
				source: "Python Book Old",
				section: "S1",
				path: "b.md",
				category: "security_and_privacy",
				tech: "python",
				version: "2.7",
				ordinal: 0,
				body: "credential handling guidance",
			},
			{
				chunkId: "c",
				contentHash: "h3",
				source: "Java Book",
				section: "S1",
				path: "c.md",
				category: "security_and_privacy",
				tech: "java",
				version: "3.13",
				ordinal: 0,
				body: "credential handling guidance",
			},
		]);

		const store = openCorpusStore(dbPath);
		try {
			const results = store.searchLexical("credential handling", 10, { tech: "python", version: "3.13" });
			expect(results.map((r) => r.chunkId)).toEqual(["a"]);
		} finally {
			store.close();
		}
	});

	it("returns an empty array (not an error, not the unfiltered set) when the filter matches nothing", () => {
		seedCorpus([
			{
				chunkId: "a",
				contentHash: "h1",
				source: "Security Book",
				section: "S1",
				path: "a.md",
				category: "security_and_privacy",
				ordinal: 0,
				body: "circuit breaker pattern for resilience",
			},
		]);

		const store = openCorpusStore(dbPath);
		try {
			const results = store.searchLexical("circuit breaker", 10, { category: "does_not_exist" });
			expect(results).toEqual([]);
		} finally {
			store.close();
		}
	});
});

describe("corpus-store.ts searchDense filters (FR-4, Gate 8 loop-back)", () => {
	it("with a --tech filter, only returns chunks whose tech matches, ranked by cosine similarity among survivors", () => {
		seedCorpus([
			{
				chunkId: "a",
				contentHash: "h1",
				source: "Python Book",
				section: "S1",
				path: "a.md",
				category: "architecture",
				tech: "python",
				ordinal: 0,
				body: "irrelevant to the match, only the vector matters here",
				vec: [1, 0, 0],
			},
			{
				chunkId: "b",
				contentHash: "h2",
				source: "Java Book",
				section: "S1",
				path: "b.md",
				category: "architecture",
				tech: "java",
				ordinal: 0,
				body: "irrelevant to the match, only the vector matters here",
				vec: [1, 0, 0],
			},
		]);

		const store = openCorpusStore(dbPath);
		try {
			const results = store.searchDense([1, 0, 0], 10, { tech: "python" });
			expect(results.map((r) => r.chunkId)).toEqual(["a"]);
		} finally {
			store.close();
		}
	});

	it("with a --category filter that matches nothing, returns an empty array rather than the unfiltered ranking", () => {
		seedCorpus([
			{
				chunkId: "a",
				contentHash: "h1",
				source: "Python Book",
				section: "S1",
				path: "a.md",
				category: "architecture",
				ordinal: 0,
				body: "irrelevant to the match, only the vector matters here",
				vec: [1, 0, 0],
			},
		]);

		const store = openCorpusStore(dbPath);
		try {
			const results = store.searchDense([1, 0, 0], 10, { category: "security_and_privacy" });
			expect(results).toEqual([]);
		} finally {
			store.close();
		}
	});
});
