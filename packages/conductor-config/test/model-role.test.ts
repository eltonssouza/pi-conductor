/**
 * Gate 5 (test-first) for model-role.ts -- derives docs/adr/0008-fase7-model-routing-and-providers.md
 * §3 (D1, the two-tier-axis reconciliation -- the central decision of the whole ADR) and §16 (the
 * TypeScript appendix, `@conductor/config` section -- this file's contract, copied verbatim).
 * `ModelRole` (role-loader.ts:44, ADR 0004 §16 appendix) is INTOUCHED by this fase -- imported here
 * only to pin `MODEL_ROLE_RANK`'s projection of it onto the same rank space, never redefined.
 *
 * Every test below MUST fail RED right now: model-role.ts does not exist yet (Gate 6 creates it).
 * The failure signature expected here is a module-resolution error ("Cannot find module
 * '../src/model-role.ts'"), not an assertion failure -- this is deliberate per this gate's brief.
 */

import { describe, expect, it } from "vitest";
import {
	DEFAULT_GATE_MODEL_ROLE_RANK,
	DEFAULT_GATE_MODEL_ROLES,
	type GateModelRole,
	MODEL_ROLE_RANK,
	normalizePlanModelRole,
} from "../src/model-role.ts";

describe("normalizePlanModelRole -- the anti-corruption layer for the plan's 7-name vocabulary (D1.3, ADR §3.2 item 3)", () => {
	const aliasCases: Array<{ planName: string; canonical: GateModelRole }> = [
		{ planName: "planning", canonical: "plan" },
		{ planName: "strategic", canonical: "slow" },
		{ planName: "review", canonical: "slow" },
		{ planName: "security", canonical: "slow" },
		{ planName: "standard", canonical: "default" },
		{ planName: "fast", canonical: "smol" },
		{ planName: "lightweight", canonical: "smol" },
	];

	it.each(aliasCases)(
		"maps plan name '$planName' to canonical '$canonical', flagged as an alias (never a silent translation -- BR-7)",
		({ planName, canonical }) => {
			const result = normalizePlanModelRole(planName);
			expect(result).toEqual({ ok: true, role: canonical, alias: true });
		},
	);

	it("rejects an unknown model-role name, naming the reason and a non-empty list of known names", () => {
		const result = normalizePlanModelRole("made-up-tier");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("unknown-model-role");
			expect(Array.isArray(result.known)).toBe(true);
			expect(result.known.length).toBeGreaterThan(0);
			for (const name of result.known) {
				expect(typeof name).toBe("string");
			}
		}
	});
});

describe("DEFAULT_GATE_MODEL_ROLE_RANK -- the product's default ordering (D1.6), sobreponível per binding, not a discovered truth", () => {
	it("assigns the exact rank smol=0, default=1, plan=2, slow=3", () => {
		expect(DEFAULT_GATE_MODEL_ROLE_RANK).toEqual({ smol: 0, default: 1, plan: 2, slow: 3 });
	});
});

describe("MODEL_ROLE_RANK -- the projection of ModelRole (ADR 0004 §16, untouched) onto the same rank space (D1.5, the `max` rule)", () => {
	it("assigns the exact rank lightweight=0, standard=1, strategic=2", () => {
		expect(MODEL_ROLE_RANK).toEqual({ lightweight: 0, standard: 1, strategic: 2 });
	});
});

describe("DEFAULT_GATE_MODEL_ROLES -- the CLAUDE.md 'Model roles per gate' table made executable data (FR-9, G3)", () => {
	it("is 1:1 with the 14-row table in the project's root CLAUDE.md, transcribed exactly", () => {
		expect(DEFAULT_GATE_MODEL_ROLES).toEqual({
			1: "plan",
			2: "plan",
			3: "slow",
			4: "plan",
			5: "default",
			6: "default",
			7: "smol",
			8: "slow",
			9: "slow",
			10: "default",
			11: "default",
			12: "smol",
			13: "slow",
			14: "slow",
		});
	});

	it("has exactly 14 entries -- no gate invented, none missing", () => {
		expect(Object.keys(DEFAULT_GATE_MODEL_ROLES)).toHaveLength(14);
	});
});
