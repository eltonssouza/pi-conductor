/**
 * `conductor chat`'s status surface (docs/adr/0002-fase1-cli-foundation.md §7.5). Of the plan's
 * §4.16 fifteen fields, only five have real data available without machinery Fase 1 doesn't build
 * (gates, roles, budgets, subagents, evidence, Library, Diary -- ADR §7.5's own table). This module
 * formats exactly those five, each from a real, already-available data source -- no invented numbers:
 *
 *   1. active model       <- config.provider.model / session.model (already resolved)
 *   2. branch + dirty      <- git-status.ts (same subprocess pattern doctor.ts already has)
 *   3. tokens used         <- AgentSession.getSessionStats().tokens.total
 *   4. remaining context   <- AgentSession.getContextUsage() (tokens vs. contextWindow)
 *   5. permission level    <- protected-path count (workspace root + additionalProtectedPaths)
 *
 * The other ten (current gate, active role, remaining budget, running tools, active subagents,
 * pending risks, test results, RAG status, memory status, checkpoints) are deliberately absent, not
 * faked with placeholder values -- each needs a mechanism a later phase builds (gate state machine:
 * Fase 4; roles/skills: Fase 3; budgets: Fase 8; subagents: Fase 3's `task` tool; RAG: Fase 5; Diary:
 * Fase 6), per ADR §7.5's table. Whoever builds Fase 4's fuller status surface should extend
 * `buildStatusLine` below rather than rediscover which fields were already considered and deferred.
 *
 * Pure formatting only -- no I/O, no TUI dependency, trivially unit-testable.
 */

import type { GitStatusResult } from "../../git-status.ts";

/** Mirrors AgentSession.getContextUsage()'s shape structurally (no import needed -- see
 * resource-loader.ts's own precedent for why a structural type is preferable to a nominal import
 * here: this module has no other reason to depend on @earendil-works/pi-coding-agent's types). */
export interface ContextUsageLike {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

function formatCount(value: number): string {
	return NUMBER_FORMAT.format(value);
}

export function formatModelLine(modelLabel: string): string {
	return `model ${modelLabel}`;
}

export function formatGitLine(status: GitStatusResult): string {
	if (status.kind === "unavailable") return "git unavailable";
	return status.kind === "dirty" ? `branch ${status.branch} (dirty)` : `branch ${status.branch} (clean)`;
}

export function formatTokensUsedLine(totalTokens: number): string {
	return `${formatCount(totalTokens)} tokens used`;
}

/**
 * "Partial" per ADR §7.5: derived from tokens-used vs. the model's own context window, with no
 * per-gate/per-role budget concept (that needs Fase 8's machinery). `undefined`/`null` tokens (e.g.
 * right after compaction, before the next model response) render as "unknown" rather than a
 * misleading 0% or NaN.
 */
export function formatContextRemainingLine(usage: ContextUsageLike | undefined): string {
	if (usage === undefined || usage.tokens === null) return "context usage unknown";
	const remaining = Math.max(usage.contextWindow - usage.tokens, 0);
	const percentRemaining = usage.percent === null ? undefined : Math.max(0, Math.round(100 - usage.percent));
	const percentSuffix = percentRemaining === undefined ? "" : ` (${percentRemaining}% free)`;
	return `~${formatCount(remaining)} / ${formatCount(usage.contextWindow)} tokens free${percentSuffix}`;
}

/**
 * "Partial" per ADR §7.5: no 5-level permission engine yet (Fase 2) -- shows the current fail-closed
 * posture (the only posture Fase 1 has) plus how many paths are actively protected, so the user has
 * a concrete number instead of just the word "workspace-scoped".
 */
export function formatPermissionLevelLine(protectedPathCount: number): string {
	return `workspace-scoped, fail-closed, ${formatCount(protectedPathCount)} protected path${protectedPathCount === 1 ? "" : "s"}`;
}

export interface StatusLineFields {
	modelLabel: string;
	git: GitStatusResult;
	totalTokensUsed: number;
	contextUsage: ContextUsageLike | undefined;
	protectedPathCount: number;
}

/** Joins the five fields above into one line, in the order ADR §7.5 lists them. */
export function buildStatusLine(fields: StatusLineFields): string {
	return [
		formatModelLine(fields.modelLabel),
		formatGitLine(fields.git),
		formatTokensUsedLine(fields.totalTokensUsed),
		formatContextRemainingLine(fields.contextUsage),
		formatPermissionLevelLine(fields.protectedPathCount),
	].join(" | ");
}
