/**
 * PolicyTrustStore -- the trust-on-first-use ledger for `.conductor/policy.json` grants
 * (docs/adr/0003-fase2-security-architecture.md §5.3/§16; docs/conductor/gate3-addendum-fase2.md
 * T28, R11).
 *
 * GATE 5 (test-first): loadPolicyTrustStore() is a STUB that throws "not implemented" -- Gate 6
 * implements the body. Once implemented, it (and the PolicyTrustStore it returns) MUST NEVER throw
 * at runtime and MUST NEVER default to "trusted" -- the interim throw here is Gate-5-only
 * scaffolding, the opposite of the eventual contract, same as every other stub in this fase's
 * assigned scope.
 *
 * Why this exists (T28, the fronteira nova the Gate 3 reconciliation confirmed): a `policy.json`
 * that arrives inside a cloned repository is a file an attacker can author (T18). Splitting its
 * semantics into restrictions (always honored, ADR §5.2) and grants (auto-approve, network
 * consent, tier downgrade -- only honored once a human has approved them out-of-band) closes the
 * write side of that vector, but the approval itself has to be *remembered* somewhere durable, or
 * the human would be re-prompted every session (friction that itself becomes a security failure --
 * Security Engineering Principles §2.2, cited in the ADR's own §5.3: friction that's too high makes
 * users approve everything). That memory -- "which policy.json content-hash has a human already
 * seen and approved" -- is this store. Persisting it on disk is itself an attack surface (T28): a
 * store that resolves "I can't read my own memory" to "trusted anyway" would silently reopen T18
 * through a different door. R11 below is what keeps that door shut.
 *
 * R11 (gate3-addendum-fase2.md §9, binding, restated here verbatim because this module IS the
 * enforcement point):
 *   (a) Read fail-closed: absent | invalid (corrupt JSON/schema) | hash-not-found all collapse to
 *       `isTrusted() === false`. Never throws. Never resolves to `true` by default. Losing the
 *       ledger (deleted, corrupted, unreadable) makes the session LESS permissive, never more --
 *       the same fail-closed direction as BR-1/BR-9 applied to a new store instead of a decision.
 *   (b) Protected-path (nominal, by filename) -- wiring into defaultProtectedPaths() belongs to
 *       whichever package owns that list (conductor-runtime/workspace-policy.ts); this module only
 *       needs to exist under a stable, predictable filename for that wiring to name.
 *   (c) Pin informed -- the *cerimônia* of granting trust (a future `conductor policy trust`
 *       command, out of this Gate 5's assigned scope) must show the human the concrete grants
 *       being trusted before writing an entry here. This module does not perform that ceremony; it
 *       only stores and reads its result.
 *   (d) Residual declared -- no cryptographic tamper-evidence in this fase (parity with the audit
 *       trail's own declared residual, R9); an attacker with direct disk access outside the agent's
 *       loop can still edit this file. Not this module's job to close -- Fase 4.
 *
 * *Grounding:* Secure and Reliable Systems Design §3.12/§3.13 ("the reachable authority has never
 * been enumerated"; "require multi-party authorization for sensitive actions" -- the informed pin
 * IS the second party) and Security Engineering Principles §2.9/§2.2 ("errors/uncertainty deny
 * access"; secure-by-default) -- both already cited for R11 at gate3-addendum-fase2.md §9, carried
 * here rather than re-queried since the grounding decision was already made at that gate; this
 * Gate 5 file only derives the tests a test-first flow requires from a rule that already has its
 * citation on record (CLAUDE.md Gate protocol step 2 is satisfied by citing the originating gate's
 * grounding, not by manufacturing a fresh query for a rule nothing has changed about).
 */

export type PolicySourceKind = "project" | "user-global";

export const POLICY_TRUST_STORE_SCHEMA_VERSION = 1;

export interface TrustEntry {
	kind: PolicySourceKind;
	/** sha256 hex digest of the raw policy.json content this entry was granted for (see policy-loader.ts's contentHash). */
	contentHash: string;
	/** ISO-8601 UTC timestamp of when the human approved this content-hash (T28's "pin informado", part c). */
	grantedAt: string;
}

export interface PolicyTrustStoreDocument {
	schema: 1;
	trusted: TrustEntry[];
}

export interface PolicyTrustStore {
	/**
	 * True only when `contentHash` has a matching, previously-granted entry for `kind`. Every other
	 * outcome -- store absent, store corrupt, hash simply not present -- returns `false`. MUST NEVER
	 * throw (R11a): a thrown exception a careless caller catches-and-treats-as-true would be exactly
	 * the fail-open T28 warns against.
	 */
	isTrusted(kind: PolicySourceKind, contentHash: string): boolean;
}

/**
 * Load the trust-on-first-use ledger from `filePath`. Fail-closed on every read path (R11a): a
 * missing file, a file that is not valid JSON, a file that does not match PolicyTrustStoreDocument's
 * shape, or a filesystem error (permission denied, path is a directory, ...) all produce a
 * PolicyTrustStore whose isTrusted() always returns false -- never a thrown exception, never a
 * store that resolves to "trusted" for anything.
 */
export function loadPolicyTrustStore(_filePath: string): PolicyTrustStore {
	throw new Error("not implemented");
}
