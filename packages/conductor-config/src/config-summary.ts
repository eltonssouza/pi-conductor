/**
 * Read-only, redaction-safe view of `.conductor/config.json` for `conductor doctor`/`conductor
 * config show` (docs/conductor/gate3-fase1-addendum.md secure default 10, T12).
 *
 * Built by explicit allowlisted field-by-field copy -- never `{...config}` -- so a field this
 * module does not recognize (e.g. one that slipped past writeConfig's T11 check via a hand-edit of
 * the file, or a future schema field nobody updated this allowlist for) is never surfaced, not even
 * its key name. This is defense in depth on top of T11's write-time rejection: T11 stops a secret
 * from being written in the first place; this stops one from being read back out if it ever gets in
 * some other way (ADR 0002 §7.2's binding rule: "doctor reporta status, nunca valor").
 *
 * A second, independent layer: even for fields on the allowlist, each string value is run through
 * the same secret-shape check writeConfig uses before being included verbatim. A value that looks
 * like a raw secret (e.g. because the file was hand-edited outside writeConfig, bypassing T11) is
 * replaced with a redaction placeholder instead of being echoed, and its path is recorded in
 * `redactedFields` -- a field *name*, never a value, safe to print in a doctor report.
 */

import { readConfig } from "./read-config.ts";
import type { ConductorConfig, ProjectType } from "./schema.ts";
import { looksSecretShaped } from "./secret-detection.ts";

const REDACTION_PLACEHOLDER = "[redacted: value looked secret-shaped]";

export interface ConfigSummary {
	schema: 1;
	project: {
		type: ProjectType;
		technologies: string[];
		evidence: string[];
		detectedAt: string;
	};
	workspace: {
		root: string;
		additionalProtectedPaths: string[];
	};
	provider: {
		model: string;
		thinkingLevel?: string;
	};
	/** Dot-paths of fields whose value was withheld because it looked secret-shaped. Never contains values. */
	redactedFields: string[];
}

function redactIfSecretShaped(path: string, value: string, redactedFields: string[]): string {
	if (looksSecretShaped(value)) {
		redactedFields.push(path);
		return REDACTION_PLACEHOLDER;
	}
	return value;
}

function redactStringArrayIfSecretShaped(path: string, values: string[], redactedFields: string[]): string[] {
	return values.map((value, index) => redactIfSecretShaped(`${path}[${index}]`, value, redactedFields));
}

/**
 * Builds the summary from an already-loaded config. Exported directly (not only via
 * getConfigSummary) so callers that already hold a ConductorConfig -- e.g. right after writeConfig
 * -- can get the redaction-safe view without a redundant disk read.
 */
export function summarizeConfig(config: ConductorConfig): ConfigSummary {
	const redactedFields: string[] = [];

	const provider: ConfigSummary["provider"] = {
		model: redactIfSecretShaped("provider.model", config.provider.model, redactedFields),
	};
	if (config.provider.thinkingLevel !== undefined) {
		provider.thinkingLevel = redactIfSecretShaped(
			"provider.thinkingLevel",
			config.provider.thinkingLevel,
			redactedFields,
		);
	}

	return {
		schema: config.schema,
		project: {
			type: config.project.type,
			technologies: redactStringArrayIfSecretShaped(
				"project.technologies",
				config.project.technologies,
				redactedFields,
			),
			evidence: redactStringArrayIfSecretShaped("project.evidence", config.project.evidence, redactedFields),
			detectedAt: config.project.detectedAt,
		},
		workspace: {
			root: config.workspace.root,
			additionalProtectedPaths: redactStringArrayIfSecretShaped(
				"workspace.additionalProtectedPaths",
				config.workspace.additionalProtectedPaths ?? [],
				redactedFields,
			),
		},
		provider,
		redactedFields,
	};
}

/**
 * Reads `.conductor/config.json` under `workspaceRoot` and returns the redaction-safe summary.
 * Propagates ConfigNotFoundError/ConfigParseError/ConfigValidationError from readConfig()
 * unchanged -- callers (doctor) distinguish "not initialized" from "corrupted" the same way
 * readConfig's own callers do.
 */
export function getConfigSummary(workspaceRoot: string): ConfigSummary {
	const config = readConfig(workspaceRoot);
	return summarizeConfig(config);
}
