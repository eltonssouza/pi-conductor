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

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MANDATORY_GATES } from "@conductor/config";
import { createSharedBudget, TOTAL_FLOW_GATES } from "@conductor/runtime";
import { findSecretSpans, type SecretSpan } from "@conductor/secrets";
import { DEFAULT_GIT_STATUS_TIMEOUT_MS } from "../git-status.ts";
import { resolveConfirmChannel, type TtyStreams } from "../tty-confirm.ts";
import { type GateStatusSnapshot, runGateApprove, runGateCalibrate, runGateStart } from "./gate.ts";
import { createPersistedGateStateStore, defaultInteractivityWitness, resolveGateGitContext } from "./gate-store.ts";
import { createGateModelResolutionPort, defaultCreateModelRuntime } from "./model-context.ts";

/** The 4 exhaustive stop conditions (D6, FR-13/14/15/16, BR-9). NEVER a value in `GateStatus` (the
 * enum ADR 0005 already locked) -- same precedent ADR 0008 D4 set for `conductor auto`'s own
 * predecessor orchestration events: every new orchestration event lives OUTSIDE the locked enum.
 *
 * **`"context-limit"` (Gate 8 loop-back, finding 3 -- disclosed, not silently implemented): this literal
 * is STRUCTURALLY UNREACHABLE by `runAuto` today, for the same root cause `runAuto`'s own header already
 * discloses for step (c) (subagent delegation).** FR-13 requires the run to checkpoint+stop when
 * "context usage crosses ~90% of the model window" -- but `RunAutoOptions`/`CliIO` (ADR §16, reproduced
 * verbatim by this file's own header) carry no live session/context-window handle at all, only
 * `cwd`/`stdout`/`stderr`/`tty`. There is nothing inside this file that could observe "context usage" to
 * compare against 90% of anything -- `SharedBudget` tracks a TOKEN BUDGET across the run (a resource
 * ceiling, FR-11/12), never a single subagent session's own context-window fill, which is a fundamentally
 * different measurement this orchestrator has no seam to read until it actually delegates to a subagent
 * session (the same missing wiring named in `runAuto`'s own header for step (c)). A token-count PROXY
 * from `SharedBudget` usage was considered and rejected: `SharedBudget`'s ceiling is this file's own
 * `--budget`/`DEFAULT_AUTO_RUN_TOKEN_BUDGET` (a RUN-level cap, spanning every gate and every subagent
 * call for the whole run), not any single model's context WINDOW (a per-call limit, e.g. 200k tokens for
 * one turn) -- conflating the two would silently redefine what "~90%" means (FR-13's own words), trading
 * an honest gap for a plausible-looking but semantically wrong number. This type still declares the
 * literal (the union stays the 4-member contract ADR §16 locked -- BR-9's "exhaustive" guarantee does not
 * change), but no code path in this file ever produces it; see ADR 0009 §20 (Gate 8 loop-back) for the
 * full disclosure and the follow-up this defers to (the same subagent/session wiring step (c) already
 * names). */
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
 * The same minimum keyword-set `CLAUDE.md` already uses as the never-collapse Gate-3 trigger ("does
 * this touch auth, PII, tokens, or external APIs?"), applied to free text (a demand string OR a diff's
 * added/removed lines) -- ADR §6.2 Peça 1's table. REJECT-ONLY (T74/Secure Code Review §1.2): this list
 * is deliberately over-inclusive (high recall on the reject side is the goal), never tuned to reduce
 * false positives -- a false positive here costs a wasted `needs-human`, a false negative costs an
 * unsupervised run touching a sensitive surface.
 */
const CONTENT_VETO_KEYWORDS: ReadonlyArray<{ pattern: string; regex: RegExp }> = [
	{ pattern: "auth", regex: /\bauth\b/i },
	{ pattern: "login", regex: /\blogin\b/i },
	{ pattern: "senha", regex: /\bsenha\b/i },
	{ pattern: "password", regex: /\bpassword\b/i },
	{ pattern: "credential", regex: /credential|credencia/i },
	{ pattern: "token", regex: /\btoken/i },
	{ pattern: "secret", regex: /secret|segredo/i },
	{ pattern: "oauth", regex: /\boauth\b/i },
	{ pattern: "pii", regex: /\bpii\b/i },
	{ pattern: "personal data", regex: /personal data|dados pessoais/i },
	{ pattern: "external api", regex: /api externa|external api/i },
];

/** FR-3b/T74(b): path-shaped signal on the MATERIALIZED diff -- checked (and weighted) ahead of the
 * demand string (ADR §6.2's table: "peso maior que a descrição"), because a written file is observable
 * even when the description that produced it evaded every keyword above. */
const PATH_VETO_PATTERNS: ReadonlyArray<{ pattern: string; regex: RegExp }> = [
	{ pattern: "**/auth*", regex: /auth/i },
	{ pattern: "**/*credential*", regex: /credential|credencia/i },
	{ pattern: "**/*.pem", regex: /\.pem$/i },
	{ pattern: "**/.env*", regex: /(^|[/\\])\.env/i },
	{ pattern: "**/*secret*", regex: /secret|segredo/i },
];

/**
 * Peça 1 (D4 §6.2): the static veto, REJECT-ONLY and deterministic. Called at intake (over the demand
 * string alone) AND at every gate boundary (FR-3b, over the materializing diff) -- a match at EITHER
 * call names the pattern that matched and never depends on which caller invoked it. Pure: no I/O, no
 * model call over the (untrusted) demand string (T74, Secure Code Review §1.2 "a blocklist decides the
 * reject side well, never the accept side" -- ADR §19.6). Never returns any signal meaning "this is
 * safe" -- `{ vetoed: false }` means only "no veto pattern matched", which `classifyRisk` below is
 * responsible for NOT reading as an accept.
 */
export function evaluateStaticVeto(input: {
	demandString?: string;
	diffPaths?: readonly string[];
	diffText?: string;
}): { vetoed: false } | { vetoed: true; where: "demand-string" | "diff-path" | "diff-content"; pattern: string } {
	// Diff/path signal is evaluated FIRST and outweighs the description (FR-3b): a match here is
	// reported even when the demand string itself looks entirely benign.
	for (const path of input.diffPaths ?? []) {
		for (const entry of PATH_VETO_PATTERNS) {
			if (entry.regex.test(path)) return { vetoed: true, where: "diff-path", pattern: entry.pattern };
		}
	}
	if (input.diffText) {
		for (const entry of CONTENT_VETO_KEYWORDS) {
			if (entry.regex.test(input.diffText)) return { vetoed: true, where: "diff-content", pattern: entry.pattern };
		}
	}
	if (input.demandString) {
		for (const entry of CONTENT_VETO_KEYWORDS) {
			if (entry.regex.test(input.demandString))
				return { vetoed: true, where: "demand-string", pattern: entry.pattern };
		}
	}
	// REJECT-ONLY (T74/R55): this is the ONLY way this function ever returns -- there is no branch,
	// anywhere above, that produces a "safe"/"authorized" signal. Absence of a match means only that
	// nothing here matched; classifyRisk (a separate function) is the sole path to authorization.
	return { vetoed: false };
}

/**
 * Peça 2 (D4 §6.2): the accept-path authorization -- fail-closed BY EXPLICIT ASSERTION, never a model
 * call over the demand (§6.3's three ANDed reasons). Callers MUST run `evaluateStaticVeto` first and
 * short-circuit on a veto match (BR-2: `--risk=low` never overrides a veto) -- this function does not
 * itself see or re-check the veto outcome, by design (Messaging and Integration Patterns §2.12, ADR
 * §19.4: "não decompor onde há uma decisão só" -- each function owns exactly one decision).
 */
export function classifyRisk(input: {
	demandString: string;
	/** `--risk=low` (FR-5). Honored only where the caller already confirmed no veto matched;
	 * registered as `method:"human"` (an explicit, affirmed assertion), never `"auto"`. */
	explicitRiskLow: boolean;
	/** A narrow, deterministic applicability rule matched (the `/cdt-intake`-like family: typo/config
	 * or small-bug-with-limited-diff) -- registered as `method:"auto"`. */
	narrowRuleMatch: boolean;
}): RiskClassification {
	// FR-5/BR-1: an explicit, affirmed human assertion is checked FIRST and is distinct (`method:"human"`)
	// from a narrow deterministic rule (`method:"auto"`) -- the two are never collapsed into each other
	// (BR-1's own observable-difference requirement).
	if (input.explicitRiskLow) {
		return { outcome: "authorized-low-risk", basis: "explicit-flag", method: "human" };
	}
	if (input.narrowRuleMatch) {
		return { outcome: "authorized-low-risk", basis: "narrow-rule", method: "auto" };
	}
	// FR-4/BR-1: fail-closed default -- the ABSENCE of an explicit assertion is never read as an implicit
	// accept, regardless of how short/simple the demand string looks.
	return { outcome: "needs-human", reason: "uncertain" };
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
	diffText: string,
): { clean: true } | { clean: false; spans: readonly SecretSpan[] } {
	// D5/R58: reuses the SAME matcher the redaction pipeline already uses -- zero second engine. The
	// caller (runAuto, step (d)) is responsible for fail-closed behavior when the diff text itself could
	// not be read (a `git diff` failure); this pure function only classifies the text it is given.
	const spans = findSecretSpans(diffText);
	return spans.length > 0 ? { clean: false, spans } : { clean: true };
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

// ---------------------------------------------------------------------------------------------
// Gate 6 -- private collaborators `runAuto` composes. Every git/fs touch below is best-effort and
// NEVER lets a subprocess/I/O failure crash the run: D2/D5/D6's own fail-closed and graceful-stop
// disciplines apply per call-site (see each function's own comment for which direction it degrades).
// ---------------------------------------------------------------------------------------------

/** Exported (Gate 8 loop-back) so tests can assert against the named constant instead of a magic number
 * -- quality-baseline category 4 (no hardcoded assumption, including in the test suite itself). */
export const EXIT_LANDED = 0;
export const EXIT_STOPPED = 1;
export const EXIT_BUDGET_EXCEEDED = 2;

/** D8/FR-12: never "no cap" -- explicit `--budget`, then `CONDUCTOR_AUTO_TOKEN_BUDGET` (env,
 * quality-baseline category 4: no hardcoded assumption without an override), then the declared default. */
function resolveBudgetLimit(explicit: number | undefined): number {
	if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
	const envRaw = process.env.CONDUCTOR_AUTO_TOKEN_BUDGET;
	if (envRaw !== undefined) {
		const parsed = Number(envRaw);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_AUTO_RUN_TOKEN_BUDGET;
}

/** FR-1's own example ("adicionar recuperação de senha" -> `feature/adicionar-recuperacao-de-senha"`) --
 * a deterministic, ASCII-only slug used both as the demandId and as the branch suffix. */
function slugify(text: string): string {
	const slug = text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug.length > 0 ? slug : "demand";
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Shells out to `git`, bounded by the same timeout convention `git-status.ts` already establishes.
 * NEVER throws -- returns `null` on ANY failure (not a repo, git missing, timeout, nonzero exit), so
 * every call site decides for itself whether "could not determine" degrades to informational-only or
 * fail-closed (see individual call sites below). */
function safeGit(cwd: string, args: string[]): string | null {
	try {
		return execFileSync("git", args, {
			cwd,
			timeout: DEFAULT_GIT_STATUS_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "ignore"],
		}).toString("utf8");
	} catch {
		return null;
	}
}

/** FR-3b (step 4a): the diff materializing so far, for the per-gate-boundary veto re-check. An
 * unavailable git (no repo, not yet any commits) degrades to "nothing to check" -- informational only,
 * matching `getGitStatus`'s own established direction for this SAME class of check -- deliberately the
 * OPPOSITE direction from the secret-scan's fail-closed rule below (there is a real difference between
 * "no diff exists to inspect" and "a diff exists but could not be read before a push"). */
function materializedDiffSignal(cwd: string): { diffPaths: string[]; diffText: string } {
	const namesRaw = safeGit(cwd, ["diff", "--name-only", "HEAD"]);
	const textRaw = safeGit(cwd, ["diff", "HEAD"]);
	return {
		diffPaths: namesRaw
			? namesRaw
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.length > 0)
			: [],
		diffText: textRaw ?? "",
	};
}

/** D5/R58 (step 4d): the STAGED diff a push is about to send. Returns `null` specifically when git
 * itself could not be read (never conflated with "" -- a genuinely empty, successfully-read staged
 * diff) so the caller can fail CLOSED on the former and clean on the latter. */
function readStagedDiffForSecretScan(cwd: string): string | null {
	return safeGit(cwd, ["diff", "--staged"]);
}

function hasStagedChanges(cwd: string): boolean {
	const names = safeGit(cwd, ["diff", "--staged", "--name-only"]);
	return names !== null && names.trim().length > 0;
}

/** FR-18/19: scoped to whatever is ALREADY staged -- never a blind `git add -A`; a gate with nothing
 * staged is never committed. */
function commitGateScoped(cwd: string, gate: number): void {
	if (!hasStagedChanges(cwd)) return;
	safeGit(cwd, ["commit", "-m", `gate ${gate}: auto-approved by conductor auto`]);
}

function pushBranch(cwd: string, branch: string): void {
	safeGit(cwd, ["push", "-u", "origin", branch]);
}

/** Shells out to `gh` (GitHub CLI), the SAME tool `CLAUDE.md`'s own human-driven git protocol already
 * names for landing a demand branch ("open a PR to develop when the remote requires review"). Mirrors
 * `safeGit`'s own contract exactly: NEVER throws -- `null` on any failure (binary missing, unauthenticated,
 * not a GitHub remote, network down, timeout) -- so `landOnDevelop` below can degrade honestly instead of
 * assuming the tool exists. */
function safeGh(cwd: string, args: string[]): string | null {
	try {
		return execFileSync("gh", args, {
			cwd,
			timeout: DEFAULT_GIT_STATUS_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "ignore"],
		}).toString("utf8");
	} catch {
		return null;
	}
}

/**
 * Gate 8 loop-back, finding 4: FR-15 ("todos os gates aplicáveis aprovados... a branch recebe push e é
 * aterrissada em develop (merge ou PR, conforme o remoto exigir), e o run termina com status landed") was
 * previously satisfied by a bare `stdout.write` claiming "landed" with no git/gh operation behind it --
 * this function is the real implementation. It follows this project's OWN established convention
 * (`CLAUDE.md`'s git protocol: "push the demand branch and integrate it into develop: open a PR to
 * develop when the remote requires review, otherwise merge and git push origin develop" -- and this
 * project's own actual practice, recorded in its diary/memory, of landing every demand through a real PR,
 * never a bypassed merge): it NEVER merges directly into `develop` on its own authority. An unattended
 * loop cannot safely determine "does this remote require review" from local state alone, so the safe
 * default -- exactly the one this project already applies to its own human-driven demands -- is to always
 * prefer opening a real, reviewable PR via `gh`, and to never fabricate success when it cannot.
 *
 * Idempotent (safe to call again from `--continue` after a prior run already opened the PR): checks for
 * an existing PR for this branch FIRST via `gh pr view`, so a resumed run never opens a duplicate.
 *
 * Fail-closed on the reporting side, never on the git side: the branch is already pushed by this point
 * (every approved gate's own `pushBranch` call in the loop above), so a `gh` failure here never loses
 * work -- it only means `runAuto` must NOT claim `"landed"` (the caller, `runAuto`, converts a `landing.ok
 * === false` into a `needs-human` stop, never a silently false "landed" claim -- the exact defect this
 * finding names).
 */
export function landOnDevelop(
	cwd: string,
	branch: string,
): { ok: true; detail: string } | { ok: false; reason: string } {
	const existing = safeGh(cwd, ["pr", "view", branch, "--json", "url"]);
	if (existing !== null) {
		try {
			const parsed: unknown = JSON.parse(existing);
			const url =
				parsed !== null && typeof parsed === "object" && "url" in parsed
					? (parsed as { url: unknown }).url
					: undefined;
			if (typeof url === "string" && url.length > 0) {
				return { ok: true, detail: `PR already open: ${url}` };
			}
		} catch {
			// Not proof of an existing PR either way -- fall through to attempting creation below.
		}
	}
	const created = safeGh(cwd, [
		"pr",
		"create",
		"--base",
		"develop",
		"--head",
		branch,
		"--title",
		`conductor auto: ${branch}`,
		"--body",
		"Opened automatically by `conductor auto` -- every applicable gate on this branch is approved. Review and merge per this project's gitflow (CLAUDE.md).",
	]);
	if (created !== null && created.trim().length > 0) {
		return { ok: true, detail: `PR created: ${created.trim()}` };
	}
	return {
		ok: false,
		reason:
			"could not open a PR via `gh` (missing/unauthenticated gh CLI, no GitHub remote, or a network failure) -- the branch is already pushed; land it manually (gh pr create --base develop --head " +
			branch +
			")",
	};
}

/** §10.2/FR-1: best-effort branch creation for a NEW, authorized run -- convenience, not load-bearing
 * for any fail-closed guarantee in this file (a git-unavailable cwd simply keeps `resolveGateGitContext`
 * on its own already-established "no-branch" degrade). */
function ensureDemandBranch(cwd: string, branch: string): void {
	safeGit(cwd, ["checkout", "-B", branch, "develop"]) ?? safeGit(cwd, ["checkout", "-B", branch]);
}

function checkpointPath(cwd: string, slug: string): string {
	return join(cwd, ".conductor", "auto", `${slug}.continue.json`);
}

/** D2 -- best-effort write; a checkpoint write failure must never mask the real stop reason already
 * decided by the caller (the checkpoint is a convenience for `--continue`, never evidence itself). */
function writeCheckpoint(cwd: string, slug: string, checkpoint: RunCheckpoint): void {
	try {
		mkdirSync(join(cwd, ".conductor", "auto"), { recursive: true });
		writeFileSync(checkpointPath(cwd, slug), JSON.stringify(checkpoint, null, 2), "utf8");
	} catch {
		// Best-effort (see this function's own comment) -- the caller already wrote the real stop reason
		// to stderr regardless of whether this write succeeds.
	}
}

/** FR-8: an absent OR corrupted run checkpoint never blocks `--continue` -- both collapse to `undefined`
 * here, so the caller (runAuto) always falls back to re-deriving everything from the real GateState. */
function readCheckpointHint(cwd: string, slug: string): Partial<RunCheckpoint> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(checkpointPath(cwd, slug), "utf8"));
		return parsed !== null && typeof parsed === "object" ? (parsed as Partial<RunCheckpoint>) : undefined;
	} catch {
		return undefined;
	}
}

/** Writes the run checkpoint from the REAL, just-observed GateStatusSnapshot (BR-5/R59: every field is
 * RE-DERIVED from the authoritative GateState at the moment of stopping, never carried over from a
 * caller-supplied hint) and reports the stop on stderr so a headless invocation still surfaces why it
 * halted, per FR-13's "checkpoint, then report, then push" ordering (push already happened by the time
 * a gate reaches this helper, except for the two earlier-in-the-loop stop points, which never pushed at
 * all -- nothing to push yet). */
function stopRun(io: CliIO, slug: string, snapshot: GateStatusSnapshot, gate: number, reason: RunStopReason): void {
	const checkpoint: RunCheckpoint = {
		last_gate: gate,
		next_gate: gate,
		demand_branch: snapshot.branch,
		depth_calibration: snapshot.calibration?.collapsedGates ?? [],
		deferred_human_decisions: snapshot.gates.filter((g) => g.status === "needs-human").map((g) => `gate ${g.gate}`),
		stop_reason: reason,
	};
	writeCheckpoint(io.cwd, slug, checkpoint);
	io.stderr.write(
		`conductor auto: run stopped at gate ${gate} (${reason}). Resume with: conductor auto --continue ${slug}\n`,
	);
}

/**
 * The orchestrator entry point (D1/§3.2's loop) -- a thin sequencer over the existing `gate *` surface,
 * never a second mutator of `GateState` and never a second sign-off path (H-Fase8, the falsifiable
 * hypothesis this whole ADR ratifies).
 *
 * Gate 6 scope note (disclosed, not silently resolved): step (c) of ADR §3.2's loop -- "delegar
 * trabalho aos subagentes de papel (Task)" -- has NO reachable call site from this function's own
 * signature. `RunAutoOptions`/`CliIO` (ADR §16, reproduced verbatim, no fields added by this Gate 6)
 * carry no Task-tool/session handle at all -- only `cwd`/`stdout`/`stderr`/`tty`. This Gate 6 does not
 * invent one (the ADR's own header flags the collaborator-injection shape for subagent delegation as an
 * open question this Gate 5 explicitly declined to guess).
 *
 * **Gate 8 loop-back, finding 1 (corrects this paragraph's own prior claim):** a non-mandatory gate is
 * NOT auto-approved without evidence -- `approveAuto`/N1's real implementation (`gate-store.ts`) now
 * refuses (throws) when a gate's attached evidence is empty, and this function's own catch at step (f)
 * converts that refusal into the same `needs-human` stop a mandatory gate's headless confirm already
 * produces. Concretely, until step (c) above actually exists: EVERY gate this function opens -- mandatory
 * or not -- stops as `needs-human` at its own approval step, because no evidence is ever attached without
 * a subagent to attach it. This is intentional and honest, not a regression: the alternative (the prior
 * behavior) silently recorded `method:"auto"` completions for gates that received zero real work, which
 * is precisely the hollow-completion defect Gate 8 found. A future phase that threads a session/Task
 * handle through `CliIO` (filling step (c) in, which would also let subagents call `runGateEvidence`)
 * is what makes non-mandatory auto-approval possible again -- this function does not fake that step in
 * the meantime.
 *
 * **Gate 8 loop-back, finding 3 (also disclosed, not silently implemented):** `RunStopReason`'s own
 * `"context-limit"` member (FR-13) is likewise structurally unreachable by this function today, for the
 * SAME root cause -- see that type's own doc comment and ADR 0009 §20 for the full disclosure.
 *
 * Also disclosed: FR-6 (every classification is a registered, auditable `Decision`) is NOT written to
 * the diary from inside this function. `RunAutoOptions`/`CliIO` provide no `homeDir` test seam (unlike
 * `cli.ts`'s real `CliIO`, which threads one through specifically so a test never touches this
 * developer's real `~/.conductor/diary`) -- writing unconditionally here would make every call to this
 * function during `npm test` mutate real per-machine state, exactly what `CliIO`'s own doc comment in
 * `cli.ts` calls "unacceptable" for the sibling model/credential commands (Unit Testing Principles
 * §3.12: a real, out-of-process, per-machine dependency is precisely where a double/seam belongs, not
 * where a production default should run unconditionally inside a path tests exercise directly). Every
 * classification outcome is still reported on `stdout`/`stderr`, so it is observable, just not yet
 * durably journaled by this function -- a real, narrower gap than FR-6 describes, not a silent skip.
 */
export async function runAuto(options: RunAutoOptions): Promise<number> {
	const { io } = options;
	const isContinue = options.continueSlug !== undefined;
	const demandId = options.continueSlug ?? slugify(options.demand);

	if (!isContinue) {
		// D8/§10.2: classification is the FIRST step of a NEW run -- vetoed or uncertain refuses BEFORE
		// any branch or GateState is ever created (edge 1/8): the run touches NOTHING under
		// `.conductor/gates` in this branch.
		const veto = evaluateStaticVeto({ demandString: options.demand });
		const classification: RiskClassification = veto.vetoed
			? { outcome: "vetoed", matched: { where: veto.where, pattern: veto.pattern } }
			: classifyRisk({
					demandString: options.demand,
					explicitRiskLow: options.riskLow ?? false,
					// No narrow-rule detector is implemented by this Gate 6 slice (disclosed, non-goal per
					// spec §9.6/Gate 4 §13 -- the mechanism was explicitly deferred, not silently assumed):
					// only an explicit `--risk=low` can authorize a NEW run today.
					narrowRuleMatch: false,
				});
		if (classification.outcome !== "authorized-low-risk") {
			const detail =
				classification.outcome === "vetoed"
					? `static veto matched (${classification.matched.where}: ${classification.matched.pattern})`
					: `risk classification needs a human (${classification.reason})`;
			io.stderr.write(`conductor auto: refusing to run "${options.demand}" unsupervised -- ${detail}\n`);
			return EXIT_STOPPED;
		}
		ensureDemandBranch(io.cwd, `feature/${demandId}`);
	}

	const budget = createSharedBudget(resolveBudgetLimit(options.budgetTokens));
	const gitContext = await resolveGateGitContext(io.cwd);
	// FR-20/21: the SAME model-precondition port `conductor gate start` already uses -- no second
	// selection path. Built here (no `io.homeDir`/`io.createModelRuntime` seam exists on this file's own
	// `CliIO`, per its own header) so this call reads real per-machine credential/catalog state exactly
	// like `cli.ts`'s `case "gate"` composition root already does; `createGateModelResolutionPort` never
	// throws -- a broken model runtime degrades to a refusing port, never an absent one.
	const modelResolutionPort = await createGateModelResolutionPort({
		workspaceRoot: io.cwd,
		createModelRuntime: defaultCreateModelRuntime,
	});
	const store = createPersistedGateStateStore({
		gatesDir: join(io.cwd, ".conductor", "gates"),
		repoId: gitContext.repoId,
		branch: gitContext.branch,
		modelResolutionPort,
		// D3 layer 2 (Gate 8 loop-back finding 5): the SAME real production witness `cli.ts`'s own
		// composition root passes to `gate approve` -- `conductor auto` is headless by construction (this
		// file's own header, D3 layer 1), so this always evaluates false for a real autonomous invocation,
		// independently of whatever the injected confirm channel resolves.
		isInteractive: defaultInteractivityWitness,
	});
	// D3 layer 1: the SAME sink every other headless caller uses -- this function never constructs a
	// `ConfirmChannel` of its own (R56/T75).
	const confirm = resolveConfirmChannel(io.tty);

	// BR-5/R59/FR-7/FR-8: the checkpoint is read ONLY to report a mismatch -- the resume point below is
	// ALWAYS derived from the real, persisted GateState, never from this hint.
	const hint = readCheckpointHint(io.cwd, demandId);
	let snapshot = store.status(demandId);
	const startGate = Math.max(1, snapshot.currentGate);
	if (hint?.next_gate !== undefined && hint.next_gate !== startGate) {
		io.stderr.write(
			`conductor auto: run checkpoint claimed next_gate ${hint.next_gate}, but the real GateState shows gate ${startGate} -- resuming from ${startGate} (BR-5/R59: the checkpoint is a hint, never authoritative).\n`,
		);
	}

	// FR-2/G7: registers the run's depth calibration through the SAME `gate calibrate` surface a human
	// `/cdt` run would use -- headless resolves `method:"auto"`. No narrow-rule collapsing is implemented
	// by this Gate 6 slice (see this function's own header), so the collapsed-gate list is always empty;
	// this still records a genuine, auditable calibration Decision via the real composed surface rather
	// than skipping the composition point. A refusal here is never fatal to the run itself.
	try {
		await runGateCalibrate({ cwd: io.cwd, demandId, store, collapse: [], confirm, source: "conductor-auto" });
	} catch {
		// Non-fatal -- proceed with an uncollapsed run (see this function's own comment above).
	}

	for (let gate = startGate; gate <= TOTAL_FLOW_GATES; gate++) {
		// D6/FR-11/R60: check-and-reserve BEFORE any work for this gate starts.
		if (budget.reserve(4_000) === null) {
			stopRun(io, demandId, store.status(demandId), gate, "budget-exceeded");
			return EXIT_BUDGET_EXCEEDED;
		}

		// (a) FR-3b: re-evaluate the veto over the diff materializing so far -- diff/path signal is
		// re-checked at every gate boundary, never only once at intake.
		const diff = materializedDiffSignal(io.cwd);
		const gateVeto = evaluateStaticVeto({ diffPaths: diff.diffPaths, diffText: diff.diffText });
		if (gateVeto.vetoed) {
			io.stderr.write(
				`conductor auto: veto matched on the materialized diff (${gateVeto.where}: ${gateVeto.pattern})\n`,
			);
			stopRun(io, demandId, store.status(demandId), gate, "needs-human");
			return EXIT_STOPPED;
		}

		// (b) open the gate through the SAME surface `conductor gate start` uses -- the model
		// precondition (FR-20/21) and the mandatory-floor check both run inside it.
		try {
			snapshot = runGateStart({ cwd: io.cwd, demandId, store, gate });
		} catch (error) {
			io.stderr.write(`conductor auto: gate ${gate} could not start: ${describeError(error)}\n`);
			stopRun(io, demandId, store.status(demandId), gate, "needs-human");
			return EXIT_STOPPED;
		}

		// (c) delegate substantive work to role subagents -- see this function's own header (disclosed
		// gap: not reachable from this signature at this Gate 6).

		// (d) D5/R58: secret-scan the staged diff before any push -- fail-closed if the diff itself
		// cannot be read (never "push, then fix").
		const stagedDiffText = readStagedDiffForSecretScan(io.cwd);
		const scan =
			stagedDiffText === null ? { clean: false as const, spans: [] } : scanStagedDiffForSecrets(stagedDiffText);
		if (!scan.clean) {
			io.stderr.write(
				`conductor auto: secret-scan blocked the push for gate ${gate} (${scan.spans.length} span(s) or unreadable diff)\n`,
			);
			stopRun(io, demandId, store.status(demandId), gate, "needs-human");
			return EXIT_STOPPED;
		}

		// (e) FR-18/19: commit is scoped to whatever is already staged.
		commitGateScoped(io.cwd, gate);

		// (f) approve
		if (MANDATORY_GATES.has(gate)) {
			// Error handling gap found and fixed alongside the Gate 8 loop-back (this branch had NO
			// try/catch at all, unlike its non-mandatory sibling below): `runGateApprove` -> `store.approve`
			// throws a `GateCommandError` for reasons entirely orthogonal to the confirm channel itself
			// (e.g. insufficient evidence, R25/BR-6, or the gate never having been started) -- left
			// uncaught, that would crash the whole run instead of stopping gracefully, the exact "never a
			// crash reaching the user" discipline BR-4 already requires for budget exhaustion and every
			// other step in this loop.
			try {
				snapshot = await runGateApprove({ cwd: io.cwd, demandId, store, gate, confirm, source: "conductor-auto" });
			} catch (error) {
				io.stderr.write(`conductor auto: gate ${gate} could not be approved: ${describeError(error)}\n`);
				stopRun(io, demandId, store.status(demandId), gate, "needs-human");
				return EXIT_STOPPED;
			}
			const record = snapshot.gates.find((g) => g.gate === gate);
			if (record?.status !== "approved") {
				// FR-14/T75/R56: headless -> the injected channel resolves false -> needs-human. The run
				// stops HERE, never retries the same confirm, never falls back to a second channel.
				stopRun(io, demandId, snapshot, gate, "needs-human");
				return EXIT_STOPPED;
			}
		} else {
			try {
				snapshot = store.approveAuto(demandId, gate);
			} catch (error) {
				io.stderr.write(`conductor auto: gate ${gate} could not be auto-approved: ${describeError(error)}\n`);
				stopRun(io, demandId, store.status(demandId), gate, "needs-human");
				return EXIT_STOPPED;
			}
		}

		// (g) push -- best-effort; the secret-scan at (d) already gated whether pushing was safe.
		pushBranch(io.cwd, snapshot.branch);
	}

	// 5. every applicable gate approved -> land for real (Gate 8 loop-back, finding 4: never a bare
	// stdout claim -- see landOnDevelop's own header for why this never auto-merges).
	const landing = landOnDevelop(io.cwd, snapshot.branch);
	if (!landing.ok) {
		io.stderr.write(
			`conductor auto: all applicable gates approved for "${demandId}", but landing on develop failed -- ${landing.reason}\n`,
		);
		stopRun(io, demandId, snapshot, TOTAL_FLOW_GATES, "needs-human");
		return EXIT_STOPPED;
	}
	io.stdout.write(`conductor auto: all applicable gates approved for "${demandId}" -- landed (${landing.detail}).\n`);
	return EXIT_LANDED;
}

/**
 * D8 -- `2_000_000` tokens, env-overridable via `CONDUCTOR_AUTO_TOKEN_BUDGET` and by `--budget`,
 * sintonizável no Gate 11. A declared, overridable default (the same honesty ADR 0008 already applied
 * to cooldown/backoff/TTL) -- never treated as a discovered truth.
 */
export const DEFAULT_AUTO_RUN_TOKEN_BUDGET = 2_000_000;
