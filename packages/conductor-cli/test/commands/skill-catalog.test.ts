/**
 * `skill-catalog.ts` -- Gate 5/6 (red-first) for the real, on-disk skill discovery that backs
 * `conductor skills list` and the built-in role loader's `knownSkills` cross-check.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBuiltinSkillsDir } from "../../src/builtin-paths.ts";
import { defaultProjectSkillsDir, loadBuiltinSkillCatalog } from "../../src/commands/skill-catalog.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("loadBuiltinSkillCatalog -- the real, shipped templates/skills/", () => {
	it("loads exactly 44 skills with zero exclusions and zero load diagnostics", () => {
		const catalog = loadBuiltinSkillCatalog();

		expect(catalog.skills).toHaveLength(44);
		expect(catalog.excluded).toEqual([]);
		expect(catalog.loadDiagnostics).toEqual([]);
	});

	it("every skill carries a non-empty name and description and a realPath under the builtin dir", () => {
		const catalog = loadBuiltinSkillCatalog();
		const builtinDir = getBuiltinSkillsDir();

		for (const skill of catalog.skills) {
			expect(skill.name.length).toBeGreaterThan(0);
			expect(skill.description.length).toBeGreaterThan(0);
			expect(skill.realPath.startsWith(builtinDir)).toBe(true);
		}
	});

	it("includes the role-paired skills named by BUILTIN_ROLES (e.g. design-service, model-threats)", () => {
		const catalog = loadBuiltinSkillCatalog();
		const names = new Set(catalog.skills.map((s) => s.name));

		expect(names.has("design-service")).toBe(true);
		expect(names.has("model-threats")).toBe(true);
		expect(names.has("self-learning")).toBe(true); // a meta-skill, not role-paired
	});
});

describe("loadBuiltinSkillCatalog -- scratch fixtures (error paths)", () => {
	it("degrades to an empty catalog (never throws) when the built-in directory does not exist", () => {
		const catalog = loadBuiltinSkillCatalog({ builtinSkillsDir: `${project.root}/does-not-exist` });

		expect(catalog.skills).toEqual([]);
		expect(catalog.excluded).toEqual([]);
	});

	it("discovers a project's own .conductor/skills/<name>/SKILL.md alongside the built-in catalog", () => {
		project.mkdir(".conductor/skills/my-project-skill");
		project.write(
			".conductor/skills/my-project-skill/SKILL.md",
			'---\nname: my-project-skill\ndescription: "A project-authored skill."\n---\n\nBody.\n',
		);

		const catalog = loadBuiltinSkillCatalog({ projectSkillsDir: defaultProjectSkillsDir(project.root) });

		const names = catalog.skills.map((s) => s.name);
		expect(names).toContain("my-project-skill");
		expect(names).toContain("design-service"); // built-in catalog still included alongside it
	});

	it("ignores a project skills directory that does not exist (no error, no effect)", () => {
		const catalog = loadBuiltinSkillCatalog({ projectSkillsDir: defaultProjectSkillsDir(project.root) });

		expect(catalog.skills.length).toBe(44); // built-in only, no throw for the absent project dir
	});

	it("excludes (never silently drops) a skill whose SKILL.md fails frontmatter validation, with a load diagnostic", () => {
		project.mkdir(".conductor/skills/broken-skill");
		project.write(
			".conductor/skills/broken-skill/SKILL.md",
			"---\nname: broken-skill\n---\n\nNo description at all.\n",
		);

		const catalog = loadBuiltinSkillCatalog({ projectSkillsDir: defaultProjectSkillsDir(project.root) });

		expect(catalog.skills.map((s) => s.name)).not.toContain("broken-skill");
		expect(catalog.loadDiagnostics.some((d) => d.includes("description"))).toBe(true);
	});
});

describe("defaultProjectSkillsDir", () => {
	it("points at <cwd>/.conductor/skills -- Conductor's own convention, not the Pi tool's .pi", () => {
		expect(defaultProjectSkillsDir("/some/project")).toMatch(/[/\\]\.conductor[/\\]skills$/);
	});
});
