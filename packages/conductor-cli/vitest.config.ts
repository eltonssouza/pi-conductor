import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

// Mirrors packages/conductor-runtime/vitest.config.ts verbatim (same root cause): conductor-cli's
// doctor command imports ModelRuntime from @earendil-works/pi-coding-agent directly (ADR 0002 §7.2
// item 5), so it hits the same Vite/Vitest SSR resolution quirk conductor-runtime's own config
// documents (bare `require("string_decoder")`/etc. from deep CJS transitive deps under
// undici/cross-spawn misresolved as relative paths instead of Node builtins) and needs
// @earendil-works/pi-coding-agent (and what it transitively imports) aliased to source rather than
// coding-agent's dist, for the same "package.json main" reason.
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
			// Doctor's own ModelRuntime check runs fully offline (allowModelNetwork: false); no test
			// in this package depends on real network access.
			env: { PI_OFFLINE: "1" },
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
		resolve: {
			alias: [
				...nodeBuiltinAliases,
				{
					find: /^@earendil-works\/pi-coding-agent$/,
					replacement: fileURLToPath(new URL("../coding-agent/src/index.ts", import.meta.url)),
				},
				{
					find: /^@earendil-works\/pi-client$/,
					replacement: fileURLToPath(new URL("../client/src/index.ts", import.meta.url)),
				},
				{
					find: /^@earendil-works\/pi-protocol$/,
					replacement: fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
				},
				{ find: /^@earendil-works\/pi-ai$/, replacement: workspaceSourcePaths.aiIndex },
				{ find: /^@earendil-works\/pi-agent-core$/, replacement: workspaceSourcePaths.agentIndex },
				{ find: /^@earendil-works\/pi-tui$/, replacement: workspaceSourcePaths.tuiIndex },
			],
		},
	}),
);
