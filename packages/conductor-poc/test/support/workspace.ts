/**
 * Scratch workspace helper for tests. Every test gets its own throwaway directory under the OS
 * temp dir — never the real repo (the task's binding requirement: "in a scratch/temp workspace
 * directory created for the test — never the real repo").
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ScratchWorkspace {
	/** Canonicalized (realpath'd) absolute path to the workspace root. */
	root: string;
	agentDir: string;
	cleanup(): void;
}

export function createScratchWorkspace(prefix = "conductor-poc-"): ScratchWorkspace {
	const created = mkdtempSync(join(tmpdir(), prefix));
	// realpathSync matters on macOS, where tmpdir() itself is a symlink (/tmp -> /private/tmp):
	// without this, workspaceRoot as passed to the policy would never equal what
	// resolveRealPath() canonicalizes it to, and every "inside the workspace" check would fail.
	const root = realpathSync(created);
	const agentDir = join(root, ".conductor-agent");
	mkdirSync(agentDir, { recursive: true });

	return {
		root,
		agentDir,
		cleanup: () => {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
