/**
 * Scratch workspace helper for tests. Every test gets its own throwaway directory under the OS
 * temp dir -- never the real repo. Mirrors packages/conductor-poc/test/support/workspace.ts's
 * pattern (same rationale: real filesystem operations, never mocked, but always against a
 * disposable directory).
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ScratchWorkspace {
	/** Canonicalized (realpath'd) absolute path to the workspace root. */
	root: string;
	cleanup(): void;
}

export function createScratchWorkspace(prefix = "conductor-config-"): ScratchWorkspace {
	const created = mkdtempSync(join(tmpdir(), prefix));
	// realpathSync matters on macOS, where tmpdir() itself is a symlink (/tmp -> /private/tmp):
	// without this, workspaceRoot as passed to resolveContainedConfigPath would never equal what
	// its own canonicalization produces, and every containment check would spuriously fail.
	const root = realpathSync(created);
	return {
		root,
		cleanup: () => {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
