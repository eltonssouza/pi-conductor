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
 * `reason`/`egress.destination` are redacted INSIDE `appendAuditEntry` itself (Gate 8 fix, T21 sink
 * #4 / R6: "cada um redige independente" — this sink must not rely on an upstream caller to have
 * redacted first, the same discipline every other closed sink already applies). A caller that ALSO
 * redacts before constructing the `AuditEntry` is fine — `redactSecrets` is idempotent on its own
 * placeholder output — but this writer never assumes it.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RiskTier } from "./command-classifier.ts";
import type { PermissionLevel } from "./permission-engine.ts";
import { redactSecrets } from "./redaction.ts";

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
	/** Present only for Network-level decisions (FR-7). ADR 0006 §13.3/D10 (Fase 5) extends this with
	 * `resolvedIp`/`payloadKind` so the trail records the IP actually connected to (not just the
	 * declared host) and what kind of payload left the machine — never the code-index's own vectors
	 * (D10 §13.4: those never leave regardless of this field). GATE 5 (test-first, Fase 5): a pure
	 * type addition — `appendAuditEntry` below is NOT yet updated to carry these fields through (it
	 * still reconstructs `egress` as `{ destination }` only, T57's own spread-then-overwrite finding);
	 * test/audit-trail-egress-fields.test.ts drives the REAL, unmodified writer and fails RED for
	 * exactly that reason. */
	egress?: { destination: string; resolvedIp?: string; payloadKind?: "query-embedding" | "corpus-fetch" };
}

export interface AuditTrailWriter {
	/** Synchronous; MUST throw on any I/O failure rather than swallow it (FR-18/R9). */
	appendAuditEntry(entry: AuditEntry): void;
}

/**
 * A security-detection event (Fase 5 loop-back, R37/T56 — gate3-addendum-fase5.md §8.3/§8.4). Distinct
 * from a `PermissionGateDecision`-derived `AuditEntry`: this records a durable, escalated DENY for an
 * artifact whose mere presence is an attack indicator — a `.conductor/library` index/ledger found UNDER
 * a workspace, which no legitimate build of this tool writes there after D7/D9 (its detection is by
 * PATH ALONE, never opening the file). Modeled as the ADR §8.4-sanctioned "evento-irmão": a separate
 * JSONL shape discriminated by `kind: "security-detection"` on the SAME `.conductor/audit.jsonl`,
 * carried by `appendSecurityEvent` below — ZERO change to `AuditEntry`/`appendAuditEntry`, so every
 * existing tool-decision entry (which has no `kind`) and its tests are untouched.
 */
export interface SecurityDetectionEntry {
	/** ISO-8601 UTC timestamp of the detection. */
	timestamp: string;
	/** Closed union — the kind of artifact detected (extend consciously, never a free string). */
	event: "repo-supplied-library-artifact";
	/** The detected artifact path — redacted at THIS sink independently of the caller (R6/R38). */
	path: string;
	/** Closed union — this class of finding is always HIGH (R37). */
	severity: "high";
	/** R37: recorded as a security DENY, the same disposition the Permission Engine audits its denies with. */
	decision: "deny";
}

/**
 * Appends one `SecurityDetectionEntry` to the append-only audit trail at `filePath`, discriminated by
 * `kind: "security-detection"`. Same fail-closed discipline as `createAuditTrailWriter`'s
 * `appendAuditEntry` (R9/FR-18): validates the timestamp, then `mkdir`+`appendFileSync` (mode `0o600`,
 * `flag: "a"` — never truncates, never rewrites a prior line) so the record is durable on return, and
 * ANY I/O failure (a `filePath` that is a directory, a blocked parent, a full disk) propagates straight
 * out rather than being swallowed. `path` passes through this sink's OWN `redactSecrets` (R6/R38: every
 * persisted string field is scrubbed here without presuming the upstream did it — a no-op on a
 * well-formed path, defense in depth against a future mispopulate); `event`/`severity`/`decision` are
 * closed unions that cannot carry a secret and are written as-is.
 */
export function appendSecurityEvent(filePath: string, entry: SecurityDetectionEntry): void {
	if (!isValidIsoTimestamp(entry.timestamp)) {
		throw new Error(
			"audit-trail: refusing to persist a security event with a missing/invalid ISO-8601 timestamp — fail closed",
		);
	}
	const record = {
		kind: "security-detection" as const,
		timestamp: entry.timestamp,
		event: entry.event,
		path: redactSecrets(entry.path),
		severity: entry.severity,
		decision: entry.decision,
	};
	const line = `${JSON.stringify(record)}\n`;
	// mkdirSync is part of the fail-closed contract (same as appendAuditEntry): a non-directory parent
	// throws synchronously here and the append is never reached.
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600, flag: "a" });
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

			// T21 sink #4 / R6 (Gate 8 fix): redact reason/egress.destination HERE, at this sink's own
			// boundary, rather than trusting a caller upstream to have done it — the same
			// "redact-at-each-sink-independently" discipline transcript.ts (FR-13) and
			// permission-gate.ts's notify call (T21 sink #2) already apply. Idempotent against an
			// already-redacted string (a `[REDACTED:label]` placeholder does not itself look
			// secret-shaped), so a caller that also redacts upstream is harmless, never double-damaged.
			const redactedEntry: AuditEntry = {
				...entry,
				reason: entry.reason !== undefined ? redactSecrets(entry.reason) : entry.reason,
				// D10/T57 fix: preserve resolvedIp/payloadKind instead of the old spread-then-overwrite
				// reconstruction that silently discarded both. resolvedIp gets the same independent-sink
				// redaction as destination (R6: "cada sink redige independente"); payloadKind is a closed
				// enum, never free text, so it needs no redaction. Each field is OMITTED (never written as
				// `undefined`) when absent on the input, matching every other optional field in this writer.
				egress: entry.egress
					? {
							destination: redactSecrets(entry.egress.destination),
							...(entry.egress.resolvedIp !== undefined
								? { resolvedIp: redactSecrets(entry.egress.resolvedIp) }
								: {}),
							...(entry.egress.payloadKind !== undefined ? { payloadKind: entry.egress.payloadKind } : {}),
						}
					: entry.egress,
			};

			const line = `${JSON.stringify(redactedEntry)}\n`;
			// mkdirSync is itself part of the fail-closed contract here: if `dirname(filePath)`
			// exists as a non-directory (the disk-full/blocked-path scenario spec edge case #12
			// names), this throws synchronously and appendAuditEntry never reaches appendFileSync —
			// same "throw, don't swallow" discipline as the write itself.
			mkdirSync(dirname(filePath), { recursive: true });
			appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600, flag: "a" });
		},
	};
}
