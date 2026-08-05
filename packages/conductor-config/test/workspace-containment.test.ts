import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceContainmentError } from "../src/errors.ts";
import { resolveContainedConfigPath } from "../src/workspace-containment.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

describe("resolveContainedConfigPath", () => {
	it("resolves .conductor/config.json under the workspace root when nothing exists yet", () => {
		const result = resolveContainedConfigPath(workspace.root);
		expect(result.configRealPath).toBe(join(workspace.root, ".conductor", "config.json"));
		expect(result.conductorDirRealPath).toBe(join(workspace.root, ".conductor"));
		expect(result.workspaceRealPath).toBe(workspace.root);
	});

	it("resolves correctly when .conductor already exists as an ordinary directory", () => {
		mkdirSync(join(workspace.root, ".conductor"));
		writeFileSync(join(workspace.root, ".conductor", "config.json"), "{}");
		const result = resolveContainedConfigPath(workspace.root);
		expect(result.configRealPath).toBe(join(workspace.root, ".conductor", "config.json"));
	});

	it("rejects a relative workspaceRoot", () => {
		expect(() => resolveContainedConfigPath("relative/path")).toThrow(WorkspaceContainmentError);
		expect(() => resolveContainedConfigPath("relative/path")).toThrow(/absolute/);
	});

	it("rejects a workspaceRoot that does not exist", () => {
		const missing = join(workspace.root, "does-not-exist");
		expect(() => resolveContainedConfigPath(missing)).toThrow(WorkspaceContainmentError);
		expect(() => resolveContainedConfigPath(missing)).toThrow(/does not exist/);
	});

	it("denies a .conductor that is a symlink escaping the workspace (possible symlink escape)", () => {
		const outsideDir = createScratchWorkspace("conductor-config-outside-");
		try {
			let linkPath: string;
			try {
				linkPath = join(workspace.root, ".conductor");
				symlinkSync(outsideDir.root, linkPath, "junction");
			} catch {
				// Symlink creation can require elevated privileges on Windows; skip rather than fail
				// (mirrors packages/conductor-poc/test/workspace-policy.test.ts's own tolerance).
				return;
			}

			expect(() => resolveContainedConfigPath(workspace.root)).toThrow(WorkspaceContainmentError);
			expect(() => resolveContainedConfigPath(workspace.root)).toThrow(/outside the workspace root/);
		} finally {
			outsideDir.cleanup();
		}
	});
});
