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
 * FR-18/R9 (fail-closed-write): `appendAuditEntry` is synchronous and THROWS on I/O failure — never
 * swallowed. It deliberately does NOT invent its own fail-closed machinery: the existing
 * `evaluatePolicyFailClosed` envelope (fail-closed.ts, already wrapping `decideToolCall`) is the
 * only mechanism this needs — a write failure propagating out of `appendAuditEntry` through that
 * envelope denies the very operation that would have been audited, so nothing with a side effect
 * ever executes without leaving a trace.
 *
 * FR-17/T25 (the audit file is itself a protected path): `.conductor/audit.jsonl` is part of
 * `workspace-policy.ts`'s `defaultProtectedPaths()` list, symmetrically to `config.json`/
 * `policy.json` (T13) — this closes the write/edit half of T25; the `bash` half is the Command
 * Classifier's job (command-classifier.ts signal 8).
 *
 * `reason`/`egress.destination` are assumed ALREADY redacted by the time they reach this writer —
 * redaction is out of this stream's scope (see redaction.ts, owned in parallel); wiring the audit
 * sink into that pipeline is a follow-up gate.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

function isValidIsoTimestamp(value: string): boolean {
	return value.length > 0 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

/**
 * Opens (or lazily creates, on first write) the audit trail file at `filePath` for append-only
 * writing: `O_APPEND` semantics via Node's `"a"` flag (never truncates, never rewrites a prior
 * line), mode `0o600`, one JSON object per line (JSONL, NFR-3).
 *
 * Durable-on-return (R5/GAP-F): `appendFileSync` is synchronous — by the time this function
 * returns without throwing, the entry is already on disk, never buffered/fire-and-forget. A caller
 * that writes the Egress Event and only then performs the network call gets a real ordering
 * guarantee for free from this synchronous contract, not from a race.
 *
 * Residual (declared, not hidden — ADR §7/§11.2 R6): this is append-only and protected, not
 * cryptographically tamper-evident; an attacker with direct disk access outside the agent's loop
 * could still edit it. Crypto-integrity (hash-chain/signature) is explicitly a later phase
 * (ADR §11.2 R3). Atomicity of `O_APPEND` specifically on Windows is a named residual the ADR asks
 * to be tested explicitly before claiming NFR-2 on that OS (ADR §7, §11.2 R6) — not re-litigated
 * here.
 */
export function createAuditTrailWriter(filePath: string): AuditTrailWriter {
	return {
		appendAuditEntry(entry: AuditEntry): void {
			// Input validation (quality-baseline category 1): refuse to persist a record whose
			// timestamp is missing or unparsable rather than writing a security-relevant entry that
			// can never be correlated in an evidence trail (observability requirement, category 6).
			if (!isValidIsoTimestamp(entry.timestamp)) {
				throw new Error(
					"audit-trail: refusing to persist an entry with a missing/invalid ISO-8601 timestamp — fail closed",
				);
			}

			const line = `${JSON.stringify(entry)}\n`;
			// mkdirSync is itself part of the fail-closed contract here: if `dirname(filePath)`
			// exists as a non-directory (the disk-full/blocked-path scenario spec edge case #12
			// names), this throws synchronously and appendAuditEntry never reaches appendFileSync —
			// same "throw, don't swallow" discipline as the write itself.
			mkdirSync(dirname(filePath), { recursive: true });
			appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600, flag: "a" });
		},
	};
}
