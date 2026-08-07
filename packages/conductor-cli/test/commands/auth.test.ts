/**
 * Gate 5 RED -- `conductor auth` (ADR 0008 D8, §16 `runAuthStatus`; gate2-spec-fase7.md FR-5, edge case
 * 4; gate3-addendum-fase7.md T65/R46(ii), T69/R50).
 *
 * `runAuthStatus` does not exist yet (`../../src/commands/auth.ts`) -- the static import below makes
 * THIS WHOLE FILE fail to load ("Cannot find module") until Gate 6 creates it. That module-resolution
 * failure IS the RED signal for every test below; once Gate 6 exists, each test's own body is the real
 * spec.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuthStatus } from "../../src/commands/auth.ts";
import { createIsolatedCredentialStore, createTestModelRuntime } from "../support/fake-model-runtime.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("runAuthStatus -- FR-5, per-provider configured/not-configured with exact source", () => {
	it("reports a provider with no credential at all as not configured", async () => {
		const modelRuntime = await createTestModelRuntime();
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runAuthStatus({ io, modelRuntime });

		expect(code).toBe(0);
		expect(stdout()).toMatch(/deepseek/);
		expect(stdout().toLowerCase()).toMatch(/not configured/);
	});

	it("reports a provider with a stored credential as configured, source 'stored'", async () => {
		const store = createIsolatedCredentialStore();
		await store.modify("deepseek", async () => ({ type: "api_key", key: "sk-deepseek-stored" }));
		const modelRuntime = await createTestModelRuntime({ credentials: store });
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runAuthStatus({ io, modelRuntime });

		expect(code).toBe(0);
		expect(stdout()).toMatch(/deepseek/);
		expect(stdout()).toMatch(/stored/);
		expect(stdout()).not.toContain("sk-deepseek-stored"); // R50 -- status, never the secret value
	});
});

describe("runAuthStatus -- edge case 4, environment credential AND a stale stored credential for the same provider", () => {
	const ENV_VAR = "DEEPSEEK_API_KEY";
	let previousValue: string | undefined;

	beforeEach(() => {
		previousValue = process.env[ENV_VAR];
		process.env[ENV_VAR] = "sk-deepseek-from-env-should-not-win";
	});

	afterEach(() => {
		if (previousValue === undefined) delete process.env[ENV_VAR];
		else process.env[ENV_VAR] = previousValue;
	});

	it("reports source 'stored', never 'environment' -- the documented priority runtime > stored > environment (FR-5 contract)", async () => {
		const store = createIsolatedCredentialStore();
		await store.modify("deepseek", async () => ({ type: "api_key", key: "sk-deepseek-stale-stored" }));
		const modelRuntime = await createTestModelRuntime({ credentials: store });

		// Sanity: this is a genuine two-source conflict, not an accident of setup -- the runtime's own
		// status resolution (ModelRuntime.getProviderAuthStatus, the exact primitive `runAuthStatus` must
		// wrap per D8) already sees both.
		const rawStatus = modelRuntime.getProviderAuthStatus("deepseek");
		expect(rawStatus.configured).toBe(true);

		const { io, stdout } = createCapturingIo(project.root);
		const code = await runAuthStatus({ io, modelRuntime });

		expect(code).toBe(0);
		const deepseekLine = stdout()
			.split("\n")
			.find((line) => line.toLowerCase().includes("deepseek"));
		expect(deepseekLine, `no line mentioning "deepseek" in:\n${stdout()}`).toBeTruthy();
		expect(deepseekLine).toMatch(/stored/);
		expect(deepseekLine).not.toMatch(/environment/);
	});
});
