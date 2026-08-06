/**
 * Test-first (Gate 5) for T41's "sole constructor" precondition (ADR 0004 §2.2/§13;
 * gate3-addendum-fase3.md §9 T41 mitigation #2): "Lint/teste sole-constructor: nenhum call-site além
 * desse wrapper chama createAgentSession para uma filha ... sem ele, a precondição é prosa."
 *
 * This is a STATIC test: it scans this package's own `src/` TypeScript source for literal calls to
 * `createAgentSession(` and asserts the exact, closed set of files allowed to make that call --
 * `session.ts` (the top-level composition root, for the USER's own session) and `tools/task.ts` (the
 * ONE place a DELEGATION CHILD session may be constructed). It does not execute any code, so it does
 * not need a real model/Agent to be meaningful.
 *
 * RED today, for the correct reason: `src/tools/task.ts` exists (this Gate 5 stream added it) but
 * deliberately does not yet call `createAgentSession` anywhere in its body -- `runTask` is an
 * unconditional throw (Gate 6 implements the real spawn). So today's scan finds only ONE qualifying
 * file (`session.ts`), not the two this invariant requires once Gate 6 lands -- this test fails with
 * a clear diff (`["session.ts"]` vs `["session.ts", "tools/task.ts"]`) until Gate 6 adds that one
 * call, and keeps failing forever after if a THIRD file ever also calls it (T30/T41's residual: a
 * second, ungoverned spawn path is a silent hole shaped exactly like delegation).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

// Matches a genuine call expression (`createAgentSession(`), not merely the identifier appearing in
// a comment or a type-only re-export such as `export * from "./agent-session-runtime.ts"`.
const CREATE_AGENT_SESSION_CALL = /\bcreateAgentSession\s*\(/;

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

describe("tools/task.ts: sole constructor of a governed delegation-child session (T41, ADR 0004 §2.2/§13)", () => {
	it("createAgentSession is called from exactly two files in @conductor/runtime's own source -- the top-level composition root and the task tool's designated spawn path -- never a third", () => {
		const files = collectTsSourceFiles(SRC_ROOT);
		const callers = files
			.filter((file) => CREATE_AGENT_SESSION_CALL.test(readFileSync(file, "utf8")))
			.map((file) => relative(SRC_ROOT, file).split("\\").join("/"))
			.sort();

		expect(callers).toEqual(["session.ts", "tools/task.ts"]);
	});
});
