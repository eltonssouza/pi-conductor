/**
 * `conductor config show|get <key>|set <key> <value>` (docs/adr/0002-fase1-cli-foundation.md §7.3)
 * -- Gate 5 (red first).
 *
 * Binding behaviors under test:
 *   - `show`/`get` go through @conductor/config's redaction-safe getConfigSummary, never the raw
 *     config (defense in depth alongside T11's write-time secret rejection, T12's doctor rule).
 *   - `set` is routed through @conductor/config's writeConfig -- never a raw fs write -- so T11
 *     (reject a raw secret) and T16 (backup before overwrite) both apply to `config set` exactly as
 *     they do to `init` (ADR §7.3's "same discipline" note).
 *   - `set` only accepts a fixed allowlist of settable keys (ADR §7.3: "unknown key or wrong type ->
 *     error, not silent write") -- this is a DIFFERENT, narrower rule than assertValidConfigShape's
 *     own permissiveness (which deliberately does not reject unknown extra fields -- see that
 *     module's header comment), so conductor-cli must enforce it itself.
 *   - `project.type` is settable (conductor-project's types.ts explicitly reserves "library"/"data"
 *     for exactly this manual override path), but project.technologies/evidence/detectedAt are NOT
 *     (those are `conductor init`-owned, re-detected fields).
 */

import { type ConductorConfig, readConfig, writeConfig } from "@conductor/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConfigGet, runConfigSet, runConfigShow } from "../../src/commands/config.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function seedConfig(overrides: Partial<ConductorConfig> = {}) {
	writeConfig(project.root, {
		schema: 1,
		project: {
			type: "backend",
			technologies: ["Node/TypeScript"],
			evidence: ["package.json"],
			detectedAt: "2026-01-01T00:00:00.000Z",
		},
		workspace: { root: "." },
		provider: { model: "anthropic/claude-sonnet-5" },
		...overrides,
	});
}

describe("runConfigShow", () => {
	it("returns the redaction-safe summary when initialized", async () => {
		seedConfig();
		const result = await runConfigShow({ cwd: project.root });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.summary.project.type).toBe("backend");
	});

	it("fails clearly (not a crash) when not initialized", async () => {
		const result = await runConfigShow({ cwd: project.root });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/conductor init/);
	});
});

describe("runConfigGet", () => {
	it("reads a scalar leaf (provider.model)", async () => {
		seedConfig({ provider: { model: "anthropic/claude-opus-4" } });
		const result = await runConfigGet({ cwd: project.root, key: "provider.model" });
		expect(result).toEqual({ ok: true, value: "anthropic/claude-opus-4" });
	});

	it("reads an array leaf (project.technologies)", async () => {
		seedConfig({
			project: { type: "backend", technologies: ["A", "B"], evidence: [], detectedAt: "2026-01-01T00:00:00.000Z" },
		});
		const result = await runConfigGet({ cwd: project.root, key: "project.technologies" });
		expect(result).toEqual({ ok: true, value: ["A", "B"] });
	});

	it("rejects an unknown key with a clear error, not undefined", async () => {
		seedConfig();
		const result = await runConfigGet({ cwd: project.root, key: "provider.wat" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/unknown key/i);
	});

	it("fails clearly when not initialized", async () => {
		const result = await runConfigGet({ cwd: project.root, key: "provider.model" });
		expect(result.ok).toBe(false);
	});
});

describe("runConfigSet", () => {
	it("writes provider.model through writeConfig (T11/T16 apply)", async () => {
		seedConfig();
		const result = await runConfigSet({
			cwd: project.root,
			key: "provider.model",
			rawValue: "anthropic/claude-opus-4",
		});
		expect(result.ok).toBe(true);
		expect(readConfig(project.root).provider.model).toBe("anthropic/claude-opus-4");
	});

	it("allows project.type as a manual override (conductor-project reserves 'library'/'data' for exactly this)", async () => {
		seedConfig();
		const result = await runConfigSet({ cwd: project.root, key: "project.type", rawValue: "library" });
		expect(result.ok).toBe(true);
		expect(readConfig(project.root).project.type).toBe("library");
	});

	it("parses workspace.additionalProtectedPaths as a JSON string array", async () => {
		seedConfig();
		const result = await runConfigSet({
			cwd: project.root,
			key: "workspace.additionalProtectedPaths",
			rawValue: '["/etc/secrets", "/opt/keys"]',
		});
		expect(result.ok).toBe(true);
		expect(readConfig(project.root).workspace.additionalProtectedPaths).toEqual(["/etc/secrets", "/opt/keys"]);
	});

	it("rejects workspace.additionalProtectedPaths that is not a JSON array of strings, without writing anything", async () => {
		seedConfig();
		const result = await runConfigSet({
			cwd: project.root,
			key: "workspace.additionalProtectedPaths",
			rawValue: "not-json",
		});
		expect(result.ok).toBe(false);
		expect(readConfig(project.root).workspace.additionalProtectedPaths).toBeUndefined();
	});

	it("rejects an unknown/unsettable key (project.technologies is init-owned, not user-settable)", async () => {
		seedConfig();
		const result = await runConfigSet({ cwd: project.root, key: "project.technologies", rawValue: '["x"]' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/not settable|unknown key/i);
		expect(readConfig(project.root).project.technologies).toEqual(["Node/TypeScript"]); // untouched
	});

	it("rejects schema (fixed, never editable)", async () => {
		seedConfig();
		const result = await runConfigSet({ cwd: project.root, key: "schema", rawValue: "2" });
		expect(result.ok).toBe(false);
	});

	it("surfaces T11's rejection cleanly when the value looks like a raw secret, without writing it", async () => {
		seedConfig();
		const result = await runConfigSet({
			cwd: project.root,
			key: "provider.model",
			rawValue: "sk-ant-api03-shouldNeverBeWrittenToConfigJson0123456789",
		});
		expect(result.ok).toBe(false);
		expect(readConfig(project.root).provider.model).toBe("anthropic/claude-sonnet-5"); // untouched
	});

	it(
		"surfaces T11's rejection when a known secret prefix is EMBEDDED mid-string, not just when it is the whole value " +
			"(docs/conductor/gate8-validation-fase1.md §6.2 -- live-reproduced there via `conductor config set " +
			'provider.model "anthropic/sk-ant-api03-..."`, accepted and written to disk unredacted before this fix)',
		async () => {
			seedConfig();
			const result = await runConfigSet({
				cwd: project.root,
				key: "provider.model",
				rawValue: "anthropic/sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE",
			});
			expect(result.ok).toBe(false);
			expect(readConfig(project.root).provider.model).toBe("anthropic/claude-sonnet-5"); // untouched
		},
	);

	it("still allows an ordinary provider/model identifier after the T11 embedded-prefix fix (no false-positive regression)", async () => {
		seedConfig();
		const result = await runConfigSet({
			cwd: project.root,
			key: "provider.model",
			rawValue: "anthropic/claude-opus-4",
		});
		expect(result.ok).toBe(true);
		expect(readConfig(project.root).provider.model).toBe("anthropic/claude-opus-4");
	});

	it("fails clearly when not initialized yet (set requires an existing config to modify)", async () => {
		const result = await runConfigSet({
			cwd: project.root,
			key: "provider.model",
			rawValue: "anthropic/claude-opus-4",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/conductor init/);
	});
});
