/**
 * Scratch per-machine "home" directory helper for tests that exercise the Diary's per-machine path
 * (`~/.conductor/diary/projects/<projectId>/entries.jsonl`, ADR 0007 D4/§6.1) -- never this developer's
 * real home directory. Mirrors `test/commands/journal.test.ts`'s own local `scratchHomeDir()` helper
 * (kept there as an independent copy, matching `scratch.ts`'s own documented "each test file/helper may
 * keep its own copy" convention); this shared version exists because two call sites added by the Gate 6
 * "captura automática" wiring closure need the exact same throwaway-homeDir-with-cleanup shape:
 * `chat.test.ts`'s automatic-capture tests and `gate-cli.acceptance.test.ts`'s gate-concluded capture
 * test.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ScratchHome {
	dir: string;
	cleanup(): void;
}

export function createScratchHome(prefix = "conductor-cli-home-"): ScratchHome {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return {
		dir,
		// Same retry/delay discipline as scratch.ts's own createScratchProject (Windows can transiently
		// hold a handle open on a just-written file).
		cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
	};
}
