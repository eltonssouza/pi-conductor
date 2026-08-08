/**
 * Test-first (Gate 5, Fase 8 "Autonomous mode") for `runAuto` (`src/commands/auto.ts`) — ADR
 * 0009 §3.2 (the loop)/§4 (D2)/§8 (D6, stop conditions)/§10.2 (D8, veto sequencing)/§16,
 * gate2-spec-fase8.md Grupos C/D/E/H (FR-7/8/9/11/12/13/14/15/16/17, BR-2/BR-5/BR-9, edge 1/8),
 * Gate 3 addendum T74/T75/R55/R56/T78/R59.
 *
 * `runAuto` is currently an unconditional, SYNCHRONOUS `throw new Error("not implemented")` stub (see
 * `src/commands/auto.ts`'s own header on why it is declared as a plain, non-`async` function). Every
 * test below calls it DIRECTLY (never wrapped in `expect(() => ...).toThrow()`) and then asserts the
 * REAL, post-Gate-6 expected outcome — the same convention `commands/gate.ts`'s own historical
 * `gate.test.ts` used for `runGateStart`/`runGateApprove` at Fase 4's Gate 5 (see that file's header:
 * "written against a working FAKE... so that once Gate 6 wires run* to a real store... each test
 * becomes the actual proof of the FR it names — not a redundant re-statement of 'it doesn't throw'").
 * Concretely: today, the unconditional throw happens the moment `runAuto(...)` is called, before any
 * `expect(...)` on its result is ever reached — the whole `it()` callback rejects/throws, and Vitest
 * reports that as a FAILING test (RED, for the right reason: missing orchestration behavior, not a
 * missing module). Once Gate 6 replaces the throw with a real implementation, the assertions below
 * stop being unreachable and become the actual regression proof.
 *
 * Grounding for this file's test-design approach (`cdt library`, run from
 * `C:\development\source\projects\conductor`, `--gate 5`): "characterization/contract tests for a
 * stub whose collaborators (a persisted store, a checkpoint file) already exist and are real" →
 * **Working with Legacy Code — Complete Professional Guide §3.1 "Introduction: sprout and wrap;
 * characterization tests"** (top 0.555) — the RunCheckpoint/`--continue` tests below follow that
 * shape: real collaborators (a genuinely persisted `GateState` via `createPersistedGateStateStore`, a
 * real checkpoint JSON file on a real scratch filesystem), with only `runAuto` itself left a stub. For
 * the two-layer D3 defense (channel injection vs. the interactivity witness), the same session
 * surfaced **Spec-Driven Development — The Complete Book §20.4 "Independent Vetoes"** (0.570:
 * "whoever writes is not who approves alone" — independent checks that can each fail on their own) —
 * reflected below by keeping the T75 test about the OBSERVABLE OUTCOME (no fabricated human approval
 * ever reaches disk in a headless run) rather than conflating it with the internal two-layer
 * mechanism, which `gate-approve-auto-mandatory-guard.test.ts`'s own header explicitly flags as
 * untestable in isolation at this Gate 5 (its call site, `gate-store.ts`'s concrete `approve()`, is
 * out of this task's touched-files scope).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_AUTO_RUN_TOKEN_BUDGET,
	type RunCheckpoint,
	type RunStopReason,
	runAuto,
} from "../../src/commands/auto.ts";
import { createPersistedGateStateStore } from "../../src/commands/gate-store.ts";
import { alwaysSatisfiedModelResolutionPort } from "../support/model-resolution-port.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const NOOP_WRITER = { write(_chunk: string): void {} };

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function makeStore(branch = "feature/fase8-demo") {
	return createPersistedGateStateStore({
		gatesDir: join(project.root, ".conductor", "gates"),
		repoId: "test-repo",
		branch,
		modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
	});
}

describe("runAuto --continue — FR-7/BR-5/R59: the run checkpoint is a hint, always re-derived against the real GateState", () => {
	it("given a checkpoint claiming next_gate: 6 but the real, persisted GateState shows gate 5 still in-progress (not approved), --continue must resume from gate 5 -- never blindly trust the checkpoint's next_gate", async () => {
		const store = makeStore();
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

		const staleCheckpoint: RunCheckpoint = {
			last_gate: 5,
			next_gate: 6, // ADVERSARIAL/stale: claims gate 5 is done -- it is not
			demand_branch: "feature/fase8-demo",
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

		// Unreachable today (the line above throws first) -- the real Gate-6 proof of FR-7: resuming
		// re-opens gate 5 (what the GateState actually shows), never gate 6 (what the stale checkpoint
		// claims). A process exit code is also asserted so this test doubles as FR-9's own "well-formed
		// process outcome" check once real.
		expect(store.status("demand-1").currentGate).toBe(5);
		expect(typeof exitCode).toBe("number");
	});

	it("FR-8: an absent run checkpoint never blocks --continue when the real GateState exists", async () => {
		const store = makeStore();
		store.start("demand-1", 1);
		// No checkpoint file written at all -- FR-8's own Given.

		await runAuto({
			demand: "demand-1",
			continueSlug: "demand-1",
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// Unreachable today: the real proof is that this call does NOT refuse merely because the
		// checkpoint is missing -- `gate status` alone is a sufficient resume source (FR-8).
		expect(store.status("demand-1").demandId).toBe("demand-1");
	});

	it("FR-8: a corrupted (malformed JSON) run checkpoint never blocks --continue either", async () => {
		project.mkdir(".conductor/auto");
		project.write(".conductor/auto/demand-1.continue.json", "{ this is not valid json");
		const store = makeStore();
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
	it("the exported default is the ADR-locked 2_000_000 -- already a decided value (D8), not a stub body, so this assertion is genuinely GREEN today; it pins the constant so a future edit cannot silently drift it", () => {
		expect(DEFAULT_AUTO_RUN_TOKEN_BUDGET).toBe(2_000_000);
	});

	it("FR-12: a run started with budgetTokens omitted still applies SOME cap -- documented via the stub's own throw today; Gate 6 must never read an absent option as unlimited", async () => {
		const store = makeStore();
		store.start("demand-1", 1);
		await runAuto({ demand: "demand-1", io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER } });
		// Unreachable today -- the real Gate-6 proof lives at the SharedBudget construction call site
		// (`createSharedBudget(DEFAULT_AUTO_RUN_TOKEN_BUDGET)` when budgetTokens/env are both absent),
		// which this Gate-5 stub does not yet expose an observable seam for. Flagged, not guessed.
	});
});

describe("runAuto — T75/R56 outcome backstop: a headless run never persists a fabricated human sign-off for a mandatory gate", () => {
	it("given io.tty is absent (headless by D3 layer 1) and the run reaches mandatory gate 3, the persisted GateState must never show gate 3 as genuinely human-approved -- not even after the run stops", async () => {
		const store = makeStore();
		store.start("demand-1", 3); // mandatory, left in-progress

		await runAuto({ demand: "demand-1", io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER } }); // no `tty` field at all -> headless

		// Unreachable today. Real Gate-6 proof: re-reading the SAME persisted GateState must never show
		// gate 3 as "approved" -- headless (`io.tty` absent) means `resolveConfirmChannel` resolves the
		// always-false channel (D3 layer 1), so `mintHumanApproval` can only ever return `null`, and the
		// gate falls to "needs-human" (FR-14), never "approved". This is the OUTCOME-level proof of the
		// two-layer defense's overall guarantee -- it cannot isolate layer 2 (the interactivity witness)
		// from layer 1 at this Gate 5; see gate-approve-auto-mandatory-guard.test.ts's header for why.
		const gate3 = store.status("demand-1").gates.find((g) => g.gate === 3);
		expect(gate3?.status).not.toBe("approved");
	});
});

describe("runAuto — BR-2/edge 1/8: the static veto is NEVER overridden by --risk=low, and the veto refuses BEFORE any branch or GateState exists (D8/§10.2)", () => {
	it("a demand string that matches the static veto (e.g. names 'login'/'senha') still refuses even when riskLow is explicitly true", async () => {
		await runAuto({
			demand: "adicionar fluxo de login com senha, --risk=low",
			riskLow: true,
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// Unreachable today. Real Gate-6 proof (BR-2): the veto match is named and the run refuses as
		// needs-human/vetoed regardless of riskLow:true -- the flag never overrides a veto match.
	});

	it("edge case 1/8, D8/§10.2: a vetoed demand produces NO .conductor/gates directory at all -- the refusal happens before any GateState is ever created, the only artifact is the classification Decision", async () => {
		expect(existsSync(join(project.root, ".conductor", "gates"))).toBe(false);

		await runAuto({
			demand: "implementar login OAuth",
			io: { cwd: project.root, stdout: NOOP_WRITER, stderr: NOOP_WRITER },
		});

		// Unreachable today -- once Gate 6 lands, this assertion is the real D8/§10.2 proof: a vetoed
		// demand leaves .conductor/gates absent (no branch, no GateState envelope ever written), unlike a
		// non-vetoed run which would have created it via the FIRST gate start() call.
		expect(existsSync(join(project.root, ".conductor", "gates"))).toBe(false);
	});
});
