/**
 * Audit Trail / Security Event Log (Fase 2, Gate 2 spec Grupo E / ADR 0003 §7 / gate3-addendum-fase2.md
 * T25, T26, R9).
 *
 * Persists every Permission Engine decision (allow or deny) to a local, append-only, protected
 * JSONL file — promoting `PermissionGateDecision`/`onDecision` (permission-gate.ts) from an
 * in-memory, best-effort hook (used only by the chat status line today) into a durable record.
 *
 * Also the home of the Network level's Egress Event (ADR §8, FR-7, R5/GAP-F): `AuditEntry.egress`
 * is written for a consented network operation, and — this is the binding part, not a detail —
 * that write must be durable BEFORE the network call it describes is allowed to proceed. "Pre-write,
 * not best-effort-after."
 *
 * Binding requirements this Gate-5 STUB exists to be tested against (Gate 6 implements them; ADR
 * 0003 §7):
 *   - FR-18/R9 (fail-closed-write): `appendAuditEntry` is synchronous-and-throwing on I/O failure —
 *     NOT swallowed. The existing `evaluatePolicyFailClosed` envelope (fail-closed.ts, already used
 *     to wrap `decideToolCall`) is the ONLY fail-closed machinery this needs; Gate 6 must not invent
 *     a second one. A write failure propagating out of `appendAuditEntry` through that envelope
 *     denies the very operation that would have been audited — no action with a side effect ever
 *     executes without leaving a trace.
 *   - FR-17/T25 (the audit file is itself a protected path): `.conductor/audit.jsonl` must be added
 *     to `workspace-policy.ts`'s `defaultProtectedPaths()` list, symmetrically to `config.json` /
 *     `policy.json` (T13). This file does not modify workspace-policy.ts (out of this stream's
 *     scope for Gate 5) — the failing test in audit-trail.test.ts calls the REAL, already-shipped
 *     `evaluateToolPath` directly to prove the gap exists today.
 *   - Durable-on-return (R5/GAP-F): once `appendAuditEntry` returns without throwing, the entry must
 *     already be on disk — never buffered/fire-and-forget — so a caller that writes the Egress Event
 *     and only then performs the network call gets a real ordering guarantee "for free" from this
 *     synchronous contract, not from a race.
 *
 * STUB (Gate 5 — test-first): `createAuditTrailWriter` returns a writer whose `appendAuditEntry` is
 * a no-op — it neither writes to disk NOR throws, for any input, including an unwritable path. This
 * is deliberately WRONG (not merely absent) so the tests fail RED for the right reasons:
 *   - FR-16 tests (assert the JSONL line actually lands on disk) fail because nothing was written.
 *   - FR-18 tests (assert a write failure denies the audited operation) fail because this stub never
 *     fails, even when the target path cannot possibly be written to — proving the fail-closed-write
 *     contract does not exist yet, which is exactly what FR-18 requires Gate 6 to build.
 */

import type { RiskTier } from "./command-classifier.ts";
import type { PermissionLevel } from "./permission-engine.ts";

export type ApprovalMethod = "human" | "yes-flag" | "allowlist" | "none";

export interface AuditEntry {
	/** ISO-8601 UTC timestamp of the decision. */
	timestamp: string;
	toolName: string;
	toolCallId: string;
	permissionLevel: PermissionLevel;
	/** Only meaningful for exec-level (bash) calls. */
	riskTier?: RiskTier;
	decision: "allow" | "deny";
	/** Already redacted by the time it reaches this writer (out of this stream's scope — see redaction.ts, owned in parallel). */
	reason?: string;
	yesFlagActive: boolean;
	/** FR-21/BR-11: must always be distinguishable — never collapse "yes-flag" into "human". */
	approvalMethod: ApprovalMethod;
	/** Present only for Network-level decisions (FR-7). */
	egress?: { destination: string };
}

export interface AuditTrailWriter {
	/** Synchronous; MUST throw on any I/O failure rather than swallow it (FR-18/R9). */
	appendAuditEntry(entry: AuditEntry): void;
}

/**
 * Opens (or lazily creates, on first write) the audit trail file at `filePath` for append-only
 * writing. The real implementation (Gate 6) opens with `O_APPEND`, mode `0o600`, one JSON object
 * per line (JSONL, NFR-3) — never truncates, never rewrites a prior line.
 *
 * STUB (Gate 5): returns a writer that performs no I/O and never throws (see file-level doc).
 */
export function createAuditTrailWriter(_filePath: string): AuditTrailWriter {
	return {
		appendAuditEntry: (_entry: AuditEntry) => {
			// Deliberately does nothing: no disk write, no validation, no throw. See file-level doc
			// for why a silent no-op is the more useful Gate-5 stub here than a thrown exception.
		},
	};
}
