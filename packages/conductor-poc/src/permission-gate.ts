import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { WorkspacePolicyOptions } from "./workspace-policy.ts";

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
 *   4. any other tool (grep/find/ls/custom/unknown): denied by default — fail-closed, no policy
 *      declared (plan invariant #7: "ferramenta sem permissão é negada").
 *
 * The whole decision is wrapped in evaluatePolicyFailClosed (see fail-closed.ts), so an internal
 * error anywhere in this handler denies rather than allows.
 */

export interface PermissionGateDecision {
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

export function createPermissionGateExtension(_options: PermissionGateOptions): InlineExtension {
	return {
		name: "conductor-permission-gate",
		// STUB (Gate 5 RED): registers the hook but never blocks anything yet. Deliberately does
		// NOT throw here — a throwing factory would only fail extension *loading* (recorded in
		// extensionsResult.errors), which would make the acceptance test fail for a foggy loader
		// reason instead of a clear behavioral assertion ("the escape attempt was NOT blocked").
		factory: (pi: ExtensionAPI) => {
			pi.on("tool_call", async () => undefined);
		},
	};
}
