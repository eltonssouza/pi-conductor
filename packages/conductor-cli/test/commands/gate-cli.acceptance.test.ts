/**
 * Test-first (Gate 5) end-to-end dispatch for `conductor gate *` (src/cli.ts's `runGateCommand`) —
 * Fase 4 "Gates e evidências". Mirrors `test/commands/roles.test.ts`'s own "end-to-end dispatch"
 * section style.
 *
 * Two classes of assertion here, deliberately distinguished (see this project's own Gate 5 note on
 * this point): argument-SHAPE validation (unknown subcommand, missing/extra arguments) is real,
 * ordinary CLI plumbing — the same kind `roles.test.ts`/`skills.test.ts` already exercise GREEN against
 * their own already-implemented commands — and is expected to pass today. Every assertion about
 * SUBSTANTIVE gate behavior (status actually reflecting state, start enforcing sequencing, approve
 * persisting a sign-off) fails RED today because `commands/gate.ts`'s `run*` functions are Gate-5
 * stubs that throw, and `createUnwiredGateStateStore()` deliberately fails closed until the parallel
 * GateStateStore stream's real store is wired in (Gate 6, pending integration — see
 * `commands/gate.ts`'s own header).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("conductor gate (end-to-end dispatch) -- argument shape (real, GREEN today)", () => {
	it("rejects an unknown gate subcommand with a non-zero exit and a usage hint on stderr", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "bogus"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unknown subcommand/);
	});

	it("rejects extra arguments to `gate status`", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "status", "extra"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unrecognized argument/);
	});

	it("rejects `gate start` with no gate number", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "start"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/gate number/);
	});

	it("rejects `gate start` with a non-numeric gate", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "start", "banana"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/not a valid gate number/);
	});

	it("rejects `gate evidence` with no --ref (a bare --note is not evidence, FR-5)", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "evidence", "--gate", "5", "--kind", "file", "--note", "trust me"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/--ref is required/);
	});

	it("rejects `gate reject` with no --reason", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "reject"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/--reason/);
	});

	it("rejects `gate calibrate` with a non-numeric --collapse entry", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "calibrate", "--collapse", "1,banana"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/--collapse must be/);
	});
});

describe("conductor gate (end-to-end dispatch) -- substantive behavior (RED today, pending Gate 6)", () => {
	it("`gate status` shows the demand's observable state (FR-4)", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["gate", "status"], io);

		expect(code).toBe(0);
		expect(stdout()).toContain("currentGate");
	});

	it("`gate start 1` opens gate 1 for a fresh demand (FR-1)", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["gate", "start", "1"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/in-progress/);
	});

	it("`gate start 5` refuses to skip mandatory gate 3 (FR-2/R23)", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "start", "5"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/gate 3/);
	});

	it("`gate evidence` attaches a resolvable ref to the current gate (FR-5)", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(
			["gate", "evidence", "--gate", "1", "--kind", "test-run", "--ref", "run-42"],
			io,
		);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/evidence/i);
	});

	it("`gate approve` (headless, no interactive channel wired) never fabricates a human sign-off -- needs-human (FR-11/R22)", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["gate", "approve"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/needs-human/);
	});

	it("`gate reject --reason` marks the current gate rejected (FR-9)", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["gate", "reject", "--reason", "found a real gap"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/rejected/);
	});

	it("`gate calibrate --collapse 3` refuses to collapse a mandatory gate (R24)", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "calibrate", "--collapse", "3"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/mandatory/i);
	});
});
