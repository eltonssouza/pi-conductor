import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKIP_DIRS, searchRoots } from "../src/walk.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("searchRoots", () => {
	it("throws a clear error for an empty-string root rather than misbehaving silently", () => {
		expect(() => searchRoots("")).toThrow(/non-empty path/);
	});

	it("throws a clear error for a non-string root (defensive runtime guard, beyond the type system)", () => {
		const notAPath = null as unknown as string;
		expect(() => searchRoots(notAPath)).toThrow(/non-empty path/);
	});

	it("returns just the root itself when there are no subdirectories", () => {
		expect(searchRoots(project.root)).toEqual([project.root]);
	});

	it("includes a direct subdirectory (depth 1)", () => {
		project.mkdir("backend");
		expect(searchRoots(project.root)).toContain(join(project.root, "backend"));
	});

	it("includes a subdirectory two levels deep", () => {
		project.mkdir("apps/backend");
		const roots = searchRoots(project.root);
		expect(roots).toContain(join(project.root, "apps"));
		expect(roots).toContain(join(project.root, "apps", "backend"));
	});

	it("does not descend a third level deep (MAX_DEPTH = 2)", () => {
		project.mkdir("a/b/c");
		const roots = searchRoots(project.root);
		expect(roots).toContain(join(project.root, "a"));
		expect(roots).toContain(join(project.root, "a", "b"));
		expect(roots).not.toContain(join(project.root, "a", "b", "c"));
	});

	it("skips node_modules entirely, never descending into a huge vendored subtree", () => {
		project.mkdir("node_modules/some-package/deeply/nested");
		const roots = searchRoots(project.root);
		expect(roots.some((r) => r.includes("node_modules"))).toBe(false);
	});

	for (const skip of [...SKIP_DIRS].filter((d) => !d.startsWith("."))) {
		it(`skips the noise directory "${skip}"`, () => {
			project.mkdir(skip);
			expect(searchRoots(project.root)).not.toContain(join(project.root, skip));
		});
	}

	it("skips hidden directories generally (not only .git, not only names in SKIP_DIRS)", () => {
		project.mkdir(".git");
		project.mkdir(".cache");
		const roots = searchRoots(project.root);
		expect(roots).not.toContain(join(project.root, ".git"));
		expect(roots).not.toContain(join(project.root, ".cache"));
	});

	it("skips a file that happens to share a name with a noise directory (only real directories count)", () => {
		project.write("dist", "not actually a directory");
		expect(searchRoots(project.root)).not.toContain(join(project.root, "dist"));
	});

	it("a monorepo backend/+frontend/ fixture yields both subtrees as search roots", () => {
		project.mkdir("backend");
		project.mkdir("frontend");
		const roots = searchRoots(project.root);
		expect(roots).toEqual(
			expect.arrayContaining([project.root, join(project.root, "backend"), join(project.root, "frontend")]),
		);
	});

	it("collects every sibling directory, not just the first one found", () => {
		// Guards against an error-handling regression that returns early after the first entry
		// (the "scope error tolerance to one entry, never to a whole walk" convention this port
		// follows) — every sibling must still be collected.
		project.mkdir("keep-me");
		project.mkdir("also-keep-me");
		project.mkdir("me-too");
		const roots = searchRoots(project.root);
		expect(roots).toContain(join(project.root, "keep-me"));
		expect(roots).toContain(join(project.root, "also-keep-me"));
		expect(roots).toContain(join(project.root, "me-too"));
	});
});
