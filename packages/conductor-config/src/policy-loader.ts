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

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidAllowlist(value: unknown): value is PolicyAllowlistEntry[] {
	if (!Array.isArray(value)) return false;
	return value.every(
		(item) =>
			isPlainObject(item) && typeof item.pattern === "string" && (item.risk === "low" || item.risk === "medium"),
	);
}

function isValidNetwork(value: unknown): value is PolicyNetworkEntry[] {
	if (!Array.isArray(value)) return false;
	return value.every((item) => isPlainObject(item) && typeof item.destination === "string");
}

/**
 * Structural + shape validation of a parsed policy.json body. Returns null for anything that does
 * not match -- the SAME treatment JSON.parse failure gets (edge case #2: "ignore the bad field and
 * continue" is never an option), so the caller (loadPolicyDocument) can map both failure kinds to
 * the identical `{ status: "invalid" }` outcome.
 */
function validatePolicyDocument(value: unknown): PolicyDocument | null {
	if (!isPlainObject(value)) return null;
	if (value.schema !== POLICY_SCHEMA_VERSION) return null;
	if (value.protectedPaths !== undefined && !isStringArray(value.protectedPaths)) return null;
	if (value.allowlist !== undefined && !isValidAllowlist(value.allowlist)) return null;
	if (value.network !== undefined && !isValidNetwork(value.network)) return null;

	const policy: PolicyDocument = { schema: 1 };
	if (value.protectedPaths !== undefined) policy.protectedPaths = value.protectedPaths as string[];
	if (value.allowlist !== undefined) policy.allowlist = value.allowlist as PolicyAllowlistEntry[];
	if (value.network !== undefined) policy.network = value.network as PolicyNetworkEntry[];
	return policy;
}

export function loadPolicyDocument(filePath: string): PolicyLoadResult {
	try {
		if (!existsSync(filePath)) return { status: "absent" };
		if (!statSync(filePath).isFile()) {
			return { status: "invalid", reason: `${filePath} is not a regular file` };
		}

		const raw = readFileSync(filePath); // raw bytes -- contentHash is computed over these, not over a re-serialized/normalized form
		const contentHash = createHash("sha256").update(raw).digest("hex");

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw.toString("utf-8"));
		} catch (error) {
			return { status: "invalid", reason: `malformed JSON: ${(error as Error).message}` };
		}

		const policy = validatePolicyDocument(parsed);
		if (!policy) {
			return { status: "invalid", reason: "policy.json does not match the expected schema" };
		}

		return { status: "loaded", policy, contentHash };
	} catch (error) {
		// Any unexpected I/O error (permission denied, race between existsSync and readFileSync, ...)
		// is treated as "invalid" rather than propagated -- loadPolicyDocument MUST NEVER throw.
		return { status: "invalid", reason: `unexpected error reading policy.json: ${(error as Error).message}` };
	}
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
/**
 * Trust-ordered intersection across every trusted, loaded source's grant list (R4): an item survives
 * only if it appears (by `keyFn`) in EVERY list. Zero contributing lists (no trusted source at all)
 * intersects to the empty set, not "no restriction" -- a grant needs at least one trusted source, and
 * with zero of them there is nothing to grant. `keyFn` decides equality (structural, not reference)
 * so a caller/test doing a deep-equal comparison sees plain-object entries, not survivors of a
 * Set-of-objects identity check. Order of `lists` does not affect which items survive (set
 * intersection is order-independent by definition) -- only surrounding narrative language ("project
 * can never grant beyond user-global") depends on trust order, not this function's arithmetic.
 */
function intersectTrustOrdered<T>(lists: T[][], keyFn: (item: T) => string): T[] {
	if (lists.length === 0) return [];
	const [first, ...rest] = lists;
	return first.filter((item) => {
		const key = keyFn(item);
		return rest.every((list) => list.some((candidate) => keyFn(candidate) === key));
	});
}

export function mergePolicies(
	builtinDefaults: BuiltinPolicyDefaults,
	sources: PolicySource[],
	trustStore: PolicyTrustStore,
): EffectivePolicy {
	const protectedPaths = new Set<string>(builtinDefaults.protectedPaths);
	const trustedAllowlists: PolicyAllowlistEntry[][] = [];
	const trustedNetworks: PolicyNetworkEntry[][] = [];
	let denyAllPrivileged = false;

	for (const source of sources) {
		if (source.status === "invalid") {
			// FR-23/ADR: a bad source is never outvoted by a majority of good ones -- this flag, once
			// true, stays true regardless of what other sources in this same call say.
			denyAllPrivileged = true;
			continue;
		}
		if (source.status === "absent") {
			continue; // FR-24: absent is not an error condition, and contributes neither restrictions nor grants.
		}

		// source.status === "loaded" from here on.
		// Restrictions ALWAYS union, unconditional on trust (BR-5/FR-10) -- see this function's own
		// doc comment above for why an untrusted/never-approved source still restricts.
		for (const path of source.policy.protectedPaths ?? []) {
			protectedPaths.add(path);
		}

		// Grants require BOTH loaded AND trusted-by-exact-contentHash (R3/T18) -- an untrusted source
		// contributes NOTHING to the intersection below, not an empty list standing in for "no grants"
		// (pushing an empty list would zero out every other source's grants too, which is wrong: the
		// intersection is only over sources that actually got to vote).
		if (trustStore.isTrusted(source.kind, source.contentHash)) {
			trustedAllowlists.push(source.policy.allowlist ?? []);
			trustedNetworks.push(source.policy.network ?? []);
		}
	}

	return {
		protectedPaths: Array.from(protectedPaths),
		allowlist: intersectTrustOrdered(trustedAllowlists, (entry) => `${entry.pattern} ${entry.risk}`),
		network: intersectTrustOrdered(trustedNetworks, (entry) => entry.destination),
		denyAllPrivileged,
	};
}
