import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

// conductor-config has zero @earendil-works/pi-* dependencies (ADR 0002 §3.1: conductor-config,
// conductor-project and conductor-runtime deliberately do not depend on one another), so none of
// vitest.base.ts's workspace-source aliases are exercised here -- it is still merged in for
// consistency with every other package's toolchain (same base config, same override shape), not
// because this package needs the aliasing it provides.
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
