/**
 * Test-first (Gate 5, Fase 6 "Diary e captura automática") for D4 (ADR 0007 §6 + §12.4,
 * docs/adr/0007-fase6-diary-and-capture.md; closes GAP-6D/T63/R44): `~/.conductor/diary` joins
 * `defaultProtectedPaths()` alongside `~/.conductor/library` and `~/.conductor/credentials` -- the
 * diary's authoritative `entries.jsonl` (the log that feeds `runtimeRecordedJournalEntryIds`, D2/G12)
 * and its derived `index.sqlite` must be as unwritable by write/edit/bash as the audit trail and the
 * GateState store already are (Fase 2/4 precedent, identical reasoning: "the register must be
 * un-writable by the very agent whose acts it records" -- a confused-deputy the agent could otherwise
 * use to forge its own governance evidence, T63(a)).
 *
 * `defaultProtectedPaths`/`evaluateToolPath` are ALREADY fully implemented (Fase 1-5 Gate 6 landed) --
 * these tests target a REAL, still-open gap in that already-shipped list, not a stub throw. Mirrors the
 * exact pattern `workspace-policy-library-protected.test.ts` (Fase 5) already used for its own
 * `~/.conductor/library` gap.
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

describe("defaultProtectedPaths -- ~/.conductor/diary joins the home-directory list (D4)", () => {
	it("includes ~/.conductor/diary alongside ~/.conductor/library and ~/.conductor/credentials -- FAILS today: the list has no diary entry", () => {
		const paths = defaultProtectedPaths();
		expect(paths.some((p) => p.endsWith(join("conductor", "diary")))).toBe(true);
	});
});

describe("evaluateToolPath denies any path under ~/.conductor/diary (D4) -- same subtree discipline as .conductor/gates", () => {
	it("denies a write to the authoritative log, ~/.conductor/diary/projects/<projectId>/entries.jsonl, flagged specifically as a PROTECTED LOCATION (not merely 'outside the workspace')", () => {
		const target = join(homedir(), ".conductor", "diary", "projects", "abc123def456", "entries.jsonl");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		// Today this IS denied, but only incidentally (the target sits outside the scratch workspace
		// root) -- the reason today reads "resolves outside the workspace root", never "protected
		// location". This assertion is what fails: D4 requires the SAME defense-in-depth protected-path
		// check .conductor/gates and ~/.conductor/library already get, independent of workspace
		// containment -- the anti-forensic guarantee of D7/R44 ("the loop itself cannot erase/rewrite
		// the record of its own acts") depends on it.
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies a write to the derived per-project search index, ~/.conductor/diary/projects/<projectId>/index.sqlite -- the WHOLE subtree, not just entries.jsonl", () => {
		const target = join(homedir(), ".conductor", "diary", "projects", "abc123def456", "index.sqlite");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});

	it("denies it even before the file exists, and specifically as a protected location (protection must not require the target to already be on disk, same discipline as ~/.ssh)", () => {
		const target = join(homedir(), ".conductor", "diary", "projects", "never-created", "entries.jsonl");
		const result = evaluateToolPath(target, { workspaceRoot: workspace.root });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/protected location/);
	});
});
