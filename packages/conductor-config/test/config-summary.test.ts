import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigSummary, summarizeConfig } from "../src/config-summary.ts";
import { ConfigNotFoundError } from "../src/errors.ts";
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

describe("summarizeConfig", () => {
	it("mirrors every safe field of a normal config, with no redactions", () => {
		const config = validConfig({ provider: { model: "anthropic/claude-sonnet-5", thinkingLevel: "high" } });
		const summary = summarizeConfig(config);

		expect(summary.schema).toBe(1);
		expect(summary.project.type).toBe("backend");
		expect(summary.project.technologies).toEqual(["Node/TypeScript"]);
		expect(summary.provider.model).toBe("anthropic/claude-sonnet-5");
		expect(summary.provider.thinkingLevel).toBe("high");
		expect(summary.redactedFields).toEqual([]);
	});

	it("redacts a known-schema field whose value looks secret-shaped instead of echoing it (T12 defense in depth)", () => {
		const rawSecret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
		// Bypasses writeConfig's T11 gate on purpose -- simulates a hand-edited file that got a raw
		// secret into a normally-safe field some other way. summarizeConfig must still not echo it.
		const config = validConfig({ provider: { model: rawSecret } });

		const summary = summarizeConfig(config);

		expect(summary.provider.model).not.toBe(rawSecret);
		expect(summary.provider.model).not.toContain(rawSecret);
		expect(summary.redactedFields).toContain("provider.model");
	});

	it("never includes an actual credential substring anywhere in the serialized summary", () => {
		const rawSecret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
		const config = validConfig({ provider: { model: rawSecret } });
		const summary = summarizeConfig(config);
		expect(JSON.stringify(summary)).not.toContain(rawSecret);
	});
});

describe("getConfigSummary — T12: never surfaces a field it doesn't recognize as safe", () => {
	it("omits an unrecognized field entirely, even when the file was hand-edited to include one", () => {
		// Writes the file directly (bypassing writeConfig's T11 validation) to simulate a config.json
		// that acquired an extra field some other way -- exactly the scenario T12 exists to defend
		// against structurally, not just by convention.
		mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
		const tampered = {
			...validConfig(),
			provider: { model: "anthropic/claude-sonnet-5", apiKey: "sk-ant-api03-shouldNeverBeSurfaced0123456789" },
		};
		writeFileSync(join(workspace.root, ".conductor", "config.json"), JSON.stringify(tampered));

		const summary = getConfigSummary(workspace.root);
		const serialized = JSON.stringify(summary);

		expect(serialized).not.toContain("apiKey");
		expect(serialized).not.toContain("sk-ant-api03-shouldNeverBeSurfaced0123456789");
	});

	it("propagates ConfigNotFoundError when there is nothing to summarize", () => {
		expect(() => getConfigSummary(workspace.root)).toThrow(ConfigNotFoundError);
	});

	it("reflects a real config written through writeConfig end to end", () => {
		writeConfig(workspace.root, validConfig({ provider: { model: "anthropic/claude-opus-4" } }));
		const summary = getConfigSummary(workspace.root);
		expect(summary.provider.model).toBe("anthropic/claude-opus-4");
		expect(summary.redactedFields).toEqual([]);
	});
});
