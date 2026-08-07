/**
 * Gate 5 RED -- `conductor login` (ADR 0008 D8, §16 `runLogin`; gate2-spec-fase7.md FR-1/FR-2; BR-1;
 * gate3-addendum-fase7.md T69/R50).
 *
 * `runLogin` does not exist yet (`../../src/commands/login.ts`) -- the static import below makes THIS
 * WHOLE FILE fail to load ("Cannot find module '../../src/commands/login.ts'") until Gate 6 creates it.
 * That module-resolution failure IS the RED signal for every test below; once Gate 6 exists, each test's
 * own body is the real spec.
 *
 * Judgment call flagged for Gate 6 (the ADR's `runLogin` contract does not specify how an interactive
 * API-key prompt is wired through `CliIO`): the "persists an api-key credential" test below feeds the
 * answer through `io.tty` (the SAME stream pair `tty-confirm.ts`'s `createTtyConfirmChannel` already uses
 * for `gate approve`'s y/n prompt) rather than inventing a new `CliIO` field, since `AuthInteraction.prompt`
 * (`packages/ai/src/auth/types.ts`) needs a real interactive channel and `io.tty` is the only one CliIO
 * already has. If Gate 6 wires the secret prompt some other way, this one test's mechanism (not its
 * assertions about the persisted credential/BR-1) will need a small adjustment -- documented here so
 * that adjustment is expected, not a surprise.
 */

import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLogin } from "../../src/commands/login.ts";
import { createIsolatedCredentialStore, createTestModelRuntime } from "../support/fake-model-runtime.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";
import { fakeTtyStreams } from "../support/tty.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("runLogin -- FR-2, no provider argument", () => {
	it("lists known providers instead of a generic 'provider required' error", async () => {
		const credentials = createIsolatedCredentialStore();
		const modelRuntime = await createTestModelRuntime({ credentials });
		const { io, stdout } = createCapturingIo(project.root);

		const code = await runLogin({ io, credentials, modelRuntime });

		expect(code).toBe(0);
		// The real vendor catalog (`builtinProviders()`) always includes these -- a stable, well-known
		// subset, never the full ~40-provider list verbatim (that would make this test brittle against
		// unrelated vendor catalog changes).
		expect(stdout()).toContain("anthropic");
		expect(stdout()).toContain("openai");
		expect(stdout()).not.toMatch(/provider required/i);
	});
});

describe("runLogin <provider> -- FR-1/BR-1, api-key persistence via the hardened store", () => {
	it("persists the entered api-key credential through the injected CredentialStore, never a second parallel file", async () => {
		const filesBefore = new Set(readdirSync(project.root));

		const store = createIsolatedCredentialStore();
		const modelRuntime = await createTestModelRuntime({ credentials: store });
		const tty = fakeTtyStreams();
		const { io, stdout } = createCapturingIo(project.root, tty.streams);

		const runPromise = runLogin({ provider: "deepseek", io, credentials: store, modelRuntime });
		// "deepseek" (packages/ai/src/providers/deepseek.ts) is apiKey-only (envApiKeyAuth, no oauth) --
		// the incident provider named throughout the ADR/spec, and a real, unmocked vendor login
		// definition whose `login()` calls `interaction.prompt({type:"secret", ...})` exactly once.
		tty.answer("sk-deepseek-test-only-never-a-real-key");
		const code = await runPromise;

		expect(code).toBe(0);
		expect(stdout()).not.toMatch(/sk-deepseek-test-only-never-a-real-key/); // never echo the secret

		// BR-1 -- the persisted credential is readable back from the SAME store instance `runLogin` was
		// handed (bypassing any in-process overlay `modelRuntime` itself might interpose) -- proving
		// persistence went through the injected collaborator, not a stray file.
		const persisted = await store.read("deepseek");
		expect(persisted).toMatchObject({ type: "api_key", key: "sk-deepseek-test-only-never-a-real-key" });

		// BR-1, structurally: nothing new appeared in the CWD. A `writeFileSync("auth.json", ...)`
		// anti-pattern (the exact one `packages/ai/src/cli.ts` has and this fase must not copy) would
		// show up here.
		const filesAfter = new Set(readdirSync(project.root));
		expect(filesAfter).toEqual(filesBefore);
	});

	it("refuses an unknown provider name explicitly, naming it -- never a generic/unlabeled error", async () => {
		const credentials = createIsolatedCredentialStore();
		const modelRuntime = await createTestModelRuntime({ credentials });
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runLogin({ provider: "not-a-real-provider-xyz", io, credentials, modelRuntime });

		expect(code).not.toBe(0);
		expect(stderr()).toContain("not-a-real-provider-xyz");
	});
});
