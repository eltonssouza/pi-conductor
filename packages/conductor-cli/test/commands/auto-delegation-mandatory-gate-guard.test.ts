/**
 * GAP-B (ADR 0010 "Wiring de delegação real de subagentes em runAuto" §9/D7, gate3-addendum
 * T83/R64, gate2-spec FR-5b): a MANDATORY gate ({3,5,7,8,9}) with a genuine, resolved
 * `{kind:"delegation"}` evidence item attached still resolves to `needs-human` when headless -- NEVER
 * auto-approved. `{kind:"delegation"}` (like `test-run`/`git-commit` before it) only ever satisfies the
 * evidence PRE-REQUISITE `hasSufficientEvidenceForMandatoryGate` checks; the MINT of a mandatory gate's
 * approval still requires a genuine human confirm (`mintHumanApproval`, ADR 0009 D3, two layers) --
 * `runAuto` is headless by construction (D3 layer 1), so that confirm always resolves `false`,
 * regardless of how strong the attached evidence is.
 *
 * This extends the exact pattern this project's own `test/commands/gate-approve-auto-mandatory-guard.
 * test.ts` (N1's own MANDATORY_GATES guard) and `test/commands/auto-run.test.ts`'s own
 * "T75/R56 outcome backstop" describe block already establish -- same real git repo, same
 * `resolveGateGitContext`-derived store (that file's own "Gate 8 loop-back, finding 2" fix), same
 * headless-by-omitting-`io.tty` invocation.
 *
 * UNLIKE `src/commands/auto.ts`'s NEW `runGateDelegation`/`buildDelegationSpawnInput` (this demand's own
 * Gate 5 stubs, still unconditional throws), this test exercises ONLY already-REAL code: `runAuto`
 * itself (Fase 8, Gate 6, unchanged by this demand) and `@conductor/runtime`'s `gate-evidence.ts`'s
 * `hasSufficientEvidenceForMandatoryGate` (extended FOR REAL by this demand's own Gate 5 pass to accept
 * `delegation`, not a stub -- see that file's own updated header). This test is therefore expected to
 * be GREEN today, immediately -- it is the actual regression proof of GAP-B, not a RED-for-a-stub
 * placeholder.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_STOPPED, runAuto } from "../../src/commands/auto.ts";
import { createPersistedGateStateStore, resolveGateGitContext } from "../../src/commands/gate-store.ts";
import { alwaysInteractiveWitness } from "../support/interactivity-witness.ts";
import { alwaysSatisfiedModelResolutionPort } from "../support/model-resolution-port.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const NOOP_WRITER = { write(_chunk: string): void {} };

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
	initRepoWithOneCommit(project.root, "feature/demand-1");
});

afterEach(() => {
	project.cleanup();
});

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

/** Mirrors auto-run.test.ts's own makeStore -- derives repoId/branch via the SAME
 * resolveGateGitContext(cwd) runAuto uses internally, so this store and runAuto's own internal store
 * are the identical on-disk file (Gate 8 loop-back, finding 2). */
async function makeStore() {
	const gitContext = await resolveGateGitContext(project.root);
	return createPersistedGateStateStore({
		gatesDir: join(project.root, ".conductor", "gates"),
		repoId: gitContext.repoId,
		branch: gitContext.branch,
		modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
		isInteractive: alwaysInteractiveWitness(),
	});
}

describe("runAuto — GAP-B: {kind:'delegation'} evidence satisfies the pre-requisite, NEVER the approval, for a mandatory gate", () => {
	it("gate 3 (mandatory) with a genuine, resolved {kind:'delegation'} evidence item attached still stops needs-human when headless -- never persisted as approved", async () => {
		const store = await makeStore();
		store.start("demand-1", 3); // mandatory, left in-progress

		// A genuine, resolved delegation evidence item -- the SAME "attachEvidence trusts the caller;
		// real resolution happens one layer up in the CLI's runGateEvidence" convention
		// auto-run.test.ts's own T75 test already documents and relies on for git-commit refs.
		store.attachEvidence("demand-1", 3, {
			ref: { kind: "delegation", sessionId: "session-observed-by-this-run", role: "security-engineer" },
			provenance: "runtime-derived",
		});

		const exitCode = await runAuto({
			demand: "demand-1",
			riskLow: true, // fresh run -> classification must pass first (D8/§10.2), distinct from the T75/GAP-B backstop this test exercises
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		}); // no `tty` field -> headless

		const gate3 = store.status("demand-1").gates.find((g) => g.gate === 3);
		expect(gate3?.status).not.toBe("approved");
		expect(exitCode).toBe(EXIT_STOPPED);
	});

	it("REGRESSION (non-mandatory contrast): the SAME kind of delegation evidence on a NON-mandatory gate (gate 1) is sufficient for approveAuto's own evidence.length>0 guard -- proving delegation evidence is genuinely usable, not inert everywhere, and that the mandatory-gate refusal above is specifically about the human sign-off layer, not evidence resolution itself", async () => {
		const store = await makeStore();
		store.start("demand-1", 1);
		store.attachEvidence("demand-1", 1, {
			ref: { kind: "delegation", sessionId: "session-observed-by-this-run", role: "product-manager" },
			provenance: "runtime-derived",
		});

		const snapshot = store.approveAuto("demand-1", 1);

		expect(snapshot.gates.find((g) => g.gate === 1)?.status).toBe("approved");
	});
});
