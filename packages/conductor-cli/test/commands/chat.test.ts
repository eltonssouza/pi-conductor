/**
 * `commands/chat.ts` (`runChat`) -- docs/adr/0002-fase1-cli-foundation.md §7.4, Gate 5 (red first).
 *
 * Fail-fast paths are also covered end-to-end via `runCli` in test/cli.acceptance.test.ts; this file
 * covers what that acceptance suite deliberately cannot (a real TUI attached to the test process's
 * stdio would hang) -- by injecting `terminal`/`createModelRuntime`, this file drives the FULL happy
 * path: real session, real custom system prompt, real TUI start/stop, a real (scripted) model
 * exchange, and a clean exit -- the manual proof the task also requires, made deterministic and
 * repeatable as an automated test rather than only a one-off transcript.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeConfig } from "@conductor/config";
import { openJournalReader } from "@conductor/diary";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatRole } from "../../src/commands/chat/role-resolution.ts";
import { resolveConductorAgentDir, resolveConductorSessionsDir } from "../../src/commands/chat/session-resolution.ts";
import { buildRoleSessionOverrides, runChat } from "../../src/commands/chat.ts";
import { resolveJournalContext } from "../../src/commands/journal.ts";
import { registerFakeModel } from "../support/fake-model.ts";
import { FakeTerminal } from "../support/fake-terminal.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";
import { createScratchHome, type ScratchHome } from "../support/scratch-home.ts";

// Generous default: these tests spin up a REAL ModelRuntime + AgentSession + git subprocess calls,
// which slow down noticeably when the whole package's suite runs its many other real-session tests
// concurrently (observed directly: a 5s default flaked intermittently under full-suite load, while
// every step reliably completes well within 20s even then). Each `it(...)` below still carries its
// own outer timeout as a final safety net.
async function waitUntil(predicate: () => boolean, timeoutMs = 20_000, intervalMs = 10): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitUntil: condition never became true");
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function writeValidConfig(root: string, modelId = "conductor-cli-fake-1", providerId = "conductor-fake") {
	writeConfig(root, {
		schema: 1,
		project: {
			type: "backend",
			technologies: ["Node/TypeScript"],
			evidence: ["package.json"],
			detectedAt: new Date().toISOString(),
		},
		workspace: { root: "." },
		provider: { model: `${providerId}/${modelId}` },
	});
}

describe("runChat -- fail-fast paths (never touch a terminal)", () => {
	it("returns a clear error and exit code 1 when .conductor/config.json does not exist", async () => {
		const { io, stderr } = createCapturingIo(project.root);
		const code = await runChat({ cwd: project.root, args: [], stdout: io.stdout, stderr: io.stderr });

		expect(code).toBe(1);
		expect(stderr()).toMatch(/conductor init/);
	});

	it("returns a clear error when the configured model cannot be resolved", async () => {
		writeValidConfig(project.root, "does-not-exist");
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			createModelRuntime: async () =>
				ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				}),
		});

		expect(code).toBe(1);
		expect(stderr()).toMatch(/not found/);
		expect(stderr()).toMatch(/conductor doctor/);
	});

	it("returns a clear error for --resume of an id that does not exist, instead of silently starting fresh", async () => {
		writeValidConfig(project.root);
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runChat({
			cwd: project.root,
			args: ["--resume", "no-such-session"],
			stdout: io.stdout,
			stderr: io.stderr,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: "unused" }]);
				return runtime;
			},
		});

		expect(code).toBe(1);
		expect(stderr()).toMatch(/no session matching/);
	});
});

describe("runChat -- full happy path (injected FakeTerminal + scripted model, no real network/TTY)", () => {
	it("starts a real session with the custom prompt, exchanges one real (scripted) message, " +
		"persists under .conductor/sessions/, and exits cleanly on /exit", async () => {
		writeValidConfig(project.root);
		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		const runPromise = runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: "hello from the assistant" }]);
				return runtime;
			},
		});

		// The TUI has started and rendered its first status line (proves the "TUI inicial" +
		// "prompt customizado" wiring reached a live, rendering session).
		await waitUntil(() => terminal.allWrites().includes("conductor-fake/conductor-cli-fake-1"));

		terminal.sendInput("hi there");
		terminal.sendInput("\r");

		await waitUntil(() => terminal.allWrites().includes("hello from the assistant"));

		terminal.sendInput("/exit");
		terminal.sendInput("\r");

		const exitCode = await runPromise;
		expect(exitCode).toBe(0);

		// "sessão persistente" scoped per-project, not a global default location.
		const sessionsDir = resolveConductorSessionsDir(project.root);
		expect(existsSync(sessionsDir)).toBe(true);
		const { readdirSync } = await import("node:fs");
		const sessionFiles = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
		expect(sessionFiles.length).toBeGreaterThan(0);
	}, 45_000);

	it("Gate 8 loop-back (G3/FR-5/FR-6): the real built-in skill catalog reaches the model's system " +
		"prompt via progressive disclosure -- name+description+location only, never a skill's own body", async () => {
		writeValidConfig(project.root);
		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		let fakeModel: ReturnType<typeof registerFakeModel> | undefined;
		const runPromise = runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				fakeModel = registerFakeModel(runtime, "conductor-fake", [{ text: "hello from the assistant" }]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("conductor-fake/conductor-cli-fake-1"));

		terminal.sendInput("hi there");
		terminal.sendInput("\r");

		await waitUntil(() => terminal.allWrites().includes("hello from the assistant"));

		const prompt = fakeModel?.lastSystemPrompt();
		expect(prompt).toBeTruthy();
		// A real, ported skill (backend-engineer's own primary skill, templates/skills/design-service/
		// SKILL.md) -- proves the 44-skill catalog `loadRealRoleRegistryAndSkills` builds actually
		// reached `createConductorSession`'s `additionalSkillPaths`, not merely `conductor skills
		// list`'s own, separately-wired catalog (the Gate 8 finding: the catalog was correct but never
		// reached a live session).
		expect(prompt).toContain("design-service");
		expect(prompt).toContain(
			"Use when creating or modifying a service or API, by defining the contract and data model",
		);
		// Progressive disclosure (FR-5): the skill's own body text (only in the SKILL.md file on
		// disk) never leaks into the prompt itself.
		expect(prompt).not.toContain("Choose a justified consistency/index strategy.");

		terminal.sendInput("/exit");
		terminal.sendInput("\r");
		expect(await runPromise).toBe(0);
	}, 45_000);

	it("also exits cleanly on Ctrl+C, the other exit mechanism the task requires alongside /exit", async () => {
		writeValidConfig(project.root);
		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		const runPromise = runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: "unused-in-this-test" }]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("conductor-fake/conductor-cli-fake-1"));

		terminal.sendInput("\x03"); // Ctrl+C (ETX)

		const exitCode = await runPromise;
		expect(exitCode).toBe(0);
	}, 20_000);

	it("resumes a prior session's history on --resume, visible in the replayed transcript", async () => {
		writeValidConfig(project.root);
		const agentDir = resolveConductorAgentDir(project.root);
		const sessionsDir = resolveConductorSessionsDir(project.root);

		// Drive one prior turn directly (round A's own pattern) to produce real history to resume.
		const { createConductorSession } = await import("@conductor/runtime");
		const priorRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const priorFakeModel = registerFakeModel(priorRuntime, "conductor-fake", [{ text: "prior-turn-marker-text" }]);
		const { SessionManager } = await import("@earendil-works/pi-coding-agent");
		const priorSession = await createConductorSession({
			workspaceRoot: project.root,
			model: priorFakeModel.model,
			modelRuntime: priorRuntime,
			agentDir,
			sessionManager: SessionManager.create(project.root, sessionsDir),
		});
		await priorSession.session.prompt("first turn");
		priorSession.dispose();

		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		const runPromise = runChat({
			cwd: project.root,
			args: ["--resume"],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(agentDir, "auth.json"),
					modelsPath: join(agentDir, "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: "unused-in-this-test" }]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("prior-turn-marker-text"));

		terminal.sendInput("/exit");
		terminal.sendInput("\r");
		expect(await runPromise).toBe(0);
	}, 45_000);
});

/**
 * `conductor chat --role <slug>` (Gate 6 real-wiring loop-back, gate2-spec-fase3.md FR-1/FR-2; ADR
 * 0004 §16 appendix). `role-resolution.ts` now resolves against the REAL, file-backed 37-role
 * catalog (a parallel Gate 6 stream's `role-catalog.ts`/`builtin-roles-data.ts`) instead of the small
 * hand-written placeholder this file used to test against. That real catalog surfaced GAP 2 (the
 * orchestrator's finding): no built-in role declares a `tools` allowlist yet, so `role.tools` is `[]`
 * for every one of the 37 roles today -- the second test below pins `chat.ts`'s own fail-closed
 * refusal for that case, replacing the old "restricts tools"/"uses persona" tests, which depended on
 * the placeholder's own non-empty, made-up tools lists that no real role actually has. The mechanism
 * those old tests proved (`toolsOverride`/`systemPromptOverride` actually reaching the live session)
 * is still covered, independent of real per-role data: `buildRoleSessionOverrides`'s own unit test
 * below (a pure function, synthetic `ChatRole` fixture) plus
 * `packages/conductor-runtime/test/session-role-overrides.test.ts` (the live-session mechanism, one
 * layer down, exercised directly via `toolsOverride`/`systemPromptOverride` rather than through a
 * resolved `ChatRole`).
 */
describe("runChat -- --role <slug> (Fase 3, FR-1/FR-2)", () => {
	it("returns a clear error and exit code 1 for an unknown role, before any session/terminal is touched", async () => {
		writeValidConfig(project.root);
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runChat({
			cwd: project.root,
			args: ["--role", "role-that-does-not-exist"],
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).toBe(1);
		expect(stderr()).toMatch(/unknown role "role-that-does-not-exist"/);
	});

	it(
		"FR-2: a typo close to a real role id gets a 'Did you mean' suggestion end-to-end through the " +
			"real CLI, not only in the isolated resolveRole() unit test -- Gate 8 finding: describeUnknownChatRole " +
			"discarded resolveRole()'s own suggestion field, so `conductor chat --role backedn-engineer` listed " +
			"all 37 roles instead of naming the one obvious fix (gate2-spec-fase3.md FR-2's own worked example).",
		async () => {
			writeValidConfig(project.root);
			const { io, stderr } = createCapturingIo(project.root);

			const code = await runChat({
				cwd: project.root,
				args: ["--role", "backedn-engineer"],
				stdout: io.stdout,
				stderr: io.stderr,
			});

			expect(code).toBe(1);
			expect(stderr()).toMatch(/unknown role "backedn-engineer"/);
			expect(stderr()).toMatch(/Did you mean "backend-engineer"/);
		},
	);

	it(
		"GAP 2: refuses a real role that does not declare a tools allowlist yet, instead of silently " +
			"opening a session with zero usable tools -- exit code 1, before any session/terminal is touched",
		async () => {
			writeValidConfig(project.root);
			const { io, stderr } = createCapturingIo(project.root);

			// "backend-engineer" is a real, registered built-in role (role-catalog.ts's own real
			// templates/agents/backend-engineer.md) -- and, like every one of the 37 today, its `tools`
			// is `[]` (role-catalog.ts's own documented gap). Before Gap 2's fix this would have opened a
			// real session with no tools at all, silently; now it must be refused up front.
			const code = await runChat({
				cwd: project.root,
				args: ["--role", "backend-engineer"],
				stdout: io.stdout,
				stderr: io.stderr,
			});

			expect(code).toBe(1);
			expect(stderr()).toMatch(/role "backend-engineer" does not declare a tools allowlist yet/);
			expect(stderr()).toMatch(/Run `conductor chat` without --role/);
		},
	);
});

describe("buildRoleSessionOverrides -- the --role override mechanism, independent of real per-role data", () => {
	it("returns no overrides when no role was resolved (round A/B1's unrestricted shape, unchanged)", () => {
		expect(buildRoleSessionOverrides(undefined)).toEqual({});
	});

	it(
		"threads a resolved role's own tools/systemPrompt through verbatim -- proven against a synthetic " +
			"fixture since no real built-in role declares tools yet (Gap 2)",
		() => {
			const fixtureRole: ChatRole = {
				name: "fixture-role",
				description: "A synthetic role fixture -- not a real built-in role.",
				systemPrompt: "You are a fixture role.",
				tools: ["read"],
				modelRole: "standard",
				skills: [],
				canSpawn: [],
				gates: [],
				source: "builtin",
				contentHash: "0".repeat(64),
				filePath: "/dev/null",
			};

			expect(buildRoleSessionOverrides(fixtureRole)).toEqual({
				toolsOverride: ["read"],
				systemPromptOverride: "You are a fixture role.",
			});
		},
	);
});

/**
 * T14 gap (gate3-fase1-addendum.md §2 T14; ADR 0002 §7.4, "o transcrito"; Gate 8 finding §6.1,
 * docs/conductor/gate8-validation-fase1.md): confirm.ts's sanitization only ever protected the
 * approval-dialog sink (proven adversarially by tui-integration.test.ts). The live chat transcript
 * -- the SECOND sink the same ADR names explicitly -- rendered model/tool-controlled text raw. These
 * two tests mirror tui-integration.test.ts's adversarial pattern (a real CSI clear-screen+cursor-home
 * sequence, asserted absent from the real FakeTerminal's raw write stream) but drive it through
 * `runChat`'s own real event-subscription wiring, exercising the exact two call sites Gate 8 named:
 * chat.ts:258-261 (live `message_end`) below, and chat.ts:197-198 (resume-replay) in the second test.
 */
describe("runChat -- live transcript sanitization (T14 gap, gate8-validation-fase1.md §6.1)", () => {
	it("strips a real ANSI escape sequence embedded in the assistant's live reply before it reaches the terminal's raw write stream", async () => {
		writeValidConfig(project.root);
		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		// Plain-text marker either side of a real CSI clear-screen+cursor-home sequence -- the same
		// payload shape tui-integration.test.ts already proved adversarial for the confirm-dialog sink.
		const maliciousReply = "hello\x1b[2J\x1b[HTOTALLY-SAFE-LOOKING-TEXT";

		const runPromise = runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: maliciousReply }]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("conductor-fake/conductor-cli-fake-1"));

		terminal.sendInput("hi there");
		terminal.sendInput("\r");

		await waitUntil(() => terminal.allWrites().includes("TOTALLY-SAFE-LOOKING-TEXT"));

		const written = terminal.allWrites();
		expect(written).toContain("TOTALLY-SAFE-LOOKING-TEXT"); // plain text: preserved
		expect(written).toContain("hello"); // plain text: preserved
		expect(written).not.toContain("\x1b[2J"); // the injected clear-screen CSI sequence: stripped
		expect(written).not.toContain("\x1b[H"); // the injected cursor-home CSI sequence: stripped

		terminal.sendInput("/exit");
		terminal.sendInput("\r");
		expect(await runPromise).toBe(0);
	}, 45_000);

	it("strips a real ANSI escape sequence from a prior turn replayed on --resume, not just live turns", async () => {
		writeValidConfig(project.root);
		const agentDir = resolveConductorAgentDir(project.root);
		const sessionsDir = resolveConductorSessionsDir(project.root);

		const { createConductorSession } = await import("@conductor/runtime");
		const priorRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const maliciousPriorReply = "replayed\x1b[2J\x1b[HTOTALLY-SAFE-REPLAYED-TEXT";
		const priorFakeModel = registerFakeModel(priorRuntime, "conductor-fake", [{ text: maliciousPriorReply }]);
		const { SessionManager } = await import("@earendil-works/pi-coding-agent");
		const priorSession = await createConductorSession({
			workspaceRoot: project.root,
			model: priorFakeModel.model,
			modelRuntime: priorRuntime,
			agentDir,
			sessionManager: SessionManager.create(project.root, sessionsDir),
		});
		await priorSession.session.prompt("first turn");
		priorSession.dispose();

		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		const runPromise = runChat({
			cwd: project.root,
			args: ["--resume"],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(agentDir, "auth.json"),
					modelsPath: join(agentDir, "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: "unused-in-this-test" }]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("TOTALLY-SAFE-REPLAYED-TEXT"));

		const written = terminal.allWrites();
		expect(written).toContain("TOTALLY-SAFE-REPLAYED-TEXT");
		expect(written).toContain("replayed");
		expect(written).not.toContain("\x1b[2J");
		expect(written).not.toContain("\x1b[H");

		terminal.sendInput("/exit");
		terminal.sendInput("\r");
		expect(await runPromise).toBe(0);
	}, 45_000);
});

/**
 * Gate 6 real-wiring loop-back (Gap 1, the orchestrator's finding): before this fix,
 * `createConductorSession`'s own `tools: [...]` array never named "task" for a REAL `conductor chat`
 * invocation -- `taskDelegation` was never built by `runChat`. This test drives `task` through the
 * literal, unmodified `runChat` entry point (the exact function `conductor chat` invokes), not a
 * hand-assembled equivalent call -- `test/commands/chat/task-delegation.test.ts` covers the deeper
 * authorization/evidence/denial semantics (against the same real role registry) by calling
 * `createConductorSession` directly, the way `runChat` itself does internally.
 */
describe("runChat -- task delegation reachable at the real command entry point (Gap 1)", () => {
	it('"task" is a genuinely reachable tool of a real `conductor chat` session -- the permission-gate\'s own real task branch asks for approval, naming the target role', async () => {
		writeValidConfig(project.root);
		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		const runPromise = runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [
					{ toolCalls: [{ name: "task", args: { role: "sdet", prompt: "Summarize the test strategy." } }] },
					{ text: "delegation attempt finished" },
				]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("conductor-fake/conductor-cli-fake-1"));
		terminal.sendInput("delegate a task to sdet");
		terminal.sendInput("\r");

		// The permission-gate's REAL "task" branch (permission-gate.ts) rendered a real approval
		// overlay naming the target role -- an unregistered tool name would never reach the gate as a
		// decision at all (role-resolution.test.ts's own header documents that stronger contrast), so
		// this overlay appearing IS the proof "task" is a genuinely reachable tool of this session.
		await waitUntil(() => terminal.allWrites().includes('Approve delegating to role "sdet"?'));
		terminal.sendInput("\r"); // Enter = approve (default first choice)

		// Approving lets runTask actually attempt a real child spawn (a second, real
		// ModelRuntime.create() + AgentSession construction, which then fails gracefully -- no model
		// is configured for the child in this test -- before the outer session's own second scripted
		// response completes the turn). That is genuinely more real work than this file's other tests
		// do after their own approval step, so this wait gets extra headroom under full-suite
		// concurrent load (this file's own "generous default" reasoning, observed directly: 20s
		// occasionally wasn't enough here specifically, while every other test in this file reliably
		// clears it well within 20s).
		await waitUntil(() => terminal.allWrites().includes("delegation attempt finished"), 40_000);

		terminal.sendInput("/exit");
		terminal.sendInput("\r");
		expect(await runPromise).toBe(0);
	}, 60_000);
});

/**
 * Gate 6 real-wiring loop-back (Grupo F "captura automática", the FASE'S OWN NAME -- ADR 0007 §7/D5,
 * FR-14..18, docs/adr/0007-fase6-diary-and-capture.md). `curateCaptureEvent`
 * (packages/conductor-diary/src/capture.ts) was implemented and unit-tested at Gate 5 but never called
 * from any production path before this wiring pass -- these tests drive the literal, unmodified
 * `runChat` entry point (the exact function `conductor chat` invokes) and then open a REAL
 * `JournalReader` over the SAME scratch `homeDir` to confirm a genuine entry landed on disk, never a
 * mock of `curateCaptureEvent`/`openJournalWriter` themselves (those are already covered in isolation by
 * `packages/conductor-diary/test/capture.test.ts`; what was missing, and what this proves, is that
 * `chat.ts` actually CALLS them).
 *
 * `homeDir` is always the scratch dir from `createScratchHome()` (see `ChatOptions.homeDir`'s own doc
 * comment) -- this suite never touches this developer's real `~/.conductor/diary`.
 */
describe("runChat -- automatic capture wiring closure (Grupo F, ADR 0007 D5/FR-14..18)", () => {
	let home: ScratchHome;

	beforeEach(() => {
		home = createScratchHome();
	});

	afterEach(() => {
		home.cleanup();
	});

	it("captures a turn-end diary entry after a real turn settles, and a session-shutdown entry on " +
		"exit -- both minimized (T61: never the assistant's own verbatim reply text)", async () => {
		writeValidConfig(project.root);
		const terminal = new FakeTerminal();
		const { io } = createCapturingIo(project.root);

		// A long, distinctive assistant reply -- if minimization were broken (the captured summary
		// echoing message content instead of a structural "turn concluded" metric), it would show up
		// verbatim in the diary; this proves it never does.
		const longAssistantReply =
			"This sentence is deliberately long and distinctive so a minimization regression would be " +
			"obvious: CAPTURE-MINIMIZATION-CANARY-f3a9. ".repeat(4);

		const runPromise = runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			terminal,
			homeDir: home.dir,
			createModelRuntime: async () => {
				const runtime = await ModelRuntime.create({
					authPath: join(project.root, ".conductor", "auth.json"),
					modelsPath: join(project.root, ".conductor", "models.json"),
					allowModelNetwork: false,
				});
				registerFakeModel(runtime, "conductor-fake", [{ text: longAssistantReply }]);
				return runtime;
			},
		});

		await waitUntil(() => terminal.allWrites().includes("conductor-fake/conductor-cli-fake-1"));
		terminal.sendInput("hi there");
		terminal.sendInput("\r");
		await waitUntil(() => terminal.allWrites().includes("CAPTURE-MINIMIZATION-CANARY-f3a9"));

		// Turn-end capture is synchronous and fires as part of the SAME event chain that renders the
		// assistant's reply (agent_settled, after message_end) -- by the time the terminal shows the
		// reply, the diary write has already happened, before the session is even asked to exit. This
		// proves turn-end capture specifically, independent of session-shutdown capture below.
		const { entriesPath } = resolveJournalContext(project.root, home.dir);
		const afterTurn = openJournalReader(entriesPath, "").readAll();
		expect(afterTurn.length).toBeGreaterThan(0);
		const turnEndEntry = afterTurn.find((e) => e.source === "capture" && e.text.includes("turn concluded"));
		expect(turnEndEntry).toBeDefined();
		expect(turnEndEntry?.gate).toBeUndefined(); // no --gate context in a chat session (documented choice)

		// T61 (minimization): NO captured entry ever contains the assistant's own verbatim reply text.
		for (const entry of afterTurn) {
			expect(entry.text).not.toContain("CAPTURE-MINIMIZATION-CANARY-f3a9");
			expect(entry.text.length).toBeLessThan(longAssistantReply.length);
		}

		terminal.sendInput("/exit");
		terminal.sendInput("\r");
		const exitCode = await runPromise;
		expect(exitCode).toBe(0);

		// Session-shutdown capture: a NEW entry appears after exit, beyond what turn-end already wrote.
		const afterShutdown = openJournalReader(entriesPath, "").readAll();
		expect(afterShutdown.length).toBeGreaterThan(afterTurn.length);
		const shutdownEntry = afterShutdown.find((e) => e.source === "capture" && e.text.includes("session ended"));
		expect(shutdownEntry).toBeDefined();
		expect(shutdownEntry?.kind).toBe("checkpoint");

		// Every captured entry this test produced is real, on-disk, source:"capture" -- never
		// source:"manual"/"document" (D3/D5's own required distinction).
		for (const entry of afterShutdown) {
			if (entry.text.includes("turn concluded") || entry.text.includes("session ended")) {
				expect(entry.source).toBe("capture");
			}
		}
	}, 45_000);

	it("captures nothing when the session never reaches a settled turn (fail-fast paths stay silent)", async () => {
		// No .conductor/config.json written -- runChat fails fast, before any session/journalWriter is
		// even constructed. Nothing should appear on disk at all (the entries.jsonl file is never even
		// created -- openJournalReader's own fail-closed "missing file -> []" contract covers this).
		const { io } = createCapturingIo(project.root);
		const code = await runChat({
			cwd: project.root,
			args: [],
			stdout: io.stdout,
			stderr: io.stderr,
			homeDir: home.dir,
		});
		expect(code).toBe(1);

		const { entriesPath } = resolveJournalContext(project.root, home.dir);
		expect(openJournalReader(entriesPath, "").readAll()).toEqual([]);
	});
});
