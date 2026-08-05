import { defineConfig } from "vitest/config";

// No workspace-source aliasing needed here (unlike conductor-poc/vitest.config.ts): this package
// has zero dependency on any @earendil-works/pi-* package, only Node built-ins (node:fs, node:path).
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
	},
});
