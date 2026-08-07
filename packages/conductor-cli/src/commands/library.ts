/**
 * `conductor library status|search|ingest|update` (Fase 5 "Library e grounding" -- ADR 0006 §19
 * "Superfície CLI", D5).
 *
 * Same split this repo's own Gate 5 precedent already established for `gate`
 * (test/commands/gate-cli.acceptance.test.ts's own header): argument-SHAPE validation (which
 * subcommands exist, which flags `search` recognizes) is ordinary CLI plumbing and is REAL here, not
 * a Gate-6 stub -- `parseLibrarySearchArgs` below is fully implemented today. SUBSTANTIVE behavior
 * (an actual search/status/ingest/update against `@conductor/library`) is delegated to the `run*`
 * functions below, which ARE Gate-5 stubs that throw "not implemented" -- Gate 6 wires them to the
 * real engine once `@conductor/library`'s corpus-store.ts/embedding-client.ts land.
 *
 * `conductor library import` deliberately has NO case in `runLibraryCommand`'s switch below, so it
 * falls to the same "unknown subcommand" refusal as any other typo -- this is ADR 0006 D5, a
 * DECLARED Non-goal for this fase (not an oversight): the reference's `cdt library import <url>`
 * upserts pre-computed embeddings as authoritative, citable passages with a `--force` flag that skips
 * even the embedding-model/dimension check (`library.py:545-559`) -- verifying that kind of artifact
 * correctly needs signature verification, a pinned trust key, and a revocation policy, which is
 * explicitly the Gate 7 (supply-chain) surface, not this fase's (ADR §8.2/§8.3).
 */

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

/** GATE 5 stub -- Gate 6 wires this to `@conductor/library`'s corpus-store.ts (FR-8). */
export function runLibraryStatus(options: LibraryStatusOptions): string {
	throw new Error("not implemented");
}

/** GATE 5 stub -- Gate 6 wires this to `@conductor/library`'s hybrid-search.ts/corpus-store.ts
 * (FR-1/FR-2/FR-4/FR-5/FR-6/FR-7). */
export function runLibrarySearch(options: LibrarySearchOptions): string {
	throw new Error("not implemented");
}

/** GATE 5 stub -- Gate 6 wires this to `@conductor/library`'s corpus-store.ts (FR-9). */
export function runLibraryIngest(options: LibraryIngestOptions): string {
	throw new Error("not implemented");
}

/** GATE 5 stub -- Gate 6 wires this to `@conductor/library`'s corpus-store.ts (FR-10). */
export function runLibraryUpdate(options: LibraryUpdateOptions): string {
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
				io.stdout.write(runLibrarySearch({ cwd: io.cwd, ...parsed.flags }));
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
