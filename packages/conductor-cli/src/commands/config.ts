/**
 * `conductor config show|get <key>|set <key> <value>` (docs/adr/0002-fase1-cli-foundation.md §7.3).
 *
 * `show`/`get` read through @conductor/config's getConfigSummary -- the same redaction-safe,
 * allowlisted view `doctor` uses -- never the raw config (defense in depth alongside T11's
 * write-time rejection; config.json has no secret in it by construction, but this keeps the same
 * discipline everywhere rather than one module trusting raw reads and another not).
 *
 * `set` always goes through @conductor/config's writeConfig -- never a raw fs write -- so T11
 * (reject a raw secret before it touches disk) and T16 (back up before overwrite) both apply to
 * `config set` exactly as they already do to `init` (ADR §7.3: "same discipline ... already
 * validated as correct in the Python sibling project").
 *
 * `set` enforces its OWN allowlist of settable dot-paths before ever calling writeConfig. This is
 * deliberately separate from (and narrower than) assertValidConfigShape, which by design does not
 * reject unknown extra fields (see that module's own header comment) -- ADR §7.3 requires "unknown
 * key or wrong type -> error, not silent write" specifically for `conductor config set`, which
 * schema-validation.ts alone does not give us.
 */

import {
	type ConductorConfig,
	ConfigNotFoundError,
	ConfigParseError,
	type ConfigSummary,
	ConfigValidationError,
	getConfigSummary,
	readConfig,
	writeConfig,
} from "@conductor/config";

export interface ConfigCommandOptions {
	cwd: string;
}

export type ConfigShowResult = { ok: true; summary: ConfigSummary } | { ok: false; reason: string };
export type ConfigGetResult = { ok: true; value: unknown } | { ok: false; reason: string };
export type ConfigSetResult = { ok: true; configPath: string; backupPath?: string } | { ok: false; reason: string };

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const NOT_INITIALIZED_HINT = "not initialized -- run `conductor init` first";

function loadSummaryOrReason(cwd: string): ConfigShowResult {
	try {
		return { ok: true, summary: getConfigSummary(cwd) };
	} catch (error) {
		if (error instanceof ConfigNotFoundError) return { ok: false, reason: NOT_INITIALIZED_HINT };
		if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
			return { ok: false, reason: `config is invalid: ${error.message}` };
		}
		return { ok: false, reason: describeError(error) };
	}
}

export async function runConfigShow(options: ConfigCommandOptions): Promise<ConfigShowResult> {
	return loadSummaryOrReason(options.cwd);
}

/** Every dot-path `conductor config get` can read -- mirrors ConfigSummary's shape exactly (a
 * strictly wider, read-only set than SETTABLE_KEYS below: e.g. project.technologies is readable
 * but not settable, because init -- not the user -- owns it). */
const GETTABLE_PATHS: Record<string, (summary: ConfigSummary) => unknown> = {
	schema: (s) => s.schema,
	"project.type": (s) => s.project.type,
	"project.technologies": (s) => s.project.technologies,
	"project.evidence": (s) => s.project.evidence,
	"project.detectedAt": (s) => s.project.detectedAt,
	"workspace.root": (s) => s.workspace.root,
	"workspace.additionalProtectedPaths": (s) => s.workspace.additionalProtectedPaths,
	"provider.model": (s) => s.provider.model,
	"provider.thinkingLevel": (s) => s.provider.thinkingLevel,
};

export interface ConfigGetOptions extends ConfigCommandOptions {
	key: string;
}

export async function runConfigGet(options: ConfigGetOptions): Promise<ConfigGetResult> {
	const loaded = loadSummaryOrReason(options.cwd);
	if (!loaded.ok) return loaded;

	const reader = GETTABLE_PATHS[options.key];
	if (!reader) {
		return {
			ok: false,
			reason: `unknown key "${options.key}". Known keys: ${Object.keys(GETTABLE_PATHS).join(", ")}`,
		};
	}

	const value = reader(loaded.summary);
	if (value === undefined) {
		return { ok: false, reason: `"${options.key}" is not set` };
	}
	return { ok: true, value };
}

type SettableKey =
	| "project.type"
	| "workspace.root"
	| "workspace.additionalProtectedPaths"
	| "provider.model"
	| "provider.thinkingLevel";

const SETTABLE_KEYS: ReadonlySet<string> = new Set<SettableKey>([
	"project.type",
	"workspace.root",
	"workspace.additionalProtectedPaths",
	"provider.model",
	"provider.thinkingLevel",
]);

/**
 * Parses the raw CLI string for a settable key. Only `workspace.additionalProtectedPaths` is
 * JSON-decoded (it is the one array-valued settable field, and a CLI string cannot express an array
 * any other way); every other settable key is a plain string field, so its raw CLI value is used
 * literally -- deliberately NOT JSON.parse'd, so `conductor config set provider.thinkingLevel true`
 * cannot silently become the boolean `true` instead of the string `"true"` (assertValidConfigShape
 * would reject it, but a clear error here is more direct than delegating a footgun downstream).
 */
function parseSetValue(
	key: SettableKey,
	rawValue: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
	if (key === "workspace.additionalProtectedPaths") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawValue);
		} catch {
			return {
				ok: false,
				reason: `"${key}" must be a JSON array of strings, e.g. '["/etc/secrets"]' -- got ${JSON.stringify(rawValue)}`,
			};
		}
		if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
			return { ok: false, reason: `"${key}" must be a JSON array of strings, e.g. '["/etc/secrets"]'` };
		}
		return { ok: true, value: parsed };
	}
	return { ok: true, value: rawValue };
}

function applySettableKey(config: ConductorConfig, key: SettableKey, value: unknown): ConductorConfig {
	const next = structuredClone(config);
	switch (key) {
		case "project.type":
			next.project.type = value as ConductorConfig["project"]["type"];
			return next;
		case "workspace.root":
			next.workspace.root = value as string;
			return next;
		case "workspace.additionalProtectedPaths":
			next.workspace.additionalProtectedPaths = value as string[];
			return next;
		case "provider.model":
			next.provider.model = value as string;
			return next;
		case "provider.thinkingLevel":
			next.provider.thinkingLevel = value as string;
			return next;
	}
}

export interface ConfigSetOptions extends ConfigCommandOptions {
	key: string;
	rawValue: string;
}

export async function runConfigSet(options: ConfigSetOptions): Promise<ConfigSetResult> {
	if (!SETTABLE_KEYS.has(options.key)) {
		return {
			ok: false,
			reason: `"${options.key}" is not settable. Settable keys: ${[...SETTABLE_KEYS].join(", ")}`,
		};
	}
	const key = options.key as SettableKey;

	let existing: ConductorConfig;
	try {
		existing = readConfig(options.cwd);
	} catch (error) {
		if (error instanceof ConfigNotFoundError) return { ok: false, reason: NOT_INITIALIZED_HINT };
		if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
			return { ok: false, reason: `config is invalid: ${error.message}` };
		}
		return { ok: false, reason: describeError(error) };
	}

	const parsed = parseSetValue(key, options.rawValue);
	if (!parsed.ok) return parsed;

	const next = applySettableKey(existing, key, parsed.value);

	try {
		// writeConfig itself enforces T11 (assertNoRawSecrets) and T16 (backup before overwrite) --
		// same as `conductor init`, no separate re-implementation here.
		const result = writeConfig(options.cwd, next);
		return { ok: true, configPath: result.configPath, backupPath: result.backupPath };
	} catch (error) {
		if (error instanceof ConfigValidationError) return { ok: false, reason: error.message };
		return { ok: false, reason: describeError(error) };
	}
}
