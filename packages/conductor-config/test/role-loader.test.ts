/**
 * Gate 5 (test-first) for role-loader.ts — derives FR-1/FR-2/FR-3/FR-20 and BR-1/BR-2
 * (docs/conductor/gate2-spec-fase3.md), R21/T39 (docs/conductor/gate3-addendum-fase3.md), and the
 * ADR's exact `ConductorRole` contract (docs/adr/0004-fase3-roles-skills-subagents.md §3/§16). Every
 * test below MUST fail RED right now: `buildRoleRegistry`/`resolveRole`/`listRoles`/`isToolAllowed`
 * are stubs that throw "not implemented" (Gate 6 implements the bodies).
 *
 * Scope note: these tests exercise the registry over already-built `ConductorRole` fixtures — the
 * same fidelity level `policy-loader.test.ts`'s `mergePolicies` describe blocks use for
 * already-built `PolicySource` fixtures — not real on-disk `.md` frontmatter parsing (that I/O
 * boundary is Gate 6/CLI wiring, per this module's own header).
 */

import { describe, expect, it } from "vitest";
import {
	buildRoleRegistry,
	type ConductorRole,
	isToolAllowed,
	listRoles,
	resolveRole,
	type RoleRegistry,
} from "../src/role-loader.ts";

function makeRole(overrides: Partial<ConductorRole> & { name: string }): ConductorRole {
	return {
		description: `${overrides.name} — fixture role`,
		systemPrompt: `You are ${overrides.name}.`,
		tools: [],
		modelRole: "standard",
		skills: [],
		canSpawn: [],
		gates: [],
		source: "builtin",
		contentHash: `hash-${overrides.name}`,
		filePath: `templates/agents/${overrides.name}.md`,
		...overrides,
	};
}

// ---------------------------------------------------------------------------------------------
// buildRoleRegistry — BR-1/BR-2/R21/T39: unknown-skill reference excludes the role, non-partial,
// with a named diagnostic; every other valid role still loads.
// ---------------------------------------------------------------------------------------------

describe("buildRoleRegistry", () => {
	it("loads every role whose skills all exist in the known-skill catalog", () => {
		const backendEngineer = makeRole({
			name: "backend-engineer",
			tools: ["read", "write", "edit"],
			skills: ["design-service"],
			modelRole: "standard",
			area: "engineering",
		});

		const registry = buildRoleRegistry([backendEngineer], new Set(["design-service"]));

		expect(registry.roles.get("backend-engineer")).toEqual(backendEngineer);
		expect(registry.diagnostics).toEqual([]);
	});

	// BR-1/R21/T39: a role naming a skill absent from the catalog fails to load ENTIRELY — never a
	// role that loads with that skill silently dropped (fail-closed, non-partial).
	it("excludes a role that references a skill not present in the known-skill catalog, naming the missing skill", () => {
		const ghostRole = makeRole({
			name: "ghost-role",
			skills: ["does-not-exist"],
		});

		const registry = buildRoleRegistry([ghostRole], new Set(["design-service"]));

		expect(registry.roles.has("ghost-role")).toBe(false);
		expect(registry.diagnostics).toEqual(
			expect.arrayContaining([{ kind: "unknown-skill", roleId: "ghost-role", skill: "does-not-exist" }]),
		);
	});

	// BR-2/T39: a skill excluded from the catalog upstream because its OWN metadata was invalid
	// (coding-agent/src/core/skills.ts's own diagnostic-and-exclude behavior) is, from this module's
	// point of view, indistinguishable from "does not exist" — knownSkills simply does not contain it.
	// A role cannot reach a malformed skill by naming it; it fails to load exactly like BR-1.
	it("treats a skill excluded upstream for invalid metadata the same as an unknown skill (BR-2)", () => {
		// Simulates the skill catalog having already excluded "broken-skill" for invalid frontmatter
		// (empty description) — it is simply absent from knownSkills, same as if it never existed.
		const roleUsingBrokenSkill = makeRole({
			name: "uses-broken-skill",
			skills: ["broken-skill"],
		});

		const registry = buildRoleRegistry([roleUsingBrokenSkill], new Set());

		expect(registry.roles.has("uses-broken-skill")).toBe(false);
		expect(registry.diagnostics).toEqual(
			expect.arrayContaining([{ kind: "unknown-skill", roleId: "uses-broken-skill", skill: "broken-skill" }]),
		);
	});

	// Non-partial is scoped to the OFFENDING role only — one bad role must never poison the whole
	// registry (mirrors mergePolicies's "a bad source is never outvoted by good ones", inverted: here
	// a bad ROLE never drags down the others).
	it("still loads every OTHER valid role when one role in the same batch is excluded", () => {
		const validRole = makeRole({ name: "software-engineer", skills: ["implement-feature-tdd"] });
		const ghostRole = makeRole({ name: "ghost-role", skills: ["does-not-exist"] });

		const registry = buildRoleRegistry([validRole, ghostRole], new Set(["implement-feature-tdd"]));

		expect(registry.roles.get("software-engineer")).toEqual(validRole);
		expect(registry.roles.has("ghost-role")).toBe(false);
		expect(registry.diagnostics).toHaveLength(1);
	});

	it("names EVERY missing skill when a role references more than one unknown skill", () => {
		const roleWithTwoGhosts = makeRole({
			name: "double-ghost",
			skills: ["missing-one", "missing-two"],
		});

		const registry = buildRoleRegistry([roleWithTwoGhosts], new Set());

		expect(registry.diagnostics).toEqual(
			expect.arrayContaining([
				{ kind: "unknown-skill", roleId: "double-ghost", skill: "missing-one" },
				{ kind: "unknown-skill", roleId: "double-ghost", skill: "missing-two" },
			]),
		);
	});
});

// ---------------------------------------------------------------------------------------------
// resolveRole — FR-1/FR-2: a known role resolves with its full shape; an unknown role is a named,
// non-silent error, with a proximity suggestion when one exists.
// ---------------------------------------------------------------------------------------------

describe("resolveRole", () => {
	function registryWith(...roles: ConductorRole[]): RoleRegistry {
		return buildRoleRegistry(roles, new Set(roles.flatMap((r) => r.skills)));
	}

	it("FR-1: a known role resolves carrying persona, skills, tools, and modelRole", () => {
		const backendEngineer = makeRole({
			name: "backend-engineer",
			description: "Backend Engineer.",
			systemPrompt: "You are a Backend Engineer.",
			tools: ["read", "write", "edit", "bash"],
			modelRole: "standard",
			skills: ["design-service"],
		});
		const registry = registryWith(backendEngineer);

		const result = resolveRole(registry, "backend-engineer");

		expect(result).toEqual({ status: "found", role: backendEngineer });
	});

	it("FR-2: an unregistered role id fails naming the role, never a silent generic session", () => {
		const registry = registryWith(makeRole({ name: "backend-engineer" }));

		const result = resolveRole(registry, "totally-made-up-role");

		expect(result.status).toBe("not-found");
		if (result.status === "not-found") {
			expect(result.roleId).toBe("totally-made-up-role");
		}
	});

	// FR-2: "quando houver um nome próximo no registro... sugere-o" — a typo close to a real role id
	// gets a suggestion. Behavior reference: conductor-main/tools/task.py:152-162 (difflib.get_close_matches).
	it("FR-2: a near-miss typo of a registered role id is suggested", () => {
		const registry = registryWith(makeRole({ name: "backend-engineer" }));

		const result = resolveRole(registry, "backedn-engineer");

		expect(result.status).toBe("not-found");
		if (result.status === "not-found") {
			expect(result.suggestion).toBe("backend-engineer");
		}
	});

	it("FR-2: no suggestion is offered when nothing in the registry is close", () => {
		const registry = registryWith(makeRole({ name: "backend-engineer" }));

		const result = resolveRole(registry, "xyzzy-completely-unrelated");

		expect(result.status).toBe("not-found");
		if (result.status === "not-found") {
			expect(result.suggestion).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------------------------
// listRoles — FR-3: `conductor roles list`'s minimal per-row fields, without opening a session.
// ---------------------------------------------------------------------------------------------

describe("listRoles", () => {
	it("FR-3: returns one entry per registered role with id/area/modelRole/skills/gates", () => {
		const backendEngineer = makeRole({
			name: "backend-engineer",
			area: "engineering",
			modelRole: "standard",
			skills: ["design-service"],
			gates: [4, 6],
		});
		const securityEngineer = makeRole({
			name: "security-engineer",
			area: "security",
			modelRole: "strategic",
			skills: ["model-threats"],
			gates: [3],
		});
		const registry = buildRoleRegistry([backendEngineer, securityEngineer], new Set(["design-service", "model-threats"]));

		const rows = listRoles(registry);

		expect(rows).toHaveLength(2);
		expect(rows).toEqual(
			expect.arrayContaining([
				{ id: "backend-engineer", area: "engineering", modelRole: "standard", skills: ["design-service"], gates: [4, 6] },
				{ id: "security-engineer", area: "security", modelRole: "strategic", skills: ["model-threats"], gates: [3] },
			]),
		);
	});

	it("FR-3: a role excluded by BR-1/BR-2 never appears in the listing", () => {
		const validRole = makeRole({ name: "software-engineer" });
		const ghostRole = makeRole({ name: "ghost-role", skills: ["does-not-exist"] });
		const registry = buildRoleRegistry([validRole, ghostRole], new Set());

		const rows = listRoles(registry);

		expect(rows.map((r) => r.id)).toEqual(["software-engineer"]);
	});
});

// ---------------------------------------------------------------------------------------------
// isToolAllowed — FR-20: a tool outside the role's `tools` allowlist is refused, fail-closed, same
// discipline as the Permission Engine's own default-deny.
// ---------------------------------------------------------------------------------------------

describe("isToolAllowed", () => {
	it("FR-20: allows a tool that is present in the role's tools list", () => {
		const role = makeRole({ name: "backend-engineer", tools: ["read", "write", "edit", "bash"] });

		expect(isToolAllowed(role, "bash")).toBe(true);
	});

	it("FR-20: refuses a tool absent from the role's tools list", () => {
		const businessAnalyst = makeRole({ name: "business-analyst", tools: ["read"] });

		expect(isToolAllowed(businessAnalyst, "bash")).toBe(false);
	});

	// tools is REQUIRED and never "undefined = everything" (ADR §3.1) — a leaf role with an empty
	// tools list allows nothing at all, never falls back to a permissive default.
	it("FR-20: a role with an empty tools list allows nothing (never undefined-means-everything)", () => {
		const leafRole = makeRole({ name: "product-owner", tools: [] });

		expect(isToolAllowed(leafRole, "read")).toBe(false);
		expect(isToolAllowed(leafRole, "bash")).toBe(false);
	});
});
