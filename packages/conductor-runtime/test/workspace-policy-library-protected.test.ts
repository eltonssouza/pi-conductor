/**
 * Test-first (Gate 5, Fase 5) for D9 (ADR 0006 §12, `docs/adr/0006-fase5-library-and-grounding.md`,
 * R33/R34): `~/.conductor/library` joins `defaultProtectedPaths()` alongside
 * `~/.conductor/credentials` — the corpus, the per-project code index, and the grounding ledger
 * (D7/D9/D13) must be as unwritable by write/edit/bash as the audit trail and the GateState store
 * already are (Fase 2/4 precedent, identical reasoning: "the register must be un-writable by the very
 * agent whose acts it records" — a confused-deputy the agent could otherwise use to forge its own
 * grounding evidence, T55/T53).
 *
 * `defaultProtectedPaths`/`evaluateToolPath` are ALREADY fully implemented (Fase 1-4 Gate 6 landed) —
 * these tests target a REAL, still-open gap in that already-shipped list, not a stub throw. Mirrors
 * the exact pattern `workspace-policy.test.ts` already uses for `.conductor/credentials` and
 * `.conductor/gates`.
 */

import { homedir } from "node:os";
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

describe("defaultProtectedPaths — ~/.conductor/library joins the home-directory list (D9)", () => {
	it("includes ~/.conductor/library alongside ~/.conductor/credentials — FAILS today: the list has no library entry", () => {
		const paths = defaultProtectedPaths();
		expect(paths.some((p) => p.endsWith(join("conductor", "library")))).toBe(true);
	});
});

describe("evaluateToolPath denies any path under ~/.conductor/library (D9) — same subtree discipline as .conductor/gates", () => {
	it("denies a write to the global corpus file, ~/.conductor/library/corpus.sqlite, flagged specifically as a PROTECTED LOCATION (not merely 'outside the workspace')", () => {
		const target = join(homedir(), ".conductor", "library", "corpus.sqlite");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		// Today this IS denied, but only incidentally (the target sits outside the scratch workspace
		// root) — the reason today reads "resolves outside the workspace root", never "protected
		// location". This assertion is what fails: D9 requires the SAME defense-in-depth
		// protected-path check .conductor/gates already gets, independent of workspace containment.
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies a write to a per-project grounding ledger nested under ~/.conductor/library/projects/<projectId>/events.jsonl (D7/D9/D13) — the WHOLE subtree, not just the top-level file", () => {
		const target = join(homedir(), ".conductor", "library", "projects", "abc123def456", "events.jsonl");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies it even before the file exists, and specifically as a protected location (protection must not require the target to already be on disk, same discipline as ~/.ssh)", () => {
		const target = join(homedir(), ".conductor", "library", "projects", "never-created", "code.sqlite");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});
});
