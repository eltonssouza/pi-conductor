/**
 * The 37 built-in roles + 14-gate delegation table, ported from `conductor-main`'s Python source of
 * truth (`conductor-main/conductor/roles.py:ROLES`/`GATE_ROLES`) — Gate 6 of
 * `feature/fase3-papeis-skills-e-subagentes`, closing the real deliverable gap the orchestrator found
 * (zero role/skill data had actually been ported despite role-loader.ts/delegation-graph.ts being
 * GREEN against synthetic fixtures).
 *
 * Ported, not re-derived: `roles.py` is a plain Python dict literal with no runtime behavior beyond
 * two pure functions (`gates_for`/`select_roles`), so this file transcribes its two data tables
 * faithfully rather than shelling out to Python at build or test time (this repo is a pure Node/TS
 * monorepo — a hard Python dependency for `npx vitest run` would be a new, fragile, environment-only
 * assumption that this repo's own CI cannot satisfy, since it does not check out the separate
 * `conductor-main` repository). Fidelity against silent drift is instead proven two ways in
 * `test/builtin-roles-data.test.ts`:
 *
 *   1. Structural invariants checkable with NO external file at all (slug count, no duplicate slugs,
 *      every `spawns`/`extraSkills` target names a real slug/skill, and — reusing this same package's
 *      already-GREEN `validateDelegationGraph` — the merged `spawns` graph is acyclic with no unknown
 *      target, exactly the property `roles.py`'s own `find_cycle`/R23 asserts on the Python side).
 *   2. An OPPORTUNISTIC line-for-line cross-check against the real `roles.py` file when it is
 *      reachable on disk (via `CONDUCTOR_MAIN_ROLES_PY` or the sibling-repo default path this exact
 *      dev workspace uses) — a lightweight regex extraction of the same two literals, compared
 *      key-for-key against `BUILTIN_ROLES`/`BUILTIN_GATE_ROLES` below. Skipped (not failed) when the
 *      file is absent, so this package's test suite never depends on a sibling repository being
 *      checked out — but catches a transcription mistake immediately in the one workspace (this one)
 *      where both repos are actually side by side.
 *
 * `Role.tools` in `AgentConfig`/`ConductorRole`'s sense DOES NOT EXIST anywhere in `roles.py` — every
 * `Role` dataclass instance below carries only `skill`/`area`/`extra_skills`/`spawns`. This file
 * therefore has NO `tools` field, deliberately: inventing a per-role tools allowlist here (or in the
 * CLI loader that consumes this data) would be exactly the "silent reconciliation" the Gate 6 task
 * instructions warn against for a security-relevant, per-role capability ceiling nobody has actually
 * decided yet (see `@conductor/cli/src/commands/role-catalog.ts`'s header for how that gap is
 * surfaced instead of papered over).
 */

/** One row of `roles.py:ROLES` (the dataclass fields, not the Python-only `Role` type itself). */
export interface BuiltinRoleSpec {
	/** Agent template slug (`templates/agents/<slug>.md`). */
	readonly slug: string;
	/** The 1:1 paired skill (`templates/skills/<skill>/SKILL.md`). */
	readonly skill: string;
	readonly area: string;
	/** Standalone capability skills this role pulls in beyond its 1:1 paired one (roles.py: `extra_skills`). */
	readonly extraSkills: readonly string[];
	/** Delegation edges — roles this role may `task` into (roles.py: `spawns`). Empty = leaf. */
	readonly spawns: readonly string[];
}

/**
 * `roles.py:ROLES` verbatim (order preserved — matches the Python dict's insertion order, which
 * `roles.py`'s own file groups by area with a comment per section).
 */
export const BUILTIN_ROLES: readonly BuiltinRoleSpec[] = [
	// Management / Product
	{
		slug: "product-manager",
		skill: "product-discovery",
		area: "product",
		extraSkills: [],
		spawns: ["business-analyst", "ux-researcher", "ux-designer"],
	},
	{
		slug: "product-owner",
		skill: "refine-backlog",
		area: "product",
		extraSkills: [],
		spawns: ["product-manager", "business-analyst", "ux-researcher", "quality-assurance"],
	},
	{
		slug: "technical-program-manager",
		skill: "plan-program",
		area: "product",
		extraSkills: [],
		spawns: ["engineering-manager", "tech-lead", "product-owner"],
	},
	{
		slug: "engineering-manager",
		skill: "team-diagnosis",
		area: "product",
		extraSkills: [],
		spawns: ["tech-lead", "scrum-master", "agile-coach"],
	},
	{ slug: "business-analyst", skill: "map-requirements", area: "product", extraSkills: [], spawns: [] },
	{ slug: "scrum-master", skill: "facilitate-retro", area: "product", extraSkills: [], spawns: [] },
	{ slug: "agile-coach", skill: "agile-diagnosis", area: "product", extraSkills: [], spawns: [] },
	{
		slug: "cto",
		skill: "technology-strategy",
		area: "product",
		extraSkills: [],
		spawns: ["vp-engineering", "principal-engineer", "enterprise-architect", "ciso"],
	},
	{
		slug: "vp-engineering",
		skill: "scale-organization",
		area: "product",
		extraSkills: [],
		spawns: ["engineering-manager", "technical-program-manager", "principal-engineer"],
	},
	// Engineering
	{ slug: "software-engineer", skill: "implement-feature-tdd", area: "engineering", extraSkills: [], spawns: [] },
	{
		slug: "tech-lead",
		skill: "drive-technical-decision",
		area: "engineering",
		extraSkills: [],
		spawns: [
			"software-engineer",
			"frontend-engineer",
			"backend-engineer",
			"fullstack-engineer",
			"sdet",
			"quality-assurance",
		],
	},
	{ slug: "frontend-engineer", skill: "build-ui-component", area: "engineering", extraSkills: [], spawns: [] },
	{ slug: "backend-engineer", skill: "design-service", area: "engineering", extraSkills: [], spawns: [] },
	{ slug: "fullstack-engineer", skill: "deliver-vertical-feature", area: "engineering", extraSkills: [], spawns: [] },
	{
		slug: "staff-engineer",
		skill: "lead-technical-initiative",
		area: "engineering",
		extraSkills: [],
		spawns: ["software-architect", "tech-lead", "site-reliability-engineer"],
	},
	{
		slug: "principal-engineer",
		skill: "define-technical-direction",
		area: "engineering",
		extraSkills: [],
		spawns: ["staff-engineer", "software-architect", "security-engineer"],
	},
	// Architecture
	{
		slug: "software-architect",
		skill: "decide-architecture",
		area: "architecture",
		extraSkills: [],
		spawns: [
			"solutions-architect",
			"tech-lead",
			"security-engineer",
			"database-administrator",
			"site-reliability-engineer",
		],
	},
	{
		slug: "solutions-architect",
		skill: "design-solution",
		area: "architecture",
		extraSkills: [],
		spawns: ["backend-engineer", "database-administrator", "site-reliability-engineer"],
	},
	{
		slug: "enterprise-architect",
		skill: "map-enterprise-architecture",
		area: "architecture",
		extraSkills: [],
		spawns: ["software-architect", "solutions-architect"],
	},
	// Data / AI
	{ slug: "database-administrator", skill: "optimize-database", area: "data", extraSkills: [], spawns: [] },
	{ slug: "data-engineer", skill: "build-data-pipeline", area: "data", extraSkills: [], spawns: [] },
	{
		slug: "data-scientist",
		skill: "predictive-analysis",
		area: "data",
		extraSkills: [],
		spawns: ["data-engineer"],
	},
	{
		slug: "machine-learning-engineer",
		skill: "productionize-model",
		area: "data",
		extraSkills: [],
		spawns: ["data-engineer"],
	},
	{
		slug: "ai-engineer",
		skill: "design-llm-system",
		area: "data",
		extraSkills: [],
		spawns: ["machine-learning-engineer", "data-engineer"],
	},
	// Ops / Infra
	{
		slug: "site-reliability-engineer",
		skill: "service-reliability",
		area: "ops",
		extraSkills: ["incident-response"],
		spawns: ["devops-engineer", "platform-engineer"],
	},
	{
		slug: "devops-engineer",
		skill: "build-cicd-pipeline",
		area: "ops",
		extraSkills: ["supply-chain-security"],
		spawns: ["platform-engineer"],
	},
	{ slug: "platform-engineer", skill: "build-platform-capability", area: "ops", extraSkills: [], spawns: [] },
	// Quality
	{
		slug: "quality-assurance",
		skill: "test-strategy",
		area: "quality",
		extraSkills: [],
		spawns: ["sdet", "qa-guardian"],
	},
	{ slug: "sdet", skill: "automate-tests", area: "quality", extraSkills: [], spawns: [] },
	{ slug: "qa-guardian", skill: "guard-quality", area: "quality", extraSkills: [], spawns: ["sdet"] },
	// Security / Privacy
	{
		slug: "security-engineer",
		skill: "model-threats",
		area: "security",
		extraSkills: ["secure-coding-patterns", "supply-chain-security"],
		spawns: ["application-security-engineer"],
	},
	{
		slug: "application-security-engineer",
		skill: "review-app-security",
		area: "security",
		extraSkills: ["pentest-infrastructure", "secure-coding-patterns"],
		spawns: [],
	},
	{
		slug: "ciso",
		skill: "security-program",
		area: "security",
		extraSkills: ["incident-response", "supply-chain-security"],
		spawns: ["security-engineer", "application-security-engineer", "data-protection-officer"],
	},
	{
		slug: "data-protection-officer",
		skill: "assess-privacy",
		area: "security",
		extraSkills: ["incident-response"],
		spawns: [],
	},
	// Design / UX
	{
		slug: "ux-designer",
		skill: "design-ux-flow",
		area: "design",
		extraSkills: [],
		spawns: ["ui-designer", "ux-researcher"],
	},
	{ slug: "ux-researcher", skill: "conduct-ux-research", area: "design", extraSkills: [], spawns: [] },
	{ slug: "ui-designer", skill: "design-visual-interface", area: "design", extraSkills: [], spawns: [] },
];

/** `roles.py:GATE_ROLES` verbatim — the flow's per-gate role table (`templates/flow.md`'s own
 * `**Roles:**` line, kept identical to it by `roles.py`'s own R23). */
export const BUILTIN_GATE_ROLES: Readonly<Record<number, readonly string[]>> = {
	1: ["product-manager", "product-owner", "business-analyst", "ux-researcher"],
	2: ["product-owner", "business-analyst", "quality-assurance"],
	3: ["security-engineer", "application-security-engineer", "data-protection-officer", "ciso"],
	4: [
		"software-architect",
		"solutions-architect",
		"enterprise-architect",
		"tech-lead",
		"staff-engineer",
		"principal-engineer",
		"site-reliability-engineer",
	],
	5: ["sdet", "quality-assurance", "qa-guardian", "software-engineer"],
	6: ["software-engineer", "frontend-engineer", "backend-engineer", "fullstack-engineer", "ui-designer"],
	7: ["devops-engineer", "platform-engineer", "sdet", "qa-guardian"],
	8: ["quality-assurance", "qa-guardian", "business-analyst", "product-owner"],
	9: ["application-security-engineer", "security-engineer", "ciso"],
	10: ["devops-engineer", "platform-engineer", "site-reliability-engineer", "ciso"],
	11: ["site-reliability-engineer", "devops-engineer"],
	12: ["site-reliability-engineer", "engineering-manager", "agile-coach"],
	13: ["application-security-engineer", "security-engineer", "devops-engineer"],
	14: ["application-security-engineer", "security-engineer", "site-reliability-engineer", "ciso"],
};

/** Looks up a built-in role spec by slug, or `undefined` if it is not one of the 37. */
export function findBuiltinRole(slug: string): BuiltinRoleSpec | undefined {
	return BUILTIN_ROLES.find((role) => role.slug === slug);
}

/** roles.py: `skill_for` + the role's own `extra_skills` combined — "in TypeScript
 * (`ConductorRole.skills: string[]`), combine as `[skill, ...extra_skills]`" (Gate 6 task brief),
 * because `skill` is the 1:1-paired PRIMARY skill and must stay first/distinguishable from the
 * standalone capability skills that follow it. */
export function skillsForBuiltinRole(role: BuiltinRoleSpec): string[] {
	return [role.skill, ...role.extraSkills];
}

/** roles.py: `gates_for` — the gates that delegate to this role, ascending. Declarative data only
 * (ADR 0004 §3: "the gate machine is Phase 4, a non-goal here") — this never runs a gate, it only
 * says which gates' `**Roles:**` line names this role, mirroring `BUILTIN_GATE_ROLES` (this file's
 * own single source of truth for the mapping, so `ConductorRole.gates` is never a second hand-typed
 * copy of the same fact — Pragmatic Programming Practices §1.2/§1.4, "DRY: one home for each piece of
 * knowledge" / "single source of truth", cited at `cdt library --gate 6` for this exact port). */
export function gatesForBuiltinRole(slug: string): number[] {
	const gates: number[] = [];
	for (const [gate, roles] of Object.entries(BUILTIN_GATE_ROLES)) {
		if (roles.includes(slug)) gates.push(Number(gate));
	}
	return gates.sort((a, b) => a - b);
}
