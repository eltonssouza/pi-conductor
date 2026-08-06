/**
 * Role Registry — `ConductorRole` shape, cross-checking a set of already-parsed roles against the
 * project's known-skill catalog (BR-1/BR-2/R21/T39), and name resolution with suggestion-by-proximity
 * (FR-1/FR-2/FR-3).
 *
 * docs/adr/0004-fase3-roles-skills-subagents.md §3 / Apêndice §16 is the source of truth for
 * `ConductorRole`'s shape — reproduced here VERBATIM (field names/types/optionality), not
 * reinterpreted, so Gate 6 does not have to reconcile two versions of the same contract. §3.1 decided
 * the on-disk format stays Markdown+frontmatter (`agents.ts:parseFrontmatter`, already exercised by
 * the Pi), extended with the fields `AgentConfig` (examples/extensions/subagent/agents.ts) does not
 * carry: `tools` (made REQUIRED here, never "undefined = tudo" — FR-20), `modelRole`, `skills`,
 * `canSpawn`, `gates`, `approvalPolicy`, and provenance (`source`/`contentHash`/`filePath`/`area`).
 *
 * GATE 5 (test-first): every function below is a STUB that throws "not implemented" — Gate 6
 * implements the bodies.
 *
 * Scope boundary (deliberate, not an oversight): this module works over ALREADY-PARSED
 * `ConductorRole` values, the same way `policy-loader.ts`'s `mergePolicies` works over
 * already-parsed `PolicySource[]` rather than raw files — the split that file's own header
 * documents ("I/O at the edges, policy in the middle", Architecture Boundaries and the Dependency
 * Rule, cited at Gate 4 for this exact seam, ADR 0004 §1.3 item 3: "as decisões... têm que ser
 * unit-testáveis sem ctx/UI/disco"). A real `loadRoleFile(filePath)` I/O boundary (frontmatter
 * parsing via the Pi's own `parseFrontmatter`, sha256 contentHash over raw bytes — the same shape
 * `loadPolicyDocument` already uses in this package) is Gate 6/CLI wiring
 * (`@conductor/cli/src/commands/chat/role-resolution.ts` per ADR §12's packaging table), not
 * duplicated here to avoid adding a production dependency on `@earendil-works/pi-coding-agent` to
 * this package for a Gate-5 stub that would not be exercised by these unit tests anyway.
 *
 * Fail-closed, non-partial load (R21, BR-1, BR-2, T39): a role that names a skill absent from the
 * project's known-skill catalog does NOT load with that skill silently dropped, and it does NOT load
 * "mostly fine" with a hole where the skill should be — the whole role is EXCLUDED from the registry,
 * with a diagnostic naming exactly which skill is missing (`buildRoleRegistry`'s `diagnostics`).
 * "Non-partial" is scoped to the OFFENDING role, not the whole registry: every other valid role in
 * the same input list still loads (mirrors `mergePolicies`'s own "a bad source is never outvoted by a
 * majority of good ones", applied to one role's completeness instead of one document's fields).
 * BR-2's skill-metadata-invalid case collapses to the SAME code path as BR-1's skill-does-not-exist
 * case here: by the time a role name is checked against `knownSkills`, an invalid-metadata skill has
 * already been excluded from that set by the skill catalog (`coding-agent/src/core/skills.ts`'s own
 * diagnostic-and-exclude behavior, ADR §3.3/§7) — from this module's point of view, "invalid
 * metadata" and "does not exist" are indistinguishable, and indistinguishable-on-purpose (a role
 * cannot use a skill's own bad frontmatter as a way to still reach it).
 */

export type ModelRole = "strategic" | "standard" | "lightweight";
export type RoleProvenanceSource = "builtin" | "user" | "project";

export interface RoleApprovalPolicy {
	/** TETO — nunca liga auto-aprovação por si (grant, R15). */
	autoApprove?: false;
	/** high/critical sempre confirmam, independente deste campo. */
	maxRiskTier?: "low" | "medium";
}

export interface ConductorRole {
	name: string;
	description: string;
	systemPrompt: string;
	model?: string;
	/** OBRIGATÓRIO (FR-20): nunca "undefined = tudo" — um teto sempre existe. */
	tools: string[];
	modelRole: ModelRole;
	skills: string[];
	canSpawn: string[];
	gates: number[];
	approvalPolicy?: RoleApprovalPolicy;
	source: RoleProvenanceSource;
	contentHash: string;
	filePath: string;
	area?: string;
}

/** BR-1/BR-2/T39: the only failure mode `buildRoleRegistry` recognizes today — a role naming a skill
 * that is not (or no longer) in the project's known-skill catalog. */
export interface RoleDiagnostic {
	kind: "unknown-skill";
	roleId: string;
	skill: string;
}

export interface RoleRegistry {
	/** Only roles that passed BR-1/BR-2 validation — an excluded role is simply absent here, never
	 * present with a hole where a skill should be. */
	roles: ReadonlyMap<string, ConductorRole>;
	diagnostics: readonly RoleDiagnostic[];
}

/**
 * Cross-checks every role in `roleSources` against `knownSkills` (BR-1/BR-2/R21/T39) and returns a
 * registry containing only the roles that passed — each rejected role produces a named diagnostic
 * instead of silently vanishing or silently loading with a missing skill. Roles are keyed by `name`;
 * `roleSources` is trusted to already reflect whatever split-trust merge (`resolveRoleGrants`, T37/R15)
 * applies to project-sourced roles — this function only checks skill referential integrity, not
 * provenance/trust (RoleTrustStore's job, a separate module).
 */
export function buildRoleRegistry(
	roleSources: ReadonlyArray<ConductorRole>,
	knownSkills: ReadonlySet<string>,
): RoleRegistry {
	throw new Error("not implemented");
}

export type ResolveRoleResult =
	| { status: "found"; role: ConductorRole }
	| { status: "not-found"; roleId: string; suggestion?: string };

/**
 * FR-1/FR-2: look up a role by id (name). An unknown id is never a generic silent session — it names
 * the role that was not found and, when a near match exists in the registry (a typo — e.g.
 * "backedn-engineer" vs. "backend-engineer"), suggests it. Behavior reference:
 * `conductor-main/tools/task.py:152-162` solves the same UX problem for a delegation target with
 * `difflib.get_close_matches`; this fase applies the same discipline to `--role`, not necessarily the
 * same algorithm (gate2-spec-fase3.md FR-2).
 */
export function resolveRole(registry: RoleRegistry, roleId: string): ResolveRoleResult {
	throw new Error("not implemented");
}

/** FR-3: the minimal fields `conductor roles list` needs per row — enough to answer "what role do I
 * use for X" without opening a session. */
export interface RoleListEntry {
	id: string;
	area?: string;
	modelRole: ModelRole;
	skills: readonly string[];
	gates: readonly number[];
}

export function listRoles(registry: RoleRegistry): RoleListEntry[] {
	throw new Error("not implemented");
}

/**
 * FR-20: a role's `tools` allowlist is a restriction ON TOP of the Permission Engine's own
 * fail-closed default-deny (`permission-engine.ts`'s `resolvePermissionLevel` — "no policy declared
 * for tool … — fail closed"), not a new/parallel mechanism. A tool absent from `role.tools` is
 * refused — this predicate is the pure decision; wiring it into the tool-call path is Gate 6.
 */
export function isToolAllowed(role: ConductorRole, toolName: string): boolean {
	throw new Error("not implemented");
}
