/**
 * `GateModelRole` -- the gate-workload tier axis (docs/adr/0008-fase7-model-routing-and-providers.md
 * §3, D1 "Dois eixos de tier que nunca se fundem" -- the central decision of the whole ADR -- and §16
 * the TypeScript appendix's `@conductor/config` section, copied verbatim).
 *
 * Two axes exist and are never merged into one enum (D1.2/D1.3):
 *   - **Axis 1 -- persona intensity.** `ModelRole` (role-loader.ts:44, ADR 0004 §16 appendix, LOCKED).
 *     INTOUCHED by this fase -- imported here only to pin `MODEL_ROLE_RANK`'s projection of it onto
 *     the same rank space (D1.5's `max(rank(gate), rank(persona))` floor rule), never redefined.
 *   - **Axis 2 -- gate workload.** `GateModelRole`, new in this fase, 4 values, 1:1 with the 14-row
 *     "Model roles per gate" table in the project's root CLAUDE.md (FR-9, G3) -- the table this same
 *     autonomous session is itself driven by.
 *   - **The plan's 7-name vocabulary** (`strategic/planning/standard/fast/lightweight/security/review`,
 *     plano_desenvolvimento.md §4.15) is NOT a third axis: it is axis 2 written at different
 *     granularity, contaminated by three axis-1 homonyms (D1.1). `normalizePlanModelRole` is the
 *     anti-corruption layer (DDD §2.4, the strongest citation of the whole ADR, 0.737) that resolves
 *     it into axis 2 WITHOUT ever becoming a third enum or a silent translation (BR-7).
 *
 * `security` deliberately does not survive as a tier (ADR §3.2 item 4): it resolves to `slow`. The
 * literal exit criterion the plan cites ("Gate 9 requires security... no security model configured...
 * execution refused") is preserved in the MECHANISM (Gate 9 -> slow; no model bound to slow -> refusal
 * naming gate and role), recoverable per-gate via a policy override (model-policy.ts's `gates` field)
 * rather than a fifth tier or an unused capability-tag system (ADR §3.3, rejected alternative).
 *
 * GATE 5 (test-first) is already closed for this file -- test/model-role.test.ts is Gate-5-locked and
 * asserts this exact contract; this Gate 6 file makes it pass. Grounding for D1 itself was already
 * performed and recorded at Gate 4 (ADR §3, DDD §2.4/§2.3, top 0.737) -- not re-queried here per the
 * same discipline policy-trust-store.ts's header documents ("citing the originating gate's grounding,
 * not manufacturing a fresh query for a rule nothing has changed about").
 */

import type { ModelRole } from "./role-loader.ts";

/** Axis 2 -- gate workload. 1:1 with CLAUDE.md's "Model roles per gate" table (D1.2). */
export type GateModelRole = "plan" | "slow" | "default" | "smol";

const CANONICAL_GATE_MODEL_ROLES: readonly GateModelRole[] = ["plan", "slow", "default", "smol"];

function isCanonicalGateModelRole(value: string): value is GateModelRole {
	return (CANONICAL_GATE_MODEL_ROLES as readonly string[]).includes(value);
}

/**
 * Default product ordering (D1.5's `max` floor rule) -- a DECLARED DEFAULT, not a discovered truth
 * (D1.6): sobreponível per-binding via `ModelBinding.rank` (model-policy.ts). The ordering itself
 * (`smol < default < plan < slow`) is exactly CLAUDE.md's own words: "the most expensive role among
 * the gates [a persona] serves" -- Gate 8 (review, `slow`) costs more than Gate 7 (mechanical, `smol`).
 */
export const DEFAULT_GATE_MODEL_ROLE_RANK: Readonly<Record<GateModelRole, number>> = {
	smol: 0,
	default: 1,
	plan: 2,
	slow: 3,
};

/**
 * Projection of `ModelRole` (axis 1, ADR 0004 §16, LOCKED -- untouched by this fase) onto the same
 * rank space, so D1.5's floor rule (`max(rank(gate), rank(persona))`) can compare across the two axes
 * without merging them. A `security-engineer` (`strategic`, rank 2) running Gate 11 (`@default`, rank
 * 1) resolves with floor 2 -- never falls to the cheap model.
 */
export const MODEL_ROLE_RANK: Readonly<Record<ModelRole, number>> = {
	lightweight: 0,
	standard: 1,
	strategic: 2,
};

/**
 * The plan's 7-name vocabulary (plano_desenvolvimento.md §4.15), mapped onto the 4 canonical
 * `GateModelRole` values (ADR §3.2 item 3, exact table). `planning`/`review`/`security` are workload
 * labels the plan wrote using axis-1 words; `strategic`/`standard`/`lightweight` are axis-1's own
 * three names appearing where they do not belong; `fast` is `lightweight` under a third name. None of
 * this is guessed -- it is the ADR's own worked table, transcribed.
 */
const PLAN_MODEL_ROLE_ALIASES: Readonly<Record<string, GateModelRole>> = {
	planning: "plan",
	strategic: "slow",
	review: "slow",
	security: "slow",
	standard: "default",
	fast: "smol",
	lightweight: "smol",
};

export type NormalizePlanModelRoleResult =
	| { ok: true; role: GateModelRole; alias: boolean }
	| { ok: false; reason: "unknown-model-role"; known: readonly string[] };

/**
 * The anti-corruption layer for the plan's 7-name vocabulary (D1.3). A canonical `GateModelRole` name
 * passes through unflagged (`alias: false`); a recognized plan-vocabulary alias resolves to its
 * canonical role WITH a diagnostic flag naming that a translation happened (`alias: true`) -- never a
 * silent translation (BR-7: two independent readers of the same policy must never disagree about what
 * tier is actually in effect). An unrecognized name is refused, naming the reason and the full list of
 * names this function accepts (both canonical and alias), so a caller can report a useful error instead
 * of a bare "invalid" (Security Engineering Principles §2.12, herdado do Gate 3/4 -- an unrecognized
 * input must never be silently coerced into a default).
 */
export function normalizePlanModelRole(name: string): NormalizePlanModelRoleResult {
	if (isCanonicalGateModelRole(name)) {
		return { ok: true, role: name, alias: false };
	}
	const canonical = PLAN_MODEL_ROLE_ALIASES[name];
	if (canonical !== undefined) {
		return { ok: true, role: canonical, alias: true };
	}
	return {
		ok: false,
		reason: "unknown-model-role",
		known: [...CANONICAL_GATE_MODEL_ROLES, ...Object.keys(PLAN_MODEL_ROLE_ALIASES)],
	};
}

/**
 * The 14-gate "Model roles per gate" table from the project's root CLAUDE.md, transcribed 1:1 (FR-9,
 * G3) -- made executable data instead of session-orientation prose. This IS the table; CLAUDE.md's
 * copy is the authored source a human reads, this is the machine-consultable projection of the same
 * fact (never a second, independently-maintained version -- BR-7's whole point).
 */
export const DEFAULT_GATE_MODEL_ROLES: Readonly<Record<number, GateModelRole>> = {
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
};
