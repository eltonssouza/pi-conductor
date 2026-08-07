/**
 * Gate 9 (T56/R37): `conductor library status` must ESCALATE a repo-supplied `.conductor/library`
 * artifact found under the workspace as HIGH, and record its detection in the audit trail as a `deny`
 * security event — never a neutral note beside the chunk counts (gate3-addendum-fase5.md §8.3, D7 §10.3).
 * This is the composition-root half of the fix: the detector lives in @conductor/library, the audit
 * sink in @conductor/runtime, wired together here (the one place ADR §11.2 allows importing both).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLibraryStatus } from "../../src/commands/library.ts";

const scratch: string[] = [];
function scratchWorkspaceWithArtifact(): string {
	const dir = mkdtempSync(join(tmpdir(), "poc-libstatus-"));
	scratch.push(dir);
	mkdirSync(join(dir, ".conductor", "library"), { recursive: true });
	return dir;
}
afterEach(() => {
	while (scratch.length > 0) {
		const dir = scratch.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("runLibraryStatus — repo-supplied library artifact escalation (T56/R37)", () => {
	it("surfaces a HIGH security alert naming the artifact path in the human-readable output", () => {
		const cwd = scratchWorkspaceWithArtifact();
		const output = runLibraryStatus({ cwd, json: false });
		expect(output).toMatch(/HIGH/);
		expect(output).toMatch(/\.conductor[/\\]library/);
	});

	it("surfaces the alert as a structured securityAlerts entry in --json mode", () => {
		const cwd = scratchWorkspaceWithArtifact();
		const parsed = JSON.parse(runLibraryStatus({ cwd, json: true }));
		expect(Array.isArray(parsed.securityAlerts)).toBe(true);
		expect(parsed.securityAlerts).toHaveLength(1);
		expect(parsed.securityAlerts[0].severity).toBe("high");
		expect(parsed.securityAlerts[0].path).toContain(".conductor");
	});

	it("records the detection in the workspace audit trail as a security-detection deny event", () => {
		const cwd = scratchWorkspaceWithArtifact();
		runLibraryStatus({ cwd, json: false });
		const auditLine = readFileSync(join(cwd, ".conductor", "audit.jsonl"), "utf8").trim();
		const parsed = JSON.parse(auditLine);
		expect(parsed.kind).toBe("security-detection");
		expect(parsed.decision).toBe("deny");
		expect(parsed.severity).toBe("high");
		expect(parsed.path).toContain(".conductor");
	});
});
