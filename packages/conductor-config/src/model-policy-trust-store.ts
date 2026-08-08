/**
 * ModelPolicyTrustStore -- the trust-on-first-use ledger for the "authority-carrying half" of a
 * project's model-routing policy (docs/adr/0008-fase7-model-routing-and-providers.md §8.2, D6; §16
 * TypeScript appendix's `@conductor/config` section: "Mesma FORMA de PolicyTrustStore
 * (policy-trust-store.ts:53-80). isTrusted NUNCA lança.").
 *
 * Why a SEPARATE store from `PolicyTrustStore` (policy-trust-store.ts), not a reused one: they pin
 * trust for two different documents with two different grant shapes. `PolicyTrustStore` splits
 * `.conductor/policy.json` into "project"/"user-global" trust domains (`PolicySourceKind`) because
 * that document's restrictions/grants distinction (ADR 0003 §5.2/§5.3) is per-SOURCE. A model policy's
 * authority-carrying half (D6 §8.2's table: downward gate-remap, an out-of-catalog provider, egress
 * elevation) is a property of the WHOLE document's content-hash, not of which of two sources produced
 * it -- there is exactly one `.conductor/config.json` `modelPolicy` section per project, so a `kind`
 * dimension would be a parameter nothing here ever varies. Same shape (content-hash keyed, fail-closed,
 * never throws), narrower argument list -- the ADR's own words for this: "mesma FORMA", not "mesmo
 * módulo, reused wholesale".
 *
 * On-disk shape (a JUDGMENT CALL this Gate 6 file owns, flagged per the test file's own header,
 * test/model-policy-trust-store.test.ts:8-20): the ADR §16 appendix declares only the public runtime
 * contract (`isTrusted(contentHash): boolean`, `loadModelPolicyTrustStore(filePath, options?)`), not an
 * on-disk document type. The smallest change that still satisfies "mesma forma" while matching the
 * single-argument `isTrusted` is `PolicyTrustStoreDocument` minus the `kind` dimension on each entry:
 * `{ schema: 1, trusted: [{ contentHash, grantedAt }] }`. If a future gate needs a `kind` split here
 * too (e.g. project vs. user-global model policy), widening `TrustEntry`/`isTrusted` is an additive
 * change to this module alone -- the public contract this Gate 5 already locked does not preclude it.
 *
 * R11 (gate3-addendum-fase2.md §9, restated here because this module is a second enforcement point of
 * the same binding rule, and D6/T73 (gate3-addendum-fase7.md) applies it to model-routing policy):
 *   (a) Read fail-closed: absent | invalid (corrupt JSON/schema) | hash-not-found all collapse to
 *       `isTrusted() === false`. Never throws. Never resolves to `true` by default. Losing the store
 *       (deleted, corrupted, unreadable) makes the session LESS permissive, never more -- "corrupting
 *       or deleting the TrustStore makes the session less permissive, never more" is the literal
 *       property gate3-addendum-fase7.md §8.2/T73 requires and this suite proves end-to-end.
 *   (b) Protected-path (nominal, by filename) -- wiring into `defaultProtectedPaths()` is
 *       `@conductor/runtime`'s job (ADR 0008 §4.2 D2's packaging table); this module only needs a
 *       stable, predictable filename for that wiring to name.
 *   (c) Pin informed -- the ceremony of granting trust (a future `conductor policy trust`-style
 *       command) must show the human the concrete grants being trusted before writing an entry here.
 *       This module does not perform that ceremony; it only stores and reads its result.
 *   (d) Residual declared -- no cryptographic tamper-evidence (parity with the audit trail's own
 *       declared residual, R9, and with `PolicyTrustStore`'s own R11d); an attacker with direct disk
 *       access outside the agent's loop can still edit this file. Not this module's job to close.
 *
 * *Grounding:* the ADR's own citations for D6/R54 (gate2-spec-fase7.md §8.2, ADR §8.1) are carried
 * forward rather than re-queried -- Security Engineering Principles §2.2/§2.12 (fail-closed,
 * secure-by-default) and Secure and Reliable Systems Design §3.3 (zero-trust: a stored grant is never
 * assumed valid without a matching content-hash) -- same discipline as policy-trust-store.ts's own
 * header ("citing the originating gate's grounding, not manufacturing a fresh query for a rule nothing
 * has changed about"). This Gate 6 session additionally confirmed the shape-mirroring judgment call
 * itself against the library (`cdt library "mirroring an existing trust store contract's shape for a
 * new narrower trust store..." --gate 6`, top 0.583, moderate: Outside-In Development §1.5 / Pragmatic
 * Programming Practices §1.12 "When not to eliminate a duplication" -- two stores that "encode
 * different rules" for two different documents are not the DRY violation that citation warns against
 * merging away; reported honestly as moderate, not forced).
 */

import { existsSync, readFileSync, statSync } from "node:fs";

export const MODEL_POLICY_TRUST_STORE_SCHEMA_VERSION = 1;

export interface ModelPolicyTrustEntry {
	/** sha256 hex digest of the raw modelPolicy content this entry was granted for. */
	contentHash: string;
	/** ISO-8601 UTC timestamp of when the human approved this content-hash. */
	grantedAt: string;
}

export interface ModelPolicyTrustStoreDocument {
	schema: 1;
	trusted: ModelPolicyTrustEntry[];
}

export interface ModelPolicyTrustStore {
	/**
	 * True only when `contentHash` has a matching, previously-granted entry. Every other outcome --
	 * store absent, store corrupt, hash simply not present -- returns `false`. MUST NEVER throw: a
	 * thrown exception a careless caller catches-and-treats-as-true would be exactly the fail-open T73
	 * warns against.
	 */
	isTrusted(contentHash: string): boolean;
}

export interface ModelPolicyTrustStoreOptions {
	/**
	 * Observability hook (Gate 6 quality-baseline categories 2/6: error handling + observability) --
	 * invoked ONLY for a read failure that is NOT one of R11a's intentional fail-closed cases (file
	 * absent, corrupted JSON, schema mismatch, hash-not-found are normal operation and stay silent). A
	 * genuinely unexpected failure (EACCES, a delete/replace race between the existence check and the
	 * actual read, ...) is surfaced here instead of vanishing into the same silent empty store as the
	 * expected cases. MUST NEVER throw on its own account: invoked inside its own try/catch, mirroring
	 * `PolicyTrustStoreOptions.onError`'s identical discipline. Never changes the fail-closed return
	 * value.
	 */
	onError?: (error: unknown) => void;
}

function isModelPolicyTrustEntry(value: unknown): value is ModelPolicyTrustEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return typeof entry.contentHash === "string" && typeof entry.grantedAt === "string";
}

function isModelPolicyTrustStoreDocument(value: unknown): value is ModelPolicyTrustStoreDocument {
	if (typeof value !== "object" || value === null) return false;
	const doc = value as Record<string, unknown>;
	return (
		doc.schema === MODEL_POLICY_TRUST_STORE_SCHEMA_VERSION &&
		Array.isArray(doc.trusted) &&
		doc.trusted.every(isModelPolicyTrustEntry)
	);
}

/**
 * Read every trusted entry from `filePath`, collapsing EVERY failure mode (missing file, invalid JSON,
 * schema mismatch, or any filesystem error) to an empty list rather than propagating -- a single
 * try/catch wraps the entire read+parse+validate sequence on purpose, mirroring
 * `policy-trust-store.ts`'s `readTrustedEntries` verbatim.
 */
function readModelPolicyTrustedEntries(filePath: string, onError?: (error: unknown) => void): ModelPolicyTrustEntry[] {
	try {
		if (!existsSync(filePath)) return [];
		if (!statSync(filePath).isFile()) return []; // a directory at this path -- fail closed, not an error
		const raw = readFileSync(filePath, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!isModelPolicyTrustStoreDocument(parsed)) return [];
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

/**
 * Load the trust-on-first-use ledger for a project's model-routing policy from `filePath`. Fail-closed
 * on every read path: a missing file, invalid JSON, a shape mismatch, or a filesystem error all
 * produce a `ModelPolicyTrustStore` whose `isTrusted()` always returns `false` -- never a thrown
 * exception, never a store that resolves to "trusted" for anything.
 */
export function loadModelPolicyTrustStore(
	filePath: string,
	options: ModelPolicyTrustStoreOptions = {},
): ModelPolicyTrustStore {
	const entries = readModelPolicyTrustedEntries(filePath, options.onError);
	return {
		isTrusted(contentHash: string): boolean {
			return entries.some((entry) => entry.contentHash === contentHash);
		},
	};
}
