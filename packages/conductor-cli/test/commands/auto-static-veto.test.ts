/**
 * Test-first (Gate 5, Fase 8 "Autonomous mode") for `evaluateStaticVeto`
 * (`src/commands/auto.ts`) — ADR 0009 §6.2 Peça 1/§16, gate2-spec-fase8.md FR-3/FR-3b, Gate 3
 * addendum T74/R55.
 *
 * `evaluateStaticVeto` is currently an unconditional `throw new Error("not implemented")` stub
 * (`src/commands/auto.ts`) — every test below fails RED for that one reason today, the same
 * precedent `commands/gate.ts`'s own historical Gate 5 documents. They assert the REAL expected
 * outcome per FR/T so that once Gate 6 implements the body, each test becomes the actual proof of the
 * requirement it names — not a redundant "it throws".
 *
 * Coverage rationale (Gate 5, security-critical reject-only heuristic): per this project's own
 * grounding convention, `cdt library` from `C:\development\source\projects\conductor` was consulted
 * for "what counts as sufficient test coverage for a reject-only fail-closed authorization heuristic"
 * — coverage returned was moderate (top 0.586, Spec-Driven Development §13.3/§20.6 "The Quality Gate"/
 * "When not to enforce the quality gate": a coverage number is worthless where it is "reachable by
 * exercising getters" — tests must assert REAL behavior, not merely "does not throw"). Applied here:
 * every test below asserts the SHAPE of the returned discriminated union (`where`/`pattern` on a
 * match, not just a boolean), and — critically — a REJECT-ONLY structural test (no input, however
 * benign, can make this function claim a demand is safe; the type itself has no such variant).
 */

import { describe, expect, it } from "vitest";
import { evaluateStaticVeto } from "../../src/commands/auto.ts";

describe("evaluateStaticVeto — FR-3: the static veto matches on the demand string alone (intake, before diff exists)", () => {
	it("vetoes a demand string naming authentication/session ('login')", () => {
		const result = evaluateStaticVeto({ demandString: "adicionar fluxo de login com senha" });
		expect(result).toEqual({ vetoed: true, where: "demand-string", pattern: expect.any(String) });
	});

	it("vetoes a demand string naming credentials/tokens ('token de API')", () => {
		const result = evaluateStaticVeto({ demandString: "renovar o token de API automaticamente" });
		expect(result.vetoed).toBe(true);
		if (result.vetoed) expect(result.where).toBe("demand-string");
	});

	it("vetoes a demand string naming an external API integration", () => {
		const result = evaluateStaticVeto({ demandString: "integrar com uma API externa de pagamentos" });
		expect(result.vetoed).toBe(true);
	});

	it("does not veto a demand string with no sensitive signal at all, and no other input supplied", () => {
		const result = evaluateStaticVeto({ demandString: "corrigir o alinhamento do botão de busca" });
		// T74/R55 (BR-1/BR-2): `{ vetoed: false }` means ONLY "no pattern matched" -- it is never itself
		// an authorization signal (evaluateStaticVeto's own return type has no "safe"/"accept" branch).
		// classifyRisk, a SEPARATE function, is the only thing that can ever authorize a low-risk run,
		// and only from an explicit assertion -- never from this function's absence of a match.
		expect(result).toEqual({ vetoed: false });
	});

	it("does not veto when no input is supplied at all (empty intake)", () => {
		expect(evaluateStaticVeto({})).toEqual({ vetoed: false });
	});
});

describe("evaluateStaticVeto — FR-3b/T74(b): the diff signal re-fires the veto even where the description evaded it, and OUTWEIGHS a passing description", () => {
	it("vetoes on a diff path under an auth-shaped directory, even with a completely benign demand string (the evasion case ADR §6.1 names verbatim: 'melhorar como o sistema lembra de quem é a pessoa entre visitas')", () => {
		const result = evaluateStaticVeto({
			demandString: "melhorar como o sistema lembra de quem é a pessoa entre visitas",
			diffPaths: ["src/auth/session.ts"],
		});
		expect(result.vetoed).toBe(true);
		if (result.vetoed) expect(result.where).toBe("diff-path");
	});

	it("vetoes on a .env file touched by the diff, regardless of description", () => {
		const result = evaluateStaticVeto({
			demandString: "arrumar a página de perfil",
			diffPaths: [".env.production"],
		});
		expect(result.vetoed).toBe(true);
		if (result.vetoed) expect(result.where).toBe("diff-path");
	});

	it("vetoes on a *.pem file touched by the diff", () => {
		const result = evaluateStaticVeto({ diffPaths: ["config/server.pem"] });
		expect(result.vetoed).toBe(true);
	});

	it("vetoes on diff CONTENT embedding a credential-shaped fragment, even when every touched path looks benign", () => {
		const result = evaluateStaticVeto({
			demandString: "atualizar o texto da página inicial",
			diffPaths: ["src/pages/home.ts"],
			diffText: '+  const apiSecret = "sk-ant-abcdef0123456789abcdef";',
		});
		expect(result.vetoed).toBe(true);
		if (result.vetoed) expect(result.where).toBe("diff-content");
	});

	it("does not veto a diff touching only unrelated, non-sensitive paths with non-sensitive content", () => {
		const result = evaluateStaticVeto({
			demandString: "corrigir o alinhamento do botão de busca",
			diffPaths: ["src/ui/search-button.tsx"],
			diffText: "+  button.style.marginLeft = '4px';",
		});
		expect(result).toEqual({ vetoed: false });
	});
});

describe("evaluateStaticVeto — T74/R55: reject-only by construction, never a caller-visible accept signal", () => {
	it("BR-2's own premise: nothing in the input (no field, no combination of fields) can make this function itself claim authorization -- only `{ vetoed: false }` or `{ vetoed: true, ... }` are ever returned, exhaustively, for a battery of otherwise-maximally-permissive inputs", () => {
		const permissiveInputs = [
			{},
			{ demandString: "" },
			{ demandString: "tarefa trivial", diffPaths: [], diffText: "" },
			{ diffPaths: ["README.md"], diffText: "+  typo fix" },
		];
		for (const input of permissiveInputs) {
			const result = evaluateStaticVeto(input);
			// Structural reject-only check: the ONLY legal shape for "not vetoed" is the exact literal
			// { vetoed: false } -- no extra "authorized"/"safe"/"accepted" property could ever sneak onto
			// this return value and still satisfy this assertion.
			expect(result).toEqual({ vetoed: false });
		}
	});
});
