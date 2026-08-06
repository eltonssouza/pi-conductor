/**
 * The `task` tool — delegates a self-contained unit of work to another Conductor role, spawning an
 * in-process, governed child `AgentSession` (Gate 2 spec Grupo D: FR-7/FR-8/FR-9/FR-13..FR-19; ADR
 * 0004 §2/§5/§6; gate3-addendum-fase3.md T30/T31/T33/T34/T40/T41/T42, R13/R14/R16/R17a).
 *
 * GATE 5 (test-first): `runTask`, `createTaskTool`, and `assertValidTaskToolResult` are STUBS that
 * throw "not implemented" — Gate 6 implements the bodies (same precedent as this package's
 * `redaction.ts`/`shared-budget.ts`: a single, honest throw rather than a partially-working
 * approximation, so every test below fails RED for the same correct reason: the feature does not
 * exist yet). The TYPES in this file are NOT a sketch — they are the locked contract from ADR 0004
 * §16's appendix (`TaskToolParams`/`DelegationEvidence`/`TaskToolResult`) plus the collaborator seams
 * (`RoleRegistryView`, `SpawnChildSessionInput`/`Result`) this Gate 5 stream adds so `runTask`'s
 * ORDERING and DECISION logic (role lookup → canSpawn → depth cap → budget.reserve → spawn →
 * evidence) is unit-testable by injecting fakes for the expensive collaborators (a real `Agent`/
 * model turn), matching this package's own `permission-engine.ts`/`permission-gate.ts` split: a pure
 * decision function tested directly, a thin production wrapper (here, the eventual `defineTool`
 * wiring inside `createTaskTool`) tested separately at Gate 6/7.
 *
 * Precondition this file MUST keep (ADR §2.2, T41 mitigation #1 — "sole constructor"): `runTask`'s
 * (future) body is the ONLY place in this package's source that may call the Pi SDK's
 * `createAgentSession` to build a DELEGATION CHILD session. `test/tools/task-sole-constructor.test.ts`
 * enforces this by scanning source text, not by convention — deliberately, this Gate 5 stub does
 * NOT itself call that function anywhere, so that structural test starts RED (0 qualifying call
 * sites found) and only turns green once Gate 6 adds the ONE call this file is supposed to own.
 */

import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AuditTrailWriter } from "../audit-trail.ts";
import type { EffectivePolicyInput } from "../permission-engine.ts";
import type { BudgetUsage, SharedBudget } from "../shared-budget.ts";

/** ADR §16 appendix — the resolution `strategic`/`standard`/`lightweight` (never a hard-coded model
 * name). Deliberately a LOCAL, structural type: `conductor-config` and `conductor-runtime` never
 * depend on one another (ADR 0002 §3.1, reaffirmed at ADR 0004 §12) — a real `ConductorRole`'s
 * `modelRole` field already satisfies this shape without an import edge, the same seam
 * `EffectivePolicyInput` already uses for `@conductor/config`'s `EffectivePolicy`. */
export type ModelRoleView = "strategic" | "standard" | "lightweight";

/**
 * The minimal shape `runTask` needs from a role — a structural subset of `@conductor/config`'s real
 * `ConductorRole` (ADR §3.1's `ConductorRole` interface), so this package never imports that type.
 */
export interface ConductorRoleView {
	name: string;
	tools: string[];
	canSpawn: string[];
	modelRole: ModelRoleView;
}

/**
 * The seam that decouples `@conductor/runtime` from `@conductor/config`'s real Role Registry (ADR
 * §16 appendix). A parallel Gate 5 stream builds the real implementation; this file only needs
 * something structurally shaped like this to unit-test authorization ordering (FR-13/14/15) without
 * depending on that stream's in-flight files.
 */
export interface RoleRegistryView {
	get(roleId: string): ConductorRoleView | undefined;
	canSpawn(from: string, to: string): boolean;
}

/** Gate 2 spec FR-7/FR-9: the model's own `task` tool-call arguments — deliberately nothing else.
 * There is no field here (and none the model could add that `runTask` would read) for the parent's
 * conversation history: BR-5's isolation guarantee is structural, not a runtime choice to omit it. */
export interface TaskToolParams {
	role: string;
	prompt: string;
	isolated?: boolean;
}

/**
 * What `runTask` (Gate 6) constructs and hands to the injected `spawnChildSession` collaborator —
 * the gate references are NON-OPTIONAL (T41 precision #1, gate3-addendum-fase3.md §9.3): "esqueci de
 * fiar" must be a compile error, not a fail-open `if (policy) ...` a future edit could forget.
 */
export interface SpawnChildSessionInput {
	role: ConductorRoleView;
	prompt: string;
	depth: number;
	workspaceRoot: string;
	effectivePolicy: EffectivePolicyInput;
	auditTrailWriter: AuditTrailWriter;
	additionalProtectedPaths: string[];
	yesFlagActive: boolean;
	/**
	 * A NEW, disc-backed, empty `SessionManager` for the child (ADR §6: `SessionManager.inMemory()`
	 * would defeat R14 — no durable transcript to hand back as evidence). Constructed by `runTask`
	 * BEFORE calling this collaborator, never by the collaborator itself, so the same instance's file
	 * path is available to build `DelegationEvidence.transcript` afterwards regardless of how the
	 * child's turn concludes.
	 */
	sessionManager: SessionManager;
}

export interface SpawnChildSessionResult {
	finalText: string;
	sessionId: string;
	sessionFilePath: string;
	tokenUsage: BudgetUsage;
	filesTouched: string[];
}

/**
 * `details.merge` — ADR §6/R19: `autoApplied` is typed as the literal `false` so this tool can
 * never claim it auto-applied a worktree merge; "aplica limpo" (a conflict check) is never conflated
 * with "is safe to apply" (a content/security judgement).
 */
export type DelegationMergeStatus =
	| { isolated: false }
	| { isolated: true; worktreePath: string; appliesCleanly: boolean; diffPath: string; autoApplied: false };

/**
 * R14/GAP-3B (gate3-addendum-fase3.md T34): every field here is DERIVED FROM THE RUNTIME (the
 * SessionManager the runtime itself wrote to, the AuditTrailWriter's own record, SharedBudget's own
 * settle()) — never the child model's own prose about what it did. `content` (the free-text channel)
 * is where the child's self-report lives; this object is what makes that self-report independently
 * checkable, per BR-9/BR-10.
 */
export interface DelegationEvidence {
	/** The child's OWN session file — disc-backed (not inMemory), written by the runtime, openable
	 * by a reviewer independent of anything the child said about itself (T42: this file's on-disk
	 * bytes must already be redacted by the same write-path guard `session-redaction-guard.ts`
	 * installs for every `SessionManager` instance, parent or child). */
	transcript: { sessionId: string; filePath: string };
	role: string;
	depth: number;
	/** From `SharedBudget.settle()`'s own bookkeeping — never the child's self-reported usage. */
	tokenCost: BudgetUsage;
	/** From the SHARED `AuditTrailWriter` instance the child's re-wired gate writes to (not "the
	 * parent observing the child's tool-call bus" — in-process, the child has its own event bus;
	 * ADR §6's corrected source). Absent narration ("I fixed the bug") with no files listed here does
	 * NOT satisfy FR-19 when the task was to change files. */
	filesTouched?: string[];
	merge?: DelegationMergeStatus;
	budgetRemaining: number;
}

/** FR-8: the two-channel result contract every Conductor tool already follows (`content` stands
 * alone; `details` is never re-serialized into `content`'s text). `details` is REQUIRED on both
 * members — there is no `TaskToolResult` shape without evidence, success or failure. */
export type TaskToolResult =
	| { content: [{ type: "text"; text: string }]; details: DelegationEvidence }
	| { content: [{ type: "text"; text: string }]; details: DelegationEvidence; isError: true };

export interface CreateTaskToolOptions {
	/** The role currently running (the one whose model just called `task`). */
	callerRole: string;
	/** How many `task` levels already led to the CALLER's own session (0 = the user's top-level session). */
	depth: number;
	maxDepth: number;
	roleRegistry: RoleRegistryView;
	/**
	 * REQUIRED (R16b by construction, ADR §5.2): there is no code path in this file's contract that
	 * lets a child receive its own budget instead of this exact object.
	 */
	sharedBudget: SharedBudget;
	workspaceRoot: string;
	/** REQUIRED (T41 precision #1): the same, already-merged, trust-checked policy the caller's own
	 * gate was built from — never omitted, never re-derived. */
	effectivePolicy: EffectivePolicyInput;
	/** REQUIRED (R14/T41): the SAME writer instance the caller's gate audits to — a child's tool
	 * calls must land in the ONE audit trail, not a second, unlinked one. */
	auditTrailWriter: AuditTrailWriter;
	additionalProtectedPaths?: string[];
	/** REQUIRED, not defaulted silently (T41 precision #1) — mirrors the caller's own `--yes` state. */
	yesFlagActive: boolean;
	/**
	 * Injected collaborator that actually constructs and drives the governed child session. Real
	 * production wiring (Gate 6) calls the Pi SDK's `createAgentSession` here — and ONLY here (see
	 * this file's own header and `task-sole-constructor.test.ts`). Injectable so `runTask`'s
	 * authorization/budget/evidence ORDERING is unit-testable without a real model turn.
	 */
	spawnChildSession: (input: SpawnChildSessionInput) => Promise<SpawnChildSessionResult>;
}

/**
 * The pure(-ish) orchestration `runTask` (Gate 6) must implement, in this exact order (ADR §16
 * appendix comment; `conductor-main/tools/task.py:164-176` is the behavioral reference this order
 * ports): role-exists → target ∈ canSpawn → depth+1 <= maxDepth → sharedBudget.reserve(estimate) —
 * ALL synchronous, no network, no model call — and ONLY THEN `spawnChildSession`. A denial at any
 * earlier step must never reach `spawnChildSession` or `sharedBudget.reserve`.
 */
export async function runTask(_params: TaskToolParams, _options: CreateTaskToolOptions): Promise<TaskToolResult> {
	throw new Error(
		"runTask: not implemented (Gate 6) — see docs/adr/0004-fase3-roles-skills-subagents.md §2/§6 and " +
			"docs/conductor/gate3-addendum-fase3.md §9 for the binding ordering/evidence contract",
	);
}

/**
 * G6/BR-9/BR-10: an explicit, callable check that a `TaskToolResult` actually carries the minimum
 * required evidence — so "the parent must not rely solely on the child's own success claim" is a
 * checkable predicate, not only a type that a buggy Gate-6 implementation could still satisfy with
 * `details: undefined as any`.
 */
export function assertValidTaskToolResult(_value: unknown): asserts _value is TaskToolResult {
	throw new Error("assertValidTaskToolResult: not implemented (Gate 6)");
}
