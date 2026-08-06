import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

// @conductor/secrets has zero @earendil-works/pi-* dependencies and zero @conductor/* dependencies
// (docs/adr/0003-fase2-security-architecture.md §6.1/§9: the leaf of the graph) -- mirrors
// conductor-config's vitest.config.ts for the same reason: none of vitest.base.ts's workspace-source
// aliases are exercised here, it is merged in only for toolchain consistency across every package.
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
