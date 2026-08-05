/**
 * Structural validation of the `.conductor/config.json` shape (ADR 0002 §5.3). Used on both the
 * read path (a hand-edited or corrupted file must fail loudly, not silently coerce -- Software
 * Construction Practices - Complete Professional Guide §2.8, "fail fast with clear messages") and
 * the write path (a caller-constructed config must be well-formed before it touches disk).
 *
 * Deliberately hand-rolled rather than pulled in via a schema-validation library (typebox, zod,
 * ...): the shape is small and fixed (ADR 0002 §5.3's four top-level sections), and every other
 * package in this monorepo that needs runtime validation of an *external* wire format already pulls
 * in typebox -- this module's job is narrower (one internal config shape, no external protocol) and
 * a plain TS type-guard function is proportionate; not a library-grounded requirement, a small
 * design call in the spirit of ADR 0002 §1.3's "don't build more than the phase needs".
 *
 * T12 fix (found by conductor-cli's Gate 5 doctor tests, docs/conductor/gate3-fase1-addendum.md
 * secure default 10 / OWASP ASVS V6.4): error messages for provider.model/provider.thinkingLevel
 * never interpolate the raw value (see describeUnknown below) -- assertNoRawSecrets
 * (secret-detection.ts) only runs inside writeConfig, never on the read path, so a hand-edited
 * config.json whose provider.model is both secret-shaped and structurally invalid (e.g. missing the
 * required "/" separator) must not leak that value through the exception every caller -- doctor,
 * `conductor config show/get`, or any future one -- ultimately reads the failure from.
 */

import { ConfigValidationError } from "./errors.ts";
import { CONFIG_SCHEMA_VERSION, type ConductorConfig, PROJECT_TYPES } from "./schema.ts";

const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// "provider/modelId" -- deliberately permissive about the modelId's own charset (model ids vary a
// lot across providers); the one real invariant ADR 0002 §5.3 specifies is exactly one "/"
// separating a non-empty provider from a non-empty model id.
const PROVIDER_MODEL_SHAPE = /^[^/\s]+\/[^/\s]+$/;

function fail(message: string): never {
	throw new ConfigValidationError(message);
}

/**
 * Describes an unexpected value for an error message WITHOUT ever echoing a string's raw content
 * (T12, gate3-fase1-addendum.md secure default 10 / OWASP ASVS V6.4 -- "no secret in a log or error
 * response"). Used only for provider.model/provider.thinkingLevel: the two "genuinely free-text"
 * fields secret-detection.ts already treats as where a hand-typed secret could plausibly land
 * (FREE_TEXT_ENTROPY_CHECKED_PATHS) -- a place a user could paste a raw API key. assertNoRawSecrets
 * only runs inside writeConfig, never on the read path (readConfig -> doctor / config show / get),
 * so a hand-edited config.json that fails THIS function's structural check first (e.g. a
 * secret-shaped provider.model missing the required "/" separator) must not leak that value via
 * the exception every caller ultimately reads the failure from. Non-string values are safe to echo
 * as-is: a secret cannot hide inside `JSON.stringify(5)` or `JSON.stringify(undefined)`.
 */
function describeUnknown(value: unknown): string {
	if (typeof value === "string") {
		return `a string of length ${value.length}`;
	}
	return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Structural validation of the config shape. Does NOT reject unrecognized extra fields (that is
 * deliberately secret-detection.ts's job via assertNoRawSecrets, which walks the *whole* object
 * including fields outside this schema -- see that module's header for why the two concerns are
 * kept separate). This function only asserts that the fields ADR 0002 §5.3 requires are present
 * and well-typed.
 */
export function assertValidConfigShape(value: unknown): asserts value is ConductorConfig {
	if (!isPlainObject(value)) {
		fail("config must be a JSON object");
	}

	if (value.schema !== CONFIG_SCHEMA_VERSION) {
		fail(`config.schema must be ${CONFIG_SCHEMA_VERSION}, got ${JSON.stringify(value.schema)}`);
	}

	if (!isPlainObject(value.project)) {
		fail("config.project must be an object");
	}
	const project = value.project;
	if (!PROJECT_TYPES.includes(project.type as ConductorConfig["project"]["type"])) {
		fail(`config.project.type must be one of ${PROJECT_TYPES.join(", ")}, got ${JSON.stringify(project.type)}`);
	}
	if (!isStringArray(project.technologies)) {
		fail("config.project.technologies must be a string array");
	}
	if (!isStringArray(project.evidence)) {
		fail("config.project.evidence must be a string array");
	}
	if (typeof project.detectedAt !== "string" || !ISO_UTC_TIMESTAMP.test(project.detectedAt)) {
		fail(
			`config.project.detectedAt must be an ISO-8601 UTC timestamp (e.g. "2026-08-05T12:00:00.000Z"), ` +
				`got ${JSON.stringify(project.detectedAt)}`,
		);
	}

	if (!isPlainObject(value.workspace)) {
		fail("config.workspace must be an object");
	}
	const workspace = value.workspace;
	if (typeof workspace.root !== "string" || workspace.root.length === 0) {
		fail("config.workspace.root must be a non-empty string");
	}
	if (workspace.additionalProtectedPaths !== undefined && !isStringArray(workspace.additionalProtectedPaths)) {
		fail("config.workspace.additionalProtectedPaths must be a string array when present");
	}

	if (!isPlainObject(value.provider)) {
		fail("config.provider must be an object");
	}
	const provider = value.provider;
	if (typeof provider.model !== "string" || !PROVIDER_MODEL_SHAPE.test(provider.model)) {
		fail(`config.provider.model must be a "provider/modelId" identifier, got ${describeUnknown(provider.model)}`);
	}
	if (provider.thinkingLevel !== undefined && typeof provider.thinkingLevel !== "string") {
		fail(
			`config.provider.thinkingLevel must be a string when present, got ${describeUnknown(provider.thinkingLevel)}`,
		);
	}
}
