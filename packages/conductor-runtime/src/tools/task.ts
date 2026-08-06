/**
 * The `task` tool — delegates a self-contained unit of work to another Conductor role, spawning an
 * in-process, governed child `AgentSession` (Gate 2 spec Grupo D: FR-7/FR-8/FR-9/FR-13..FR-19; ADR
 * 0004 §2/§5/§6; gate3-addendum-fase3.md T30/T31/T33/T34/T40/T41/T42, R13/R14/R16/R17a).
 *
 * GATE 6: `runTask` and `assertValidTaskToolResult` are implemented for real below; Gate 5's stubs
 * threw "not implemented" (same precedent as this package's `redaction.ts`/`shared-budget.ts`). The
 * TYPES in this file are NOT a sketch — they are the locked contract from ADR 0004 §16's appendix
 * (`TaskToolParams`/`DelegationEvidence`/`TaskToolResult`) plus the collaborator seams
 * (`RoleRegistryView`, `SpawnChildSessionInput`/`Result`) the Gate 5 stream added so `runTask`'s
 * ORDERING and DECISION logic (role lookup → canSpawn → depth cap → budget.reserve → spawn →
 * evidence) is unit-testable by injecting fakes for the expensive collaborators (a real `Agent`/
 * model turn), matching this package's own `permission-engine.ts`/`permission-gate.ts` split: a pure
 * decision function (`runTask`) tested directly against fakes, a real production collaborator
 * (`createGovernedChildSessionSpawner`, below) exercised separately (no dedicated unit test yet — the
 * `defineTool` wiring that turns it into an actual invocable tool is exercised through
 * `session.ts`/`createConductorSession`'s own `taskDelegation` option instead, the same way
 * `conductor-note.ts`'s `createConductorNoteTool` is exercised via `customTools`).
 *
 * GATE 6 (real-wiring loop-back): `createTaskTool`, below `createGovernedChildSessionSpawner`, is the
 * bridge this file did NOT yet have -- a real, invocable Pi `ToolDefinition` named "task", built by
 * wrapping `runTask` + `createGovernedChildSessionSpawner` in `defineTool()`, mirroring
 * `tools/conductor-note.ts`'s own `createConductorNoteTool` shape. Until this landed, `task` was
 * implemented and unit-tested in complete isolation but reachable by NO session anywhere --
 * `session.ts`'s own `tools: [...]` array never named it. `createTaskTool` is the one and only
 * producer of that `ToolDefinition`; `session.ts`'s `taskDelegation` option (see its own doc comment)
 * is the one and only consumer, so there remains exactly one place a caller can get a working `task`
 * tool from.
 *
 * Precondition this file MUST keep (ADR §2.2, T41 mitigation #1 — "sole constructor"): this package's
 * ONLY call to the Pi SDK's `createAgentSession` for a DELEGATION CHILD session lives inside
 * `createGovernedChildSessionSpawner` below (`runTask` itself never calls it directly — it only calls
 * the injected `spawnChildSession` collaborator). `test/tools/task-sole-constructor.test.ts` enforces
 * this by scanning source text, not by convention: it asserts the Pi SDK's session-factory CALL
 * (identifier immediately followed by an opening paren — never merely mentioned in prose) appears in
 * exactly two files package-wide (`session.ts`, the top-level composition root, and this file) — a
 * second, ungoverned call site anywhere else would silently re-open T30/T41's exact hole. (Note for
 * future editors: writing that identifier followed directly by a paren ANYWHERE in this package's
 * source — including in a comment like this one — makes this static scan count it as a call site.)
 */

import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRuntime,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AuditTrailWriter } from "../audit-trail.ts";
import type { EffectivePolicyInput } from "../permission-engine.ts";
import { createPermissionGateExtension } from "../permission-gate.ts";
import { type BudgetUsage, createBudgetGuardedModelRuntime, type SharedBudget } from "../shared-budget.ts";
// Side-effecting import (T42, gate3-addendum-fase3.md §9): installs the Fase-2 write-path redaction
// guard on SessionManager.prototype BEFORE this file's own runTask ever constructs a child
// SessionManager below. Imported HERE, independently of session.ts's own import of the same module,
// so this file's own guarantee does NOT depend on session.ts having been loaded first in the same
// process/test file (exactly the "esquecível" wiring T42 warns against) -- see
// session-redaction-guard.ts's own header for why patching the shared prototype (not a per-instance
// wrapper) is what makes this safe regardless of which module constructed a given SessionManager.
import "../session-redaction-guard.ts";

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

/** Placeholder for the outer, per-delegation token reservation (distinct from
 * shared-budget.ts's own per-model-call `DEFAULT_MODEL_CALL_TOKEN_ESTIMATE`, which guards each
 * individual `streamSimple` turn *inside* the child). Conservative-in-name only: the ADR's own
 * follow-up list ("valores numéricos ... teto de budget") leaves the real estimator as a Gate 7 item;
 * `SharedBudget.settle()`'s ceiling-check (T40 precision #2) bounds the damage of this being wrong in
 * either direction regardless of the number chosen here. */
const DEFAULT_TASK_TOKEN_ESTIMATE = 4_000;

const NO_CHILD_SESSION_PLACEHOLDER = "(no child session was spawned)";
const ZERO_USAGE: BudgetUsage = { input: 0, output: 0, total: 0 };

/** R17a/T31: a role that can itself `write`/`edit` is a role whose delegated task could plausibly
 * change files -- the structural signal `runTask` uses for the FR-19 evidence-gap check below,
 * instead of trying to parse "did this prompt ask for a file change" out of free text. */
function roleCanChangeFiles(role: ConductorRoleView): boolean {
	return role.tools.includes("write") || role.tools.includes("edit");
}

function errorResult(message: string, roleName: string, depth: number, budgetRemaining: number): TaskToolResult {
	return {
		content: [{ type: "text", text: message }],
		details: {
			// R14: a denial before any spawn has no real transcript to point to -- this sentinel makes
			// that fact visible in the evidence itself (a non-empty, unmistakably-not-a-path string),
			// rather than a forged-looking empty string or a fabricated session id.
			transcript: { sessionId: NO_CHILD_SESSION_PLACEHOLDER, filePath: NO_CHILD_SESSION_PLACEHOLDER },
			role: roleName,
			depth,
			tokenCost: ZERO_USAGE,
			filesTouched: [],
			budgetRemaining,
		},
		isError: true,
	};
}

/**
 * The pure(-ish) orchestration `runTask` implements, in this exact order (ADR §16 appendix comment;
 * `conductor-main/tools/task.py:164-176` is the behavioral reference this order ports): role-exists →
 * target ∈ canSpawn → depth+1 <= maxDepth → sharedBudget.reserve(estimate) — ALL synchronous, no
 * network, no model call — and ONLY THEN `spawnChildSession`. A denial at any earlier step never
 * reaches `spawnChildSession` or `sharedBudget.reserve` (FR-13/14/15).
 */
export async function runTask(params: TaskToolParams, options: CreateTaskToolOptions): Promise<TaskToolResult> {
	// R19/T36 (gate3-addendum-fase3.md): isolated (worktree) merge-back is not implemented yet in this
	// increment -- refuse explicitly rather than silently running directly against the shared working
	// tree when isolation was the one thing the caller asked for. A silent downgrade here would be
	// MORE dangerous than refusing (fail closed on an unsupported safety mode, never fail open into
	// "close enough").
	if (params.isolated === true) {
		return errorResult(
			`Isolated (worktree) delegation is not implemented yet — refusing to delegate to "${params.role}" ` +
				"rather than silently running it directly against the shared working tree when isolation was requested.",
			params.role,
			options.depth,
			options.sharedBudget.remaining(),
		);
	}

	// FR-14: an unknown target role is refused by name, never created ad hoc.
	const targetRole = options.roleRegistry.get(params.role);
	if (!targetRole) {
		return errorResult(
			`Unknown role "${params.role}" — no such role is registered; delegation refused.`,
			params.role,
			options.depth,
			options.sharedBudget.remaining(),
		);
	}

	// FR-13/R17a/T31: a role delegating outside its own canSpawn is denied -- canSpawn is a grant of
	// reachable authority, not a mere convenience graph.
	if (!options.roleRegistry.canSpawn(options.callerRole, params.role)) {
		return errorResult(
			`"${options.callerRole}" is not authorized to delegate to "${params.role}": "${params.role}" is ` +
				`not in "${options.callerRole}"'s canSpawn list.`,
			params.role,
			options.depth,
			options.sharedBudget.remaining(),
		);
	}

	// FR-15/R17b: the depth cap is enforced BEFORE creating another level.
	const childDepth = options.depth + 1;
	if (childDepth > options.maxDepth) {
		return errorResult(
			`Delegation depth limit reached: this task would create level ${childDepth}, exceeding the ` +
				`configured maximum depth of ${options.maxDepth}.`,
			params.role,
			options.depth,
			options.sharedBudget.remaining(),
		);
	}

	// FR-16/FR-17/R16a: budget is reserved BEFORE spawning; exhaustion (or an unreadable budget, per
	// SharedBudget's own null-never-throw contract) denies gracefully -- never a thrown exception,
	// never treated as "allow".
	const reservation = options.sharedBudget.reserve(DEFAULT_TASK_TOKEN_ESTIMATE);
	if (reservation === null) {
		return errorResult(
			"Shared token budget is exhausted (or its state could not be confidently read) — delegation " +
				"denied before spawning any child (R16a: uncertainty is treated as denial, never as allow).",
			params.role,
			options.depth,
			options.sharedBudget.remaining(),
		);
	}

	// R14/T42: a NEW, disc-backed, empty SessionManager for the child -- never inMemory() (would
	// defeat R14: no durable transcript to hand back as evidence). Constructed HERE, before
	// spawnChildSession, so its file path is available for DelegationEvidence.transcript regardless of
	// how the child's turn concludes. Its writes are redacted-at-rest for free: this module's own
	// side-effecting import of session-redaction-guard.ts (above) patches
	// SessionManager.prototype.appendMessage itself, so ANY instance -- this one included -- inherits
	// the guard by construction, independent of whether session.ts happened to run first.
	const childSessionManager = SessionManager.create(
		options.workspaceRoot,
		join(options.workspaceRoot, ".conductor-agent", "sessions", "tasks"),
	);

	const spawnInput: SpawnChildSessionInput = {
		role: targetRole,
		prompt: params.prompt,
		depth: childDepth,
		workspaceRoot: options.workspaceRoot,
		effectivePolicy: options.effectivePolicy,
		auditTrailWriter: options.auditTrailWriter,
		additionalProtectedPaths: options.additionalProtectedPaths ?? [],
		yesFlagActive: options.yesFlagActive,
		sessionManager: childSessionManager,
	};

	let spawnResult: SpawnChildSessionResult;
	try {
		spawnResult = await options.spawnChildSession(spawnInput);
	} catch (error) {
		// FR-17: no thrown exception escapes runTask, whatever the collaborator threw (a
		// BudgetExhaustedError from a budget-guarded model call inside the child, an auth/model error,
		// anything). Credit the reservation back first -- nothing was actually spent if spawn never
		// completed -- then fail gracefully.
		options.sharedBudget.settle(reservation, ZERO_USAGE);
		const message = error instanceof Error ? error.message : String(error);
		return errorResult(
			`Delegation to "${params.role}" failed: ${message}`,
			params.role,
			childDepth,
			options.sharedBudget.remaining(),
		);
	}

	options.sharedBudget.settle(reservation, spawnResult.tokenUsage);

	const details: DelegationEvidence = {
		transcript: { sessionId: spawnResult.sessionId, filePath: spawnResult.sessionFilePath },
		role: targetRole.name,
		depth: childDepth,
		tokenCost: spawnResult.tokenUsage,
		filesTouched: spawnResult.filesTouched,
		budgetRemaining: options.sharedBudget.remaining(),
	};
	const content: TaskToolResult["content"] = [{ type: "text", text: spawnResult.finalText }];

	// FR-19/R14/T34 (BR-9/BR-10): a role capable of changing files (write/edit among its own tools)
	// that reports ZERO runtime-observed touched files does not satisfy the evidence requirement just
	// because its own prose sounds confident -- "the parent must not rely solely on the child's own
	// success claim", applied structurally (by role capability) rather than by guessing the prompt's
	// intent from free text.
	if (
		roleCanChangeFiles(targetRole) &&
		(spawnResult.filesTouched === undefined || spawnResult.filesTouched.length === 0)
	) {
		return { content, details, isError: true };
	}

	return { content, details };
}

/**
 * G6/BR-9/BR-10: an explicit, callable check that a `TaskToolResult` actually carries the minimum
 * required evidence — so "the parent must not rely solely on the child's own success claim" is a
 * checkable predicate, not only a type that a buggy implementation could still satisfy with
 * `details: undefined as any`.
 */
export function assertValidTaskToolResult(value: unknown): asserts value is TaskToolResult {
	if (value === null || typeof value !== "object") {
		throw new Error("assertValidTaskToolResult: result is missing required evidence (not an object)");
	}
	const details = (value as { details?: unknown }).details;
	if (details === null || typeof details !== "object") {
		throw new Error("assertValidTaskToolResult: result is missing required evidence (`details`)");
	}
	const evidence = details as Partial<DelegationEvidence>;

	const transcript = evidence.transcript as { sessionId?: unknown; filePath?: unknown } | undefined;
	if (
		!transcript ||
		typeof transcript !== "object" ||
		typeof transcript.sessionId !== "string" ||
		typeof transcript.filePath !== "string"
	) {
		throw new Error("assertValidTaskToolResult: evidence is missing a transcript reference ({sessionId, filePath})");
	}
	if (typeof evidence.role !== "string" || evidence.role.length === 0) {
		throw new Error("assertValidTaskToolResult: evidence is missing the delegated role");
	}
	if (typeof evidence.depth !== "number") {
		throw new Error("assertValidTaskToolResult: evidence is missing depth");
	}
	if (!evidence.tokenCost || typeof evidence.tokenCost.total !== "number") {
		throw new Error("assertValidTaskToolResult: evidence is missing tokenCost");
	}
	if (typeof evidence.budgetRemaining !== "number") {
		throw new Error("assertValidTaskToolResult: evidence is missing budgetRemaining");
	}

	const content = (value as { content?: unknown }).content;
	if (!Array.isArray(content) || content.length === 0) {
		throw new Error("assertValidTaskToolResult: result is missing content");
	}
}

/**
 * Derives the list of files a child ACTUALLY touched from its own session transcript -- the child's
 * real tool-call round trips recorded by the runtime (`SessionManager.buildSessionContext().messages`,
 * the same public, stable API `sdk.ts`'s own session restoration uses), never the child's own final
 * prose (R14/T34: "derived from the runtime", not "declared by the child"). Only a `write`/`edit`
 * tool call with a matching, non-error `toolResult` counts -- an attempted-but-failed write is not a
 * touched file.
 */
function deriveFilesTouchedFromTranscript(messages: readonly unknown[]): string[] {
	const succeededToolCallIds = new Map<string, boolean>();
	for (const raw of messages) {
		const message = raw as { role?: unknown; toolCallId?: unknown; isError?: unknown };
		if (message?.role === "toolResult" && typeof message.toolCallId === "string") {
			succeededToolCallIds.set(message.toolCallId, message.isError !== true);
		}
	}

	const touched = new Set<string>();
	for (const raw of messages) {
		const message = raw as { role?: unknown; content?: unknown };
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content as Array<Record<string, unknown>>) {
			if (part?.type !== "toolCall") continue;
			const name = part.name;
			if (name !== "write" && name !== "edit") continue;
			const id = part.id;
			if (typeof id !== "string" || succeededToolCallIds.get(id) !== true) continue;
			const args = part.arguments as Record<string, unknown> | undefined;
			const path = (args?.path ?? args?.file_path) as unknown;
			if (typeof path === "string" && path.length > 0) touched.add(path);
		}
	}
	return [...touched];
}

/**
 * The REAL, production `spawnChildSession` collaborator (ADR §2/§5/§6; gate3-addendum-fase3.md §9
 * T41/T42) -- the ONE other call site (besides `session.ts`'s top-level composition root) permitted to
 * call the Pi SDK's `createAgentSession` for a delegation child (T41 precondition #1: sole
 * constructor, enforced structurally by `test/tools/task-sole-constructor.test.ts`'s static scan, not
 * by convention). `runTask` never calls this directly -- it is injected via
 * `CreateTaskToolOptions.spawnChildSession` so `runTask`'s own authorization/budget/evidence ordering
 * stays unit-testable against fakes; `createTaskTool` (below, Gate 6's `defineTool` wiring) is the
 * real caller: `spawnChildSession: createGovernedChildSessionSpawner(deps.sharedBudget)`.
 *
 * Deliberately conservative where the ADR's own follow-up list leaves things open (`modelRole` →
 * concrete model resolution is explicitly still unresolved, per ADR §16 appendix "Gate 6" follow-ups):
 * `model` is omitted from `createAgentSession`'s options so Pi's own `findInitialModel` resolves it
 * from settings, exactly like `createAgentSession`'s own "Minimal - uses defaults" documented mode --
 * this file does not invent a `modelRole` → `Model` registry that no other part of the codebase has
 * built yet. Likewise, no UI is bound to the child session: `hasUI` stays `false`, so the child's own
 * destructive tool calls fail closed (deny) unless `--yes`-eligible (R13 unchanged: the child's gate
 * still classifies/audits every call identically to the parent's) -- a real approval-forwarding or
 * pre-authorized-scope mechanism for headless children is a genuine open design question (R17a's "the
 * task approval already covers what it reaches" reading is plausible but ungrounded here) and is
 * called out as a Gate 7 follow-up rather than freelanced.
 */
export function createGovernedChildSessionSpawner(
	sharedBudget: SharedBudget,
): (input: SpawnChildSessionInput) => Promise<SpawnChildSessionResult> {
	return async (input: SpawnChildSessionInput): Promise<SpawnChildSessionResult> => {
		const agentDir = join(input.workspaceRoot, ".conductor-agent");

		const baseModelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		// ADR §5.1: every model turn the child makes is itself budget-guarded, not just the one
		// task-level reservation runTask makes around the whole delegation -- a long-running child that
		// takes many turns cannot silently outspend the shared tree between the outer reserve/settle.
		const modelRuntime = createBudgetGuardedModelRuntime(baseModelRuntime, sharedBudget);

		const mergedProtectedPaths = [...input.additionalProtectedPaths, ...(input.effectivePolicy.protectedPaths ?? [])];

		const resourceLoader = new DefaultResourceLoader({
			cwd: input.workspaceRoot,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				// R13/T41: the SAME first-party permission-gate the parent uses, fiared to the SAME
				// workspaceRoot/EffectivePolicy/AuditTrailWriter/protected-paths/--yes state -- from this
				// ONE construction point, not re-derived per call.
				createPermissionGateExtension({
					workspaceRoot: input.workspaceRoot,
					additionalProtectedPaths: mergedProtectedPaths,
					policy: input.effectivePolicy,
					yesFlagActive: input.yesFlagActive,
					auditTrailWriter: input.auditTrailWriter,
				}),
			],
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: input.workspaceRoot,
			agentDir,
			modelRuntime,
			tools: input.role.tools,
			resourceLoader,
			sessionManager: input.sessionManager,
		});

		await session.prompt(input.prompt);

		const sessionFilePath = input.sessionManager.getSessionFile();
		if (!sessionFilePath) {
			// A disc-backed SessionManager (SessionManager.create, never .inMemory()) always has a file
			// once a session exists -- if this ever fires, something upstream silently swapped in an
			// in-memory manager, which would defeat R14. Throw loudly rather than hand back a fabricated
			// path masquerading as evidence.
			throw new Error(
				"createGovernedChildSessionSpawner: child SessionManager has no session file — expected a disc-backed session (R14/T42)",
			);
		}

		const stats = session.getSessionStats();
		const messages = input.sessionManager.buildSessionContext().messages;

		return {
			finalText: session.getLastAssistantText() ?? "",
			sessionId: input.sessionManager.getSessionId(),
			sessionFilePath,
			tokenUsage: { input: stats.tokens.input, output: stats.tokens.output, total: stats.tokens.total },
			filesTouched: deriveFilesTouchedFromTranscript(messages),
		};
	};
}

/** `conductor-main/tools/task.py`'s own `MAX_DEPTH` (ADR 0004 §16 appendix, §15 follow-up "valores
 * numéricos (MAX_DEPTH...)"). Ported as the same reference value rather than inventing a new number
 * without a fresh grounding/decision -- a caller MAY override it per `CreateTaskToolDependencies`. */
export const DEFAULT_MAX_DELEGATION_DEPTH = 5;

const taskToolParamsSchema = Type.Object({
	role: Type.String({
		description:
			"The Conductor role to delegate this self-contained unit of work to. Must be reachable from " +
			"the current role's own canSpawn list -- delegating outside it is refused.",
		minLength: 1,
	}),
	prompt: Type.String({
		description:
			"Self-contained instructions for the delegated subagent. It starts a brand-new session with " +
			"NO memory of this conversation (BR-5) -- include everything it needs to know.",
		minLength: 1,
	}),
	isolated: Type.Optional(
		Type.Boolean({
			description:
				"Reserved for worktree-isolated delegation (R19/T36). Not implemented yet in this " +
				"increment -- passing true is refused rather than silently running unisolated.",
		}),
	),
});

/**
 * Everything `createTaskTool` needs to bind `runTask` to one specific session (`session.ts`'s
 * `taskDelegation` option, or a future delegation child re-registering its own nested `task`). A thin
 * ergonomic layer over `CreateTaskToolOptions`: it supplies the one real `spawnChildSession`
 * (`createGovernedChildSessionSpawner`, never a second implementation) and defaults `depth`/`maxDepth`
 * so callers that are not themselves testing depth/budget edge cases do not have to restate them.
 */
export interface CreateTaskToolDependencies {
	/** The role currently running the session this tool is being registered into. */
	callerRole: string;
	/** How many `task` levels already led to THIS session (0 for the user's own top-level session). */
	depth?: number;
	maxDepth?: number;
	roleRegistry: RoleRegistryView;
	/** REQUIRED, never constructed here (R16b, ADR §5.2): the ONE `SharedBudget` for the whole
	 * delegation tree, supplied by the caller's own composition root. */
	sharedBudget: SharedBudget;
	workspaceRoot: string;
	effectivePolicy: EffectivePolicyInput;
	/** REQUIRED (R13/R14/T41): the SAME writer instance the caller's own permission-gate audits to. */
	auditTrailWriter: AuditTrailWriter;
	additionalProtectedPaths?: string[];
	yesFlagActive: boolean;
}

/**
 * GATE 6 real-wiring loop-back (this file's own header, above): the bridge from the pure `runTask`
 * orchestration to an actual, invocable Pi `ToolDefinition` named "task" -- the piece that was
 * missing everywhere (no session anywhere named "task" in its own `tools: [...]` list, so no agent
 * could ever call it, however correct `runTask` itself was in isolation). Mirrors
 * `tools/conductor-note.ts`'s own `createConductorNoteTool` shape exactly: build the tool's
 * dependencies once, return a `defineTool()`-wrapped handle ready for `customTools`.
 *
 * Bare `ToolDefinition` return type (same reasoning as `ConductorNoteToolHandle.tool`'s own doc
 * comment): `defineTool()`'s actual return type is the specific instantiation intersected with
 * `AnyToolDefinition` precisely so the result is assignable into a `ToolDefinition[]` array (e.g.
 * `session.ts`'s `customTools`) without a `renderCall`/`renderResult` parameter-variance error --
 * re-declaring the specific instantiation here would discard that widening.
 */
export function createTaskTool(deps: CreateTaskToolDependencies): ToolDefinition {
	const options: CreateTaskToolOptions = {
		callerRole: deps.callerRole,
		depth: deps.depth ?? 0,
		maxDepth: deps.maxDepth ?? DEFAULT_MAX_DELEGATION_DEPTH,
		roleRegistry: deps.roleRegistry,
		sharedBudget: deps.sharedBudget,
		workspaceRoot: deps.workspaceRoot,
		effectivePolicy: deps.effectivePolicy,
		auditTrailWriter: deps.auditTrailWriter,
		additionalProtectedPaths: deps.additionalProtectedPaths,
		yesFlagActive: deps.yesFlagActive,
		// The ONE real spawn collaborator (this file's sole-constructor precondition, T41) -- never a
		// second implementation, never re-derived per call site.
		spawnChildSession: createGovernedChildSessionSpawner(deps.sharedBudget),
	};

	return defineTool({
		name: "task",
		label: "Delegate Task",
		description:
			"Delegate a self-contained unit of work to another Conductor role. Spawns a governed " +
			"subagent with that role's own tools and a brand-new conversation (no memory of this " +
			"session). Only roles reachable from the current role's canSpawn list may be targeted.",
		parameters: taskToolParamsSchema,
		execute: async (_toolCallId, params) => {
			const result = await runTask(params as TaskToolParams, options);
			// R14/BR-9/BR-10 (this file's §6 above): re-checked here, at the actual invocation boundary,
			// one more time -- runTask's own return already satisfies this by construction, but a future
			// edit to runTask that broke the contract should fail loudly right here rather than silently
			// handing a malformed result to the model.
			assertValidTaskToolResult(result);
			// HONEST, DECLARED residual (not silently glossed over): returning `isError: true` here does
			// NOT, by itself, set Pi's own `tool_execution_end.isError` / the persisted toolResult
			// message's `isError` flag -- pi-agent-core's `agent-loop.ts` (`finalizeExecutedToolCall`)
			// derives that flag ONLY from a thrown exception (or an `afterToolCall` override this
			// codebase does not use; verified directly in
			// node_modules/@earendil-works/pi-agent-core/src/agent-loop.ts), never from a field on the
			// object `execute()` returns. Throwing instead would set that flag correctly but would
			// DISCARD `details: DelegationEvidence` (pi-agent-core's own `createErrorToolResult` on a
			// caught throw returns `details: {}`) -- which would break R14 for exactly the failure paths
			// (unknown role, canSpawn denial, budget exhaustion) where an evidence trail matters most.
			// This function preserves `details` over matching Pi's own error-flag bookkeeping; the model
			// still SEES the failure via `content`'s text either way.
			// `deriveFilesTouchedFromTranscript`'s own `isError` check (above in this file) is
			// unaffected: it inspects the CHILD session's own write/edit tool-result messages, not this
			// parent-level `task` call's own result.
			return result;
		},
	});
}
