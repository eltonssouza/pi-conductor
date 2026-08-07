/**
 * Test-first (Gate 5) for R22's non-fabrication guarantee — the "sole constructor" discipline Fase 3
 * already used for delegation-child sessions (test/tools/task-sole-constructor.test.ts, T41), ported
 * here to the literal construction of a gate `Approval` claiming `method: "human"`.
 *
 * This is a STATIC test: it scans this package's own `src/` for the literal pattern that constructs
 * `method: "human"` and asserts the exact, closed set of files allowed to contain it —
 * `gate-approval.ts` alone (the ONE factory, `mintHumanApproval`). It does not execute any code, so it
 * does not need `mintHumanApproval` to actually work to be meaningful.
 *
 * RED today, for the correct reason: `mintHumanApproval`'s body (src/gate-approval.ts) is an
 * unconditional throw (Gate 6 fills it in for real) — the literal construction line does not exist
 * ANYWHERE in source yet, so today's scan finds ZERO files, not the one file this invariant requires
 * once Gate 6 lands. This mirrors task-sole-constructor.test.ts's own documented Gate-5 RED reason
 * exactly (that test found only ["session.ts"], not the required ["session.ts", "tools/task.ts"], until
 * Gate 6 added the real call).
 *
 * Field-name disambiguation (this matters for the regex below): the gate `Approval`'s field is
 * `method` (ADR 0005 §18 appendix) — deliberately DIFFERENT from `audit-trail.ts`'s unrelated tool-call
 * field `approvalMethod` (permission-gate.ts legitimately constructs `approvalMethod: "human"` several
 * times already, for a completely different domain: a tool-call decision, not a gate sign-off). The
 * regex requires `method` not to be preceded by an identifier character, so it can never match
 * `approvalMethod: "human"` — verified directly below by a sanity test against the real
 * permission-gate.ts source.
 *
 * Comments are stripped before scanning (this file's own header, and the parallel GateStateStore
 * stream's own `gate-state.ts` doc comments, both legitimately DISCUSS the literal `method: "human"` in
 * prose while describing the R22 contract — a naive scan over raw source text would false-positive on
 * that prose, exactly the same class of caveat `task-sole-constructor.test.ts`'s own header names for
 * `createAgentSession(` appearing "in a comment like this one"). Stripping comments first means this
 * test only ever counts an ACTUAL code construction, matching the spirit of that precedent rather than
 * its documented false-positive-on-comments loophole.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));

// Matches `method: "human"` / `method: 'human'` but NOT `approvalMethod: "human"` -- negative
// lookbehind on the character immediately preceding "method" being an identifier character.
const HUMAN_METHOD_LITERAL = /(?<![A-Za-z0-9_])method\s*:\s*["']human["']/;

/** Strips `/* ... *\/` block comments (this codebase's own JSDoc style) and `// ...` line comments
 * before a source-text scan -- naive (doesn't special-case `//`/`/*` inside an actual string literal),
 * but sufficient here: no real code in this package constructs a gate Approval from a string containing
 * either sequence. */
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

describe('gate-approval.ts: sole constructor of an Approval claiming method:"human" (R22, ADR 0005 §6)', () => {
	it('the literal `method: "human"` appears in exactly one file in @conductor/runtime\'s own source -- the mint factory -- never a second, ungoverned construction site', () => {
		const files = collectTsSourceFiles(SRC_ROOT);
		const constructors = files
			.filter((file) => HUMAN_METHOD_LITERAL.test(stripComments(readFileSync(file, "utf8"))))
			.map((file) => relative(SRC_ROOT, file).split("\\").join("/"))
			.sort();

		expect(constructors).toEqual(["gate-approval.ts"]);
	});

	it('sanity: the regex does NOT match the unrelated tool-call field approvalMethod:"human" (permission-gate.ts)', () => {
		const permissionGateSource = stripComments(readFileSync(join(SRC_ROOT, "permission-gate.ts"), "utf8"));

		// Confirms the file DOES legitimately contain the unrelated field first -- otherwise the
		// negative assertion right below would be vacuously true because the string is simply absent.
		expect(permissionGateSource).toContain('approvalMethod: "human"');
		expect(HUMAN_METHOD_LITERAL.test(permissionGateSource)).toBe(false);
	});
});
