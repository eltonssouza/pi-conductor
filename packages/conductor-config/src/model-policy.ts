/**
 * `ModelPolicy` -- the shape, parser, and security gate for a project's `.conductor/config.json`
 * `modelPolicy` section (docs/adr/0008-fase7-model-routing-and-providers.md §8, D6 "a política de
 * modelo é input não-confiável"; §16 TypeScript appendix's `@conductor/config` section, copied
 * verbatim). docs/conductor/gate3-addendum-fase7.md T73/R54 is the binding threat this file closes;
 * docs/conductor/gate2-spec-fase7.md FR-9..11 (Grupo C), BR-7, edge case 9 are the functional
 * requirements it satisfies.
 *
 * SECURITY-CRITICAL, not incidental (D6/R54, T73(b) "the baseUrl-exfiltration vector"). A project's
 * model policy is repo-supplied, untrusted input (same trust class already established for
 * `.conductor/policy.json` in T18/T28 and for role definitions in T37, ADR 0008 §8.1): a binding is a
 * REFERENCE (`{ provider, modelId }`), never a DEFINITION. `baseUrl`, `apiKey`, `headers`, `cost` are
 * REFUSED at schema validation, not silently ignored or stripped-and-continued -- a clone that plants
 * one of those fields on a binding gets the WHOLE policy rejected (`ok:false`), because a policy that
 * "mostly" parses with the dangerous field quietly dropped is exactly the kind of partial-success that
 * lets an attacker iterate until something sticks. This mirrors this package's own established
 * discipline for untrusted input: `schema-validation.ts`'s `assertValidConfigShape` and
 * `secret-detection.ts`'s `assertNoRawSecrets` both reject the whole input atomically rather than
 * stripping the offending piece and moving on.
 *
 * TOFU (trust-on-first-use, model-policy-trust-store.ts) is required ONLY for the half of the policy
 * that carries AUTHORITY (D6 §8.2's table) -- proportional, not ceremonial:
 *   - Remapping a gate to a LOWER rank than its built-in default ("downward-gate-remap-requires-pin") --
 *     rank comparison, never name plausibility (the ADR's own worked example: `@plan` "sounds"
 *     reasonable for Gate 8 but is still a downward remap from the built-in `@slow`, rank 3 -> 2, and
 *     still requires a pin).
 *   - Naming a provider OUTSIDE the built-in vendor catalog ("untrusted-provider-requires-pin") -- see
 *     `KNOWN_BUILTIN_PROVIDER_IDS` below for why this package keeps its OWN static snapshot instead of
 *     importing the vendor catalog.
 *   - Elevating `egress.crossProvider` above the safe default `"deny"` ("egress-elevation-requires-pin").
 * A recognized plan-vocabulary name used where a `GateModelRole` is expected (`gateRoles` overrides) is
 * NOT a security bypass the way the above are -- it resolves to its canonical role with a
 * `legacy-model-role-alias` diagnostic (model-role.ts's `normalizePlanModelRole`, D1.3) rather than
 * rejecting the policy.
 *
 * `KNOWN_BUILTIN_PROVIDER_IDS` is a STATIC SNAPSHOT of `@earendil-works/pi-ai/providers/all.ts`'s
 * `builtinProviders()` ids (packages/ai/src/providers/*.ts, each module's own `id:` literal, read
 * verbatim during this Gate 6 session -- not guessed from filenames), not a live import. Per ADR §4.2
 * D2's packaging table, `@conductor/config` stays dependency-light BY DESIGN ("nenhuma dependência de
 * pi-ai/pi-coding-agent entra aqui" -- role-loader.ts's own header already established this for
 * `ConductorRole`, and the Fase 6 Gate 8 loop-back moved redaction glue to the leaf package
 * `@conductor/secrets` for precisely this reason). This snapshot exists ONLY to decide "does this
 * binding's provider need a TOFU pin" at PARSE time -- it is a heuristic, not the authority: the actual
 * `unknown-provider`/`unknown-model` resolution-time refusal against the LIVE catalog is
 * `@conductor/providers`'s job (ADR §16, `ResolutionRefusal`), which does depend on pi-ai. Two static
 * facts that "encode different rules" for different purposes (a parse-time TOFU heuristic vs. an
 * authoritative resolution-time catalog check) are not the single-source-of-truth duplication DRY
 * warns against merging -- *Grounding:* `cdt library "static snapshot list of known values duplicated
 * from another module to avoid an unwanted dependency, versus importing the live source of truth"
 * --gate 6` (top 0.626, moderate: Pragmatic Programming Practices §1.12 "When not to eliminate a
 * duplication" -- "the two copies encode different rules... consolidating makes change harder rather
 * than cheaper"; reported honestly as moderate, consistent with this fase's Gate 2/3/4 grounding norm).
 *
 * GATE 5 (test-first) is already closed for this file -- test/model-policy.test.ts is Gate-5-locked;
 * this Gate 6 file makes it pass, including its own documented judgment call (that file's header:
 * `diagnostics` only exists on the `ok:true` branch, so a forbidden field is asserted as whole-policy
 * `ok:false`, never as a diagnostic sitting next to a successful parse).
 */

import type { GateModelRole } from "./model-role.ts";
import { DEFAULT_GATE_MODEL_ROLE_RANK, DEFAULT_GATE_MODEL_ROLES, normalizePlanModelRole } from "./model-role.ts";

/**
 * Snapshot of `packages/ai/src/providers/*.ts`'s `id:` literals (the set `builtinProviders()` in
 * `packages/ai/src/providers/all.ts` constructs), captured 2026-08-07 for this Gate 6 session. A
 * provider added to the vendor catalog after this snapshot is treated as "untrusted, needs a pin"
 * until this list is refreshed -- fail-closed direction (D6/R54: an unrecognized provider is exactly
 * the case that should require deliberate trust, never silently pass).
 */
const KNOWN_BUILTIN_PROVIDER_IDS: ReadonlySet<string> = new Set([
	"amazon-bedrock",
	"ant-ling",
	"anthropic",
	"azure-openai-responses",
	"baseten",
	"cerebras",
	"cloudflare-ai-gateway",
	"cloudflare-workers-ai",
	"deepseek",
	"fireworks",
	"github-copilot",
	"google",
	"google-vertex",
	"groq",
	"huggingface",
	"kimi-coding",
	"minimax",
	"minimax-cn",
	"mistral",
	"moonshotai",
	"moonshotai-cn",
	"nvidia",
	"openai",
	"openai-codex",
	"opencode",
	"opencode-go",
	"openrouter",
	"qwen-token-plan",
	"qwen-token-plan-cn",
	"radius",
	"together",
	"vercel-ai-gateway",
	"xai",
	"xiaomi",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-sgp",
	"zai",
	"zai-coding-cn",
]);

/** Fields a binding is FORBIDDEN from carrying (D6/R54): a binding is a reference, never a definition. */
const FORBIDDEN_BINDING_FIELDS = ["baseUrl", "apiKey", "headers", "cost"] as const;
type ForbiddenBindingField = (typeof FORBIDDEN_BINDING_FIELDS)[number];

const CROSS_PROVIDER_VALUES = ["deny", "ask", "allow-listed"] as const;
type CrossProviderPolicy = (typeof CROSS_PROVIDER_VALUES)[number];

/** A binding is a REFERENCE. `baseUrl`/`apiKey`/`headers`/`cost` are RECUSADOS no schema (D6/R54). */
export interface ModelBinding {
	role: GateModelRole;
	provider: string;
	modelId: string;
	/** Overrides `DEFAULT_GATE_MODEL_ROLE_RANK[role]` for THIS binding only (D1.6). */
	rank?: number;
	minContextWindow?: number;
}

export interface ModelPolicy {
	schema: 1;
	/** FR-11: override of the gate->role mapping. A downward rank remap requires a TOFU pin (D6/§8.2). */
	gateRoles?: Readonly<Record<number, GateModelRole>>;
	bindings: readonly ModelBinding[];
	/** Recovers the "one specific model for Gate 9" case without a fifth tier (D1.4). */
	gates?: Readonly<Record<number, { model?: string }>>;
	egress: {
		crossProvider: CrossProviderPolicy; // default "deny"
		allowedDestinations?: readonly string[]; // only meaningful with "allow-listed"
	};
	fallback?: {
		/** Default-deny; irrelevant for MANDATORY_GATES, where automatic fallback is never permitted. */
		automaticForNonMandatoryGates?: boolean;
	};
}

export type ModelPolicyDiagnostic =
	| { kind: "legacy-model-role-alias"; found: string; canonical: GateModelRole }
	| { kind: "forbidden-field"; path: string; field: ForbiddenBindingField }
	| { kind: "downward-gate-remap-requires-pin"; gate: number; declared: GateModelRole; builtin: GateModelRole }
	| { kind: "untrusted-provider-requires-pin"; provider: string }
	| { kind: "egress-elevation-requires-pin"; declared: ModelPolicy["egress"]["crossProvider"] };

export type ParseModelPolicyResult =
	| { ok: true; policy: ModelPolicy; diagnostics: readonly ModelPolicyDiagnostic[] }
	| { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason: string): { ok: false; reason: string } {
	return { ok: false, reason };
}

interface ParsedBindings {
	bindings: ModelBinding[];
	diagnostics: ModelPolicyDiagnostic[];
}

/**
 * Validates and normalizes `rawBindings`. Returns `{ ok: false }` for ANY forbidden field on ANY
 * binding -- checked as its OWN pass, before any other per-binding validation, so a forbidden field
 * always wins over (say) a binding that also happens to have a malformed `provider` field: the
 * security-critical rejection is never accidentally shadowed by an unrelated shape error.
 */
function parseBindings(rawBindings: unknown): { ok: true; result: ParsedBindings } | { ok: false; reason: string } {
	if (!Array.isArray(rawBindings)) {
		return { ok: false, reason: "policy.bindings must be an array" };
	}

	// Pass 1 (D6/R54, T73(b)): forbidden fields reject the WHOLE policy, atomically, before anything
	// else is inspected -- never silently stripped, never accepted "mostly".
	for (let i = 0; i < rawBindings.length; i++) {
		const raw = rawBindings[i];
		if (!isPlainObject(raw)) {
			return { ok: false, reason: `policy.bindings[${i}] must be an object` };
		}
		for (const field of FORBIDDEN_BINDING_FIELDS) {
			if (Object.hasOwn(raw, field)) {
				return {
					ok: false,
					reason:
						`policy.bindings[${i}] declares forbidden field '${field}' -- a binding is a reference ` +
						`(provider + modelId), never a definition of endpoint/credential/cost (D6/R54, T73(b))`,
				};
			}
		}
	}

	// Pass 2: shape + content validation, now that no binding carries a forbidden field.
	const bindings: ModelBinding[] = [];
	const diagnostics: ModelPolicyDiagnostic[] = [];
	for (let i = 0; i < rawBindings.length; i++) {
		const raw = rawBindings[i] as Record<string, unknown>;

		if (typeof raw.role !== "string") {
			return { ok: false, reason: `policy.bindings[${i}].role must be a string` };
		}
		const roleResult = normalizePlanModelRole(raw.role);
		if (!roleResult.ok) {
			return { ok: false, reason: `policy.bindings[${i}].role names an unknown model role '${raw.role}'` };
		}
		if (roleResult.alias) {
			diagnostics.push({ kind: "legacy-model-role-alias", found: raw.role, canonical: roleResult.role });
		}

		if (typeof raw.provider !== "string" || raw.provider.length === 0) {
			return { ok: false, reason: `policy.bindings[${i}].provider must be a non-empty string` };
		}
		if (typeof raw.modelId !== "string" || raw.modelId.length === 0) {
			return { ok: false, reason: `policy.bindings[${i}].modelId must be a non-empty string` };
		}
		if (raw.rank !== undefined && typeof raw.rank !== "number") {
			return { ok: false, reason: `policy.bindings[${i}].rank must be a number when present` };
		}
		if (raw.minContextWindow !== undefined && typeof raw.minContextWindow !== "number") {
			return { ok: false, reason: `policy.bindings[${i}].minContextWindow must be a number when present` };
		}

		if (!KNOWN_BUILTIN_PROVIDER_IDS.has(raw.provider)) {
			diagnostics.push({ kind: "untrusted-provider-requires-pin", provider: raw.provider });
		}

		bindings.push({
			role: roleResult.role,
			provider: raw.provider,
			modelId: raw.modelId,
			...(raw.rank !== undefined ? { rank: raw.rank as number } : {}),
			...(raw.minContextWindow !== undefined ? { minContextWindow: raw.minContextWindow as number } : {}),
		});
	}

	return { ok: true, result: { bindings, diagnostics } };
}

function parseGateRoles(
	rawGateRoles: unknown,
):
	| { ok: true; gateRoles: Record<number, GateModelRole>; diagnostics: ModelPolicyDiagnostic[] }
	| { ok: false; reason: string } {
	if (!isPlainObject(rawGateRoles)) {
		return { ok: false, reason: "policy.gateRoles must be an object when present" };
	}
	const gateRoles: Record<number, GateModelRole> = {};
	const diagnostics: ModelPolicyDiagnostic[] = [];
	for (const [gateKey, rawRole] of Object.entries(rawGateRoles)) {
		const gate = Number(gateKey);
		if (!Number.isInteger(gate)) {
			return { ok: false, reason: `policy.gateRoles key '${gateKey}' is not a valid gate number` };
		}
		if (typeof rawRole !== "string") {
			return { ok: false, reason: `policy.gateRoles[${gateKey}] must be a string` };
		}
		const normalized = normalizePlanModelRole(rawRole);
		if (!normalized.ok) {
			return { ok: false, reason: `policy.gateRoles[${gateKey}] names an unknown model role '${rawRole}'` };
		}
		if (normalized.alias) {
			diagnostics.push({ kind: "legacy-model-role-alias", found: rawRole, canonical: normalized.role });
		}
		gateRoles[gate] = normalized.role;

		// Downward-remap detection (D6 §8.2 table, row 1/2): rank comparison against the BUILT-IN
		// default for this gate, never name plausibility (the ADR's own `@plan` worked example).
		const builtin = DEFAULT_GATE_MODEL_ROLES[gate];
		if (builtin !== undefined) {
			const declaredRank = DEFAULT_GATE_MODEL_ROLE_RANK[normalized.role];
			const builtinRank = DEFAULT_GATE_MODEL_ROLE_RANK[builtin];
			if (declaredRank < builtinRank) {
				diagnostics.push({ kind: "downward-gate-remap-requires-pin", gate, declared: normalized.role, builtin });
			}
		}
	}
	return { ok: true, gateRoles, diagnostics };
}

function parseEgress(
	rawEgress: unknown,
): { ok: true; egress: ModelPolicy["egress"]; diagnostics: ModelPolicyDiagnostic[] } | { ok: false; reason: string } {
	if (!isPlainObject(rawEgress)) {
		return { ok: false, reason: "policy.egress is required and must be an object" };
	}
	const crossProvider = rawEgress.crossProvider;
	if (typeof crossProvider !== "string" || !(CROSS_PROVIDER_VALUES as readonly string[]).includes(crossProvider)) {
		return {
			ok: false,
			reason: `policy.egress.crossProvider must be one of ${CROSS_PROVIDER_VALUES.join(", ")}`,
		};
	}

	let allowedDestinations: readonly string[] | undefined;
	if (rawEgress.allowedDestinations !== undefined) {
		if (
			!Array.isArray(rawEgress.allowedDestinations) ||
			!rawEgress.allowedDestinations.every((d) => typeof d === "string")
		) {
			return { ok: false, reason: "policy.egress.allowedDestinations must be an array of strings when present" };
		}
		allowedDestinations = rawEgress.allowedDestinations as string[];
	}

	const diagnostics: ModelPolicyDiagnostic[] = [];
	// Egress-elevation-requires-pin (D6 §8.2 table, row 5): the safe default "deny" produces no
	// diagnostic; anything more permissive is a deliberate elevation that needs a pin.
	if (crossProvider !== "deny") {
		diagnostics.push({ kind: "egress-elevation-requires-pin", declared: crossProvider as CrossProviderPolicy });
	}

	return {
		ok: true,
		egress: {
			crossProvider: crossProvider as CrossProviderPolicy,
			...(allowedDestinations ? { allowedDestinations } : {}),
		},
		diagnostics,
	};
}

function parseGatesOverride(
	rawGates: unknown,
): { ok: true; gates: Record<number, { model?: string }> } | { ok: false; reason: string } {
	if (!isPlainObject(rawGates)) {
		return { ok: false, reason: "policy.gates must be an object when present" };
	}
	const gates: Record<number, { model?: string }> = {};
	for (const [gateKey, rawEntry] of Object.entries(rawGates)) {
		const gate = Number(gateKey);
		if (!Number.isInteger(gate)) {
			return { ok: false, reason: `policy.gates key '${gateKey}' is not a valid gate number` };
		}
		if (!isPlainObject(rawEntry)) {
			return { ok: false, reason: `policy.gates[${gateKey}] must be an object` };
		}
		if (rawEntry.model !== undefined && typeof rawEntry.model !== "string") {
			return { ok: false, reason: `policy.gates[${gateKey}].model must be a string when present` };
		}
		gates[gate] = rawEntry.model !== undefined ? { model: rawEntry.model as string } : {};
	}
	return { ok: true, gates };
}

function parseFallback(
	rawFallback: unknown,
): { ok: true; fallback: NonNullable<ModelPolicy["fallback"]> } | { ok: false; reason: string } {
	if (!isPlainObject(rawFallback)) {
		return { ok: false, reason: "policy.fallback must be an object when present" };
	}
	if (
		rawFallback.automaticForNonMandatoryGates !== undefined &&
		typeof rawFallback.automaticForNonMandatoryGates !== "boolean"
	) {
		return { ok: false, reason: "policy.fallback.automaticForNonMandatoryGates must be a boolean when present" };
	}
	return {
		ok: true,
		fallback:
			rawFallback.automaticForNonMandatoryGates !== undefined
				? { automaticForNonMandatoryGates: rawFallback.automaticForNonMandatoryGates as boolean }
				: {},
	};
}

/**
 * Parses and validates an untrusted, repo-supplied raw value into a `ModelPolicy` (D6/R54). Rejects
 * (`ok:false`) atomically on: malformed shape, ANY forbidden binding field (baseUrl/apiKey/headers/cost
 * -- T73(b)), or an unrecognized model-role name anywhere it appears. On success, returns the
 * normalized policy plus every diagnostic collected across bindings/gateRoles/egress -- each of which
 * names a place a TOFU pin is required (`downward-gate-remap-requires-pin`,
 * `untrusted-provider-requires-pin`, `egress-elevation-requires-pin`) or a translation that happened
 * (`legacy-model-role-alias`). Absence of a policy entirely (this function is never called) is not this
 * function's concern -- built-in defaults apply, per D6 §8.2's "política ausente ⇒ os defaults built-in
 * valem".
 */
export function parseModelPolicy(raw: unknown): ParseModelPolicyResult {
	if (!isPlainObject(raw)) {
		return reject("policy must be a JSON object");
	}
	if (raw.schema !== 1) {
		return reject(`policy.schema must be 1, got ${JSON.stringify(raw.schema)}`);
	}

	const bindingsResult = parseBindings(raw.bindings);
	if (!bindingsResult.ok) return reject(bindingsResult.reason);

	const egressResult = parseEgress(raw.egress);
	if (!egressResult.ok) return reject(egressResult.reason);

	const diagnostics: ModelPolicyDiagnostic[] = [...bindingsResult.result.diagnostics, ...egressResult.diagnostics];

	let gateRoles: Record<number, GateModelRole> | undefined;
	if (raw.gateRoles !== undefined) {
		const gateRolesResult = parseGateRoles(raw.gateRoles);
		if (!gateRolesResult.ok) return reject(gateRolesResult.reason);
		gateRoles = gateRolesResult.gateRoles;
		diagnostics.push(...gateRolesResult.diagnostics);
	}

	let gates: Record<number, { model?: string }> | undefined;
	if (raw.gates !== undefined) {
		const gatesResult = parseGatesOverride(raw.gates);
		if (!gatesResult.ok) return reject(gatesResult.reason);
		gates = gatesResult.gates;
	}

	let fallback: ModelPolicy["fallback"];
	if (raw.fallback !== undefined) {
		const fallbackResult = parseFallback(raw.fallback);
		if (!fallbackResult.ok) return reject(fallbackResult.reason);
		fallback = fallbackResult.fallback;
	}

	const policy: ModelPolicy = {
		schema: 1,
		bindings: bindingsResult.result.bindings,
		egress: egressResult.egress,
		...(gateRoles !== undefined ? { gateRoles } : {}),
		...(gates !== undefined ? { gates } : {}),
		...(fallback !== undefined ? { fallback } : {}),
	};

	return { ok: true, policy, diagnostics };
}
