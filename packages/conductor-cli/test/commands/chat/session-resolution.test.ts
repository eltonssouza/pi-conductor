/**
 * `commands/chat/session-resolution.ts` (docs/adr/0002-fase1-cli-foundation.md §6, §7.4) -- Gate 5
 * (red first).
 *
 * Three layers: pure path scoping, pure flag parsing, then a real-filesystem integration layer
 * proving `.conductor/sessions/` scoping and `--resume` resolution against ACTUAL session files --
 * driven through `@conductor/runtime`'s `createConductorSession` + a scripted fake model (never a
 * mock of SessionManager itself; SessionManager is Pi's own already-tested primitive, exercised here
 * for real, matching this codebase's "never mocked" filesystem-test convention).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createConductorSession } from "@conductor/runtime";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	parseResumeArgs,
	resolveConductorAgentDir,
	resolveConductorSessionsDir,
	resolveSessionManager,
	SessionNotFoundError,
} from "../../../src/commands/chat/session-resolution.ts";
import { registerFakeModel } from "../../support/fake-model.ts";
import { createScratchProject, type ScratchProject } from "../../support/scratch.ts";

describe("resolveConductorAgentDir / resolveConductorSessionsDir (pure path scoping)", () => {
	it("scopes the agent dir to .conductor inside the workspace root, never a global path", () => {
		expect(resolveConductorAgentDir("/workspace/demo")).toBe(join("/workspace/demo", ".conductor"));
	});

	it("scopes sessions to .conductor/sessions, matching ADR §5.2/§6", () => {
		expect(resolveConductorSessionsDir("/workspace/demo")).toBe(join("/workspace/demo", ".conductor", "sessions"));
	});
});

describe("parseResumeArgs (pure)", () => {
	it("no arguments -> fresh, yesFlagActive false", () => {
		const result = parseResumeArgs([]);
		expect(result).toEqual({ ok: true, resume: { kind: "fresh" }, yesFlagActive: false });
	});

	it("--resume alone -> recent, yesFlagActive false", () => {
		const result = parseResumeArgs(["--resume"]);
		expect(result).toEqual({ ok: true, resume: { kind: "recent" }, yesFlagActive: false });
	});

	it("--resume <id> -> specific, yesFlagActive false", () => {
		const result = parseResumeArgs(["--resume", "abc123"]);
		expect(result).toEqual({ ok: true, resume: { kind: "specific", idOrPrefix: "abc123" }, yesFlagActive: false });
	});

	it("rejects an unrecognized leading argument", () => {
		const result = parseResumeArgs(["--bogus"]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/unrecognized argument/);
	});

	it("rejects extra arguments after --resume <id>", () => {
		const result = parseResumeArgs(["--resume", "abc123", "extra"]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/unrecognized argument/);
	});

	it("rejects --resume followed by what looks like another flag, instead of treating it as an id", () => {
		const result = parseResumeArgs(["--resume", "--force"]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/expects a session id/);
	});

	// FR-19 (ADR 0003 §4): --yes is parsed fresh from argv every invocation -- never persisted, never
	// defaulted from config. These cases prove it composes with every existing --resume shape
	// regardless of where it appears in argv (Gate 8 loop-back: this flag previously did not exist at
	// all -- decideToolCall's bash branch hardcoded `yesFlagActive: false`).
	describe("--yes composes with every --resume shape, position-independent", () => {
		it("--yes alone -> fresh + yesFlagActive true", () => {
			expect(parseResumeArgs(["--yes"])).toEqual({ ok: true, resume: { kind: "fresh" }, yesFlagActive: true });
		});

		it("--yes --resume -> recent + yesFlagActive true", () => {
			expect(parseResumeArgs(["--yes", "--resume"])).toEqual({
				ok: true,
				resume: { kind: "recent" },
				yesFlagActive: true,
			});
		});

		it("--resume --yes (yes AFTER resume, no id) -> recent + yesFlagActive true", () => {
			expect(parseResumeArgs(["--resume", "--yes"])).toEqual({
				ok: true,
				resume: { kind: "recent" },
				yesFlagActive: true,
			});
		});

		it("--resume <id> --yes -> specific + yesFlagActive true", () => {
			expect(parseResumeArgs(["--resume", "abc123", "--yes"])).toEqual({
				ok: true,
				resume: { kind: "specific", idOrPrefix: "abc123" },
				yesFlagActive: true,
			});
		});

		it("--yes --resume <id> -> specific + yesFlagActive true", () => {
			expect(parseResumeArgs(["--yes", "--resume", "abc123"])).toEqual({
				ok: true,
				resume: { kind: "specific", idOrPrefix: "abc123" },
				yesFlagActive: true,
			});
		});

		it("no --yes anywhere -> yesFlagActive stays false (regression pin, not just absence-implies-default)", () => {
			const result = parseResumeArgs(["--resume", "abc123"]);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.yesFlagActive).toBe(false);
		});
	});

	// Fase 3 (gate2-spec-fase3.md FR-1/FR-2): --role composes with every existing shape the same
	// position-independent way --yes already does. This function only EXTRACTS the raw role id --
	// resolving it against real role data (found/not-found, FR-2) is chat.ts's own job one level up
	// (role-resolution.ts), the same split --resume <id> already draws (this function never touches
	// the filesystem to check the id is real).
	describe("--role <role-id> composes with every existing shape, position-independent", () => {
		it("--role alone (no other args) -> fresh + roleId set", () => {
			expect(parseResumeArgs(["--role", "backend-engineer"])).toEqual({
				ok: true,
				resume: { kind: "fresh" },
				yesFlagActive: false,
				roleId: "backend-engineer",
			});
		});

		it("--role --resume -> recent + roleId set", () => {
			expect(parseResumeArgs(["--role", "backend-engineer", "--resume"])).toEqual({
				ok: true,
				resume: { kind: "recent" },
				yesFlagActive: false,
				roleId: "backend-engineer",
			});
		});

		it("--resume <id> --role <role> -> specific + roleId set, regardless of --role's position", () => {
			expect(parseResumeArgs(["--resume", "abc123", "--role", "backend-engineer"])).toEqual({
				ok: true,
				resume: { kind: "specific", idOrPrefix: "abc123" },
				yesFlagActive: false,
				roleId: "backend-engineer",
			});
		});

		it("--role composes with --yes too, either order", () => {
			expect(parseResumeArgs(["--yes", "--role", "backend-engineer"])).toEqual({
				ok: true,
				resume: { kind: "fresh" },
				yesFlagActive: true,
				roleId: "backend-engineer",
			});
			expect(parseResumeArgs(["--role", "backend-engineer", "--yes"])).toEqual({
				ok: true,
				resume: { kind: "fresh" },
				yesFlagActive: true,
				roleId: "backend-engineer",
			});
		});

		it("no --role anywhere -> roleId stays undefined (regression pin, not just absence-implies-default)", () => {
			const result = parseResumeArgs(["--resume", "abc123"]);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.roleId).toBeUndefined();
		});

		it("rejects --role with no value at all", () => {
			const result = parseResumeArgs(["--role"]);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toMatch(/--role requires a role id/);
		});

		it("rejects --role followed by what looks like another flag, instead of treating it as a role id", () => {
			const result = parseResumeArgs(["--role", "--resume"]);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toMatch(/--role requires a role id/);
		});
	});
});

describe("resolveSessionManager (real filesystem, real SessionManager, scoped to .conductor/sessions/)", () => {
	let project: ScratchProject;

	beforeEach(() => {
		project = createScratchProject();
	});

	afterEach(() => {
		project.cleanup();
	});

	async function driveOneTurn(marker: string): Promise<string> {
		const agentDir = resolveConductorAgentDir(project.root);
		const sessionsDir = resolveConductorSessionsDir(project.root);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, `conductor-cli-fake-${marker}`, [{ text: marker }]);
		const sessionManager = await resolveSessionManager({
			workspaceRoot: project.root,
			sessionsDir,
			resume: { kind: "fresh" },
		});
		const conductorSession = await createConductorSession({
			workspaceRoot: project.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir,
			sessionManager,
		});
		await conductorSession.session.prompt(`say ${marker}`);
		const sessionFile = conductorSession.session.sessionFile;
		if (!sessionFile) throw new Error("expected a persisted session file");
		conductorSession.dispose();
		return sessionFile;
	}

	it("'fresh' persists the new session file under .conductor/sessions/, never a global default location", async () => {
		const sessionFile = await driveOneTurn("first-turn");
		const sessionsDir = resolveConductorSessionsDir(project.root);

		expect(existsSync(sessionFile)).toBe(true);
		expect(sessionFile.startsWith(sessionsDir)).toBe(true);
		// Never Pi's global default (~/.pi/agent/sessions/--<cwd>--/) -- the whole point of ADR §6.
		expect(sessionFile).not.toContain(".pi");
	});

	it("'recent' resumes the most recently created session, with its prior turn visible", async () => {
		await driveOneTurn("older-session");
		await new Promise((resolve) => setTimeout(resolve, 20)); // ensure a distinguishable mtime
		await driveOneTurn("newer-session");

		const sessionsDir = resolveConductorSessionsDir(project.root);
		const recentManager = await resolveSessionManager({
			workspaceRoot: project.root,
			sessionsDir,
			resume: { kind: "recent" },
		});

		const entries = JSON.stringify(recentManager.getEntries());
		expect(entries).toContain("newer-session");
		expect(entries).not.toContain("older-session");
	});

	it("'specific' with a full session id opens exactly that session, not the most recent one", async () => {
		const firstFile = await driveOneTurn("target-session");
		await new Promise((resolve) => setTimeout(resolve, 20));
		await driveOneTurn("decoy-session");

		const sessionsDir = resolveConductorSessionsDir(project.root);
		const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
		expect(files.length).toBe(2);

		// Derive the target session's id the same way session-resolution.ts does: via SessionManager.list.
		const { SessionManager } = await import("@earendil-works/pi-coding-agent");
		const listed = await SessionManager.list(project.root, sessionsDir);
		const targetInfo = listed.find((info) => info.path === firstFile);
		if (!targetInfo) throw new Error("expected the first driven session to be listed");

		const specificManager = await resolveSessionManager({
			workspaceRoot: project.root,
			sessionsDir,
			resume: { kind: "specific", idOrPrefix: targetInfo.id },
		});

		const entries = JSON.stringify(specificManager.getEntries());
		expect(entries).toContain("target-session");
		expect(entries).not.toContain("decoy-session");
	});

	it("'specific' with an unambiguous id prefix resolves the same way a full id would (git-style convenience)", async () => {
		const firstFile = await driveOneTurn("prefix-target");

		const sessionsDir = resolveConductorSessionsDir(project.root);
		const { SessionManager } = await import("@earendil-works/pi-coding-agent");
		const listed = await SessionManager.list(project.root, sessionsDir);
		const targetInfo = listed.find((info) => info.path === firstFile);
		if (!targetInfo) throw new Error("expected the driven session to be listed");

		const prefix = targetInfo.id.slice(0, 8);
		const specificManager = await resolveSessionManager({
			workspaceRoot: project.root,
			sessionsDir,
			resume: { kind: "specific", idOrPrefix: prefix },
		});

		expect(JSON.stringify(specificManager.getEntries())).toContain("prefix-target");
	});

	it("'specific' with an unknown id throws a clear, catchable SessionNotFoundError instead of silently starting fresh", async () => {
		const sessionsDir = resolveConductorSessionsDir(project.root);
		await expect(
			resolveSessionManager({
				workspaceRoot: project.root,
				sessionsDir,
				resume: { kind: "specific", idOrPrefix: "does-not-exist" },
			}),
		).rejects.toThrow(SessionNotFoundError);
	});
});
