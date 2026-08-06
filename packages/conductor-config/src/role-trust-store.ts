/**
 * RoleTrustStore — the trust-on-first-use ledger for `ConductorRole` grants arriving from a
 * repo-controlled role file (docs/adr/0004-fase3-roles-skills-subagents.md §3.2/§8; T37/R15,
 * docs/conductor/gate3-addendum-fase3.md). Parallels `policy-trust-store.ts`'s `PolicyTrustStore`
 * deliberately and exactly (same fail-closed contract, same trust-on-first-use-by-contentHash shape,
 * same "never throws, never defaults to trusted" rule) — the ADR names this module the "irmão
 * estrutural de policy-trust-store.ts" (§12's packaging table). T37 is T18 by another door: a role
 * definition inside a cloned repository is authority (`tools`/`canSpawn`/`approvalPolicy`/persona)
 * an attacker can author, exactly as `policy.json` was for T18 — the split into restrictions
 * (unconditional) and grants (trust-gated) is the same fix, applied to a role instead of a policy
 * document.
 *
 * GATE 5 (test-first): `loadRoleTrustStore()` and `resolveRoleGrants()` are STUBS that throw
 * "not implemented" — Gate 6 implements the bodies. Once implemented, `isTrusted()` MUST NEVER throw
 * and MUST NEVER default to `true` (R15's role-registry analogue of `policy-trust-store.ts`'s R11a).
 *
 * `resolveRoleGrants`'s asymmetric merge (ADR §3.2, T37 mitigation R15), restated as the exact
 * arithmetic Gate 6 must implement and this Gate 5's tests pin as the observable contract:
 *
 *   - RESTRICTIONS (a project role that narrows `tools`/`canSpawn` relative to the builtin
 *     counterpart, or tightens `approvalPolicy.maxRiskTier`) apply UNCONDITIONALLY, independent of
 *     trust — removing authority is never a threat (same direction as `mergePolicies`'s
 *     `protectedPaths` union).
 *   - GRANTS (a project role that widens `tools`/`canSpawn` beyond the builtin counterpart, loosens
 *     `approvalPolicy.maxRiskTier`, or shadows a builtin persona — i.e. a different `systemPrompt`
 *     under the same role name, even a one-character diff, T37(d)) require the exact
 *     `contentHash` of `projectRole` to be trusted (`trustStore.isTrusted(projectRole.name,
 *     projectRole.contentHash)`); an untrusted or never-approved project role contributes ZERO
 *     grants — not a smaller set, none. Persona: untrusted → the resolved role keeps the BUILTIN's
 *     `systemPrompt` when a builtin counterpart exists; trusted → the project's `systemPrompt` wins.
 *   - Effective `tools`/`canSpawn` = (builtin ∩ project) ∪ (trusted ? (project \ builtin) : ∅). A
 *     project role with NO builtin counterpart (`builtinRole === undefined`) has an implicit empty
 *     builtin set, so an untrusted, counterpart-less project role falls to the most restrictive
 *     posture — `tools: []`, `canSpawn: []` — until a human trusts it (T37: "cai para a postura mais
 *     restritiva… até um humano confiar").
 *   - Never introduces a cycle (R17b) — that invariant is the Delegation Graph Validator's job
 *     (`delegation-graph.ts`, validated over the MERGED graph at load), not this function's; a role
 *     this function resolves may still be rejected downstream by `validateDelegationGraph`.
 */

import type { ConductorRole } from "./role-loader.ts";

export const ROLE_TRUST_STORE_SCHEMA_VERSION = 1;

export interface RoleTrustEntry {
	roleId: string;
	contentHash: string;
	grantedAt: string;
}

/** On-disk shape of the trust ledger — structurally identical to `PolicyTrustStoreDocument`, keyed by
 * `roleId` instead of a policy source `kind`. */
export interface RoleTrustStoreDocument {
	schema: 1;
	trusted: RoleTrustEntry[];
}

export interface RoleTrustStore {
	/**
	 * True only when `contentHash` has a matching, previously-granted entry for `roleId`. Every other
	 * outcome — store absent, store corrupt, hash simply not present — returns `false`. MUST NEVER
	 * throw: a thrown exception a careless caller catches-and-treats-as-true would be exactly the
	 * fail-open T37 warns against (same rule as `PolicyTrustStore.isTrusted`'s R11a).
	 */
	isTrusted(roleId: string, contentHash: string): boolean;
}

export interface RoleTrustStoreOptions {
	/** Observability hook, same contract as `PolicyTrustStoreOptions.onError` — never affects the
	 * fail-closed return value, invoked only for a genuinely-unexpected read failure. */
	onError?: (error: unknown) => void;
}

/**
 * Load the trust-on-first-use ledger from `filePath`. Fail-closed on every read path (R15's
 * `PolicyTrustStore`-equivalent contract): a missing file, invalid JSON, a schema mismatch, or any
 * filesystem error all produce a `RoleTrustStore` whose `isTrusted()` always returns `false` — never
 * a thrown exception, never a store that resolves to "trusted" for anything.
 */
export function loadRoleTrustStore(filePath: string, options: RoleTrustStoreOptions = {}): RoleTrustStore {
	throw new Error("not implemented");
}

/**
 * Resolves the effective `ConductorRole` a project role is allowed to run as, applying the
 * asymmetric split-trust merge documented above. `builtinRole` is `undefined` when the project role
 * has no built-in counterpart of the same name (a wholly project-defined role).
 */
export function resolveRoleGrants(
	builtinRole: ConductorRole | undefined,
	projectRole: ConductorRole,
	trustStore: RoleTrustStore,
): ConductorRole {
	throw new Error("not implemented");
}
