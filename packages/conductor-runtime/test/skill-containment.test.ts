/**
 * Gate 5 (test-first) for skill-containment.ts — derives R20/T38 (docs/conductor/gate3-addendum-fase3.md
 * §2 "T38", §4 "R20") and GAP-3E, plus FR-4's "campos mínimos" pass-through
 * (docs/conductor/gate2-spec-fase3.md Grupo B). Every test below MUST fail RED right now:
 * `filterSkillsWithinRoots` is a stub that throws "not implemented" (Gate 6 implements the body,
 * reusing `resolveRealPath`/`isWithinRoot` from `./workspace-policy.ts` — the SAME path-containment
 * authority `workspace-policy.test.ts` already exercises, not a second canonicalization).
 *
 * Real filesystem, never mocked, always against a disposable scratch workspace — same discipline
 * `workspace-policy.test.ts` already established for path-containment tests in this package.
 */

import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterSkillsWithinRoots, type SkillCatalogEntry } from "../src/skill-containment.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function makeSkillsRoot(name: string): string {
	const root = join(workspace.root, name);
	mkdirSync(root, { recursive: true });
	return root;
}

describe("filterSkillsWithinRoots — R20/T38", () => {
	it("includes a skill whose location resolves within a known skills-root", () => {
		const skillsRoot = makeSkillsRoot("skills");
		const skillDir = join(skillsRoot, "design-service");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "# design-service");

		const entries: SkillCatalogEntry[] = [
			{ name: "design-service", description: "Use when designing a service.", location: join(skillDir, "SKILL.md") },
		];

		const result = filterSkillsWithinRoots(entries, [skillsRoot]);

		expect(result.excluded).toEqual([]);
		expect(result.included).toHaveLength(1);
		expect(result.included[0].name).toBe("design-service");
		expect(result.included[0].realPath).toBe(realpathSync(join(skillDir, "SKILL.md")));
	});

	// T38(b): a location that escapes every known skills-root via lexical traversal must never be
	// read — excluded with a diagnostic naming the violation, never silently followed.
	it("excludes a skill whose location escapes every known skills-root via ../ traversal", () => {
		const skillsRoot = makeSkillsRoot("skills");
		const outsideDir = makeSkillsRoot("outside-secrets");
		writeFileSync(join(outsideDir, "credentials.txt"), "top secret");

		const escapingLocation = join(skillsRoot, "..", "outside-secrets", "credentials.txt");
		const entries: SkillCatalogEntry[] = [
			{ name: "malicious-skill", description: "Looks innocent.", location: escapingLocation },
		];

		const result = filterSkillsWithinRoots(entries, [skillsRoot]);

		expect(result.included).toEqual([]);
		expect(result.excluded).toHaveLength(1);
		expect(result.excluded[0]).toMatchObject({ name: "malicious-skill", declaredLocation: escapingLocation });
		expect(result.excluded[0].reason).toBeTruthy();
	});

	// T38(b): a symlink inside a skills-root that RESOLVES outside it must be caught the same way a
	// lexical traversal is — the containment check happens on the canonicalized real path.
	it("excludes a skill whose location is a symlink inside a skills-root that resolves outside it", () => {
		const skillsRoot = makeSkillsRoot("skills");
		const outsideDir = createScratchWorkspace("conductor-runtime-skill-outside-");
		try {
			writeFileSync(join(outsideDir.root, "evil-skill.md"), "# not actually a skill");

			let linkPath: string;
			try {
				linkPath = join(skillsRoot, "escape-link");
				symlinkSync(outsideDir.root, linkPath, "junction");
			} catch {
				return; // Symlink creation can require elevated privileges on Windows — skip rather than fail.
			}

			const entries: SkillCatalogEntry[] = [
				{
					name: "symlink-escape-skill",
					description: "A skill hiding behind a symlink.",
					location: join(linkPath, "evil-skill.md"),
				},
			];

			const result = filterSkillsWithinRoots(entries, [skillsRoot]);

			expect(result.included).toEqual([]);
			expect(result.excluded).toHaveLength(1);
			expect(result.excluded[0].name).toBe("symlink-escape-skill");
		} finally {
			outsideDir.cleanup();
		}
	});

	it("includes a skill contained by ANY one of several skills-roots, not just the first", () => {
		const projectRoot = makeSkillsRoot("project-skills");
		const userRoot = makeSkillsRoot("user-skills");
		const skillInUserRoot = join(userRoot, "guard-quality", "SKILL.md");
		mkdirSync(join(userRoot, "guard-quality"), { recursive: true });
		writeFileSync(skillInUserRoot, "# guard-quality");

		const entries: SkillCatalogEntry[] = [
			{ name: "guard-quality", description: "Use to guard quality.", location: skillInUserRoot },
		];

		const result = filterSkillsWithinRoots(entries, [projectRoot, userRoot]);

		expect(result.excluded).toEqual([]);
		expect(result.included).toHaveLength(1);
	});

	// R20 extends BR-2's "invalid metadata excluded with diagnostic, never silently ignored" from
	// metadata validity to path containment — one violating skill in a batch never drags down the
	// others, exactly like buildRoleRegistry's non-partial guarantee for roles.
	it("excludes only the violating skill in a mixed batch, keeping every valid skill included", () => {
		const skillsRoot = makeSkillsRoot("skills");
		const validDir = join(skillsRoot, "automate-tests");
		mkdirSync(validDir, { recursive: true });
		writeFileSync(join(validDir, "SKILL.md"), "# automate-tests");

		const entries: SkillCatalogEntry[] = [
			{ name: "automate-tests", description: "Use to automate tests.", location: join(validDir, "SKILL.md") },
			{
				name: "escaping-skill",
				description: "Escapes the root.",
				location: join(skillsRoot, "..", "..", "etc", "passwd"),
			},
		];

		const result = filterSkillsWithinRoots(entries, [skillsRoot]);

		expect(result.included.map((s) => s.name)).toEqual(["automate-tests"]);
		expect(result.excluded.map((s) => s.name)).toEqual(["escaping-skill"]);
	});

	// FR-4: `conductor skills list`'s minimal fields (version/gates, plan §4.6) must survive
	// containment filtering unchanged — this module only decides in/out, it never strips metadata.
	it("passes optional version/gates metadata through unchanged for an included skill", () => {
		const skillsRoot = makeSkillsRoot("skills");
		const skillDir = join(skillsRoot, "design-service");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "# design-service");

		const entries: SkillCatalogEntry[] = [
			{
				name: "design-service",
				description: "Use when designing a service.",
				location: join(skillDir, "SKILL.md"),
				version: "1.0.0",
				gates: [4, 6],
			},
		];

		const result = filterSkillsWithinRoots(entries, [skillsRoot]);

		expect(result.included[0]).toMatchObject({ version: "1.0.0", gates: [4, 6] });
	});
});
