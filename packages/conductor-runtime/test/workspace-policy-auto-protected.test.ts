/**
 * Test-first (Gate 5, Fase 8 "Autonomous mode") for `defaultProtectedPaths(workspaceRoot)` growing a
 * NEW entry: `<workspaceRoot>/.conductor/auto` (docs/adr/0009-fase8-autonomous-mode.md §4/D2/§14,
 * docs/conductor/gate3-addendum-fase8.md T78/R59/secure-default 72, §9.1's own resolution: "SIM,
 * adicionar `.conductor/auto/`").
 *
 * The run checkpoint (`.conductor/auto/<slug>.continue.json`) is estado de governança de orquestração
 * da MESMA família que `.conductor/gates/`/`audit.jsonl`/`policy.json` — the whole point of this list
 * (this module's own header: "a tool must not be able to *create* ~/.ssh either"). BR-5/R59 already
 * neutralizes a FORGED checkpoint for advancing a gate (the content is always re-derived from the real
 * `GateState`) — the protected-path entry this test targets is the SECOND, independent layer (ADR
 * §4.2/Gate-3-addendum §9.1: "duas camadas, nenhuma sozinha basta", the same discipline ADR 0005 §9.1
 * already applied to `.conductor/gates`): even if a future `--continue` edit forgets R59's
 * re-derivation discipline, a subagent under prompt injection must still be unable to WRITE the
 * checkpoint file in the first place.
 *
 * GATE 3 (docs/conductor/gate3-addendum-fase8.md, header) confirmed LIVE against this exact function
 * that `.cdt/auto/` (the spec's original literal, corrected to `.conductor/auto/` by ADR §4.1) is NOT
 * protected today — this test reproduces that confirmed-absent finding as a FAILING test, mirroring
 * the EXACT pattern `workspace-policy-providers-protected.test.ts` (Fase 7) /
 * `workspace-policy-diary-protected.test.ts` (Fase 6) / `workspace-policy-library-protected.test.ts`
 * (Fase 5) already used for their own additions. `defaultProtectedPaths`/`evaluateToolPath` themselves
 * are already fully implemented (Fase 1-7 Gate 6 landed) — this Gate 5 does NOT implement the fix (a
 * one-line addition inside `defaultProtectedPaths`'s `if (workspaceRoot)` branch); that is explicitly
 * Gate 6 scope for this fase (docs/adr/0009-fase8-autonomous-mode.md §14's own table).
 */

import { join } from "node:path";
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

describe("defaultProtectedPaths(workspaceRoot) — <workspaceRoot>/.conductor/auto joins the workspace-scoped list (Fase 8 D2, secure-default 72)", () => {
	it("includes join(workspaceRoot, '.conductor', 'auto') — FAILS today: the workspace-scoped list has no .conductor/auto entry (Gate 3 addendum's own confirmed-live finding)", () => {
		const paths = defaultProtectedPaths(workspace.root);
		expect(paths).toContain(join(workspace.root, ".conductor", "auto"));
	});

	it("does NOT add anything to the home-directory-only list (defaultProtectedPaths() with no workspaceRoot) — the run checkpoint is a WORKSPACE-scoped store, same family as .conductor/gates, never a per-machine one", () => {
		const paths = defaultProtectedPaths();
		expect(paths).not.toContain(join(workspace.root, ".conductor", "auto"));
	});
});

describe("evaluateToolPath denies any path under <workspaceRoot>/.conductor/auto (Fase 8 T78/R59) — the run checkpoint, closed at the path-authority layer", () => {
	it("denies a write to <workspaceRoot>/.conductor/auto/adicionar-recuperacao-de-senha.continue.json, flagged specifically as a PROTECTED LOCATION (not merely 'inside the workspace and therefore allowed')", () => {
		const target = join(workspace.root, ".conductor", "auto", "adicionar-recuperacao-de-senha.continue.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		// Today this resolves allowed:true (it sits inside workspaceRoot, and workspace containment
		// alone says yes) -- the same over-granting-direction gap `workspace-policy-providers-protected
		// .test.ts` found for `.conductor-agent`. This is the assertion that fails today.
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies it even before the file exists (the run checkpoint is written lazily, only once a run actually stops) -- protection must not require the target to already be on disk, same discipline as ~/.ssh and .conductor/gates", () => {
		const target = join(workspace.root, ".conductor", "auto", "never-created-slug.continue.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies the WHOLE subtree, not just one slug's checkpoint file -- a second demand's run checkpoint is equally protected", () => {
		const target = join(workspace.root, ".conductor", "auto", "outra-demanda.continue.json");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});
});

describe("evaluateToolPath still allows sibling workspace paths outside .conductor/auto (no over-protection)", () => {
	it("allows an ordinary source file elsewhere in the workspace, unaffected by the new entry", () => {
		const target = join(workspace.root, "src", "index.ts");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(true);
	});
});
