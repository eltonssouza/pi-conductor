/**
 * Gate 9 (T56/R37, gate3-addendum-fase5.md §8.3): a repo-supplied `.conductor/library` artifact found
 * under a workspace has no legitimate producer after D7/D9 — its detection is a SECURITY EVENT that must
 * be recorded in the append-only audit trail as a `deny`, escalated HIGH (never a neutral note). This
 * is the "evento-irmão" the ADR §8.4 sanctions: a sibling append function on the SAME `.conductor/
 * audit.jsonl`, reusing the writer's own fail-closed + per-sink redaction discipline (R6/R9/R38) with
 * ZERO change to `AuditEntry`/`appendAuditEntry`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSecurityEvent } from "../src/audit-trail.ts";
import { redactSecrets } from "../src/redaction.ts";

const scratch: string[] = [];
function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "poc-secevent-"));
	scratch.push(dir);
	return dir;
}
afterEach(() => {
	while (scratch.length > 0) {
		const dir = scratch.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("appendSecurityEvent (R37: durable, append-only security deny event)", () => {
	it("persists a security-detection deny entry with severity HIGH and the detected path", () => {
		const dir = scratchDir();
		const auditPath = join(dir, ".conductor", "audit.jsonl");

		appendSecurityEvent(auditPath, {
			timestamp: "2026-08-07T10:00:00.000Z",
			event: "repo-supplied-library-artifact",
			path: "/repo/.conductor/library",
			severity: "high",
			decision: "deny",
		});

		const line = readFileSync(auditPath, "utf8").trim();
		const parsed = JSON.parse(line);
		expect(parsed.kind).toBe("security-detection");
		expect(parsed.event).toBe("repo-supplied-library-artifact");
		expect(parsed.severity).toBe("high");
		expect(parsed.decision).toBe("deny");
		expect(parsed.path).toBe("/repo/.conductor/library");
		expect(parsed.timestamp).toBe("2026-08-07T10:00:00.000Z");
	});

	it("appends (never truncates) — a prior tool-decision line and a later security event coexist", () => {
		const dir = scratchDir();
		const auditPath = join(dir, ".conductor", "audit.jsonl");
		appendSecurityEvent(auditPath, {
			timestamp: "2026-08-07T10:00:00.000Z",
			event: "repo-supplied-library-artifact",
			path: "/a",
			severity: "high",
			decision: "deny",
		});
		appendSecurityEvent(auditPath, {
			timestamp: "2026-08-07T10:01:00.000Z",
			event: "repo-supplied-library-artifact",
			path: "/b",
			severity: "high",
			decision: "deny",
		});
		const lines = readFileSync(auditPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
	});

	it("R38/R6: the path field passes THROUGH this sink's own redactor (independent of the caller)", () => {
		const dir = scratchDir();
		const auditPath = join(dir, ".conductor", "audit.jsonl");
		// A path that embeds a secret-shaped token — defense in depth against a future mispopulate.
		const secrety =
			"/repo/.conductor/library/AKIAIOSFODNN7EXAMPLE/aws_secret_access_key=wJalrXUtnFEMI0000000000000000000000000000";
		appendSecurityEvent(auditPath, {
			timestamp: "2026-08-07T10:00:00.000Z",
			event: "repo-supplied-library-artifact",
			path: secrety,
			severity: "high",
			decision: "deny",
		});
		const parsed = JSON.parse(readFileSync(auditPath, "utf8").trim());
		// The persisted value is exactly what this sink's redactor produces — never the raw upstream string.
		expect(parsed.path).toBe(redactSecrets(secrety));
	});

	it("fail-closed: refuses an entry with an invalid timestamp (never persists an uncorrelatable security record)", () => {
		const dir = scratchDir();
		const auditPath = join(dir, ".conductor", "audit.jsonl");
		expect(() =>
			appendSecurityEvent(auditPath, {
				timestamp: "not-a-timestamp",
				event: "repo-supplied-library-artifact",
				path: "/a",
				severity: "high",
				decision: "deny",
			}),
		).toThrow();
	});

	it("fail-closed: propagates an I/O failure (path resolves to a directory), never swallows it", () => {
		const dir = scratchDir(); // dir itself is a directory — writing to it as a file must throw
		expect(() =>
			appendSecurityEvent(dir, {
				timestamp: "2026-08-07T10:00:00.000Z",
				event: "repo-supplied-library-artifact",
				path: "/a",
				severity: "high",
				decision: "deny",
			}),
		).toThrow();
	});
});
