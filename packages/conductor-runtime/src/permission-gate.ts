import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { type ApprovalMethod, type AuditTrailWriter, createAuditTrailWriter } from "./audit-trail.ts";
import type { RiskTier } from "./command-classifier.ts";
import { confirmOrDeny, DEFAULT_APPROVAL_TIMEOUT_MS } from "./confirm.ts";
import { evaluatePolicyFailClosed, type PolicyDecision } from "./fail-closed.ts";
import {
	decide,
	type EffectivePolicyInput,
	type PermissionLevel,
	resolvePermissionLevel,
} from "./permission-engine.ts";
import { redactSecrets } from "./redaction.ts";
import { evaluateToolPath, type WorkspacePolicyOptions } from "./workspace-policy.ts";

/**
 * The Conductor permission-gate extension (docs/conductor/gate3-threat-model.md §17 step 3;
 * ADR 0001 §3.1: "Permission gate ... extension pura ... Não [fork]").
 *
 * Built entirely on pi.on("tool_call") (recon §2) — a genuine pre-execution hook. Secure defaults
 * (threat model §5):
 *   1. read: allowed inside the workspace root, OR inside one of `additionalAllowedReadRoots` (FR-6/
 *      Gate 8 loop-back — already R20-vetted skill locations disclosed via FR-5's name+description+
 *      `<location>` catalog, see workspace-policy.ts's own doc comment on that field); no approval
 *      prompt either way. write/edit/bash below never see this widening (they keep using the plain
 *      `policyOptions`, with no `additionalAllowedReadRoots` populated) — least privilege scoped to
 *      exactly the tool whose own promised behavior needs it.
 *   2. write / edit: require BOTH workspace containment (protected-paths + real-path
 *      canonicalization) AND ctx.ui.confirm() approval with a fail-closed timeout.
 *   3. bash: routed through the Permission Engine's decide() (permission-engine.ts) — the Policy
 *      Decision Point — which classifies the raw command (command-classifier.ts) BEFORE any
 *      approval is requested (T23/T24, gate3-addendum-fase2.md): a "critical" tier command (a
 *      protected-path/destructive target, a catastrophic pattern, or unanalyzable input) is
 *      denied outright with NO approval path at all, human-available-or-not; a "low" tier command
 *      (built-in or policy.json allowlist match) is allowed without a prompt, the same way the
 *      `read` branch above never prompts for a contained read; "medium"/"high" still requires
 *      ctx.ui.confirm() approval with the same fail-closed timeout as write/edit, now with the
 *      risk tier surfaced in the prompt title. This file (the PEP) never re-derives the
 *      classification itself — decide() is the single, authoritative source of that decision
 *      (DRY: one home for the risk-tier knowledge; Pragmatic Programming Practices §1.2).
 *   4. conductor_note (Fase-0 custom-tool PoC, src/tools/conductor-note.ts; gate8-validation.md
 *      §7 item 2): requires input validation (non-empty string) BEFORE approval, matching the
 *      containment-before-approval pattern used for write/edit, then ctx.ui.confirm() approval
 *      with the same fail-closed timeout as write/edit/bash. Registering a custom tool is not by
 *      itself a reason to trust it more than a built-in with side effects.
 *   5. task (ADR 0004 §2.3 correction #2 / gate3-addendum-fase3.md T31, R17a): validates the target
 *      `role` param BEFORE approval (mirrors conductor_note's non-empty-string check), then
 *      ctx.ui.confirm() with a message that names the TARGET ROLE explicitly -- "approving a task is
 *      approving whatever it goes on to run" (task.py's own framing), so an approval prompt that only
 *      said "Approve task?" would be approval-theater. The child's own tool calls (its `bash`/`write`)
 *      are NOT covered by this one approval -- they pass through the child's own re-wired Permission
 *      Gate (R13), classified/approved/audited exactly like the parent's, never a free pass for being
 *      "inside" a delegation.
 *   6. any other tool (grep/find/ls/an unregistered custom tool/unknown): denied by default —
 *      fail-closed, no policy declared (plan invariant #7: "ferramenta sem permissão é negada").
 *      This is what proves item 4 doesn't widen into "custom tools are trusted": a custom tool
 *      without its own explicit branch here still falls through to this default deny, exactly
 *      like grep/find/ls do (see test/permission-gate.test.ts's "unrelated custom tool" test).
 *
 * The whole decision is wrapped in evaluatePolicyFailClosed (see fail-closed.ts), so an internal
 * error anywhere in this handler denies rather than allows.
 */

export interface PermissionGateDecision {
	/** ISO-8601 UTC timestamp of the decision (observability: gate3-threat-model.md §3.4 evidence requirement). */
	timestamp: string;
	toolName: string;
	toolCallId: string;
	allowed: boolean;
	reason?: string;
	requiredApproval: boolean;
}

export interface PermissionGateOptions extends WorkspacePolicyOptions {
	approvalTimeoutMs?: number;
	/** Observability hook (Gate 3 evidence / Gate 6 quality-baseline "key actions logged"). Must never throw. */
	onDecision?: (decision: PermissionGateDecision) => void;
	/**
	 * FR-3/FR-6/FR-7/FR-9/FR-10/FR-11/FR-23/FR-24 (ADR 0003 §5/§16, GAP-B loop-back): the merged,
	 * trust-checked `EffectivePolicy` — loaded via `@conductor/config`'s `loadPolicyDocument` +
	 * `loadPolicyTrustStore` + `mergePolicies` by whichever package composes both (conductor-cli's
	 * `commands/chat/policy-resolution.ts`), never loaded by this package itself (ADR 0002 §3.1).
	 * Omitted entirely behaves exactly like an all-absent policy: no grants, no extra protected paths,
	 * `denyAllPrivileged` false — the same "additive, never a breaking change" contract every other
	 * optional field on this interface already keeps.
	 */
	policy?: EffectivePolicyInput;
	/**
	 * FR-19/FR-20/FR-21 (ADR 0003 §4, R8): mirrors `decide()`'s own `PermissionEngineOptions.yesFlagActive`.
	 * Defaults to `false` — the same secure default this gate's bash branch hardcoded before any real
	 * `--yes` flag existed.
	 */
	yesFlagActive?: boolean;
	/**
	 * R13/R14/T41 (ADR 0004 §2.2/§6, gate3-addendum-fase3.md §9 T41 precision #1): when a governed
	 * DELEGATION CHILD session's own gate is constructed (tools/task.ts's
	 * `createGovernedChildSessionSpawner`), it is fiared to the SAME `AuditTrailWriter` INSTANCE the
	 * parent's gate audits to — a child's tool calls must land in the ONE audit trail, not a second,
	 * unlinked writer that merely happens to point at the same file. Omitted entirely (every other
	 * caller — the top-level session): behaves exactly as before, constructing its own writer at
	 * `workspaceRoot`/.conductor/audit.jsonl below — additive, never a breaking change.
	 */
	auditTrailWriter?: AuditTrailWriter;
}

function requiresApproval(toolName: string): boolean {
	return (
		toolName === "write" ||
		toolName === "edit" ||
		toolName === "bash" ||
		toolName === "conductor_note" ||
		toolName === "task"
	);
}

/**
 * `decideToolCall`'s enriched return — a superset of `PolicyDecision` (structurally assignable
 * wherever a bare `PolicyDecision` is expected, e.g. `evaluatePolicyFailClosed`'s parameter type) that
 * additionally carries what the audit trail (FR-16) needs to describe *how* the decision was reached.
 * All three extra fields are optional so the fail-closed catch path (a bare `{block, reason}` built by
 * `evaluatePolicyFailClosed` itself when `decideToolCall` throws) remains a valid value too — the audit
 * write below falls back to a conservative default (`resolvePermissionLevel`/`"none"`) whenever they
 * are absent, rather than asserting they are always present.
 */
interface ToolDecisionOutcome extends PolicyDecision {
	permissionLevel?: PermissionLevel;
	riskTier?: RiskTier;
	approvalMethod?: ApprovalMethod;
}

async function decideToolCall(
	event: ToolCallEvent,
	ctx: ExtensionContext,
	options: PermissionGateOptions,
	approvalTimeoutMs: number,
): Promise<ToolDecisionOutcome> {
	const policyOptions: WorkspacePolicyOptions = {
		workspaceRoot: options.workspaceRoot,
		additionalProtectedPaths: options.additionalProtectedPaths,
	};

	// isToolCallEventType (Pi's own idiomatic narrowing helper — see the shipped
	// examples/permission-gate.ts) is used instead of `switch (event.toolName)`: ToolCallEvent's
	// CustomToolCallEvent member has `toolName: string`, so a plain switch/if on the literal
	// string does not fully narrow `event.input` away from `Record<string, unknown>`.
	if (isToolCallEventType("read", event)) {
		// FR-6/Gate 8 loop-back (Gate 4 decision, journal 2026-08-06): a SEPARATE options value from
		// `policyOptions` above, scoped to this branch alone -- `write`/`edit` below and the `bash`
		// decision further down both keep using the plain `policyOptions`, which never carries
		// `additionalAllowedReadRoots`. This is what makes the widening read-only by construction: it is
		// not that `evaluateToolPath` refuses to honor the field for other tools, it is that no other
		// tool's options object here is ever built with it populated.
		const readPolicyOptions: WorkspacePolicyOptions = {
			...policyOptions,
			additionalAllowedReadRoots: options.additionalAllowedReadRoots,
		};
		const check = evaluateToolPath(event.input.path, readPolicyOptions);
		return check.allowed
			? { block: false, permissionLevel: "read", approvalMethod: "none" }
			: { block: true, reason: check.reason, permissionLevel: "read", approvalMethod: "none" };
	}

	if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
		const check = evaluateToolPath(event.input.path, policyOptions);
		if (!check.allowed) {
			// Never even asked a human — containment failed before approval was requested.
			return { block: true, reason: check.reason, permissionLevel: "write", approvalMethod: "none" };
		}
		const approved = await confirmOrDeny(
			ctx,
			`Approve ${event.toolName}?`,
			`${event.toolName} ${event.input.path}`,
			approvalTimeoutMs,
		);
		return approved
			? { block: false, permissionLevel: "write", approvalMethod: "human" }
			: {
					block: true,
					reason: "not approved (denied, or approval timed out — fail closed)",
					permissionLevel: "write",
					approvalMethod: "human",
				};
	}

	if (isToolCallEventType("bash", event)) {
		// T23/T24 (gate3-addendum-fase2.md; ADR 0003 §2-§4): decide() classifies event.input.command
		// (command-classifier.ts) and returns one of three outcomes — see the module doc above.
		// `policy`/`yesFlagActive` are forwarded from this extension's own options (GAP-B/FR-19..21
		// loop-back — Gate 8 found these were never wired past this hardcoded `undefined`/`false`
		// pair). decide()'s critical-tier check still runs unconditionally, BEFORE any policy-allowlist
		// or --yes/isYesEligible logic is even reached, so a real policy/--yes can never widen into a
		// bypass of it (isYesEligible's fail-closed 6-prong contract is exercised exhaustively in
		// permission-engine.test.ts, untouched by this wiring).
		const result = decide("bash", event.input, {
			workspace: policyOptions,
			yesFlagActive: options.yesFlagActive ?? false,
			policy: options.policy,
		});

		if (result.outcome.kind === "deny") {
			return {
				block: true,
				reason: result.outcome.reason,
				permissionLevel: result.permissionLevel,
				riskTier: result.riskTier,
				approvalMethod: "none",
			};
		}
		if (result.outcome.kind === "allow") {
			return {
				block: false,
				permissionLevel: result.permissionLevel,
				riskTier: result.riskTier,
				approvalMethod: result.outcome.approvalMethod,
			};
		}
		const approved = await confirmOrDeny(ctx, result.outcome.title, result.outcome.message, approvalTimeoutMs);
		return approved
			? { block: false, permissionLevel: result.permissionLevel, riskTier: result.riskTier, approvalMethod: "human" }
			: {
					block: true,
					reason: "not approved (denied, or approval timed out — fail closed)",
					permissionLevel: result.permissionLevel,
					riskTier: result.riskTier,
					approvalMethod: "human",
				};
	}

	// task (ADR 0004 §2.3 correction #2; gate3-addendum-fase3.md T31, R17a): validated BEFORE
	// approval (mirrors conductor_note's own non-empty-string check below), then approved via
	// ctx.ui.confirm() with a message that names the TARGET ROLE explicitly. "canSpawn" is a grant of
	// authority reachable through delegation (T31) -- approving `task` blindly would be
	// approval-theater, so the message surfaces exactly what a human is really being asked to trust.
	if (isToolCallEventType<"task", { role: unknown; prompt: unknown }>("task", event)) {
		const role = event.input.role;
		if (typeof role !== "string" || role.trim().length === 0) {
			return {
				block: true,
				reason: "task requires a non-empty string 'role' — fail closed",
				permissionLevel: "exec",
				approvalMethod: "none",
			};
		}
		const prompt = typeof event.input.prompt === "string" ? event.input.prompt : "(no prompt provided)";
		const approved = await confirmOrDeny(
			ctx,
			`Approve delegating to role "${role}"?`,
			`This delegates a task to role "${role}" — approving grants it that role's own tools and, ` +
				`transitively, whatever roles it can in turn delegate to (canSpawn). Task: ${prompt}`,
			approvalTimeoutMs,
		);
		return approved
			? { block: false, permissionLevel: "exec", approvalMethod: "human" }
			: {
					block: true,
					reason: "not approved (denied, or approval timed out — fail closed)",
					permissionLevel: "exec",
					approvalMethod: "human",
				};
	}

	// conductor_note (Fase-0 custom-tool PoC — src/tools/conductor-note.ts). A custom tool gets no
	// free pass just for being custom: it needs its own explicit branch here, same as every
	// built-in above. Input is validated BEFORE approval is requested (mirrors write/edit's
	// containment-before-approval ordering) — a malformed call never even reaches the human.
	if (isToolCallEventType<"conductor_note", { note: unknown }>("conductor_note", event)) {
		// permissionLevel "write" is the closest existing PermissionLevel fit for the audit trail:
		// conductor_note is a side-effecting custom tool gated by human approval exactly like
		// write/edit, not resolvePermissionLevel's literal ("conductor_note" is unmapped there and
		// would resolve to "security", which is auto-deny-only — not this branch's actual behavior).
		const note = event.input.note;
		if (typeof note !== "string" || note.trim().length === 0) {
			return {
				block: true,
				reason: "conductor_note requires a non-empty string 'note' — fail closed",
				permissionLevel: "write",
				approvalMethod: "none",
			};
		}
		const approved = await confirmOrDeny(ctx, "Approve conductor_note?", note, approvalTimeoutMs);
		return approved
			? { block: false, permissionLevel: "write", approvalMethod: "human" }
			: {
					block: true,
					reason: "not approved (denied, or approval timed out — fail closed)",
					permissionLevel: "write",
					approvalMethod: "human",
				};
	}

	// Unknown/custom tool (grep, find, ls, an unregistered custom tool, or anything else): no
	// policy declared, deny. This is the fail-closed default every tool gets unless it has its own
	// explicit branch above — proves a custom tool is never implicitly trusted.
	return {
		block: true,
		reason: `no policy declared for tool "${event.toolName}" — fail closed`,
		permissionLevel: resolvePermissionLevel(event.toolName),
		approvalMethod: "none",
	};
}

/** A named inline extension: the object form of InlineExtension, not the bare-function form. */
export interface NamedInlineExtension {
	name: string;
	factory: ExtensionFactory;
	hidden?: boolean;
}

export function createPermissionGateExtension(options: PermissionGateOptions): NamedInlineExtension {
	const approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
	// FR-16/FR-17 (ADR 0003 §7, GAP-B loop-back): every caller of this factory gets a real, working
	// audit trail by default — the same "secure by default, caller can't forget" precedent
	// workspace-policy.ts's defaultProtectedPaths() already set for .conductor/{config,policy,
	// policy-trust}.json + audit.jsonl. The path is fixed relative to workspaceRoot, matching
	// audit-trail.ts's own module doc and this file's protected-path entry for this exact file.
	// R13/R14/T41: a DELEGATION CHILD's gate (tools/task.ts) passes its own parent's writer INSTANCE
	// via `options.auditTrailWriter` instead, so the child's decisions land in the one audit trail the
	// parent already audits to, not a second, unlinked writer — this only constructs a fresh one when
	// none was supplied (every existing caller's behavior, byte-for-byte unchanged).
	const auditTrailWriter =
		options.auditTrailWriter ?? createAuditTrailWriter(join(options.workspaceRoot, ".conductor", "audit.jsonl"));

	return {
		name: "conductor-permission-gate",
		factory: (pi: ExtensionAPI) => {
			pi.on(
				"tool_call",
				async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
					const decision = (await evaluatePolicyFailClosed(async () => {
						const decided = await decideToolCall(event, ctx, options, approvalTimeoutMs);

						// FR-16/FR-18/R9 (audit-trail.ts's own header — Gate 8 loop-back): the write happens
						// INSIDE this same fail-closed envelope, not after it. If appendAuditEntry throws
						// (disk full, .conductor unwritable, a directory sitting where the file should be,
						// ...), the throw propagates out of this async callback and evaluatePolicyFailClosed
						// converts the WHOLE decision into a deny — exactly like a classification error
						// would — so the operation this entry would have audited never runs unaudited. This
						// is deliberately NOT the onDecision hook below: onDecision is an optional,
						// best-effort, external observability channel that must never affect the decision;
						// this write is the mandatory security record, and its failure IS the decision.
						auditTrailWriter.appendAuditEntry({
							timestamp: new Date().toISOString(),
							toolName: event.toolName,
							toolCallId: event.toolCallId,
							permissionLevel: decided.permissionLevel ?? resolvePermissionLevel(event.toolName),
							riskTier: decided.riskTier,
							decision: decided.block ? "deny" : "allow",
							reason: decided.reason,
							yesFlagActive: options.yesFlagActive ?? false,
							approvalMethod: decided.approvalMethod ?? "none",
						});

						return decided;
					})) as ToolDecisionOutcome;

					try {
						options.onDecision?.({
							timestamp: new Date().toISOString(),
							toolName: event.toolName,
							toolCallId: event.toolCallId,
							allowed: !decision.block,
							reason: decision.reason,
							requiredApproval: requiresApproval(event.toolName),
						});
					} catch {
						// Observability must never affect the security decision already made above.
					}

					if (decision.block) {
						// T21 sink #2 / GAP-C (gate3-addendum-fase2.md; ADR 0003 §6.2 sink #2; BR-12):
						// `decision.reason` can embed model/tool-controlled input (a path, a bash command
						// operand, an echoed value) -- e.g. command-classifier.ts's target-protected-path
						// signal builds its detail from workspace-policy.ts's evaluateToolPath `reason`,
						// which quotes the raw resolved path verbatim. Redact BEFORE this string reaches
						// ctx.ui.notify -- a DIFFERENT sink from the transcript's own redaction (FR-13),
						// per R6: "cada um redige independente".
						if (ctx.hasUI) {
							const notifyReason = redactSecrets(decision.reason ?? "denied by policy");
							ctx.ui.notify(`Blocked ${event.toolName}: ${notifyReason}`, "warning");
						}
						return { block: true, reason: decision.reason ?? "denied by policy" };
					}
					return undefined;
				},
			);
		},
	};
}
