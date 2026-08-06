import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

// Works around a Vite/Vitest SSR module-evaluator resolution quirk hit only from this package's
// directory: transitive CJS dependencies (deep under undici/cross-spawn) do bare
// `require("string_decoder")`/`require("stream")`/etc. for Node core modules, and vitest's
// externalizer tries to resolve each one as a relative path under this package's root instead of
// recognizing it as a builtin (Node's own require.resolve() has no such problem — verified
// directly). Aliasing every bare builtin name to its `node:`-prefixed form makes the resolution
// unambiguous for all of them at once, instead of chasing one module name at a time.
const nodeBuiltinAliases = builtinModules
	.filter((name) => !name.startsWith("node:"))
	.map((name) => ({
		find: new RegExp(`^${name.replace(/\//g, "\\/")}$`),
		replacement: `node:${name}`,
	}));

// Mirrors packages/coding-agent/vitest.config.ts: coding-agent's dist is not built in this
// checkout (Fase 0 works against source, per docs/adr/0001-adopt-pi-as-runtime.md §2.1's
// anti-corruption-layer stance of depending on the stable Agent/AgentSession surface directly),
// so @earendil-works/pi-coding-agent must resolve to its source entrypoint the same way
// @earendil-works/pi-ai and @earendil-works/pi-agent-core already do via vitest.base.ts.
export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			// Installs the T29/R12c write-path redaction guard before every test file in this package
			// runs -- see test/setup/install-session-redaction-guard.ts's own header for why the
			// session-redaction regression canary specifically needs this (it drives Pi's real
			// SessionManager directly, without importing any conductor-runtime source).
			setupFiles: [fileURLToPath(new URL("./test/setup/install-session-redaction-guard.ts", import.meta.url))],
			// Tests run offline by default; the one live-model test opts back in with
			// vi.stubEnv("PI_OFFLINE", undefined) so the rest of the suite never depends on network.
			env: { PI_OFFLINE: "1" },
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					// coding-agent's image pipeline depends on this native addon; it must not be
					// bundled by vite's transform (same exclusion coding-agent's own config uses).
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
