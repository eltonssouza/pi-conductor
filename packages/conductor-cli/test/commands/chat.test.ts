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
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConductorAgentDir, resolveConductorSessionsDir } from "../../src/commands/chat/session-resolution.ts";
import { runChat } from "../../src/commands/chat.ts";
import { registerFakeModel } from "../support/fake-model.ts";
import { FakeTerminal } from "../support/fake-terminal.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

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
