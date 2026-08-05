import { existsSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigValidationError, WorkspaceContainmentError } from "../src/errors.ts";
import { writeConfig } from "../src/write-config.ts";
import { validConfig } from "./support/fixtures.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

describe("writeConfig — happy path", () => {
	it("writes a valid config to .conductor/config.json", () => {
		const result = writeConfig(workspace.root, validConfig());
		expect(existsSync(result.configPath)).toBe(true);
		const written = JSON.parse(readFileSync(result.configPath, "utf8"));
		expect(written.provider.model).toBe("anthropic/claude-sonnet-5");
	});

	it("returns no backupPath on the first write (nothing to back up)", () => {
		const result = writeConfig(workspace.root, validConfig());
		expect(result.backupPath).toBeUndefined();
	});

	it("creates the .conductor directory if it does not exist yet", () => {
		expect(existsSync(join(workspace.root, ".conductor"))).toBe(false);
		writeConfig(workspace.root, validConfig());
		expect(existsSync(join(workspace.root, ".conductor"))).toBe(true);
	});
});

describe("writeConfig — T11: refuses raw-secret-shaped values", () => {
	it("rejects a high-entropy provider.model and writes nothing to disk", () => {
		const config = validConfig({ provider: { model: "QW1vdW50T2ZFbnRyb3B5MTIzNDU2Nzg5MHFyc3R1dnd4eXo=" } });
		expect(() => writeConfig(workspace.root, config)).toThrow(ConfigValidationError);
		expect(existsSync(join(workspace.root, ".conductor", "config.json"))).toBe(false);
	});

	it("rejects a known-secret-prefix provider.model", () => {
		const config = validConfig({ provider: { model: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" } });
		expect(() => writeConfig(workspace.root, config)).toThrow(ConfigValidationError);
	});

	it("rejects an apiKey-named field holding a raw (non-envVar-shaped) value", () => {
		// `config` is a variable, not an object literal, so TypeScript's excess-property check does
		// not fire here -- this deliberately exercises the *runtime* T11 guard against exactly the
		// kind of object a `conductor config set` dot-path merge (or a hand-edited file) could
		// realistically produce, which is not bound by ConductorConfig's compile-time shape either.
		const config = {
			...validConfig(),
			provider: { model: "anthropic/claude-sonnet-5", apiKey: "raw-value-not-an-env-var" },
		};
		expect(() => writeConfig(workspace.root, config)).toThrow(ConfigValidationError);
	});

	it("does not clobber a previously-written valid config when a later write is rejected", () => {
		writeConfig(workspace.root, validConfig());
		const configPath = join(workspace.root, ".conductor", "config.json");
		const before = readFileSync(configPath, "utf8");

		const badConfig = validConfig({ provider: { model: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" } });
		expect(() => writeConfig(workspace.root, badConfig)).toThrow(ConfigValidationError);

		expect(readFileSync(configPath, "utf8")).toBe(before);
	});
});

describe("writeConfig — T16: backup before overwrite", () => {
	it("backs up the existing file before a second write, preserving the original content", () => {
		writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-sonnet-5" } }));
		const configPath = join(workspace.root, ".conductor", "config.json");
		const originalContent = readFileSync(configPath, "utf8");

		const result = writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-opus-4" } }));

		expect(result.backupPath).toBeDefined();
		expect(existsSync(result.backupPath as string)).toBe(true);
		expect(readFileSync(result.backupPath as string, "utf8")).toBe(originalContent);

		// The live file now holds the new content, not the old.
		const updatedContent = JSON.parse(readFileSync(configPath, "utf8"));
		expect(updatedContent.provider.model).toBe("anthropic/claude-opus-4");
	});

	it("does not lose history across three successive writes -- each backup is distinct", () => {
		writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-sonnet-5" } }));
		const second = writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-opus-4" } }));
		const third = writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-haiku-4" } }));

		expect(second.backupPath).toBeDefined();
		expect(third.backupPath).toBeDefined();
		expect(second.backupPath).not.toBe(third.backupPath);

		// Both backups still exist and hold their own distinct snapshot.
		const secondBackup = JSON.parse(readFileSync(second.backupPath as string, "utf8"));
		const thirdBackup = JSON.parse(readFileSync(third.backupPath as string, "utf8"));
		expect(secondBackup.provider.model).toBe("anthropic/claude-sonnet-5");
		expect(thirdBackup.provider.model).toBe("anthropic/claude-opus-4");
	});

	it("never leaves a stray temp file behind after a successful write", () => {
		writeConfig(workspace.root, validConfig());
		writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-opus-4" } }));
		const entries = readdirSync(join(workspace.root, ".conductor"));
		expect(entries.some((name) => name.includes(".tmp-"))).toBe(false);
	});
});

describe("writeConfig — path containment", () => {
	it("rejects a workspaceRoot that does not exist", () => {
		const missing = join(workspace.root, "nowhere");
		expect(() => writeConfig(missing, validConfig())).toThrow(WorkspaceContainmentError);
	});

	it("rejects a relative workspaceRoot", () => {
		expect(() => writeConfig("relative/path", validConfig())).toThrow(WorkspaceContainmentError);
	});

	it("denies writing through a .conductor symlink that escapes the workspace", () => {
		const outsideDir = createScratchWorkspace("conductor-config-outside-");
		try {
			let linkPath: string;
			try {
				linkPath = join(workspace.root, ".conductor");
				symlinkSync(outsideDir.root, linkPath, "junction");
			} catch {
				return; // Symlink creation unsupported/unprivileged in this environment -- skip.
			}

			expect(() => writeConfig(workspace.root, validConfig())).toThrow(WorkspaceContainmentError);
			expect(existsSync(join(outsideDir.root, "config.json"))).toBe(false);
		} finally {
			outsideDir.cleanup();
		}
	});
});
