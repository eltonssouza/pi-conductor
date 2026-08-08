/**
 * Tests for `landOnDevelop` (`src/commands/auto.ts`) — Gate 8 loop-back, finding 4: FR-15 ("todos os
 * gates aplicáveis aprovados... a branch recebe push e é aterrissada em develop... run termina com
 * status landed") was previously satisfied by a bare `stdout.write` claiming "landed" with no git/gh
 * operation behind it at all -- this is the real implementation's own test coverage.
 *
 * `landOnDevelop` shells out to `gh` (execFileSync, mirroring `safeGit`'s own never-throws contract) --
 * these tests exercise it against a REAL, LOCAL-ONLY git repo (no `origin` remote, never a network call
 * that could touch a real GitHub repo), so `gh pr view`/`gh pr create` fail deterministically for a real,
 * safe reason ("no git remotes found" / no `gh` auth for an unknown repo) regardless of whether `gh`
 * itself happens to be installed/authenticated on the machine running this suite -- the same "real
 * collaborator, safe environment" discipline `gate-cli.acceptance.test.ts`'s own `git`-backed tests
 * already establish for this package.
 */

import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { landOnDevelop } from "../../src/commands/auto.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
		.toString()
		.trim();
}

function initRepoWithOneCommit(root: string, branch: string): void {
	git(["init", "--initial-branch", branch], root);
	git(["config", "user.email", "conductor-test@example.invalid"], root);
	git(["config", "user.name", "Conductor Test"], root);
	git(["commit", "--allow-empty", "-m", "initial"], root);
}

describe("landOnDevelop — Gate 8 loop-back, finding 4: a real git/gh operation, never a bare success claim", () => {
	it("reports ok:false (never a fabricated 'landed') when it cannot open or confirm a PR -- a repo with no GitHub remote at all, the actual state every scratch/local-only repo is in", () => {
		initRepoWithOneCommit(project.root, "feature/demand-1");

		const result = landOnDevelop(project.root, "feature/demand-1");

		// Real proof of the finding: the function never claims success it cannot back up. Whatever the
		// exact `gh` failure reason (missing binary, unauthenticated, "no git remotes found" for this
		// remote-less repo), the caller (`runAuto`) must be told this explicitly so it can fall back to
		// `needs-human` instead of printing "landed" -- the defect this finding names.
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/gh|pr|manually/i);
			// The reason must be actionable -- naming the manual fallback command, never a bare "failed".
			expect(result.reason).toMatch(/pr create/i);
		}
	});

	it("never throws even when cwd is not a git repository at all (fail-closed reporting, not a crash)", () => {
		// No git init at all -- project.root is a plain directory.
		expect(() => landOnDevelop(project.root, "feature/demand-1")).not.toThrow();
		const result = landOnDevelop(project.root, "feature/demand-1");
		expect(result.ok).toBe(false);
	});
});
