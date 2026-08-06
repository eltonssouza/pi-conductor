/**
 * `conductor doctor` (docs/adr/0002-fase1-cli-foundation.md §7.2) -- Gate 5 (red first).
 *
 * Binding rule under test throughout (T12, gate3-fase1-addendum.md secure default 10): doctor
 * reports status/presence/shape, NEVER a secret's value. None of these tests ever assert on a raw
 * credential value because the implementation must never produce one to assert on.
 */

import { type ConductorConfig, writeConfig } from "@conductor/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDoctorReport, resolveGitTimeoutMs, runDoctor } from "../../src/commands/doctor.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function validConfig(overrides: Partial<ConductorConfig> = {}): ConductorConfig {
	return {
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
	};
}

function findCheck(report: Awaited<ReturnType<typeof runDoctor>>, namePart: string) {
	const check = report.checks.find((c) => c.name.toLowerCase().includes(namePart.toLowerCase()));
	if (!check)
		throw new Error(`no doctor check matched "${namePart}" among: ${report.checks.map((c) => c.name).join(", ")}`);
	return check;
}

describe("runDoctor -- .conductor/config.json check", () => {
	it("reports 'warn' (not 'fail') and points to `conductor init` when nothing is initialized yet", async () => {
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "conductor");
		expect(check.status).toBe("warn");
		expect(check.message).toMatch(/conductor init/);
	});

	it("reports 'pass' with a redaction-safe summary when the config is valid", async () => {
		writeConfig(project.root, validConfig());
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "conductor");
		expect(check.status).toBe("pass");
		expect(check.message).toContain("backend");
	});

	it("reports 'fail' when the config exists but is corrupt, without ever surfacing raw file content", async () => {
		project.write(".conductor/config.json", "{ not valid json");
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "conductor");
		expect(check.status).toBe("fail");
		expect(check.message).not.toContain("{ not valid json");
	});

	it("never echoes a secret-shaped provider.model value even if one slipped past write-time validation via a hand-edit", async () => {
		project.mkdir(".conductor");
		project.writeJson(".conductor/config.json", {
			...validConfig(),
			provider: { model: "sk-ant-api03-thisShouldNeverAppearInDoctorOutput0123456789" },
		});
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "conductor");
		expect(check.message).not.toContain("sk-ant-api03-thisShouldNeverAppearInDoctorOutput0123456789");
	});
});

describe("runDoctor -- Node version check", () => {
	it("passes on the current test runtime (already >= the monorepo's engines.node floor)", async () => {
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "node");
		expect(check.status).toBe("pass");
	});
});

describe("runDoctor -- git repository state check", () => {
	it("is 'warn', never 'fail', outside a git repository (informational per ADR §7.2 item 3)", async () => {
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "git");
		expect(check.status).not.toBe("fail");
		expect(check.message.toLowerCase()).toMatch(/not a git repository/);
	});
});

describe("runDoctor -- library backend check", () => {
	it("is 'skip' in Fase 1 -- .conductor/config.json has no library field to check yet (Fase 5)", async () => {
		writeConfig(project.root, validConfig());
		const report = await runDoctor({ cwd: project.root });
		const check = findCheck(report, "library");
		expect(check.status).toBe("skip");
		expect(check.message.toLowerCase()).toMatch(/fase 5/);
	});
});

describe("runDoctor -- model/credential resolution check (injectable ModelRuntime)", () => {
	it("passes and reports only presence when the configured provider has credentials", async () => {
		writeConfig(project.root, validConfig({ provider: { model: "anthropic/claude-sonnet-5" } }));
		const report = await runDoctor({
			cwd: project.root,
			createModelRuntime: async () => ({
				hasConfiguredAuth: (providerId: string) => providerId === "anthropic",
				getModel: () => undefined,
			}),
		});
		const check = findCheck(report, "provider");
		expect(check.status).toBe("pass");
		expect(check.message).toContain("anthropic");
	});

	it("warns (not fails) when no credential is configured yet -- a normal first-run state", async () => {
		writeConfig(project.root, validConfig({ provider: { model: "anthropic/claude-sonnet-5" } }));
		const report = await runDoctor({
			cwd: project.root,
			createModelRuntime: async () => ({ hasConfiguredAuth: () => false, getModel: () => undefined }),
		});
		const check = findCheck(report, "provider");
		expect(check.status).toBe("warn");
	});

	it("skips gracefully when there is no valid config to read provider.model from", async () => {
		const report = await runDoctor({
			cwd: project.root,
			createModelRuntime: async () => ({ hasConfiguredAuth: () => true, getModel: () => undefined }),
		});
		const check = findCheck(report, "provider");
		expect(check.status).toBe("skip");
	});

	it("degrades to 'warn' (never throws/crashes doctor) when ModelRuntime itself fails to construct", async () => {
		writeConfig(project.root, validConfig());
		const report = await runDoctor({
			cwd: project.root,
			createModelRuntime: async () => {
				throw new Error("simulated auth.json read failure");
			},
		});
		const check = findCheck(report, "provider");
		expect(check.status).toBe("warn");
		expect(report.checks.length).toBeGreaterThan(0); // the whole report still comes back
	});
});

describe("runDoctor -- report metadata (observability)", () => {
	it("stamps the report with a UTC ISO-8601 generation timestamp, and the formatted output includes it", async () => {
		const report = await runDoctor({ cwd: project.root });
		expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
		expect(formatDoctorReport(report)).toContain(report.generatedAt);
	});
});

describe("resolveGitTimeoutMs (quality-baseline: no hardcoded timeout)", () => {
	it("falls back to the default when CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS is unset", () => {
		expect(resolveGitTimeoutMs(undefined)).toBeGreaterThan(0);
	});

	it("honors a valid positive override from the environment", () => {
		expect(resolveGitTimeoutMs("2500")).toBe(2500);
	});

	it("falls back to the default for a non-numeric or non-positive override, rather than passing a bad value to execFile", () => {
		const fallback = resolveGitTimeoutMs(undefined);
		expect(resolveGitTimeoutMs("not-a-number")).toBe(fallback);
		expect(resolveGitTimeoutMs("-5")).toBe(fallback);
		expect(resolveGitTimeoutMs("0")).toBe(fallback);
	});

	it("degrades to a non-throwing check (never 'fail') when the real timeout is overridden very low end to end", async () => {
		const original = process.env.CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS;
		process.env.CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS = "1";
		try {
			const report = await runDoctor({ cwd: project.root });
			const check = findCheck(report, "git");
			expect(["pass", "warn"]).toContain(check.status); // informational only, per ADR §7.2 item 3
		} finally {
			if (original === undefined) delete process.env.CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS;
			else process.env.CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS = original;
		}
	});
});

describe("runDoctor -- overall aggregation", () => {
	it("ok is false when any check fails (corrupt config), true otherwise", async () => {
		project.write(".conductor/config.json", "{ not valid json");
		const broken = await runDoctor({ cwd: project.root });
		expect(broken.ok).toBe(false);

		project.cleanup();
		project = createScratchProject();
		writeConfig(project.root, validConfig());
		const healthy = await runDoctor({
			cwd: project.root,
			createModelRuntime: async () => ({ hasConfiguredAuth: () => true, getModel: () => undefined }),
		});
		expect(healthy.ok).toBe(true);
	});
});
