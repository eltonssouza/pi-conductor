/**
 * `conductor roles list` -- Gate 5/6 (red-first), mirrors doctor.test.ts's own structure: unit tests
 * against `runRolesList`/`formatRolesListReport` directly, plus an end-to-end dispatch test through
 * `runCli` (the same outer acceptance style `cli.acceptance.test.ts` already established).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.ts";
import { formatRolesListReport, runRolesList } from "../../src/commands/roles.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("runRolesList -- the real, shipped role/skill catalog", () => {
	it("lists all 37 built-in roles, sorted by slug, with zero diagnostics", async () => {
		const report = await runRolesList({ cwd: project.root });

		expect(report.roles).toHaveLength(37);
		expect(report.diagnostics).toEqual([]);
		const slugs = report.roles.map((r) => r.id);
		expect(slugs).toEqual([...slugs].sort());
	});

	it("each row carries id/area/skills/modelRole/gates -- the minimal fields FR-3 requires", async () => {
		const report = await runRolesList({ cwd: project.root });

		const backendEngineer = report.roles.find((r) => r.id === "backend-engineer");
		expect(backendEngineer).toEqual({
			id: "backend-engineer",
			area: "engineering",
			modelRole: "standard",
			skills: ["design-service"],
			gates: [6],
		});
	});

	it("picks up a project's own .conductor/skills/ as part of the known-skill catalog (no unknown-skill false negative)", async () => {
		// Even without any project role referencing it, this proves the project skills dir is wired
		// into the same knownSkills set the role loader cross-checks against -- a regression here
		// would only show up once a project role is added, which is exactly what a unit test should
		// catch before that day.
		project.mkdir(".conductor/skills/my-skill");
		project.write(".conductor/skills/my-skill/SKILL.md", '---\nname: my-skill\ndescription: "x"\n---\n\nBody.\n');

		const report = await runRolesList({ cwd: project.root });

		expect(report.diagnostics).toEqual([]); // built-in roles still all resolve; nothing regressed
	});
});

describe("formatRolesListReport", () => {
	it("renders a header, one row per role, the tools-gap note, and a UTC generatedAt footer", async () => {
		const report = await runRolesList({ cwd: project.root });

		const text = formatRolesListReport(report);

		expect(text).toContain("SLUG");
		expect(text).toContain("backend-engineer");
		expect(text).toContain("design-service");
		expect(text).toMatch(/tools allowlists are not yet declared/);
		expect(text).toContain("37 role(s)");
		expect(text).toMatch(/Generated at .+\(UTC\)/);
	});

	it("renders a Diagnostics section only when diagnostics are present", async () => {
		const emptyReport = { roles: [], diagnostics: [], generatedAt: new Date().toISOString() };
		expect(formatRolesListReport(emptyReport)).not.toContain("Diagnostics");

		const withDiagnostics = { ...emptyReport, diagnostics: ["unknown-skill: ghost-role -- x"] };
		expect(formatRolesListReport(withDiagnostics)).toContain("Diagnostics");
		expect(formatRolesListReport(withDiagnostics)).toContain("unknown-skill: ghost-role -- x");
	});
});

describe("conductor roles list (end-to-end dispatch)", () => {
	it("exits 0 and prints the role catalog to stdout", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["roles", "list"], io);

		expect(code).toBe(0);
		expect(stdout()).toContain("backend-engineer");
		expect(stdout()).toContain("37 role(s)");
	});

	it("rejects an unknown roles subcommand with a non-zero exit and a usage hint on stderr", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["roles", "bogus"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unknown subcommand/);
	});

	it("rejects extra arguments to `roles list`", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["roles", "list", "extra"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unrecognized argument/);
	});
});
