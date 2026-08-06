export {
	type ApprovalMethod,
	type AuditEntry,
	type AuditTrailWriter,
	createAuditTrailWriter,
} from "./audit-trail.ts";
export {
	type ClassificationContext,
	type ClassificationResult,
	type ClassifierAllowlistEntry,
	classifyCommand,
	type ExtractedTarget,
	type ExtractedTargetVia,
	type RiskTier,
	type TierSignal,
} from "./command-classifier.ts";
export { confirmOrDeny, DEFAULT_APPROVAL_TIMEOUT_MS } from "./confirm.ts";
export { evaluatePolicyFailClosed, type PolicyDecision } from "./fail-closed.ts";
export {
	decide,
	type EffectivePolicyInput,
	type EngineOutcome,
	isYesEligible,
	type PermissionEngineOptions,
	type PermissionLevel,
	resolvePermissionLevel,
} from "./permission-engine.ts";
export {
	createPermissionGateExtension,
	type NamedInlineExtension,
	type PermissionGateDecision,
	type PermissionGateOptions,
} from "./permission-gate.ts";
export {
	REDACTION_SINKS,
	type RedactionSink,
	redactSecrets,
	redactSessionEntryForPersistence,
	SECRET_SCAN_FAILED_PLACEHOLDER,
} from "./redaction.ts";
export {
	buildFase1SystemPrompt,
	ConductorResourceLoader,
	type ConductorResourceLoaderOptions,
	type Fase1ProjectConfig,
} from "./resource-loader.ts";
export {
	type ConductorSession,
	type CreateConductorSessionOptions,
	createConductorSession,
} from "./session.ts";
export { installSessionRedactionGuard } from "./session-redaction-guard.ts";
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
