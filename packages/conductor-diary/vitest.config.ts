import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

// @conductor/diary imports only PURE functions from @conductor/library (D3 §5.1: "a aresta
// @conductor/diary -> @conductor/library toca APENAS funções puras... nunca os stores de I/O") and has
// zero @earendil-works/pi-* / @conductor/runtime dependency -- mirrors conductor-library's own
// vitest.config.ts for the same reason: none of vitest.base.ts's workspace-source aliases are
// exercised here, it is merged in only for toolchain consistency across every package.
export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
		},
	}),
);
