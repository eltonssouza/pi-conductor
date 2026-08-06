/**
 * Secret-shape matchers and redaction (docs/adr/0003-fase2-security-architecture.md §6.1, §16
 * appendix; docs/conductor/gate3-addendum-fase2.md T21/T22, R6).
 *
 * GATE 5 (test-first): every export below is a STUB that throws "not implemented" -- this file
 * exists so the tests in test/matchers.test.ts have a real signature to import and can fail RED
 * for the right reason (missing behavior), not a missing module. Gate 6 implements the bodies.
 * Once implemented, these functions must never throw for well-formed string input (matching the
 * "nunca lança" discipline the ADR gives every I/O-adjacent boundary in this fase) -- the interim
 * throw here is Gate-5-only scaffolding, not the intended runtime contract.
 *
 * Why this package exists (ADR §6.1, the packaging decision this fase's ADR spent the most words
 * on): conductor-runtime cannot depend on conductor-config (would violate the ADR 0002 §3.1 graph:
 * "conductor-config, conductor-project and conductor-runtime deliberately do not depend on one
 * another"), but conductor-config's secret-detection.ts (Fase 1, assert+throw) and this fase's
 * redaction pipeline (conductor-runtime, mask) need the identical notion of "what looks like a
 * secret" -- diverging regexes between the two would silently reopen exactly the class of bug
 * gate3-fase1-addendum.md §6.2 (T11) already fixed once (a prefix pattern anchored differently in
 * one copy than the other). Extracting the pure matchers to this zero-dependency leaf package,
 * imported by both, means there is exactly one definition of "secret-shaped" in the whole
 * monorepo -- ADR §6.1: "isso garante que a redação nunca diverge do que o Secret Scanner
 * considera secret-shaped (sem lista de padrões para desalinhar)". *Grounding:* Architecture
 * Boundaries and the Dependency Rule §1.1/§1.12 ("dependencies point inward, toward the volatile
 * detail... a second real consumer is what makes an extraction paid-for, not speculative") --
 * cited directly in ADR §6.1 (top 0.614/0.620 in that gate's session) for exactly this extraction;
 * re-applied here rather than re-queried, since the architectural decision itself was already made
 * and grounded at Gate 4 -- this Gate 5 file only derives the tests a test-first flow requires
 * from a decision that already carries its own citation.
 *
 * Matcher patterns and entropy thresholds are carried over unchanged from
 * conductor-config/src/secret-detection.ts (Fase 1, T11 + the gate8-validation-fase1.md §6.2
 * word-boundary fix) -- this package does not redefine what "secret-shaped" means, it relocates
 * the existing, already-validated definition so a second consumer (conductor-runtime) can share it
 * without duplicating the regex list. conductor-config's own secret-detection.ts is left untouched
 * by this Gate 5 change (migrating it to import from here is Gate 6 scope, out of this task's
 * assigned surface) -- so its existing Fase 1 tests keep passing unmodified throughout Gate 5/6.
 */

export interface SecretSpan {
	/** Index of the first character of the match within the input string (inclusive). */
	start: number;
	/** Index one past the last character of the match (exclusive) -- text.slice(start, end) is the match. */
	end: number;
	kind: "known-prefix" | "high-entropy";
	/** Short, stable label identifying what matched (e.g. "anthropic-api-key", "high-entropy"). Never the matched value itself. */
	label: string;
}

interface KnownPrefixPattern {
	/** Never carries the "g" flag here -- matchesKnownSecretPrefix uses these directly with `.test()`,
	 * and a "g"-flagged RegExp's mutable `lastIndex` would make repeated `.test()` calls on different
	 * inputs order-dependent (a classic footgun). findSecretSpans below builds its own fresh,
	 * separately-scoped "g"-flagged clone per scan instead of reusing these. */
	pattern: RegExp;
	label: string;
}

/**
 * Carried over unchanged from conductor-config/src/secret-detection.ts (Fase 1, T11 + the
 * gate8-validation-fase1.md §6.2 word-boundary fix) -- see this file's header for why this package,
 * not that one, is now the source of truth. Ordered most-specific-first: `sk-ant-` is listed before
 * the generic `sk-` so an Anthropic key is labeled precisely even though both patterns match the
 * identical byte range for it (findSecretSpans below dedupes by exact [start,end) range and keeps
 * whichever label was found first).
 */
const KNOWN_SECRET_PREFIX_PATTERNS: KnownPrefixPattern[] = [
	{ pattern: /\bsk-ant-[A-Za-z0-9_-]{10,}/, label: "anthropic-api-key" }, // Anthropic
	{ pattern: /\bsk-[A-Za-z0-9_-]{10,}/, label: "api-key" }, // OpenAI-style / generic
	{ pattern: /\bghp_[A-Za-z0-9]{20,}/, label: "github-pat" }, // GitHub PAT (classic)
	{ pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/, label: "github-pat" }, // GitHub PAT (fine-grained)
	{ pattern: /\bgho_[A-Za-z0-9]{20,}/, label: "github-oauth-token" }, // GitHub OAuth
	{ pattern: /\bglpat-[A-Za-z0-9_-]{15,}/, label: "gitlab-pat" }, // GitLab PAT
	{ pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, label: "slack-token" }, // Slack
	{ pattern: /\bAKIA[A-Z0-9]{12,}/, label: "aws-access-key-id" }, // AWS access key id
	{ pattern: /\bASIA[A-Z0-9]{12,}/, label: "aws-sts-session-key" }, // AWS STS session key
	{ pattern: /\bAIza[A-Za-z0-9_-]{20,}/, label: "google-api-key" }, // Google API key
	{ pattern: /\bya29\.[A-Za-z0-9_-]{10,}/, label: "google-oauth-token" }, // Google OAuth access token
	{ pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private-key" }, // PEM private key block
];

const SENSITIVE_FIELD_NAME_PATTERN = /(api[-_]?key|token|secret|passwd|password|credential|private[-_]?key)/i;
const ENV_VAR_REFERENCE_SHAPE = /^[A-Z][A-Z0-9_]*$/;
const MIN_ENTROPY_CHECK_LENGTH = 20;
const HEX_CHARSET = /^[0-9a-fA-F]+$/;
const BASE64ISH_CHARSET = /^[A-Za-z0-9+/_=.-]+$/;
const HEX_ENTROPY_THRESHOLD_BITS_PER_CHAR = 3.0;
// Tuned to 4.4 (not the trufflehog/gitleaks family's typical ~4.0), carried over unchanged from
// conductor-config/src/secret-detection.ts -- see that module's header for the measured samples
// that motivated the gap between ordinary "provider/modelId" identifiers and genuine secrets.
const BASE64ISH_ENTROPY_THRESHOLD_BITS_PER_CHAR = 4.4;

/**
 * Canonical content-hash digest lengths, hex-encoded: MD5=32, SHA-1=40, SHA-256=64. A pure-hex run
 * at exactly one of these lengths is treated as a content-addressed identifier (a commit SHA, a
 * checksum) rather than a secret -- FR-15's binding example names this directly: "a Git commit SHA
 * (40 hex chars) must not be treated as a secret" (gate2-spec-fase2.md §5 Grupo D edge case #8).
 *
 * This is a LENGTH exemption, not a laxer entropy threshold, and the distinction matters: measured
 * directly for this gate (`node -e` Shannon-entropy check against a 40-char SHA-1-shaped fixture),
 * a genuine, well-distributed Git SHA lands at ~3.96 bits/char -- ABOVE conductor-config's own
 * HEX_ENTROPY_THRESHOLD_BITS_PER_CHAR (3.0), and statistically indistinguishable from an arbitrary
 * same-length high-entropy hex blob (a cryptographic hash IS high-entropy by construction; that
 * a git SHA is a hash and not a secret is exactly what makes it high-entropy too). Fase 1's
 * secret-detection.ts never had a test asserting a *real* 40-char SHA-1-length fixture returns
 * false -- its own passing "long, high-entropy hex string" test fixture is 47 characters, a length
 * outside this set, so the two behaviors do not conflict: length is the only signal available to
 * discriminate "this is a well-known hash shape" from "this is an arbitrary hex blob", since entropy
 * alone cannot. A real credential is essentially never expressed as bare, prefix-less,
 * exactly-32/40/64-char lowercase hex (genuine API keys/tokens are either prefixed, per
 * KNOWN_SECRET_PREFIX_PATTERNS above, or base64/mixed-charset-shaped, per BASE64ISH_CHARSET below) --
 * an engineering call, not a library citation (the library has no chapter on secret-vs-hash-digest
 * disambiguation specifically, same honest-gap treatment this module's other thresholds already get).
 */
const KNOWN_HASH_HEX_LENGTHS = new Set([32, 40, 64]);

function resolveAdditionalPatterns(options?: SecretMatchOptions): KnownPrefixPattern[] {
	return (options?.additionalKnownPrefixes ?? []).map((pattern) => ({
		// Rebuilt without any flags the caller's RegExp happened to carry (in particular "g"), for the
		// same lastIndex-statefulness reason the built-in patterns above never carry "g" either.
		pattern: new RegExp(pattern.source),
		label: "custom-prefix",
	}));
}

function allKnownPrefixPatterns(options?: SecretMatchOptions): KnownPrefixPattern[] {
	const additional = resolveAdditionalPatterns(options);
	return additional.length === 0 ? KNOWN_SECRET_PREFIX_PATTERNS : [...KNOWN_SECRET_PREFIX_PATTERNS, ...additional];
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

export interface SecretMatchOptions {
	/**
	 * Extra known-secret-prefix patterns to check in addition to the built-in set (e.g. a
	 * project-specific internal token format). Not specified by ADR §16's appendix (which shows
	 * `options?: SecretMatchOptions` without expanding the type) -- this shape is this Gate 5's
	 * minimal, additive completion: it extends the built-in set, it never lets a caller narrow or
	 * disable it (that would let a caller quietly weaken detection, the same asymmetry
	 * BR-1/fail-closed already applies everywhere else in this fase).
	 */
	additionalKnownPrefixes?: RegExp[];
}

export interface RedactOptions {
	/**
	 * Builds the placeholder text for a matched span, given its label. Defaults to
	 * `[REDACTED:${label}]` (the exact shape FR-12's example uses: "[REDACTED:api-key]"). Not
	 * specified by ADR §16's appendix beyond the example string -- inferred here as the minimal
	 * knob a caller needs (e.g. a sink with a different placeholder convention) without weakening
	 * BR-7 ("substituído por um placeholder fixo... não é reversível a partir do sink redigido"):
	 * the function receives only the label, never the matched value, so no implementation of this
	 * hook can accidentally leak the secret back into the placeholder.
	 */
	placeholder?: (label: string) => string;
}

/** True if `value` contains a known secret-prefix pattern (sk-ant-, ghp_, AKIA, ...) starting at a token boundary, wherever it appears. */
export function matchesKnownSecretPrefix(value: string, options?: SecretMatchOptions): boolean {
	const trimmed = value.trim();
	return allKnownPrefixPatterns(options).some(({ pattern }) => pattern.test(trimmed));
}

/** True if `fieldName` itself looks like it names a credential (apiKey, token, secret, password, ...). */
export function isSensitiveFieldName(fieldName: string): boolean {
	return SENSITIVE_FIELD_NAME_PATTERN.test(fieldName);
}

/** True if `value` is shaped like an environment-variable reference (UPPER_SNAKE_CASE), i.e. a safe way to hold a credential *reference*, never the credential itself. */
export function looksLikeEnvVarReference(value: string): boolean {
	return ENV_VAR_REFERENCE_SHAPE.test(value);
}

/** True for a long string drawn from a hex/base64-ish charset with entropy above a secret-scanner-style threshold (FR-15: a Git SHA/UUID must not match). */
export function looksHighEntropy(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length < MIN_ENTROPY_CHECK_LENGTH) return false;
	if (HEX_CHARSET.test(trimmed)) {
		// FR-15: a well-known hash-digest length is never flagged, regardless of measured entropy --
		// see KNOWN_HASH_HEX_LENGTHS's own comment for why entropy alone cannot make this distinction.
		if (KNOWN_HASH_HEX_LENGTHS.has(trimmed.length)) return false;
		return shannonEntropyBitsPerChar(trimmed) >= HEX_ENTROPY_THRESHOLD_BITS_PER_CHAR;
	}
	if (BASE64ISH_CHARSET.test(trimmed)) {
		return shannonEntropyBitsPerChar(trimmed) >= BASE64ISH_ENTROPY_THRESHOLD_BITS_PER_CHAR;
	}
	return false;
}

/** True if `value` (trimmed) is itself entirely secret-shaped, or contains a secret-shaped span. Convenience over findSecretSpans. */
export function looksSecretShaped(value: string, options?: SecretMatchOptions): boolean {
	if (value.trim().length === 0) return false;
	return findSecretSpans(value, options).length > 0;
}

/**
 * Find every secret-shaped span in `text` -- both known-prefix matches (wherever they start a
 * fresh token, not just when they are the whole string -- FR-14 / gate8-validation-fase1.md §6.2's
 * word-boundary fix, carried into this new call site) and high-entropy runs. Pure, total: must
 * never throw for a `string` input (redactSecrets in conductor-runtime depends on this never
 * throwing to decide whether its own fail-closed wrapper is even reachable -- see that module).
 */
export function findSecretSpans(text: string, options?: SecretMatchOptions): SecretSpan[] {
	const spans: SecretSpan[] = [];
	const seenRanges = new Set<string>();

	for (const { pattern, label } of allKnownPrefixPatterns(options)) {
		// A fresh "g"-flagged clone per pattern per call -- never reuse a shared global RegExp across
		// calls/patterns, whose mutable lastIndex would make results order- and call-history-dependent.
		const globalPattern = new RegExp(pattern.source, "g");
		let match: RegExpExecArray | null = globalPattern.exec(text);
		while (match !== null) {
			const start = match.index;
			const end = start + match[0].length;
			const key = `${start}:${end}`;
			if (!seenRanges.has(key)) {
				seenRanges.add(key);
				spans.push({ start, end, kind: "known-prefix", label });
			}
			if (match[0].length === 0) globalPattern.lastIndex += 1; // guard: no built-in pattern matches empty, but stay total for a custom one that might
			match = globalPattern.exec(text);
		}
	}

	// High-entropy runs: tokenize the whole text into maximal contiguous stretches of the
	// base64ish/hex superset charset, then test each candidate token with looksHighEntropy. A
	// candidate that overlaps an already-found known-prefix span is skipped -- known-prefix
	// identification takes precedence so the same secret is never reported twice under two kinds.
	const tokenPattern = /[A-Za-z0-9+/_=.-]+/g;
	let tokenMatch: RegExpExecArray | null = tokenPattern.exec(text);
	while (tokenMatch !== null) {
		const token = tokenMatch[0];
		const start = tokenMatch.index;
		const end = start + token.length;
		if (token.length >= MIN_ENTROPY_CHECK_LENGTH && looksHighEntropy(token)) {
			const overlapsKnownPrefix = spans.some((span) => start < span.end && end > span.start);
			if (!overlapsKnownPrefix) {
				spans.push({ start, end, kind: "high-entropy", label: "high-entropy" });
			}
		}
		tokenMatch = tokenPattern.exec(text);
	}

	spans.sort((a, b) => a.start - b.start || a.end - b.end);
	return spans;
}

/**
 * Mask every span `findSecretSpans` finds in `text` with a fixed, non-reversible placeholder
 * (BR-7). The untouched surrounding text (e.g. "anthropic/" in "anthropic/sk-ant-...") is left
 * legible -- FR-14's "the rest remains readable" half of the requirement, not just the masking half.
 */
export function redactSecrets(text: string, options?: RedactOptions): string {
	const spans = findSecretSpans(text);
	if (spans.length === 0) return text;

	const placeholder = options?.placeholder ?? ((label: string) => `[REDACTED:${label}]`);
	let result = "";
	let cursor = 0;
	for (const span of spans) {
		result += text.slice(cursor, span.start);
		result += placeholder(span.label);
		cursor = span.end;
	}
	result += text.slice(cursor);
	return result;
}
