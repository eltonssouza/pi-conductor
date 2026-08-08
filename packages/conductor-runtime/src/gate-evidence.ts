/**
 * Evidence Tier-1 resolution (Gate 5, Fase 4 "Gates e evidências" — ADR 0005 §8/§18 appendix,
 * gate2-spec-fase4.md Grupo C FR-5/FR-6, gate3-addendum-fase4.md T41, rule R25).
 *
 * GATE 5 (test-first): `resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate` below are
 * unconditional throws — same precedent as this file's sibling `gate-approval.ts` and this package's
 * own `tools/task.ts` at its own Gate 5. Gate 6 fills these bodies in for real.
 *
 * Scope boundary (two parallel Fase 4 Gate 5 streams): this file owns ONLY evidence-reference
 * resolution — "does this `--ref` point at something real and abrível?" (Tier-1, mechanically
 * imponible, fail-closed) — never gate-state mutation (`GateStateStore`/`mutateGateState`, owned by the
 * parallel stream) and never Tier-2 relevance judgement ("does this evidence actually PROVE the gate
 * passed?" — an explicit spec Non-goal, gate2-spec-fase4.md §3, left to the Gate 8/9 reviewer).
 *
 * Tier-1 vs Tier-2 (ADR 0005 §8, confirmed by the security-engineer at Gate 4): a `--ref` that resolves
 * to a real object this repo/runtime can open satisfies Tier-1 — that is ALL this module ever asserts.
 * Whether the commit actually implements the gate's work, or the referenced test genuinely passed, is
 * Tier-2 and is explicitly NOT decided here (spec §3 Non-goal: "verificação automática de qualidade da
 * evidência ... é processo de quem aprova, Gate 8/9").
 *
 * Type ownership (resolved against the parallel GateStateStore/policy stream's own `gate-state.ts`):
 * `EvidenceRef`/`EvidenceProvenance` are declared ONCE, HERE. That file's own header confirms it
 * imports both FROM this file rather than redeclaring them ("evidence Tier-1 resolution
 * (gate-evidence.ts: EvidenceRef/EvidenceProvenance/resolveEvidenceRef/
 * hasSufficientEvidenceForMandatoryGate) already landed their own shared types -- this file REUSES them
 * by import"). Do not let a future edit redeclare them a second time anywhere else (an earlier revision
 * of this file briefly inverted the direction -- importing FROM `gate-state.ts` instead -- before the
 * two concurrent streams converged on this ownership; see this file's git/edit history).
 *
 * GATE 6: `resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate` implemented for real below.
 * `resolveEvidenceRef`'s `file` branch reuses `resolveRealPath`/`isWithinRoot` (workspace-policy.ts) —
 * the SAME fail-closed containment primitives write/edit already trust — rather than a second,
 * ad-hoc path check (ADR 0005 §8's own note names this precedent explicitly).
 *
 * GATE 8 LOOP-BACK (interim widening of `hasSufficientEvidenceForMandatoryGate`, until Fase 6's runtime
 * ledgers exist): Gate 8 ran the real CLI end-to-end and found `status:"approved"` structurally
 * UNREACHABLE for every mandatory gate — confirmed live, a real `git-commit` sha resolved and attached
 * to Gate 3 still refused approval, because the only two `EvidenceRef` kinds capable of producing
 * `"runtime-derived"` provenance (`test-run`/`journal-entry`) are fed by sets `cli.ts` always passes
 * EMPTY (no durable ledger exists yet — Fase 6 scope, see `ResolveEvidenceRefContext`'s own doc above).
 * Re-reading R25/T41 (the orchestrator, extending the decision directly rather than opening a full new
 * Gate 3/4 cycle): the golden rule was always Tier-1 (does `--ref` RESOLVE to a real object? —
 * mechanically imponible, fail-closed) vs Tier-2 (does it actually PROVE the gate's work? — an explicit
 * spec Non-goal, left to the Gate 8/9 human reviewer). A `git-commit` ref that resolved via
 * `resolveEvidenceRef`'s own `gitCommitExists` check is NOT the same kind of unverifiable, free-text
 * claim a `file` ref is — it had to correspond to a real object this repo's own commit graph already
 * contains, which is exactly as mechanically-enforced as `test-run`/`journal-entry`'s runtime-recorded-id
 * lookup. `hasSufficientEvidenceForMandatoryGate` below therefore accepts a resolved `git-commit` item
 * alone as sufficient, WITHOUT touching the existing `runtime-derived` branch or its priority —
 * `test-run`/`journal-entry` still wins outright once Fase 6 lands; `git-commit` is the interim
 * fallback; a `file` ref alone is still, deliberately, never enough (weaker anti-forgery: existsSync +
 * isWithinRoot only proves SOME file the caller pointed at sits inside the workspace). This is NOT a
 * relaxation of R25's fail-closed direction — empty evidence and file-only evidence are still refused
 * exactly as before; it is applying the Tier-1/Tier-2 split as it was already designed, to a kind
 * (`git-commit`) the original Gate 5/6 pass had not yet reconciled against it. See this function's own
 * doc comment below and `test/gate-evidence.test.ts`'s updated suite for the full before/after.
 *
 * FASE 6 NARROWING (ADR 0007 §4.2 D2/R40/T59, landed AFTER the Gate 8 loop-back above, and the reason
 * `journal-entry` is deliberately EXCLUDED from the `runtime-derived` branch below even though it can
 * resolve `provenance:"runtime-derived"` like `test-run` does): a `journal-entry` proves the runtime
 * observed a WRITE — existence — never that a TEST actually ran — work. Accepting it alone would let
 * `cdt journal add "did the work"` + `gate evidence --kind journal-entry` close a mandatory gate with
 * zero real work behind it. This is guarded by THREE independent tests today:
 * `test/gate-evidence-journal-entry-not-sole.test.ts` (this package, pure-function level),
 * `@conductor/cli`'s `test/commands/gate-cli.acceptance.test.ts` ("R40/D2 non-regression", end-to-end via
 * `runCli`), and `@conductor/cli`'s `test/commands/gate9-pentest.test.ts` (a dedicated Gate-9 PENTEST
 * regression: a FORGED journal-entry still cannot close a mandatory gate). See this function's own doc
 * comment below (the "5TH KIND" section) for why the 5th `EvidenceRef` kind added by ADR 0010
 * ("delegation") extends this branch while `journal-entry` deliberately does not, and for the
 * documented conflict between ADR 0010 §9/D7's own text and this Fase-6 decision.
 *
 * 5TH KIND (ADR 0010 "Wiring de delegação real de subagentes em runAuto" §9/D7, FR-5/FR-5a/FR-5b, Gate
 * 3 addendum R64): `EvidenceRef` gains a `"delegation"` member — a `sessionId` the runtime itself
 * observed spawning a REAL, disc-backed governed child session (tokens spent, files touched), never a
 * caller's claim. Its `resolveEvidenceRef` case (below) mirrors `test-run`/`journal-entry` exactly:
 * `ok:true, provenance:"runtime-derived"` iff the id is in a set the runtime itself populated
 * (`ctx.runtimeRecordedDelegationSessionIds`), never from disk/checkpoint/`--ref` (GAP-A).
 *
 * `hasSufficientEvidenceForMandatoryGate`'s runtime-derived branch below accepts `delegation` alongside
 * `test-run` — a genuinely observed delegation proves WORK (real tool calls, real files touched; see
 * `DelegationEvidence`'s own doc comment in `tools/task.ts`), the same class of evidence a `test-run`
 * is, not the "existence of a write" class a `journal-entry` is. This is a DELIBERATE, NARROWER reading
 * of ADR 0010 §9/D7 than that ADR's own prose asks for: D7's text says to extend the branch to "all
 * three runtime-derived kinds" (`test-run || journal-entry || delegation`), framing the current
 * `journal-entry` exclusion as a mere "pre-existing asymmetry" left over from before the golden rule's
 * own comment was written. Implementing that literally would REOPEN the exact vulnerability
 * `gate9-pentest.test.ts`'s T59/R40/D2 regression test exists to keep closed (a forged or merely
 * descriptive journal-entry closing a mandatory {3,5,7,8,9} gate with no real work behind it) and would
 * break that test plus the two others named above — none of which ADR 0010's own text acknowledges or
 * reconciles against. This Gate 5 pass therefore implements ONLY the `delegation` half of D7's
 * extension (uncontroversial: a new kind, no prior invariant to conflict with) and leaves
 * `journal-entry` excluded exactly as ADR 0007 §4.2 left it — flagged back to the architect/user for an
 * explicit Gate 3/4 reconciliation (CLAUDE.md's own "iterative with Gate 3" rule) rather than silently
 * implemented either way.
 */

import { existsSync } from "node:fs";
import { isWithinRoot, resolveRealPath } from "./workspace-policy.ts";

export type EvidenceRef =
	| { kind: "git-commit"; sha: string }
	| { kind: "file"; path: string }
	| { kind: "journal-entry"; id: string }
	| { kind: "test-run"; id: string }
	// 5th kind (ADR 0010 §9/D7, FR-5) — additive; the 4 above stay literal/unchanged. `role` is carried
	// for observability (which lead role's delegation this evidence attests to) but is NOT part of the
	// resolution check below (only `sessionId` membership in the runtime-observed set matters).
	| { kind: "delegation"; sessionId: string; role: string };

/**
 * R25 "golden rule" (T41 mitigation, portado de R14/`task.ts:DelegationEvidence`): a `test-run`/
 * `journal-entry` ref that the RUNTIME itself recorded is "runtime-derived" -- not forgeable by the
 * author of the `--ref` argument. A `git-commit`/`file` ref is "author-declared": Tier-1-resolvable
 * (it genuinely exists and is abrível), but only PROVES existence, never that the runtime actually
 * observed it doing anything -- a human/agent could point `--ref` at an unrelated real file.
 */
export type EvidenceProvenance = "runtime-derived" | "author-declared";

export interface ResolveEvidenceRefContext {
	/** Absolute path to this repo's root — used to resolve `git-commit` refs. */
	repoRoot: string;
	/** Absolute path to the workspace root — a `file` ref must resolve INSIDE this root (fail-closed
	 * containment, reusing `resolveRealPath`/`isWithinRoot` from `workspace-policy.ts`, per ADR 0005 §8's
	 * own note: "um arquivo que existe (dentro do workspace (resolveRealPath/isWithinRoot))"). */
	workspaceRoot: string;
	/** Injected collaborator (production: `git rev-parse --verify <sha>^{commit}` in `repoRoot`) so
	 * tests never need a real git binary/repo state — the same "fake the expensive collaborator, test
	 * the ordering/decision for real" split this package's own `permission-engine.ts`/`permission-gate.ts`
	 * boundary already draws. */
	gitCommitExists: (repoRoot: string, sha: string) => boolean;
	/**
	 * Ids the RUNTIME itself has recorded for a `test-run` ref. A real, durable ledger for this does
	 * not exist yet in this codebase (Fase 6 "Diary e captura automática" is the named home for a full
	 * event ledger, gate2-spec-fase4.md §1/§9.2 non-goal boundary) — this is the SEAM a future real
	 * ledger plugs into; a caller with no real ledger yet MUST pass an honestly-empty set, never a set
	 * that pretends to have observed something it did not.
	 */
	runtimeRecordedTestRunIds: ReadonlySet<string>;
	/** Same contract as `runtimeRecordedTestRunIds`, for `journal-entry` refs (e.g. `cdt journal add`
	 * entry ids this project's own diary already produces — a REAL source once wired, unlike
	 * `runtimeRecordedTestRunIds` which has no real producer yet). */
	runtimeRecordedJournalEntryIds: ReadonlySet<string>;
	/** ADR 0010 §9/D7/FR-5a (Gate 3 addendum R64/GAP-A): ids of a governed child session `runAuto` (or
	 * any other caller) itself observed `createGovernedChildSessionSpawner` spawn successfully — SAME
	 * contract as the two sets above (a caller with no real spawn to report MUST pass an honestly-empty
	 * set). By construction, this set has no disk-backed producer anywhere in this package: it is
	 * populated ONLY by a caller's own in-process observation of a completed spawn, NEVER by scanning
	 * `.conductor-agent/sessions/tasks/` (or any other directory) to "recover" a `sessionId` from a
	 * prior process invocation — see `packages/conductor-cli/src/commands/auto.ts`'s own `runGateDelegation`
	 * doc comment and `test/commands/auto-delegation-evidence-in-process-only.test.ts` (the static-scan
	 * regression guard for this exact invariant). */
	runtimeRecordedDelegationSessionIds: ReadonlySet<string>;
}

export type ResolveEvidenceRefResult = { ok: true; provenance: EvidenceProvenance } | { ok: false; reason: string };

/**
 * Tier-1 resolution (R25(i)): `ref` is REQUIRED (FR-5, enforced by the CLI layer before this function is
 * ever called) and MUST resolve to a real, abrível object of the kind it claims — a `--ref` pointing at
 * nothing is refused (`ok:false`), never silently attached as if it were evidence a reviewer could
 * later open. Fail-closed: any I/O uncertainty (e.g. `gitCommitExists`/filesystem access failing in a
 * way that isn't a clean "doesn't exist") must also resolve to `ok:false`, never `ok:true` by default —
 * the same direction BR-9/FR-15 already fix for `GateState` itself, applied here to a single evidence
 * item.
 */
export function resolveEvidenceRef(ref: EvidenceRef, ctx: ResolveEvidenceRefContext): ResolveEvidenceRefResult {
	try {
		switch (ref.kind) {
			case "git-commit":
				// Injected collaborator (production: `git rev-parse --verify <sha>^{commit}` in repoRoot) —
				// this function never shells out itself (testable without a real git binary/repo state).
				return ctx.gitCommitExists(ctx.repoRoot, ref.sha)
					? { ok: true, provenance: "author-declared" }
					: { ok: false, reason: `git-commit evidence ref does not resolve in this repo: "${ref.sha}"` };

			case "file": {
				// existsSync FIRST: resolveRealPath deliberately does NOT throw for a not-yet-existing
				// path (it walks up to the nearest existing ancestor so a not-yet-created file inside a
				// symlink-escaping chain is still caught) — so a plain existence check is the only way to
				// catch a genuinely dangling ref before asking "is it contained?".
				if (!existsSync(ref.path)) {
					return { ok: false, reason: `file evidence ref does not exist: "${ref.path}"` };
				}
				const realPath = resolveRealPath(ref.path, ctx.workspaceRoot);
				const workspaceRealPath = resolveRealPath(ctx.workspaceRoot, ctx.workspaceRoot);
				if (!isWithinRoot(realPath, workspaceRealPath)) {
					return { ok: false, reason: `file evidence ref resolves outside the workspace root: "${ref.path}"` };
				}
				return { ok: true, provenance: "author-declared" };
			}

			case "test-run":
				// R25 golden rule: only an id the RUNTIME itself recorded counts — an author-typed id that
				// merely looks plausible is refused, not merely downgraded.
				return ctx.runtimeRecordedTestRunIds.has(ref.id)
					? { ok: true, provenance: "runtime-derived" }
					: { ok: false, reason: `test-run evidence ref was never recorded by the runtime: "${ref.id}"` };

			case "journal-entry":
				return ctx.runtimeRecordedJournalEntryIds.has(ref.id)
					? { ok: true, provenance: "runtime-derived" }
					: { ok: false, reason: `journal-entry evidence ref was never recorded by the runtime: "${ref.id}"` };

			case "delegation":
				// ADR 0010 §9/D7/FR-5a: SAME pattern as test-run/journal-entry above -- membership in a
				// set only the runtime's own in-process observation of a completed spawn populates
				// (GAP-A: never disk/checkpoint/--ref).
				return ctx.runtimeRecordedDelegationSessionIds.has(ref.sessionId)
					? { ok: true, provenance: "runtime-derived" }
					: {
							ok: false,
							reason: `delegation evidence ref was never recorded by the runtime: "${ref.sessionId}"`,
						};

			default: {
				// Exhaustiveness guard: a future EvidenceRef variant that forgets a case here is a compile
				// error, not a silent fall-through that would otherwise need its own could-not-verify path.
				const exhaustive: never = ref;
				return { ok: false, reason: `unknown evidence ref kind: ${JSON.stringify(exhaustive)}` };
			}
		}
	} catch (error) {
		// R25(i)/BR-9 mirror: any I/O uncertainty (an unreadable filesystem entry, a thrown collaborator)
		// resolves to ok:false -- never ok:true by default, and never an uncaught exception a caller
		// could forget to handle.
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, reason: `evidence ref could not be verified: ${message}` };
	}
}

/** The minimal shape `hasSufficientEvidenceForMandatoryGate` needs from an attached evidence item --
 * deliberately NOT importing `gate-state.ts`'s own `Evidence` record (that file's aggregate is a
 * PARALLEL stream's scope); any object carrying `provenance`/`ref.kind` fields (e.g. a `gate-state.ts`
 * `Evidence` value, whose `ref: EvidenceRef` always carries a `kind` discriminant) satisfies this
 * structurally, with zero import edge required.
 *
 * `ref.kind` (GATE 8 LOOP-BACK addition): needed so the golden-rule check below can tell a genuinely
 * resolved `git-commit` apart from a resolved `file` — both currently share the identical
 * `provenance: "author-declared"` (see `resolveEvidenceRef` above), so `provenance` ALONE cannot make
 * that distinction; only the ref's own kind can. */
export interface EvidenceProvenanceInfo {
	provenance: EvidenceProvenance;
	ref: { kind: EvidenceRef["kind"] };
}

/**
 * R25 "golden rule", operationalized as a pure predicate (ADR 0005 §8: "onde o runtime PODE derivar a
 * evidência, ele deriva, e isso vence um --ref digitado à mão... um ref de texto livre
 * não-verificável NÃO é tratado como suficiente para fechar um obrigatório sozinho"): a MANDATORY gate
 * (BR-6: "não pode ser aprovado vazio") is considered to have SUFFICIENT evidence when either:
 *   1. at least one attached item is "runtime-derived" (`test-run`/`journal-entry`, once Fase 6's
 *      ledgers exist) — the strongest signal, checked and preferred FIRST, exactly as before this
 *      loop-back; or
 *   2. (GATE 8 LOOP-BACK, interim until (1) has real producers) at least one attached item is a
 *      genuinely-resolved `git-commit` ref (`provenance === "author-declared" && ref.kind ===
 *      "git-commit"`) — `provenance: "author-declared"` is a value ONLY `resolveEvidenceRef` ever
 *      produces (never a caller-supplied guess: `gate.ts`'s `runGateEvidence` always OVERWRITES
 *      whatever provenance the caller declared with `resolveEvidenceRef`'s own verified result before
 *      persisting), so this branch can only fire for a sha that actually resolved against this repo's
 *      real commit graph via `gitCommitExists` — not a free-text, unverifiable claim.
 * A `file` ref sharing that same "author-declared" provenance is deliberately EXCLUDED from (2): it only
 * proves some path the caller pointed at exists inside the workspace, a strictly weaker anti-forgery bar
 * than a sha this repo's own history had to already contain. Any number of "author-declared" `file`-only
 * items, alone, still never closes a mandatory gate — unchanged from before this loop-back.
 *
 * Pure — no I/O, no gate-state mutation. This is the INPUT SIGNAL the parallel GateStateStore stream's
 * own `isMandatorySatisfied`/BR-6 check (and `gate-store.ts`'s own `approve()`) consult — this function
 * does not itself decide whether a gate MAY be approved, only whether its attached evidence clears this
 * one bar.
 */
export function hasSufficientEvidenceForMandatoryGate(evidence: readonly EvidenceProvenanceInfo[]): boolean {
	// ADR 0010 §9/D7 (5th kind): `delegation` joins `test-run` here -- a genuinely runtime-observed
	// delegation proves WORK (real tool calls / files touched), the same class of proof a test-run is.
	// `journal-entry` deliberately does NOT join this branch -- see this file's own header ("FASE 6
	// NARROWING" / "5TH KIND") for why ADR 0010 §9/D7's own text asks for journal-entry too, and why
	// this Gate 5 pass does not implement that half of it.
	if (
		evidence.some(
			(item) =>
				item.provenance === "runtime-derived" && (item.ref.kind === "test-run" || item.ref.kind === "delegation"),
		)
	) {
		return true;
	}
	return evidence.some((item) => item.provenance === "author-declared" && item.ref.kind === "git-commit");
}
