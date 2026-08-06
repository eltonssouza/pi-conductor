/**
 * `git-status.ts` (docs/adr/0002-fase1-cli-foundation.md §7.2 item 3, §7.5) -- Gate 5 (red first).
 *
 * `commands/doctor.test.ts` already covers the "not a git repository" path (informational, never
 * "fail"). This file closes a real gap that predates round B2: nothing previously exercised the
 * "clean" / "dirty" / branch-name-reported paths against a REAL git repository -- every prior test
 * only had a plain (non-git) scratch directory available. Real `git init`/`git commit`/`git status`
 * against a scratch project, never mocked, matching this codebase's established convention.
 */

import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGitStatus, resolveTimeoutMs } from "../src/git-status.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

let project: ScratchProject;

function git(args: string[], cwd: string): void {
	execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initRepoWithOneCommit(root: string, branch: string): void {
	git(["init", "--initial-branch", branch], root);
	git(["config", "user.email", "conductor-test@example.invalid"], root);
	git(["config", "user.name", "Conductor Test"], root);
	git(["add", "."], root);
	git(["commit", "-m", "initial"], root);
}

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("getGitStatus", () => {
	it("reports 'unavailable' with an explanatory reason outside a git repository", async () => {
		const status = await getGitStatus(project.root, 5000);
		expect(status.kind).toBe("unavailable");
		if (status.kind === "unavailable") {
			expect(status.reason.toLowerCase()).toMatch(/not a git repository/);
		}
	});

	it("reports 'clean' with the current branch name for a repo with no uncommitted changes", async () => {
		project.write("README.md", "hello\n");
		initRepoWithOneCommit(project.root, "main");

		const status = await getGitStatus(project.root, 5000);
		expect(status.kind).toBe("clean");
		if (status.kind !== "unavailable") expect(status.branch).toBe("main");
	});

	it("reports 'dirty' with the branch name once a tracked file is modified", async () => {
		project.write("README.md", "hello\n");
		initRepoWithOneCommit(project.root, "feature/fase1-fundacao-do-produto");
		project.write("README.md", "hello, modified\n");

		const status = await getGitStatus(project.root, 5000);
		expect(status.kind).toBe("dirty");
		if (status.kind !== "unavailable") expect(status.branch).toBe("feature/fase1-fundacao-do-produto");
	});

	it("degrades to 'unavailable' (never throws) when the timeout is unreasonably low", async () => {
		project.write("README.md", "hello\n");
		initRepoWithOneCommit(project.root, "main");

		const status = await getGitStatus(project.root, 1);
		// Either it still made it under 1ms (unlikely but not impossible on a fast machine) or it
		// degraded to unavailable -- either way, it must never throw out of this function.
		expect(["clean", "dirty", "unavailable"]).toContain(status.kind);
	});
});

describe("resolveTimeoutMs", () => {
	it("falls back to the given default when the env value is unset", () => {
		expect(resolveTimeoutMs(undefined, 1234)).toBe(1234);
	});

	it("honors a valid positive override", () => {
		expect(resolveTimeoutMs("2500", 1234)).toBe(2500);
	});

	it("falls back to the default for non-numeric or non-positive overrides", () => {
		expect(resolveTimeoutMs("not-a-number", 1234)).toBe(1234);
		expect(resolveTimeoutMs("-5", 1234)).toBe(1234);
		expect(resolveTimeoutMs("0", 1234)).toBe(1234);
	});
});
