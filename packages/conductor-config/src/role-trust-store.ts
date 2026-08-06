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

import { existsSync, readFileSync, statSync } from "node:fs";
import type { ConductorRole, RoleApprovalPolicy } from "./role-loader.ts";

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
function isRoleTrustEntry(value: unknown): value is RoleTrustEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.roleId === "string" && typeof entry.contentHash === "string" && typeof entry.grantedAt === "string"
	);
}

function isRoleTrustStoreDocument(value: unknown): value is RoleTrustStoreDocument {
	if (typeof value !== "object" || value === null) return false;
	const doc = value as Record<string, unknown>;
	return (
		doc.schema === ROLE_TRUST_STORE_SCHEMA_VERSION &&
		Array.isArray(doc.trusted) &&
		doc.trusted.every(isRoleTrustEntry)
	);
}

/**
 * Same single-try/catch, collapse-everything-to-empty shape as `policy-trust-store.ts`'s
 * `readTrustedEntries` (R15's role-registry analogue of R11a): missing file, invalid JSON, schema
 * mismatch, or any filesystem error (permission denied, path is a directory, a race between
 * existsSync/statSync and the actual read, ...) all collapse to an empty ledger — never a thrown
 * exception, never a partially-trusted result. `onError` fires only for the genuinely-unexpected
 * subset (not `SyntaxError`, which is just "corrupt JSON", already named by the empty-result
 * contract) and can never change the fail-closed return value even if the callback itself throws.
 */
function readTrustedRoleEntries(filePath: string, onError?: (error: unknown) => void): RoleTrustEntry[] {
	try {
		if (!existsSync(filePath)) return [];
		if (!statSync(filePath).isFile()) return [];
		const raw = readFileSync(filePath, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRoleTrustStoreDocument(parsed)) return [];
		return parsed.trusted;
	} catch (error) {
		if (!(error instanceof SyntaxError)) {
			try {
				onError?.(error);
			} catch {
				// Observability must never affect the fail-closed contract above.
			}
		}
		return [];
	}
}

export function loadRoleTrustStore(filePath: string, options: RoleTrustStoreOptions = {}): RoleTrustStore {
	const entries = readTrustedRoleEntries(filePath, options.onError);
	return {
		isTrusted(roleId: string, contentHash: string): boolean {
			return entries.some((entry) => entry.roleId === roleId && entry.contentHash === contentHash);
		},
	};
}

/**
 * Resolves the effective `ConductorRole` a project role is allowed to run as, applying the
 * asymmetric split-trust merge documented above. `builtinRole` is `undefined` when the project role
 * has no built-in counterpart of the same name (a wholly project-defined role).
 */
/**
 * Effective tools/canSpawn = (builtin ∩ project) ∪ (trusted ? (project \ builtin) : ∅) — the exact
 * arithmetic from this module's header. The intersection term is what makes a NARROWING project
 * list (a restriction) apply unconditionally: an item the project drops relative to builtin is
 * simply absent from the intersection regardless of trust. The `trusted`-gated remainder term is
 * what makes a WIDENING project list (a grant) require trust-on-first-use. `builtinList: []` (no
 * builtin counterpart) collapses the intersection to empty and the remainder to the full project
 * list, which is exactly T37's "falls to the most restrictive posture until trusted".
 */
function mergeAuthorityList(
	builtinList: readonly string[],
	projectList: readonly string[],
	trusted: boolean,
): string[] {
	const builtinSet = new Set(builtinList);
	const intersection = projectList.filter((item) => builtinSet.has(item));
	const grantedExtras = trusted ? projectList.filter((item) => !builtinSet.has(item)) : [];

	const seen = new Set<string>();
	const merged: string[] = [];
	for (const item of [...intersection, ...grantedExtras]) {
		if (!seen.has(item)) {
			seen.add(item);
			merged.push(item);
		}
	}
	return merged;
}

/** Ordinal rank for `maxRiskTier`, most-restrictive first. An absent tier is treated as the WIDEST
 * value (no extra ceiling declared beyond the hardcoded "high/critical always confirm" rule), so a
 * project role that adds a tier where builtin declared none is judged a grant (loosening from
 * "no stated cap"), not a restriction — the fail-closed direction for an ambiguous case. */
function approvalTierRank(tier: RoleApprovalPolicy["maxRiskTier"]): number {
	if (tier === "low") return 0;
	if (tier === "medium") return 1;
	return 2;
}

/**
 * `approvalPolicy.maxRiskTier`: tightening (a lower rank than builtin's) applies unconditionally,
 * same restriction-always-wins direction as tools/canSpawn; loosening (a higher rank) requires
 * trust, same grant-needs-trust direction. `autoApprove` carries no variable state to merge (its
 * type only ever allows the literal `false`), so it is passed through from whichever policy object
 * is chosen as the base.
 */
function resolveApprovalPolicy(
	builtinPolicy: RoleApprovalPolicy | undefined,
	projectPolicy: RoleApprovalPolicy | undefined,
	trusted: boolean,
): RoleApprovalPolicy | undefined {
	if (!projectPolicy) return builtinPolicy;
	if (!builtinPolicy) return trusted ? projectPolicy : undefined;

	const builtinRank = approvalTierRank(builtinPolicy.maxRiskTier);
	const projectRank = approvalTierRank(projectPolicy.maxRiskTier);
	const tightening = projectRank < builtinRank;
	const loosening = projectRank > builtinRank;

	const maxRiskTier = tightening || (loosening && trusted) ? projectPolicy.maxRiskTier : builtinPolicy.maxRiskTier;
	return { ...builtinPolicy, maxRiskTier };
}

/** T37(d): even a persona (systemPrompt) diff is a grant. An untrusted project role shadowing a
 * builtin of the same name never gets its persona honored, only the builtin's — a project role
 * with no builtin counterpart has nothing to shadow, so its own systemPrompt always applies. */
function resolveSystemPrompt(
	builtinRole: ConductorRole | undefined,
	projectRole: ConductorRole,
	trusted: boolean,
): string {
	if (!builtinRole) return projectRole.systemPrompt;
	return trusted ? projectRole.systemPrompt : builtinRole.systemPrompt;
}

export function resolveRoleGrants(
	builtinRole: ConductorRole | undefined,
	projectRole: ConductorRole,
	trustStore: RoleTrustStore,
): ConductorRole {
	const trusted = trustStore.isTrusted(projectRole.name, projectRole.contentHash);

	// Everything that is not a tools/canSpawn/approvalPolicy/systemPrompt grant follows the same
	// trust gate: with no builtin counterpart there is nothing to fall back to, and once trusted the
	// project's own declaration is authoritative; untrusted-with-a-counterpart keeps the builtin's
	// identity fields rather than honoring an unreviewed project declaration.
	const useProjectIdentity = !builtinRole || trusted;

	return {
		name: projectRole.name,
		description: useProjectIdentity ? projectRole.description : builtinRole.description,
		systemPrompt: resolveSystemPrompt(builtinRole, projectRole, trusted),
		model: useProjectIdentity ? projectRole.model : builtinRole.model,
		tools: mergeAuthorityList(builtinRole?.tools ?? [], projectRole.tools, trusted),
		modelRole: useProjectIdentity ? projectRole.modelRole : builtinRole.modelRole,
		skills: useProjectIdentity ? projectRole.skills : builtinRole.skills,
		canSpawn: mergeAuthorityList(builtinRole?.canSpawn ?? [], projectRole.canSpawn, trusted),
		gates: useProjectIdentity ? projectRole.gates : builtinRole.gates,
		approvalPolicy: resolveApprovalPolicy(builtinRole?.approvalPolicy, projectRole.approvalPolicy, trusted),
		source: projectRole.source,
		contentHash: projectRole.contentHash,
		filePath: projectRole.filePath,
		area: useProjectIdentity ? projectRole.area : builtinRole.area,
	};
}
