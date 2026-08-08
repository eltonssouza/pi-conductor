/**
 * GAP-A (ADR 0010 "Wiring de delegação real de subagentes em runAuto" §9/D7, gate3-addendum
 * T83/R64, gate2-spec FR-5a): `runtimeRecordedDelegationSessionIds` must be populated EXCLUSIVELY by
 * what THIS process observed a `createGovernedChildSessionSpawner` call complete -- never by scanning
 * `.conductor-agent/sessions/tasks/` (or any other disk location) to "recover" a `sessionId` from a
 * prior process invocation on `--continue`. That directory is writable by a hostile clone BEFORE a
 * resume, so a disk-reconstruction shortcut would let a planted `*.json` forge delegation evidence.
 *
 * DESIGN CHOICE, STATED (the task's own instructions leave this call to the author): this is a STATIC
 * source-text scan, not a live behavioral test. A behavioral proof would need two genuinely SEPARATE
 * process invocations (one that observes a real spawn, a second `--continue` in a fresh process with an
 * empty in-memory Set) -- reconstructing that within a single vitest test either means shelling out to a
 * real `node` subprocess (heavy, slow, wrong tier for this suite) or asserting against a freshly
 * literal, empty `Set` passed straight into the SAME process's call, which proves only "an empty Set
 * starts empty", nothing about the IMPLEMENTATION's own behavior. A static scan instead locks in the
 * INVARIANT directly and cheaply, mirroring this monorepo's own established precedent for exactly this
 * class of architectural guarantee: `@conductor/runtime`'s `test/tools/task-sole-constructor.test.ts`
 * (scans source text for a forbidden/bounded call-site pattern, never executes anything). Grounding:
 * `cdt library "characterization test via static source scan versus a live behavioral test to prove an
 * in-process-only invariant" --gate 5` (from C:\development\source\projects\conductor) returned
 * **Working with Legacy Code -- Complete Professional Guide §3.2 "sprout and wrap; characterization
 * tests"** (top 0.619) and **Spec-Driven Development -- The Complete Book §16.3 "Specs as a Safety Net
 * for Changes"** (0.609) -- moderate coverage; the closest available match, not a forced fit. This test
 * genuinely runs today (it does not depend on `runGateDelegation` being implemented) and stays a real
 * regression guard forever after: a future edit that adds a `readdirSync`/disk-reconstruction shortcut
 * to `auto.ts` fails this test immediately, without needing to know how Gate 6 implemented anything
 * else.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMMANDS_DIR = fileURLToPath(new URL("../../src/commands", import.meta.url));

/** Every file in `src/commands/` whose name starts with "auto" -- the delegation-evidence path this
 * demand touches (`auto.ts`, `auto-delegation-templates.ts`), never the whole package (a scan that
 * broad would also flag legitimate, unrelated `readdirSync` callers elsewhere in this CLI, e.g. a
 * catalog loader, diluting what this specific regression guard is actually about). */
function delegationPathFiles(): string[] {
	return readdirSync(COMMANDS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.startsWith("auto") && entry.name.endsWith(".ts"))
		.map((entry) => join(COMMANDS_DIR, entry.name));
}

describe("auto*.ts (the delegation-evidence path) -- GAP-A: never reads .conductor-agent/sessions/tasks/ (or any directory) to reconstruct delegation session ids", () => {
	it("covers at least auto.ts and auto-delegation-templates.ts -- a sanity check on the scan's own scope, so a rename that silently excludes the real target file cannot make this suite vacuously pass", () => {
		const files = delegationPathFiles().map((f) => f.split(/[/\\]/).pop());
		expect(files).toContain("auto.ts");
		expect(files).toContain("auto-delegation-templates.ts");
	});

	it("never calls readdirSync -- the one directory-listing primitive that could plausibly enumerate a prior process's session files; this file's own checkpoint/audit reads are all readFileSync/writeFileSync on a single named path, never a directory scan", () => {
		for (const file of delegationPathFiles()) {
			const source = readFileSync(file, "utf8");
			expect(source, `${file} must never call readdirSync`).not.toMatch(/\breaddirSync\s*\(/);
		}
	});

	it("never names the .conductor-agent/sessions/tasks path at all (either separator style) -- the ONE directory a child SessionManager (tools/task.ts's own createGovernedChildSessionSpawner) writes disc-backed session files into, and the only plausible target of a future disk-reconstruction shortcut", () => {
		for (const file of delegationPathFiles()) {
			const source = readFileSync(file, "utf8");
			expect(source, `${file} must never mention .conductor-agent/sessions/tasks`).not.toMatch(
				/\.conductor-agent[/\\]sessions[/\\]tasks/,
			);
		}
	});
});
