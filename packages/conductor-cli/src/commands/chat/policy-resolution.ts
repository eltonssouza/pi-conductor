/**
 * `.conductor/policy.json` resolution for `conductor chat` (ADR 0003 §5/§16; gate2-spec-fase2.md
 * FR-3/FR-6/FR-7/FR-9/FR-10/FR-11/FR-23/FR-24; Gate 8 loop-back closing GAP-B).
 *
 * WHY THIS LIVES HERE, NOT IN conductor-runtime: `@conductor/config`'s `loadPolicyDocument` /
 * `loadPolicyTrustStore` / `mergePolicies` are the only functions that can read `.conductor/policy.json`
 * and `.conductor/policy-trust.json` off disk, but `conductor-runtime` (session.ts, resource-loader.ts,
 * permission-gate.ts) must never depend on `conductor-config` (ADR 0002 §3.1's package-graph invariant,
 * restated explicitly in `@conductor/config`'s own `policy-loader.ts` header: "conductor-runtime's
 * command-classifier/permission-engine consume it as a value passed in by whichever package composes
 * both (conductor-cli, which already depends on both per its own package.json), never by importing this
 * module directly"). `conductor-cli` is that composing package — this module is the composition, and
 * `chat.ts` is its only production caller.
 *
 * SCOPE (Gate 8 loop-back, orchestrator's explicit instruction): only the PROJECT policy.json source is
 * loaded here. ADR 0003 §16's `PolicySourceKind` already anticipates a second `"user-global"` source (a
 * policy a human trusts across every project), but neither ADR 0003 nor gate2-spec-fase2.md /
 * gate3-addendum-fase2.md name a concrete file path for it anywhere in this codebase -- there is no
 * `~/.conductor/policy.json` (or equivalent) decision on record to ground against, and `chat.ts`'s own
 * `ModelRuntime` construction comment establishes the opposite convention for this project's *credentials*
 * ("never `.conductor/`-scoped... not even by accident"), which is not automatically the right answer for
 * a *policy* file either way. Inventing a path here would be a real, unrecorded architecture decision --
 * exactly what the orchestrator's instructions say not to do solo. Left as an explicit, open residual:
 * a future ADR must decide the user-global policy path before `sources` below grows a second entry.
 * Until then, `mergePolicies`'s trust-ordered-intersection semantics already fail safe in this source's
 * absence: with only one (or zero) trusted sources contributing, `allowlist`/`network` grants can never
 * exceed what that single source declares, and restrictions (`protectedPaths`) are unaffected either way
 * (BR-5: they union unconditionally, trust or not). No grant is fabricated by the missing source; the
 * gap only ever narrows what is granted, never widens it.
 */

import { join } from "node:path";
import { loadPolicyDocument, loadPolicyTrustStore, mergePolicies, type PolicySource } from "@conductor/config";
import type { EffectivePolicyInput } from "@conductor/runtime";

export function resolveConductorPolicyPath(workspaceRoot: string): string {
	return join(workspaceRoot, ".conductor", "policy.json");
}

export function resolveConductorPolicyTrustStorePath(workspaceRoot: string): string {
	return join(workspaceRoot, ".conductor", "policy-trust.json");
}

/**
 * Loads and merges the real, on-disk policy for `workspaceRoot` into the structural
 * `EffectivePolicyInput` shape `@conductor/runtime`'s session.ts/permission-gate.ts accept. Never
 * throws: `loadPolicyDocument`/`loadPolicyTrustStore` are themselves total (MUST NEVER throw, per
 * their own contracts) and `mergePolicies` is a pure function over their outputs -- a missing
 * `.conductor/policy.json` (the common case) resolves to the same all-absent `EffectivePolicy`
 * `mergePolicies` already returns for an `"absent"` source: no grants, no extra protected paths,
 * `denyAllPrivileged` false.
 */
export function resolveEffectivePolicy(workspaceRoot: string): EffectivePolicyInput {
	const loaded = loadPolicyDocument(resolveConductorPolicyPath(workspaceRoot));
	const source = { kind: "project", ...loaded } as PolicySource;
	const trustStore = loadPolicyTrustStore(resolveConductorPolicyTrustStorePath(workspaceRoot));

	const effective = mergePolicies({ protectedPaths: [] }, [source], trustStore);

	return {
		protectedPaths: effective.protectedPaths,
		allowlist: effective.allowlist,
		network: effective.network,
		denyAllPrivileged: effective.denyAllPrivileged,
	};
}
