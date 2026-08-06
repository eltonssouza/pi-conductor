/**
 * Test-first (Gate 5) for the Audit Trail (Gate 2 spec Grupo E: FR-16, FR-17, FR-18, FR-21; ADR
 * 0003 §7/§8; gate3-addendum-fase2.md T25, T26, R9, R5/GAP-F).
 *
 * `createAuditTrailWriter` is currently a STUB whose `appendAuditEntry` is a no-op — it performs no
 * real I/O and never throws (see src/audit-trail.ts's file-level doc for why that shape, not a
 * thrown exception, is the more useful Gate-5 stub here: it lets FR-16 and FR-18 fail RED for
 * distinct, meaningful reasons instead of collapsing into "not implemented" for everything).
 *
 * One test in this file (the FR-17 one) deliberately calls the REAL, already-shipped
 * `evaluateToolPath` from workspace-policy.ts, with no stub involved at all — proving today's actual
 * gap (`.conductor/audit.jsonl` is not yet a protected path) rather than asserting against a stand-in.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry } from "../src/audit-trail.ts";
import { createAuditTrailWriter } from "../src/audit-trail.ts";
import { evaluatePolicyFailClosed } from "../src/fail-closed.ts";
import { evaluateToolPath } from "../src/workspace-policy.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function auditFilePath(): string {
	return join(workspace.root, ".conductor", "audit.jsonl");
}

function sampleEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		timestamp: new Date().toISOString(),
		toolName: "bash",
		toolCallId: "call-1",
		permissionLevel: "exec",
		riskTier: "high",
		decision: "deny",
		reason: "denied by policy",
		yesFlagActive: false,
		approvalMethod: "none",
		...overrides,
	};
}

function readJsonlLines(filePath: string): unknown[] {
	const raw = readFileSync(filePath, "utf8");
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

describe("audit-trail: FR-16 — every Permission Engine decision produces a durable entry with the minimum required fields", () => {
	it("persists a single entry to disk with timestamp/toolName/permissionLevel/decision/reason/yesFlagActive/approvalMethod", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(sampleEntry());

		const lines = readJsonlLines(auditFilePath());
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			toolName: "bash",
			permissionLevel: "exec",
			riskTier: "high",
			decision: "deny",
			reason: "denied by policy",
			yesFlagActive: false,
			approvalMethod: "none",
		});
		const timestamp = (lines[0] as AuditEntry).timestamp;
		expect(timestamp).toBeTruthy();
		expect(new Date(timestamp).toISOString()).toBe(timestamp);
	});

	it("NFR-2/NFR-3: appends multiple decisions as separate JSONL lines, in order, none overwritten (append-only, plain-text, no dedicated viewer needed)", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(sampleEntry({ toolCallId: "call-1", decision: "deny" }));
		writer.appendAuditEntry(sampleEntry({ toolCallId: "call-2", decision: "allow" }));
		writer.appendAuditEntry(sampleEntry({ toolCallId: "call-3", decision: "deny" }));

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines).toHaveLength(3);
		expect(lines.map((l) => l.toolCallId)).toEqual(["call-1", "call-2", "call-3"]);
	});

	it("FR-21/BR-11: approvalMethod 'yes-flag' is persisted distinctly from 'human' — never coalesced into an ambiguous value", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(
			sampleEntry({ toolCallId: "human-approved", decision: "allow", approvalMethod: "human" }),
		);
		writer.appendAuditEntry(
			sampleEntry({
				toolCallId: "yes-flag-approved",
				decision: "allow",
				approvalMethod: "yes-flag",
				yesFlagActive: true,
			}),
		);

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		const human = lines.find((l) => l.toolCallId === "human-approved");
		const yesFlag = lines.find((l) => l.toolCallId === "yes-flag-approved");
		expect(human?.approvalMethod).toBe("human");
		expect(yesFlag?.approvalMethod).toBe("yes-flag");
		expect(human?.approvalMethod).not.toBe(yesFlag?.approvalMethod);
	});

	it("FR-7: an Egress Event (network destination) is persisted on the entry", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(
			sampleEntry({
				toolName: "doctor_library_ping",
				permissionLevel: "network",
				riskTier: undefined,
				decision: "allow",
				approvalMethod: "allowlist",
				egress: { destination: "library.internal:8080" },
			}),
		);

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines[0]?.egress).toEqual({ destination: "library.internal:8080" });
	});
});

describe("audit-trail: quality-baseline categories 1/3 — appendAuditEntry rejects an entry whose timestamp is not a valid ISO-8601 string (fail-closed, R9's discipline extended to input validation)", () => {
	it("throws and never writes anything to disk for a timestamp that is not ISO-8601 at all", () => {
		const writer = createAuditTrailWriter(auditFilePath());

		expect(() => writer.appendAuditEntry(sampleEntry({ timestamp: "not-a-timestamp" }))).toThrow(
			/invalid ISO-8601 timestamp/,
		);
		expect(existsSync(auditFilePath())).toBe(false);
	});

	it("throws for an empty-string timestamp", () => {
		const writer = createAuditTrailWriter(auditFilePath());

		expect(() => writer.appendAuditEntry(sampleEntry({ timestamp: "" }))).toThrow(/invalid ISO-8601 timestamp/);
	});

	it("throws for a timestamp in a plausible-but-non-canonical date format (not the exact ISO-8601 round-trip isValidIsoTimestamp requires)", () => {
		const writer = createAuditTrailWriter(auditFilePath());

		// A common "looks like a date" shape that Date.parse accepts loosely but that does not
		// round-trip through `new Date(value).toISOString() === value` -- proves the check is the
		// stricter round-trip test, not merely "Date.parse doesn't throw".
		expect(() => writer.appendAuditEntry(sampleEntry({ timestamp: "2026-08-05" }))).toThrow(
			/invalid ISO-8601 timestamp/,
		);
	});

	it("accepts a genuine ISO-8601 UTC timestamp without throwing (control case — the rejection above is about the value, not about throwing on every call)", () => {
		const writer = createAuditTrailWriter(auditFilePath());

		expect(() => writer.appendAuditEntry(sampleEntry({ timestamp: "2026-08-05T00:00:00.000Z" }))).not.toThrow();
	});
});

describe("audit-trail: FR-17/T25 — the audit trail file is itself a protected path (proven against the REAL evaluateToolPath, no stub involved)", () => {
	it("denies a write to .conductor/audit.jsonl inside the workspace, symmetrically to config.json/policy.json (T13 extended to the audit trail)", () => {
		const result = evaluateToolPath(join(".conductor", "audit.jsonl"), { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies it even before the file exists (protection must not require the target to already be on disk, same discipline as ~/.ssh)", () => {
		expect(existsSync(auditFilePath())).toBe(false);
		const result = evaluateToolPath(join(".conductor", "audit.jsonl"), { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
	});
});

describe("audit-trail: FR-18/R9 (requirement #6) — a write failure in appendAuditEntry denies the operation it would have audited, not silently permits it", () => {
	it("propagates a write failure as a throw, so the SAME evaluatePolicyFailClosed envelope the gate already uses converts it into a deny — no new fail-closed machinery needed", async () => {
		// Force a real, unrecoverable write failure: the parent path segment is a FILE, not a
		// directory, so any attempt to create/append "audit.jsonl" underneath it must fail (ENOTDIR),
		// simulating the disk-full/ACL-restricted scenario named in spec edge case #12.
		const blockerFile = join(workspace.root, ".conductor-blocker-file");
		writeFileSync(blockerFile, "i am a file, not a directory");
		const unwritablePath = join(blockerFile, "audit.jsonl");

		const writer = createAuditTrailWriter(unwritablePath);
		const decision = await evaluatePolicyFailClosed(() => {
			// The operation this write would have audited: it must NOT be allowed to "execute" (here,
			// return an allow decision) if the audit write itself fails.
			writer.appendAuditEntry(sampleEntry({ decision: "allow" }));
			return { block: false };
		});

		expect(decision.block).toBe(true);
		expect(decision.reason).toContain("policy evaluation error — fail closed");
	});

	it("never silently returns as if the write succeeded when the target path cannot possibly be written to", () => {
		const blockerFile = join(workspace.root, ".conductor-blocker-file-2");
		writeFileSync(blockerFile, "i am a file, not a directory");
		const unwritablePath = join(blockerFile, "audit.jsonl");
		const writer = createAuditTrailWriter(unwritablePath);

		expect(() => writer.appendAuditEntry(sampleEntry())).toThrow();
	});
});

describe("audit-trail: R5/GAP-F (requirement #7) — the Egress Event is durable BEFORE the network call it describes is allowed to proceed", () => {
	it("appendAuditEntry is durable synchronously on return (no buffering/fire-and-forget), so a caller can safely write-then-call and get a real ordering guarantee", () => {
		const writer = createAuditTrailWriter(auditFilePath());

		writer.appendAuditEntry(
			sampleEntry({
				toolName: "doctor_library_ping",
				permissionLevel: "network",
				riskTier: undefined,
				decision: "allow",
				approvalMethod: "allowlist",
				egress: { destination: "library.internal:8080" },
			}),
		);

		// Read back immediately, with no delay/flush/await between the write call returning and this
		// read: if appendAuditEntry were fire-and-forget or internally buffered, this could race and
		// find nothing. The contract under test is "durable ON RETURN", not "eventually durable".
		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines).toHaveLength(1);
		expect(lines[0]?.egress).toEqual({ destination: "library.internal:8080" });
	});

	it("a caller following write-then-call never observes the call happening before the write is durable", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		const observedOrder: string[] = [];

		function performConsentedNetworkCall(destination: string): void {
			// This is the ordering contract Gate 6's network call-site MUST follow (R5/GAP-F:
			// "pre-write, not best-effort-after"): record the Egress Event, and only once that has
			// returned (proven durable by the assertion below) is the call itself considered to have
			// happened.
			writer.appendAuditEntry(sampleEntry({ toolName: "doctor_library_ping", egress: { destination } }));
			observedOrder.push("egress-recorded");

			// The write must already be on disk at this point — checked before "performing" the call.
			expect(readJsonlLines(auditFilePath())).toHaveLength(1);

			observedOrder.push("network-call-performed");
		}

		performConsentedNetworkCall("library.internal:8080");
		expect(observedOrder).toEqual(["egress-recorded", "network-call-performed"]);
	});
});

/**
 * FR-12 / T21 sink #4 / R6 (gate2-spec-fase2.md Grupo D; gate3-addendum-fase2.md T21; ADR 0003 §6.2
 * sink #4): "cada um redige independente" -- this module's own header currently documents `reason`/
 * `egress.destination` as "assumed ALREADY redacted by the time they reach this writer", i.e. this
 * writer relies entirely on its caller to have redacted first. That is exactly the single-point-of-
 * failure R6 was written to rule out for the OTHER five sinks (each of which redacts at its own
 * boundary, never assuming an upstream caller already did). Gate 8 (this session) closes the same gap
 * here: appendAuditEntry redacts reason/egress.destination itself, in addition to (not instead of)
 * whatever an eventual caller does -- so a persisted audit entry can never carry a raw secret even if
 * the call site that builds AuditEntry forgets to.
 */
describe("audit-trail: FR-12/T21 sink #4 — appendAuditEntry redacts reason/egress.destination independently, defense-in-depth", () => {
	it("masks a secret-shaped value embedded in `reason` before persisting, even though the caller passed it in raw", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(
			sampleEntry({ reason: "denied: found ANTHROPIC_API_KEY=sk-ant-api03-FAKEFAKEFAKEFAKEFAKE in command" }),
		);

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines[0]?.reason).not.toContain("sk-ant-api03-FAKEFAKEFAKEFAKEFAKE");
		expect(lines[0]?.reason).toContain("[REDACTED:");
		expect(lines[0]?.reason).toContain("ANTHROPIC_API_KEY=");
	});

	it("masks a secret-shaped value embedded in `egress.destination` before persisting", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(
			sampleEntry({
				permissionLevel: "network",
				egress: { destination: "https://user:sk-ant-api03-FAKEFAKEFAKEFAKEFAKE@evil.example" },
			}),
		);

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines[0]?.egress?.destination).not.toContain("sk-ant-api03-FAKEFAKEFAKEFAKEFAKE");
		expect(lines[0]?.egress?.destination).toContain("[REDACTED:");
	});

	it("leaves an ordinary, non-secret reason untouched (no over-redaction)", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(sampleEntry({ reason: "denied by policy" }));

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines[0]?.reason).toBe("denied by policy");
	});
});
