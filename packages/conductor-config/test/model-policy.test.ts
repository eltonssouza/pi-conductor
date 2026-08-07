/**
 * Gate 5 (test-first) for model-policy.ts -- derives docs/adr/0008-fase7-model-routing-and-providers.md
 * §8 (D6, "a política de modelo é input não-confiável", including the §8.2 TOFU-pin table) and §16
 * (the TypeScript appendix, `@conductor/config` section -- this file's contract, copied verbatim);
 * docs/conductor/gate3-addendum-fase7.md T73/R54 (§ "Política/catálogo repo-supplied..."); and
 * docs/conductor/gate2-spec-fase7.md FR-9..11 (Grupo C), BR-7, edge case 9.
 *
 * SECURITY-CRITICAL, not incidental (D6/R54): the forbidden-binding-field group below is the test
 * that most directly proves T73(b) (the `baseUrl`-exfiltration vector -- a project-policy binding
 * declaring its own endpoint/credential) can never enter through `parseModelPolicy` at all. The
 * ADR's own words: "recusados na validação de schema, não ignorados" (refused at schema validation,
 * not silently ignored/stripped) -- so these tests assert `ok:false` for the WHOLE policy, never a
 * diagnostic sitting next to an otherwise-successful parse.
 *
 * Judgment call (flagged, not silently assumed): `ModelPolicyDiagnostic` declares a
 * `{ kind: "forbidden-field"; path; field }` variant, but `diagnostics` only exists on the `ok:true`
 * branch of `parseModelPolicy`'s return type -- and a forbidden field is exactly the case this ADR
 * says must be REFUSED, not diagnosed-and-accepted. This suite therefore tests the security
 * guarantee that is actually reachable through the public contract (whole-policy `ok:false`) and
 * does not assert anything about whether Gate 6's implementation *also* happens to populate a
 * "forbidden-field" diagnostic on that `ok:false` path, since the declared return type has no
 * `diagnostics` field there to assert against. This reading is consistent with the rest of this
 * package's schema-validation precedent (schema-validation.ts's `assertValidConfigShape`,
 * secret-detection.ts's `assertNoRawSecrets`): both reject the whole input atomically rather than
 * silently stripping the offending field and continuing.
 *
 * Every test below MUST fail RED right now: model-policy.ts does not exist yet (Gate 6 creates it).
 * The failure signature expected here is a module-resolution error ("Cannot find module
 * '../src/model-policy.ts'"), not an assertion failure -- this is deliberate per this gate's brief.
 */

import { describe, expect, it } from "vitest";
import { parseModelPolicy } from "../src/model-policy.ts";
import { DEFAULT_GATE_MODEL_ROLES } from "../src/model-role.ts";

/** A minimal, otherwise-valid raw policy -- every test overrides only what it needs to exercise. */
function policyWithBinding(
	bindingOverrides: Record<string, unknown> = {},
	policyOverrides: Record<string, unknown> = {},
): unknown {
	return {
		schema: 1,
		bindings: [{ role: "slow", provider: "anthropic", modelId: "claude-opus-5", ...bindingOverrides }],
		egress: { crossProvider: "deny" },
		...policyOverrides,
	};
}

describe("parseModelPolicy -- forbidden binding fields are refused outright, never silently stripped (D6/R54, T73(b))", () => {
	const forbiddenFieldCases: Array<{ field: "baseUrl" | "apiKey" | "headers" | "cost"; value: unknown }> = [
		{ field: "baseUrl", value: "https://attacker.example.com/v1" },
		{ field: "apiKey", value: "sk-ant-attacker-supplied-inline-key-0123456789" },
		{ field: "headers", value: { "X-Injected": "1" } },
		{ field: "cost", value: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
	];

	it.each(forbiddenFieldCases)(
		"rejects the WHOLE policy (ok:false) when a binding carries a forbidden '$field' field, on top of an otherwise-valid binding",
		({ field, value }) => {
			const result = parseModelPolicy(policyWithBinding({ [field]: value }));
			expect(result.ok).toBe(false);
		},
	);

	it("a binding with none of the 4 forbidden fields (the otherwise-valid baseline) parses ok:true", () => {
		const result = parseModelPolicy(policyWithBinding());
		expect(result.ok).toBe(true);
	});
});

describe("parseModelPolicy -- downward-gate-remap-requires-pin (D6 §8.2 table, row 1/2)", () => {
	it("built-in fixture sanity: gate 9's default is 'slow' and gate 8's default is 'slow' (both mandatory gates this suite depends on)", () => {
		expect(DEFAULT_GATE_MODEL_ROLES[9]).toBe("slow");
		expect(DEFAULT_GATE_MODEL_ROLES[8]).toBe("slow");
	});

	it("gate 9 remapped from built-in 'slow' (rank 3) DOWN to 'smol' (rank 0) parses ok:true but flags downward-gate-remap-requires-pin", () => {
		const result = parseModelPolicy(policyWithBinding({ role: "smol" }, { gateRoles: { 9: "smol" } }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toContainEqual({
				kind: "downward-gate-remap-requires-pin",
				gate: 9,
				declared: "smol",
				builtin: "slow",
			});
		}
	});

	// The ADR's own worked example (§8.2's note), verbatim: "Gate 8 usa @plan neste projeto, não
	// @slow" is a DOWNWARD remap (rank 3 -> 2) on a mandatory gate, and therefore requires a pin --
	// even though @plan "sounds" reasonable. Rank comparison is what matters, not name plausibility.
	it("gate 8 remapped from built-in 'slow' (rank 3) DOWN to 'plan' (rank 2) ALSO requires a pin -- the ADR's own worked example", () => {
		const result = parseModelPolicy(policyWithBinding({ role: "plan" }, { gateRoles: { 8: "plan" } }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toContainEqual({
				kind: "downward-gate-remap-requires-pin",
				gate: 8,
				declared: "plan",
				builtin: "slow",
			});
		}
	});

	it("an UPWARD remap (gate 11 built-in 'default' rank 1 -> 'slow' rank 3) produces NO downward-gate-remap-requires-pin diagnostic", () => {
		expect(DEFAULT_GATE_MODEL_ROLES[11]).toBe("default");
		const result = parseModelPolicy(policyWithBinding({ role: "slow" }, { gateRoles: { 11: "slow" } }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics.some((d) => d.kind === "downward-gate-remap-requires-pin")).toBe(false);
		}
	});
});

describe("parseModelPolicy -- untrusted-provider-requires-pin (D6 §8.2 table, row 3/4, T73)", () => {
	it("a binding naming a provider outside the built-in vendor catalog produces untrusted-provider-requires-pin", () => {
		const result = parseModelPolicy(policyWithBinding({ provider: "totally-made-up-provider-xyz" }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toContainEqual({
				kind: "untrusted-provider-requires-pin",
				provider: "totally-made-up-provider-xyz",
			});
		}
	});

	it("a binding naming a built-in-catalog provider (anthropic) produces NO untrusted-provider-requires-pin diagnostic", () => {
		const result = parseModelPolicy(policyWithBinding({ provider: "anthropic" }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics.some((d) => d.kind === "untrusted-provider-requires-pin")).toBe(false);
		}
	});
});

describe("parseModelPolicy -- egress-elevation-requires-pin (D6 §8.2 table, row 5)", () => {
	it("egress.crossProvider 'ask' produces egress-elevation-requires-pin", () => {
		const result = parseModelPolicy(policyWithBinding({}, { egress: { crossProvider: "ask" } }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toContainEqual({ kind: "egress-elevation-requires-pin", declared: "ask" });
		}
	});

	it("egress.crossProvider 'allow-listed' produces egress-elevation-requires-pin", () => {
		const result = parseModelPolicy(
			policyWithBinding({}, { egress: { crossProvider: "allow-listed", allowedDestinations: ["openai"] } }),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toContainEqual({
				kind: "egress-elevation-requires-pin",
				declared: "allow-listed",
			});
		}
	});

	it("egress.crossProvider 'deny' (the safe default) on an otherwise-clean policy produces ZERO diagnostics of any kind", () => {
		const result = parseModelPolicy(policyWithBinding());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toEqual([]);
		}
	});
});

describe("parseModelPolicy -- legacy-model-role-alias diagnostic (D1.3 ACL wired into policy parsing, not a rejection)", () => {
	// Deliberately more forgiving than the forbidden-field case: a plan-vocabulary name is not a
	// security bypass the way baseUrl/apiKey are, so it resolves to the canonical role with a
	// diagnostic instead of rejecting the whole policy.
	it("a gateRoles override written with a plan-vocabulary name ('security') resolves to canonical 'slow' with a diagnostic naming both", () => {
		const result = parseModelPolicy(policyWithBinding({ role: "slow" }, { gateRoles: { 9: "security" } }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.diagnostics).toContainEqual({
				kind: "legacy-model-role-alias",
				found: "security",
				canonical: "slow",
			});
			expect(result.policy.gateRoles?.[9]).toBe("slow");
		}
	});
});
