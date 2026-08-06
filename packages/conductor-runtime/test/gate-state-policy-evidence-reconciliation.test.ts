/**
 * Static reconciliation check (Gate 6 wiring closure, Fase 4 "Gates e evidências"): `gate-state-
 * policy.ts`'s `isMandatorySatisfied`/`evaluateAdvance` must CONSULT `gate-evidence.ts`'s
 * `hasSufficientEvidenceForMandatoryGate` (the real R25 golden-rule predicate) rather than duplicating
 * its "at least one runtime-derived evidence item" check inline — exactly the TODO the two parallel
 * Gate 5/6 streams left in `gate-state-policy.ts`'s own header ("This logic is intentionally NOT
 * imported from gate-evidence.ts ... with a TODO to delete this inline copy and import the real one
 * once that stream lands").
 *
 * Why a static scan, not a behavioral assertion: a pure behavioral test cannot discriminate "genuinely
 * imports and calls the shared predicate" from "duplicates a behaviorally-identical inline check" —
 * both compute the exact same `evidence.some(item => item.provenance === "runtime-derived")` for every
 * reachable input. `gate-state-policy.test.ts`'s own "R25 golden rule integration" test already covers
 * the BEHAVIOR (and already passed before this reconciliation, for the wrong reason: the duplicate).
 * This file proves the WIRING itself.
 *
 * Why not `vi.mock`/`vi.spyOn`: `hasSufficientEvidenceForMandatoryGate` is this package's own pure,
 * in-process, cheap collaborator — Unit Testing Principles §3.12 ("mock only unmanaged out-of-process
 * dependencies... the real collaborator is cheap and in-process") is exactly why no file under this
 * package's own test/ directory mocks an in-repo collaborator (see redaction.test.ts's own header; the
 * two real `vi.mock`/`vi.spyOn` uses elsewhere in this monorepo are both for an out-of-process/managed
 * dependency, never this package's own pure functions). This instead follows the SAME static-source-
 * scan precedent `gate-approval-sole-mint.test.ts` already established for an analogous "prove real
 * wiring, not a coincidence" problem — stripping comments first, per that file's own documented
 * false-positive fix, so a doc-comment's prose does not trip the scan.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, "..", "src", "gate-state-policy.ts");

/** Strips `/* ... *\/` block comments and `// ...` line comments — mirrors the sole-mint scan's own
 * `stripComments()` (avoids a doc-comment's prose tripping a literal-string scan). */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("gate-state-policy.ts reconciles with gate-evidence.ts (R25 golden rule, single source of truth)", () => {
	const rawSource = readFileSync(SOURCE_PATH, "utf8");
	const code = stripComments(rawSource);

	it("imports hasSufficientEvidenceForMandatoryGate from ./gate-evidence.ts rather than redeclaring the check", () => {
		expect(code).toMatch(
			/import\s*\{[^}]*hasSufficientEvidenceForMandatoryGate[^}]*\}\s*from\s*["']\.\/gate-evidence\.ts["']/,
		);
	});

	it("actually CALLS hasSufficientEvidenceForMandatoryGate(...) in its implementation, not only in the import line", () => {
		const callSites = code.match(/hasSufficientEvidenceForMandatoryGate\s*\(/g) ?? [];
		// The import statement's binding itself never has a trailing "(" -- every match here is a real
		// call expression, so at least one confirms the predicate is genuinely invoked, not just named.
		expect(callSites.length).toBeGreaterThanOrEqual(1);
	});

	it("no longer duplicates the golden-rule check inline -- the literal provenance string does not appear in this file's own CODE (only gate-evidence.ts owns that comparison)", () => {
		expect(code).not.toMatch(/["']runtime-derived["']/);
	});
});
