/**
 * Gate sign-off minting (Gate 5, Fase 4 "Gates e evidências" — ADR 0005 §6/§18 appendix,
 * gate2-spec-fase4.md Grupo D FR-7/FR-10/FR-11, gate3-addendum-fase4.md T40, rule R22).
 *
 * GATE 5 (test-first): `mintHumanApproval`/`mintAutoApproval`/`isGenuineHumanApproval` below are all
 * unconditional throws — the SAME precedent this package's own `tools/task.ts` documents for its own
 * Gate 5 ("Gate 5's stubs threw 'not implemented'"; see that file's header and
 * `test/tools/task.test.ts`'s own header). Gate 6 fills these bodies in for real. The TYPES here are
 * NOT a sketch — they mirror ADR 0005 §18's locked appendix contract for this file's slice
 * (`ApprovalMethod`, `Approval`, `mintHumanApproval`) — do not change these shapes without a new ADR.
 *
 * Scope boundary (two parallel Fase 4 Gate 5 streams — ADR 0005 §2 "I/O na borda, política pura no
 * meio"): this file owns ONLY the sign-off mint — WHO/HOW `method:"human"` may ever be produced for a
 * gate `Approval` (R22). It does NOT own `GateState`, `GateStateStore`, `mutateGateState`,
 * `evaluateAdvance`, `isMandatorySatisfied`, or `evaluateCalibration` — a parallel Gate 5 stream (ADR
 * 0005 §2/§4/§5/§7) is responsible for those. That parallel stream's `gate-state.ts` (its own domain
 * aggregate: `GateState`/`GateRecord`/`Evidence`/`Decision`/`CalibrationDecision`/`Risk`) IMPORTS
 * `Approval`/`ApprovalMethod` FROM this file rather than redeclaring them — confirmed by that file's
 * own header ("sign-off minting (gate-approval.ts: Approval/ApprovalMethod/mintHumanApproval/
 * mintAutoApproval) ... already landed their own shared types — this file REUSES them by import"). This
 * file is therefore the single, canonical home of `Approval`/`ApprovalMethod` for the whole package —
 * do not let a future edit redeclare them a second time anywhere else (that collision was caught and
 * reverted once already during this Gate 5 — see git history of this file).
 *
 * The pre-existing `ApprovalMethod` in `audit-trail.ts` (`"human" | "yes-flag" | "allowlist" | "none"`)
 * is a DIFFERENT domain — a tool-call decision (write/edit/bash), not a gate sign-off — and is left
 * completely untouched by this file. `index.ts` re-exports this file's `ApprovalMethod` under the alias
 * `GateApprovalMethod` specifically to avoid that public barrel collision; within this file (and
 * `gate-state.ts`, which imports it directly from here) the plain name `ApprovalMethod` is used. The two
 * enums intentionally do not share a name collision risk at the FIELD level either: this file's
 * `Approval` field is `method` (ADR 0005 §18 appendix), never `approvalMethod` — see
 * `test/gate-approval-sole-mint.test.ts`'s own header for why that naming choice matters for its static
 * scan.
 */

export type ApprovalMethod = "human" | "auto";

// R22/T40 (ADR 0005 §6): a construction-token brand. `HUMAN_MINT` is a `unique symbol` that is NEVER
// exported — no code outside this module can even NAME the property key required to genuinely satisfy
// it, so a hand-built object literal `{ ...meta, method: "human", approvedAt }` can be structurally
// assignable to `Approval` (the branded field is optional) but will never carry the actual symbol-keyed
// property a real mint sets. This does NOT claim to be unbypassable by a determined author reaching for
// `as unknown as Approval` — that escape hatch always exists in TypeScript. What it buys is the same
// honesty Ruling B (ADR 0005 §7) already accepts for `GateAdvanceVerdict`'s `approved`: a fabricated
// value is a VISIBLE, GREPPABLE, REVIEWABLE lie (an explicit double-cast, or — the structural half this
// file's own test suite enforces — the ONLY file in this package's source allowed to even write the
// literal `method: "human"` at all, see `test/gate-approval-sole-mint.test.ts`), never an
// indistinguishable-at-runtime forgery. `isGenuineHumanApproval` below is the runtime detector that
// makes that distinction checkable, not just asserted in a comment.
// GATE 6: a REAL, module-private runtime symbol (not merely an ambient `declare const`, which would
// have no runtime value at all -- a computed property `[HUMAN_MINT]` written against an undeclared
// ambient binding would throw `ReferenceError` the moment any code tried to actually set it). `Symbol()`
// is intentionally NOT `Symbol.for(...)` -- a well-known/global-registry symbol is guessable/creatable
// by any other module that also calls `Symbol.for()` with the same key, which would let a hand-built
// object literal elsewhere in the codebase forge the brand; a plain `Symbol()` is unique per-realm and
// only ever reachable via this module's own closed-over binding, never exported.
const HUMAN_MINT: unique symbol = Symbol("gate-approval.human-mint");

/** Everything the mint needs to know about WHICH gate/demand/branch/source an `Approval` is for — never
 * the proof itself. R23 (ADR 0005 §4): an `Approval` only counts for gate N if it is structurally keyed
 * to (gate, demandId, branch) — the caller (the parallel GateStateStore stream) is responsible for that
 * keying check; this file only carries the fields needed to make it possible. */
export interface ApprovalMeta {
	gate: number;
	demandId: string;
	branch: string;
	/** Opaque reference to the source that produced this approval (a session id, a CI run id, ...) —
	 * NEVER the proof by itself. ADR 0005 §6: "human" proves the CHANNEL (an interactive confirm
	 * resolved true), not the PERSON at the keyboard — the same honest residual `audit-trail.ts` already
	 * accepts for tool-call approvals. */
	source: string;
}

export interface Approval extends ApprovalMeta {
	method: ApprovalMethod;
	/** ISO-8601 string — never a `Date` (ADR 0005 §9.2's checksum gotcha: mixing `Date` objects into a
	 * canonicalized/checksummed structure is a silent-corruption trap the parallel GateStateStore stream
	 * already named; this field inherits the same discipline `audit-trail.ts`'s `isValidIsoTimestamp`
	 * already enforces for a sibling domain). */
	approvedAt: string;
	/** Present ONLY on an `Approval` that was actually produced by `mintHumanApproval` below — absent on
	 * every other value, including one a caller hand-built and cast (see this file's header on the
	 * honest limit of that guarantee). Never read or set by any code outside this module. */
	readonly [HUMAN_MINT]?: true;
}

/**
 * The ONE producer of `method:"human"` (R22, T40 mitigation (c) — gate3-addendum-fase4.md). Every
 * genuine call site is REQUIRED to have obtained `confirmResult` from `confirmOrDeny` (confirm.ts) — or
 * a sink sharing its exact two invariants (`!hasUI -> false`, `timeout/reject -> false`, never
 * allow-on-timeout) — never a value assembled any other way: not a `--yes` flag, not an allowlist hit,
 * not a raw `true` a caller writes to skip the prompt. This is the "condição vinculante" the
 * security-engineer attached to R22 at Gate 4 (ADR 0005 §6): the mint consumes the CHANNEL's result, it
 * never re-derives or accepts a second, parallel confirmation mechanism.
 *
 * `mintHumanApproval` cannot itself verify WHERE its boolean came from — an inherent limit of a plain
 * `boolean` parameter, named honestly in this file's header and in ADR 0005 §6's own condition. The
 * structural half of R22 this file's test suite enforces instead is: no file besides this one may ever
 * construct an object literal claiming `method: "human"` at all
 * (`test/gate-approval-sole-mint.test.ts`, mirroring `test/tools/task-sole-constructor.test.ts`'s own
 * discipline for T41).
 *
 * Returns `null` — NEVER throws — when `confirmResult !== true` (fail-closed; mirrors
 * `SharedBudget.reserve()`'s own "uncertainty returns null, never throws" contract, shared-budget.ts).
 * The autonomous/headless case (FR-11) is exactly this: `confirmOrDeny` resolves `false` because
 * `ctx.hasUI` is `false`, so this function is structurally incapable of minting `"human"` for it — the
 * caller records `status:"needs-human"` instead of ever reaching this factory with a truthy result.
 */
export function mintHumanApproval(confirmResult: boolean, meta: ApprovalMeta): Approval | null {
	// R22/T40(b): fail-closed -- anything other than a literal `true` (a headless `!hasUI` deny, a
	// timeout, an explicit deny, or a caller passing some other truthy-but-not-`true` value) refuses to
	// mint. This is the ONLY branch of this function; there is no second code path that could mint
	// "human" from a falsy/absent confirmResult.
	if (confirmResult !== true) {
		return null;
	}
	return {
		gate: meta.gate,
		demandId: meta.demandId,
		branch: meta.branch,
		source: meta.source,
		method: "human",
		approvedAt: new Date().toISOString(),
		[HUMAN_MINT]: true,
	};
}

/**
 * FR-10 (ADR 0005 §18 appendix): the ONE producer of `method:"auto"` — used exclusively to record an
 * autonomous, low-risk approval of a NON-mandatory gate. A mandatory gate reached by the autonomous
 * loop MUST NEVER call this function: FR-11 requires recording `status:"needs-human"` instead (that
 * transition belongs to the parallel GateStateStore/`evaluateAdvance` stream — this file only supplies
 * the mint primitive, never decides when it is legal to call it).
 *
 * Never returns a `method:"human"` value under any input — the return type's `method` is the literal
 * `"auto"`, so a caller cannot accidentally collapse an automatic approval into a human one (BR-7: "must
 * always be distinguishable — never collapse [a lesser method] into human", the same rule
 * `audit-trail.ts`'s FR-21/BR-11 already enforces for tool-call approvals, applied here to gate
 * sign-off).
 */
export function mintAutoApproval(meta: ApprovalMeta): Approval {
	return {
		gate: meta.gate,
		demandId: meta.demandId,
		branch: meta.branch,
		source: meta.source,
		method: "auto",
		approvedAt: new Date().toISOString(),
		// No [HUMAN_MINT] brand -- BR-7: an auto approval must never be structurally indistinguishable
		// from a genuine human one.
	};
}

/**
 * The runtime detector matching `HUMAN_MINT`'s own honesty limit (this file's header): distinguishes an
 * `Approval` that genuinely came out of `mintHumanApproval` from one that merely CLAIMS `method:"human"`
 * via a hand-built object literal (with or without an `as unknown as Approval` cast) — because the
 * latter never carries the actual symbol-keyed brand property, only `mintHumanApproval`'s own return
 * value does. This is what makes "forged human approval" a checkable predicate, not merely an assertion
 * in a comment — the same operationalization `task.ts:assertValidTaskToolResult` already gives R14's
 * "evidence is a checkable contract, not a claim in prose."
 */
export function isGenuineHumanApproval(approval: Approval): boolean {
	// Both halves matter: `method === "human"` alone is exactly what a forged literal also claims: the
	// brand-symbol check is what a hand-built object (even one cast `as unknown as Approval`) cannot
	// carry, because nothing outside this module can name the property key required to set it.
	return approval.method === "human" && approval[HUMAN_MINT] === true;
}
