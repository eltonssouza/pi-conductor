/**
 * Schema for `.conductor/config.json` (docs/adr/0002-fase1-cli-foundation.md §5.3).
 * `schema: 1` is fixed from the first write -- never retrofitted (ADR §5.3, following the
 * versioned-format-from-day-one convention already established by the Python sibling project).
 */

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
		 */
		model: string;
		thinkingLevel?: string;
	};
}
