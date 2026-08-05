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
		fail(`config.provider.model must be a "provider/modelId" identifier, got ${JSON.stringify(provider.model)}`);
	}
	if (provider.thinkingLevel !== undefined && typeof provider.thinkingLevel !== "string") {
		fail("config.provider.thinkingLevel must be a string when present");
	}
}
