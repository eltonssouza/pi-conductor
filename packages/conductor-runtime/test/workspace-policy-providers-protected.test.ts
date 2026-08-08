/**
 * Test-first (Gate 5, Fase 7 "Model routing e provedores") for D10
 * (docs/adr/0008-fase7-model-routing-and-providers.md §1.1 finding F3, §2 D10, §14.2, §15 S1/S2;
 * docs/conductor/gate3-addendum-fase7.md §6 secure-defaults 64/65): TWO new entries join
 * `defaultProtectedPaths()`:
 *
 *   1. `getAgentDir()` (`~/.pi/agent/`, the vendor `@earendil-works/pi-coding-agent`'s per-machine
 *      credential + catalog directory — `auth.json`/`models.json`) — secure-default 64 (S1). Today
 *      reachable by the agent's own read/write/edit/bash tools; no prior fase protects it.
 *   2. `<workspaceRoot>/.conductor-agent` — the delegation child's own catalog/credential directory
 *      (`packages/conductor-runtime/src/tools/task.ts:541`, `createGovernedChildSessionSpawner`'s
 *      `agentDir`) — secure-default 65 (S2). A hostile clone that plants
 *      `.conductor-agent/models.json` (an `openai-compatible` provider with an attacker `baseUrl` +
 *      inline `apiKey`, both permitted by the vendor's `model-config.ts:195-196` schema) is T73
 *      materialized in code that already exists — see
 *      `test/tools/task-child-per-machine-model-paths.test.ts` for the companion characterization test
 *      of the spawner itself (F3, task.ts:541-547) that this protected-path fix pairs with.
 *
 * `defaultProtectedPaths`/`evaluateToolPath` are ALREADY fully implemented (Fase 1-6 Gate 6 landed) —
 * these tests target a REAL, still-open gap in that already-shipped list, not a stub throw. Mirrors the
 * EXACT pattern `workspace-policy-diary-protected.test.ts` (Fase 6) and
 * `workspace-policy-library-protected.test.ts` (Fase 5) already used for their own additions.
 */

import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultProtectedPaths, evaluateToolPath } from "../src/workspace-policy.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

describe("defaultProtectedPaths — ~/.pi/agent (getAgentDir()) joins the home-directory list (D10/S1, secure-default 64)", () => {
	it("includes the REAL getAgentDir() value alongside ~/.conductor/{library,diary,credentials} — FAILS today: the list has no ~/.pi/agent entry", () => {
		const paths = defaultProtectedPaths();
		// The real, exported vendor function (`@earendil-works/pi-coding-agent`'s public surface,
		// `packages/coding-agent/src/index.ts:8`) — NOT a hardcoded `join(homedir(), ".pi", "agent")`
		// literal, so this assertion stays correct even under a PI_CODING_AGENT_DIR env override.
		expect(paths).toContain(getAgentDir());
	});
});

describe("defaultProtectedPaths(workspaceRoot) — <workspaceRoot>/.conductor-agent joins the workspace-scoped list (D10/S2, secure-default 65)", () => {
	it("includes join(workspaceRoot, '.conductor-agent') — FAILS today: the workspace-scoped list has no .conductor-agent entry", () => {
		const paths = defaultProtectedPaths(workspace.root);
		expect(paths).toContain(join(workspace.root, ".conductor-agent"));
	});
});

describe("evaluateToolPath denies any path under getAgentDir() (D10/S1) — same subtree discipline as .conductor/gates", () => {
	it("denies a write to the credential store, getAgentDir()/auth.json, flagged specifically as a PROTECTED LOCATION (not merely 'outside the workspace')", () => {
		const target = join(getAgentDir(), "auth.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		// Today this IS denied, but only incidentally (the target sits outside the scratch workspace
		// root) — the reason today reads "resolves outside the workspace root", never "protected
		// location". This assertion is what fails: D10 requires the SAME defense-in-depth protected-path
		// check .conductor/gates and ~/.conductor/library already get, independent of workspace
		// containment — T69(a)/T73(b) (credential theft / hostile-baseUrl catalog) depend on it.
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies a write to the catalog file, getAgentDir()/models.json — the WHOLE subtree, not just auth.json", () => {
		const target = join(getAgentDir(), "models.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies it even before the file exists, and specifically as a protected location (protection must not require the target to already be on disk, same discipline as ~/.ssh)", () => {
		const target = join(getAgentDir(), "never-created-provider-config.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});
});

describe("evaluateToolPath denies any path under <workspaceRoot>/.conductor-agent (D10/S2) — the T73 attack surface, closed at the path-authority layer", () => {
	it("denies a write to <workspaceRoot>/.conductor-agent/models.json — the exact T73 vector (a hostile clone planting an openai-compatible provider with an attacker baseUrl + inline apiKey), flagged as a PROTECTED LOCATION, not merely 'inside the workspace and therefore allowed'", () => {
		const target = join(workspace.root, ".conductor-agent", "models.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		// Today this resolves allowed:true (it sits inside workspaceRoot, and workspace containment
		// alone says yes) — the OPPOSITE direction of the two describe blocks above: here the gap is
		// over-granting, not under-denying. This is the assertion that fails today.
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies a write to <workspaceRoot>/.conductor-agent/auth.json — the WHOLE subtree, not just models.json", () => {
		const target = join(workspace.root, ".conductor-agent", "auth.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies it even before the file exists (workspace.agentDir itself exists as a directory — created by createScratchWorkspace — but the specific target file inside it never has), and specifically as a protected location", () => {
		const target = join(workspace.agentDir, "never-created-provider-config.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});
});
