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
