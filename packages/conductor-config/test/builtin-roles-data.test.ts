/**
 * Fidelity tests for `builtin-roles-data.ts` — Gate 6, closing the real deliverable gap the
 * orchestrator found (role-loader.ts/delegation-graph.ts were GREEN against synthetic fixtures, but
 * zero real role data had been ported from `conductor-main/conductor/roles.py`).
 *
 * Two layers, per this data file's own header:
 *   1. Structural invariants that need no external file at all — always run, everywhere.
 *   2. An opportunistic line-for-line cross-check against the real `roles.py`, skipped (never
 *      failed) when that sibling file is not reachable on disk — this package's suite must not
 *      depend on a second repository being checked out to pass in a normal CI clone of `pi` alone.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	BUILTIN_GATE_ROLES,
	BUILTIN_ROLES,
	type BuiltinRoleSpec,
	findBuiltinRole,
	gatesForBuiltinRole,
	MANDATORY_GATES,
	skillsForBuiltinRole,
} from "../src/builtin-roles-data.ts";
import { validateDelegationGraph } from "../src/delegation-graph.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------
// Layer 1 — structural invariants, no external file needed.
// ---------------------------------------------------------------------------------------------

describe("BUILTIN_ROLES — structural fidelity (no external file needed)", () => {
	it("has exactly 37 roles (roles.py's own doc comment: 'The 37-role registry')", () => {
		expect(BUILTIN_ROLES).toHaveLength(37);
	});

	it("has no duplicate slugs", () => {
		const slugs = BUILTIN_ROLES.map((r) => r.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it("every `spawns` edge targets a real slug in the same registry (roles.py R23's own invariant)", () => {
		const knownSlugs = new Set(BUILTIN_ROLES.map((r) => r.slug));
		for (const role of BUILTIN_ROLES) {
			for (const target of role.spawns) {
				expect(knownSlugs.has(target), `${role.slug} spawns unknown role "${target}"`).toBe(true);
			}
		}
	});

	it("the merged spawns graph is acyclic with no unknown target (reuses this package's own validateDelegationGraph)", () => {
		const builtin = BUILTIN_ROLES.map((role) => ({ id: role.slug, canSpawn: [...role.spawns] }));

		const result = validateDelegationGraph(builtin, []);

		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it("every GATE_ROLES entry names only real slugs", () => {
		const knownSlugs = new Set(BUILTIN_ROLES.map((r) => r.slug));
		for (const [gate, roles] of Object.entries(BUILTIN_GATE_ROLES)) {
			for (const role of roles) {
				expect(knownSlugs.has(role), `gate ${gate} names unknown role "${role}"`).toBe(true);
			}
		}
	});

	it("BUILTIN_GATE_ROLES covers exactly gates 1..14", () => {
		expect(
			Object.keys(BUILTIN_GATE_ROLES)
				.map(Number)
				.sort((a, b) => a - b),
		).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
	});
});

describe("findBuiltinRole / skillsForBuiltinRole / gatesForBuiltinRole", () => {
	it("finds a known role by slug", () => {
		expect(findBuiltinRole("backend-engineer")?.skill).toBe("design-service");
	});

	it("returns undefined for an unknown slug", () => {
		expect(findBuiltinRole("not-a-real-role")).toBeUndefined();
	});

	it("combines [skill, ...extraSkills] with the primary skill first (Gate 6 task brief)", () => {
		const sre = findBuiltinRole("site-reliability-engineer") as BuiltinRoleSpec;
		expect(skillsForBuiltinRole(sre)).toEqual(["service-reliability", "incident-response"]);
	});

	it("a role with no extraSkills combines to a single-element skills list", () => {
		const backendEngineer = findBuiltinRole("backend-engineer") as BuiltinRoleSpec;
		expect(skillsForBuiltinRole(backendEngineer)).toEqual(["design-service"]);
	});

	it("computes ascending gates for a role served by more than one gate (roles.py: gates_for)", () => {
		// security-engineer: GATE_ROLES[3], [9], [13], and [14] all name it.
		expect(gatesForBuiltinRole("security-engineer")).toEqual([3, 9, 13, 14]);
	});

	it("computes an empty gates list for a role no gate names directly", () => {
		// data-engineer never appears in any GATE_ROLES tuple (only reached via spawns).
		expect(gatesForBuiltinRole("data-engineer")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------
// MANDATORY_GATES — Fase 4, ADR 0005 §4/§18 R23; gate3-addendum-fase4.md T42; BR-10.
//
// Resolves a real discrepancy, not invented here (see MANDATORY_GATES's own doc comment in
// builtin-roles-data.ts): this project's root CLAUDE.md prose lists {3,5,7,8}; the CODE that
// `conductor-main`'s `gate_land.py` landing guard actually enforces (`roles.py:MANDATORY_GATES`)
// is {3,5,7,8,9}. Fase 4's live GateState floor was decided (Gate 2/4 of this demand, journal
// 2026-08-06) to follow the enforced code, not the prose — these tests pin THAT decision, not the
// unresolved CLAUDE.md prose gap (out of this demand's scope).
// ---------------------------------------------------------------------------------------------

describe("MANDATORY_GATES — the live-enforced floor for GateState (R23/BR-10)", () => {
	it("is exactly {3, 5, 7, 8, 9} — the gate_land.py/roles.py set, not the CLAUDE.md prose subset {3,5,7,8}", () => {
		expect([...MANDATORY_GATES].sort((a, b) => a - b)).toEqual([3, 5, 7, 8, 9]);
	});

	it("is a genuine Set with working has() semantics (not an array masquerading as ReadonlySet)", () => {
		expect(MANDATORY_GATES.has(3)).toBe(true);
		expect(MANDATORY_GATES.has(5)).toBe(true);
		expect(MANDATORY_GATES.has(7)).toBe(true);
		expect(MANDATORY_GATES.has(8)).toBe(true);
		expect(MANDATORY_GATES.has(9)).toBe(true);
	});

	it("does NOT include gates outside the floor (1,2,4,6,10-14 are collapsible, per CLAUDE.md's calibration table)", () => {
		for (const collapsible of [1, 2, 4, 6, 10, 11, 12, 13, 14]) {
			expect(MANDATORY_GATES.has(collapsible), `gate ${collapsible} must not be in the mandatory floor`).toBe(false);
		}
	});

	it("has exactly 5 members — every member accounted for, none silently duplicated or dropped", () => {
		expect(MANDATORY_GATES.size).toBe(5);
	});
});

// ---------------------------------------------------------------------------------------------
// Layer 2 — opportunistic cross-check against the real conductor-main/conductor/roles.py.
// ---------------------------------------------------------------------------------------------

/** Sibling-repo default path for THIS dev workspace (conductor/{pi,conductor-main}); overridable via
 * env so this is never a hardcoded assumption about where conductor-main lives (quality-baseline
 * category 4) — a CI clone of `pi` alone simply will not find this path, and the block below skips
 * rather than fails in that case. */
function resolveRolesPyPath(): string {
	const override = process.env.CONDUCTOR_MAIN_ROLES_PY;
	if (override) return resolve(override);
	return resolve(join(__dirname, "..", "..", "..", "..", "conductor-main", "conductor", "roles.py"));
}

interface ParsedPythonRole {
	slug: string;
	skill: string;
	area: string;
	extraSkills: string[];
	spawns: string[];
}

function extractQuotedTuple(block: string, key: string): string[] {
	const match = block.match(new RegExp(`${key}\\s*=\\s*\\(([^)]*)\\)`));
	if (!match) return [];
	return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

/** A small, test-only regex extraction of `roles.py`'s two dict literals — not a general Python
 * parser, just enough structure to catch a transcription drift in `builtin-roles-data.ts`. Splits
 * the `ROLES = { ... for r in [ ... ] }` list body on each `Role(` call, then reads the first three
 * positional string args plus the two optional keyword tuples out of each chunk independently. */
function parseRolesPy(source: string): { roles: ParsedPythonRole[]; gateRoles: Record<number, string[]> } {
	const rolesListMatch = source.match(/ROLES: Dict\[str, Role\] = \{r\.slug: r for r in \[([\s\S]*?)\n\]\}/);
	if (!rolesListMatch) throw new Error("could not locate the ROLES list literal in roles.py");
	const chunks = rolesListMatch[1].split(/(?=Role\()/g).filter((chunk) => chunk.trim().startsWith("Role("));

	const roles: ParsedPythonRole[] = chunks.map((chunk) => {
		const head = chunk.match(/Role\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/);
		if (!head) throw new Error(`could not parse a Role(...) entry: ${chunk.slice(0, 80)}`);
		return {
			slug: head[1],
			skill: head[2],
			area: head[3],
			extraSkills: extractQuotedTuple(chunk, "extra_skills"),
			spawns: extractQuotedTuple(chunk, "spawns"),
		};
	});

	const gateRolesMatch = source.match(/GATE_ROLES: Dict\[int, tuple\] = \{([\s\S]*?)\n\}/);
	if (!gateRolesMatch) throw new Error("could not locate the GATE_ROLES dict literal in roles.py");
	const gateRoles: Record<number, string[]> = {};
	for (const lineMatch of gateRolesMatch[1].matchAll(/(\d+):\s*\(([^)]*)\)/g)) {
		const gate = Number(lineMatch[1]);
		gateRoles[gate] = Array.from(lineMatch[2].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
	}

	return { roles, gateRoles };
}

const rolesPyPath = resolveRolesPyPath();
const rolesPyAvailable = existsSync(rolesPyPath);

describe.skipIf(!rolesPyAvailable)("BUILTIN_ROLES vs. the real conductor-main/conductor/roles.py", () => {
	const parsed = rolesPyAvailable ? parseRolesPy(readFileSync(rolesPyPath, "utf-8")) : { roles: [], gateRoles: {} };

	it("ports exactly the same slug set, same order, as roles.py's ROLES literal", () => {
		expect(BUILTIN_ROLES.map((r) => r.slug)).toEqual(parsed.roles.map((r) => r.slug));
	});

	it("ports every role's skill/area/extraSkills/spawns identically", () => {
		const bySlug = new Map(parsed.roles.map((r) => [r.slug, r] as const));
		for (const role of BUILTIN_ROLES) {
			const reference = bySlug.get(role.slug);
			expect(reference, `roles.py has no role "${role.slug}"`).toBeDefined();
			expect(role.skill).toBe(reference?.skill);
			expect(role.area).toBe(reference?.area);
			expect([...role.extraSkills]).toEqual(reference?.extraSkills);
			expect([...role.spawns]).toEqual(reference?.spawns);
		}
	});

	it("ports GATE_ROLES identically for all 14 gates", () => {
		for (let gate = 1; gate <= 14; gate++) {
			expect([...BUILTIN_GATE_ROLES[gate]], `gate ${gate}`).toEqual(parsed.gateRoles[gate]);
		}
	});

	// Fase 4 (ADR 0005 §4/BR-10): MANDATORY_GATES was resolved to follow the CODE roles.py actually
	// enforces via gate_land.py, not the CLAUDE.md prose subset — this is the direct proof of that
	// claim, not an assumption. `roles.py` has no ROLES-literal-shaped structure for this constant
	// (it is a bare `frozenset({...})` module-level literal), so this is a small, independent
	// regex, not a reuse of `parseRolesPy`'s ROLES/GATE_ROLES-specific parsing.
	it("matches roles.py's own MANDATORY_GATES frozenset literal exactly", () => {
		const source = readFileSync(rolesPyPath, "utf-8");
		const match = source.match(/MANDATORY_GATES[^=]*=\s*frozenset\(\{([^}]*)\}\)/);
		expect(match, "could not locate the MANDATORY_GATES frozenset literal in roles.py").not.toBeNull();
		const referenceGates = Array.from(match?.[1].matchAll(/\d+/g) ?? [])
			.map((m) => Number(m[0]))
			.sort((a, b) => a - b);
		expect([...MANDATORY_GATES].sort((a, b) => a - b)).toEqual(referenceGates);
	});
});

if (!rolesPyAvailable) {
	// Not a test — a visible, honest note in the run's own output (not a silent skip) explaining
	// exactly why layer 2 did not run in this environment, per this file's own header.
	console.warn(
		`[builtin-roles-data.test.ts] roles.py cross-check SKIPPED — "${rolesPyPath}" not found. ` +
			"Set CONDUCTOR_MAIN_ROLES_PY to the real path to run it (never required for this package's own suite to pass).",
	);
}
