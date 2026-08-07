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
// Approval/ApprovalMethod (renamed GateApprovalMethod here to avoid colliding with audit-trail.ts's own
// unrelated tool-call ApprovalMethod, see gate-approval.ts's own header) are canonically owned by
// gate-approval.ts; gate-state.ts (the parallel GateStateStore/policy Gate 5 stream) imports them FROM
// there rather than redeclaring them — do not also re-export them from gate-state.ts here.
export {
	type Approval,
	type ApprovalMeta,
	type ApprovalMethod as GateApprovalMethod,
	isGenuineHumanApproval,
	mintAutoApproval,
	mintHumanApproval,
} from "./gate-approval.ts";
// EvidenceRef/EvidenceProvenance are canonically owned by gate-evidence.ts, for the same reason —
// gate-state.ts imports them FROM here.
export {
	type EvidenceProvenance,
	type EvidenceProvenanceInfo,
	type EvidenceRef,
	hasSufficientEvidenceForMandatoryGate,
	type ResolveEvidenceRefContext,
	type ResolveEvidenceRefResult,
	resolveEvidenceRef,
} from "./gate-evidence.ts";
// GroundingCitation/GroundingLedgerReader (the port) and the two mint functions are canonically owned
// by gate-grounding.ts (Fase 5, ADR 0006 §11.2/§19) — gate-state.ts imports GroundingCitation FROM
// there rather than redeclaring it, the same discipline this file already documents above.
export {
	type GroundingCitation,
	type GroundingLedgerReader,
	type RagQueryEventHitView,
	type RagQueryEventView,
	type RagUnreachableEventView,
	type RecordDecisionError,
	recordGroundedDecision,
	recordUngroundedDecision,
	UNREACHABLE_WINDOW_MS,
	type ValidateGroundingCitationResult,
	validateGroundingCitation,
} from "./gate-grounding.ts";
export type {
	CalibrationDecision,
	Decision,
	Evidence,
	GateRecord,
	GateState,
	GateStatus,
	Risk,
} from "./gate-state.ts";
export { mutateGateState } from "./gate-state-mutation.ts";
export {
	evaluateAdvance,
	evaluateCalibration,
	type GateAdvanceVerdict,
	isMandatorySatisfied,
} from "./gate-state-policy.ts";
export {
	createGateStateStore,
	type GateStateEnvelopeV1,
	type GateStateEnvelopeV2,
	type GateStateMutationError,
	type GateStateStore,
	type GateStateStoreOptions,
	TOTAL_FLOW_GATES,
} from "./gate-state-store.ts";
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
	type TaskDelegationOptions,
} from "./session.ts";
export { installSessionRedactionGuard } from "./session-redaction-guard.ts";
export {
	BudgetExhaustedError,
	type BudgetReservation,
	type BudgetUsage,
	createBudgetGuardedModelRuntime,
	createSharedBudget,
	type SharedBudget,
} from "./shared-budget.ts";
export {
	type ContainedSkillCatalogEntry,
	type FilterSkillsWithinRootsResult,
	filterSkillsWithinRoots,
	type SkillCatalogEntry,
	type SkillContainmentViolation,
} from "./skill-containment.ts";
export { sanitizeForTerminal } from "./terminal-sanitize.ts";
export {
	type ConductorNoteRecord,
	type ConductorNoteToolHandle,
	createConductorNoteTool,
} from "./tools/conductor-note.ts";
export {
	type ConductorRoleView,
	type CreateTaskToolDependencies,
	createTaskTool,
	DEFAULT_MAX_DELEGATION_DEPTH,
	type DelegationEvidence,
	type ModelRoleView,
	type RoleRegistryView,
	type TaskToolParams,
	type TaskToolResult,
} from "./tools/task.ts";
export {
	defaultProtectedPaths,
	evaluateToolPath,
	isWithinRoot,
	type PathCheckResult,
	resolveRealPath,
	type WorkspacePolicyOptions,
} from "./workspace-policy.ts";
