/**
 * Workspace containment + protected-paths policy (pure functions, no I/O side effects beyond
 * fs.realpathSync/fs.existsSync reads).
 *
 * Binding requirements (docs/conductor/gate3-threat-model.md §4 T1/T2, §5 items 1/3):
 *   - Never do a lexical/string path check (see the naive examples/protected-paths.ts and
 *     examples/permission-gate.ts extensions shipped with Pi, which use `path.includes()` —
 *     exactly the anti-pattern this module replaces).
 *   - Canonicalize via fs.realpathSync, walking up to the nearest existing ancestor for paths
 *     that do not exist yet (so a not-yet-created file inside a workspace-escaping symlink chain
 *     is still caught).
 *   - A protected-paths deny-list is checked independently of (and before) workspace containment,
 *     so it still holds if the allowed roots are ever widened later.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

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
export function resolveRealPath(targetPath: string, baseDir: string): string {
	const absolute = isAbsolute(targetPath) ? targetPath : resolve(baseDir, targetPath);

	const remainder: string[] = [];
	let current = absolute;
	// The filesystem root (e.g. "/" or "C:\") always exists, so this loop is guaranteed to
	// terminate: worst case, it walks all the way up to the root and canonicalizes that.
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) {
			// Reached the filesystem root and even that doesn't exist — a genuine I/O oddity.
			// Let the caller's fail-closed wrapper turn this into a deny.
			throw new Error(`resolveRealPath: no existing ancestor found while resolving "${targetPath}"`);
		}
		remainder.unshift(basename(current));
		current = parent;
	}

	const realAncestor = realpathSync(current);
	return remainder.length > 0 ? join(realAncestor, ...remainder) : realAncestor;
}

/** True when `candidateRealPath` is `rootRealPath` or a descendant of it. Both must already be real paths. */
export function isWithinRoot(candidateRealPath: string, rootRealPath: string): boolean {
	if (candidateRealPath === rootRealPath) return true;
	// Compare with a trailing separator so "/workspace-evil" cannot pass as being "within"
	// "/workspace" via a naive startsWith() substring match.
	const rootWithSep = rootRealPath.endsWith(sep) ? rootRealPath : rootRealPath + sep;
	return candidateRealPath.startsWith(rootWithSep);
}

/**
 * The default protected-paths list (plan §4.3 / gate3-threat-model.md §5 item 3): credential and
 * config directories that must never be reachable by write/edit/bash, independent of workspace
 * containment. Paths under the home directory do not need to exist to be protected — a tool must
 * not be able to *create* ~/.ssh either.
 */
export function defaultProtectedPaths(): string[] {
	const home = homedir();
	return [
		join(home, ".ssh"),
		join(home, ".aws"),
		join(home, ".gnupg"),
		join(home, ".kube"),
		join(home, ".docker"),
		join(home, ".config"),
		join(home, ".conductor", "credentials"),
	];
}

/** Canonicalize a protected-path entry without requiring it to exist (see defaultProtectedPaths()). */
function realpathOfExistingAncestorOrLexical(candidatePath: string): string {
	try {
		return resolveRealPath(candidatePath, candidatePath);
	} catch {
		// Should not happen in practice (the filesystem root always exists), but if it does,
		// fall back to the lexical absolute path rather than throwing out of a protected-paths
		// check — under-protecting here would be worse than a purely lexical fallback.
		return candidatePath;
	}
}

/**
 * Evaluate whether a tool-supplied path is allowed: not in a protected location, and contained
 * within the workspace root. Never throws for an ordinary "path is outside" case — returns
 * `{ allowed: false, reason }` instead. May throw for a genuine I/O error, which callers must
 * handle fail-closed (see fail-closed.ts).
 */
export function evaluateToolPath(rawPath: string, options: WorkspacePolicyOptions): PathCheckResult {
	const workspaceReal = resolveRealPath(options.workspaceRoot, options.workspaceRoot);
	const targetReal = resolveRealPath(rawPath, options.workspaceRoot);

	const protectedRoots = [...defaultProtectedPaths(), ...(options.additionalProtectedPaths ?? [])];
	for (const protectedPath of protectedRoots) {
		const protectedReal = realpathOfExistingAncestorOrLexical(protectedPath);
		if (isWithinRoot(targetReal, protectedReal)) {
			return {
				allowed: false,
				reason: `"${rawPath}" resolves into a protected location (${protectedPath})`,
				realPath: targetReal,
			};
		}
	}

	if (!isWithinRoot(targetReal, workspaceReal)) {
		return {
			allowed: false,
			reason: `"${rawPath}" resolves outside the workspace root`,
			realPath: targetReal,
		};
	}

	return { allowed: true, realPath: targetReal };
}
