/**
 * Workspace containment + protected-paths policy (pure functions, no I/O side effects beyond
 * fs.realpathSync/fs.existsSync reads).
 *
 * Binding requirements (docs/conductor/gate3-threat-model.md §4 T1/T2, §5 items 1/3):
 *   - Never do a lexical/string path check (see the naive examples.protected-paths.ts and
 *     examples/permission-gate.ts extensions shipped with Pi, which use `path.includes()` —
 *     exactly the anti-pattern this module replaces).
 *   - Canonicalize via fs.realpathSync, walking up to the nearest existing ancestor for paths
 *     that do not exist yet (so a not-yet-created file inside a workspace-escaping symlink chain
 *     is still caught).
 *   - A protected-paths deny-list is checked independently of (and before) workspace containment,
 *     so it still holds if the allowed roots are ever widened later.
 */

export interface WorkspacePolicyOptions {
	/** Absolute path to the workspace root. Must already exist. */
	workspaceRoot: string;
	/** Extra absolute paths to deny, beyond defaultProtectedPaths(). */
	additionalProtectedPaths?: string[];
}

export interface PathCheckResult {
	allowed: boolean;
	reason?: string;
	/** The canonicalized real path that was actually evaluated. */
	realPath?: string;
}

/**
 * Resolve `targetPath` (relative or absolute) to its canonical real path, resolving symlinks.
 * For a path that does not exist yet, walks up to the nearest existing ancestor, canonicalizes
 * that ancestor, and rejoins the non-existent remainder.
 */
export function resolveRealPath(_targetPath: string, _baseDir: string): string {
	throw new Error("not implemented");
}

/** True when `candidateRealPath` is `rootRealPath` or a descendant of it. Both must already be real paths. */
export function isWithinRoot(_candidateRealPath: string, _rootRealPath: string): boolean {
	throw new Error("not implemented");
}

/**
 * The default protected-paths list (plan §4.3 / gate3-threat-model.md §5 item 3): credential and
 * config directories that must never be reachable by write/edit/bash, independent of workspace
 * containment.
 */
export function defaultProtectedPaths(): string[] {
	throw new Error("not implemented");
}

/**
 * Evaluate whether a tool-supplied path is allowed: not in a protected location, and contained
 * within the workspace root. Never throws for an ordinary "path is outside" case — returns
 * `{ allowed: false, reason }` instead. May throw for a genuine I/O error, which callers must
 * handle fail-closed (see fail-closed.ts).
 */
export function evaluateToolPath(_rawPath: string, _options: WorkspacePolicyOptions): PathCheckResult {
	throw new Error("not implemented");
}
