/**
 * `conductor library status|search|ingest|update` (Fase 5 "Library e grounding" -- ADR 0006 §19
 * "Superfície CLI", D5).
 *
 * Same split this repo's own Gate 5 precedent already established for `gate`
 * (test/commands/gate-cli.acceptance.test.ts's own header): argument-SHAPE validation (which
 * subcommands exist, which flags `search` recognizes) is ordinary CLI plumbing and is REAL here, not
 * a Gate-6 stub -- `parseLibrarySearchArgs` below is fully implemented today. SUBSTANTIVE behavior
 * (an actual search/status against `@conductor/library`) is wired below to the real engine, now that
 * `@conductor/library`'s corpus-store.ts/embedding-client.ts have landed (this file is the
 * composition root ADR §11.2 names: it is the one place allowed to import BOTH `@conductor/library`
 * and, transitively via `@conductor/runtime`, the gate/grounding side -- neither of those two
 * packages ever imports the other directly). `ingest`/`update` remain Gate-5 stubs -- no test in this
 * round exercises FR-9/FR-10, and this is a deliberate, named deferral (YAGNI), not an oversight.
 *
 * FR-17's availability contract, enforced end-to-end in `runLibrarySearch` below: an unreachable/
 * erroring embedding backend degrades the search to LEXICAL-ONLY and records a `rag-unreachable`
 * ledger event -- it never throws out of this file and never blocks `library search` from answering.
 * Grounded in the corpus-store.ts/embedding-client.ts headers' own citations for the individual
 * mechanisms (finite-score requirement ADR §5.3, bm25 sign convention, FTS5 query-language injection
 * ADR §15.1/§15.2); the specific "catch a secondary ledger-write failure so it degrades observability
 * rather than the primary search response" decision below is this file's own judgment call, not
 * separately library-grounded -- `cdt library "HTTP client timeout ... Release It" --gate 6` and a
 * companion query on remote-service timeout patterns both returned only generic, off-topic
 * engineering-practice passages at ~0.53-0.57 relevance (library does not cover this specific pattern
 * for this stack).
 *
 * `conductor library import` deliberately has NO case in `runLibraryCommand`'s switch below, so it
 * falls to the same "unknown subcommand" refusal as any other typo -- this is ADR 0006 D5, a
 * DECLARED Non-goal for this fase (not an oversight): the reference's `cdt library import <url>`
 * upserts pre-computed embeddings as authoritative, citable passages with a `--force` flag that skips
 * even the embedding-model/dimension check (`library.py:545-559`) -- verifying that kind of artifact
 * correctly needs signature verification, a pinned trust key, and a revocation policy, which is
 * explicitly the Gate 7 (supply-chain) surface, not this fase's (ADR §8.2/§8.3).
 */

import { realpathSync } from "node:fs";
import {
	computeProjectId,
	createOllamaEmbeddingClient,
	enrichQuery,
	fuseAndRerank,
	openCorpusStore,
	openGroundingLedgerWriter,
	type RetrievedPassage,
	resolveLibraryHome,
} from "@conductor/library";

export interface LibraryStatusOptions {
	cwd: string;
	json: boolean;
}

export interface LibrarySearchOptions {
	cwd: string;
	question: string;
	gate?: number;
	role?: string;
	category?: string;
	tech?: string;
	version?: string;
	k?: number;
	lexicalOnly: boolean;
	codeAware: boolean;
	rerank?: "cross-encoder";
	json: boolean;
}

export interface LibraryIngestOptions {
	cwd: string;
	tier?: "core" | "supporting" | "foundational" | "optional";
	stack?: string;
}

export interface LibraryUpdateOptions {
	cwd: string;
}

/** Best-effort ledger write: the WRITER's own contract (grounding-ledger.ts's header) is to THROW on
 * I/O failure, on purpose, so a caller that depends on the write having happened never gets a false
 * positive. Neither call site below depends on that -- `library status`/`search` are human-facing
 * commands whose PRIMARY job is to answer the question; a ledger outage (disk full, permission error)
 * is a secondary, observability-only failure that must degrade quietly rather than take the whole
 * command down with it (FR-17's own "never block the primary operation" intent, applied one level
 * further than the embedding backend itself). Scoped narrowly to this one composition root -- it does
 * NOT relax the writer's contract for `@conductor/runtime`'s `recordGroundedDecision`, which has a
 * real forgery-prevention reason (ADR §6.2) to require the write to actually have happened. */
function safeAppend(write: () => void): void {
	try {
		write();
	} catch (error) {
		// Observability-only failure -- never let a ledger write problem surface as a search/status
		// failure to the user (see this function's own doc comment). Still logged to stderr with
		// context rather than swallowed silently (quality-baseline Observability category: a bare
		// `catch {}` with zero trace would make a disk-full/permission ledger outage invisible).
		console.error(
			`[conductor-cli:library] ${new Date().toISOString()} operation=ledger-write degraded-silently: ${describeError(error)}`,
		);
	}
}

/** Wired to `@conductor/library`'s corpus-store.ts (FR-8). Never fails because the corpus has not been
 * ingested yet -- `openCorpusStore` creates the schema on demand and `status()` answers `chunkCount:
 * 0` for a brand-new, empty corpus rather than throwing (corpus-store.ts's own contract). */
export function runLibraryStatus(options: LibraryStatusOptions): string {
	const home = resolveLibraryHome();
	const corpusStore = openCorpusStore(home.corpusDatabase);
	try {
		const status = corpusStore.status();
		if (options.json) {
			return `${JSON.stringify(status, null, 2)}\n`;
		}
		if (status.chunkCount === 0) {
			return "0 chunks indexed — run 'conductor library ingest' first.\n";
		}
		return `${status.chunkCount} chunk(s) indexed (corpus version: ${status.corpusVersion ?? "unknown"}, embedding model: ${status.embeddingModel ?? "unknown"}).\n`;
	} finally {
		corpusStore.close();
	}
}

const DEFAULT_SEARCH_K = 5;
/** RRF's own constant (ADR §17.1, hybrid-search.ts's own header: Context Engineering §4.4's literal
 * `rrf_merge(dense, lexical, k=60)`). */
const RRF_K = 60;
/** No candidate is dropped by default (FR-5/BR-2's threshold is an opt-in "courage to retrieve
 * nothing" cutoff, not a default-active filter) -- every component `fuseAndRerank` sums is already
 * non-negative (hybrid-search.ts's own weighted min-max-normalized terms), so `0` never excludes a
 * genuine candidate while still satisfying the function's contract. */
const DEFAULT_RELEVANCE_THRESHOLD = 0;

function formatSearchResults(passages: readonly RetrievedPassage[]): string {
	if (passages.length === 0) {
		return "No results found for this query.\n";
	}
	const entries = passages.map((passage, index) => {
		const excerpt = passage.body.length > 200 ? `${passage.body.slice(0, 200)}…` : passage.body;
		return `${index + 1}. [${passage.score.toFixed(3)}] ${passage.source} — ${passage.section} (${passage.path})\n   ${excerpt}`;
	});
	return `${entries.join("\n\n")}\n`;
}

/** Wired to `@conductor/library`'s hybrid-search.ts/corpus-store.ts/embedding-client.ts/query-
 * enrichment.ts/grounding-ledger.ts (FR-1/FR-2/FR-4/FR-5/FR-6/FR-7/FR-17). Lexical search always
 * runs; dense search is attempted and, on ANY embedding-backend failure (network/timeout/HTTP
 * error), degrades to lexical-only and records a `rag-unreachable` ledger event -- this function
 * NEVER rejects because the embedding backend is unreachable, matching FR-17's whole reason for
 * existing. */
export async function runLibrarySearch(options: LibrarySearchOptions): Promise<string> {
	const home = resolveLibraryHome();
	const projectId = computeProjectId(realpathSync(options.cwd));
	const ledgerWriter = openGroundingLedgerWriter(home.eventsLog(projectId));
	const corpusStore = openCorpusStore(home.corpusDatabase);

	try {
		const k = options.k ?? DEFAULT_SEARCH_K;
		const enrichedQuery = enrichQuery(options.question, {
			gate: options.gate,
			role: options.role,
		});

		const lexical = corpusStore.searchLexical(enrichedQuery, k);

		let dense: RetrievedPassage[] = [];
		let mode: "hybrid" | "lexical-only" = "lexical-only";
		if (!options.lexicalOnly) {
			try {
				const embeddingClient = createOllamaEmbeddingClient();
				const queryVector = await embeddingClient.embed(enrichedQuery);
				dense = corpusStore.searchDense(queryVector, k);
				mode = "hybrid";
			} catch (error) {
				// FR-17: the embedding backend being unreachable degrades to lexical-only -- never
				// propagated as an exception out of this function.
				safeAppend(() =>
					ledgerWriter.appendUnreachable({
						projectId,
						backend: "ollama:bge-m3",
						reason: describeError(error),
					}),
				);
			}
		}

		const fused = fuseAndRerank(lexical, dense, enrichedQuery, {
			rrfK: RRF_K,
			topK: k,
			threshold: DEFAULT_RELEVANCE_THRESHOLD,
		});

		const corpusStatus = corpusStore.status();
		safeAppend(() =>
			ledgerWriter.appendQuery({
				projectId,
				question: options.question,
				enrichedQuery,
				mode,
				corpusVersion: corpusStatus.corpusVersion ?? "unknown",
				embeddingModel: corpusStatus.embeddingModel ?? "bge-m3",
				gate: options.gate,
				role: options.role,
				topScore: fused[0]?.score ?? 0,
				hits: fused.map((passage) => ({
					chunkHash: passage.chunkHash,
					source: passage.source,
					section: passage.section,
					path: passage.path,
					category: passage.category,
					score: passage.score,
				})),
			}),
		);

		return formatSearchResults(fused);
	} finally {
		corpusStore.close();
	}
}

/** GATE 5 stub -- Gate 6 wires this to `@conductor/library`'s corpus-store.ts (FR-9). */
export function runLibraryIngest(_options: LibraryIngestOptions): string {
	throw new Error("not implemented");
}

/** GATE 5 stub -- Gate 6 wires this to `@conductor/library`'s corpus-store.ts (FR-10). */
export function runLibraryUpdate(_options: LibraryUpdateOptions): string {
	throw new Error("not implemented");
}

export type ParseLibrarySearchArgsResult =
	| { ok: true; flags: Omit<LibrarySearchOptions, "cwd"> }
	| { ok: false; error: string };

const VALUE_FLAGS = new Set(["--gate", "--role", "--category", "--tech", "--version", "-k", "--rerank"]);
const BOOLEAN_FLAGS = new Set(["--lexical-only", "--code-aware", "--json"]);

/**
 * Parses `conductor library search`'s own argv tail into a structured, validated flag set (ADR §19
 * "Superfície CLI": `--gate N`, `--role <papel>`, `--category <c>`, `--tech <t>`, `--version <v>`,
 * `-k N`, `--lexical-only`, `--code-aware`, `--rerank cross-encoder`, `--json`, plus the one
 * positional argument (the question). Real, ordinary CLI plumbing -- not a Gate-6 stub (see this
 * file's own header).
 */
export function parseLibrarySearchArgs(args: string[]): ParseLibrarySearchArgsResult {
	let question: string | undefined;
	const values: Record<string, string> = {};
	let lexicalOnly = false;
	let codeAware = false;
	let json = false;
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (BOOLEAN_FLAGS.has(arg)) {
			if (arg === "--lexical-only") lexicalOnly = true;
			else if (arg === "--code-aware") codeAware = true;
			else if (arg === "--json") json = true;
			continue;
		}
		if (VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg); // dangling flag with no value -- fail-closed, mirrors cli.ts's own parseFlags
				continue;
			}
			values[arg] = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("-")) {
			unrecognized.push(arg);
			continue;
		}
		if (question === undefined) {
			question = arg;
		} else {
			unrecognized.push(arg);
		}
	}

	if (unrecognized.length > 0) {
		return { ok: false, error: `unrecognized argument(s): ${unrecognized.join(" ")}` };
	}
	if (question === undefined) {
		return { ok: false, error: 'a search question is required, e.g. conductor library search "how to X?"' };
	}

	let gate: number | undefined;
	if (values["--gate"] !== undefined) {
		const parsedGate = Number.parseInt(values["--gate"], 10);
		if (!Number.isInteger(parsedGate) || parsedGate < 1) {
			return { ok: false, error: `--gate: "${values["--gate"]}" is not a valid gate number` };
		}
		gate = parsedGate;
	}

	let k: number | undefined;
	if (values["-k"] !== undefined) {
		const parsedK = Number.parseInt(values["-k"], 10);
		if (!Number.isInteger(parsedK) || parsedK < 1) {
			return { ok: false, error: `-k: "${values["-k"]}" is not a valid positive integer` };
		}
		k = parsedK;
	}

	let rerank: "cross-encoder" | undefined;
	if (values["--rerank"] !== undefined) {
		if (values["--rerank"] !== "cross-encoder") {
			return { ok: false, error: `--rerank: only "cross-encoder" is supported (got "${values["--rerank"]}")` };
		}
		rerank = "cross-encoder";
	}

	return {
		ok: true,
		flags: {
			question,
			gate,
			role: values["--role"],
			category: values["--category"],
			tech: values["--tech"],
			version: values["--version"],
			k,
			lexicalOnly,
			codeAware,
			rerank,
			json,
		},
	};
}

interface LibraryCliIO {
	cwd: string;
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * `conductor library <status|search|ingest|update>` dispatch. `import` is deliberately absent (D5) --
 * it falls to the same "unknown subcommand" refusal as any typo, documented in this file's header.
 */
export async function runLibraryCommand(args: string[], io: LibraryCliIO): Promise<number> {
	const [sub, ...rest] = args;

	switch (sub) {
		case "status": {
			const json = rest.includes("--json");
			try {
				io.stdout.write(runLibraryStatus({ cwd: io.cwd, json }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor library status: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "search": {
			const parsed = parseLibrarySearchArgs(rest);
			if (!parsed.ok) {
				io.stderr.write(`conductor library search: ${parsed.error}\n`);
				return 1;
			}
			try {
				io.stdout.write(await runLibrarySearch({ cwd: io.cwd, ...parsed.flags }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor library search: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "ingest": {
			try {
				io.stdout.write(runLibraryIngest({ cwd: io.cwd }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor library ingest: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "update": {
			try {
				io.stdout.write(runLibraryUpdate({ cwd: io.cwd }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor library update: ${describeError(error)}\n`);
				return 1;
			}
		}
		default:
			io.stderr.write(
				`conductor library: unknown subcommand "${sub ?? ""}". Usage: status | search | ingest | update\n`,
			);
			return 1;
	}
}
