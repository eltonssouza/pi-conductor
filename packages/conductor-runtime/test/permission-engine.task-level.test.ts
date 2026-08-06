/**
 * Test-first (Gate 5) for FR-9 / ADR 0004 §2.3 correction #1 (docs/adr/0004-fase3-roles-skills-subagents.md):
 * "permission-engine.ts não tem entrada `task` → cairia no default-deny `security`
 * (resolvePermissionLevel), tornando a tool inutilizável." `TOOL_NAME_TO_LEVEL` (src/permission-engine.ts)
 * is an explicit, exhaustive map (fail-closed by construction, per its own header) that today simply
 * does not mention "task" — this is a small, standalone characterization of exactly that gap, kept
 * separate from the larger task-tool test file so it fails for one narrow, unambiguous reason.
 */

import { describe, expect, it } from "vitest";
import { resolvePermissionLevel } from "../src/permission-engine.ts";

describe("permission-engine: resolvePermissionLevel('task') (FR-9, ADR 0004 §2.3 correction #1)", () => {
	it("resolves 'task' to the Exec permission level -- NOT the default-deny 'security' level every unmapped tool name falls back to", () => {
		// Today TOOL_NAME_TO_LEVEL has no "task" entry, so resolvePermissionLevel("task") falls through
		// to its own documented default ("security" -- auto-deny-only), which would make `task`
		// structurally unusable: every call would be denied before any canSpawn/budget logic ever ran,
		// regardless of how correctly Gate 6 implements tools/task.ts.
		expect(resolvePermissionLevel("task")).toBe("exec");
	});
});
