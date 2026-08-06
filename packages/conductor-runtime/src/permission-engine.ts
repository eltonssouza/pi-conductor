/**
 * Permission Engine — the Policy Decision Point (PDP) of the Fase-2 split (ADR 0003 §2).
 *
 * `permission-gate.ts` (existing) is the Policy Enforcement Point (PEP): it owns `pi.on("tool_call")`,
 * `ctx.ui.confirm()`, and (a follow-up gate, out of this stream's scope) the audit-trail write. This
 * file is the PDP the PEP will consult: a pure function of `(toolName, input, options)` — no `ctx`,
 * no UI, no disk — so the 5-level × risk-tier × `--yes` decision matrix is unit-testable without a
 * `ctx` double (ADR §2, grounded in Architecture Boundaries and the Dependency Rule §2.3/§3.3/§3.4:
 * "policy in the middle, I/O at the edges").
 *
 * Wiring `permission-gate.ts`'s `bash` branch to call `decide()` (so T23/T24 close end-to-end
 * through the real `pi.on("tool_call")` hook) is explicitly OUT of this file's scope — the
 * orchestrator scoped this stream to command-classifier.ts/permission-engine.ts/audit-trail.ts only,
 * to avoid a merge collision with a parallel stream editing policy/secrets/redaction in the same
 * area. That wiring has no failing test driving it yet and is flagged as a Gate 6 follow-up.
 */

import { type ClassificationResult, classifyCommand } from "./command-classifier.ts";
import type { PolicyDecision } from "./fail-closed.ts";
import type { WorkspacePolicyOptions } from "./workspace-policy.ts";

export type PermissionLevel = "read" | "write" | "exec" | "network" | "security";

export type EngineOutcome =
	| { kind: "allow"; approvalMethod: "none" | "allowlist" | "yes-flag" }
	| { kind: "deny"; reason: string }
	| { kind: "needs-approval"; title: string; message: string };

export type DecideResult = {
	outcome: EngineOutcome;
	permissionLevel: PermissionLevel;
	riskTier?: ClassificationResult["tier"];
};

/**
 * The structural seam this file and permission-gate.ts share with the real, trust-checked
 * `EffectivePolicy` `@conductor/config`'s `mergePolicies` produces (ADR 0003 §5/§16). conductor-runtime
 * cannot import that type nominally — not even type-only, per `@conductor/config`'s own
 * `policy-loader.ts` header: "not even a type-only import edge is needed" (ADR 0002 §3.1's dependency
 * graph: conductor-config and conductor-runtime never depend on one another). A structurally-identical
 * local type lets any real `EffectivePolicy` value flow in as plain data from whichever package
 * composes both (conductor-cli — see its `commands/chat/policy-resolution.ts`), the same seam
 * `ClassificationContext.policy` already used for `allowlist` alone. Gate 6 (this loop-back closing
 * GAP-B) is the "future gate" that file's header named to reconcile the two — reconciliation here means
 * widening this seam to also carry `protectedPaths`/`denyAllPrivileged` (FR-9/FR-10/FR-23/FR-24), not
 * importing the nominal type.
 */
export interface EffectivePolicyInput {
	/**
	 * FR-9/FR-10/BR-5: restrictions from policy.json. Read and unioned into
	 * `WorkspacePolicyOptions.additionalProtectedPaths` by the composition root (session.ts) BEFORE
	 * this options object is built — `decide()`/`classifyCommand()` never read this field directly,
	 * they only ever see the already-merged `additionalProtectedPaths`. Present here only so a caller
	 * can pass one `EffectivePolicy`-shaped value through instead of splitting it apart at every call
	 * site.
	 */
	protectedPaths?: string[];
	allowlist?: Array<{ pattern: string; risk: "low" | "medium" }>;
	network?: Array<{ destination: string }>;
	/**
	 * FR-23/FR-24 (ADR 0003 §5.2/§16): true the instant any policy source failed to load validly —
	 * "a bad source is never outvoted by a majority of good ones". `read` is unaffected; every other
	 * level is denied outright for the whole session — see `decide()`'s own check below.
	 */
	denyAllPrivileged?: boolean;
}

/**
 * Minimal option surface `decide()` needs. `policy` mirrors the effective-policy shape
 * command-classifier.ts's `ClassificationContext` uses — the real, trust-checked `EffectivePolicy`
 * is policy-engine.ts's responsibility (parallel stream); reconciled at a later gate.
 *
 * `permissionLevelOverride` / `networkDestination` exist for callers that are NOT a Pi
 * `tool_call` event at all — e.g. `conductor doctor`'s Library-backend ping (FR-8: "this ping stops
 * being an ungated exception"). `resolvePermissionLevel` only knows how to map *tool names*; a raw
 * network check from CLI code has no tool name to resolve, so it supplies the level directly. The
 * concrete call-site wiring for that is a follow-up gate — this override is the seam it will use.
 */
export interface PermissionEngineOptions {
	workspace: WorkspacePolicyOptions;
	yesFlagActive: boolean;
	policy?: EffectivePolicyInput;
	permissionLevelOverride?: PermissionLevel;
	networkDestination?: string;
}

/**
 * Maps a tool name to its Permission Level. Fail-closed by construction (R10/T27): an explicit,
 * exhaustive map with a single `default -> "security"` branch — never a fallthrough that could be
 * mistaken for a permissive default, and case-sensitive by construction (object-key lookup does not
 * normalize case, so "READ" is simply absent from the map, not coerced to "read").
 */
const TOOL_NAME_TO_LEVEL: Readonly<Record<string, PermissionLevel>> = {
	read: "read",
	write: "write",
	edit: "write",
	bash: "exec",
	// ADR 0004 §2.3 correction #1 / gate3-addendum-fase3.md T31: without this entry, `task` falls
	// through to the "security" default below (auto-deny-only), which would make the tool
	// structurally unusable regardless of how correctly tools/task.ts implements runTask. `task` is
	// Exec-level: approving it is approving whatever the delegated role's own tools can reach
	// (R17a) -- the same order of authority as `bash`, not a lesser one.
	task: "exec",
};

export function resolvePermissionLevel(toolName: string): PermissionLevel {
	return TOOL_NAME_TO_LEVEL[toolName] ?? "security";
}

function extractBashCommand(input: unknown): string {
	if (input !== null && typeof input === "object" && "command" in input) {
		const command = (input as { command: unknown }).command;
		if (typeof command === "string") return command;
	}
	// No resolvable command string: fail closed by handing the classifier an empty command, which
	// its own malformed-input path (BR-9) resolves to tier "critical" — never silently allowed.
	return "";
}

function decideExec(input: unknown, options: PermissionEngineOptions): DecideResult {
	const classification = classifyCommand(extractBashCommand(input), {
		workspace: options.workspace,
		policy: options.policy,
	});

	// BR-8/T23/T24: a "critical" tier command has NO approval path at all — human-available-or-not,
	// --yes-or-not. This check runs before any --yes/approval logic specifically so nothing below it
	// can ever be reached for a critical command.
	if (classification.tier === "critical") {
		return {
			outcome: {
				kind: "deny",
				reason: `bash command classified as critical risk and denied outright: ${
					classification.signals.map((s) => s.detail).join("; ") || "unanalyzable command"
				}`,
			},
			permissionLevel: "exec",
			riskTier: "critical",
		};
	}

	// FR-3: ONLY an explicit policy.json allowlist grant (command-classifier.ts's
	// "policy-allowlist-grant" signal, from matchPolicyGrant) skips ctx.ui.confirm() outright. A "low"
	// tier reached via the classifier's OWN built-in heuristic (the "allowlisted" signal — "matches a
	// built-in known-safe command shape", no policy.json entry involved) is NOT the same thing: FR-1
	// only promises the risk tier is computed before confirm fires, not that a low tier skips confirm.
	// Falling through to the medium/high branch below is deliberate — it still asks a human (with the
	// tier surfaced in the approval message), and --yes/isYesEligible remains the only fast-path for it.
	const hasPolicyAllowlistGrant = classification.signals.some((s) => s.kind === "policy-allowlist-grant");
	if (classification.tier === "low" && hasPolicyAllowlistGrant) {
		return { outcome: { kind: "allow", approvalMethod: "allowlist" }, permissionLevel: "exec", riskTier: "low" };
	}

	// medium, high, or a "low" tier NOT backed by a policy.json grant: ask a human, unless --yes is
	// active AND structurally eligible (R8).
	const baseDecision: PolicyDecision = { block: false };
	if (options.yesFlagActive && isYesEligible(classification, baseDecision, "exec", true)) {
		return {
			outcome: { kind: "allow", approvalMethod: "yes-flag" },
			permissionLevel: "exec",
			riskTier: classification.tier,
		};
	}

	return {
		outcome: {
			kind: "needs-approval",
			title: `Approve bash command? (risk: ${classification.tier})`,
			message: classification.displayCommand,
		},
		permissionLevel: "exec",
		riskTier: classification.tier,
	};
}

function decideNetwork(options: PermissionEngineOptions): DecideResult {
	const destination = options.networkDestination;
	const consented =
		destination !== undefined && (options.policy?.network ?? []).some((entry) => entry.destination === destination);

	// R5/BR-3: --yes never substitutes for network consent — this check does not even look at
	// options.yesFlagActive, by construction, so there is no branch that could accidentally wire it in.
	if (!consented) {
		return {
			outcome: {
				kind: "deny",
				reason: `network destination "${destination ?? "(none provided)"}" is not consented — fail closed`,
			},
			permissionLevel: "network",
		};
	}
	return { outcome: { kind: "allow", approvalMethod: "allowlist" }, permissionLevel: "network" };
}

/**
 * The Permission Engine's core decision. Pure: no `ctx`, no UI, no disk. `read`/`write` branches
 * below are a minimal, conservative placeholder (never a silent allow for write) — the full
 * path-aware decision for those levels still lives in `permission-gate.ts` today
 * (evaluateToolPath + confirmOrDeny); wiring it through this PDP instead is a follow-up gate, not
 * covered by this stream's failing tests.
 */
export function decide(toolName: string, input: unknown, options: PermissionEngineOptions): DecideResult {
	const level = options.permissionLevelOverride ?? resolvePermissionLevel(toolName);

	// FR-23/FR-24 (ADR 0003 §5.2/§16, GAP-B loop-back): checked before the level-specific switch so
	// nothing below it — tier, an allowlist grant, --yes — can ever override a session-wide
	// denyAllPrivileged. Defensive-programming discipline already applied by resolvePermissionLevel's
	// own exhaustive map above (fail fast, bad data can't travel far — Software Construction Practices
	// — Complete Professional Guide §2.8/§2.9, cited for this file's fail-closed shape at Gate 5/6).
	if (level !== "read" && options.policy?.denyAllPrivileged === true) {
		return {
			outcome: {
				kind: "deny",
				reason:
					"a policy.json source failed to load validly — all privileged operations denied for this session (FR-23, fail closed)",
			},
			permissionLevel: level,
		};
	}

	switch (level) {
		case "security":
			return {
				outcome: { kind: "deny", reason: `no policy declared for tool "${toolName}" — fail closed` },
				permissionLevel: "security",
			};
		case "network":
			return decideNetwork(options);
		case "exec":
			return decideExec(input, options);
		case "read":
			return { outcome: { kind: "allow", approvalMethod: "none" }, permissionLevel: "read" };
		case "write":
			return {
				outcome: {
					kind: "needs-approval",
					title: `Approve ${toolName}?`,
					message:
						"write/edit calls require human approval — path containment is enforced by permission-gate.ts's existing evaluateToolPath call; full PDP wiring for write/edit is a follow-up gate",
				},
				permissionLevel: "write",
			};
	}
}

/**
 * `--yes` eligibility (ADR 0003 §4, R8/T24). A separate, small, pure predicate (not folded into
 * `decide()`) so its six-prong invariant can be tested exhaustively on its own.
 *
 * Contract (ADR §4): eligible iff ALL of:
 *   baseDecision.block === false                                        (never suppress a DENY)
 *   && level !== "security"
 *   && !(level === "network" && !networkConsented)
 *   && (tier === "low" || tier === "medium")                            (never high/critical)
 *   && result.provablyContained === true                                (positive proof required)
 *   && result.hasUnanalyzableSpan === false
 *
 * `provablyContained` defaults to false in ClassificationResult (command-classifier.ts) — absence
 * of a raised flag is never treated as proof of safety here.
 */
export function isYesEligible(
	result: ClassificationResult,
	baseDecision: PolicyDecision,
	level: PermissionLevel,
	networkConsented: boolean,
): boolean {
	if (baseDecision.block !== false) return false;
	if (level === "security") return false;
	if (level === "network" && !networkConsented) return false;
	if (result.tier !== "low" && result.tier !== "medium") return false;
	if (result.provablyContained !== true) return false;
	if (result.hasUnanalyzableSpan !== false) return false;
	return true;
}
