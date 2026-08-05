import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultProtectedPaths, evaluateToolPath, isWithinRoot, resolveRealPath } from "../src/workspace-policy.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

describe("resolveRealPath", () => {
	it("resolves a relative path against baseDir", () => {
		writeFileSync(join(workspace.root, "file.txt"), "x");
		expect(resolveRealPath("file.txt", workspace.root)).toBe(join(workspace.root, "file.txt"));
	});

	it("resolves an absolute path as-is (canonicalized)", () => {
		writeFileSync(join(workspace.root, "file.txt"), "x");
		const absolute = join(workspace.root, "file.txt");
		expect(resolveRealPath(absolute, "/somewhere/irrelevant")).toBe(absolute);
	});

	it("walks up to the nearest existing ancestor for a not-yet-created file", () => {
		const result = resolveRealPath("new-dir/new-file.txt", workspace.root);
		expect(result).toBe(join(workspace.root, "new-dir", "new-file.txt"));
	});

	it("walks up through multiple non-existent path segments", () => {
		const result = resolveRealPath("a/b/c/new-file.txt", workspace.root);
		expect(result).toBe(join(workspace.root, "a", "b", "c", "new-file.txt"));
	});

	it("follows a symlinked ancestor to its real target, not the lexical path", () => {
		const realTarget = join(workspace.root, "real-target");
		mkdirSync(realTarget);
		writeFileSync(join(realTarget, "inside.txt"), "x");

		let linkPath: string;
		try {
			linkPath = join(workspace.root, "link-to-target");
			symlinkSync(realTarget, linkPath, "junction");
		} catch {
			// Symlink creation can require elevated privileges on Windows; skip rather than fail.
			return;
		}

		const resolved = resolveRealPath(join(linkPath, "inside.txt"), workspace.root);
		expect(resolved).toBe(realpathSync(join(realTarget, "inside.txt")));
	});
});

describe("isWithinRoot", () => {
	// Built with path.join() rather than hardcoded POSIX literals, so these assertions reflect
	// real OS-native paths (as the function is actually called in production) on every platform,
	// Windows included.
	const root = join("workspace-root");
	const evilSibling = join("workspace-root-evil", "file.txt");

	it("is true for the root itself", () => {
		expect(isWithinRoot(root, root)).toBe(true);
	});

	it("is true for a descendant", () => {
		expect(isWithinRoot(join(root, "sub", "file.txt"), root)).toBe(true);
	});

	it("is false for a sibling directory with a similar name (prefix trap)", () => {
		// The classic bug this guards against: a naive startsWith(root) would treat
		// "workspace-root-evil/file.txt" as being "within" "workspace-root", but it is a sibling,
		// not a descendant.
		expect(isWithinRoot(evilSibling, root)).toBe(false);
	});

	it("is false for a parent directory", () => {
		expect(isWithinRoot(root, join(root, "sub"))).toBe(false);
	});

	it("is false for an unrelated path", () => {
		expect(isWithinRoot(join("etc", "passwd"), root)).toBe(false);
	});
});

describe("defaultProtectedPaths", () => {
	it("includes the standard credential/config directories under the home directory", () => {
		const paths = defaultProtectedPaths();
		const suffixes = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config"];
		for (const suffix of suffixes) {
			expect(paths.some((p) => p.endsWith(suffix))).toBe(true);
		}
		expect(paths.some((p) => p.endsWith(join("conductor", "credentials")))).toBe(true);
	});
});

describe("evaluateToolPath", () => {
	it("allows a path inside the workspace", () => {
		writeFileSync(join(workspace.root, "ok.txt"), "x");
		const result = evaluateToolPath("ok.txt", { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(true);
		expect(result.realPath).toBe(join(workspace.root, "ok.txt"));
	});

	it("denies a relative path that escapes the workspace via ..", () => {
		const result = evaluateToolPath("../outside.txt", { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/outside the workspace root/);
	});

	it("denies an absolute path outside the workspace", () => {
		const result = evaluateToolPath("/etc/passwd", { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
	});

	it("denies a path under an additional protected root even though it is inside the workspace (defense in depth)", () => {
		const nestedSecrets = join(workspace.root, "nested-secrets");
		mkdirSync(nestedSecrets);
		const result = evaluateToolPath(join(nestedSecrets, "token"), {
			workspaceRoot: workspace.root,
			additionalProtectedPaths: [nestedSecrets],
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies a symlink inside the workspace that resolves outside it", () => {
		const outsideDir = createScratchWorkspace("conductor-poc-outside-");
		try {
			writeFileSync(join(outsideDir.root, "secret.txt"), "top secret");

			let linkPath: string;
			try {
				linkPath = join(workspace.root, "escape-link");
				symlinkSync(outsideDir.root, linkPath, "junction");
			} catch {
				return; // Symlink creation unsupported in this environment — skip.
			}

			const result = evaluateToolPath(join("escape-link", "secret.txt"), { workspaceRoot: workspace.root });
			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/outside the workspace root/);
		} finally {
			outsideDir.cleanup();
		}
	});
});
