import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { confirmOrDeny, DEFAULT_APPROVAL_TIMEOUT_MS } from "./confirm.ts";
import { evaluatePolicyFailClosed, type PolicyDecision } from "./fail-closed.ts";
import { evaluateToolPath, type WorkspacePolicyOptions } from "./workspace-policy.ts";

/**
 * The Conductor permission-gate extension (docs/conductor/gate3-threat-model.md §17 step 3;
 * ADR 0001 §3.1: "Permission gate ... extension pura ... Não [fork]").
 *
 * Built entirely on pi.on("tool_call") (recon §2) — a genuine pre-execution hook. Secure defaults
 * (threat model §5):
 *   1. read: allowed only inside the workspace root; no approval prompt.
 *   2. write / edit: require BOTH workspace containment (protected-paths + real-path
 *      canonicalization) AND ctx.ui.confirm() approval with a fail-closed timeout.
 *   3. bash: requires ctx.ui.confirm() approval with a fail-closed timeout. Per-argument path
 *      containment is not applied to bash's free-text `command` string — a command-risk
 *      classifier is explicitly deferred to Fase 2 (threat model §7: "Classificador de risco de
 *      comando ... Fase 2"), so approval is the sole control for this PoC.
 *   4. conductor_note (Fase-0 custom-tool PoC, src/tools/conductor-note.ts; gate8-validation.md
 *      §7 item 2): requires input validation (non-empty string) BEFORE approval, matching the
 *      containment-before-approval pattern used for write/edit, then ctx.ui.confirm() approval
 *      with the same fail-closed timeout as write/edit/bash. Registering a custom tool is not by
 *      itself a reason to trust it more than a built-in with side effects.
 *   5. any other tool (grep/find/ls/an unregistered custom tool/unknown): denied by default —
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
}

function requiresApproval(toolName: string): boolean {
	return toolName === "write" || toolName === "edit" || toolName === "bash" || toolName === "conductor_note";
}

async function decideToolCall(
	event: ToolCallEvent,
	ctx: ExtensionContext,
	options: PermissionGateOptions,
	approvalTimeoutMs: number,
): Promise<PolicyDecision> {
	const policyOptions: WorkspacePolicyOptions = {
		workspaceRoot: options.workspaceRoot,
		additionalProtectedPaths: options.additionalProtectedPaths,
	};

	// isToolCallEventType (Pi's own idiomatic narrowing helper — see the shipped
	// examples/permission-gate.ts) is used instead of `switch (event.toolName)`: ToolCallEvent's
	// CustomToolCallEvent member has `toolName: string`, so a plain switch/if on the literal
	// string does not fully narrow `event.input` away from `Record<string, unknown>`.
	if (isToolCallEventType("read", event)) {
		const check = evaluateToolPath(event.input.path, policyOptions);
		return check.allowed ? { block: false } : { block: true, reason: check.reason };
	}

	if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
		const check = evaluateToolPath(event.input.path, policyOptions);
		if (!check.allowed) {
			return { block: true, reason: check.reason };
		}
		const approved = await confirmOrDeny(
			ctx,
			`Approve ${event.toolName}?`,
			`${event.toolName} ${event.input.path}`,
			approvalTimeoutMs,
		);
		return approved
			? { block: false }
			: { block: true, reason: "not approved (denied, or approval timed out — fail closed)" };
	}

	if (isToolCallEventType("bash", event)) {
		const approved = await confirmOrDeny(ctx, "Approve bash command?", event.input.command, approvalTimeoutMs);
		return approved
			? { block: false }
			: { block: true, reason: "not approved (denied, or approval timed out — fail closed)" };
	}

	// conductor_note (Fase-0 custom-tool PoC — src/tools/conductor-note.ts). A custom tool gets no
	// free pass just for being custom: it needs its own explicit branch here, same as every
	// built-in above. Input is validated BEFORE approval is requested (mirrors write/edit's
	// containment-before-approval ordering) — a malformed call never even reaches the human.
	if (isToolCallEventType<"conductor_note", { note: unknown }>("conductor_note", event)) {
		const note = event.input.note;
		if (typeof note !== "string" || note.trim().length === 0) {
			return { block: true, reason: "conductor_note requires a non-empty string 'note' — fail closed" };
		}
		const approved = await confirmOrDeny(ctx, "Approve conductor_note?", note, approvalTimeoutMs);
		return approved
			? { block: false }
			: { block: true, reason: "not approved (denied, or approval timed out — fail closed)" };
	}

	// Unknown/custom tool (grep, find, ls, an unregistered custom tool, or anything else): no
	// policy declared, deny. This is the fail-closed default every tool gets unless it has its own
	// explicit branch above — proves a custom tool is never implicitly trusted.
	return { block: true, reason: `no policy declared for tool "${event.toolName}" — fail closed` };
}

/** A named inline extension: the object form of InlineExtension, not the bare-function form. */
export interface NamedInlineExtension {
	name: string;
	factory: ExtensionFactory;
	hidden?: boolean;
}

export function createPermissionGateExtension(options: PermissionGateOptions): NamedInlineExtension {
	const approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;

	return {
		name: "conductor-permission-gate",
		factory: (pi: ExtensionAPI) => {
			pi.on(
				"tool_call",
				async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
					const decision = await evaluatePolicyFailClosed(() =>
						decideToolCall(event, ctx, options, approvalTimeoutMs),
					);

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
						if (ctx.hasUI) {
							ctx.ui.notify(`Blocked ${event.toolName}: ${decision.reason ?? "denied by policy"}`, "warning");
						}
						return { block: true, reason: decision.reason ?? "denied by policy" };
					}
					return undefined;
				},
			);
		},
	};
}
