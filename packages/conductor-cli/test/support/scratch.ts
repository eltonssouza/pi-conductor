/**
 * Scratch project helper for tests. Every test gets its own throwaway directory under the OS temp
 * dir -- never the real repo. Mirrors conductor-config/test/support/workspace.ts and
 * conductor-project/test/support/scratch.ts's own convention (each package keeps an independent
 * copy on purpose -- see conductor-project's header comment for the rationale carried over here).
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
	/** Reads `relPath` under the project root as UTF-8 text. */
	read(relPath: string): string;
	/** Reads and JSON-parses `relPath` under the project root. */
	readJson<T = unknown>(relPath: string): T;
	/** Creates an (empty) directory at `relPath`. */
	mkdir(relPath: string): void;
}

export function createScratchProject(prefix = "conductor-cli-"): ScratchProject {
	const created = mkdtempSync(join(tmpdir(), prefix));
	// realpathSync matters on macOS, where tmpdir() itself is a symlink (/tmp -> /private/tmp) --
	// without it, assertions built from join(project.root, ...) could disagree with paths
	// @conductor/config's own containment checks resolve to.
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
		read: (relPath) => readFileSync(resolve(relPath), "utf8"),
		readJson: (relPath) => JSON.parse(readFileSync(resolve(relPath), "utf8")),
		mkdir: (relPath) => mkdirSync(resolve(relPath), { recursive: true }),
	};
}
