import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Directories never worth scanning for manifests (vendored deps, build output, virtualenvs).
 * Ported verbatim from conductor-main/conductor/project.py's `SKIP_DIRS`. Hidden directories
 * (`.git`, `.cdt`, `.venv` would also match this way, ...) are skipped separately in `searchRoots`
 * below, by name prefix rather than by this set — `.venv` is listed here too only because the
 * Python source lists it redundantly; kept for a faithful port, not because it does anything the
 * hidden-prefix check wouldn't already do.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"bin",
	"obj",
	"vendor",
	"coverage",
	"tmp",
	"temp",
	"__pycache__",
	"venv",
	".venv",
	"env",
	"site-packages",
]);

/** How deep below a root to look for manifests (root = 0). Ported from `project.py`'s `MAX_DEPTH`. */
export const MAX_DEPTH = 2;

function assertValidRoot(root: string): void {
	if (typeof root !== "string" || root.trim() === "") {
		throw new Error("conductor-project: root must be a non-empty path");
	}
}

/**
 * Root plus its subdirectories up to `MAX_DEPTH`, skipping noise/hidden dirs.
 *
 * Monorepo-aware manifest search base: a fullstack repo with `backend/` and `frontend/` packages
 * is discovered even when the root holds only a thin shell. Ported from
 * conductor-main/conductor/project.py's `search_roots`.
 *
 * Deliberately NOT an `rglob`-then-filter: the skip-list (`SKIP_DIRS` + the hidden-dir check) is
 * applied AT EACH DIRECTORY LEVEL, before ever descending into a child, so a huge ignored tree
 * (`node_modules`, `.git`, `dist`, ...) is never walked in the first place. A naive
 * "list everything recursively, then filter the results" pays the full cost of descending into
 * that tree before a single result is discarded — and, per this project's own documented incident
 * (conductor-main/CLAUDE.md, "Never rglob+filter over a project tree"), a single unreadable entry
 * deep inside such a tree can silently truncate the whole walk if the error handling isn't scoped
 * to the one entry that failed. This function scopes its own `readdirSync` failure to the one
 * directory being read (skip it, keep every root already collected), never to the whole walk.
 */
export function searchRoots(root: string): string[] {
	assertValidRoot(root);
	const roots: string[] = [root];

	function walk(dir: string, depth: number): void {
		if (depth > MAX_DEPTH) return;

		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			// Unreadable directory (permissions, a race with deletion, a broken reparse point on
			// Windows) — skip just this one directory, never the whole walk.
			return;
		}

		const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of sorted) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
			const child = join(dir, entry.name);
			roots.push(child);
			walk(child, depth + 1);
		}
	}

	walk(root, 1);
	return roots;
}
