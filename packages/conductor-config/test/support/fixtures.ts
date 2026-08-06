import type { ConductorConfig } from "../../src/schema.ts";

/** A minimal, fully valid config -- the baseline every test starts from and overrides piecemeal. */
export function validConfig(overrides: Partial<ConductorConfig> = {}): ConductorConfig {
	return {
		schema: 1,
		project: {
			type: "backend",
			technologies: ["Node/TypeScript"],
			evidence: ["package.json"],
			detectedAt: "2026-08-05T12:00:00.000Z",
		},
		workspace: {
			root: ".",
		},
		provider: {
			model: "anthropic/claude-sonnet-5",
		},
		...overrides,
	};
}
