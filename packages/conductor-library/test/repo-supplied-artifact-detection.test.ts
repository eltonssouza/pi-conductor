/**
 * Gate 9 (T56/R37): the detection primitive `openCodeIndex` already uses by path — factored out so the
 * composition root (`library status`) can reuse the SAME "detect by path alone, never open" check to
 * audit + escalate a repo-supplied `.conductor/library` artifact (gate3-addendum-fase5.md §8.3 R37).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectRepoSuppliedLibraryArtifact, openCodeIndex } from "../src/code-index.ts";

const scratch: string[] = [];
function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "poc-detect-"));
	scratch.push(dir);
	return dir;
}
afterEach(() => {
	while (scratch.length > 0) {
		const dir = scratch.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("detectRepoSuppliedLibraryArtifact (R37: detect by path alone, never opening the file)", () => {
	it("reports detected:true and names the `.conductor/library` path when the artifact exists under the workspace", () => {
		const ws = scratchDir();
		const artifact = join(ws, ".conductor", "library");
		mkdirSync(artifact, { recursive: true });

		const result = detectRepoSuppliedLibraryArtifact(ws);

		expect(result.detected).toBe(true);
		expect(result.path).toBe(artifact);
	});

	it("reports detected:false for a clean workspace (still names the path it checked)", () => {
		const ws = scratchDir();

		const result = detectRepoSuppliedLibraryArtifact(ws);

		expect(result.detected).toBe(false);
		expect(result.path).toBe(join(ws, ".conductor", "library"));
	});

	it("openCodeIndex still returns repo-supplied-path-refused (the detector is a refactor, not a behavior change)", () => {
		const ws = scratchDir();
		mkdirSync(join(ws, ".conductor", "library"), { recursive: true });

		const home = {
			root: scratchDir(),
			corpusDatabase: "x",
			projectDir: (id: string) => id,
			codeDatabase: (id: string) => id,
			eventsLog: (id: string) => id,
		};
		expect(openCodeIndex("any", ws, { home })).toEqual({ ok: false, reason: "repo-supplied-path-refused" });
	});
});
