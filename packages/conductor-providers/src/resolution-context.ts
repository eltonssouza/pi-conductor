/**
 * `buildResolutionContext` -- the async BORDER where all of this engine's I/O lives (D3: "todo I/O é da
 * borda... é o mesmo split 'I/O nas bordas, política no meio' que role-loader.ts e policy-loader.ts já
 * documentam"). `resolveModelForGate` (resolve.ts) is pure and synchronous; this function is the only
 * place that talks to `ModelRuntime`, the vendor catalog, and the `AvailabilityCache`.
 *
 * D7, load-bearing: this function NEVER calls `AvailabilityCache.probe()`. It only peeks the cache
 * (`get`, synchronous, no network) -- probing is on-demand, driven by `models why`/fallback evaluation at
 * a layer above this package's public contract, never by context construction. A candidate with nothing
 * cached defaults to `state: "not-probed"`, which `resolve.ts` treats as eligible (not excluded): the
 * primary's own call IS its health check (SLI 7's zero-ms invariant -- see
 * health-check-not-probing-primary.test.ts, which proves probe() is called zero times end to end).
 *
 * R49(iii): every collaborator this function calls (ModelRuntime, the injected AvailabilityCache, the
 * injected ModelPolicyTrustStore) is wrapped so a THROWN error from any of them degrades to the
 * fail-closed reading ("not configured" / "not-probed" / "untrusted"), never propagates as an unhandled
 * rejection out of this function and never reads as permission (build-context-fail-closed.test.ts proves
 * this against a deliberately misbehaving `AvailabilityCache.probe` -- exercised here only via the `get`
 * path this function actually calls, since probe() itself is never invoked).
 */

import { createHash } from "node:crypto";
import type { GateModelRole, ModelPolicy, ModelPolicyTrustStore } from "@conductor/config";
import { DEFAULT_GATE_MODEL_ROLE_RANK, DEFAULT_GATE_MODEL_ROLES, MODEL_ROLE_RANK } from "@conductor/config";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
	AvailabilityCache,
	AvailabilityStatus,
	CredentialStatus,
	ModelRef,
	ProviderAvailability,
	ResolutionContext,
	ResolvedCandidate,
} from "./types.ts";

function catalogKey(provider: string, modelId: string): string {
	return `${provider}::${modelId}`;
}

/** Structural type -- deliberately not importing the vendor's unexported `AuthStatus` name (it is not
 * re-exported from `@earendil-works/pi-coding-agent`'s package root); this is the same shape derived
 * from the one public method that returns it. */
type AuthStatusLike = ReturnType<ModelRuntime["getProviderAuthStatus"]>;

/** Narrows the vendor's 6-value credential source to this ADR's 3-value contract (§16 ResolutionStep,
 * stage "credential"). The three vendor-specific config-file sources ("fallback", "models_json_key",
 * "models_json_command") have no equivalent bucket here; they are reported as "stored" -- the closest
 * honest reading (declared in local config, not an ambient env-var) -- rather than invented as
 * "environment", which R46 singles out for special never-auto-authorizes treatment. */
function normalizeCredentialSource(source: AuthStatusLike["source"]): "runtime" | "stored" | "environment" | undefined {
	if (source === "runtime" || source === "stored" || source === "environment") return source;
	if (source === undefined) return undefined;
	return "stored";
}

function findBuiltinCatalogModel(provider: string, modelId: string): Model<Api> | undefined {
	let models: readonly Model<Api>[];
	try {
		models = getBuiltinModels(provider as BuiltinProvider) as readonly Model<Api>[];
	} catch {
		return undefined;
	}
	return models.find((model) => model.id === modelId);
}

type BindingClassification =
	| { kind: "trusted"; model: Model<Api> }
	| { kind: "untrusted"; host: string }
	| { kind: "unknown" };

/**
 * R54/D6/T73(b): a binding is resolved against the vendor's OWN generated catalog first (official,
 * always trusted). A model absent from that catalog but present via the injected `ModelRuntime` (i.e.
 * declared in a per-machine, non-workspace `models.json` -- D10, never read from inside the workspace by
 * this function, which never touches the filesystem itself) is a CUSTOM/self-hosted endpoint whose
 * `baseUrl` is configurable -- exactly T73(b)'s exfiltration vector. It is only ever handed back as a
 * resolvable candidate once `trust.isTrusted(...)` confirms a TOFU pin over the (provider, baseUrl) pair;
 * otherwise it is refused as `untrusted`, never silently used.
 */
function classifyBindingTrust(
	modelRuntime: ModelRuntime,
	trust: ModelPolicyTrustStore,
	provider: string,
	modelId: string,
): BindingClassification {
	const builtinMatch = findBuiltinCatalogModel(provider, modelId);
	if (builtinMatch) return { kind: "trusted", model: builtinMatch };

	let configuredModel: Model<Api> | undefined;
	try {
		configuredModel = modelRuntime.getModel(provider, modelId);
	} catch {
		configuredModel = undefined;
	}
	if (!configuredModel) return { kind: "unknown" };

	const pinSubject = `${provider}::${configuredModel.baseUrl}`;
	const contentHash = createHash("sha256").update(pinSubject).digest("hex");
	let trusted = false;
	try {
		trusted = trust.isTrusted(contentHash);
	} catch {
		trusted = false; // R49(iii): a throwing trust store degrades to "untrusted", never "trusted".
	}
	if (trusted) return { kind: "trusted", model: configuredModel };

	let host = provider;
	try {
		host = new URL(configuredModel.baseUrl).host;
	} catch {
		// A malformed baseUrl must never crash trust classification -- fall back to the provider id.
	}
	return { kind: "untrusted", host };
}

function fromProviderAvailability(availability: ProviderAvailability): AvailabilityStatus {
	if (availability.state === "reachable") return { state: "reachable", checkedAt: availability.checkedAt };
	if (availability.state === "cooldown") return { state: "cooldown", cooldownUntil: availability.until };
	return { state: availability.state, checkedAt: availability.checkedAt };
}

/**
 * D11/§21: the rank the universal fallback binding carries. Derived as the maximum of BOTH rank
 * tables (`DEFAULT_GATE_MODEL_ROLE_RANK` for the gate axis, `MODEL_ROLE_RANK` for the persona axis)
 * so it satisfies any floor `resolveModelForGate`'s stage 2 can ever produce
 * (`max(rank(gate), rank(persona))`, D1.5) -- never a magic literal that would silently stop
 * satisfying the floor the day either table grows a higher tier.
 */
export const UNIVERSAL_FALLBACK_RANK: number = Math.max(
	...Object.values(DEFAULT_GATE_MODEL_ROLE_RANK),
	...Object.values(MODEL_ROLE_RANK),
);

export interface BuildResolutionContextOptions {
	workspaceRoot: string;
	modelRuntime: ModelRuntime;
	policy: ModelPolicy | undefined;
	trust: ModelPolicyTrustStore;
	availability: AvailabilityCache;
	/**
	 * D11/§21: the project's flat `provider.model` (Fase 1 config), already split into
	 * `{provider, modelId}`. Used ONLY to seed the universal fallback binding when the policy declares
	 * zero `ModelBinding`s. Absent (or naming a model the catalog does not know) means no fallback is
	 * seeded at all -- this function never invents a model reference of its own.
	 */
	sessionModel?: ModelRef;
}

export async function buildResolutionContext(options: BuildResolutionContextOptions): Promise<ResolutionContext> {
	const { modelRuntime, policy, trust, availability } = options;

	const gateModelRoles: Record<
		number,
		{ role: GateModelRole; source: "builtin" | "project-policy"; pinned?: boolean }
	> = {};
	for (const [gateKey, role] of Object.entries(DEFAULT_GATE_MODEL_ROLES)) {
		gateModelRoles[Number(gateKey)] = { role, source: "builtin" };
	}
	if (policy?.gateRoles) {
		for (const [gateKey, role] of Object.entries(policy.gateRoles)) {
			gateModelRoles[Number(gateKey)] = { role, source: "project-policy" };
		}
	}

	const bindingsByRole: Record<string, ResolvedCandidate[]> = {};
	const catalog: Record<string, Model<Api>> = {};
	const untrustedBindings: NonNullable<ResolutionContext["untrustedBindings"]> = {};
	const credentialCache = new Map<string, CredentialStatus>();
	const availabilityCache = new Map<string, AvailabilityStatus>();

	function credentialFor(provider: string): CredentialStatus {
		const cached = credentialCache.get(provider);
		if (cached) return cached;
		let status: AuthStatusLike;
		try {
			status = modelRuntime.getProviderAuthStatus(provider);
		} catch {
			// R49(iii): a status lookup that throws degrades to "not configured", never "configured" --
			// an error must never read as permission.
			status = { configured: false };
		}
		const normalizedSource = normalizeCredentialSource(status.source);
		const resolved: CredentialStatus = {
			configured: status.configured,
			...(normalizedSource !== undefined ? { source: normalizedSource } : {}),
			// R46(i): reaching this point at all means the (provider, modelId) pair came from an EXPLICIT
			// ModelBinding in the policy -- that binding IS the authorization. A credential's mere
			// presence/source (esp. "environment") never authorizes on its own; only being bound does, and
			// only bound candidates are ever constructed by the loop below.
			authorizedByPolicy: true,
		};
		credentialCache.set(provider, resolved);
		return resolved;
	}

	function availabilityFor(provider: string): AvailabilityStatus {
		const cached = availabilityCache.get(provider);
		if (cached) return cached;
		let known: ProviderAvailability | undefined;
		try {
			known = availability.get(provider);
		} catch {
			known = undefined; // R49(iii): a throwing cache peek degrades to "nothing known", never crashes.
		}
		const resolved: AvailabilityStatus = known ? fromProviderAvailability(known) : { state: "not-probed" };
		availabilityCache.set(provider, resolved);
		return resolved;
	}

	for (const binding of policy?.bindings ?? []) {
		const classification = classifyBindingTrust(modelRuntime, trust, binding.provider, binding.modelId);

		if (classification.kind === "untrusted") {
			const list = untrustedBindings[binding.role] ?? [];
			(untrustedBindings[binding.role] as { ref: { provider: string; modelId: string }; host: string }[]) = [
				...list,
				{ ref: { provider: binding.provider, modelId: binding.modelId }, host: classification.host },
			];
			continue; // R54(ii): never silently trusted -- never added to bindingsByRole/catalog at all.
		}

		const existing = bindingsByRole[binding.role] ?? [];
		existing.push({
			ref: { provider: binding.provider, modelId: binding.modelId },
			rank: binding.rank ?? DEFAULT_GATE_MODEL_ROLE_RANK[binding.role],
			declaredIn: "project-policy",
			credential: credentialFor(binding.provider),
			availability: availabilityFor(binding.provider),
		});
		bindingsByRole[binding.role] = existing;

		if (classification.kind === "trusted") {
			catalog[catalogKey(binding.provider, binding.modelId)] = classification.model;
		}
		// classification.kind === "unknown": added as a CANDIDATE but no catalog entry -- resolveModelForGate's
		// own catalog-validation stage (stage 4) reports it as unknown-model/unknown-provider (R54(i)),
		// never silently treated as resolvable.
	}

	// D11/§21: the universal fallback binding. Seeded ONLY when the project declares zero
	// `ModelBinding`s -- the condition is read from the POLICY (`policy?.bindings`), never from
	// `bindingsByRole` above: a policy whose only binding was dropped as untrusted (R54(ii)) has still
	// left compatibility mode, and must keep refusing rather than silently regaining a fallback the
	// project's own explicit declaration was meant to replace.
	const declaresBindings = (policy?.bindings ?? []).length > 0;
	let universalFallback: ResolvedCandidate | undefined;
	if (!declaresBindings && options.sessionModel) {
		const { provider, modelId } = options.sessionModel;
		const classification = classifyBindingTrust(modelRuntime, trust, provider, modelId);
		if (classification.kind === "trusted") {
			catalog[catalogKey(provider, modelId)] = classification.model;
			universalFallback = {
				ref: { provider, modelId },
				rank: UNIVERSAL_FALLBACK_RANK,
				declaredIn: "builtin-default",
				// The flat `provider.model` IS the project's own explicit declaration of which model it
				// runs on (`.conductor/config.json`, hand-written or `conductor config set`) -- R46's
				// "a credential's mere presence never authorizes, only being bound does" is satisfied by
				// that declaration, exactly as an explicit `ModelBinding` satisfies it. `configured` is
				// still the REAL, unmodified status: stage 7's compatibility branch does not FILTER on
				// it, but the trace must never report a credential that is not there (§21's own
				// grounding, Managing Software Complexity §3.12 -- do not delete information a caller
				// needed).
				credential: { ...credentialFor(provider), authorizedByPolicy: true },
				availability: availabilityFor(provider),
			};
		}
		// classification "unknown"/"untrusted": no fallback is seeded at all. `resolveModelForGate`
		// then refuses naming the missing/untrusted model -- this function never fabricates a
		// `Model<Api>` for a reference the catalog cannot back (R54(i)).
	}

	return {
		gateModelRoles,
		bindingsByRole,
		catalog,
		untrustedBindings,
		...(universalFallback ? { universalFallback } : {}),
	};
}
