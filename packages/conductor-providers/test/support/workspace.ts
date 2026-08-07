/**
 * Scratch workspace helper for tests -- mirrors packages/conductor-runtime/test/support/workspace.ts
 * (same convention across this monorepo's Gate-5 suites). Every test gets its own throwaway directory
 * under the OS temp dir, never the real repo/home -- required for the F1/usage-ledger tests that do
 * real fs I/O (grounding-ledger.ts's own molde, ADR 0008 D9/§11.2), and for any test that constructs a
 * real ModelRuntime (never pointed at the developer's real ~/.pi/agent/auth.json or models.json).
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

export function createScratchWorkspace(prefix = "conductor-providers-"): ScratchWorkspace {
	const created = mkdtempSync(join(tmpdir(), prefix));
	// realpathSync matters on macOS, where tmpdir() itself is a symlink (/tmp -> /private/tmp).
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
