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

/**
 * Find every secret-shaped span in `text` -- both known-prefix matches (wherever they start a
 * fresh token, not just when they are the whole string -- FR-14 / gate8-validation-fase1.md §6.2's
 * word-boundary fix, carried into this new call site) and high-entropy runs. Pure, total: must
 * never throw for a `string` input (redactSecrets in conductor-runtime depends on this never
 * throwing to decide whether its own fail-closed wrapper is even reachable -- see that module).
 */
export function findSecretSpans(_text: string, _options?: SecretMatchOptions): SecretSpan[] {
	throw new Error("not implemented");
}

/**
 * Mask every span `findSecretSpans` finds in `text` with a fixed, non-reversible placeholder
 * (BR-7). The untouched surrounding text (e.g. "anthropic/" in "anthropic/sk-ant-...") is left
 * legible -- FR-14's "the rest remains readable" half of the requirement, not just the masking half.
 */
export function redactSecrets(_text: string, _options?: RedactOptions): string {
	throw new Error("not implemented");
}

/** True if `value` (trimmed) is itself entirely secret-shaped, or contains a secret-shaped span. Convenience over findSecretSpans. */
export function looksSecretShaped(_value: string, _options?: SecretMatchOptions): boolean {
	throw new Error("not implemented");
}

/** True if `value` contains a known secret-prefix pattern (sk-ant-, ghp_, AKIA, ...) starting at a token boundary, wherever it appears. */
export function matchesKnownSecretPrefix(_value: string, _options?: SecretMatchOptions): boolean {
	throw new Error("not implemented");
}

/** True for a long string drawn from a hex/base64-ish charset with entropy above a secret-scanner-style threshold (FR-15: a Git SHA/UUID must not match). */
export function looksHighEntropy(_value: string): boolean {
	throw new Error("not implemented");
}

/** True if `fieldName` itself looks like it names a credential (apiKey, token, secret, password, ...). */
export function isSensitiveFieldName(_fieldName: string): boolean {
	throw new Error("not implemented");
}

/** True if `value` is shaped like an environment-variable reference (UPPER_SNAKE_CASE), i.e. a safe way to hold a credential *reference*, never the credential itself. */
export function looksLikeEnvVarReference(_value: string): boolean {
	throw new Error("not implemented");
}
