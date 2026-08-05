/**
 * Write `.conductor/config.json` (docs/adr/0002-fase1-cli-foundation.md §5.3).
 *
 * Two binding requirements from docs/conductor/gate3-fase1-addendum.md, enforced here:
 *   - T11 (secure default 8): never accept a raw secret/credential value -- validated (shape, then
 *     secret-scan) BEFORE any filesystem write happens; a rejected write touches disk not at all.
 *   - T16 (secure default 12): never silently clobber an existing config.json -- back it up first,
 *     with a unique timestamped filename so successive writes don't lose earlier history, and
 *     write the new content via write-temp-then-rename so a crash mid-write cannot corrupt the
 *     file that was already there (Software Construction Practices - Complete Professional Guide
 *     §2.8: "bad data can't travel far before being caught" -- applied here as "a half-written file
 *     must never replace a good one").
 *
 * Path containment (workspace-containment.ts) is checked before either concern: a write that would
 * land outside `workspaceRoot/.conductor/` is refused before mkdir/backup/write are ever attempted.
 */

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConductorConfig } from "./schema.ts";
import { assertValidConfigShape } from "./schema-validation.ts";
import { assertNoRawSecrets } from "./secret-detection.ts";
import { resolveContainedConfigPath } from "./workspace-containment.ts";

export interface WriteConfigResult {
	configPath: string;
	/** Path to the backup written before overwriting, or undefined when there was nothing to back up (first write). */
	backupPath?: string;
}

export function writeConfig(workspaceRoot: string, config: ConductorConfig): WriteConfigResult {
	// Fail fast, before touching the filesystem at all: structural shape first, then the T11
	// secret scan. Order matters for clear error messages (a malformed config should say so, not
	// report a spurious secret-shape mismatch on a field that isn't even the right type) but both
	// checks must pass before resolveContainedConfigPath/mkdir/write are ever reached.
	assertValidConfigShape(config);
	assertNoRawSecrets(config);

	const { configRealPath, conductorDirRealPath } = resolveContainedConfigPath(workspaceRoot);
	mkdirSync(conductorDirRealPath, { recursive: true });

	let backupPath: string | undefined;
	if (existsSync(configRealPath)) {
		// T16: back up the pre-existing file before it is overwritten. Timestamp + random suffix
		// keeps every prior version distinct, so a run of several writes doesn't have one backup
		// clobber the record of the write before it.
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const unique = randomBytes(4).toString("hex");
		backupPath = `${configRealPath}.bak-${stamp}-${unique}`;
		copyFileSync(configRealPath, backupPath);
	}

	// Write-temp-then-rename: configRealPath is only ever replaced by a rename, never truncated in
	// place, so a failure mid-serialize can't leave a half-written config.json behind.
	const tempPath = join(conductorDirRealPath, `.config.json.tmp-${randomBytes(4).toString("hex")}`);
	const serialized = `${JSON.stringify(config, null, "\t")}\n`;
	writeFileSync(tempPath, serialized, "utf8");
	renameSync(tempPath, configRealPath);

	return { configPath: configRealPath, backupPath };
}
