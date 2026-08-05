/**
 * `commands/chat/status-line.ts` (docs/adr/0002-fase1-cli-foundation.md §7.5) -- Gate 5 (red first).
 * Pure formatting -- no TUI, no filesystem, no network. Each of the five realistic status fields is
 * tested in isolation, plus the "absent, not faked" contract for unknown context usage.
 */

import { describe, expect, it } from "vitest";
import {
	buildStatusLine,
	formatContextRemainingLine,
	formatGitLine,
	formatModelLine,
	formatPermissionLevelLine,
	formatTokensUsedLine,
} from "../../../src/commands/chat/status-line.ts";

describe("formatModelLine", () => {
	it("shows the configured model identifier", () => {
		expect(formatModelLine("anthropic/claude-sonnet-5")).toBe("model anthropic/claude-sonnet-5");
	});
});

describe("formatGitLine", () => {
	it("shows the branch and clean state", () => {
		expect(formatGitLine({ kind: "clean", branch: "main" })).toBe("branch main (clean)");
	});

	it("shows the branch and dirty state", () => {
		expect(formatGitLine({ kind: "dirty", branch: "feature/x" })).toBe("branch feature/x (dirty)");
	});

	it("degrades cleanly when git is unavailable, rather than throwing or showing a stale branch", () => {
		expect(formatGitLine({ kind: "unavailable", reason: "not a git repository" })).toBe("git unavailable");
	});
});

describe("formatTokensUsedLine", () => {
	it("formats a token count with thousands separators", () => {
		expect(formatTokensUsedLine(12345)).toBe("12,345 tokens used");
	});

	it("formats zero tokens (a brand-new session) without error", () => {
		expect(formatTokensUsedLine(0)).toBe("0 tokens used");
	});
});

describe("formatContextRemainingLine", () => {
	it("computes remaining tokens and percent free from usage vs. the model's context window", () => {
		const line = formatContextRemainingLine({ tokens: 20000, contextWindow: 200000, percent: 10 });
		expect(line).toBe("~180,000 / 200,000 tokens free (90% free)");
	});

	it("reports 'unknown' rather than a misleading number when tokens is null (e.g. right after compaction)", () => {
		expect(formatContextRemainingLine({ tokens: null, contextWindow: 200000, percent: null })).toBe(
			"context usage unknown",
		);
	});

	it("reports 'unknown' when no usage is available at all (e.g. before the first turn completes)", () => {
		expect(formatContextRemainingLine(undefined)).toBe("context usage unknown");
	});

	it("never reports negative remaining tokens even if usage exceeds the window (compaction edge case)", () => {
		const line = formatContextRemainingLine({ tokens: 250000, contextWindow: 200000, percent: 125 });
		expect(line).toContain("~0 / 200,000");
	});
});

describe("formatPermissionLevelLine", () => {
	it("pluralizes correctly for zero protected paths", () => {
		expect(formatPermissionLevelLine(0)).toBe("workspace-scoped, fail-closed, 0 protected paths");
	});

	it("uses the singular for exactly one protected path", () => {
		expect(formatPermissionLevelLine(1)).toBe("workspace-scoped, fail-closed, 1 protected path");
	});

	it("pluralizes for more than one protected path", () => {
		expect(formatPermissionLevelLine(3)).toBe("workspace-scoped, fail-closed, 3 protected paths");
	});
});

describe("buildStatusLine", () => {
	it("joins all five realistic fields in ADR §7.5's order", () => {
		const line = buildStatusLine({
			modelLabel: "anthropic/claude-sonnet-5",
			git: { kind: "clean", branch: "main" },
			totalTokensUsed: 1000,
			contextUsage: { tokens: 1000, contextWindow: 200000, percent: 0.5 },
			protectedPathCount: 2,
		});
		expect(line).toBe(
			"model anthropic/claude-sonnet-5 | branch main (clean) | 1,000 tokens used | " +
				"~199,000 / 200,000 tokens free (100% free) | workspace-scoped, fail-closed, 2 protected paths",
		);
	});
});
