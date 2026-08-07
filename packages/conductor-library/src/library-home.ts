/**
 * `~/.conductor/library/**` path resolution -- BORDA: fs/os only (docs/adr/0006-fase5-library-and-
 * grounding.md D7/D9, §11.1, §12.1).
 *
 * GATE 5 (test-first): `resolveLibraryHome`/`computeProjectId` are STUBS that throw "not
 * implemented" -- Gate 6 implements the bodies. This file ships the signatures
 * test/library-home.test.ts and code-index.ts/grounding-ledger.ts's callers already compile and test
 * against.
 *
 * Layout (D9 §12.1):
 *   ~/.conductor/library/corpus.sqlite                     -- global corpus (books; public, shared)
 *   ~/.conductor/library/projects/<projectId>/code.sqlite  -- per-project code index (NEVER shared)
 *   ~/.conductor/library/projects/<projectId>/events.jsonl -- per-project grounding ledger (D13)
 *
 * The corpus is global on purpose (identical content for every project, D9 §12.1: duplicating it per
 * project would multiply ~9 MiB and ingestion time for nothing); the code index and ledger are NEVER
 * global -- that asymmetry is the fix for T51 (cross-project leakage via a shared collection).
 *
 * `~/.conductor/library` is added to `@conductor/runtime`'s `defaultProtectedPaths()` by this same
 * ADR (D9) -- that edit belongs to the parallel Gate 5 stream scoped to `@conductor/runtime`, not to
 * this file; this module only computes the paths, it does not decide who may write to them.
 *
 * `computeProjectId` uses the SAME algorithm as this monorepo's own precedent,
 * `packages/conductor-cli/src/commands/gate-store.ts`'s `resolveGateGitContext`
 * (`createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, 16)`), applied here to the
 * workspace's REAL (symlink-resolved) path rather than to a bare `cwd` string (D7 §10.2) -- so a
 * project reached via two different symlinks still gets one stable id, and `openCodeIndex`'s
 * `project-mismatch` check (D7 §10.2) has something durable to compare against.
 */

/** The per-scope paths D7/D9 define. `projectDir`/`codeDatabase`/`eventsLog` are functions of
 * `projectId` rather than fixed strings, because every project gets its OWN code index and ledger
 * (never the corpus's global sharing). */
export interface LibraryHomePaths {
	/** `~/.conductor/library` itself -- the whole subtree `defaultProtectedPaths()` protects (D9). */
	readonly root: string;
	/** `~/.conductor/library/corpus.sqlite` -- the one global corpus database (D9). */
	readonly corpusDatabase: string;
	/** `~/.conductor/library/projects/<projectId>` */
	projectDir(projectId: string): string;
	/** `~/.conductor/library/projects/<projectId>/code.sqlite` (D7). */
	codeDatabase(projectId: string): string;
	/** `~/.conductor/library/projects/<projectId>/events.jsonl` (D13). */
	eventsLog(projectId: string): string;
}

/**
 * Resolves the D7/D9 path layout rooted at `homeDir` (defaults to `os.homedir()` -- callers never
 * need to duplicate that lookup themselves).
 */
export function resolveLibraryHome(homeDir?: string): LibraryHomePaths {
	throw new Error("not implemented");
}

/**
 * `sha256(realpath(workspaceRoot)).slice(0, 16)` -- the same hashing discipline
 * `resolveGateGitContext` (gate-store.ts:366) already uses for `repoId`, applied here to a workspace's
 * REAL path so the id is stable across symlink aliases of the same project (D7 §10.2).
 */
export function computeProjectId(workspaceRealPath: string): string {
	throw new Error("not implemented");
}
