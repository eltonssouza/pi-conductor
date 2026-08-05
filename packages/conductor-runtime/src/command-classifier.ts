/**
 * Command Classifier (Fase 2, Gate 2 spec Grupo A / ADR 0003 §3 / gate3-addendum-fase2.md T17,
 * T23, R1, R2, GAP-A, GAP-D).
 *
 * Assigns a Risk Tier (low/medium/high/critical) to a `bash` command string BEFORE the Permission
 * Engine (permission-engine.ts) decides whether to auto-approve, ask a human, or deny outright.
 * Fase 0/1 only had a binary confirm() gate for bash (see permission-gate.ts's module doc: "a
 * command-risk classifier is explicitly deferred to Fase 2") — this file is that classifier.
 *
 * Binding requirements this Gate-5 STUB exists to be tested against (Gate 6 implements them for
 * real; see ADR 0003 §3.1-3.3):
 *   - TOTAL: classifyCommand must NEVER throw, for any input (BR-1/BR-9/FR-4). An input the
 *     classifier cannot analyze must resolve to tier "critical", never "low".
 *   - DIRECTIONAL: obfuscation/encoding/indirection-to-an-interpreter can only ever RAISE the tier
 *     that a plain reading of the command would suggest, never lower it (R1/T17). The walkthrough
 *     that pins this down is `echo cm0gLXJmIC8= | base64 -d | sh` (T17): the destructive verb
 *     never appears literally, yet the tier must land at "high" or above.
 *   - REUSES workspace-policy.ts, does not reimplement it (ADR §3.3, "one path authority, two
 *     callers"): whatever target-extraction Gate 6 builds for `>`, `>>`, `rm`, `mv`, `truncate`,
 *     `dd`, `tee`, `install`, `cp` must call `evaluateToolPath`/`resolveRealPath` from
 *     workspace-policy.ts for the actual protected-path/workspace-containment verdict — it must
 *     NOT grow a second, divergent path-checking implementation (T23/GAP-D).
 *   - `provablyContained` defaults to `false`: only a target that is both statically resolvable
 *     AND reported `allowed` by `evaluateToolPath`, with no indirection/obfuscation/unanalyzable
 *     span anywhere in the command, may set it `true`. This is the single gate `isYesEligible`
 *     (permission-engine.ts) relies on for R8 (`--yes` structural impossibility of reaching a
 *     protected path) — see permission-engine.test.ts.
 *
 * STUB (Gate 5 — test-first): the real heuristic (14 signals, tier = max(signals), the allowlist
 * carve-out) is Gate 6 work. This function deliberately THROWS for every input, so every test in
 * command-classifier.test.ts fails RED for the right reason: none of the above guarantees exist
 * yet, including the "never throws" one — that gap is exactly what BR-1/BR-9/FR-4 require Gate 6
 * to close.
 */

import type { PathCheckResult, WorkspacePolicyOptions } from "./workspace-policy.ts";

export type RiskTier = "low" | "medium" | "high" | "critical";

/** One of the mutation/removal/read operands the target-extractor pulls out of a bash string. */
export type ExtractedTargetVia = ">" | ">>" | "rm" | "mv" | "truncate" | "dd" | "tee" | "install" | "cp" | "read";

export interface ExtractedTarget {
	/** The raw operand text as it appeared in the command, before any resolution. */
	raw: string;
	via: ExtractedTargetVia;
	/** False when the operand could not be resolved to a concrete path statically (e.g. `$TARGET`, a subshell). */
	staticallyResolvable: boolean;
	/** Set only when staticallyResolvable — the workspace-policy.ts verdict for this target (T23/GAP-D). */
	containment?: PathCheckResult;
}

export interface TierSignal {
	/** Short machine-stable identifier for the signal that fired (e.g. "known-catastrophic", "decode-to-interpreter"). */
	kind: string;
	tier: RiskTier;
	/** Human-readable explanation surfaced to the approval UI / audit trail. */
	detail: string;
	target?: ExtractedTarget;
}

/**
 * Minimal shape of the allowlist grant this Gate-5 stub consumes (ADR 0003 §3.2 signal 1, FR-3).
 * The real, trust-checked `EffectiveCommandPolicy` is assembled by policy-engine.ts (owned by the
 * parallel policy/secrets/redaction Gate-5 stream, per ADR 0003 §5/§9) — this local, minimal type
 * is the seam `ClassificationContext.policy` uses until Gate 6 reconciles the two. Per ADR §13.4
 * costura #1, whatever is passed here MUST already be the effective (trust + ceiling resolved)
 * policy — the classifier consumes it, it never merges sources itself.
 */
export interface ClassifierAllowlistEntry {
	pattern: string;
	risk: "low" | "medium";
}

export interface ClassificationContext {
	workspace: WorkspacePolicyOptions;
	policy?: {
		allowlist?: ClassifierAllowlistEntry[];
	};
}

export interface ClassificationResult {
	/** max() over every signal that fired; never below the highest-raising signal (R1). */
	tier: RiskTier;
	signals: TierSignal[];
	/** Default false (R8) — only true when every extracted target is proven contained AND no indirection/obfuscation fired. */
	provablyContained: boolean;
	/** True when some span of the command could not be lexed/decoded into a recognized token. */
	hasUnanalyzableSpan: boolean;
	/** The exact bytes shown to the human approver — must equal what was classified (R2, "classify-what-you-show"). */
	displayCommand: string;
}

/**
 * Puro, síncrono, TOTAL: nunca lança — falha interna vira tier:"critical" (BR-1/BR-9/FR-4).
 *
 * STUB (Gate 5): throws unconditionally. This is a deliberately WRONG implementation, not a
 * missing one — see the file-level doc above for why that is the more useful RED signal here.
 */
export function classifyCommand(_command: string, _ctx: ClassificationContext): ClassificationResult {
	throw new Error("not implemented: classifyCommand (Gate 6 — ADR 0003 §3)");
}
