import { type CreateAgentSessionResult, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createPermissionGateExtension } from "./permission-gate.ts";

/**
 * `ConductorResourceLoader` (docs/adr/0002-fase1-cli-foundation.md §4.1). Deliberately thin: on
 * Fase 1 its only job is to inject the custom system prompt built from `.conductor/config.json`
 * over an otherwise-locked-down `DefaultResourceLoader` (no third-party extensions/skills/prompt
 * templates/themes/context files -- the same Gate 3 secure default the Fase 0 PoC already applied,
 * §3 item 5/§7). Roles, skills, rules, commands, gate-awareness and Diary context are explicit stubs
 * here (ADR 0002 §4.2's scope table) -- each is a later phase's job, named there, not a silent gap:
 *
 *   - roles / skills / rules / commands -> Fase 3 (noSkills/noPromptTemplates stay true)
 *   - current gate                      -> Fase 4 (no gate concept exists yet to inject)
 *   - relevant memory (Diary)           -> Fase 6 (no journal query in the prompt yet)
 *
 * Per ADR 0002 §3.1, this class does NOT become its own package -- it lives inside
 * `conductor-runtime`, which already builds a `DefaultResourceLoader` inline (session.ts) and
 * already owns the permission-gate extension this class wires in. `ConductorResourceLoaderOptions`
 * intentionally takes a *structural* `Fase1ProjectConfig` (only the two fields `buildFase1SystemPrompt`
 * actually reads) rather than importing the nominal `ConductorConfig` type from `@conductor/config`:
 * ADR 0002 §3.1's dependency graph keeps conductor-config, conductor-project and conductor-runtime
 * free of dependencies on one another ("each testable in isolation against fixtures, no package
 * needs to mock another") -- a real `ConductorConfig` object built by `@conductor/config` already
 * satisfies this interface structurally, so no import edge (not even a type-only one, which would
 * still be a package.json dependency entry for the type-checker) is needed to use it here.
 *
 * Not yet wired into `createConductorSession`'s own resourceLoader construction (session.ts:81-93),
 * even though ADR 0002 §3.2 describes that as the eventual replacement ("substitui a construção
 * inline de DefaultResourceLoader em session.ts"). Nothing in round B1 (conductor-cli's
 * init/doctor/config) ever opens a live AgentSession, so there is no round-B1 caller for a
 * config-driven session yet; round B2 (`conductor chat`, the first real caller) is who actually
 * needs `createConductorSession` to accept a `config` and build its resourceLoader through this
 * class, and is the more proportionate place to make that (session.ts-signature-changing) edit --
 * changing it here with no exercising caller would risk round A's 78 already-green tests for a
 * capability nothing in this round uses. Flagged explicitly rather than silently deferred.
 */

export interface Fase1ProjectConfig {
	project: {
		type: string;
		technologies: string[];
	};
	provider: {
		model: string;
		thinkingLevel?: string;
	};
}

export interface ConductorResourceLoaderOptions {
	/** Absolute path to the workspace root (same value passed to the permission-gate). */
	workspaceRoot: string;
	/** The project's `.conductor/` directory (not Pi's global agent dir -- ADR 0002 §5.2). */
	agentDir: string;
	/** Already-validated config; the loader's only input (ADR 0002 §4.2). */
	config: Fase1ProjectConfig;
	/** Passed through to the underlying permission-gate (same field CreateConductorSessionOptions exposes today). */
	additionalProtectedPaths?: string[];
}

/**
 * Builds the Fase 1 system prompt from config alone -- pure, no I/O. Exported directly so it can be
 * unit-tested and reused without constructing a full resource loader.
 */
export function buildFase1SystemPrompt(config: Fase1ProjectConfig): string {
	const technologies =
		config.project.technologies.length > 0 ? config.project.technologies.join(", ") : "none detected";

	return [
		`You are Conductor, an AI coding agent operating inside a "${config.project.type}" project.`,
		`Detected technologies: ${technologies}.`,
		`Configured model: ${config.provider.model}.`,
		"Every write, edit, and bash command you request is evaluated by a permission gate before it " +
			"runs: some paths are off-limits entirely, and everything else needs human approval.",
	].join("\n");
}

export class ConductorResourceLoader {
	private readonly inner: DefaultResourceLoader;

	constructor(options: ConductorResourceLoaderOptions) {
		this.inner = new DefaultResourceLoader({
			cwd: options.workspaceRoot,
			agentDir: options.agentDir,
			systemPromptOverride: () => buildFase1SystemPrompt(options.config),
			// Secure defaults inherited from Gate 3 (Fase 0 threat model, §5 item 5/§7) unchanged: no
			// third-party extension/skill/prompt-template/theme/context-file ever enters the TCB --
			// only this first-party permission-gate extension is loaded.
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				createPermissionGateExtension({
					workspaceRoot: options.workspaceRoot,
					additionalProtectedPaths: options.additionalProtectedPaths,
				}),
			],
		});
	}

	async reload(): Promise<CreateAgentSessionResult["extensionsResult"]> {
		await this.inner.reload();
		return this.inner.getExtensions();
	}

	/** Repassed as `resourceLoader` to createAgentSession()/createConductorSession(). */
	get pi(): DefaultResourceLoader {
		return this.inner;
	}
}
