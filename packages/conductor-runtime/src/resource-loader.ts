import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { type CreateAgentSessionResult, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { AuditTrailWriter } from "./audit-trail.ts";
import type { EffectivePolicyInput } from "./permission-engine.ts";
import { createPermissionGateExtension, type PermissionGateDecision } from "./permission-gate.ts";

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
 * Wired into `createConductorSession`'s own resourceLoader construction as of round B2
 * (`conductor chat`, session.ts): when `CreateConductorSessionOptions.config` is supplied,
 * `createConductorSession` builds its resourceLoader through this class instead of the inline
 * `DefaultResourceLoader` it used through round A/B1 -- exactly the replacement ADR 0002 §3.2
 * described ("substitui a construção inline de DefaultResourceLoader em session.ts"). The `config`
 * option is additive and optional: every round A/B1 caller that does not pass it (the acceptance
 * tests, `conductor-cli`'s init/doctor/config, none of which open a live session with a custom
 * prompt) keeps its exact prior behavior byte-for-byte -- discovery-by-need (Outside-In Development
 * -- Complete Professional Guide §3.3: "needs become roles become interfaces") applied to session.ts
 * itself, not just to this class: round B1 named the caller that would need this and declined to
 * build it speculatively; round B2 is that caller, so the extension point is added now, driven by
 * its actual call site (chat.ts), not invented ahead of one.
 *
 * `onDecision`/`approvalTimeoutMs`/`extraExtensions` below exist for the same reason
 * `CreateConductorSessionOptions` already exposes them: this class builds its own
 * `createPermissionGateExtension(...)` call internally (it cannot share the one
 * `createConductorSession` builds for its own inline-loader branch, since only one instance of the
 * gate may ever be registered per resourceLoader), so every option that call needs must be threaded
 * through here too -- otherwise a caller using the `config` path would silently lose observability
 * (`onDecision`) or its configured approval timeout the moment it opted into a custom system prompt.
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
	/** Passed through to the underlying permission-gate (same field CreateConductorSessionOptions exposes). */
	approvalTimeoutMs?: number;
	/** Observability hook -- same contract as `CreateConductorSessionOptions.onDecision`. Must never throw. */
	onDecision?: (decision: PermissionGateDecision) => void;
	/**
	 * FR-3/FR-6/FR-7/FR-9..FR-11/FR-23/FR-24 (GAP-B loop-back) -- same contract as
	 * `CreateConductorSessionOptions.policy`. `session.ts` already unions `policy.protectedPaths`
	 * into the `additionalProtectedPaths` this class receives above, so this class only needs to
	 * forward the value as-is to its own internal `createPermissionGateExtension` call below --
	 * it does not re-derive or re-merge anything.
	 */
	policy?: EffectivePolicyInput;
	/** FR-19/FR-20/FR-21 -- same contract as `CreateConductorSessionOptions.yesFlagActive`. */
	yesFlagActive?: boolean;
	/** Test-only: extra inline extensions -- same contract as `CreateConductorSessionOptions.extraExtensions`. */
	extraExtensions?: InlineExtension[];
	/**
	 * R13/R14/T41 (ADR 0004 §2.2/§6/§8) -- same contract as `PermissionGateOptions.auditTrailWriter`:
	 * when supplied, this class's own internal `createPermissionGateExtension(...)` call is fiared to
	 * this SAME writer instance instead of building its own default, so `session.ts`'s composition
	 * root (and, through it, a registered `task` tool) shares the one audit trail this branch's gate
	 * writes to. Omitted entirely: behaves exactly as before (this class's own default writer).
	 */
	auditTrailWriter?: AuditTrailWriter;
	/**
	 * Fase 3 (`conductor chat --role <slug>`, ADR 0004 §16 appendix `ConductorRole.systemPrompt`):
	 * when supplied, replaces `buildFase1SystemPrompt(config)` outright as this loader's system
	 * prompt -- the mechanism a role's own persona becomes the basis of the session. Omitted
	 * entirely: this class's Fase 1 behavior (`buildFase1SystemPrompt(options.config)`) is unchanged.
	 */
	systemPromptOverride?: string;
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
			// Fase 3: a role's own persona (systemPromptOverride passed in) takes precedence over the
			// Fase 1 config-derived prompt when supplied -- both are still a static string/thunk, never
			// re-derived per turn.
			systemPromptOverride: () => options.systemPromptOverride ?? buildFase1SystemPrompt(options.config),
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
					approvalTimeoutMs: options.approvalTimeoutMs,
					onDecision: options.onDecision,
					policy: options.policy,
					yesFlagActive: options.yesFlagActive,
					auditTrailWriter: options.auditTrailWriter,
				}),
				...(options.extraExtensions ?? []),
			],
		});
	}

	async reload(): Promise<CreateAgentSessionResult["extensionsResult"]> {
		await this.inner.reload();
		return this.inner.getExtensions();
	}

	/** Repassed as `resourceLoader` to the Pi SDK's session factory / createConductorSession. */
	get pi(): DefaultResourceLoader {
		return this.inner;
	}
}
