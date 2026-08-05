/**
 * Fase-0 backfill — Gap 1 (CLI/RPC PoC) test fixture (gate8-validation.md §7 item 1).
 *
 * Resolves Pi's own built CLI entrypoint and writes a scratch models.json declaring one fully
 * offline stub model, so `pi --mode rpc` has a model to resolve at startup — non-interactive
 * modes exit(1) if no model resolves (packages/coding-agent/src/main.ts:861) — without the test
 * ever actually contacting it. See test/rpc-channel.acceptance.test.ts for why "never contacts
 * the model" is the right minimal slice for this specific PoC.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface StubModelConfig {
	provider: string;
	model: string;
}

/**
 * Resolve the absolute path to Pi's own built CLI (`dist/cli.js`) via real Node ESM package
 * resolution (`import.meta.resolve`), not a hardcoded monorepo-relative path — this must find the
 * package wherever npm/the workspace actually placed it. `import.meta.resolve` deliberately
 * bypasses this package's vitest-only source aliasing (vitest.config.ts aliases
 * `@earendil-works/pi-coding-agent` to coding-agent's TS source for the rest of the suite, because
 * that dist build is not always present in this checkout) — confirmed empirically: it resolves
 * through real node_modules/package.json `exports`, landing on `dist/index.js`, whose sibling
 * `dist/cli.js` is the actual thing this PoC needs to spawn as a subprocess.
 *
 * Requires the coding-agent package (and its dependency chain) to be built first
 * (`npm run build` or `npm run build:offline` at the repo root) — `dist/cli.js` does not exist
 * until then, and this throws a real "Cannot find module" error in that case rather than silently
 * falling back to anything.
 */
export function resolvePiCliPath(): string {
	const entryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
	const entryPath = fileURLToPath(entryUrl);
	return join(dirname(entryPath), "cli.js");
}

const STUB_PROVIDER = "conductor-runtime-stub";
const STUB_MODEL = "conductor-runtime-stub-model";

/**
 * Write a scratch models.json (docs/models.md "Minimal Example" shape) declaring one offline stub
 * model in `agentDir`. `baseUrl` deliberately points at an unroutable local port — this fixture
 * exists only so RPC-mode startup has a model to resolve, never to actually be called (mirrors
 * test/support/fake-model.ts's own "http://localhost:0" sentinel for the same reason).
 */
export function writeStubModelsConfig(agentDir: string): StubModelConfig {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify(
			{
				providers: {
					[STUB_PROVIDER]: {
						baseUrl: "http://localhost:0",
						api: "openai-completions",
						apiKey: "fake-key",
						models: [{ id: STUB_MODEL }],
					},
				},
			},
			null,
			2,
		),
		"utf-8",
	);
	return { provider: STUB_PROVIDER, model: STUB_MODEL };
}
