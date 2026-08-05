import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigNotFoundError, ConfigParseError, ConfigValidationError } from "../src/errors.ts";
import { readConfig } from "../src/read-config.ts";
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

describe("readConfig", () => {
	it("round-trips a config written by writeConfig", () => {
		const config = validConfig({ provider: { model: "anthropic/claude-opus-4", thinkingLevel: "high" } });
		writeConfig(workspace.root, config);

		const read = readConfig(workspace.root);
		expect(read).toEqual(config);
	});

	it("throws ConfigNotFoundError when .conductor/config.json does not exist", () => {
		expect(() => readConfig(workspace.root)).toThrow(ConfigNotFoundError);
	});

	it("throws ConfigParseError for invalid JSON", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(join(workspace.root, ".conductor", "config.json"), "{ not valid json");
		expect(() => readConfig(workspace.root)).toThrow(ConfigParseError);
	});

	it("throws ConfigValidationError for well-formed JSON that violates the schema", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		writeFileSync(join(workspace.root, ".conductor", "config.json"), JSON.stringify({ schema: 1 }));
		expect(() => readConfig(workspace.root)).toThrow(ConfigValidationError);
	});

	it("does not leak file content in the parse-error message", () => {
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		const secretLookingGarbage = "{ this is not json but sk-ant-api03-totallyRealLookingSecretValue123 }";
		writeFileSync(join(workspace.root, ".conductor", "config.json"), secretLookingGarbage);
		try {
			readConfig(workspace.root);
			throw new Error("expected readConfig to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigParseError);
			expect((error as Error).message).not.toContain("sk-ant-api03");
		}
	});
});
