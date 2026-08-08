export {
	BUILTIN_GATE_ROLES,
	BUILTIN_ROLES,
	type BuiltinRoleSpec,
	findBuiltinRole,
	gatesForBuiltinRole,
	MANDATORY_GATES,
	skillsForBuiltinRole,
} from "./builtin-roles-data.ts";
export { type ConfigSummary, getConfigSummary, summarizeConfig } from "./config-summary.ts";
export {
	buildMergedGraph,
	type DelegationGraph,
	type DelegationGraphError,
	findCycle,
	type ValidateDelegationGraphResult,
	validateDelegationGraph,
} from "./delegation-graph.ts";
export { ConfigNotFoundError, ConfigParseError, ConfigValidationError, WorkspaceContainmentError } from "./errors.ts";
export {
	type ModelBinding,
	type ModelPolicy,
	type ModelPolicyDiagnostic,
	type ParseModelPolicyResult,
	parseModelPolicy,
	type ResolveProjectModelPolicyResult,
	resolveProjectModelPolicy,
} from "./model-policy.ts";
export {
	loadModelPolicyTrustStore,
	MODEL_POLICY_TRUST_STORE_SCHEMA_VERSION,
	type ModelPolicyTrustEntry,
	type ModelPolicyTrustStore,
	type ModelPolicyTrustStoreDocument,
	type ModelPolicyTrustStoreOptions,
} from "./model-policy-trust-store.ts";
export {
	DEFAULT_GATE_MODEL_ROLE_RANK,
	DEFAULT_GATE_MODEL_ROLES,
	type GateModelRole,
	MODEL_ROLE_RANK,
	type NormalizePlanModelRoleResult,
	normalizePlanModelRole,
} from "./model-role.ts";
export {
	type BuiltinPolicyDefaults,
	type EffectivePolicy,
	loadPolicyDocument,
	mergePolicies,
	POLICY_SCHEMA_VERSION,
	type PolicyAllowlistEntry,
	type PolicyDocument,
	type PolicyLoadResult,
	type PolicyNetworkEntry,
	type PolicySource,
} from "./policy-loader.ts";
export {
	loadPolicyTrustStore,
	POLICY_TRUST_STORE_SCHEMA_VERSION,
	type PolicySourceKind,
	type PolicyTrustStore,
	type PolicyTrustStoreDocument,
	type TrustEntry,
} from "./policy-trust-store.ts";
export { readConfig } from "./read-config.ts";
export {
	buildRoleRegistry,
	type ConductorRole,
	isToolAllowed,
	listRoles,
	type ModelRole,
	type ResolveRoleResult,
	type RoleApprovalPolicy,
	type RoleDiagnostic,
	type RoleListEntry,
	type RoleProvenanceSource,
	type RoleRegistry,
	resolveRole,
} from "./role-loader.ts";
export {
	loadRoleTrustStore,
	ROLE_TRUST_STORE_SCHEMA_VERSION,
	type RoleTrustEntry,
	type RoleTrustStore,
	type RoleTrustStoreDocument,
	type RoleTrustStoreOptions,
	resolveRoleGrants,
} from "./role-trust-store.ts";
export { CONFIG_SCHEMA_VERSION, type ConductorConfig, PROJECT_TYPES, type ProjectType } from "./schema.ts";
export { assertValidConfigShape } from "./schema-validation.ts";
export {
	assertNoRawSecrets,
	isSensitiveFieldName,
	looksHighEntropy,
	looksLikeEnvVarReference,
	looksSecretShaped,
	matchesKnownSecretPrefix,
} from "./secret-detection.ts";
export { type ContainedConfigPath, resolveContainedConfigPath } from "./workspace-containment.ts";
export { type WriteConfigResult, writeConfig } from "./write-config.ts";
