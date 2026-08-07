import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

// @conductor/library has zero @earendil-works/pi-* dependencies and zero @conductor/* dependencies
// (docs/adr/0006-fase5-library-and-grounding.md D8/§11.1: I/O at the edges over node:sqlite/node:fs/
// node:dns, pure policy in the middle, no runtime coupling) -- mirrors conductor-secrets's and
// conductor-config's own vitest.config.ts for the same reason: none of vitest.base.ts's
// workspace-source aliases are exercised here, it is merged in only for toolchain consistency
// across every package.
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
