/**
 * Test-first (Gate 5, Fase 8 "Autonomous mode") for `classifyRisk` (`src/commands/auto.ts`) — ADR
 * 0009 §6.2 Peça 2/§16, gate2-spec-fase8.md FR-4/FR-5, BR-1/BR-2, Gate 3 addendum T74/R55.
 *
 * `classifyRisk` is currently an unconditional `throw new Error("not implemented")` stub -- every
 * test below fails RED for that one reason today (same precedent as `auto-static-veto.test.ts`'s own
 * header). Real assertions are written against the ADR-locked `RiskClassification` result shape so
 * each test becomes the actual proof of its FR once Gate 6 implements the body.
 *
 * `classifyRisk` does NOT itself see the veto's outcome (`evaluateStaticVeto`, a SEPARATE pure
 * function) -- by design (this file's own doc comment: "não decompor onde há uma decisão só"). BR-2
 * ("`--risk=low` never overrides the veto") is therefore a COMPOSITION-ORDER contract between the two
 * functions, not something `classifyRisk` alone can enforce -- the composition-level test for that
 * contract lives in `auto-run.test.ts` (edge case 1/8), where the orchestrator (`runAuto`) is the
 * thing actually responsible for calling the veto first and short-circuiting on a match.
 */

import { describe, expect, it } from "vitest";
import { classifyRisk } from "../../src/commands/auto.ts";

describe("classifyRisk — FR-4/BR-1: fail-closed default under any uncertainty (no explicit flag, no narrow rule match)", () => {
	it("never defaults to authorized-low-risk merely because nothing vetoed -- the ABSENCE of an explicit assertion produces needs-human, never an implicit accept", () => {
		const result = classifyRisk({
			demandString: "melhorar a navegação do painel administrativo",
			explicitRiskLow: false,
			narrowRuleMatch: false,
		});
		expect(result.outcome).toBe("needs-human");
		if (result.outcome === "needs-human") {
			expect(["uncertain", "underspecified"]).toContain(result.reason);
		}
	});

	it("stays fail-closed even for a demand string that LOOKS short/simple -- classifyRisk itself never infers 'small, therefore low risk' without an explicit assertion (that inference, if it exists at all, is exactly what narrowRuleMatch: true asserts explicitly)", () => {
		const result = classifyRisk({ demandString: "fix typo", explicitRiskLow: false, narrowRuleMatch: false });
		expect(result.outcome).toBe("needs-human");
	});
});

describe('classifyRisk — FR-5: --risk=low is an explicit, affirmed assertion, registered as method:"human" -- distinct from an auto-evaluation', () => {
	it('authorizes low-risk with basis: explicit-flag and method: "human" (never "auto") when explicitRiskLow is true', () => {
		const result = classifyRisk({
			demandString: "adicionar filtro de busca",
			explicitRiskLow: true,
			narrowRuleMatch: false,
		});
		expect(result).toEqual({ outcome: "authorized-low-risk", basis: "explicit-flag", method: "human" });
	});
});

describe('classifyRisk — a narrow, deterministic applicability rule (the /cdt-intake-like family) authorizes with method: "auto", distinct from an explicit human assertion', () => {
	it('authorizes low-risk with basis: narrow-rule and method: "auto" when narrowRuleMatch is true and no explicit flag was given', () => {
		const result = classifyRisk({
			demandString: "corrigir typo no README",
			explicitRiskLow: false,
			narrowRuleMatch: true,
		});
		expect(result).toEqual({ outcome: "authorized-low-risk", basis: "narrow-rule", method: "auto" });
	});
});

describe("classifyRisk — BR-1: the two ways to authorize (explicit-flag vs narrow-rule) are never collapsed into one another", () => {
	it("explicit-flag and narrow-rule produce OBSERVABLY different results (different basis, different method) for otherwise-identical demand strings -- a reader of the Decision the classification produces (FR-6) must always be able to tell which one actually happened", () => {
		const explicit = classifyRisk({ demandString: "x", explicitRiskLow: true, narrowRuleMatch: false });
		const narrow = classifyRisk({ demandString: "x", explicitRiskLow: false, narrowRuleMatch: true });
		expect(explicit).not.toEqual(narrow);
	});
});
