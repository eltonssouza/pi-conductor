/**
 * Scratch project helper for tests. Every test gets its own throwaway directory under the OS temp
 * dir — never the real repo — mirroring conductor-poc/test/support/workspace.ts's own rationale.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface ScratchProject {
	/** Canonicalized (realpath'd) absolute path to the scratch project root. */
	root: string;
	cleanup(): void;
	/** Writes `content` to `relPath` under the project root, creating parent dirs as needed. */
	write(relPath: string, content: string): void;
	/** Writes `content` as pretty-printed JSON to `relPath`. */
	writeJson(relPath: string, content: unknown): void;
	/** Creates an (empty) directory at `relPath`. */
	mkdir(relPath: string): void;
}

export function createScratchProject(prefix = "conductor-project-"): ScratchProject {
	const created = mkdtempSync(join(tmpdir(), prefix));
	// realpathSync matters on macOS, where tmpdir() itself is a symlink (/tmp -> /private/tmp) —
	// without it, assertions built from `join(project.root, ...)` could disagree with paths this
	// package's own fs calls resolve to.
	const root = realpathSync(created);

	const resolve = (relPath: string) => join(root, relPath);

	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
		write: (relPath, content) => {
			const p = resolve(relPath);
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, content);
		},
		writeJson: (relPath, content) => {
			const p = resolve(relPath);
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, JSON.stringify(content, null, 2));
		},
		mkdir: (relPath) => mkdirSync(resolve(relPath), { recursive: true }),
	};
}
