/**
 * `conductor skills list` -- Gate 5/6 (red-first), mirrors doctor.test.ts's own structure.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.ts";
import { formatSkillsListReport, runSkillsList } from "../../src/commands/skills.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("runSkillsList -- the real, shipped skill catalog", () => {
	it("lists all 44 built-in skills, sorted by name, with no diagnostics", async () => {
		const report = await runSkillsList({ cwd: project.root });

		expect(report.skills).toHaveLength(44);
		expect(report.diagnostics).toEqual([]);
		const names = report.skills.map((s) => s.name);
		expect(names).toEqual([...names].sort());
	});

	it("each row carries name + description (frontmatter), nothing more", async () => {
		const report = await runSkillsList({ cwd: project.root });

		const designService = report.skills.find((s) => s.name === "design-service");
		expect(designService?.name).toBe("design-service");
		expect(designService?.description.length).toBeGreaterThan(0);
	});

	it("includes a project's own .conductor/skills/ alongside the built-in catalog", async () => {
		project.mkdir(".conductor/skills/my-project-skill");
		project.write(
			".conductor/skills/my-project-skill/SKILL.md",
			'---\nname: my-project-skill\ndescription: "A project skill."\n---\n\nBody.\n',
		);

		const report = await runSkillsList({ cwd: project.root });

		expect(report.skills.map((s) => s.name)).toContain("my-project-skill");
		expect(report.skills).toHaveLength(45);
	});
});

describe("formatSkillsListReport", () => {
	it("renders one line per skill and a UTC generatedAt footer", async () => {
		const report = await runSkillsList({ cwd: project.root });

		const text = formatSkillsListReport(report);

		expect(text).toContain("design-service");
		expect(text).toContain("44 skill(s)");
		expect(text).toMatch(/Generated at .+\(UTC\)/);
	});

	it("renders a Diagnostics section only when diagnostics are present", () => {
		const emptyReport = { skills: [], diagnostics: [], generatedAt: new Date().toISOString() };
		expect(formatSkillsListReport(emptyReport)).not.toContain("Diagnostics");

		const withDiagnostics = { ...emptyReport, diagnostics: ["excluded: ghost -- outside every known root"] };
		expect(formatSkillsListReport(withDiagnostics)).toContain("Diagnostics");
	});
});

describe("conductor skills list (end-to-end dispatch)", () => {
	it("exits 0 and prints the skill catalog to stdout", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["skills", "list"], io);

		expect(code).toBe(0);
		expect(stdout()).toContain("design-service");
		expect(stdout()).toContain("44 skill(s)");
	});

	it("rejects an unknown skills subcommand with a non-zero exit and a usage hint on stderr", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["skills", "bogus"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unknown subcommand/);
	});

	it("rejects extra arguments to `skills list`", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["skills", "list", "extra"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unrecognized argument/);
	});
});
