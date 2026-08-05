/**
 * T11 (docs/conductor/gate3-fase1-addendum.md secure default 8): `.conductor/config.json` never
 * contains a raw secret -- only a reference (env var name / keychain id / provider+model id).
 * Enforced on the write path, before any filesystem write happens (see write-config.ts).
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
 * Professional Guide §2.8 ("I validate untrusted input at boundaries... Bad data can't travel far
 * before being caught") grounds the *shape* of this module (validate at the boundary, fail before
 * any write), not the specific thresholds below. No book in this project's library corpus covers
 * entropy-based secret scanning specifically -- reported honestly rather than forced, the same
 * treatment gate3-fase1-addendum.md itself gives T11/T16's uncovered angles. The thresholds mirror
 * the well-known trufflehog/gitleaks entropy-scanner family (hex charset >= 3.0 bits/char,
 * base64-ish charset threshold tuned up from the family's typical ~4.0 to 4.4 bits/char, minimum
 * length 20 before entropy is even considered) -- a named industry convention, not a library
 * citation, and a deliberately narrow design call: it is scoped to the two free-text provider
 * fields specifically to avoid flagging ordinary path-like strings (see
 * FREE_TEXT_ENTROPY_CHECKED_PATHS below). The 4.4 tuning is itself evidence-based, not guessed: a
 * sample of realistic "provider/modelId"-shaped identifiers measured 3.4-4.26 bits/char (e.g.
 * "anthropic/claude-sonnet-5-20260101" at 4.256), while genuine secret-shaped samples (a base64
 * blob, a GitHub PAT body) measured 4.8-5.2 -- 4.4 sits in the gap with margin on both sides.
 */

import { ConfigValidationError } from "./errors.ts";

const KNOWN_SECRET_PREFIX_PATTERNS: RegExp[] = [
	/^sk-ant-[A-Za-z0-9_-]{10,}$/, // Anthropic
	/^sk-[A-Za-z0-9_-]{10,}$/, // OpenAI-style
	/^ghp_[A-Za-z0-9]{20,}$/, // GitHub PAT (classic)
	/^github_pat_[A-Za-z0-9_]{20,}$/, // GitHub PAT (fine-grained)
	/^gho_[A-Za-z0-9]{20,}$/, // GitHub OAuth
	/^glpat-[A-Za-z0-9_-]{15,}$/, // GitLab PAT
	/^xox[baprs]-[A-Za-z0-9-]{10,}$/, // Slack
	/^AKIA[A-Z0-9]{12,}$/, // AWS access key id
	/^ASIA[A-Z0-9]{12,}$/, // AWS STS session key
	/^AIza[A-Za-z0-9_-]{20,}$/, // Google API key
	/^ya29\.[A-Za-z0-9_-]{10,}$/, // Google OAuth access token
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key block
];

const SENSITIVE_FIELD_NAME_PATTERN = /(api[-_]?key|token|secret|passwd|password|credential|private[-_]?key)/i;
const ENV_VAR_REFERENCE_SHAPE = /^[A-Z][A-Z0-9_]*$/;
const MIN_ENTROPY_CHECK_LENGTH = 20;
const HEX_CHARSET = /^[0-9a-fA-F]+$/;
const BASE64ISH_CHARSET = /^[A-Za-z0-9+/_=.-]+$/;
const HEX_ENTROPY_THRESHOLD_BITS_PER_CHAR = 3.0;
// Tuned to 4.4 (not the trufflehog/gitleaks family's typical ~4.0) because this threshold is
// applied to real "provider/modelId" identifiers, not arbitrary strings -- see the module header
// comment for the measured samples that motivated the gap.
const BASE64ISH_ENTROPY_THRESHOLD_BITS_PER_CHAR = 4.4;

/** Fields where a legitimate value is always a short, human-typed identifier -- never a long random blob. */
const FREE_TEXT_ENTROPY_CHECKED_PATHS = new Set(["provider.model", "provider.thinkingLevel"]);

export function matchesKnownSecretPrefix(value: string): boolean {
	const trimmed = value.trim();
	return KNOWN_SECRET_PREFIX_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isSensitiveFieldName(fieldName: string): boolean {
	return SENSITIVE_FIELD_NAME_PATTERN.test(fieldName);
}

export function looksLikeEnvVarReference(value: string): boolean {
	return ENV_VAR_REFERENCE_SHAPE.test(value);
}

function shannonEntropyBitsPerChar(value: string): number {
	const counts = new Map<string, number>();
	for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
	let entropy = 0;
	for (const count of counts.values()) {
		const p = count / value.length;
		entropy -= p * Math.log2(p);
	}
	return entropy;
}

/** True for a long string drawn from a hex/base64-ish charset with entropy above a secret-scanner-style threshold. */
export function looksHighEntropy(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length < MIN_ENTROPY_CHECK_LENGTH) return false;
	if (HEX_CHARSET.test(trimmed)) return shannonEntropyBitsPerChar(trimmed) >= HEX_ENTROPY_THRESHOLD_BITS_PER_CHAR;
	if (BASE64ISH_CHARSET.test(trimmed)) {
		return shannonEntropyBitsPerChar(trimmed) >= BASE64ISH_ENTROPY_THRESHOLD_BITS_PER_CHAR;
	}
	return false;
}

export function looksSecretShaped(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	return matchesKnownSecretPrefix(trimmed) || looksHighEntropy(trimmed);
}

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
