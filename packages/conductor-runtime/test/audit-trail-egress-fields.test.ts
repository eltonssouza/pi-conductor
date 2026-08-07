/**
 * Test-first (Gate 5, Fase 5) for D10 (ADR 0006 §13.3/§19, `docs/adr/0006-fase5-library-and-
 * grounding.md`): `AuditEntry.egress` gains `resolvedIp?`/`payloadKind?` so the trail records the IP
 * actually connected to (not just the declared host string) and what kind of payload left the
 * machine.
 *
 * R38 (gate3-addendum-fase5.md §8, T57): `appendAuditEntry` is ALREADY fully implemented (Fase 2
 * Gate 6 landed) — but it reconstructs `egress` by SPREAD-THEN-OVERWRITE:
 *
 *     egress: entry.egress ? { destination: redactSecrets(entry.egress.destination) } : entry.egress,
 *
 * This rebuilds a brand-new object literal containing ONLY `destination` — any other field on
 * `entry.egress` (now including `resolvedIp`/`payloadKind`) is silently DISCARDED, never persisted and
 * never redacted. This is a REAL, pre-existing pattern this Gate 5 task's own assignment flagged
 * (gate3-addendum-fase5.md §8 T57) — the tests below drive the REAL, unmodified writer and fail RED
 * for exactly that reason, not because anything throws "not implemented".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry } from "../src/audit-trail.ts";
import { createAuditTrailWriter } from "../src/audit-trail.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

const FAKE_KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE";

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
		toolName: "doctor_library_ping",
		toolCallId: "call-1",
		permissionLevel: "network",
		decision: "allow",
		yesFlagActive: false,
		approvalMethod: "allowlist",
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

describe("AuditEntry.egress gains resolvedIp/payloadKind (D10 ADR 0006 §13.3/§19) — R38: no field is silently dropped by the writer's spread-then-overwrite reconstruction (T57)", () => {
	it("persists resolvedIp and payloadKind on the entry — FAILS today: appendAuditEntry rebuilds egress as { destination } only, discarding every other field (T57)", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(
			sampleEntry({
				egress: { destination: "library.internal:8080", resolvedIp: "10.0.0.5", payloadKind: "query-embedding" },
			}),
		);

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines[0]?.egress).toEqual({
			destination: "library.internal:8080",
			resolvedIp: "10.0.0.5",
			payloadKind: "query-embedding",
		});
	});

	it("redacts a secret-shaped resolvedIp value too — same independent-sink discipline as destination (R6/T21), defense in depth even though an IP is not itself a secret (ADR §13.3: 'a decisão merece confirmação, não presunção')", () => {
		const writer = createAuditTrailWriter(auditFilePath());
		writer.appendAuditEntry(
			sampleEntry({
				egress: { destination: "ok.example", resolvedIp: `10.0.0.5 leaked=${FAKE_KEY}`, payloadKind: "corpus-fetch" },
			}),
		);

		const lines = readJsonlLines(auditFilePath()) as AuditEntry[];
		expect(lines[0]?.egress?.resolvedIp).not.toContain(FAKE_KEY);
		expect(lines[0]?.egress?.resolvedIp).toContain("[REDACTED:");
	});
});
