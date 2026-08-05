export { type ConfigSummary, getConfigSummary, summarizeConfig } from "./config-summary.ts";
export { ConfigNotFoundError, ConfigParseError, ConfigValidationError, WorkspaceContainmentError } from "./errors.ts";
export { readConfig } from "./read-config.ts";
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
