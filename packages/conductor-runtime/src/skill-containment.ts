/**
 * Skill containment — `filterSkillsWithinRoots` (docs/adr/0004-fase3-roles-skills-subagents.md
 * §7/§16; T38/R20, docs/conductor/gate3-addendum-fase3.md GAP-3E).
 *
 * Progressive disclosure of skills is ALREADY native to the Pi
 * (`packages/coding-agent/src/core/skills.ts:formatSkillsForPrompt` — injects only
 * name+description+`<location>`, instructs "use the read tool to load a skill's file"; the body only
 * enters the conversation on demand). This module does NOT reimplement that loader — it is the one
 * thing the ADR says the Fase-3 skill surface ADDS on top of it: containment. `<location>` is
 * untrusted input from a `project`/repo source the same way `policy.json`/a role file is (T18/T37 by
 * a third door) — a location that resolves OUTSIDE every known skills-root must never be read, on
 * pain of path-traversal disclosure of an arbitrary file (T38(b)).
 *
 * Reuses the SAME path-containment authority the rest of this package already established
 * (`workspace-policy.ts`'s `resolveRealPath`/`isWithinRoot`) rather than a second canonicalization —
 * ADR §7: "reusa a autoridade única de path… não uma segunda implementação (uma segunda
 * canonicalização seria a exata classe de bug que a Fase 0 fechou)".
 *
 * GATE 5 (test-first): `filterSkillsWithinRoots` is a STUB that throws "not implemented" — Gate 6
 * implements the body reusing `resolveRealPath`/`isWithinRoot` from `./workspace-policy.ts`.
 *
 * Exact signature from ADR §16's appendix, extended ONLY with optional metadata fields
 * (`version`/`gates`, plan §4.6's SKILL.md frontmatter fields, FR-4's "campos mínimos" for
 * `conductor skills list`) — additive, so every existing required field (`name`/`description`/
 * `location`) keeps its exact contract; a minimal native-Pi catalog entry lacking those two optional
 * fields still satisfies this shape.
 */

import { isWithinRoot, resolveRealPath } from "./workspace-policy.ts";

export interface SkillCatalogEntry {
	name: string;
	description: string;
	location: string;
	/** plan §4.6 frontmatter field — optional (FR-4). */
	version?: string;
	/** plan §4.6 frontmatter field — the gates this skill applies to (FR-4). */
	gates?: number[];
}

export interface ContainedSkillCatalogEntry extends SkillCatalogEntry {
	/** The canonicalized real path `location` resolved to, once proven contained. */
	realPath: string;
}

export interface SkillContainmentViolation {
	name: string;
	declaredLocation: string;
	reason: string;
}

export interface FilterSkillsWithinRootsResult {
	included: ContainedSkillCatalogEntry[];
	excluded: SkillContainmentViolation[];
}

/**
 * Splits `skills` into those whose `location` canonicalizes to a path within ONE OF `skillsRoots`
 * (`included`, carrying the resolved `realPath`) and those that do not (`excluded`, with a named
 * diagnostic — never a silent drop, R20 extends BR-2's "invalid metadata is excluded with a
 * diagnostic" from metadata validity to path containment). A `location` need only be contained by
 * ANY one of `skillsRoots` (a project's own skills dir and the user's global skills dir are both
 * legitimate roots) to be included.
 */
export function filterSkillsWithinRoots(
	skills: SkillCatalogEntry[],
	skillsRoots: string[],
): FilterSkillsWithinRootsResult {
	const included: ContainedSkillCatalogEntry[] = [];
	const excluded: SkillContainmentViolation[] = [];

	let resolvedRoots: string[];
	try {
		// Each root is canonicalized against itself (mirrors workspace-policy.ts's own
		// `realpathOfExistingAncestorOrLexical` pattern for a path that is its own base directory).
		resolvedRoots = skillsRoots.map((root) => resolveRealPath(root, root));
	} catch (error) {
		// Fail-closed (R20): if a configured skills-root itself cannot be resolved, no skill can be
		// PROVEN contained against it — exclude every skill in this batch rather than silently
		// treating an unresolvable root as "no root, so nothing is contained" or worse "anything
		// goes".
		const reason = `unable to resolve a configured skills-root: ${error instanceof Error ? error.message : String(error)}`;
		for (const skill of skills) {
			excluded.push({ name: skill.name, declaredLocation: skill.location, reason });
		}
		return { included, excluded };
	}

	for (const skill of skills) {
		try {
			const realPath = resolveRealPath(skill.location, skill.location);
			const contained = resolvedRoots.some((root) => isWithinRoot(realPath, root));
			if (contained) {
				included.push({ ...skill, realPath });
			} else {
				excluded.push({
					name: skill.name,
					declaredLocation: skill.location,
					reason: `"${skill.location}" resolves outside every known skills-root`,
				});
			}
		} catch (error) {
			// A genuine I/O oddity resolving this one skill's location never poisons the rest of the
			// batch (R20 extends BR-2's non-partial guarantee from roles to skills) — exclude just
			// this skill with a named reason.
			excluded.push({
				name: skill.name,
				declaredLocation: skill.location,
				reason: `unable to resolve location: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	return { included, excluded };
}
