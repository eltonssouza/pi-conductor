/**
 * Redaction pipeline -- the choke point for every one of the eight closed sinks
 * (docs/adr/0003-fase2-security-architecture.md §6.2/§16; docs/conductor/gate3-addendum-fase2.md
 * T21/T22, R6; docs/conductor/gate2-spec-fase2.md FR-12/FR-13/FR-14/FR-15, BR-7/BR-12; sink #7
 * "codeIndex" added at Fase 5 D6 §9.1, ADR 0006 §19; sink #8 "diary" added at Fase 6 D8 §10.1,
 * ADR 0007 §12.4/§16).
 *
 * GATE 8 UPDATE (Fase 6 FR-20: "a redação usa redactSecrets (@conductor/runtime), nunca uma segunda
 * implementação... nunca um detector de segredo próprio e paralelo do Diary"): the fail-closed wrapper
 * (`redactSecrets`), the placeholder constant (`SECRET_SCAN_FAILED_PLACEHOLDER`), and the deep-walk
 * (`deepRedact`) that used to be DECLARED in this file now live in `@conductor/secrets` (as
 * `redactSecretsOrPlaceholder`/`SECRET_SCAN_FAILED_PLACEHOLDER`/`deepRedact` -- see that package's
 * `deep-redact.ts` for the full history and the naming rationale) and are re-exported/re-used from here
 * unchanged, byte-for-byte identical behavior. This file now owns only what is genuinely specific to
 * this package: `REDACTION_SINKS`/`RedactionSink` (the closed sink enumeration is runtime's own
 * governance concern) and `redactSessionEntryForPersistence` (a thin, package-specific name over the
 * shared `deepRedact`, kept here because sink #3's write-path handoff contract -- see its own doc
 * comment below -- is specific to this package, not to the shared primitive). `@conductor/diary`'s
 * `journal-writer.ts` (sink #8) now imports the SAME shared `deepRedact` directly from
 * `@conductor/secrets`, closing the divergence that existed before this Gate 8 pass (a local structural
 * port of this file's own `deepRedact`, duplicated rather than shared).
 *
 * The eight closed sinks (ADR §6.2, GAP-C's fix -- REDACTION_SINKS below turns "the enumeration is
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
 *   7. codeIndex     -- the code-aware index (Fase 5, D6 §9.1): redaction runs BEFORE chunk/embed/
 *                       upsert, never after -- a secret embedded before redaction stays recoverable by
 *                       semantic similarity even once the displayed text is masked.
 *   8. diary         -- the Diary (Fase 6, D8 §10.1): every write, manual (`journal add`) AND
 *                       automatic capture (D5), deep-redacts every leaf string before it ever touches
 *                       disk -- same reasoning as sessionJsonl/codeIndex above, applied to the
 *                       diary's own entries.jsonl/index.sqlite.
 */

import {
	deepRedact,
	type RedactionErrorOptions,
	redactSecretsOrPlaceholder,
	SECRET_SCAN_FAILED_PLACEHOLDER,
} from "@conductor/secrets";

export type { RedactionErrorOptions };
export { SECRET_SCAN_FAILED_PLACEHOLDER };

export const REDACTION_SINKS = [
	"transcript",
	"notify",
	"sessionJsonl",
	"auditTrail",
	"rethrownError",
	"sessionExport",
	"codeIndex",
	"diary",
] as const;

export type RedactionSink = (typeof REDACTION_SINKS)[number];

/**
 * Re-exported unchanged from `@conductor/secrets` (see this file's header, GATE 8 UPDATE): the
 * fail-closed wrapper around the shared matcher, kept under this package's existing public name
 * (`redactSecrets`) so every current call site in this package -- and every external consumer
 * importing it from `@conductor/runtime` -- keeps working without a signature or behavior change.
 */
export const redactSecrets = redactSecretsOrPlaceholder;

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
