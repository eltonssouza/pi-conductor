/**
 * Fail-closed wrapper + deep-walk over `matchers.ts`'s raw `redactSecrets` (docs/adr/0003-fase2-security-
 * architecture.md §6.1/§16; docs/conductor/gate3-addendum-fase2.md T21/T22, R6; docs/conductor/gate2-spec-
 * fase2.md FR-12/FR-13/FR-14/FR-15, BR-7/BR-12).
 *
 * MOVED HERE at Gate 8 of Fase 6 (docs/conductor/gate2-spec-fase2.md FR-20: "a redação usa redactSecrets
 * (@conductor/runtime), nunca uma segunda implementação... nunca um detector de segredo próprio e paralelo
 * do Diary"). Before this move, `@conductor/runtime/src/redaction.ts` owned this fail-closed wrapper +
 * deep-walk, and `@conductor/diary/src/journal-writer.ts` carried its OWN structural port of the same ~15
 * LOC (documented at the time as "duplicate the glue, never the matcher" -- a real trade-off, but the wrong
 * one: `@conductor/secrets` already exists as the zero-dependency leaf BOTH packages depend on directly,
 * exactly so shared glue like this never has to be duplicated at all, not just its security-critical half).
 * `@conductor/runtime` still owns `REDACTION_SINKS`/`RedactionSink` (governance: the closed sink enumeration
 * is that package's concern) and `redactSessionEntryForPersistence` (a thin, package-specific name over
 * `deepRedact` below); it now imports the three primitives from here instead of declaring them.
 *
 * Naming note: `matchers.ts` already exports a `redactSecrets` (the raw pattern matcher, no fallback --
 * `@conductor/config`'s own consumer of that name reacts to a matcher failure by throwing, not masking, so
 * that name's existing fail-open-on-success/throw-on-failure contract must not change). The wrapper below
 * needs a DIFFERENT name to avoid colliding with it inside this package's own module graph --
 * `redactSecretsOrPlaceholder` was chosen over alternatives like `safeRedactSecrets` because "safe" is
 * vague about what the fallback actually is, while "OrPlaceholder" names the exact fail-closed behavior
 * (ADR §6.1: "se o matcher lançar, devolve o placeholder, nunca o texto original") in the identifier itself.
 */

import { redactSecrets as redactSecretsShared } from "./matchers.ts";

/**
 * The literal fallback text ADR §6.1 specifies verbatim: "se o matcher lançar, devolve
 * `[REDACTED: secret-scan failed — content withheld]`, nunca o texto original" -- BR-1's
 * fail-closed discipline extended to the redaction step itself. A matcher failure must never be
 * treated as "nothing to redact, pass the text through unchanged."
 */
export const SECRET_SCAN_FAILED_PLACEHOLDER = "[REDACTED: secret-scan failed — content withheld]";

export interface RedactionErrorOptions {
	/**
	 * Observability hook (Gate 6 quality-baseline categories 2/6: error handling + observability):
	 * invoked when the underlying matcher throws and this function falls back to
	 * SECRET_SCAN_FAILED_PLACEHOLDER. There is no "this matcher failure is normal operation" case for
	 * a secret scanner, so this fires on every fallback, not a filtered subset. A redaction failure
	 * that nobody notices means a sink silently stops protecting secrets, so staying quiet here is the
	 * wrong default. An injected callback (rather than a hardcoded logger) keeps this shared primitive
	 * logging-library-agnostic. MUST NEVER throw on its own account: invoked inside its own try/catch.
	 * Never changes the fail-closed return value -- the placeholder is returned whether or not
	 * `onError` is provided or itself throws.
	 */
	onError?: (error: unknown) => void;
}

/**
 * Wraps `matchers.ts`'s raw `redactSecrets` with the fail-closed guarantee ADR §6.1 requires of every
 * sink-facing caller (conductor-config's own consumer of the same matcher reacts by throwing instead;
 * this one reacts by masking -- see matchers.ts's header for why both share one matcher definition). If
 * the underlying matcher throws for any reason, the ORIGINAL text is never returned --
 * SECRET_SCAN_FAILED_PLACEHOLDER is, so a matcher bug degrades to over-redaction (a sink shows less)
 * rather than under-redaction (a secret leaks because the scanner broke).
 */
export function redactSecretsOrPlaceholder(text: string, options: RedactionErrorOptions = {}): string {
	try {
		return redactSecretsShared(text);
	} catch (error) {
		try {
			options.onError?.(error);
		} catch {
			// Observability must never affect the fail-closed contract above.
		}
		return SECRET_SCAN_FAILED_PLACEHOLDER;
	}
}

/**
 * Deep-walk an arbitrary JSON-shaped value, redacting every string leaf via redactSecretsOrPlaceholder
 * and rebuilding every array/object level fresh (never mutating the input). Non-string/array/object
 * primitives (number, boolean, null, undefined) pass through unchanged; nothing here needs to know the
 * difference between a Message, a CustomMessage, a JournalEntry, or a BashExecutionMessage -- the
 * transform is structural, not type-specific, which is exactly what lets it sit at a single handoff
 * point regardless of which concrete shape passes through it (D8/§10.1's own reasoning for the Diary
 * sink, and ADR §6.2's for every sink before it: "never a spread-then-overwrite that redacts only one
 * named field and leaks the rest of a multi-field record").
 */
export function deepRedact(value: unknown, options: RedactionErrorOptions = {}): unknown {
	if (typeof value === "string") return redactSecretsOrPlaceholder(value, options);
	if (Array.isArray(value)) return value.map((item) => deepRedact(item, options));
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
			result[key] = deepRedact(fieldValue, options);
		}
		return result;
	}
	return value;
}
