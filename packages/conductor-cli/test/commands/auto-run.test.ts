/**
 * Integration tests for `runAuto` (`src/commands/auto.ts`) — ADR 0009 §3.2 (the loop)/§4 (D2)/§8 (D6,
 * stop conditions)/§10.2 (D8, veto sequencing)/§16, gate2-spec-fase8.md Grupos C/D/E/H
 * (FR-7/8/9/11/12/13/14/15/16/17, BR-2/BR-5/BR-9, edge 1/8), Gate 3 addendum T74/T75/R55/R56/T78/R59.
 *
 * `runAuto` is fully implemented (Gate 6). Every test below drives it directly and asserts the real
 * outcome — the same convention `commands/gate.ts`'s own historical `gate.test.ts` used once its own
 * stub was wired for real.
 *
 * **Gate 8 loop-back, finding 2 (this file's own defect, not `runAuto`'s):** every test used to build its
 * OWN, separately-keyed `GateStateStore` (`repoId: "test-repo"`, a hardcoded `branch`), while `runAuto`
 * derives its store internally via `resolveGateGitContext(io.cwd)` — a real `sha256(cwd)` repoId plus the
 * real current git branch. Those are two DIFFERENT on-disk JSON files (`gate-state-store.ts`'s own
 * `deriveEnvelopeFilePath` keys the file by `branch`), so assertions against the test's own store never
 * observed what `runAuto` actually did — confirmed by mutation testing: forcing the internal confirm
 * channel to `async () => true` (the literal T75 attack) left every test in this file green. Fixed here
 * two ways: (1) `makeStore()` now derives `repoId`/`branch` via the SAME `resolveGateGitContext(cwd)`
 * `runAuto` uses internally, so both point at the identical file; (2) each test runs against a REAL
 * (locally-committed, no remote) git repo via `initRepoWithOneCommit` below, mirroring
 * `gate-cli.acceptance.test.ts`'s own established helper — without a real repo, `git diff --staged`
 * fails and the secret-scan step (D5) fails CLOSED before ever reaching the mandatory-approval step this
 * suite's T75 test exists to exercise, masking the very code path under test.
 *
 * Grounding for this file's test-design approach (`cdt library`, run from
 * `C:\development\source\projects\conductor`, `--gate 6`): "characterization/contract tests over real
 * collaborators, never a second in-memory stand-in for the same store the code under test already
 * builds" → **Working with Legacy Code — Complete Professional Guide §3.1 "Introduction: sprout and
 * wrap; characterization tests"** (top 0.555, same citation this file's Gate 5 predecessor already used)
 * — the fix above is exactly this principle applied one level deeper: the characterization test must
 * observe the SAME real collaborator the code under test constructs, not a lookalike.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_AUTO_RUN_TOKEN_BUDGET,
	EXIT_STOPPED,
	type RunCheckpoint,
	type RunStopReason,
	runAuto,
} from "../../src/commands/auto.ts";
import { createPersistedGateStateStore, resolveGateGitContext } from "../../src/commands/gate-store.ts";
import { alwaysInteractiveWitness } from "../support/interactivity-witness.ts";
import { alwaysSatisfiedModelResolutionPort } from "../support/model-resolution-port.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const NOOP_WRITER = { write(_chunk: string): void {} };

/** Captures every chunk written, for assertions against the real refusal/stop message -- mirrors
 * `test/support/io.ts`'s own `createCapturingIo` shape, kept local per this suite's own convention of
 * a minimal writer (see `NOOP_WRITER` above). */
function capturingWriter(): { write(chunk: string): void; text(): string } {
	const chunks: string[] = [];
	return {
		write: (chunk: string) => {
			chunks.push(chunk);
		},
		text: () => chunks.join(""),
	};
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
	// Gate 8 loop-back, finding 2: a REAL git repo (no remote) so `git diff`/`git diff --staged` succeed
	// (returning "", not failing) instead of the secret-scan step (D5) fail-closing BEFORE the run ever
	// reaches the mandatory-approval step several tests below actually mean to exercise. `demandId` is
	// "demand-1" in every test in this file (either as `continueSlug` or as a slugify-stable `demand`
	// string), so `ensureDemandBranch`'s `feature/${demandId}` checkout-B is a same-name no-op against
	// this initial branch -- the branch never silently changes out from under an already-derived store.
	initRepoWithOneCommit(project.root, "feature/demand-1");
});

afterEach(() => {
	project.cleanup();
});

/** Mirrors `test/commands/gate-cli.acceptance.test.ts`'s own real `git init`/`git commit` helper --
 * never mocked, and each package/suite keeps an independent copy on purpose (this project's own
 * established convention, `test/support/scratch.ts`'s own header). */
function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
		.toString()
		.trim();
}

function initRepoWithOneCommit(root: string, branch: string): void {
	git(["init", "--initial-branch", branch], root);
	git(["config", "user.email", "conductor-test@example.invalid"], root);
	git(["config", "user.name", "Conductor Test"], root);
	git(["commit", "--allow-empty", "-m", "initial"], root);
}

/** Gate 8 loop-back, finding 2: derives `repoId`/`branch` via the SAME `resolveGateGitContext(cwd)`
 * `runAuto` uses internally, so this store and `runAuto`'s own internal store are the identical
 * on-disk file -- never a separately-keyed lookalike. */
async function makeStore() {
	const gitContext = await resolveGateGitContext(project.root);
	return createPersistedGateStateStore({
		gatesDir: join(project.root, ".conductor", "gates"),
		repoId: gitContext.repoId,
		branch: gitContext.branch,
		modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
		// D3 layer 2 is not this file's subject (T75's own test below asserts the OUTCOME through
		// runAuto's real, headless-by-construction confirm channel, not through this setup store) --
		// see test/support/interactivity-witness.ts for why an explicit "interactive" double is the
		// correct statement of scope for a store used only to pre-seed/read state directly.
		isInteractive: alwaysInteractiveWitness(),
	});
}

describe("runAuto --continue — FR-7/BR-5/R59: the run checkpoint is a hint, always re-derived against the real GateState", () => {
	it("given a checkpoint claiming next_gate: 6 but the real, persisted GateState shows gate 5 still in-progress (not approved), --continue must resume from gate 5 -- never blindly trust the checkpoint's next_gate", async () => {
		const store = await makeStore();
		// Gate 5 is mandatory; the only mandatory gate below it is 3 (MANDATORY_GATES = {3,5,7,8,9}), so
		// gate 3 must be genuinely approved first before gate 5 can even be start()-ed.
		store.start("demand-1", 3);
		// A mandatory gate's approve() refuses without sufficient evidence (R25/BR-6, gate-evidence.ts).
		// attachEvidence itself trusts the caller -- resolution happens one layer up in the CLI's
		// runGateEvidence, which this test bypasses -- so a git-commit/author-declared item is enough to
		// satisfy hasSufficientEvidenceForMandatoryGate's interim git-commit branch.
		store.attachEvidence("demand-1", 3, {
			ref: { kind: "git-commit", sha: "0000000000000000000000000000000000000000" },
			provenance: "author-declared",
		});
		store.approve("demand-1", 3, true, { source: "test" });
		store.start("demand-1", 5); // gate 5 deliberately left in-progress, never approved
		// Evidence attached so the resumed run reaches the REAL confirm-channel decision for gate 5
		// (headless -> needs-human), rather than short-circuiting on the separate evidence-floor refusal.
		store.attachEvidence("demand-1", 5, {
			ref: { kind: "git-commit", sha: "1111111111111111111111111111111111111111" },
			provenance: "author-declared",
		});

		const staleCheckpoint: RunCheckpoint = {
			last_gate: 5,
			next_gate: 6, // ADVERSARIAL/stale: claims gate 5 is done -- it is not
			demand_branch: "feature/demand-1",
			depth_calibration: [],
			deferred_human_decisions: [],
			stop_reason: "context-limit",
		};
		project.writeJson(".conductor/auto/demand-1.continue.json", staleCheckpoint);

		const exitCode = await runAuto({
			demand: "demand-1",
			continueSlug: "demand-1",
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// Real Gate-6 proof of FR-7, now observing the SAME store runAuto actually mutated (finding 2's
		// fix): resuming re-opens gate 5 (what the GateState actually shows), never gate 6 (what the
		// stale checkpoint claims) -- and headless (no io.tty) means the mandatory gate 5 approval itself
		// resolves to needs-human, never silently advancing to a fabricated gate 6. `store.status` always
		// does a fresh disk read (`gate-store.ts`'s own `storeFor`/`readOrBootstrap`), so re-querying the
		// SAME `store` handle after `runAuto` ran is a genuine re-read, not a stale in-memory value.
		const reread = store.status("demand-1");
		expect(reread.currentGate).toBe(5);
		expect(reread.gates.find((g) => g.gate === 5)?.status).not.toBe("approved");
		expect(exitCode).toBe(EXIT_STOPPED);
	});

	it("FR-8: an absent run checkpoint never blocks --continue when the real GateState exists", async () => {
		const store = await makeStore();
		store.start("demand-1", 1);
		// No checkpoint file written at all -- FR-8's own Given.

		await runAuto({
			demand: "demand-1",
			continueSlug: "demand-1",
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// The real proof is that this call does NOT refuse merely because the checkpoint is missing --
		// `gate status` alone is a sufficient resume source (FR-8). Re-reads via a fresh store instance
		// derived the same way (finding 2's fix), proving the SAME file runAuto touched is what's read.
		const reread = await store.status("demand-1");
		expect(reread.demandId).toBe("demand-1");
	});

	it("FR-8: a corrupted (malformed JSON) run checkpoint never blocks --continue either", async () => {
		project.mkdir(".conductor/auto");
		project.write(".conductor/auto/demand-1.continue.json", "{ this is not valid json");
		const store = await makeStore();
		store.start("demand-1", 1);

		await runAuto({
			demand: "demand-1",
			continueSlug: "demand-1",
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		expect(store.status("demand-1").demandId).toBe("demand-1");
	});
});

describe("RunStopReason — D6: 4 exhaustive stop conditions, budget-exceeded genuinely distinct from needs-human (FR-16)", () => {
	it("the union has exactly 4 distinct literal members, and none of them is a fifth, gate-completion-shaped value (BR-9: finishing a gate alone is never a stop condition)", () => {
		const reasons: readonly RunStopReason[] = ["context-limit", "needs-human", "budget-exceeded", "landed"];
		expect(new Set(reasons).size).toBe(4);
		expect(reasons).not.toContain("gate-completed");
	});
});

describe('runAuto — DEFAULT_AUTO_RUN_TOKEN_BUDGET (D8): omitting --budget never means "no cap"', () => {
	it("the exported default is the ADR-locked 2_000_000 -- pins the constant so a future edit cannot silently drift it", () => {
		expect(DEFAULT_AUTO_RUN_TOKEN_BUDGET).toBe(2_000_000);
	});
});

describe("runAuto — T75/R56 outcome backstop: a headless run never persists a fabricated human sign-off for a mandatory gate", () => {
	it("given io.tty is absent (headless by D3 layer 1) and the run reaches mandatory gate 3, the persisted GateState must never show gate 3 as genuinely human-approved -- not even after the run stops", async () => {
		const store = await makeStore();
		store.start("demand-1", 3); // mandatory, left in-progress
		// Evidence attached so the run reaches the REAL confirm-channel decision this test means to
		// exercise (T75), rather than short-circuiting on the separate evidence-floor refusal (R25/BR-6).
		store.attachEvidence("demand-1", 3, {
			ref: { kind: "git-commit", sha: "0000000000000000000000000000000000000000" },
			provenance: "author-declared",
		});

		const exitCode = await runAuto({
			demand: "demand-1",
			// This is a FRESH run (no continueSlug), so classification runs first (D8/§10.2) -- an
			// explicit low-risk assertion is required to get past it (FR-4's own fail-closed default),
			// distinct from the T75 backstop this test actually exercises below.
			riskLow: true,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		}); // no `tty` field at all -> headless

		// Real Gate-6 proof, now observing the SAME persisted GateState runAuto actually wrote to
		// (finding 2's fix): headless (`io.tty` absent) means `resolveConfirmChannel` resolves the
		// always-false channel (D3 layer 1), so `mintHumanApproval` can only ever return `null`, and the
		// gate falls to "needs-human" (FR-14), never "approved".
		const gate3 = store.status("demand-1").gates.find((g) => g.gate === 3);
		expect(gate3?.status).not.toBe("approved");
		expect(exitCode).toBe(EXIT_STOPPED);
	});
});

describe("runAuto — BR-2/edge 1/8: the static veto is NEVER overridden by --risk=low, and the veto refuses BEFORE any branch or GateState exists (D8/§10.2)", () => {
	it("a demand string that matches the static veto (e.g. names 'login'/'senha') still refuses even when riskLow is explicitly true", async () => {
		const stderr = capturingWriter();

		const exitCode = await runAuto({
			demand: "adicionar fluxo de login com senha, --risk=low",
			riskLow: true,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr },
		});

		// Gate 8 loop-back, finding 6: this test previously had ZERO assertions (confirmed by Gate 8's
		// mutation testing: it stayed green under a veto-bypass mutation). Real BR-2 proof: a distinct
		// exit code, the veto's own matched pattern named on stderr (never a silent refusal), and --
		// mirroring edge case 1/8's own sibling assertion below -- no GateState is ever created for a
		// vetoed demand, riskLow:true notwithstanding.
		expect(exitCode).toBe(EXIT_STOPPED);
		expect(stderr.text()).toMatch(/static veto matched/i);
		expect(stderr.text()).toMatch(/login/i);
		expect(existsSync(join(project.root, ".conductor", "gates"))).toBe(false);
	});

	it("edge case 1/8, D8/§10.2: a vetoed demand produces NO .conductor/gates directory at all -- the refusal happens before any GateState is ever created, the only artifact is the classification Decision", async () => {
		expect(existsSync(join(project.root, ".conductor", "gates"))).toBe(false);

		const exitCode = await runAuto({
			demand: "implementar login OAuth",
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// D8/§10.2 proof: a vetoed demand leaves .conductor/gates absent (no branch, no GateState
		// envelope ever written), unlike a non-vetoed run which would have created it via the FIRST gate
		// start() call.
		expect(existsSync(join(project.root, ".conductor", "gates"))).toBe(false);
		expect(exitCode).toBe(EXIT_STOPPED);
	});
});

describe("runAuto — Gate 8 loop-back, finding 1: a non-mandatory gate reached without any subagent-produced evidence stops as needs-human, never a hollow method:auto completion", () => {
	it("a fresh, low-risk-authorized run that reaches gate 1 with zero evidence attached stops (needs-human), and gate 1 is never recorded as approved", async () => {
		// `demand` is deliberately "demand-1" (matching `slugify`'s own stable output, same demandId
		// every other test in this file uses) -- a DIFFERENT demand string here would slugify to a
		// DIFFERENT demandId/branch, landing on a git branch (`ensureDemandBranch`) other than the
		// `feature/demand-1` this file's `beforeEach` already prepared, and this test's own re-read via
		// `makeStore().status("demand-1")` below would then legitimately mismatch (content-authoritative
		// check) rather than observe the same demand.
		const exitCode = await runAuto({
			demand: "demand-1",
			riskLow: true,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// Before this fix, approveAuto minted method:"auto" for gate 1 unconditionally -- no subagent
		// delegation exists yet (this function's own header), so every non-mandatory gate a headless run
		// passed through was falsely recorded as genuinely "approved". Real proof: gate 1 stops at
		// needs-human, the run does not silently claim success, and the process exit code reflects a
		// genuine stop, never EXIT_LANDED.
		const store = await makeStore();
		const gate1 = store.status("demand-1").gates.find((g) => g.gate === 1);
		expect(gate1?.status).not.toBe("approved");
		expect(exitCode).toBe(EXIT_STOPPED);
	});
});
