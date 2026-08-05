/**
 * `.conductor/policy.json` loader and merge (docs/adr/0003-fase2-security-architecture.md §5.1/§5.2/
 * §16; docs/conductor/gate3-addendum-fase2.md T18/T19, R3/R4; docs/conductor/gate2-spec-fase2.md
 * FR-9/FR-10/FR-11/FR-23/FR-24, BR-4/BR-5).
 *
 * GATE 5 (test-first): loadPolicyDocument() and mergePolicies() are STUBS that throw
 * "not implemented" -- Gate 6 implements the bodies. Once implemented, loadPolicyDocument MUST
 * NEVER throw (ADR §5.1's discriminated-union return type exists specifically so a caller can never
 * confuse "malformed" with "absent" -- FR-23 ≠ FR-24 at the type level, not just by convention).
 *
 * Packaging note (why both loadPolicyDocument AND mergePolicies live here, in conductor-config,
 * rather than split across conductor-config/conductor-runtime the way ADR 0003 §9's package table
 * lists them): this Gate 5 task was explicitly assigned "policy loader/merge" as one unit in
 * conductor-config, with the command-classifier/permission-engine/audit-trail trio assigned to a
 * parallel agent in conductor-runtime. Colocating loader+merge here does not reopen the ADR 0002
 * §3.1 invariant ("conductor-config and conductor-runtime continue to not depend on one another") --
 * EffectivePolicy (below) is plain, serializable data with no behavior; conductor-runtime's
 * command-classifier/permission-engine consume it as a value passed in by whichever package composes
 * both (conductor-cli, which already depends on both per its own package.json), never by importing
 * this module directly. The zero-edge invariant is therefore preserved by construction, not by
 * accident. Gate 6 confirms the final residency; this Gate 5 note exists so that confirmation starts
 * from a stated reason instead of rediscovering one.
 *
 * `TrustedPolicySource` in ADR §16's appendix is named but its shape is left unspecified (the
 * appendix shows only `sources: TrustedPolicySource[]` with no interface body). This Gate 5
 * completes it as `PolicySource` below: a discriminated union shaped exactly like `PolicyLoadResult`
 * (§5.1, already fully specified), tagged with `kind`. This is the minimal completion that lets
 * mergePolicies alone decide FR-23's `denyAllPrivileged` (ADR §16: "qualquer fonte invalid liga")
 * without a second pre-pass function the ADR never mentions -- an absent/invalid/loaded source, per
 * origin, is exactly the information mergePolicies needs and exactly the information
 * loadPolicyDocument already produces per source; tagging it with `kind` is the only addition.
 */

import type { PolicySourceKind, PolicyTrustStore } from "./policy-trust-store.ts";

export const POLICY_SCHEMA_VERSION = 1;

export interface PolicyAllowlistEntry {
	pattern: string;
	/** Teto rígido (ADR §5.2/§16): an allowlist grant may never reach high/critical -- ADR's own
	 * schema comment: "grant (teto ≤ medium, BR-8)". */
	risk: "low" | "medium";
}

export interface PolicyNetworkEntry {
	destination: string;
}

export interface PolicyDocument {
	schema: 1;
	/** Restriction (R3/R4): always honored, always unioned with the built-in defaults -- never conditional on trust. */
	protectedPaths?: string[];
	/** Grant (R3/R4): only honored for a trusted, matching contentHash -- see mergePolicies. */
	allowlist?: PolicyAllowlistEntry[];
	/** Grant (R3/R4): same trust gating as allowlist. */
	network?: PolicyNetworkEntry[];
}

/**
 * ADR §5.1: a discriminated union so a caller cannot conflate "malformed" (FR-23) with "absent"
 * (FR-24) -- the distinction is enforced by the type checker, not by a caller remembering to check
 * an error flag correctly.
 */
export type PolicyLoadResult =
	| { status: "absent" }
	| { status: "invalid"; reason: string }
	| { status: "loaded"; policy: PolicyDocument; contentHash: string };

/**
 * Load and structurally validate `.conductor/policy.json` at `filePath`. MUST NEVER throw:
 *   - file does not exist              -> { status: "absent" }                          (FR-24)
 *   - file is not valid JSON           -> { status: "invalid", reason }                  (FR-23, edge case #1)
 *   - JSON parses but fails the schema -> { status: "invalid", reason }, SAME as above    (FR-23, edge case #2 --
 *     a schema failure is NOT "ignore the bad field and continue")
 *   - well-formed                      -> { status: "loaded", policy, contentHash }, where
 *     contentHash is the sha256 hex digest of the raw file bytes, computed at this I/O boundary --
 *     the key trust-on-first-use in policy-trust-store.ts pins against (R3: same content -> same
 *     hash -> stays trusted; edited content -> different hash -> must be re-confirmed, never
 *     silently inherits the old grant).
 */
export function loadPolicyDocument(_filePath: string): PolicyLoadResult {
	throw new Error("not implemented");
}

/**
 * One policy source, tagged by trust-domain kind, in exactly the shape loadPolicyDocument already
 * produces per-file (see module header for why this completes ADR §16's unspecified
 * `TrustedPolicySource`).
 */
export type PolicySource =
	| { kind: PolicySourceKind; status: "absent" }
	| { kind: PolicySourceKind; status: "invalid"; reason: string }
	| { kind: PolicySourceKind; status: "loaded"; policy: PolicyDocument; contentHash: string };

export interface BuiltinPolicyDefaults {
	protectedPaths: string[];
}

export interface EffectivePolicy {
	/** union(defaults, every source's protectedPaths) -- unconditional, BR-5: only ever grows. */
	protectedPaths: string[];
	/** Trust-ordered intersection across sources (R4) -- see mergePolicies. */
	allowlist: PolicyAllowlistEntry[];
	network: PolicyNetworkEntry[];
	/** FR-23: true the instant ANY source has status "invalid" -- a bad source is never outvoted by good ones. */
	denyAllPrivileged: boolean;
}

/**
 * Merge builtin defaults with every policy source into one EffectivePolicy, per the asymmetric
 * semantics R3/R4 fix (docs/conductor/gate3-addendum-fase2.md T18/T19):
 *
 *   - Restrictions (protectedPaths) ALWAYS union, from every source regardless of trust --
 *     BR-5/FR-10: a source can only ever add a protected path, never remove a default one, and this
 *     holds even for an untrusted or never-approved source (restricting is always safe to honor
 *     unconditionally).
 *   - Grants (allowlist, network) only come from a source that is BOTH `status: "loaded"` AND
 *     `trustStore.isTrusted(kind, contentHash) === true`. An untrusted or unrecognized-hash source
 *     contributes ZERO grants -- not a smaller set, none.
 *   - Across multiple trusted sources, grants are a TRUST-ORDERED INTERSECTION, never a union: a
 *     `project` source (repo-authored, attacker-reachable per T18) can never grant something a
 *     `user-global` source does not also grant. This is the test the task's non-negotiable #1
 *     names directly: "a project-only grant is never, by itself, sufficient."
 *   - `denyAllPrivileged` is true the moment any source in `sources` has `status: "invalid"` (FR-23
 *     extended per ADR §16) -- a malformed source is never defeated by a majority of well-formed
 *     ones (ADR §5.2: "uma fonte ruim não é derrotada em votação por uma boa").
 */
export function mergePolicies(
	_builtinDefaults: BuiltinPolicyDefaults,
	_sources: PolicySource[],
	_trustStore: PolicyTrustStore,
): EffectivePolicy {
	throw new Error("not implemented");
}
