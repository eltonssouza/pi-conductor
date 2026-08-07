/**
 * `conductor journal add|recall|search|digest|supersede` (Gate 6, Fase 6 "Diary e captura automática"
 * -- ADR 0007 §16 "Apêndice: contratos TypeScript" + §16 "Superfície CLI",
 * docs/adr/0007-fase6-diary-and-capture.md).
 *
 * This is the composition root D4 assigns the CLI: `@conductor/diary` deliberately ships NO
 * `diary-home.ts` (unlike `@conductor/library`'s own `library-home.ts`) -- the package only exposes
 * `openJournalWriter(entriesPath)`/`openJournalReader(entriesPath, projectId)`, which take an
 * ALREADY-RESOLVED path. `resolveJournalContext` below assembles that path here, the same way
 * `library.ts`'s `runLibrarySearch` assembles `home.eventsLog(projectId)` from
 * `resolveLibraryHome()`+`computeProjectId(realpathSync(cwd))`. `computeProjectId` is REUSED (imported)
 * from `@conductor/library` rather than reimplemented -- ADR §6.1 names this exact function
 * (`library-home.ts`'s `sha256(realpath).slice(0,16)`) as the "in-repo precedent" the Diary's own
 * per-machine path (`~/.conductor/diary/projects/<projectId>/entries.jsonl`, D4 §6.1) must use.
 *
 * `homeDir` (an optional field on every `Journal*Options` interface below, defaulting to the real
 * `os.homedir()` inside `resolveJournalContext`) is a TEST SEAM ONLY -- mirrors
 * `library-home.ts`'s own `resolveLibraryHome(homeDir = homedir())` signature. Production callers
 * (`runJournalCommand`'s dispatcher below) never set it, so production behavior is exactly D4's
 * per-machine home. `test/commands/journal.test.ts` uses it to point at a scratch temp directory
 * instead of this machine's real `~/.conductor/diary` -- see that file's own header for why that
 * matters here (the Diary log is per-MACHINE, not per-workspace, so a test that never overrode this
 * would read/write real state on whatever machine runs the suite, the same caveat
 * `commands-library.test.ts`/`library.test.ts` already documented for `@conductor/library`'s own
 * `resolveLibraryHome()`).
 *
 * `journal ingest` has NO TypeScript contract in ADR §16's Apêndice code fence (only the `--` CLI-shape
 * line in the "Superfície CLI" list). Treated as a declared Non-goal this round, the exact precedent
 * `library.ts` already set for `library ingest`/`library update` at its own Gate 5 (FR-9/FR-10): a named
 * stub that THROWS "not implemented", reachable as a recognized subcommand (never the generic "unknown
 * subcommand" refusal), so a future round has a wired seam to fill rather than a command to invent from
 * scratch. No test in this round exercises it (YAGNI -- nothing in the Gate 5 diary test suite or this
 * task's own brief requires an ingestion pipeline yet).
 *
 * GATE-6 DECISIONS not fixed by the ADR (documented here per this task's own instructions, since the
 * ADR appendix is explicitly "illustrative of contract, not production-ready code"):
 *   - `author`: `journal add` has no `--role`/`--author` flag in ADR §16's CLI surface (only `recall`
 *     does, for `RecallContext.role`, an enrichment hint -- not an identity). A fixed sentinel `"cli"` is
 *     used for every manually-added entry, distinct from `capture.ts`'s own `CAPTURE_AUTHOR = "capture"`
 *     sentinel for automatically-captured entries -- the same "distinguishable, never fabricated
 *     identity" discipline `capture.ts`'s header already applies to its own author field.
 *   - `sessionId` default (when `--session` is omitted): `cli-<epoch-ms>-<8 hex chars>`, generated once
 *     per process invocation. Each `conductor journal add` run is a fresh OS process (no persistent
 *     "current session" concept a one-shot CLI command can read, unlike `chat.ts`'s own long-lived,
 *     resumable session), so a timestamp+short-random suffix is a reasonable, collision-resistant
 *     session identity for a manually-issued entry with no chat session behind it.
 *   - `--gate` bounds: `add`/`recall` validate `1..TOTAL_FLOW_GATES` at CLI-parse time (mirrors
 *     `cli.ts`'s own `parseGateNumber` for `gate start`/`gate evidence`) because neither
 *     `JournalWriter.append` nor `recall`'s own body validates `gate` at all -- an out-of-range value
 *     would otherwise be silently persisted/passed through with no signal. `search`'s `--gate`
 *     deliberately does NOT duplicate that bound here -- `search.ts`'s own `validateGateFacet` (D6/
 *     FR-9/BR-8) already owns that exact validation and returns a structured `unknown-facet` outcome
 *     this file surfaces verbatim; re-checking the same range here would be a second, driftable copy of
 *     the same rule (the identical "one owner for a shared rule" discipline the ADR itself applies to
 *     `buildFtsMatchExpression`, D3 §5.1).
 *   - `recall`'s `no-matching-memory`/`search`'s empty-result messages are in English, matching every
 *     other user-facing string in this CLI (`formatSearchResults`'s own "No results found for this
 *     query." in `library.ts`, `USAGE` in `cli.ts`) -- the ADR task brief's own Portuguese phrasing
 *     ("algo claro tipo 'Nenhuma memória relevante encontrada.'") is an example of TONE, not a literal
 *     string the codebase's established English-only user-output convention should break for.
 *   - `journal digest --session <id>`: `renderDigest` itself is PURE and takes only an entries array (no
 *     session filter of its own, per digest.ts's header). This file filters `reader.readAll()` by
 *     `sessionId` BEFORE calling `renderDigest`, when `--session` was given -- the composition root's
 *     job, not a change to the pure renderer.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type EditMode,
	JOURNAL_KINDS,
	type JournalKind,
	type JournalSearchFilters,
	type JournalSearchOutcome,
	openJournalReader,
	openJournalWriter,
	type RecallOutcome,
	recall,
	renderDigest,
	search,
} from "@conductor/diary";
import { computeProjectId } from "@conductor/library";
import { TOTAL_FLOW_GATES } from "@conductor/runtime";

/** A fixed, distinguishable author sentinel for every manually-issued `journal add`/`journal
 * supersede` entry -- see this file's own header ("GATE-6 DECISIONS", author) for why this is not
 * `capture.ts`'s own `"capture"` sentinel. */
const AUTHOR_CLI = "cli";

/**
 * D4/§6.1's per-machine path: `~/.conductor/diary/projects/<projectId>/entries.jsonl`. `homeDir`
 * defaults to the real OS home directory in production; every `Journal*Options` interface below
 * threads an optional `homeDir` through to here purely as a test seam -- see this file's own header.
 *
 * EXPORTED (Gate 6 wiring closure, D2/G12/FR-25): `cli.ts`'s `runGateCommand` reuses this exact
 * function to open a `JournalReader` over the SAME per-machine diary `journal add`/`supersede` write
 * to, so it can populate `ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds` for real (via
 * `@conductor/diary`'s `readRecordedJournalEntryIds`) instead of the permanently-empty `new Set()`
 * placeholder `gate-evidence.ts`'s own header named as "a REAL source once wired". One path-resolution
 * rule, one owner -- `runGateCommand` never recomputes it independently.
 */
export function resolveJournalContext(
	cwd: string,
	homeDir: string = homedir(),
): { entriesPath: string; projectId: string } {
	const projectId = computeProjectId(realpathSync(cwd));
	const entriesPath = join(homeDir, ".conductor", "diary", "projects", projectId, "entries.jsonl");
	return { entriesPath, projectId };
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function generateSessionId(): string {
	return `cli-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

// ==== journal add ====

export interface JournalAddOptions {
	cwd: string;
	kind: JournalKind;
	text: string;
	gate?: number;
	sessionId?: string;
	homeDir?: string;
}

/** Wired to `@conductor/diary`'s `openJournalWriter(...).append(...)` (D1/§16, FR-1/FR-2). Mints a
 * `sessionId` when `--session` was omitted (see this file's header) -- the runtime-minted `id` (never
 * caller-supplied, FR-4/BR-8) is echoed back in the confirmation message. */
export function runJournalAdd(options: JournalAddOptions): string {
	const { entriesPath } = resolveJournalContext(options.cwd, options.homeDir);
	const writer = openJournalWriter(entriesPath);
	const entry = writer.append({
		kind: options.kind,
		text: options.text,
		sessionId: options.sessionId ?? generateSessionId(),
		author: AUTHOR_CLI,
		gate: options.gate,
		source: "manual",
	});
	return `Recorded journal entry ${entry.id} (kind: ${entry.kind}, session: ${entry.sessionId}).\n`;
}

/** Shared `--gate N` bound check for `add`/`recall` (both have no downstream validation of their
 * own for it) -- see this file's header for why `search`'s `--gate` deliberately does NOT reuse this. */
function parseOptionalGate(
	raw: string | undefined,
	label: string,
): { ok: true; gate?: number } | { ok: false; error: string } {
	if (raw === undefined) return { ok: true, gate: undefined };
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > TOTAL_FLOW_GATES) {
		return {
			ok: false,
			error: `${label}: "${raw}" is not a valid gate number (expected an integer 1-${TOTAL_FLOW_GATES})`,
		};
	}
	return { ok: true, gate: parsed };
}

export type ParseResult<T> = { ok: true; flags: T } | { ok: false; error: string };

const ADD_VALUE_FLAGS = new Set(["--kind", "--gate", "--session"]);

/**
 * Parses `conductor journal add`'s argv tail. `--kind` is validated here, against the CLOSED
 * `JOURNAL_KINDS` vocabulary, naming the valid values on a mismatch (FR-2/BR-7) -- `JournalWriter.append`
 * itself does NOT validate `kind` at all (journal-writer.ts's `append` passes `input.kind` straight
 * through), so this CLI layer is the only place FR-2/BR-7 can be enforced for a manual `add`.
 */
export function parseJournalAddArgs(
	args: string[],
): ParseResult<{ kind: JournalKind; text: string; gate?: number; sessionId?: string }> {
	let text: string | undefined;
	const values: Record<string, string> = {};
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (ADD_VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg);
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
		if (text === undefined) {
			text = arg;
		} else {
			unrecognized.push(arg);
		}
	}

	if (unrecognized.length > 0) {
		return { ok: false, error: `unrecognized argument(s): ${unrecognized.join(" ")}` };
	}
	if (text === undefined || text.trim().length === 0) {
		return { ok: false, error: 'a text is required, e.g. conductor journal add --kind decision "..."' };
	}
	if (values["--kind"] === undefined) {
		return { ok: false, error: `--kind is required (one of: ${JOURNAL_KINDS.join(", ")})` };
	}
	if (!JOURNAL_KINDS.includes(values["--kind"] as JournalKind)) {
		return {
			ok: false,
			error: `--kind: "${values["--kind"]}" is not valid (must be one of: ${JOURNAL_KINDS.join(", ")})`,
		};
	}

	const gateResult = parseOptionalGate(values["--gate"], "conductor journal add: --gate");
	if (!gateResult.ok) return gateResult;

	return {
		ok: true,
		flags: { kind: values["--kind"] as JournalKind, text, gate: gateResult.gate, sessionId: values["--session"] },
	};
}

// ==== journal recall ====

export interface JournalRecallOptions {
	cwd: string;
	query: string;
	gate?: number;
	role?: string;
	homeDir?: string;
}

function formatRecallOutcome(outcome: RecallOutcome): string {
	if (!outcome.ok) {
		// backend-unreachable: not producible by the current recall.ts body (a pure in-memory lexical
		// scorer with no embeddings backend, its own header's `it.todo`) but the type allows it -- handled
		// defensively, the same FR-12 "never silence an unreachable backend" principle `library.ts`'s own
		// `runLibrarySearch` applies to an unreachable embedding backend.
		throw new Error(
			`journal recall: backend "${outcome.backend}" is unreachable (${outcome.reason}) -- the memory search cannot run right now`,
		);
	}
	if (outcome.hits.length === 0) {
		return "No matching memory found for this query.\n";
	}
	const lines = outcome.hits.map((hit, index) => {
		const gateLabel = hit.citedAs.gate !== undefined ? `, gate ${hit.citedAs.gate}` : "";
		return `${index + 1}. [${hit.score.toFixed(3)}] (${hit.citedAs.source}, session ${hit.citedAs.sessionId}${gateLabel}, ${hit.citedAs.ts})\n   ${hit.entry.text}`;
	});
	return `${lines.join("\n\n")}\n`;
}

/** Wired to `@conductor/diary`'s `recall(...)` (D6/G3). `ctx.now = new Date()` -- injected, never
 * `Date.now()` called inside a pure function (recall.ts's own recency-as-prior contract). */
export function runJournalRecall(options: JournalRecallOptions): string {
	const { entriesPath, projectId } = resolveJournalContext(options.cwd, options.homeDir);
	const reader = openJournalReader(entriesPath, projectId);
	const outcome = recall(options.query, reader, { gate: options.gate, role: options.role, now: new Date() });
	return formatRecallOutcome(outcome);
}

const RECALL_VALUE_FLAGS = new Set(["--gate", "--role"]);

export function parseJournalRecallArgs(args: string[]): ParseResult<{ query: string; gate?: number; role?: string }> {
	let query: string | undefined;
	const values: Record<string, string> = {};
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (RECALL_VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg);
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
		if (query === undefined) {
			query = arg;
		} else {
			unrecognized.push(arg);
		}
	}

	if (unrecognized.length > 0) {
		return { ok: false, error: `unrecognized argument(s): ${unrecognized.join(" ")}` };
	}
	if (query === undefined || query.trim().length === 0) {
		return { ok: false, error: 'a query is required, e.g. conductor journal recall "what did we decide about X?"' };
	}

	const gateResult = parseOptionalGate(values["--gate"], "conductor journal recall: --gate");
	if (!gateResult.ok) return gateResult;

	return { ok: true, flags: { query, gate: gateResult.gate, role: values["--role"] } };
}

// ==== journal search ====

export interface JournalSearchOptions {
	cwd: string;
	kind?: JournalKind[];
	gate?: number;
	sessionId?: string;
	since?: string;
	until?: string;
	text?: string;
	homeDir?: string;
}

function formatSearchOutcome(outcome: JournalSearchOutcome): string {
	if (!outcome.ok) {
		throw new Error(
			`journal search: unknown ${outcome.facet} "${outcome.value}" (expected one of: ${outcome.available.join(", ")})`,
		);
	}
	if (outcome.entries.length === 0) {
		return "No journal entries match this search.\n";
	}
	const lines = outcome.entries.map((entry) => {
		const gateLabel = entry.gate !== undefined ? `, gate ${entry.gate}` : "";
		return `- [${entry.kind}] (${entry.source}, session ${entry.sessionId}${gateLabel}, ${entry.ts}) ${entry.text}`;
	});
	return `${lines.join("\n")}\n`;
}

/** Wired to `@conductor/diary`'s `search(...)` (D6/G4). `--kind`/`--gate`/`--since`/`--until` are NOT
 * pre-validated here (see this file's header) -- `search.ts`'s own `validateKindFacet`/
 * `validateGateFacet`/`validateDateFacet` are the single owner, and their `unknown-facet` outcome is
 * surfaced verbatim by `formatSearchOutcome` above. */
export function runJournalSearch(options: JournalSearchOptions): string {
	const { entriesPath, projectId } = resolveJournalContext(options.cwd, options.homeDir);
	const reader = openJournalReader(entriesPath, projectId);
	const filters: JournalSearchFilters = {
		kind: options.kind,
		gate: options.gate,
		sessionId: options.sessionId,
		since: options.since,
		until: options.until,
		text: options.text,
	};
	const outcome = search(filters, reader);
	return formatSearchOutcome(outcome);
}

const SEARCH_VALUE_FLAGS = new Set(["--kind", "--gate", "--session", "--since", "--until", "--text"]);

export function parseJournalSearchArgs(args: string[]): ParseResult<{
	kind?: JournalKind[];
	gate?: number;
	sessionId?: string;
	since?: string;
	until?: string;
	text?: string;
}> {
	const values: Record<string, string> = {};
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (SEARCH_VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg);
				continue;
			}
			values[arg] = value;
			i += 1;
			continue;
		}
		unrecognized.push(arg);
	}

	if (unrecognized.length > 0) {
		return { ok: false, error: `unrecognized argument(s): ${unrecognized.join(" ")}` };
	}

	let gate: number | undefined;
	if (values["--gate"] !== undefined) {
		// Loosely parsed (may become NaN on garbage input) -- deliberately NOT bound-checked here; see
		// this file's header ("search's --gate deliberately does NOT duplicate that bound").
		gate = Number.parseInt(values["--gate"], 10);
	}

	return {
		ok: true,
		flags: {
			kind:
				values["--kind"] !== undefined
					? (values["--kind"].split(",").map((s) => s.trim()) as JournalKind[])
					: undefined,
			gate,
			sessionId: values["--session"],
			since: values["--since"],
			until: values["--until"],
			text: values["--text"],
		},
	};
}

// ==== journal digest ====

export interface JournalDigestOptions {
	cwd: string;
	sessionId?: string;
	homeDir?: string;
}

/** Wired to `@conductor/diary`'s `renderDigest(...)` (G5/FR-10/FR-11). Reads `reader.readAll()` (raw
 * history INCLUDING superseded entries, D7/§8.2 -- never `readActive()`) and, when `--session` was
 * given, filters to that session BEFORE handing the array to the pure renderer (see this file's header
 * for why that filtering lives here and not inside `renderDigest` itself). Returns the Markdown string
 * only -- `runJournalCommand`'s dispatcher decides whether it goes to stdout or to `--out <path>`. */
export function runJournalDigest(options: JournalDigestOptions): string {
	const { entriesPath, projectId } = resolveJournalContext(options.cwd, options.homeDir);
	const reader = openJournalReader(entriesPath, projectId);
	const allEntries = reader.readAll();
	const entries =
		options.sessionId === undefined
			? allEntries
			: allEntries.filter((entry) => entry.sessionId === options.sessionId);
	return renderDigest(entries);
}

const DIGEST_VALUE_FLAGS = new Set(["--session", "--out"]);

export function parseJournalDigestArgs(args: string[]): ParseResult<{ sessionId?: string; outPath?: string }> {
	const values: Record<string, string> = {};
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (DIGEST_VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg);
				continue;
			}
			values[arg] = value;
			i += 1;
			continue;
		}
		unrecognized.push(arg);
	}

	if (unrecognized.length > 0) {
		return { ok: false, error: `unrecognized argument(s): ${unrecognized.join(" ")}` };
	}

	return { ok: true, flags: { sessionId: values["--session"], outPath: values["--out"] } };
}

// ==== journal supersede ====

export interface JournalSupersedeOptions {
	cwd: string;
	id: string;
	mode: EditMode;
	text: string;
	homeDir?: string;
}

const EDIT_MODES: readonly EditMode[] = ["update", "forget", "invalidate"];

/** Wired to `@conductor/diary`'s `openJournalWriter(...).supersede(...)` (D7/§8.1). An unknown
 * `--id` is reported explicitly (the `KeyError` analogue, edge case 6) rather than silently creating a
 * dangling reference. */
export function runJournalSupersede(options: JournalSupersedeOptions): string {
	const { entriesPath } = resolveJournalContext(options.cwd, options.homeDir);
	const writer = openJournalWriter(entriesPath);
	const result = writer.supersede(options.id, options.text, options.mode);
	if (!result.ok) {
		throw new Error(`journal supersede: unknown entry id "${result.id}" -- nothing to supersede`);
	}
	return `Recorded correction ${result.entry.id} (supersedes ${options.id}, mode: ${options.mode}).\n`;
}

const SUPERSEDE_VALUE_FLAGS = new Set(["--id", "--mode"]);

export function parseJournalSupersedeArgs(args: string[]): ParseResult<{ id: string; mode: EditMode; text: string }> {
	let text: string | undefined;
	const values: Record<string, string> = {};
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (SUPERSEDE_VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg);
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
		if (text === undefined) {
			text = arg;
		} else {
			unrecognized.push(arg);
		}
	}

	if (unrecognized.length > 0) {
		return { ok: false, error: `unrecognized argument(s): ${unrecognized.join(" ")}` };
	}
	if (values["--id"] === undefined) {
		return { ok: false, error: "--id is required" };
	}
	if (values["--mode"] === undefined) {
		return { ok: false, error: `--mode is required (one of: ${EDIT_MODES.join(", ")})` };
	}
	if (!EDIT_MODES.includes(values["--mode"] as EditMode)) {
		return {
			ok: false,
			error: `--mode: "${values["--mode"]}" is not valid (must be one of: ${EDIT_MODES.join(", ")})`,
		};
	}
	if (text === undefined || text.trim().length === 0) {
		return { ok: false, error: 'a text is required, e.g. conductor journal supersede --id <id> --mode update "..."' };
	}

	return { ok: true, flags: { id: values["--id"], mode: values["--mode"] as EditMode, text } };
}

// ==== journal ingest (declared Non-goal this round -- see this file's header) ====

export interface JournalIngestOptions {
	cwd: string;
}

/** GATE 5/6-style stub -- ADR §16's Apêndice has no TypeScript contract for `journal ingest` (only
 * the CLI-shape line in "Superfície CLI"). Mirrors `library.ts`'s own `runLibraryIngest`/
 * `runLibraryUpdate` stubs (FR-9/FR-10): a named, reachable subcommand that throws "not implemented",
 * never a silently-ignored/invented pipeline. */
export function runJournalIngest(_options: JournalIngestOptions): string {
	throw new Error("not implemented");
}

// ==== dispatcher ====

interface JournalCliIO {
	cwd: string;
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
}

/**
 * `conductor journal <add|recall|search|digest|supersede|ingest>` dispatch (ADR §16 "Superfície CLI").
 * Same two-class split `library.ts`/`gate.ts` already established: argument-SHAPE parsing (`parseJournal*
 * Args`) is ordinary CLI plumbing, real and tested here; substantive behavior is delegated to the `run*`
 * functions above, each wired to the real `@conductor/diary` engine (no stubs left except `ingest`,
 * declared above).
 */
export async function runJournalCommand(args: string[], io: JournalCliIO): Promise<number> {
	const [sub, ...rest] = args;

	switch (sub) {
		case "add": {
			const parsed = parseJournalAddArgs(rest);
			if (!parsed.ok) {
				io.stderr.write(`conductor journal add: ${parsed.error}\n`);
				return 1;
			}
			try {
				io.stdout.write(runJournalAdd({ cwd: io.cwd, ...parsed.flags }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor journal add: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "recall": {
			const parsed = parseJournalRecallArgs(rest);
			if (!parsed.ok) {
				io.stderr.write(`conductor journal recall: ${parsed.error}\n`);
				return 1;
			}
			try {
				io.stdout.write(runJournalRecall({ cwd: io.cwd, ...parsed.flags }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor journal recall: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "search": {
			const parsed = parseJournalSearchArgs(rest);
			if (!parsed.ok) {
				io.stderr.write(`conductor journal search: ${parsed.error}\n`);
				return 1;
			}
			try {
				io.stdout.write(runJournalSearch({ cwd: io.cwd, ...parsed.flags }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor journal search: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "digest": {
			const parsed = parseJournalDigestArgs(rest);
			if (!parsed.ok) {
				io.stderr.write(`conductor journal digest: ${parsed.error}\n`);
				return 1;
			}
			try {
				const markdown = runJournalDigest({ cwd: io.cwd, sessionId: parsed.flags.sessionId });
				if (parsed.flags.outPath !== undefined) {
					// D4 §6.1: the digest is the ONLY Diary artifact allowed to touch the workspace -- writing
					// it is this dispatcher's job (runJournalDigest itself stays pure, returning Markdown only,
					// independently testable without any fs side effect).
					mkdirSync(dirname(parsed.flags.outPath), { recursive: true });
					writeFileSync(parsed.flags.outPath, markdown, "utf8");
					io.stdout.write(`Digest written to ${parsed.flags.outPath}\n`);
				} else {
					io.stdout.write(markdown);
				}
				return 0;
			} catch (error) {
				io.stderr.write(`conductor journal digest: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "supersede": {
			const parsed = parseJournalSupersedeArgs(rest);
			if (!parsed.ok) {
				io.stderr.write(`conductor journal supersede: ${parsed.error}\n`);
				return 1;
			}
			try {
				io.stdout.write(runJournalSupersede({ cwd: io.cwd, ...parsed.flags }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor journal supersede: ${describeError(error)}\n`);
				return 1;
			}
		}
		case "ingest": {
			try {
				io.stdout.write(runJournalIngest({ cwd: io.cwd }));
				return 0;
			} catch (error) {
				io.stderr.write(`conductor journal ingest: ${describeError(error)}\n`);
				return 1;
			}
		}
		default:
			io.stderr.write(
				`conductor journal: unknown subcommand "${sub ?? ""}". Usage: add | recall | search | digest | supersede | ingest\n`,
			);
			return 1;
	}
}
