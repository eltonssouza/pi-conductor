export { confirmOrDeny, DEFAULT_APPROVAL_TIMEOUT_MS } from "./confirm.ts";
export { evaluatePolicyFailClosed, type PolicyDecision } from "./fail-closed.ts";
export {
	createPermissionGateExtension,
	type PermissionGateDecision,
	type PermissionGateOptions,
} from "./permission-gate.ts";
export {
	type ConductorSession,
	type CreateConductorSessionOptions,
	createConductorSession,
} from "./session.ts";
export {
	defaultProtectedPaths,
	evaluateToolPath,
	isWithinRoot,
	type PathCheckResult,
	resolveRealPath,
	type WorkspacePolicyOptions,
} from "./workspace-policy.ts";
