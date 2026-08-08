/**
 * Shared type contracts for `@conductor/providers`
 * (docs/adr/0008-fase7-model-routing-and-providers.md §16 TypeScript appendix, "@conductor/providers -- o
 * motor" section, transcribed close to verbatim -- the ADR's own words ARE the decision here). This file
 * adds only what §5.1/D3 deliberately left open for Gate 6: `ResolutionContext`'s own field shape ("um
 * snapshot já lido -- política validada, catálogo, status de credencial por provedor, mapa de
 * disponibilidade" -- only the INGREDIENTS are named in the ADR, not the container).
 *
 * `ResolutionContext` is designed to structurally match `test/support/fixtures.ts`'s
 * `ResolutionContextFixture` -- every Gate-5-locked test in this package passes either a REAL context
 * built by `buildResolutionContext` or a hand-built fixture object type-cast through `as never`. Since
 * that cast erases compile-time checking but not the RUNTIME shape, `resolveModelForGate` has to read
 * whatever shape the fixture module actually produces; keeping the two shapes identical (rather than
 * merely "compatible") is what lets both call sites share one implementation.
 */

import type { GateModelRole, ModelRole } from "@conductor/config";
import type { Api, Model, ModelCostRates } from "@earendil-works/pi-ai";

export interface ModelRef {
	provider: string;
	modelId: string;
}

export interface ResolveModelRequest {
	gate: number;
	/** Present when the resolution is for a role (task/subagent); absent when opening a gate directly. */
	persona?: { name: string; modelRole: ModelRole };
	/** The provider "actively in use" -- the anchor for the same-provider floor (BR6/D5). */
	activeProvider?: string;
	purpose: "gate-open" | "delegation" | "session" | "report";
}

export type ResolutionRefusal =
	| { kind: "unsupported-gate"; gate: number; validRange: [number, number] }
	| { kind: "no-gate-mapping"; gate: number }
	| { kind: "no-binding-for-role"; gate: number; role: GateModelRole }
	| { kind: "unknown-model"; gate: number; declared: string }
	| { kind: "unknown-provider"; gate: number; declared: string }
	| { kind: "untrusted-endpoint"; gate: number; provider: string; host: string }
	| { kind: "no-credential"; gate: number; role: GateModelRole; providers: readonly string[] }
	| { kind: "all-candidates-unavailable"; gate: number; providers: readonly string[] }
	| { kind: "below-tier-floor"; gate: number; requiredRank: number; bestRank: number; candidate: ModelRef }
	| { kind: "consent-required"; gate: number; candidate: ModelRef; destinationHost: string }
	| {
			kind: "both-floors-unsatisfiable";
			gate: number;
			sameProviderBelowTier: readonly ModelRef[];
			crossProviderAtTier: readonly ModelRef[];
	  }
	| { kind: "policy-unreadable"; gate: number; detail: string };

export type ModelResolution =
	| {
			resolved: true;
			model: Model<Api>;
			ref: ModelRef;
			effectiveRank: number;
			fallbackOf?: { from: ModelRef; consent: "same-provider" | "explicit" | "pre-authorized" };
			trace: ResolutionTrace;
	  }
	| { resolved: false; refusal: ResolutionRefusal; trace: ResolutionTrace };

/** The rastro IS part of the return, always -- resolved or not (D3/FR-13). What `models why` prints. */
export interface ResolutionTrace {
	gate: number;
	/** ISO-8601 UTC. */
	at: string;
	steps: readonly ResolutionStep[];
}

export interface CandidateView {
	ref: ModelRef;
	rank: number;
	declaredIn: "project-policy" | "user-policy" | "builtin-default";
}

export type ResolutionStep =
	| {
			stage: "gate-role";
			role: GateModelRole;
			source: "builtin" | "project-policy";
			pinned?: boolean;
			/**
			 * GATE 9 (pentest Fase 7, achado F-G9-1 / T67 / R48). ADR 0008 §8.2 row 2 requires a TOFU pin
			 * for a DOWNWARD gate->role remap and states the fallback behaviour literally: "Sem pin, o
			 * default built-in prevalece **e a divergência é reportada**". This field IS that report: the
			 * `role`/`source` above are the built-in ones that prevailed, and this names the lower-ranked
			 * role the (repo-supplied, untrusted) policy asked for and did not get. Present ONLY on that
			 * refusal path -- a honoured remap (upward, or downward WITH a pin) never sets it.
			 */
			unpinnedOverride?: GateModelRole;
	  }
	| { stage: "floor"; gateRank: number; personaRank?: number; effective: number }
	| { stage: "bindings"; role: GateModelRole; candidates: readonly CandidateView[] }
	| {
			stage: "catalog";
			accepted: readonly ModelRef[];
			rejected: readonly { ref: string; why: "unknown-model" | "unknown-provider" | "untrusted-endpoint" }[];
	  }
	| {
			stage: "credential";
			/** R50(ii)/R46: ONLY these four fields, ever -- never a raw Model/credential object (see
			 * resolution-trace-redaction.test.ts). `source` is omitted (never set to literal `undefined`)
			 * when unknown, so `Object.keys` never grows a fifth key. */
			perProvider: readonly {
				provider: string;
				configured: boolean;
				source?: "runtime" | "stored" | "environment";
				/** R46: presence of a credential (esp. source:"environment") NEVER authorizes alone. */
				authorizedByPolicy: boolean;
			}[];
	  }
	| {
			stage: "availability";
			perProvider: readonly {
				provider: string;
				state: "not-probed" | "reachable" | "unreachable" | "misconfigured" | "unauthenticated" | "cooldown";
				checkedAt?: string;
				cooldownUntil?: string;
			}[];
	  }
	| {
			stage: "selection";
			selected?: ModelRef;
			rejected: readonly { ref: ModelRef; why: ResolutionRefusal["kind"] }[];
	  };

// ================= ResolutionContext -- the pre-built snapshot resolveModelForGate is pure over (D3) ===

export interface CredentialStatus {
	configured: boolean;
	source?: "runtime" | "stored" | "environment";
	authorizedByPolicy: boolean;
}

export interface AvailabilityStatus {
	state: "not-probed" | "reachable" | "unreachable" | "misconfigured" | "unauthenticated" | "cooldown";
	checkedAt?: string;
	cooldownUntil?: string;
}

/** A single binding, already resolved against credential/availability at context-build time -- the unit
 * `resolveModelForGate`'s selection algorithm classifies (Cok/A/B, D5/§7.1). */
export interface ResolvedCandidate {
	ref: ModelRef;
	rank: number;
	declaredIn: "project-policy" | "user-policy" | "builtin-default";
	credential: CredentialStatus;
	availability: AvailabilityStatus;
}

export interface ResolutionContext {
	gateModelRoles: Readonly<
		Record<
			number,
			{
				role: GateModelRole;
				source: "builtin" | "project-policy";
				pinned?: boolean;
				/** F-G9-1/T67/R48 -- see the identically-named field on `ResolutionStep`'s `gate-role` variant. */
				unpinnedOverride?: GateModelRole;
			}
		>
	>;
	bindingsByRole: Partial<Record<GateModelRole, readonly ResolvedCandidate[]>>;
	/** Keyed by `${provider}::${modelId}` (see `catalogKey` in resolve.ts). */
	catalog: Readonly<Record<string, Model<Api>>>;
	/** Flat, provider-keyed visibility maps -- NOT consulted by the selection algorithm (which reads only
	 * the per-candidate fields embedded in `bindingsByRole`, since availability/credential realistically
	 * vary per BINDING even when they'd naturally share a provider in production). Kept for `conductor
	 * auth`-style reporting of a provider that has a credential but no authorized binding at all (the
	 * R46/T65 canary shape -- see resolution-env-credential-canary.test.ts). */
	credentials?: Readonly<Record<string, CredentialStatus>>;
	availability?: Readonly<Record<string, AvailabilityStatus>>;
	/** Bindings whose (provider, modelId) resolved to a non-vendor-catalog endpoint without a TOFU pin
	 * (D6/R54(ii)/T73(b)) -- recorded so a gate whose ONLY binding was untrusted can refuse naming that
	 * fact, rather than reading identically to "no binding at all". Never populated from fixture-built
	 * contexts unless a test opts in. */
	untrustedBindings?: Partial<Record<GateModelRole, readonly { ref: ModelRef; host: string }[]>>;
	/** D6/§8.2: a policy that is PRESENT but unreadable/invalid -- set here by the async boundary
	 * (`buildResolutionContext`) since the pure/sync `resolveModelForGate` cannot itself detect this. */
	policyUnreadable?: string;
	/**
	 * D11 (§21): the session's flat model (Fase 1 `provider.model`) promoted to the UNIVERSAL implicit
	 * binding, present ONLY when the project declares zero `ModelBinding`s (no `modelPolicy` section at
	 * all, or one with `bindings: []`). Seeded by `buildResolutionContext`, never by a policy.
	 *
	 * `declaredIn` is always `"builtin-default"` and `rank` is `UNIVERSAL_FALLBACK_RANK` (derived from
	 * the rank tables, never a literal) so it satisfies ANY requested floor -- there is no second model
	 * to compare a tier against in this mode, and requiring a tier here would refuse every project that
	 * exists today, which §8.2's own "política ausente ⇒ os defaults built-in valem" already forbade.
	 * The instant ANY real binding exists this field is `undefined` again and the full cascade (D3/§5)
	 * applies unchanged -- it is a compatibility floor, never a bypass.
	 */
	universalFallback?: ResolvedCandidate;
}

// ================= Availability cache (D7/R51) -- in-memory only, no disk state (D7) ===================

export type ProviderAvailability =
	| { state: "reachable"; checkedAt: string }
	| { state: "unreachable" | "misconfigured" | "unauthenticated"; checkedAt: string; detail: string }
	| { state: "cooldown"; until: string; consecutiveFailures: number };

export interface AvailabilityCache {
	get(provider: string): ProviderAvailability | undefined;
	/** Cheap probe with a hard timeout; NEVER a real model call (R51). Never throws/rejects. */
	probe(provider: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ProviderAvailability>;
}

// ================= Usage/cost ledger (D9/R52) -- molde grounding-ledger.ts ===============================

/** Decided by PROVENANCE (is this (provider, modelId) pair in the vendor's OWN generated catalog?), never
 * by the VALUE of `Model.cost` -- F1: `provider-composer.ts:157` zero-fills an undeclared cost block, so
 * reading `.cost` as truth is indistinguishable from "genuinely free". */
export type PriceProvenance =
	| { known: true; source: "vendor-catalog"; rates: ModelCostRates }
	| { known: false; reason: "model-not-in-vendor-catalog" | "declared-without-cost" };

export interface UsageRecord {
	id: string;
	at: string;
	projectId: string;
	demandId?: string;
	gate?: number;
	gateModelRole?: GateModelRole;
	role?: string;
	provider: string;
	modelId: string;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	/** `null` is the ONLY "unknown" value (BR-10/F1). Zero means zero. */
	costUsd: number | null;
	priced: PriceProvenance;
	fallbackOf?: { from: ModelRef; consent: "same-provider" | "explicit" | "pre-authorized" };
}
