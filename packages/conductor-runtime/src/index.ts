export { confirmOrDeny, DEFAULT_APPROVAL_TIMEOUT_MS } from "./confirm.ts";
export { evaluatePolicyFailClosed, type PolicyDecision } from "./fail-closed.ts";
export {
	createPermissionGateExtension,
	type NamedInlineExtension,
	type PermissionGateDecision,
	type PermissionGateOptions,
} from "./permission-gate.ts";
export {
	type ConductorSession,
	type CreateConductorSessionOptions,
	createConductorSession,
} from "./session.ts";
export { sanitizeForTerminal } from "./terminal-sanitize.ts";
export {
	type ConductorNoteRecord,
	type ConductorNoteToolHandle,
	createConductorNoteTool,
} from "./tools/conductor-note.ts";
export {
	defaultProtectedPaths,
	evaluateToolPath,
	isWithinRoot,
	type PathCheckResult,
	resolveRealPath,
	type WorkspacePolicyOptions,
} from "./workspace-policy.ts";
