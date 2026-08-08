/**
 * Shared fixtures for @conductor/providers Gate 5 (RED) tests.
 *
 * JUDGMENT CALL flagged for Gate 6 (also called out in this stream's final report): ADR
 * 0008-fase7-model-routing-and-providers.md §16 defines
 *   buildResolutionContext(options): Promise<ResolutionContext>
 *   resolveModelForGate(request, ctx: ResolutionContext): ModelResolution
 * but never spells out `ResolutionContext`'s own field shape -- only the ingredients that go into it
 * are named in §5.1/D3 ("um snapshot já lido -- política validada, catálogo, status de credencial por
 * provedor, mapa de disponibilidade"). `ResolutionContextFixture` below is this stream's best-grounded
 * reconstruction, built ONLY from parts the contract locks elsewhere in the same document:
 *   - the per-provider "credential" trace-step shape (§16 ResolutionStep, stage "credential":
 *     `{provider, configured, source?, authorizedByPolicy}`) is reused verbatim for the credential map's
 *     value type -- a ResolutionContext has to carry at least the data that step later reports;
 *   - the per-provider "availability" trace-step shape is reused verbatim for the availability map;
 *   - `CandidateView` (§16, already a named export) is reused verbatim for bindings-per-role.
 * Gate 6 is free to reshape the CONTAINER (field names/nesting) as long as it keeps producing the same
 * OBSERVABLE resolutions these tests assert on -- every test in this stream exercises
 * `resolveModelForGate` as a black box (request in, ModelResolution out), never reaches into
 * ResolutionContext internals beyond constructing one to hand it in.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

/** GateModelRole (D1, ADR §3.2/§16) -- 1:1 with the CLAUDE.md "Model roles per gate" table. */
export type GateModelRoleFixture = "plan" | "slow" | "default" | "smol";

/** DEFAULT_GATE_MODEL_ROLE_RANK, reproduced verbatim from ADR §16 (D1.5/D1.6) -- smol<default<plan<slow. */
export const RANK: Readonly<Record<GateModelRoleFixture, number>> = {
	smol: 0,
	default: 1,
	plan: 2,
	slow: 3,
};

export interface CredentialStatusFixture {
	configured: boolean;
	source?: "runtime" | "stored" | "environment";
	/** R46: presence alone (esp. source:"environment") NEVER authorizes -- only an explicit binding does. */
	authorizedByPolicy: boolean;
}

export interface AvailabilityStatusFixture {
	state: "not-probed" | "reachable" | "unreachable" | "misconfigured" | "unauthenticated" | "cooldown";
	checkedAt?: string;
	cooldownUntil?: string;
}

export interface ModelRefFixture {
	provider: string;
	modelId: string;
}

export interface CandidateFixture {
	ref: ModelRefFixture;
	rank: number;
	declaredIn: "project-policy" | "user-policy" | "builtin-default";
	/** Embedded per-CANDIDATE (not looked up later from the flat `credentials`/`availability` maps below)
	 * -- deliberately, so two candidates sharing a provider (e.g. resolution-two-floor-fallback.test.ts's
	 * "claude-primary" vs. a healthy same-provider alternate) can carry genuinely different statuses. In
	 * real production this pair is always consistent (one provider, one reachability fact -- `buildResolutionContext`
	 * copies the SAME provider-level status onto every candidate of that provider), but the fixture's own
	 * flat, provider-KEYED maps below would silently OVERWRITE an earlier candidate's status when a second
	 * candidate for the same provider is registered -- exactly the footgun a "same provider, different
	 * current state" test needs to avoid. See this module's own top-of-file comment: "Gate 6 is free to
	 * reshape the CONTAINER... as long as it keeps producing the same OBSERVABLE resolutions". */
	credential: CredentialStatusFixture;
	availability: AvailabilityStatusFixture;
}

export interface ResolutionContextFixture {
	gateModelRoles: Record<
		number,
		{ role: GateModelRoleFixture; source: "builtin" | "project-policy"; pinned?: boolean }
	>;
	bindingsByRole: Partial<Record<GateModelRoleFixture, CandidateFixture[]>>;
	credentials: Record<string, CredentialStatusFixture>;
	availability: Record<string, AvailabilityStatusFixture>;
	/** Keyed by `${provider}::${modelId}` (see catalogKey below) -- the resolved Model<Api> to hand back. */
	catalog: Record<string, Model<Api>>;
	/**
	 * JUDGMENT CALL: §8.2/D6 of the ADR requires a policy that is PRESENT but unreadable/invalid to
	 * refuse with `policy-unreadable` rather than silently falling back to built-in defaults (a present-
	 * but-corrupt policy must never read the same as "no policy") -- but `resolveModelForGate` is pure
	 * and synchronous, so this can only be a precondition already recorded in the snapshot by the async
	 * `buildResolutionContext` boundary. This field is this stream's best-grounded placeholder for that
	 * recorded fact; Gate 6 may reshape it (e.g. into the same `ModelPolicyDiagnostic`-shaped mechanism
	 * @conductor/config already uses elsewhere) as long as the same refusal is observably produced.
	 */
	policyUnreadable?: string;
}

export function catalogKey(provider: string, modelId: string): string {
	return `${provider}::${modelId}`;
}

export function fixtureModel(overrides: Partial<Model<Api>> & { provider: string; id: string }): Model<Api> {
	return {
		name: overrides.id,
		api: "anthropic-messages",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		contextWindow: 200_000,
		maxTokens: 8192,
		...overrides,
	} as Model<Api>;
}

export function baseContext(overrides: Partial<ResolutionContextFixture> = {}): ResolutionContextFixture {
	return {
		gateModelRoles: {},
		bindingsByRole: {},
		credentials: {},
		availability: {},
		catalog: {},
		...overrides,
	};
}

/** Convenience: register a candidate consistently across bindingsByRole/credentials/availability/catalog. */
export function registerCandidate(
	ctx: ResolutionContextFixture,
	role: GateModelRoleFixture,
	candidate: {
		provider: string;
		modelId: string;
		rank: number;
		declaredIn: CandidateFixture["declaredIn"];
		credential: CredentialStatusFixture;
		availability: AvailabilityStatusFixture;
		model?: Partial<Model<Api>>;
	},
): void {
	const ref: ModelRefFixture = { provider: candidate.provider, modelId: candidate.modelId };
	if (!ctx.bindingsByRole[role]) {
		ctx.bindingsByRole[role] = [];
	}
	const list = ctx.bindingsByRole[role];
	list.push({
		ref,
		rank: candidate.rank,
		declaredIn: candidate.declaredIn,
		credential: candidate.credential,
		availability: candidate.availability,
	});
	// Flat, provider-keyed maps: kept for the R46/T65 canary shape (a provider with a VISIBLE credential
	// but NO binding at all -- resolution-env-credential-canary.test.ts sets these directly without ever
	// calling registerCandidate). Not consulted by the selection algorithm itself, which reads only the
	// per-candidate fields embedded above.
	ctx.credentials[candidate.provider] = candidate.credential;
	ctx.availability[candidate.provider] = candidate.availability;
	ctx.catalog[catalogKey(candidate.provider, candidate.modelId)] = fixtureModel({
		provider: candidate.provider,
		id: candidate.modelId,
		...candidate.model,
	});
}
