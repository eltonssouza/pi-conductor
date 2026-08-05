/**
 * Outer acceptance test for the `conductor` dispatcher (docs/adr/0002-fase1-cli-foundation.md §7) --
 * Gate 5, mirrors conductor-runtime's acceptance.test.ts / conductor-project's outside-in style: one
 * command invocation, one behavior, driven exactly the way `bin/conductor.js` drives it (argv in,
 * exit code + stdout/stderr out), against a real scratch filesystem -- never mocked.
 */

import { readConfig } from "@conductor/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { createCapturingIo } from "./support/io.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("conductor init (end-to-end)", () => {
	it("initializes a fresh project and exits 0", async () => {
		project.writeJson("package.json", { name: "demo", dependencies: { express: "4.0.0" } });
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["init"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/Initialized/);
		expect(readConfig(project.root).project.type).toBe("backend");
	});

	it("refuses a corrupt existing config without --force and exits non-zero", async () => {
		project.mkdir(".conductor");
		project.write(".conductor/config.json", "{ broken");
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["init"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/--force/);
	});

	it("accepts --force to reinitialize over a corrupt config", async () => {
		project.mkdir(".conductor");
		project.write(".conductor/config.json", "{ broken");
		const { io } = createCapturingIo(project.root);

		const code = await runCli(["init", "--force"], io);

		expect(code).toBe(0);
	});
});

describe("conductor doctor (end-to-end)", () => {
	it("runs all checks and exits 0 on an uninitialized-but-otherwise-healthy project", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["doctor"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/Overall: OK/);
		expect(stdout()).toMatch(/conductor init/);
	});

	it("exits non-zero when .conductor/config.json is corrupt", async () => {
		project.mkdir(".conductor");
		project.write(".conductor/config.json", "{ broken");
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["doctor"], io);

		expect(code).not.toBe(0);
		expect(stdout()).toMatch(/Overall: ISSUES FOUND/);
	});
});

describe("conductor config (end-to-end)", () => {
	it("show prints the redaction-safe summary after init", async () => {
		await runCli(["init"], createCapturingIo(project.root).io);
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["config", "show"], io);

		expect(code).toBe(0);
		const printed = JSON.parse(stdout());
		expect(printed.schema).toBe(1);
	});

	it("get reads a single key", async () => {
		await runCli(["init"], createCapturingIo(project.root).io);
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["config", "get", "provider.model"], io);

		expect(code).toBe(0);
		expect(stdout().trim()).toMatch(/^[^/\s]+\/[^/\s]+$/);
	});

	it("set writes a new value through writeConfig, and it round-trips via get", async () => {
		await runCli(["init"], createCapturingIo(project.root).io);
		const setCode = await runCli(
			["config", "set", "provider.model", "anthropic/claude-opus-4"],
			createCapturingIo(project.root).io,
		);
		expect(setCode).toBe(0);

		expect(readConfig(project.root).provider.model).toBe("anthropic/claude-opus-4");
	});

	it("set exits non-zero and writes nothing for an unsettable key", async () => {
		await runCli(["init"], createCapturingIo(project.root).io);
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["config", "set", "project.technologies", '["x"]'], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/not settable/);
	});
});

describe(
	"conductor chat (end-to-end -- fail-fast paths only; the happy path needs an injectable " +
		"terminal/model-runtime and is covered by test/commands/chat.test.ts instead, so this suite " +
		"never blocks on a real TUI attached to the test process's stdio)",
	() => {
		it("points the user at `conductor init` when no .conductor/config.json exists yet", async () => {
			const { io, stderr } = createCapturingIo(project.root);

			const code = await runCli(["chat"], io);

			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/conductor init/);
		});

		it("rejects an unrecognized argument instead of silently ignoring it", async () => {
			await runCli(["init"], createCapturingIo(project.root).io);
			const { io, stderr } = createCapturingIo(project.root);

			const code = await runCli(["chat", "--bogus"], io);

			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/unrecognized argument/);
		});
	},
);

describe("conductor (no command / unknown command)", () => {
	it("prints usage and exits non-zero with no command", async () => {
		const { io, stdout, stderr } = createCapturingIo(project.root);
		const code = await runCli([], io);
		expect(code).not.toBe(0);
		expect(stdout() + stderr()).toMatch(/conductor/i);
	});

	it("prints usage and exits 0 for --help", async () => {
		const { io, stdout } = createCapturingIo(project.root);
		const code = await runCli(["--help"], io);
		expect(code).toBe(0);
		expect(stdout()).toMatch(/conductor/);
	});

	it("rejects an unknown command clearly", async () => {
		const { io, stderr } = createCapturingIo(project.root);
		const code = await runCli(["frobnicate"], io);
		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unknown command/);
	});
});
