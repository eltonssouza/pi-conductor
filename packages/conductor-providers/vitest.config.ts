import { builtinModules } from "node:module";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

// Mirrors packages/conductor-runtime/vitest.config.ts (same reason: this package resolves
// @earendil-works/pi-ai and @earendil-works/pi-coding-agent to source, not a built dist, per
// docs/adr/0001-adopt-pi-as-runtime.md §2.1 -- and picks up the same Node-builtin-vs-bare-name
// externalizer workaround since it pulls the same transitive undici/cross-spawn CJS chain).
const nodeBuiltinAliases = builtinModules
	.filter((name) => !name.startsWith("node:"))
	.map((name) => ({
		find: new RegExp(`^${name.replace(/\//g, "\\/")}$`),
		replacement: `node:${name}`,
	}));

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
		},
		resolve: {
			alias: [
				...nodeBuiltinAliases,
				{ find: /^@earendil-works\/pi-ai$/, replacement: workspaceSourcePaths.aiIndex },
				{
					find: /^@earendil-works\/pi-coding-agent$/,
					replacement: workspaceSourcePaths.codingAgentIndex,
				},
			],
		},
	}),
);
