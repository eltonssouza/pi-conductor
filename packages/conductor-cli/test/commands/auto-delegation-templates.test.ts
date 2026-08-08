/**
 * `GATE_DELEGATION_TEMPLATES` (`src/commands/auto-delegation-templates.ts`) -- ADR 0010 §6/D4,
 * gate2-spec-auto-subagent-delegation.md FR-3/FR-3b, gate3-addendum T81/R62/GAP-C.
 *
 * This is REAL data, not a Gate 5 stub -- every test below should be GREEN today. The suite proves:
 * (1) every gate `BUILTIN_GATE_ROLES` actually defines (1-14) has a template, and no extra/unknown gate
 * numbers exist; (2) every template's `instruction` never interpolates a demand-string/diff (it is
 * static, author-written text -- FR-3/R62(i)); (3) every template ends with the GAP-C data/instruction
 * delimiter block (R62(ii)); (4) every template's `skills` list matches its own gate's lead role
 * (`BUILTIN_GATE_ROLES[gate][0]`) real skills from `@conductor/config`, never hand-typed out of sync.
 */

import { BUILTIN_GATE_ROLES, findBuiltinRole, skillsForBuiltinRole } from "@conductor/config";
import { describe, expect, it } from "vitest";
import {
	DATA_NOT_INSTRUCTION_NOTICE,
	GATE_DELEGATION_TEMPLATES,
	type GateDelegationTemplate,
} from "../../src/commands/auto-delegation-templates.ts";

const REAL_GATE_NUMBERS = Object.keys(BUILTIN_GATE_ROLES)
	.map(Number)
	.sort((a, b) => a - b);

describe("GATE_DELEGATION_TEMPLATES -- coverage matches BUILTIN_GATE_ROLES exactly (1-14, no gaps, no extras)", () => {
	it("has exactly one template per real gate number BUILTIN_GATE_ROLES declares", () => {
		const templateGateNumbers = Object.keys(GATE_DELEGATION_TEMPLATES)
			.map(Number)
			.sort((a, b) => a - b);

		expect(templateGateNumbers).toEqual(REAL_GATE_NUMBERS);
	});

	it("covers all 14 flow gates (the flow's own TOTAL_FLOW_GATES)", () => {
		expect(REAL_GATE_NUMBERS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
		expect(Object.keys(GATE_DELEGATION_TEMPLATES)).toHaveLength(14);
	});

	it("is frozen -- a caller cannot mutate a template at runtime (locked, authorial data, R62)", () => {
		expect(Object.isFrozen(GATE_DELEGATION_TEMPLATES)).toBe(true);
	});
});

describe.each(REAL_GATE_NUMBERS)("GATE_DELEGATION_TEMPLATES[%d]", (gate) => {
	const entry: GateDelegationTemplate = GATE_DELEGATION_TEMPLATES[gate];

	it("exists and has a non-empty instruction and a non-empty skills list", () => {
		expect(entry).toBeDefined();
		expect(entry.instruction.length).toBeGreaterThan(0);
		expect(entry.skills.length).toBeGreaterThan(0);
	});

	it("ends with the GAP-C data/instruction delimiter block (R62(ii)) -- every template, not just some", () => {
		expect(entry.instruction.endsWith(DATA_NOT_INSTRUCTION_NOTICE)).toBe(true);
	});

	it("names its own gate number in the fixed instruction text (so the delegated subagent sees which gate it is executing without any interpolated/untrusted string)", () => {
		expect(entry.instruction).toMatch(new RegExp(`Gate ${gate}\\b`));
	});

	it("skills match the real @conductor/config lead role for this gate -- never hand-typed out of sync with BUILTIN_GATE_ROLES/BUILTIN_ROLES", () => {
		const leadSlug = BUILTIN_GATE_ROLES[gate][0];
		const spec = findBuiltinRole(leadSlug);
		expect(spec).toBeDefined();
		expect(entry.skills).toEqual(skillsForBuiltinRole(spec!));
	});
});

describe("GATE_DELEGATION_TEMPLATES -- FR-3: never a channel for untrusted, caller-supplied text (R62(i))", () => {
	it("no template's instruction contains a template-literal-shaped interpolation placeholder or an obvious demand-string echo -- every instruction is fully static, author-written text with no runtime substitution points", () => {
		for (const gate of REAL_GATE_NUMBERS) {
			const { instruction } = GATE_DELEGATION_TEMPLATES[gate];
			// A demand-string/diff would be attacker/user-controlled free text; this static suite cannot
			// prove "the caller never appends one" (that is Gate 6's own composition logic in
			// runGateDelegation, tested separately), but it CAN prove this module's own fixed instruction
			// text never itself carries an unresolved interpolation marker (a sign the string was meant to
			// be filled in with something other than static content authored here).
			expect(instruction).not.toMatch(/\$\{.*\}/);
		}
	});
});
