/**
 * Test-first (Gate 5, Fase 8 "Autonomous mode") for `scanStagedDiffForSecrets` (`src/commands/
 * auto.ts`) — ADR 0009 §7/D5/§16, gate2-spec-fase8.md FR-18b, Gate 3 addendum T77/R58.
 *
 * `scanStagedDiffForSecrets` is currently an unconditional `throw new Error("not implemented")` stub
 * -- every test below fails RED for that reason today, same precedent as this fase's other
 * `auto-*.test.ts` files.
 *
 * Grounding for the "reuse the real collaborator" design of this test file: `cdt library` (run from
 * `C:\development\source\projects\conductor`) for "when a pure, cheap, in-process collaborator should
 * be exercised directly rather than doubled" returned **Unit Testing Principles — Complete
 * Professional Guide §3.12 "When not to use a test double"** (top 0.574: "the real collaborator is
 * cheap and in-process... substituting them adds setup, pins the collaboration graph... and buys no
 * speed"). Applied here: `@conductor/secrets`'s `findSecretSpans` IS exactly that kind of collaborator
 * (a pure, synchronous, already-fully-tested function -- `packages/conductor-secrets/test/
 * matchers.test.ts`) -- so this file imports it directly for cross-checking, rather than re-deriving a
 * fixture's expected spans by hand, matching D5's own "single source of what looks like a secret"
 * requirement (ADR §7.2: "reusar findSecretSpans... zero segundo motor").
 */

import { findSecretSpans } from "@conductor/secrets";
import { describe, expect, it } from "vitest";
import { scanStagedDiffForSecrets } from "../../src/commands/auto.ts";

const PLANTED_ANTHROPIC_KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

describe("scanStagedDiffForSecrets — FR-18b/T77: detects a planted secret span in a staged diff", () => {
	it("reports clean: false with the matched span when the diff adds a line containing an Anthropic-shaped API key", () => {
		const diffText = [
			"diff --git a/src/config.ts b/src/config.ts",
			"+  const client = new Anthropic({",
			`+    apiKey: "${PLANTED_ANTHROPIC_KEY}",`,
			"+  });",
		].join("\n");

		const result = scanStagedDiffForSecrets(diffText);

		expect(result.clean).toBe(false);
		if (!result.clean) {
			expect(result.spans.length).toBeGreaterThan(0);
			// D5/ADR §7.2: reuses the SAME matcher the redaction pipeline already uses -- never a second,
			// drifting detector. Once Gate 6 wires the real body, the spans this function reports for a
			// given diff text must be exactly what the shared matcher itself would find over that text.
			expect(result.spans.map((s) => s.label)).toEqual(findSecretSpans(diffText).map((s) => s.label));
		}
	});

	it("reports clean: false for a planted GitHub PAT, distinguishing it from the Anthropic-key label", () => {
		const diffText = '+  GITHUB_TOKEN="ghp_abcdefghijklmnopqrstuvwxyz0123456789"';
		const result = scanStagedDiffForSecrets(diffText);
		expect(result.clean).toBe(false);
		if (!result.clean) {
			expect(result.spans.some((s) => s.label === "github-pat")).toBe(true);
		}
	});
});

describe("scanStagedDiffForSecrets — a clean diff (no secret-shaped content) passes", () => {
	it("reports clean: true for an ordinary, secret-free diff", () => {
		const diffText = [
			"diff --git a/src/ui/search-button.tsx b/src/ui/search-button.tsx",
			"-  button.style.marginLeft = '2px';",
			"+  button.style.marginLeft = '4px';",
		].join("\n");

		expect(scanStagedDiffForSecrets(diffText)).toEqual({ clean: true });
	});

	it("reports clean: true for an empty diff (a gate with no textual changes)", () => {
		expect(scanStagedDiffForSecrets("")).toEqual({ clean: true });
	});
});
