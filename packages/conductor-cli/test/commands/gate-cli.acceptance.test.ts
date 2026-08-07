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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";
import { fakeTtyStreams } from "../support/tty.ts";

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

	it("rejects `gate start` with a gate number above the flow's 14 gates (out-of-range, not just non-numeric)", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "start", "15"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/not a valid gate number/);
	});

	it("rejects `gate start 0` (gate numbers are 1-indexed, 0 is never valid)", async () => {
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["gate", "start", "0"], io);

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

	// GATE 6 LOOP-BACK NOTE: a real interactive TTY channel now exists (tty-confirm.ts) -- see the
	// dedicated "REAL TTY confirmation channel" describe block below for its positive-path tests. This
	// test's own scenario (no `io.tty` supplied at all -- the plain CliIO shape most callers still use)
	// remains a genuinely headless invocation, so its assertion is unchanged: never fabricates "human".
	it("`gate approve` (no `tty` supplied on CliIO -- headless) never fabricates a human sign-off -- needs-human (FR-11/R22)", async () => {
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

	// GATE 8 (QA validation) finding: ADR 0005 §5 bullet 3 explicitly requires "`gate status` mostra
	// quais gates foram colapsados e por qual método" (a reviewer sees the collapse trail without
	// reopening the session -- the whole point of G1/FR-4). Confirmed live against the real CLI: a
	// registered calibration IS persisted to disk correctly (verified by reading the raw envelope JSON
	// directly), but `gate status`'s own rendered report never mentions it at all -- `GateStatusSnapshot`
	// has no `calibration` field and `formatGateStatusReport` has no line for it. This is a real,
	// reproducible display/auditability gap, not a data-loss bug. RED test, mirrors this file's own
	// "substantive behavior" acceptance style (real CLI, real persisted store, two separate concerns:
	// registering the calibration and then reading it back via a plain `gate status`).
	it("`gate status` shows which gates were collapsed by calibration and by which method (ADR 0005 §5)", async () => {
		const calibrate = createCapturingIo(project.root);
		const calibrateCode = await runCli(["gate", "calibrate", "--collapse", "2,4"], calibrate.io);
		expect(calibrateCode).toBe(0);

		const status = createCapturingIo(project.root);
		const statusCode = await runCli(["gate", "status"], status.io);

		expect(statusCode).toBe(0);
		const output = status.stdout();
		expect(output).toMatch(/collaps/i); // "collapsed"/"collapse" -- wording is this test's business, not a fixed string
		expect(output).toContain("2");
		expect(output).toContain("4");
		expect(output).toMatch(/auto/); // headless confirm channel -> method "auto" (never fabricated "human")
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

	it("`gate evidence --kind git-commit` treats a shell-metacharacter-laden --ref as just an invalid sha -- never shell-interpreted (gitCommitExistsSync uses execFileSync's argv array, not a shell)", async () => {
		project.write("README.md", "hello\n");
		initRepoWithOneCommit(project.root, "feature/fase4-demo");
		const { io, stderr } = createCapturingIo(project.root);
		const maliciousRef = "$(touch injected.txt)`touch injected2.txt`; touch injected3.txt";

		const code = await runCli(["gate", "evidence", "--gate", "1", "--kind", "git-commit", "--ref", maliciousRef], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/does not resolve/);
		// The real proof: none of the injected side-effect files exist -- git-status.ts's
		// gitCommitExistsSync never spawns a shell (execFileSync with an argv array), so a payload
		// that WOULD run as a command under a shell is instead passed to `git rev-parse --verify`
		// as one inert, non-resolving revision string.
		expect(existsSync(join(project.root, "injected.txt"))).toBe(false);
		expect(existsSync(join(project.root, "injected2.txt"))).toBe(false);
		expect(existsSync(join(project.root, "injected3.txt"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------------
// GATE 6 LOOP-BACK (Gate 8's central finding): `status:"approved"` was structurally UNREACHABLE for
// ANY gate, confirmed live -- `cli.ts`'s confirm channel was hardcoded to always resolve `false` (no
// TTY branch existed at all), and a mandatory gate's evidence check accepted only "runtime-derived"
// provenance, which no CLI-fed evidence kind could ever produce (no Fase 6 ledger exists yet). These
// tests exercise BOTH fixes together through the REAL, end-to-end `runCli` dispatch (a real persisted
// store, a real git repo/commit, a simulated-but-real `readline` TTY prompt over in-memory streams --
// never calling `mintHumanApproval`/the store directly) -- the exact gap Gate 8's own finding named:
// "todo teste verde que alcança status approved chama o store diretamente, nenhum chama runCli."
// ---------------------------------------------------------------------------------------------------
describe("conductor gate approve -- REAL TTY confirmation channel (Gate 6 loop-back, decision 1)", () => {
	it('a simulated TTY answering "y" drives a NON-mandatory gate (Gate 1) all the way to a genuine status:"approved" -- the positive path that did not exist before this loop-back', async () => {
		const fake = fakeTtyStreams();
		const { io, stdout } = createCapturingIo(project.root, fake.streams);

		const approvePromise = runCli(["gate", "approve", "--gate", "1"], io);
		fake.answer("y");
		const code = await approvePromise;

		expect(code).toBe(0);
		expect(stdout()).toMatch(/\bapproved\b/);
		expect(stdout()).not.toMatch(/needs-human/);
	});

	it("the TTY prompt actually shows the gate number and the demand id (not a generic/blank prompt)", async () => {
		const fake = fakeTtyStreams();
		const { io } = createCapturingIo(project.root, fake.streams);

		const approvePromise = runCli(["gate", "approve", "--gate", "1", "--demand", "demo-demand"], io);
		fake.answer("y");
		await approvePromise;

		expect(fake.written()).toMatch(/gate 1/i);
		expect(fake.written()).toContain("demo-demand");
	});

	it('a simulated TTY answering "n" still refuses -- needs-human, never approved, even with a real interactive channel wired', async () => {
		const fake = fakeTtyStreams();
		const { io, stdout } = createCapturingIo(project.root, fake.streams);

		const approvePromise = runCli(["gate", "approve", "--gate", "1"], io);
		fake.answer("n");
		const code = await approvePromise;

		expect(code).toBe(0);
		expect(stdout()).toMatch(/needs-human/);
	});

	it("no `tty` on CliIO at all (the pre-existing headless default) still falls through to needs-human -- negative regression, the fail-closed default is unchanged by adding the positive path", async () => {
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runCli(["gate", "approve", "--gate", "1"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/needs-human/);
	});

	it("`tty` present but NOT a real terminal (isTTY:false on both streams -- e.g. piped/redirected) also falls through to needs-human, never prompts", async () => {
		const fake = fakeTtyStreams({ isTTY: false });
		const { io, stdout } = createCapturingIo(project.root, fake.streams);

		const code = await runCli(["gate", "approve", "--gate", "1"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/needs-human/);
		expect(fake.written()).toBe(""); // never even wrote a prompt -- headlessConfirmChannel, not the TTY one
	});

	// ---------------------------------------------------------------------------------------------
	// The full loop-back proof: a MANDATORY gate (3), a REAL git-commit evidence ref, a REAL
	// simulated-TTY approval -- reproduces exactly the live scenario Gate 8 confirmed was blocked
	// ("gate evidence --kind git-commit com SHA real ... gate approve --gate 3 AINDA recusa"), now
	// closing for real.
	// ---------------------------------------------------------------------------------------------
	it('a MANDATORY gate (3) closes for real: `gate start 3` -> a REAL git-commit evidence ref -> `gate approve` via simulated TTY "y" -> status:"approved" (Gate 6 loop-back decisions 1+2 together)', async () => {
		project.write("README.md", "hello\n");
		const sha = initRepoWithOneCommit(project.root, "feature/fase4-loopback-demo");

		const start = createCapturingIo(project.root);
		const startCode = await runCli(["gate", "start", "3"], start.io);
		expect(startCode).toBe(0);
		expect(start.stdout()).toMatch(/in-progress/);

		const evidence = createCapturingIo(project.root);
		const evidenceCode = await runCli(
			["gate", "evidence", "--gate", "3", "--kind", "git-commit", "--ref", sha],
			evidence.io,
		);
		expect(evidenceCode).toBe(0);

		const fake = fakeTtyStreams();
		const { io: approveIo, stdout: approveStdout } = createCapturingIo(project.root, fake.streams);
		const approvePromise = runCli(["gate", "approve", "--gate", "3"], approveIo);
		fake.answer("y");
		const approveCode = await approvePromise;

		expect(approveCode).toBe(0);
		expect(approveStdout()).toMatch(/Gate 3.*approved/s);
		expect(approveStdout()).not.toMatch(/insufficient evidence/);

		// SEPARATE runCli call, SEPARATE fresh store construction -- proves the approval is genuinely
		// PERSISTED, not just returned in-process by the same call that minted it (same discipline this
		// file's own "survives a fresh store construction" tests above already establish).
		const status = createCapturingIo(project.root);
		const statusCode = await runCli(["gate", "status"], status.io);
		expect(statusCode).toBe(0);
		expect(status.stdout()).toMatch(/Gate 3 \[mandatory\]: approved/);
	});

	it("the SAME mandatory-gate flow with only a `file` evidence ref (never git-commit) still refuses -- the loop-back widens git-commit specifically, it does not accept ANY author-declared ref", async () => {
		const start = createCapturingIo(project.root);
		await runCli(["gate", "start", "3"], start.io);

		project.write("evidence.txt", "proof");
		const evidencePath = join(project.root, "evidence.txt");
		const evidence = createCapturingIo(project.root);
		const evidenceCode = await runCli(
			["gate", "evidence", "--gate", "3", "--kind", "file", "--ref", evidencePath],
			evidence.io,
		);
		expect(evidenceCode).toBe(0);

		const fake = fakeTtyStreams();
		const {
			io: approveIo,
			stdout: approveStdout,
			stderr: approveStderr,
		} = createCapturingIo(project.root, fake.streams);
		const approvePromise = runCli(["gate", "approve", "--gate", "3"], approveIo);
		fake.answer("y");
		const approveCode = await approvePromise;

		expect(approveCode).not.toBe(0);
		expect(approveStderr()).toMatch(/insufficient evidence/);
		expect(approveStdout()).toBe("");
	});
});
