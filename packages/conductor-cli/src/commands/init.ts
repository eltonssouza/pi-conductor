/**
 * `conductor init` (docs/adr/0002-fase1-cli-foundation.md §5.1/§7.1).
 *
 * Reconciles two requirements that read like a conflict at first glance:
 *   - ADR 0002 §5.1/§7.1 (binding): re-running init over an EXISTING, VALID config is idempotent --
 *     a merge, never a blind overwrite. project.* is re-detected (it's the one section only init
 *     produces); provider.* and workspace.additionalProtectedPaths -- anything the user may have
 *     changed out of band via `conductor config set` -- survive untouched. No --force needed for
 *     this, because a merge that preserves user edits already satisfies T16 ("never clobber
 *     silently").
 *   - An existing config that FAILS TO LOAD (corrupt JSON, or fails schema validation) has nothing
 *     valid to merge from -- writing a brand-new config over it would be the blind overwrite T16
 *     forbids in spirit. That specific case refuses by default with a clear message, and only
 *     proceeds (from a fresh detection) when the caller passes --force -- and even then,
 *     writeConfig's own T16 backup still preserves the broken file, so --force never means data
 *     loss, only "stop asking me".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ConductorConfig,
	ConfigNotFoundError,
	ConfigParseError,
	ConfigValidationError,
	readConfig,
	writeConfig,
} from "@conductor/config";
import { enrollProject } from "@conductor/project";

/**
 * Placeholder default until the user runs `conductor config set provider.model <id>` (ADR 0002
 * §7.3) -- mirrors the identifier already used as the project's own illustrative default throughout
 * @conductor/config's schema doc-comment and test fixtures ("anthropic/claude-sonnet-5"), not a
 * fresh invention.
 */
export const DEFAULT_PROVIDER_MODEL = "anthropic/claude-sonnet-5";

const GITIGNORE_CONTENT =
	"# written by `conductor init` -- do not edit by hand; `conductor doctor` validates its presence\n/sessions/\n";

export interface InitOptions {
	cwd: string;
	/** Reinitialize from a fresh detection even when the existing config failed to load. */
	force?: boolean;
}

export type InitOutcome =
	| { kind: "created"; configPath: string; detectedType: string; technologies: string[] }
	| { kind: "merged"; configPath: string; backupPath?: string; detectedType: string; technologies: string[] }
	| { kind: "refused-invalid"; reason: string }
	| { kind: "failed"; reason: string };

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function freshConfig(cwd: string): ConductorConfig {
	const enrollment = enrollProject(cwd);
	return {
		schema: 1,
		project: enrollment.project,
		workspace: { root: "." },
		provider: { model: DEFAULT_PROVIDER_MODEL },
	};
}

function mergedConfig(cwd: string, existing: ConductorConfig): ConductorConfig {
	const enrollment = enrollProject(cwd);
	return {
		schema: 1,
		project: enrollment.project, // re-detected -- the one section only init produces
		workspace: existing.workspace, // preserved -- may hold user-set additionalProtectedPaths
		provider: existing.provider, // preserved -- set via `conductor config set`, never re-guessed
	};
}

/** Idempotent: `.conductor/.gitignore`'s content is fully machine-owned, so re-writing it when it
 * differs is safe and never loses a user edit (there is none to lose by design -- ADR 0002 §5.2). */
function ensureGitignore(conductorDir: string): void {
	mkdirSync(conductorDir, { recursive: true });
	const gitignorePath = join(conductorDir, ".gitignore");
	const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : undefined;
	if (current !== GITIGNORE_CONTENT) {
		writeFileSync(gitignorePath, GITIGNORE_CONTENT, "utf8");
	}
}

export async function runInit(options: InitOptions): Promise<InitOutcome> {
	const { cwd, force = false } = options;

	let existingConfig: ConductorConfig | undefined;
	let loadFailureMessage: string | undefined;

	try {
		existingConfig = readConfig(cwd);
	} catch (error) {
		if (error instanceof ConfigNotFoundError) {
			existingConfig = undefined;
		} else if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
			loadFailureMessage = error.message;
		} else {
			return {
				kind: "failed",
				reason: `could not inspect the workspace for an existing config: ${describeError(error)}`,
			};
		}
	}

	if (loadFailureMessage !== undefined && !force) {
		return {
			kind: "refused-invalid",
			reason:
				`an existing .conductor/config.json was found but could not be loaded (${loadFailureMessage}) -- ` +
				"refusing to write over it blindly. Run `conductor init --force` to reinitialize from a fresh " +
				"detection (the existing file is backed up first, never discarded), or run `conductor config` " +
				"/ edit .conductor/config.json by hand to repair it.",
		};
	}

	try {
		const config = existingConfig === undefined ? freshConfig(cwd) : mergedConfig(cwd, existingConfig);
		const result = writeConfig(cwd, config);
		ensureGitignore(join(cwd, ".conductor"));

		return existingConfig === undefined
			? {
					kind: "created",
					configPath: result.configPath,
					detectedType: config.project.type,
					technologies: config.project.technologies,
				}
			: {
					kind: "merged",
					configPath: result.configPath,
					backupPath: result.backupPath,
					detectedType: config.project.type,
					technologies: config.project.technologies,
				};
	} catch (error) {
		return { kind: "failed", reason: describeError(error) };
	}
}

export function describeInitOutcome(outcome: InitOutcome): string {
	switch (outcome.kind) {
		case "created":
			return (
				`Initialized .conductor/config.json (detected type: ${outcome.detectedType}; ` +
				`technologies: ${outcome.technologies.length > 0 ? outcome.technologies.join(", ") : "none detected"}).\n` +
				`Set your model with \`conductor config set provider.model <provider>/<model>\`.\n`
			);
		case "merged":
			return (
				`Updated .conductor/config.json (re-detected type: ${outcome.detectedType}; ` +
				`technologies: ${outcome.technologies.length > 0 ? outcome.technologies.join(", ") : "none detected"}). ` +
				`provider/workspace settings were preserved.` +
				(outcome.backupPath ? ` Previous file backed up to ${outcome.backupPath}.\n` : "\n")
			);
		case "refused-invalid":
			return `${outcome.reason}\n`;
		case "failed":
			return `conductor init failed: ${outcome.reason}\n`;
	}
}

export function initExitCode(outcome: InitOutcome): number {
	return outcome.kind === "created" || outcome.kind === "merged" ? 0 : 1;
}
