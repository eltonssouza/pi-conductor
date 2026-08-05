/**
 * Permission Engine — the Policy Decision Point (PDP) of the Fase-2 split (ADR 0003 §2).
 *
 * `permission-gate.ts` (existing) is the Policy Enforcement Point (PEP): it owns `pi.on("tool_call")`,
 * `ctx.ui.confirm()`, and (Gate 6) the audit-trail write. This file is the PDP the PEP will consult:
 * a pure function of `(toolName, input, options)` — no `ctx`, no UI, no disk — so the 5-level ×
 * risk-tier × `--yes` decision matrix is unit-testable without a `ctx` double (ADR §2, grounded in
 * Architecture Boundaries and the Dependency Rule §2.3/§3.3/§3.4: "policy in the middle, I/O at the
 * edges").
 *
 * Binding requirements this Gate-5 STUB exists to be tested against (Gate 6 implements them; ADR
 * 0003 §2/§4):
 *   - R10/T27/FR-22 (regression, non-negotiable): a tool with no explicit, unambiguous Permission
 *     Level resolves to "security" (the level of GREATEST scrutiny) and is denied — "no policy
 *     declared" is the terminal branch that must survive this refactor exactly as it exists today
 *     in permission-gate.ts's decideToolCall.
 *   - R8/T24 (the user's vetor #2 — "--yes bypassing a protected-path/critical command must be
 *     STRUCTURALLY impossible, not just 'shouldn't happen'"): `isYesEligible` only returns true when
 *     ALL SIX prongs of ADR §4 hold, with `provablyContained` defaulting to `false`. Absence of
 *     evidence-of-danger is not proof-of-safety.
 *   - BR-8 (critical tier has no approval path at all): `decide()` must never return
 *     `{ outcome: { kind: "needs-approval" } }` for a `bash` call whose classification tier is
 *     "critical" — it is an unconditional deny, human-available-or-not, `--yes`-or-not.
 *   - R5/FR-6/FR-8 (Network is default-deny except the already-consented model-provider endpoint):
 *     any other destination is denied without an explicit consent entry, closing the "doctor's
 *     Library-backend ping" gap named in FR-8 (today an ungated exception).
 *
 * STUB (Gate 5 — test-first): every exported function throws. Nothing here is implemented; Gate 6
 * builds the real decision table on top of command-classifier.ts and workspace-policy.ts.
 */

import type { ClassificationResult } from "./command-classifier.ts";
import type { PolicyDecision } from "./fail-closed.ts";
import type { WorkspacePolicyOptions } from "./workspace-policy.ts";

export type PermissionLevel = "read" | "write" | "exec" | "network" | "security";

export type EngineOutcome =
	| { kind: "allow"; approvalMethod: "none" | "allowlist" | "yes-flag" }
	| { kind: "deny"; reason: string }
	| { kind: "needs-approval"; title: string; message: string };

/**
 * Minimal option surface this Gate-5 stub needs. `policy` mirrors the effective-policy shape
 * command-classifier.ts's `ClassificationContext` uses — the real, trust-checked `EffectivePolicy`
 * is policy-engine.ts's responsibility (parallel Gate-5 stream); reconciled at Gate 6.
 *
 * `permissionLevelOverride` / `networkDestination` exist for callers that are NOT a Pi
 * `tool_call` event at all — e.g. `conductor doctor`'s Library-backend ping (FR-8: "this ping stops
 * being an ungated exception"). `resolvePermissionLevel` only knows how to map *tool names*; a raw
 * network check from CLI code has no tool name to resolve, so it supplies the level directly. The
 * concrete call-site wiring for that is Gate 6 — this override is the seam it will use.
 */
export interface PermissionEngineOptions {
	workspace: WorkspacePolicyOptions;
	yesFlagActive: boolean;
	policy?: {
		allowlist?: Array<{ pattern: string; risk: "low" | "medium" }>;
		network?: Array<{ destination: string }>;
	};
	permissionLevelOverride?: PermissionLevel;
	networkDestination?: string;
}

/**
 * Maps a tool name to its Permission Level. Fail-closed by construction (R10/T27): a tool that is
 * not one of the explicitly-known names below resolves to "security" — the level of greatest
 * scrutiny — never to a permissive default.
 *
 * STUB (Gate 5): throws unconditionally (see file-level doc).
 */
export function resolvePermissionLevel(_toolName: string): PermissionLevel {
	throw new Error("not implemented: resolvePermissionLevel (Gate 6 — ADR 0003 §2)");
}

/**
 * The Permission Engine's core decision. Pure: no `ctx`, no UI, no disk. Internally (Gate 6) this
 * will call `resolvePermissionLevel`, `classifyCommand` (for `exec`-level calls), and
 * `evaluateToolPath` (for `read`/`write`-level calls) — never a second, parallel implementation of
 * any of those (T23/GAP-D discipline, ADR §3.3).
 *
 * STUB (Gate 5): throws unconditionally (see file-level doc).
 */
export function decide(
	_toolName: string,
	_input: unknown,
	_options: PermissionEngineOptions,
): { outcome: EngineOutcome; permissionLevel: PermissionLevel; riskTier?: ClassificationResult["tier"] } {
	throw new Error("not implemented: decide (Gate 6 — ADR 0003 §2/§4)");
}

/**
 * `--yes` eligibility (ADR 0003 §4, R8/T24). Deliberately a SEPARATE, small, pure predicate (not
 * folded into `decide()`) so its six-prong invariant can be exhaustively tested on its own —
 * see permission-engine.test.ts's "isYesEligible: structural impossibility" suite, which tries
 * every plausible way to trick this into `true` over a protected-path deny or a `critical` tier.
 *
 * Contract (ADR §4): eligible ⟺
 *   baseDecision.block === false                                        (never suppress a DENY)
 *   && level !== "security"
 *   && !(level === "network" && !networkConsented)
 *   && (tier === "low" || tier === "medium")                            (never high/critical)
 *   && result.provablyContained === true                                (positive proof required)
 *   && result.hasUnanalyzableSpan === false
 *
 * STUB (Gate 5): throws unconditionally (see file-level doc).
 */
export function isYesEligible(
	_result: ClassificationResult,
	_baseDecision: PolicyDecision,
	_level: PermissionLevel,
	_networkConsented: boolean,
): boolean {
	throw new Error("not implemented: isYesEligible (Gate 6 — ADR 0003 §4)");
}
