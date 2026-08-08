/**
 * `resolveModelForGate` -- the resolution pipeline as a PURE function over an already-built
 * `ResolutionContext` snapshot (docs/adr/0008-fase7-model-routing-and-providers.md §5/D3). No I/O here;
 * all of it lives at the edge, in `buildResolutionContext` (resolution-context.ts). Never throws (R49(i)):
 * every dead end returns a typed `ResolutionRefusal`, never a thrown exception, never a silent default
 * substitution. The `ResolutionTrace` is part of the return, on EVERY path, including success -- it is
 * what `models why` prints (D3/FR-13).
 *
 * The seven stages, in the ADR's own order (§5.2), and what each can refuse:
 *   1 gate->role        : unsupported-gate, no-gate-mapping
 *   2 floor              : never refuses -- produces max(rank(gate), rank(persona)) (D1.5)
 *   3 bindings            : no-binding-for-role
 *   4 catalog validation  : unknown-model, unknown-provider, untrusted-endpoint
 *   5 credential          : no-credential (R46: authorizedByPolicy, never source alone, gates this)
 *   6 availability         : all-candidates-unavailable
 *   7 selection (two floors, D5/§7.1) : below-tier-floor, consent-required, both-floors-unsatisfiable
 *
 * Determinism (FR-6, §5.1): ties break by (1) declared order within the PROJECT policy, (2) declared
 * order within the USER policy, (3) provider then modelId, lexicographic -- never object/Map iteration
 * order. Implemented via a comparator plus `Array#sort`'s ES2019+ STABLE sort guarantee (this package's
 * `engines.node` floor, `>=22.19.0`, postdates that guarantee by years): candidates within the same
 * declared-order category compare equal, and stability alone preserves their original array position.
 */

import { DEFAULT_GATE_MODEL_ROLE_RANK, DEFAULT_GATE_MODEL_ROLES, MODEL_ROLE_RANK } from "@conductor/config";
import type {
	CandidateView,
	ModelRef,
	ModelResolution,
	ResolutionContext,
	ResolutionRefusal,
	ResolutionStep,
	ResolutionTrace,
	ResolvedCandidate,
	ResolveModelRequest,
} from "./types.ts";

/** [1, 14] today, but DERIVED from the same 14-gate table `@conductor/config` already owns
 * (`DEFAULT_GATE_MODEL_ROLES`, itself a 1:1 transcription of the root CLAUDE.md table) -- never a second,
 * independently-typed `14` literal that could drift from that single source of truth. */
const GATE_RANGE: readonly [number, number] = (() => {
	const gates = Object.keys(DEFAULT_GATE_MODEL_ROLES).map(Number);
	return [Math.min(...gates), Math.max(...gates)];
})();

/** §5.2 stage 6 ("fora de cooldown"): these four states exclude a candidate from selection.
 * "not-probed" and "reachable" both remain eligible -- D7: the primary is never probed, so "not-probed"
 * has to mean "no evidence of trouble", not "assume broken". */
const BAD_AVAILABILITY_STATES: ReadonlySet<string> = new Set([
	"unreachable",
	"misconfigured",
	"unauthenticated",
	"cooldown",
]);

function catalogKey(provider: string, modelId: string): string {
	return `${provider}::${modelId}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

const DECLARATION_CATEGORY_RANK: Readonly<Record<ResolvedCandidate["declaredIn"], number>> = {
	"project-policy": 0,
	"user-policy": 1,
	"builtin-default": 2,
};

/** The deterministic tie-break comparator (§5.1). Category (project > user > builtin-default) always
 * wins outright, regardless of array position (resolution-determinism.test.ts's "rule 1 over rule 2").
 * Within `builtin-default` there is no real "declaration" to preserve, so rule 3 (lexicographic) applies
 * directly. Within project-policy/user-policy, returning 0 lets the caller's STABLE sort preserve the
 * original array order (rules 1/2) -- never a second, competing ordering. */
function compareCandidates(a: ResolvedCandidate, b: ResolvedCandidate): number {
	const categoryDiff = DECLARATION_CATEGORY_RANK[a.declaredIn] - DECLARATION_CATEGORY_RANK[b.declaredIn];
	if (categoryDiff !== 0) return categoryDiff;
	if (a.declaredIn === "builtin-default") {
		if (a.ref.provider !== b.ref.provider) return a.ref.provider < b.ref.provider ? -1 : 1;
		if (a.ref.modelId !== b.ref.modelId) return a.ref.modelId < b.ref.modelId ? -1 : 1;
		return 0;
	}
	return 0;
}

function stableWinner(candidates: readonly ResolvedCandidate[]): ResolvedCandidate {
	const winner = [...candidates].sort(compareCandidates)[0];
	if (!winner) throw new Error("stableWinner called with an empty candidate list -- caller invariant violated");
	return winner;
}

/** The best (highest-rank) candidate in a below-floor region, for the `below-tier-floor` refusal's
 * `bestRank`/`candidate` fields -- ties among equally-ranked losers still break deterministically. */
function bestOf(candidates: readonly ResolvedCandidate[]): ResolvedCandidate {
	const winner = [...candidates].sort((a, b) => b.rank - a.rank || compareCandidates(a, b))[0];
	if (!winner) throw new Error("bestOf called with an empty candidate list -- caller invariant violated");
	return winner;
}

function destinationHostFor(ctx: ResolutionContext, ref: ModelRef): string {
	const model = ctx.catalog[catalogKey(ref.provider, ref.modelId)];
	if (model?.baseUrl) {
		try {
			return new URL(model.baseUrl).host;
		} catch {
			// A malformed baseUrl must never crash a pure resolution function (R49) -- fall back to naming
			// the provider, still informative for a consent prompt.
		}
	}
	return ref.provider;
}

export function resolveModelForGate(request: ResolveModelRequest, ctx: ResolutionContext): ModelResolution {
	const { gate } = request;
	const steps: ResolutionStep[] = [];
	const trace = (): ResolutionTrace => ({ gate, at: nowIso(), steps: [...steps] });
	const refuse = (refusal: ResolutionRefusal): ModelResolution => ({ resolved: false, refusal, trace: trace() });

	// Edge case 8: gate outside 1..14 refuses naming the valid range, before touching anything else.
	if (!Number.isInteger(gate) || gate < GATE_RANGE[0] || gate > GATE_RANGE[1]) {
		return refuse({ kind: "unsupported-gate", gate, validRange: [GATE_RANGE[0], GATE_RANGE[1]] });
	}

	// D6/§8.2: a PRESENT-but-unreadable policy must never collapse to "absent" -- that is exactly the
	// hole an attacker corrupting a restrictive policy would want opened (R49(iii)).
	if (ctx.policyUnreadable !== undefined) {
		return refuse({ kind: "policy-unreadable", gate, detail: ctx.policyUnreadable });
	}

	// Stage 1: gate -> role (FR-9/FR-10/FR-11).
	const gateRoleEntry = ctx.gateModelRoles[gate];
	if (!gateRoleEntry) {
		return refuse({ kind: "no-gate-mapping", gate });
	}
	steps.push({
		stage: "gate-role",
		role: gateRoleEntry.role,
		source: gateRoleEntry.source,
		...(gateRoleEntry.pinned !== undefined ? { pinned: gateRoleEntry.pinned } : {}),
	});

	// Stage 2: floor = max(rank(gate), rank(persona)) (D1.5) -- never refuses, only produces a number.
	const gateRank = DEFAULT_GATE_MODEL_ROLE_RANK[gateRoleEntry.role];
	const personaRank = request.persona ? MODEL_ROLE_RANK[request.persona.modelRole] : undefined;
	const floor = personaRank !== undefined ? Math.max(gateRank, personaRank) : gateRank;
	steps.push({ stage: "floor", gateRank, ...(personaRank !== undefined ? { personaRank } : {}), effective: floor });

	// Stage 3: bindings declared for the resolved role (FR-8/FR-14).
	const rawCandidates = ctx.bindingsByRole[gateRoleEntry.role] ?? [];
	steps.push({
		stage: "bindings",
		role: gateRoleEntry.role,
		candidates: rawCandidates.map((c): CandidateView => ({ ref: c.ref, rank: c.rank, declaredIn: c.declaredIn })),
	});
	if (rawCandidates.length === 0) {
		const untrusted = ctx.untrustedBindings?.[gateRoleEntry.role]?.[0];
		if (untrusted) {
			return refuse({ kind: "untrusted-endpoint", gate, provider: untrusted.ref.provider, host: untrusted.host });
		}
		return refuse({ kind: "no-binding-for-role", gate, role: gateRoleEntry.role });
	}

	// Stage 4: catalog validation (R54(i)) -- a binding whose (provider, modelId) is not a KNOWN model is
	// refused naming the invalid model, never silently accepted as "valid but never resolves" (edge 9).
	const accepted: ResolvedCandidate[] = [];
	const rejectedCatalog: { ref: string; why: "unknown-model" | "unknown-provider" | "untrusted-endpoint" }[] = [];
	for (const candidate of rawCandidates) {
		if (ctx.catalog[catalogKey(candidate.ref.provider, candidate.ref.modelId)]) {
			accepted.push(candidate);
			continue;
		}
		const providerKnown = Object.keys(ctx.catalog).some((key) => key.startsWith(`${candidate.ref.provider}::`));
		rejectedCatalog.push({
			ref: catalogKey(candidate.ref.provider, candidate.ref.modelId),
			why: providerKnown ? "unknown-model" : "unknown-provider",
		});
	}
	steps.push({ stage: "catalog", accepted: accepted.map((c) => c.ref), rejected: rejectedCatalog });
	if (accepted.length === 0) {
		const untrusted = ctx.untrustedBindings?.[gateRoleEntry.role]?.[0];
		if (untrusted) {
			return refuse({ kind: "untrusted-endpoint", gate, provider: untrusted.ref.provider, host: untrusted.host });
		}
		const first = rejectedCatalog[0];
		if (!first) return refuse({ kind: "no-binding-for-role", gate, role: gateRoleEntry.role });
		const separatorIndex = first.ref.indexOf("::");
		const declaredProvider = separatorIndex >= 0 ? first.ref.slice(0, separatorIndex) : first.ref;
		const declaredModelId = separatorIndex >= 0 ? first.ref.slice(separatorIndex + 2) : first.ref;
		if (first.why === "unknown-provider") {
			return refuse({ kind: "unknown-provider", gate, declared: declaredProvider });
		}
		return refuse({ kind: "unknown-model", gate, declared: declaredModelId });
	}

	// Stage 5: credential (R46) -- reaching this stage at all means the (provider, modelId) pair came
	// from an EXPLICIT binding; `authorizedByPolicy` (never `source` alone, esp. "environment") is what
	// R46 requires for a candidate to survive this filter.
	const credentialPerProvider = new Map<string, ResolvedCandidate["credential"]>();
	for (const candidate of accepted) {
		if (!credentialPerProvider.has(candidate.ref.provider))
			credentialPerProvider.set(candidate.ref.provider, candidate.credential);
	}
	steps.push({
		stage: "credential",
		perProvider: [...credentialPerProvider.entries()].map(([provider, credential]) => ({
			provider,
			configured: credential.configured,
			...(credential.source !== undefined ? { source: credential.source } : {}),
			authorizedByPolicy: credential.authorizedByPolicy,
		})),
	});

	const credentialed = accepted.filter((c) => c.credential.configured && c.credential.authorizedByPolicy);
	if (credentialed.length === 0) {
		const providers = [...new Set(accepted.map((c) => c.ref.provider))];
		return refuse({ kind: "no-credential", gate, role: gateRoleEntry.role, providers });
	}

	// Stage 6: availability -- discard candidates in cooldown / known-bad (D7).
	const availabilityPerProvider = new Map<string, ResolvedCandidate["availability"]>();
	for (const candidate of credentialed) {
		if (!availabilityPerProvider.has(candidate.ref.provider))
			availabilityPerProvider.set(candidate.ref.provider, candidate.availability);
	}
	steps.push({
		stage: "availability",
		perProvider: [...availabilityPerProvider.entries()].map(([provider, availability]) => ({
			provider,
			state: availability.state,
			...(availability.checkedAt !== undefined ? { checkedAt: availability.checkedAt } : {}),
			...(availability.cooldownUntil !== undefined ? { cooldownUntil: availability.cooldownUntil } : {}),
		})),
	});

	const excludedForAvailability = credentialed.filter((c) => BAD_AVAILABILITY_STATES.has(c.availability.state));
	const available = credentialed.filter((c) => !BAD_AVAILABILITY_STATES.has(c.availability.state));
	if (available.length === 0) {
		const providers = [...new Set(credentialed.map((c) => c.ref.provider))];
		return refuse({ kind: "all-candidates-unavailable", gate, providers });
	}

	// Stage 7: selection -- the two-floor split (D5/§7.1, resolving spec gate2-spec-fase7.md's OQ#3).
	// `activeProvider` anchors the same-provider floor (BR6); without it there is nothing to anchor
	// against, so ONLY the tier floor applies (resolution-tier-floor-universal.test.ts covers this shape).
	const activeProvider = request.activeProvider;
	const atOrAboveFloor = available.filter((c) => c.rank >= floor);
	const belowFloor = available.filter((c) => c.rank < floor);

	const cok =
		activeProvider !== undefined ? atOrAboveFloor.filter((c) => c.ref.provider === activeProvider) : atOrAboveFloor;
	const sameProviderBelowTier =
		activeProvider !== undefined ? belowFloor.filter((c) => c.ref.provider === activeProvider) : belowFloor;
	const crossProviderAtTier =
		activeProvider !== undefined ? atOrAboveFloor.filter((c) => c.ref.provider !== activeProvider) : [];

	if (cok.length > 0) {
		const selected = stableWinner(cok);
		const model = ctx.catalog[catalogKey(selected.ref.provider, selected.ref.modelId)];
		if (!model)
			throw new Error(
				"invariant violated: a Cok-selected candidate must have a catalog entry (stage 4 already validated it)",
			);
		// FR-16: only annotate as a fallback when there is actual evidence the same-provider primary was
		// unavailable (excludedForAvailability) -- a plain successful resolution (no exclusion) is not a
		// fallback, it is just resolution.
		const primaryFailure =
			activeProvider !== undefined
				? excludedForAvailability.find((c) => c.ref.provider === activeProvider)
				: undefined;
		steps.push({
			stage: "selection",
			selected: selected.ref,
			rejected: cok.filter((c) => c !== selected).map((c) => ({ ref: c.ref, why: "below-tier-floor" as const })),
		});
		return {
			resolved: true,
			model,
			ref: selected.ref,
			effectiveRank: floor,
			...(primaryFailure ? { fallbackOf: { from: primaryFailure.ref, consent: "same-provider" as const } } : {}),
			trace: trace(),
		};
	}

	const rejectedSelection = [
		...sameProviderBelowTier.map((c) => ({ ref: c.ref, why: "below-tier-floor" as const })),
		...crossProviderAtTier.map((c) => ({ ref: c.ref, why: "consent-required" as const })),
	];
	steps.push({ stage: "selection", rejected: rejectedSelection });

	// Region A (same provider, below floor): R48/T67 -- REJECTED always, never offered, never consentible,
	// not even in the 9 non-mandatory gates (resolution-tier-floor-universal.test.ts's universality claim).
	if (sameProviderBelowTier.length > 0 && crossProviderAtTier.length === 0) {
		const best = bestOf(sameProviderBelowTier);
		return refuse({ kind: "below-tier-floor", gate, requiredRank: floor, bestRank: best.rank, candidate: best.ref });
	}

	// Region B (cross-provider, at/above floor): R47/T66 -- consent-required. `resolveModelForGate` is a
	// pure, synchronous function (D3): it has no ConfirmChannel/TTY to obtain consent with, so it can
	// only ever report the need for consent, never grant it. A CLI-level caller that already holds a
	// pre-authorized consent fact would encode that as its own candidate/context input -- not modeled by
	// any test in this stream, so not invented here.
	if (sameProviderBelowTier.length === 0 && crossProviderAtTier.length > 0) {
		const candidate = stableWinner(crossProviderAtTier);
		return refuse({
			kind: "consent-required",
			gate,
			candidate: candidate.ref,
			destinationHost: destinationHostFor(ctx, candidate.ref),
		});
	}

	// Divergence: both regions populated -- the machine EXPOSES the conflict, it does not resolve it
	// silently (§7.1's own words).
	if (sameProviderBelowTier.length > 0 && crossProviderAtTier.length > 0) {
		return refuse({
			kind: "both-floors-unsatisfiable",
			gate,
			sameProviderBelowTier: sameProviderBelowTier.map((c) => c.ref),
			crossProviderAtTier: crossProviderAtTier.map((c) => c.ref),
		});
	}

	// Neither Cok, region A, nor region B has anything (e.g. only cross-provider-AND-below-floor
	// candidates exist -- a shape no test in this stream constructs). Fail closed to the same refusal a
	// plain tier miss would produce, naming the best available candidate regardless of provider, rather
	// than inventing a new refusal kind for an edge no contract names.
	const fallbackBest = bestOf(available);
	return refuse({
		kind: "below-tier-floor",
		gate,
		requiredRank: floor,
		bestRank: fallbackBest.rank,
		candidate: fallbackBest.ref,
	});
}
