/**
 * T11 (docs/conductor/gate3-fase1-addendum.md secure default 8): `.conductor/config.json` never
 * contains a raw secret -- only a reference (env var name / keychain id / provider+model id).
 * Enforced on the write path, before any filesystem write happens (see write-config.ts).
 *
 * GATE 6 (docs/adr/0003-fase2-security-architecture.md section 6.1, section 9 packaging table): the
 * matcher PRIMITIVES this module used to define locally (matchesKnownSecretPrefix, looksHighEntropy,
 * looksSecretShaped, isSensitiveFieldName, looksLikeEnvVarReference) now live in the zero-dependency
 * leaf package `@conductor/secrets`, imported here and re-exported unchanged so every existing
 * consumer of this module (config-summary.ts, write-config.ts, this package's own index.ts, and the
 * Fase 1 test suite) keeps working without a single call-site change. This module's own remaining
 * job is narrower and config-specific: `assertNoRawSecrets` (the throwing walk over an arbitrary
 * config object) and FREE_TEXT_ENTROPY_CHECKED_PATHS (which fields are "genuinely free text" enough
 * to run entropy detection against). `conductor-runtime`'s redaction.ts imports the SAME
 * `@conductor/secrets` primitives to mask rather than throw -- one shared definition of
 * "secret-shaped" for the whole monorepo, never two regex lists to keep in sync (ADR section 6.1;
 * the exact bug class this closes is gate3-fase1-addendum.md section 6.2's T11 word-boundary fix,
 * which would otherwise have to be applied twice).
 *
 * Two independent checks, both defense in depth against a different mistake:
 *   1. Field-name-based: ANY field (known schema field or not) whose name looks like it names a
 *      credential (apiKey, token, secret, password, credential, private key, ...) must hold an
 *      env-var-reference-shaped value (e.g. "ANTHROPIC_API_KEY"), never an arbitrary string. This
 *      is the literal case named in this gate's task: "a field literally named apiKey/token/secret
 *      ... with a string value rather than an envVar-style reference". Runs on every field,
 *      including ones outside the typed ConductorConfig schema -- a JSON.parse'd or hand-crafted
 *      object (e.g. from a `conductor config set` dot-path merge) is not bound by TypeScript's
 *      structural typing at runtime, so this check must not assume the schema's shape.
 *   2. Shape-based: a known secret/token prefix pattern (sk-, ghp_, AKIA, ...) is rejected
 *      wherever it appears (cheap, no false-positive risk); a long high-entropy string is rejected
 *      only in the schema's two genuinely free-text fields (provider.model, provider.thinkingLevel)
 *      -- not in path-like fields (project.evidence, workspace.additionalProtectedPaths), where a
 *      hash-shaped directory segment could otherwise be a plausible false positive.
 *
 * Grounding: the query run for this gate ("detecting secret-shaped or high-entropy credential
 * values in configuration before writing to disk", cdt library --gate 6) returned only generic
 * defensive-programming material (top score 0.577) -- Software Construction Practices - Complete
 * Professional Guide section 2.8 ("I validate untrusted input at boundaries... Bad data can't travel far
 * before being caught") grounds the *shape* of this module (validate at the boundary, fail before
 * any write), not the specific thresholds now owned by @conductor/secrets. No book in this
 * project's library corpus covers entropy-based secret scanning specifically -- reported honestly
 * rather than forced, the same treatment gate3-fase1-addendum.md itself gives T11/T16's uncovered
 * angles.
 */

import {
	isSensitiveFieldName,
	looksHighEntropy,
	looksLikeEnvVarReference,
	looksSecretShaped,
	matchesKnownSecretPrefix,
} from "@conductor/secrets";
import { ConfigValidationError } from "./errors.ts";

export {
	isSensitiveFieldName,
	looksHighEntropy,
	looksLikeEnvVarReference,
	looksSecretShaped,
	matchesKnownSecretPrefix,
};

/** Fields where a legitimate value is always a short, human-typed identifier -- never a long random blob. */
const FREE_TEXT_ENTROPY_CHECKED_PATHS = new Set(["provider.model", "provider.thinkingLevel"]);

/**
 * Walk `value` recursively and throw ConfigValidationError on the first field that looks like it
 * holds a raw secret (T11). Pure/read-only -- never mutates, never partially applies. Called
 * before any filesystem write in writeConfig().
 */
export function assertNoRawSecrets(value: unknown, pathPrefix = ""): void {
	if (value === null || typeof value !== "object") return;

	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoRawSecrets(item, `${pathPrefix}[${index}]`);
		}
		return;
	}

	for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;

		if (typeof fieldValue === "string") {
			if (isSensitiveFieldName(key) && !looksLikeEnvVarReference(fieldValue)) {
				throw new ConfigValidationError(
					`config field "${path}" is named like a credential ("${key}") but its value is not an ` +
						`environment-variable-style reference (e.g. "ANTHROPIC_API_KEY") -- refusing to write ` +
						`what may be a raw secret. Store only a reference to where the credential lives.`,
				);
			}
			if (matchesKnownSecretPrefix(fieldValue)) {
				throw new ConfigValidationError(
					`config field "${path}" looks like a raw API key/token (matches a known secret-prefix ` +
						`pattern) -- refusing to write it. .conductor/config.json may only hold references, ` +
						`never credential material.`,
				);
			}
			if (FREE_TEXT_ENTROPY_CHECKED_PATHS.has(path) && looksHighEntropy(fieldValue)) {
				throw new ConfigValidationError(
					`config field "${path}" looks like a high-entropy secret rather than a short identifier ` +
						`-- refusing to write it. Expected a short "provider/modelId"-style identifier.`,
				);
			}
		} else if (typeof fieldValue === "object" && fieldValue !== null) {
			assertNoRawSecrets(fieldValue, path);
		}
	}
}
