/**
 * Test-first (Gate 5) for D4's sole-mint discipline over `groundingCitations` and
 * `Decision{kind:"decision"}` construction (ADR 0006 §6.2 item 1, §19) — the SAME static-scan
 * technique `gate-approval-sole-mint.test.ts` already proved out for R22 (ADR 0005 §7), replicated
 * here for two invariants instead of one:
 *
 *   1. The `groundingCitations` key is written (object-literal key / assignment) in exactly ONE file
 *      across the whole monorepo — `gate-grounding.ts` (`recordGroundedDecision`'s own module) —
 *      never a second, ungoverned construction site.
 *   2. A `Decision` literal with `kind: "decision"` is constructed in exactly that SAME file — never
 *      anywhere else (D4 §6.3: `reject()` must write `kind: "rejection"` instead).
 *
 * RED today, for the CORRECT reason in each case:
 *   - (1) `gate-grounding.ts` exists only as an unconditional-throw stub with no construction site at
 *     all yet, so today's scan finds ZERO writers, not the ONE file this invariant requires once
 *     Gate 6 fills the body in — mirrors the precedent's own documented RED reason almost verbatim
 *     ("today's scan finds ZERO files, not the one file this invariant requires").
 *   - (2) TODAY, `packages/conductor-cli/src/commands/gate-store.ts`'s `reject()` still constructs
 *     `kind: "decision"` (verified by reading that file at this Gate 5 task's own assignment,
 *     gate-store.ts:283-308) — a REAL, pre-existing violation this scan catches directly, not a
 *     hypothetical one. Gate 6 fixes it to `kind: "rejection"` (see
 *     test/gate-state-decision-kind.test.ts), which is what makes this scan converge on the single
 *     legitimate writer.
 *
 * Scan scope is `packages/*<one level>/src/**\/*.ts` (ADR §6.2's own words) — every package's own
 * `src/`, not `test/`, resolved from this file's own location two directories up
 * (packages/conductor-runtime/test/ -> packages/). Comments are stripped first, the same caveat and
 * the same fix as the precedent (a doc comment discussing the literal pattern in prose must not
 * false-positive the scan — this file's own header above is exactly such prose).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Write position only: an object-literal key / assignment (`groundingCitations: someValue`), never a
// TYPE declaration (`groundingCitations?: GroundingCitation[]`) or an optional-chained/plain READ
// (`x.groundingCitations?.length`, `x.groundingCitations`) — both of the latter have "?" as the very
// next character after the identifier, which this negative lookahead excludes. Naive (not a real
// parser) but sufficient for this codebase's actual shapes, same discipline as the precedent.
const GROUNDING_CITATIONS_WRITE = /groundingCitations(?!\?)\s*:/;

// Matches `kind: "decision"` / `kind: 'decision'` only when "decision" is the FIRST value after the
// colon — so a union type declaration like `kind: "reasoning" | "decision" | "plan" | ...`
// (gate-state.ts's own Decision interface) never matches, because "decision" is not the token
// immediately following the colon there. Negative lookbehind mirrors the precedent's own guard
// against matching a longer identifier ending in "kind".
const DECISION_KIND_LITERAL = /(?<![A-Za-z0-9_])kind\s*:\s*["']decision["']/;

/** Strips `/* ... *\/` block comments and `// ...` line comments before scanning — see
 * gate-approval-sole-mint.test.ts's own header for the identical, deliberately naive, caveat. */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function collectTsSourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTsSourceFiles(full, out);
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
			out.push(full);
		}
	}
	return out;
}

/** Every package's OWN `src/` directory directly under `packages/*` (ADR §6.2's literal scan scope) —
 * a package with no `src/` (or a nested workspace like `session-backends/sqlite-node`) contributes
 * nothing, exactly like the glob `packages/*\/src/**\/*.ts` would. */
function collectAllPackageSourceFiles(): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const srcDir = join(PACKAGES_ROOT, entry.name, "src");
		try {
			collectTsSourceFiles(srcDir, files);
		} catch {
			// No src/ directory directly under this package entry — contributes nothing, same as the
			// glob would (e.g. session-backends/ only has a nested sqlite-node/src, one level deeper).
		}
	}
	return files;
}

function toPackageRelativeLabel(absolutePath: string): string {
	return relative(PACKAGES_ROOT, absolutePath).split("\\").join("/");
}

describe("groundingCitations: sole writer across the whole monorepo is gate-grounding.ts (D4, ADR 0006 §6.2 item 1)", () => {
	it("the `groundingCitations` key is written in exactly one file — the mint module — never a second, ungoverned construction site", () => {
		const files = collectAllPackageSourceFiles();
		const writers = files
			.filter((file) => GROUNDING_CITATIONS_WRITE.test(stripComments(readFileSync(file, "utf8"))))
			.map(toPackageRelativeLabel)
			.sort();

		expect(writers).toEqual(["conductor-runtime/src/gate-grounding.ts"]);
	});

	it("sanity: the regex does NOT match the optional-field TYPE declarations in gate-state.ts (`groundingCitations?: GroundingCitation[]`)", () => {
		const source = stripComments(readFileSync(join(PACKAGES_ROOT, "conductor-runtime", "src", "gate-state.ts"), "utf8"));
		expect(source).toContain("groundingCitations?:");
		expect(GROUNDING_CITATIONS_WRITE.test(source)).toBe(false);
	});
});

describe('Decision{kind:"decision"}: constructed in exactly one file — gate-grounding.ts (D4 §6.3, ADR 0006 §19)', () => {
	it('the literal `kind: "decision"` is constructed in exactly one file across the monorepo — FAILS today: gate-store.ts\'s reject() still writes it (a real, pre-existing violation this scan catches directly)', () => {
		const files = collectAllPackageSourceFiles();
		const writers = files
			.filter((file) => DECISION_KIND_LITERAL.test(stripComments(readFileSync(file, "utf8"))))
			.map(toPackageRelativeLabel)
			.sort();

		expect(writers).toEqual(["conductor-runtime/src/gate-grounding.ts"]);
	});

	it('sanity: the regex does NOT match the union TYPE declaration in gate-state.ts (`kind: "reasoning" | "decision" | "plan" | "calibration" | "rejection"`)', () => {
		const source = stripComments(readFileSync(join(PACKAGES_ROOT, "conductor-runtime", "src", "gate-state.ts"), "utf8"));
		expect(source).toContain('"reasoning" | "decision"');
		expect(DECISION_KIND_LITERAL.test(source)).toBe(false);
	});
});
