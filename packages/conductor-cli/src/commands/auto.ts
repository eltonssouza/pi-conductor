/**
 * `conductor auto <demanda>` / `--continue` / `--budget` -- the autonomous-mode orchestrator (Fase 8
 * "Autonomous mode": docs/adr/0009-fase8-autonomous-mode.md §2-§10/§16 appendix,
 * docs/conductor/gate2-spec-fase8.md Grupos A-H (FR-1..23/23b), docs/conductor/gate3-addendum-fase8.md
 * T74-T80/R55-R61).
 *
 * GATE 5 (test-first): every FUNCTION exported below is an unconditional `throw new Error("not
 * implemented")` stub -- the same precedent this package's own `commands/gate.ts` documents for its
 * historical Gate 5 ("every exported run* function below started life as an unconditional throw"; see
 * that file's header) and `@conductor/secrets`'s `matchers.ts` documents for its own. This file exists
 * so the tests in `test/commands/auto-*.test.ts` have real, ADR-locked signatures to import and can
 * fail RED for the right reason (missing orchestration behavior), never a missing-module error. Gate 6
 * fills the bodies in for real.
 *
 * The TYPES below are NOT a sketch -- `RunStopReason`, `RiskClassification`, and `RunCheckpoint` mirror
 * ADR 0009 §16's locked appendix contract for this fase's slice; do not change these shapes without a
 * new ADR. Gate 6's implementation of `runAuto` must COMPOSE the existing `gate *` surface
 * (`runGateStart`/`runGateEvidence`/`runGateApprove`/`runGateReject`/`runGateCalibrate`, this package's
 * own `commands/gate.ts`) plus `@conductor/runtime`'s `SharedBudget`/`resolveModelForGate` and this
 * file's own `evaluateStaticVeto`/`classifyRisk`/`scanStagedDiffForSecrets` -- never a second,
 * parallel implementation of any of them (ADR §2/D1, the H-Fase8 hypothesis this whole fase ratifies).
 *
 * `RunAutoOptions`/`runAuto` are reproduced EXACTLY as ADR §16 illustrates them -- the ADR's own header
 * calls that appendix "ilustrativo de contrato, não código de produção pronto para commit... corpos e
 * detalhes de I/O são Gate 6". ADR §3.1's prose separately describes `runAuto` as receiving
 * "colaboradores já construídos (store, confirm, budget, classificador, secret-scan)", but §16's own
 * concrete signature shows no `store`/`confirm`/`budget` injection field -- reconciling that prose with
 * a concrete collaborator-injection shape is explicitly Gate 6's job (most likely: `runAuto` becomes
 * the same kind of per-call composition root `cli.ts`'s own `case "gate"` already is today, building
 * `createPersistedGateStateStore`/`resolveConfirmChannel(io.tty)` from `io.cwd` internally, the same
 * way `commands/gate-store.ts`'s own header describes its adapter as "cheap... no I/O happens until
 * `.read()`/`.mutate()` is actually invoked"). This Gate 5 does not guess that shape or add fields
 * `RunAutoOptions` doesn't already show -- see `test/commands/auto-run.test.ts`'s own header for what
 * that gap concretely limits about what can be asserted RED today, flagged rather than silently
 * resolved.
 *
 * Scope boundary (this fase's Gate 5, narrower than ADR §14's own table of the two touched files): this
 * whole file is NEW code, so every export here is fully in scope for Gate 5 stubbing. The two EXISTING
 * files this fase's Gate 5 touches are `commands/gate.ts` (the `GateStateStoreView.approveAuto`
 * addition + the `InteractivityWitness` type export -- see that file's own header) and
 * `@conductor/runtime`'s `workspace-policy.ts` (a FAILING TEST ONLY for the `.conductor/auto`
 * protected-path line -- the fix itself is Gate 6). `commands/gate-store.ts` (where `approveAuto`'s
 * real `MANDATORY_GATES` guard and the D3-layer-2 `isInteractive` crossing actually get wired) is Gate
 * 6 scope and is not touched by this Gate 5 at all.
 */

import type { SecretSpan } from "@conductor/secrets";
import type { TtyStreams } from "../tty-confirm.ts";

/** The 4 exhaustive stop conditions (D6, FR-13/14/15/16, BR-9). NEVER a value in `GateStatus` (the
 * enum ADR 0005 already locked) -- same precedent ADR 0008 D4 set for `conductor auto`'s own
 * predecessor orchestration events: every new orchestration event lives OUTSIDE the locked enum. */
export type RunStopReason = "context-limit" | "needs-human" | "budget-exceeded" | "landed";

/**
 * Risk classification (D4, FR-3/3b/4/4b/5, T74/R55) -- a typed RESULT, never an exception a caller can
 * forget to handle (Writing Maintainable Code §4.12, cited by ADR §19.4 for this exact shape).
 * REJECT-ONLY: notice there is no variant meaning "this demand IS safe" produced by the veto itself --
 * `"vetoed"` is the only outcome the static veto (`evaluateStaticVeto` below) can ever contribute to;
 * `"authorized-low-risk"` can only ever come from an EXPLICIT assertion (`--risk=low` or a narrow
 * deterministic rule), never from the mere absence of a veto match. `"needs-human"` is the fail-closed
 * default under any uncertainty (BR-1).
 */
export type RiskClassification =
	| { outcome: "vetoed"; matched: { where: "demand-string" | "diff-path" | "diff-content"; pattern: string } }
	| { outcome: "authorized-low-risk"; basis: "explicit-flag" | "narrow-rule"; method: "human" | "auto" }
	| { outcome: "needs-human"; reason: "uncertain" | "underspecified" };

/**
 * Peça 1 (D4 §6.2): the static veto, REJECT-ONLY and deterministic. Called at intake (over the demand
 * string alone) AND at every gate boundary (FR-3b, over the materializing diff) -- a match at EITHER
 * call names the pattern that matched and never depends on which caller invoked it. Pure: no I/O, no
 * model call over the (untrusted) demand string (T74, Secure Code Review §1.2 "a blocklist decides the
 * reject side well, never the accept side" -- ADR §19.6). Never returns any signal meaning "this is
 * safe" -- `{ vetoed: false }` means only "no veto pattern matched", which `classifyRisk` below is
 * responsible for NOT reading as an accept.
 */
export function evaluateStaticVeto(_input: {
	demandString?: string;
	diffPaths?: readonly string[];
	diffText?: string;
}): { vetoed: false } | { vetoed: true; where: "demand-string" | "diff-path" | "diff-content"; pattern: string } {
	throw new Error("not implemented");
}

/**
 * Peça 2 (D4 §6.2): the accept-path authorization -- fail-closed BY EXPLICIT ASSERTION, never a model
 * call over the demand (§6.3's three ANDed reasons). Callers MUST run `evaluateStaticVeto` first and
 * short-circuit on a veto match (BR-2: `--risk=low` never overrides a veto) -- this function does not
 * itself see or re-check the veto outcome, by design (Messaging and Integration Patterns §2.12, ADR
 * §19.4: "não decompor onde há uma decisão só" -- each function owns exactly one decision).
 */
export function classifyRisk(_input: {
	demandString: string;
	/** `--risk=low` (FR-5). Honored only where the caller already confirmed no veto matched;
	 * registered as `method:"human"` (an explicit, affirmed assertion), never `"auto"`. */
	explicitRiskLow: boolean;
	/** A narrow, deterministic applicability rule matched (the `/cdt-intake`-like family: typo/config
	 * or small-bug-with-limited-diff) -- registered as `method:"auto"`. */
	narrowRuleMatch: boolean;
}): RiskClassification {
	throw new Error("not implemented");
}

/**
 * The run checkpoint schema (D2/FR-9, path `<workspaceRoot>/.conductor/auto/<slug>.continue.json`,
 * PROTECTED -- see `workspace-policy-auto-protected.test.ts`). BR-5/R59: every field here is a HINT,
 * NEVER authoritative -- `--continue` MUST re-derive `demand_branch`/`depth_calibration`/pending
 * sign-offs from the real, persisted `GateStatusSnapshot` (`branch`/`.calibration`/`.gates[].status`)
 * before trusting anything read from this file; a mismatch is reported and fails closed, never
 * advances blindly (ADR 0005 §3.1's own "conteúdo, não nome, é a verdade" discipline, reapplied here).
 * An absent or corrupted checkpoint file must never block `--continue` when the real `GateState`
 * exists (FR-8) -- this interface describes what gets WRITTEN, not a required precondition to resume.
 */
export interface RunCheckpoint {
	last_gate: number;
	next_gate: number;
	/** Hint only (R59) -- re-derived from `GateStatusSnapshot.branch` on `--continue`, never trusted. */
	demand_branch: string;
	/** Hint only (R59) -- re-derived from `GateStatusSnapshot.calibration`, never trusted. */
	depth_calibration: number[];
	/** Hint only (R59) -- re-derived from `GateStatusSnapshot.gates[].status === "needs-human"`, never
	 * trusted (a suppressed entry here must never read as "nothing pending"). */
	deferred_human_decisions: readonly string[];
	/** D6 -- fora do enum GateStatus travado; ver `RunStopReason` acima. */
	stop_reason: RunStopReason;
}

/**
 * Secret-scan pré-push (D5/FR-18b, T77/R58): reuses `@conductor/secrets`'s `findSecretSpans` (the
 * Fase-6 single source of "what looks like a secret") over the STAGED diff text of a gate -- never a
 * second, parallel detector, and never a shelled-out `gitleaks`/`trivy` binary this monorepo does not
 * actually pin in any workflow today (ADR §7.1's own confirmed grep). Fail-closed is the caller's
 * responsibility (a `git diff` that cannot be read must be treated as "detected", never as "clean") --
 * this pure function only classifies the text it is actually given.
 */
export function scanStagedDiffForSecrets(
	_diffText: string,
): { clean: true } | { clean: false; spans: readonly SecretSpan[] } {
	throw new Error("not implemented");
}

/**
 * The minimal, duck-typed I/O surface `runAuto` needs -- mirrors `commands/models.ts`/`login.ts`'s own
 * local `CliIO` convention (a narrower structural subset of `cli.ts`'s real `CliIO`, so this file never
 * imports `cli.ts` and risks a cycle with the composition root that will eventually import THIS file).
 * `tty` reuses `tty-confirm.ts`'s own `TtyStreams` shape rather than redeclaring it -- D3 layer 1
 * (ADR §5.2): `runAuto` is headless by construction whenever `tty` is absent or not a real TTY on both
 * streams, because it composes the SAME `resolveConfirmChannel` `cli.ts`'s `case "gate"` already uses,
 * never a synthetic channel of its own.
 */
export interface CliIO {
	cwd: string;
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
	tty?: TtyStreams;
}

/**
 * The composition root's options (ADR §16, reproduced exactly -- see this file's header on why no
 * `store`/`confirm`/`budget` injection field is added here at Gate 5).
 */
export interface RunAutoOptions {
	demand: string;
	/** D8 -- default `DEFAULT_AUTO_RUN_TOKEN_BUDGET` when omitted, env-overridable
	 * (`CONDUCTOR_AUTO_TOKEN_BUDGET`) by Gate 6's implementation. Omitting this option must NEVER mean
	 * "no cap" (FR-12). */
	budgetTokens?: number;
	/** `--risk=low` (FR-5). */
	riskLow?: boolean;
	/** `--continue [slug]` (D2/G3). */
	continueSlug?: string;
	io: CliIO;
}

/**
 * The orchestrator entry point (D1/§3.2's loop) -- a thin sequencer over the existing `gate *` surface,
 * never a second mutator of `GateState` and never a second sign-off path (H-Fase8, the falsifiable
 * hypothesis this whole ADR ratifies). Reproduced as a plain (non-`async`) function, matching ADR
 * §16's own ambient `export function runAuto(options: RunAutoOptions): Promise<number>;` declaration
 * and this package's own `commands/library.ts`/`journal.ts` Gate-5 stub convention
 * (`runLibraryIngest`/`runJournalIngest`: a plain function whose body unconditionally throws, despite
 * a `Promise`-shaped or otherwise non-trivial declared return type) -- an unconditional `throw`
 * satisfies any declared return type without ever constructing a `Promise`, so this stub throws
 * SYNCHRONOUSLY (`expect(() => runAuto(...)).toThrow(...)`, not `.rejects`) until Gate 6 makes the
 * body genuinely asynchronous.
 */
export function runAuto(_options: RunAutoOptions): Promise<number> {
	throw new Error("not implemented");
}

/**
 * D8 -- `2_000_000` tokens, env-overridable via `CONDUCTOR_AUTO_TOKEN_BUDGET` and by `--budget`,
 * sintonizável no Gate 11. A declared, overridable default (the same honesty ADR 0008 already applied
 * to cooldown/backoff/TTL) -- never treated as a discovered truth.
 */
export const DEFAULT_AUTO_RUN_TOKEN_BUDGET = 2_000_000;
