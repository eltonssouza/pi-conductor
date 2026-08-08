/**
 * Schema for `.conductor/config.json` (docs/adr/0002-fase1-cli-foundation.md §5.3).
 * `schema: 1` is fixed from the first write -- never retrofitted (ADR §5.3, following the
 * versioned-format-from-day-one convention already established by the Python sibling project).
 */

import type { ModelPolicy } from "./model-policy.ts";

export const CONFIG_SCHEMA_VERSION = 1 as const;

export type ProjectType = "backend" | "frontend" | "fullstack" | "mobile" | "library" | "data" | "unknown";

export const PROJECT_TYPES: readonly ProjectType[] = [
	"backend",
	"frontend",
	"fullstack",
	"mobile",
	"library",
	"data",
	"unknown",
];

export interface ConductorConfig {
	/** Versioned format since the first write -- never retrofitted (ADR 0002 §5.3). */
	schema: typeof CONFIG_SCHEMA_VERSION;
	project: {
		type: ProjectType;
		/** e.g. ["Java/Maven", "Angular 21"]. */
		technologies: string[];
		/** Manifest paths, relative to the workspace root, that produced the detection. */
		evidence: string[];
		/** ISO-8601 UTC timestamp, e.g. "2026-08-05T12:00:00.000Z". */
		detectedAt: string;
	};
	workspace: {
		/** "." = implicit (the parent directory of .conductor/); absolute only to narrow further. */
		root: string;
		additionalProtectedPaths?: string[];
	};
	provider: {
		/**
		 * "provider/modelId", e.g. "anthropic/claude-sonnet-5" -- an identifier, never a credential.
		 * T11 (docs/conductor/gate3-fase1-addendum.md): this field, and this schema as a whole, may
		 * only ever hold references to where a credential lives (env var name / keychain id /
		 * provider+model id) -- never key material. Enforced at write time, see secret-detection.ts.
		 *
		 * D11 (ADR 0008 §21): this is ALSO the session's flat model, and therefore the universal
		 * implicit binding for every gate whenever `modelPolicy` below declares no binding at all.
		 */
		model: string;
		thinkingLevel?: string;
	};
	/**
	 * Fase 7 / FR-11 (ADR 0008 §8.1's own schema table, landed by the §21/D11 Gate-8 loop-back): the
	 * project's model routing policy -- gate->role overrides, role->model bindings, egress rules.
	 *
	 * UNTRUSTED, repo-supplied input (D6/R54, same trust class as `.conductor/policy.json` and role
	 * definitions): the type below is the SHAPE a valid policy has, never a promise that whatever sits
	 * on disk conforms to it. `assertValidConfigShape` only checks that this key, when present, is an
	 * object; the real validation is `parseModelPolicy`/`resolveProjectModelPolicy` (model-policy.ts),
	 * deliberately kept OUT of the config's own structural validator so a malformed policy degrades to
	 * "present but unreadable" (§8.2) instead of making `readConfig` -- and with it `conductor doctor`
	 * and `config show` -- fail outright.
	 *
	 * Absent is the default and stays fully supported: it is what puts a project in D11's
	 * compatibility mode (`provider.model` binds every gate).
	 */
	modelPolicy?: ModelPolicy;
}
