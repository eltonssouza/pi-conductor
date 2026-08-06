/**
 * `role-catalog.ts` -- Gate 5/6 (red-first) for the real, on-disk Role Registry loading that backs
 * `conductor roles list`: parsing `templates/agents/<slug>.md` frontmatter for every one of the 37
 * `BUILTIN_ROLES` and cross-checking each role's skills against a known-skill set.
 */

import { BUILTIN_ROLES } from "@conductor/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBuiltinAgentsDir } from "../../src/builtin-paths.ts";
import { loadBuiltinRoleCatalog } from "../../src/commands/role-catalog.ts";
import { loadBuiltinSkillCatalog } from "../../src/commands/skill-catalog.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function realKnownSkills(): Set<string> {
	return new Set(loadBuiltinSkillCatalog().skills.map((s) => s.name));
}

describe("loadBuiltinRoleCatalog -- the real, shipped templates/agents/", () => {
	it("loads all 37 built-in roles with zero diagnostics against the real skill catalog", () => {
		const catalog = loadBuiltinRoleCatalog({ knownSkills: realKnownSkills() });

		expect(catalog.registry.roles.size).toBe(37);
		expect(catalog.diagnostics).toEqual([]);
	});

	it("every loaded role's slug matches BUILTIN_ROLES exactly (no silent renaming/dropping)", () => {
		const catalog = loadBuiltinRoleCatalog({ knownSkills: realKnownSkills() });

		const expectedSlugs = BUILTIN_ROLES.map((r) => r.slug).sort();
		const actualSlugs = Array.from(catalog.registry.roles.keys()).sort();
		expect(actualSlugs).toEqual(expectedSlugs);
	});

	it("a role's parsed shape carries a non-empty systemPrompt, a valid modelRole, and its skills/canSpawn/gates from BUILTIN_ROLES", () => {
		const catalog = loadBuiltinRoleCatalog({ knownSkills: realKnownSkills() });

		const backendEngineer = catalog.registry.roles.get("backend-engineer");
		expect(backendEngineer).toBeDefined();
		expect(backendEngineer?.systemPrompt.length).toBeGreaterThan(0);
		expect(["strategic", "standard", "lightweight"]).toContain(backendEngineer?.modelRole);
		expect(backendEngineer?.skills).toEqual(["design-service"]);
		expect(backendEngineer?.canSpawn).toEqual([]);
		expect(backendEngineer?.gates).toEqual([6]);
		expect(backendEngineer?.area).toBe("engineering");
		expect(backendEngineer?.source).toBe("builtin");
		expect(backendEngineer?.contentHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("a role with extraSkills combines [skill, ...extraSkills] (skill first)", () => {
		const catalog = loadBuiltinRoleCatalog({ knownSkills: realKnownSkills() });

		const sre = catalog.registry.roles.get("site-reliability-engineer");
		expect(sre?.skills).toEqual(["service-reliability", "incident-response"]);
	});

	it("KNOWN GAP, documented not invented: every built-in role's tools ceiling is the empty array, never undefined", () => {
		const catalog = loadBuiltinRoleCatalog({ knownSkills: realKnownSkills() });

		for (const role of catalog.registry.roles.values()) {
			expect(role.tools).toEqual([]);
		}
	});
});

describe("loadBuiltinRoleCatalog -- fail-closed error paths", () => {
	it("excludes every role with a named 'missing-template-file' diagnostic when the agents directory does not exist", () => {
		const catalog = loadBuiltinRoleCatalog({
			agentsDir: `${project.root}/does-not-exist`,
			knownSkills: realKnownSkills(),
		});

		expect(catalog.registry.roles.size).toBe(0);
		expect(catalog.diagnostics).toHaveLength(BUILTIN_ROLES.length);
		expect(catalog.diagnostics.every((d) => d.kind === "missing-template-file")).toBe(true);
	});

	it("excludes only the one role with invalid frontmatter, naming it, while other diagnostics stay missing-template-file", () => {
		project.mkdir("agents");
		project.write(
			"agents/backend-engineer.md",
			"---\nname: backend-engineer\nmodel: standard\n---\n\nNo description field.\n",
		);

		const catalog = loadBuiltinRoleCatalog({
			agentsDir: `${project.root}/agents`,
			knownSkills: realKnownSkills(),
		});

		const backendDiagnostic = catalog.diagnostics.find((d) => d.roleId === "backend-engineer");
		expect(backendDiagnostic?.kind).toBe("invalid-frontmatter");
		expect(catalog.registry.roles.has("backend-engineer")).toBe(false);
		// every other role is still a distinct, named diagnostic -- one bad file never poisons the batch.
		expect(
			catalog.diagnostics
				.filter((d) => d.roleId !== "backend-engineer")
				.every((d) => d.kind === "missing-template-file"),
		).toBe(true);
	});

	it("rejects a role whose frontmatter model is not one of strategic/standard/lightweight", () => {
		project.mkdir("agents");
		project.write(
			"agents/backend-engineer.md",
			'---\nname: backend-engineer\nmodel: gpt-5\ndescription: "Backend Engineer."\n---\n\nBody.\n',
		);

		const catalog = loadBuiltinRoleCatalog({
			agentsDir: `${project.root}/agents`,
			knownSkills: realKnownSkills(),
		});

		const diagnostic = catalog.diagnostics.find((d) => d.roleId === "backend-engineer");
		expect(diagnostic?.kind).toBe("invalid-frontmatter");
		expect(diagnostic?.detail).toMatch(/strategic\/standard\/lightweight/);
	});

	it("excludes every role, non-partial, naming the missing skill, when knownSkills is empty (BR-1/R21 applied to the real catalog)", () => {
		const catalog = loadBuiltinRoleCatalog({ agentsDir: getBuiltinAgentsDir(), knownSkills: new Set() });

		expect(catalog.registry.roles.size).toBe(0);
		expect(catalog.diagnostics.length).toBeGreaterThanOrEqual(BUILTIN_ROLES.length);
		expect(catalog.diagnostics.every((d) => d.kind === "unknown-skill")).toBe(true);
	});
});
