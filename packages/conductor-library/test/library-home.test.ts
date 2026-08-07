/**
 * Test-first (Gate 5) for `resolveLibraryHome`/`computeProjectId` (src/library-home.ts) -- ADR 0006
 * D7/D9, §12.1, §19.
 *
 * Both functions are currently STUBS that throw "not implemented" -- every test below fails RED for
 * that one reason today (Gate 6 implements the bodies).
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeProjectId, resolveLibraryHome } from "../src/library-home.ts";

const FAKE_HOME = join("tmp", "fake-conductor-home");

describe("resolveLibraryHome (D9 §12.1: ~/.conductor/library/** layout)", () => {
	it("roots the corpus (global) database directly under <home>/.conductor/library", () => {
		const paths = resolveLibraryHome(FAKE_HOME);

		expect(paths.root).toBe(join(FAKE_HOME, ".conductor", "library"));
		expect(paths.corpusDatabase).toBe(join(paths.root, "corpus.sqlite"));
	});

	it("scopes the code database and events ledger under projects/<projectId>, never globally (D7: never shared across projects)", () => {
		const paths = resolveLibraryHome(FAKE_HOME);
		const projectId = "abc123def4567890";

		expect(paths.projectDir(projectId)).toBe(join(paths.root, "projects", projectId));
		expect(paths.codeDatabase(projectId)).toBe(join(paths.projectDir(projectId), "code.sqlite"));
		expect(paths.eventsLog(projectId)).toBe(join(paths.projectDir(projectId), "events.jsonl"));
	});

	it("gives two different projectIds two disjoint code/ledger paths, never colliding (T51's fix)", () => {
		const paths = resolveLibraryHome(FAKE_HOME);

		expect(paths.codeDatabase("project-a")).not.toBe(paths.codeDatabase("project-b"));
		expect(paths.eventsLog("project-a")).not.toBe(paths.eventsLog("project-b"));
	});

	it("defaults to the REAL OS home directory when none is supplied, without duplicating os.homedir()'s own logic", () => {
		const withDefault = resolveLibraryHome();
		const withExplicitRealHome = resolveLibraryHome(homedir());

		expect(withDefault.root).toBe(withExplicitRealHome.root);
		expect(withDefault.root).toBe(join(homedir(), ".conductor", "library"));
	});
});

describe("computeProjectId (D7 §10.2: sha256(realpath(workspaceRoot)).slice(0, 16), same algorithm as gate-store.ts's resolveGateGitContext)", () => {
	it("matches an independently-computed sha256 hex digest, truncated to 16 characters", () => {
		const workspaceRealPath = join("tmp", "example-workspace");
		const expected = createHash("sha256").update(workspaceRealPath, "utf8").digest("hex").slice(0, 16);

		expect(computeProjectId(workspaceRealPath)).toBe(expected);
	});

	it("is deterministic: the same real path always yields the same id", () => {
		const workspaceRealPath = join("tmp", "stable-workspace");

		expect(computeProjectId(workspaceRealPath)).toBe(computeProjectId(workspaceRealPath));
	});

	it("gives two different real paths two different ids", () => {
		expect(computeProjectId(join("tmp", "project-a"))).not.toBe(computeProjectId(join("tmp", "project-b")));
	});

	it("always returns exactly 16 lowercase hex characters", () => {
		const id = computeProjectId(join("tmp", "some-workspace"));

		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});
});
