/**
 * `@conductor/diary` -- the journal WRITER (BORDA: fs; synchronous, THROWS on I/O failure -- the exact
 * mold `@conductor/library`'s `grounding-ledger.ts` writer already established for a sibling append-only
 * log, docs/adr/0007-fase6-diary-and-capture.md D1/§3.1, D7/§8, D8/§10).
 *
 * GATE 6 (this implementation): `openJournalWriter` mints `id`/`schemaVersion`/`ts`, resolves
 * best-effort `provenance`, deep-redacts every leaf string, and appends synchronously
 * (`appendFileSync`, mode `0o600`, `flag: "a"`), throwing on any genuine I/O failure -- never
 * swallowing one, the same reason `grounding-ledger.ts`'s own `appendEvent` has no try/catch of its own.
 *
 * GATE 8 RESOLUTION on D8/§10.1's "reuse `redactSessionEntryForPersistence`/`deepRedact`... the redaction
 * happens at the ONE point of write (the JournalWriter), never presuming an upstream caller already
 * redacted" (FR-20: "a redação usa redactSecrets (@conductor/runtime), nunca uma segunda implementação...
 * nunca um detector de segredo próprio e paralelo do Diary"): Gate 6 shipped a LOCAL structural port of
 * `@conductor/runtime/src/redaction.ts`'s `deepRedact`/`redactLeaf` here, reasoning that
 * `@conductor/runtime` carries the full `pi-agent-core`/`pi-ai`/`pi-coding-agent` chain as real
 * transitive dependencies -- weight a local JSONL-append package has no reason to pull in. That weight
 * concern was correct, but the fix it produced was not: duplicating the ~15-LOC tree-walking glue was
 * itself a second, parallel implementation of the Diary's own redaction primitive, which is exactly what
 * FR-20 forbids, regardless of whether the underlying matcher stayed shared. The actual fix is not "avoid
 * `@conductor/runtime`" (that reasoning still holds) -- it is "the shared glue belongs in
 * `@conductor/secrets`, the zero-dependency leaf both packages already depend on directly, precisely so
 * neither has to duplicate it." `deepRedact` now lives there (alongside the matcher it wraps and the
 * `SECRET_SCAN_FAILED_PLACEHOLDER` fallback), and this file imports it directly -- `@conductor/runtime`'s
 * own `redactSessionEntryForPersistence` imports the SAME function, so there is exactly one deep-redact
 * implementation in the whole monorepo, not two byte-identical ones. `@conductor/diary`'s `package.json`
 * still declares zero dependency on `@conductor/runtime` (unchanged from Gate 6); it depends only on
 * `@conductor/secrets`, which it already did.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { deepRedact } from "@conductor/secrets";
import type { EditMode, JournalAddInput, JournalEntry, JournalProvenance } from "./journal-entry.ts";
import { openJournalReader } from "./journal-reader.ts";

export interface JournalWriter {
	/** Manual (`journal add`) or captured (D5's `curateCaptureEvent` output). Mints the `id`, appends
	 * synchronously. THROWS on I/O failure -- never swallows one (the writer half of the
	 * `grounding-ledger.ts` mold). See this file's header for the redaction-ownership decision. */
	append(input: JournalAddInput): JournalEntry;
	/** Append-only correction (D7): a new record with `supersedes`, inheriting session/gate/kind/author
	 * from the original, fresh provenance. Refuses (WITHOUT throwing) an `originalId` this log has never
	 * recorded. */
	supersede(
		originalId: string,
		newText: string,
		mode: EditMode,
	): { ok: true; entry: JournalEntry } | { ok: false; kind: "unknown-entry"; id: string };
}

/** Env override for the best-effort git provenance calls below (quality-baseline category 4: no
 * hardcoded timeouts). Kept local to this file rather than importing `conductor-cli`'s own
 * `resolveTimeoutMs`/`DEFAULT_GIT_STATUS_TIMEOUT_MS` (git-status.ts): `@conductor/cli` is the
 * composition root that depends on `@conductor/diary`, never the reverse -- importing it here would
 * invert the dependency direction ADR 0007 §5.1/D3 fixes for this package. A ~10-line duplicate of the
 * same "parse env, fall back to a positive default" shape is the acceptable structural duplication D3
 * already accepts for the RRF fusion loop, not a second source of truth for anything security-relevant. */
const DEFAULT_GIT_PROVENANCE_TIMEOUT_MS = 2000;

function resolveGitTimeoutMs(): number {
	const raw = process.env.CONDUCTOR_DIARY_GIT_TIMEOUT_MS;
	if (raw === undefined) return DEFAULT_GIT_PROVENANCE_TIMEOUT_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GIT_PROVENANCE_TIMEOUT_MS;
}

/** Runs one git subcommand, best-effort: any failure (not a repo, git missing from PATH, timeout,
 * empty output) collapses to `undefined` -- never throws, so a caller resolving one provenance field
 * can never abort resolution of the others (BR-3/FR-3's "each field INDEPENDENTLY omitted"). Mirrors
 * `conductor-cli/git-status.ts:gitCommitExistsSync`'s `execFileSync` + explicit `timeout` discipline
 * (an argument array, never a shell string, so no argument is ever shell-interpreted). */
function tryGit(args: readonly string[], cwd: string, timeoutMs: number): string | undefined {
	try {
		const output = execFileSync("git", args, {
			cwd,
			timeout: timeoutMs,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const trimmed = output.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	} catch {
		// Not a git repository, git not on PATH, a timeout, or any other failure -- provenance is
		// best-effort and must never fail the journal write itself (BR-3/FR-3).
		return undefined;
	}
}

/** Best-effort provenance (BR-3/FR-3): each of `branch`/`sha`/`repo` is resolved by its OWN independent
 * git invocation and independently omitted on failure -- never a single combined call whose partial
 * failure would take a sibling field down with it. `sha` is machine-read from HEAD, never derived from
 * `text` (BR-8). GATE-6 DECISION (undocumented by the ADR/tests, so recorded here): `repo` resolves to
 * the basename of `git rev-parse --show-toplevel` -- a human-readable project name for an audit trail,
 * deliberately NOT `git remote get-url origin` (many local-only repos, including this monorepo's own
 * scratch/test fixtures, have no remote at all -- ADR 0005 §15 already left remote-derived identity as
 * an explicitly open question for a sibling field, `repoId`, for the same reason) and NOT a hash (that
 * role belongs to `computeProjectId`/`projectId`, a different field with a different job: partitioning,
 * not human-readable provenance). */
function resolveProvenance(cwd: string): JournalProvenance {
	const timeoutMs = resolveGitTimeoutMs();
	const provenance: JournalProvenance = {};
	const branch = tryGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd, timeoutMs);
	if (branch !== undefined) provenance.branch = branch;
	const sha = tryGit(["rev-parse", "HEAD"], cwd, timeoutMs);
	if (sha !== undefined) provenance.sha = sha;
	const topLevel = tryGit(["rev-parse", "--show-toplevel"], cwd, timeoutMs);
	if (topLevel !== undefined) provenance.repo = basename(topLevel);
	return provenance;
}

/** Opens (creating the parent directory if necessary) the append-only JSONL journal at `entriesPath` for
 * writing. */
export function openJournalWriter(entriesPath: string): JournalWriter {
	/** Deep-redacts `entry` (D8/§10.1: every leaf string, before the entry ever touches disk) and appends
	 * the result as one JSONL line. Synchronous end-to-end (`mkdirSync` + `appendFileSync`, mode `0o600`,
	 * `flag: "a"` -- never truncates/rewrites a prior line), mirroring `grounding-ledger.ts`'s own
	 * `appendEvent`. No try/catch around the fs calls, on purpose (D1/§16: "a caller that believes an
	 * entry was recorded when the write actually failed silently is a worse lie than a thrown error").
	 * Returns the REDACTED entry, not the pre-redaction one -- the caller's in-memory return value never
	 * holds a copy of anything this function decided was unsafe to persist, and it matches exactly what
	 * `readAll()`/`readActive()` will later read back from disk. */
	function appendEntry(entry: JournalEntry): JournalEntry {
		const redacted = deepRedact(entry) as JournalEntry;
		const line = `${JSON.stringify(redacted)}\n`;
		mkdirSync(dirname(entriesPath), { recursive: true });
		appendFileSync(entriesPath, line, { encoding: "utf8", mode: 0o600, flag: "a" });
		return redacted;
	}

	return {
		append(input: JournalAddInput): JournalEntry {
			const entry: JournalEntry = {
				id: randomUUID(),
				schemaVersion: 1,
				ts: new Date().toISOString(),
				sessionId: input.sessionId,
				author: input.author,
				kind: input.kind,
				gate: input.gate,
				source: input.source,
				text: input.text,
				provenance: resolveProvenance(process.cwd()),
			};
			return appendEntry(entry);
		},

		supersede(
			originalId: string,
			newText: string,
			mode: EditMode,
		): { ok: true; entry: JournalEntry } | { ok: false; kind: "unknown-entry"; id: string } {
			// Reuses the reader (D7/§8.1's own note: "pode reusar um reader interno ou reimplementar
			// leitura mínima -- decida, documente a escolha"). GATE-6 DECISION: reuse, not reimplement --
			// duplicating corrupted-line-skipping/shape-checking here would be a second, drifting parser
			// for the exact same file (DRY; the Pragmatic Programmer's "don't duplicate knowledge"). The
			// `projectId` argument is a documented no-op for filtering here (journal-reader.ts's own
			// header: "JournalEntry itself carries no projectId field... partitioning is a property of
			// WHICH FILE the caller opens, not a per-record filter") -- an empty string is passed rather
			// than inventing an identity this writer was never given.
			const reader = openJournalReader(entriesPath, "");
			const original = reader.readAll().find((candidate) => candidate.id === originalId);
			if (!original) {
				return { ok: false, kind: "unknown-entry", id: originalId };
			}

			const entry: JournalEntry = {
				id: randomUUID(),
				schemaVersion: 1,
				ts: new Date().toISOString(),
				// Inherits sessionId/gate/kind/author from the original (D7/§8.1: "uma correção pertence à
				// mesma conversa e gate"). `source` is NOT in that inherited list (ADR §8.1/§16 name only
				// session/gate/kind/author) and no test constrains it -- GATE-6 DECISION: a correction is
				// always `"manual"`, since `journal supersede` (the only production caller, §16's CLI
				// surface) is inherently a deliberate human/agent-issued command, never itself a captured
				// observation, regardless of what kind of entry the ORIGINAL was.
				sessionId: original.sessionId,
				author: original.author,
				kind: original.kind,
				gate: original.gate,
				source: "manual",
				text: newText,
				// Fresh provenance (D7/§8.1: "uma correção feita de outra branch/commit deve dizê-lo") --
				// never inherited from the original.
				provenance: resolveProvenance(process.cwd()),
				supersedes: originalId,
				editMode: mode,
			};
			return { ok: true, entry: appendEntry(entry) };
		},
	};
}
