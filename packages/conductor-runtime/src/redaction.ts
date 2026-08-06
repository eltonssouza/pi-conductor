/**
 * Redaction pipeline -- the choke point for every one of the six closed sinks
 * (docs/adr/0003-fase2-security-architecture.md §6.2/§16; docs/conductor/gate3-addendum-fase2.md
 * T21/T22, R6; docs/conductor/gate2-spec-fase2.md FR-12/FR-13/FR-14/FR-15, BR-7/BR-12).
 *
 * GATE 5 (test-first): redactSecrets() and redactSessionEntryForPersistence() are STUBS that throw
 * "not implemented" -- Gate 6 implements the bodies. Wiring each of the six sinks to call these
 * functions (permission-gate.ts's notify/reason, fail-closed.ts's re-thrown reason, the audit trail
 * writer, conductor-cli's TUI transcript funnel, the session write-path handoff) is also Gate 6 --
 * several of those call sites belong to files explicitly out of this task's assigned scope
 * (command-classifier/permission-engine/audit-trail, owned by a parallel Gate 5 agent). This file
 * ships the shared redaction PRIMITIVE every one of those call sites will import; the tests below
 * exercise that primitive directly against sink-SHAPED input (a notify string, a fail-closed
 * reason, an audit entry field, a session-entry-like object) rather than against the not-yet-wired
 * call sites themselves -- proving the primitive's behavior is what Gate 6's wiring will need,
 * without this Gate 5 file reaching into a sibling agent's in-flight files to wire it prematurely.
 *
 * The six closed sinks (ADR §6.2, GAP-C's fix -- REDACTION_SINKS below turns "the enumeration is
 * closed and complete" into an assertable fact, not just a paragraph in a doc that could quietly
 * shrink):
 *   1. transcript   -- conductor-cli's live TUI/stdout transcript funnel (FR-13)
 *   2. notify        -- ctx.ui.notify(...) block-reason surfaced by permission-gate.ts (T21 item 5)
 *   3. sessionJsonl  -- the Pi SessionManager's persisted .jsonl (T22/GAP-E; see the companion
 *                       structural canary in test/session-redaction.regression.test.ts, R12c)
 *   4. auditTrail    -- the append-only audit-trail.ts writer (FR-12)
 *   5. rethrownError -- fail-closed.ts's `reason` string, which can embed the offending input (T21 item 6)
 *   6. sessionExport -- a future `session export` command; BR-7's guarantee applies the moment it
 *                       ships (gate2-spec-fase2.md §9 open question #4) -- not built in this fase,
 *                       so it is a documented `it.todo` in the test file, never silently dropped.
 */

import { redactSecrets as redactSecretsShared } from "@conductor/secrets";

export const REDACTION_SINKS = [
	"transcript",
	"notify",
	"sessionJsonl",
	"auditTrail",
	"rethrownError",
	"sessionExport",
] as const;

export type RedactionSink = (typeof REDACTION_SINKS)[number];

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
	 * SECRET_SCAN_FAILED_PLACEHOLDER. Unlike policy-trust-store.ts's `onError` (a mix of expected and
	 * unexpected causes), EVERY invocation here is worth signaling -- there is no "this matcher
	 * failure is normal operation" case for a secret scanner, so this fires on every fallback, not a
	 * filtered subset. This is the more sensitive of the two Gate 6 silent-catch findings: a
	 * redaction failure that nobody notices means a sink silently stops protecting secrets, so
	 * staying quiet here is the wrong default. An injected callback (rather than a hardcoded logger)
	 * keeps this shared primitive logging-library-agnostic -- Pragmatic Programming Practices --
	 * Complete Professional Guide §2.5, "depend on a tiny abstraction; logging changes don't touch
	 * logic" -- mirrored from permission-gate.ts's own `onDecision` hook. MUST NEVER throw on its own
	 * account: invoked inside its own try/catch, same discipline as `onDecision`. Never changes the
	 * fail-closed return value -- the placeholder is returned whether or not `onError` is provided or
	 * itself throws.
	 */
	onError?: (error: unknown) => void;
}

/**
 * Wraps @conductor/secrets' redactSecrets with the fail-closed guarantee ADR §6.1 requires of this
 * package specifically (conductor-config's own consumer of the same matcher package reacts by
 * throwing instead; this one reacts by masking -- see @conductor/secrets/src/matchers.ts's header
 * for why both share one matcher definition). If the underlying matcher throws for any reason, the
 * ORIGINAL text is never returned -- SECRET_SCAN_FAILED_PLACEHOLDER is, so a matcher bug degrades
 * to over-redaction (a sink shows less) rather than under-redaction (a secret leaks because the
 * scanner broke).
 */
export function redactSecrets(text: string, options: RedactionErrorOptions = {}): string {
	try {
		return redactSecretsShared(text);
	} catch (error) {
		try {
			options.onError?.(error);
		} catch {
			// Observability must never affect the fail-closed contract above (mirrors
			// permission-gate.ts's onDecision hook: a broken caller-supplied callback cannot be
			// allowed to propagate and change what this function returns).
		}
		return SECRET_SCAN_FAILED_PLACEHOLDER;
	}
}

/**
 * Deep-walk an arbitrary JSON-shaped value, redacting every string leaf via redactSecrets and
 * rebuilding every array/object level fresh (never mutating the input -- see this function's own
 * doc comment below for the caller-facing contract). Non-string/array/object primitives (number,
 * boolean, null, undefined) pass through unchanged; nothing here needs to know the difference
 * between a Message, a CustomMessage, and a BashExecutionMessage -- the transform is structural, not
 * type-specific, which is exactly what lets it sit at a single handoff point regardless of which
 * concrete message shape passes through it.
 */
function deepRedact(value: unknown, options: RedactionErrorOptions): unknown {
	if (typeof value === "string") return redactSecrets(value, options);
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

/**
 * The write-path redaction seam for sink #3 (session JSONL) -- ADR §6.3 / gate3-addendum-fase2.md
 * §9 T29/R12c: "the redaction runs at the ONE handoff Conductor->Pi we own (redact-before-handoff),
 * not spread across Pi's internal write points." This function is that handoff-side transform: it
 * deep-walks an arbitrary JSON-shaped value (a Message/ToolResultMessage-like object, or any nested
 * structure) and redacts every string field in place (returning a new value; never mutates its
 * input), so whatever the caller hands to `SessionManager.appendMessage()` next is already clean --
 * independent of how many internal write points the Pi SessionManager itself has, and independent
 * of whether a future Pi upgrade changes them (T29's exact regression scenario).
 *
 * This function is R12a's mechanism. R12c (the structural canary that proves R12a is actually wired
 * in, by asserting on the real persisted .jsonl file rather than on this function's return value) is
 * a SEPARATE, deliberately-decoupled test -- see test/session-redaction.regression.test.ts's header
 * for why a passing unit test of this function alone would not be sufficient evidence (Secure Code
 * Review §2.12, "a completed trace is evidence about that question and about nothing else," cited at
 * gate3-addendum-fase2.md §9 for exactly this reason).
 */
export function redactSessionEntryForPersistence<T>(entry: T, options: RedactionErrorOptions = {}): T {
	return deepRedact(entry, options) as T;
}
