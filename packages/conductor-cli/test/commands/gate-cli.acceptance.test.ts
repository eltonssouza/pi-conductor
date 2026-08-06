/**
 * End-to-end dispatch for `conductor gate *` (src/cli.ts's `runGateCommand`) — Fase 4 "Gates e
 * evidências". Mirrors `test/commands/roles.test.ts`'s own "end-to-end dispatch" section style.
 *
 * Two classes of assertion here, deliberately distinguished (see this project's own Gate 5 note on
 * this point): argument-SHAPE validation (unknown subcommand, missing/extra arguments) is real,
 * ordinary CLI plumbing — the same kind `roles.test.ts`/`skills.test.ts` already exercise GREEN against
 * their own already-implemented commands. SUBSTANTIVE gate behavior (status reflecting state, start
 * enforcing sequencing, approve persisting a sign-off) now runs against the REAL, PERSISTED
 * `GateStateStoreView` (`commands/gate-store.ts`'s `createPersistedGateStateStore`, Gate 6 wiring
 * closure) — a genuine end-to-end proof, not the former in-process-only stand-in.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
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

/** Mirrors `test/git-status.test.ts`'s own real `git init`/`git commit` helper — never mocked. */
function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
		.toString()
		.trim();
}

function initRepoWithOneCommit(root: string, branch: string): string {
	git(["init", "--initial-branch", branch], root);
	git(["config", "user.email", "conductor-test@example.invalid"], root);
	git(["config", "user.name", "Conductor Test"], root);
	git(["add", "."], root);
	git(["commit", "-m", "initial"], root);
	return git(["rev-parse", "HEAD"], root);
}

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

describe("conductor gate (end-to-end dispatch) -- substantive behavior, against the REAL persisted store", () => {
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

	it("`gate evidence` attaches a resolvable ref to the current gate (FR-5, real resolveEvidenceRef Tier-1 resolution)", async () => {
		const { io, stdout } = createCapturingIo(project.root);
		// A `--kind test-run` ref would ALWAYS refuse today (no durable runtime ledger exists yet, Fase 6
		// scope -- gate-evidence.ts's own documented contract), so a genuinely resolvable ref for this
		// generic "attaches evidence" test is a real FILE inside the workspace (Tier-1: existsSync +
		// isWithinRoot, no ledger required).
		project.write("evidence.txt", "proof");
		const evidencePath = join(project.root, "evidence.txt");

		const code = await runCli(["gate", "evidence", "--gate", "1", "--kind", "file", "--ref", evidencePath], io);

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

	// -----------------------------------------------------------------------------------------------
	// Gate 6 wiring-closure integration tests (Fase 4 pendency 1): the state PERSISTED store, proven
	// end-to-end -- two SEPARATE `runCli` calls, never the same in-memory object held alive across them
	// (that would only prove the FAKE/former in-memory store worked, not real persistence).
	// -----------------------------------------------------------------------------------------------

	it("`gate status` after `gate approve` survives a fresh store construction -- state is PERSISTED on disk, not held only in an in-memory object (Fase 4's own promise, real createGateStateStore wiring)", async () => {
		const first = createCapturingIo(project.root);
		const approveCode = await runCli(["gate", "approve"], first.io);
		expect(approveCode).toBe(0);
		expect(first.stdout()).toMatch(/needs-human/);

		// A SEPARATE runCli call -- runGateCommand constructs a brand-new store adapter from scratch
		// here, exactly as a later, separate `conductor gate status` OS process would. Nothing keeps the
		// first call's in-memory object alive across this boundary; only the on-disk envelope under
		// project.root/.conductor/gates bridges the two calls.
		const second = createCapturingIo(project.root);
		const statusCode = await runCli(["gate", "status"], second.io);

		expect(statusCode).toBe(0);
		expect(second.stdout()).toMatch(/needs-human/);
	});

	it("`gate evidence` attached in one `runCli` call is visible in `gate status` from a SEPARATE `runCli` call (persisted evidenceCount, not in-memory)", async () => {
		project.write("evidence.txt", "proof");
		const evidencePath = join(project.root, "evidence.txt");

		const first = createCapturingIo(project.root);
		const evidenceCode = await runCli(
			["gate", "evidence", "--gate", "1", "--kind", "file", "--ref", evidencePath],
			first.io,
		);
		expect(evidenceCode).toBe(0);

		const second = createCapturingIo(project.root);
		const statusCode = await runCli(["gate", "status"], second.io);

		expect(statusCode).toBe(0);
		expect(second.stdout()).toMatch(/evidence=1/);
	});

	// -----------------------------------------------------------------------------------------------
	// Gate 6 wiring-closure integration tests (Fase 4 pendency 3): `gate evidence --kind git-commit`
	// against a REAL git repository, driven through the real `resolveEvidenceRef` (never a stub).
	// -----------------------------------------------------------------------------------------------

	it("`gate evidence --kind git-commit` resolves a REAL commit sha via resolveEvidenceRef and attaches it (R25/T41 wiring)", async () => {
		project.write("README.md", "hello\n");
		const sha = initRepoWithOneCommit(project.root, "feature/fase4-demo");
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["gate", "evidence", "--gate", "1", "--kind", "git-commit", "--ref", sha], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/evidence/i);
	});

	it("`gate evidence --kind git-commit` refuses fail-closed for a sha that does not resolve in this repo (R25/T41, real resolveEvidenceRef, never attached)", async () => {
		project.write("README.md", "hello\n");
		initRepoWithOneCommit(project.root, "feature/fase4-demo");
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(
			[
				"gate",
				"evidence",
				"--gate",
				"1",
				"--kind",
				"git-commit",
				"--ref",
				"0000000000000000000000000000000000000000",
			],
			io,
		);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/does not resolve/);
	});
});
