/**
 * `conductor init` (docs/adr/0002-fase1-cli-foundation.md §5.1/§7.1) -- Gate 5 (red first).
 *
 * Binding behaviors under test:
 *   - Fresh init: detects the stack, writes .conductor/config.json + .conductor/.gitignore.
 *   - Idempotent re-run over a VALID existing config is a MERGE, never a blind overwrite (ADR
 *     §5.1/§7.1, T16 secure default 12): project.* is re-detected, but provider.* and
 *     workspace.additionalProtectedPaths -- anything the user could have changed out of band via
 *     `conductor config set` -- survive untouched.
 *   - An existing config that fails to load (corrupt JSON / fails schema validation) is NOT
 *     silently merged over (there is nothing valid to merge from): init REFUSES with a clear
 *     message unless --force is passed, reconciling the task's "refuse without --force" ask with
 *     the ADR's merge-by-default idempotency for the common (valid-config) case.
 *   - --force on a broken config proceeds from a fresh detection; writeConfig's own T16 backup
 *     still preserves the broken file (force never means "lose data", only "don't ask again").
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ConductorConfig, readConfig, writeConfig } from "@conductor/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/commands/init.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function baseValidConfig(overrides: Partial<ConductorConfig> = {}): ConductorConfig {
	return {
		schema: 1,
		project: {
			type: "backend",
			technologies: ["Node/TypeScript"],
			evidence: ["package.json"],
			detectedAt: "2026-01-01T00:00:00.000Z",
		},
		workspace: { root: "." },
		provider: { model: "anthropic/claude-opus-4" },
		...overrides,
	};
}

describe("runInit -- fresh workspace", () => {
	it("detects the stack and writes .conductor/config.json + .conductor/.gitignore", async () => {
		project.writeJson("package.json", { name: "demo", dependencies: { express: "4.0.0" } });

		const outcome = await runInit({ cwd: project.root });

		expect(outcome.kind).toBe("created");
		const config = readConfig(project.root);
		expect(config.project.type).toBe("backend");
		expect(config.project.technologies).toContain("Node.js");
		expect(config.provider.model).toMatch(/^[^/\s]+\/[^/\s]+$/);
		expect(existsSync(join(project.root, ".conductor", ".gitignore"))).toBe(true);
		expect(project.read(".conductor/.gitignore")).toContain("/sessions/");
	});

	it("never writes a raw secret as the default provider.model (T11 is a non-issue by construction)", async () => {
		await runInit({ cwd: project.root });
		const config = readConfig(project.root);
		expect(config.provider.model).not.toMatch(/^sk-/);
	});
});

describe("runInit -- idempotent re-run over a valid config (merge, never blind overwrite)", () => {
	it("re-detects project.* but preserves provider.* and workspace.additionalProtectedPaths", async () => {
		project.writeJson("package.json", { name: "demo", dependencies: { express: "4.0.0" } });
		writeConfig(
			project.root,
			baseValidConfig({
				provider: { model: "anthropic/claude-opus-4", thinkingLevel: "high" },
				workspace: { root: ".", additionalProtectedPaths: ["/etc/secrets"] },
			}),
		);

		const outcome = await runInit({ cwd: project.root });

		expect(outcome.kind).toBe("merged");
		const config = readConfig(project.root);
		expect(config.provider.model).toBe("anthropic/claude-opus-4"); // preserved, not reset to a default
		expect(config.provider.thinkingLevel).toBe("high");
		expect(config.workspace.additionalProtectedPaths).toEqual(["/etc/secrets"]);
		expect(config.project.technologies).toContain("Node.js"); // re-detected, not stale
	});

	it("backs up the previous config.json (T16) even on a routine merge re-run", async () => {
		writeConfig(project.root, baseValidConfig());
		const before = readdirSync(join(project.root, ".conductor"));

		await runInit({ cwd: project.root });

		const after = readdirSync(join(project.root, ".conductor"));
		expect(after.length).toBeGreaterThan(before.length);
		expect(after.some((name) => name.startsWith("config.json.bak-"))).toBe(true);
	});

	it("does not require --force for the merge path", async () => {
		writeConfig(project.root, baseValidConfig());
		const outcome = await runInit({ cwd: project.root, force: false });
		expect(outcome.kind).toBe("merged");
	});
});

describe("runInit -- existing config fails to load", () => {
	it("refuses with a clear message and leaves the broken file untouched when --force is not passed", async () => {
		project.mkdir(".conductor");
		project.write(".conductor/config.json", "{ not valid json");

		const outcome = await runInit({ cwd: project.root });

		expect(outcome.kind).toBe("refused-invalid");
		if (outcome.kind === "refused-invalid") {
			expect(outcome.reason).toMatch(/--force/);
		}
		expect(project.read(".conductor/config.json")).toBe("{ not valid json");
	});

	it("proceeds from a fresh detection with --force, backing up the broken file first (T16)", async () => {
		project.writeJson("package.json", { name: "demo", dependencies: { express: "4.0.0" } });
		project.mkdir(".conductor");
		project.write(".conductor/config.json", "{ not valid json");

		const outcome = await runInit({ cwd: project.root, force: true });

		expect(outcome.kind).toBe("created");
		const config = readConfig(project.root);
		expect(config.project.type).toBe("backend");
		const files = readdirSync(join(project.root, ".conductor"));
		expect(files.some((name) => name.startsWith("config.json.bak-"))).toBe(true);
	});
});
