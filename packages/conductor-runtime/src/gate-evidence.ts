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
 */

import { existsSync } from "node:fs";
import { isWithinRoot, resolveRealPath } from "./workspace-policy.ts";

export type EvidenceRef =
	| { kind: "git-commit"; sha: string }
	| { kind: "file"; path: string }
	| { kind: "journal-entry"; id: string }
	| { kind: "test-run"; id: string };

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
 * PARALLEL stream's scope); any object carrying a `provenance` field (e.g. a `gate-state.ts` `Evidence`
 * value) satisfies this structurally, with zero import edge required. */
export interface EvidenceProvenanceInfo {
	provenance: EvidenceProvenance;
}

/**
 * R25 "golden rule", operationalized as a pure predicate (ADR 0005 §8: "onde o runtime PODE derivar a
 * evidência, ele deriva, e isso vence um --ref digitado à mão... um ref de texto livre
 * não-verificável NÃO é tratado como suficiente para fechar um obrigatório sozinho"): a MANDATORY gate
 * (BR-6: "não pode ser aprovado vazio") is only considered to have SUFFICIENT evidence once at least one
 * attached item is "runtime-derived" — any number of "author-declared" items alone, even though each
 * individually resolved at Tier-1, is not enough on its own to close a mandatory gate.
 *
 * Pure — no I/O, no gate-state mutation. This is the INPUT SIGNAL the parallel GateStateStore stream's
 * own `isMandatorySatisfied`/BR-6 check should consult once it lands (pending integration, documented in
 * this file's header) — this function does not itself decide whether a gate MAY be approved, only
 * whether its attached evidence clears this one bar.
 */
export function hasSufficientEvidenceForMandatoryGate(evidence: readonly EvidenceProvenanceInfo[]): boolean {
	return evidence.some((item) => item.provenance === "runtime-derived");
}
