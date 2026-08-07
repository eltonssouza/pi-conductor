export {
	findSecretSpans,
	isSensitiveFieldName,
	looksHighEntropy,
	looksLikeEnvVarReference,
	looksSecretShaped,
	matchesKnownSecretPrefix,
	type RedactOptions,
	redactSecrets,
	type SecretMatchOptions,
	type SecretSpan,
} from "./matchers.ts";
export {
	deepRedact,
	type RedactionErrorOptions,
	redactSecretsOrPlaceholder,
	SECRET_SCAN_FAILED_PLACEHOLDER,
} from "./deep-redact.ts";
