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

	it("does NOT include .conductor/config.json or .conductor/policy.json when no workspaceRoot is given (backward compatible)", () => {
		const paths = defaultProtectedPaths();
		expect(paths.some((p) => p.endsWith(join(".conductor", "config.json")))).toBe(false);
		expect(paths.some((p) => p.endsWith(join(".conductor", "policy.json")))).toBe(false);
	});

	it("includes .conductor/config.json and .conductor/policy.json inside the given workspace root (T13)", () => {
		const paths = defaultProtectedPaths(workspace.root);
		expect(paths).toContain(join(workspace.root, ".conductor", "config.json"));
		expect(paths).toContain(join(workspace.root, ".conductor", "policy.json"));
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
		const outsideDir = createScratchWorkspace("conductor-runtime-outside-");
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

	// T13 (gate3-fase1-addendum.md §2 T13, §3 secure default 9): .conductor/config.json and
	// .conductor/policy.json hold the very policy this function enforces. A tool-driven write to
	// either must be BLOCKED outright by workspace-policy alone — no additionalProtectedPaths wiring
	// required from the caller — same rigor as the symlink-escape test above: a real scratch
	// workspace, no mocking of fs, asserting both the verdict and the reason.
	describe("protects .conductor/config.json and .conductor/policy.json (T13)", () => {
		it("denies a write to .conductor/config.json inside the workspace, even though it is contained (defense in depth, no additionalProtectedPaths needed)", () => {
			mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
			writeFileSync(join(workspace.root, ".conductor", "config.json"), JSON.stringify({ schema: 1 }));

			const result = evaluateToolPath(join(".conductor", "config.json"), { workspaceRoot: workspace.root });

			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/protected location/);
		});

		it("denies a write to .conductor/policy.json even when the file does not exist yet (protection does not require the target to already exist)", () => {
			// Deliberately never created — mirrors defaultProtectedPaths()'s existing guarantee for
			// ~/.ssh: a tool must not be able to CREATE the protected file either, not just edit one
			// that already exists.
			const result = evaluateToolPath(join(".conductor", "policy.json"), { workspaceRoot: workspace.root });

			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/protected location/);
		});

		it("does not deny an unrelated file under .conductor/ (protection is scoped to config.json/policy.json, not the whole directory)", () => {
			mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
			writeFileSync(join(workspace.root, ".conductor", "notes.txt"), "not policy");

			const result = evaluateToolPath(join(".conductor", "notes.txt"), { workspaceRoot: workspace.root });

			expect(result.allowed).toBe(true);
		});
	});

	// Fase 4 (ADR 0005 §9.1, gate3-addendum-fase4.md R28/T44): the GateState governance store is a
	// NEW security boundary, not a new mechanism — the SAME defense-in-depth this describe block
	// already proves for config.json/policy.json ("the store must not be directly writable by the
	// very agent whose actions/approvals it records"). Reuse, not a new code path: this test only
	// asserts that `.conductor/gates/` (the WHOLE subtree, files and `.lock` alike, per ADR §9.1
	// "o subtree .conductor/gates/ inteiro") ends up in `defaultProtectedPaths()`'s deny-list —
	// Gate 6 adds the one line to `defaultProtectedPaths()`; nothing here should require a second,
	// bespoke check function of its own.
	describe(".conductor/gates/ subtree is protected — the GateState governance store (Fase 4, ADR 0005 §9.1)", () => {
		it("denies a write to a demand's GateState JSON file inside .conductor/gates/, even though it is contained within the workspace", () => {
			mkdirSync(join(workspace.root, ".conductor", "gates"), { recursive: true });
			writeFileSync(join(workspace.root, ".conductor", "gates", "feature-fase4--abcd1234.json"), "{}");

			const result = evaluateToolPath(join(".conductor", "gates", "feature-fase4--abcd1234.json"), {
				workspaceRoot: workspace.root,
			});

			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/protected location/);
		});

		it("denies a write to a GateState file that does not exist yet (protection does not require the target to already exist — a tool must not be able to CREATE it either)", () => {
			const result = evaluateToolPath(join(".conductor", "gates", "never-created--00000000.json"), {
				workspaceRoot: workspace.root,
			});

			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/protected location/);
		});

		it("denies a write to the lock file sitting alongside a GateState JSON in the SAME subtree (ADR §9.1: 'os arquivos <demand>.json E os .lock')", () => {
			const result = evaluateToolPath(join(".conductor", "gates", "feature-fase4--abcd1234.json.lock"), {
				workspaceRoot: workspace.root,
			});

			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/protected location/);
		});

		it("denies a write to a nested subdirectory under .conductor/gates/ too (the WHOLE subtree, not just its top-level files)", () => {
			const result = evaluateToolPath(join(".conductor", "gates", "archive", "old-demand.json"), {
				workspaceRoot: workspace.root,
			});

			expect(result.allowed).toBe(false);
			expect(result.reason).toMatch(/protected location/);
		});

		it("does NOT deny an unrelated file elsewhere under .conductor/ (protection is scoped to the gates/ subtree, not the whole .conductor directory)", () => {
			mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
			writeFileSync(join(workspace.root, ".conductor", "notes.txt"), "not a gate state");

			const result = evaluateToolPath(join(".conductor", "notes.txt"), { workspaceRoot: workspace.root });

			expect(result.allowed).toBe(true);
		});
	});

	// FR-6 / Gate 8 loop-back (Gate 4 decision, journal 2026-08-06): the 44 real built-in skills live
	// OUTSIDE any user workspaceRoot by construction (packaged with the CLI, resolved via
	// import.meta.url -- conductor-cli's builtin-paths.ts), so a plain workspaceRoot check denies every
	// real `read` attempt against one -- reproduced here with a REAL second scratch directory standing
	// in for that external skill root (never a fixture placed inside workspace.root, the non-
	// representative shape Gate 8 found had hidden this defect from the pre-existing test suite).
	describe("additionalAllowedReadRoots (extra roots allowed for reads, beyond the workspace)", () => {
		it("allows a path inside an additionalAllowedReadRoots entry, even though it is outside the workspace root", () => {
			const externalSkillsRoot = createScratchWorkspace("conductor-runtime-external-skills-");
			try {
				const skillDir = join(externalSkillsRoot.root, "design-service");
				mkdirSync(skillDir, { recursive: true });
				const skillFile = join(skillDir, "SKILL.md");
				writeFileSync(skillFile, "body");

				const result = evaluateToolPath(skillFile, {
					workspaceRoot: workspace.root,
					additionalAllowedReadRoots: [skillFile],
				});

				expect(result.allowed).toBe(true);
				expect(result.realPath).toBe(skillFile);
			} finally {
				externalSkillsRoot.cleanup();
			}
		});

		it("still denies a path outside BOTH the workspace root and every additionalAllowedReadRoots entry (not a general bypass)", () => {
			const externalSkillsRoot = createScratchWorkspace("conductor-runtime-external-skills-");
			const unrelatedRoot = createScratchWorkspace("conductor-runtime-unrelated-");
			try {
				const skillDir = join(externalSkillsRoot.root, "design-service");
				mkdirSync(skillDir, { recursive: true });
				const skillFile = join(skillDir, "SKILL.md");
				writeFileSync(skillFile, "body");

				const unrelatedFile = join(unrelatedRoot.root, "secret.txt");
				writeFileSync(unrelatedFile, "top secret");

				const result = evaluateToolPath(unrelatedFile, {
					workspaceRoot: workspace.root,
					additionalAllowedReadRoots: [skillFile],
				});

				expect(result.allowed).toBe(false);
				expect(result.reason).toMatch(/outside the workspace root/);
			} finally {
				externalSkillsRoot.cleanup();
				unrelatedRoot.cleanup();
			}
		});

		it("a protected path still denies even when it is also inside an additionalAllowedReadRoots entry (defense in depth — protected-paths is checked first)", () => {
			const externalSkillsRoot = createScratchWorkspace("conductor-runtime-external-skills-");
			try {
				const sensitiveFile = join(externalSkillsRoot.root, "secret-config.json");
				writeFileSync(sensitiveFile, "{}");

				const result = evaluateToolPath(sensitiveFile, {
					workspaceRoot: workspace.root,
					additionalAllowedReadRoots: [externalSkillsRoot.root],
					additionalProtectedPaths: [sensitiveFile],
				});

				expect(result.allowed).toBe(false);
				expect(result.reason).toMatch(/protected location/);
			} finally {
				externalSkillsRoot.cleanup();
			}
		});
	});
});
