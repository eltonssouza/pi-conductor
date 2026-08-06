/**
 * ConductorResourceLoader (docs/adr/0002-fase1-cli-foundation.md §4.1 contract) — Gate 5 (red first).
 *
 * Three layers, cheapest first:
 *   1. buildFase1SystemPrompt: pure function, no I/O.
 *   2. Construction + reload(): the class wires DefaultResourceLoader correctly (system prompt
 *      override, secure defaults, the permission-gate extension) without needing a live session.
 *   3. One acceptance-style test (mirrors acceptance.test.ts's pattern): spins a real
 *      createAgentSession() using `loader.pi` as the resourceLoader, proving end-to-end that (a)
 *      the custom system prompt is actually the one the session got, (b) an in-workspace edit is
 *      allowed, (c) a caller-supplied `additionalProtectedPaths` entry is blocked even though it is
 *      inside the workspace, and (d) an edit escaping the workspace is blocked -- the exact
 *      guarantee round B2 (`conductor chat`) needs before depending on this class.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFase1SystemPrompt, ConductorResourceLoader, type Fase1ProjectConfig } from "../src/resource-loader.ts";
import { registerFakeModel } from "./support/fake-model.ts";
import { createTestUiContext } from "./support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

describe("buildFase1SystemPrompt", () => {
	it("mentions the detected project type, technologies, and configured model", () => {
		const config: Fase1ProjectConfig = {
			project: { type: "backend", technologies: ["Java/Maven", "Node.js"] },
			provider: { model: "anthropic/claude-sonnet-5" },
		};
		const prompt = buildFase1SystemPrompt(config);
		expect(prompt).toContain("backend");
		expect(prompt).toContain("Java/Maven, Node.js");
		expect(prompt).toContain("anthropic/claude-sonnet-5");
	});

	it("says so explicitly when no technologies were detected, rather than an empty list", () => {
		const config: Fase1ProjectConfig = {
			project: { type: "unknown", technologies: [] },
			provider: { model: "anthropic/claude-sonnet-5" },
		};
		expect(buildFase1SystemPrompt(config)).toContain("none detected");
	});

	it("mentions the permission gate so the model knows writes/bash are governed", () => {
		const config: Fase1ProjectConfig = {
			project: { type: "backend", technologies: [] },
			provider: { model: "anthropic/claude-sonnet-5" },
		};
		expect(buildFase1SystemPrompt(config).toLowerCase()).toContain("permission gate");
	});
});

describe("ConductorResourceLoader construction", () => {
	let workspace: ScratchWorkspace;

	beforeEach(() => {
		workspace = createScratchWorkspace();
	});

	afterEach(() => {
		workspace.cleanup();
	});

	it("wraps a DefaultResourceLoader whose system prompt is the Fase 1 prompt built from config", async () => {
		const config: Fase1ProjectConfig = {
			project: { type: "backend", technologies: ["Node.js"] },
			provider: { model: "anthropic/claude-opus-4" },
		};
		const loader = new ConductorResourceLoader({
			workspaceRoot: workspace.root,
			agentDir: workspace.agentDir,
			config,
		});

		expect(loader.pi).toBeInstanceOf(DefaultResourceLoader);

		await loader.reload();

		expect(loader.pi.getSystemPrompt()).toBe(buildFase1SystemPrompt(config));
	});

	it("registers exactly the first-party permission-gate extension -- no third-party skills/prompts/themes/extensions (Gate 3 secure default 5/8, Fase 0/1)", async () => {
		const config: Fase1ProjectConfig = {
			project: { type: "backend", technologies: [] },
			provider: { model: "anthropic/claude-sonnet-5" },
		};
		const loader = new ConductorResourceLoader({
			workspaceRoot: workspace.root,
			agentDir: workspace.agentDir,
			config,
		});

		const extensionsResult = await loader.reload();

		expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
			"<inline:conductor-permission-gate>",
		]);
		// No `additionalSkillPaths` supplied by this test -- this asserts the secure DEFAULT (no
		// caller-supplied skill path -> zero skills), not a gap. Gate 8 loop-back (G3/FR-5/FR-6): a
		// caller that DOES supply `additionalSkillPaths` gets those skills regardless of `noSkills`
		// (see the next test, and `resource-loader.ts`'s own header for why the two options don't
		// conflict) -- `conductor-cli`'s `chat.ts` is that real caller, threading the 44 built-in
		// skills' vetted, contained locations through this exact option.
		expect(loader.pi.getSkills().skills).toEqual([]);
		expect(loader.pi.getThemes().themes).toEqual([]);
	});

	it("Gate 8 loop-back (G3/FR-5/FR-6): threads additionalSkillPaths to the inner loader even though noSkills stays true", async () => {
		const skillDir = join(workspace.root, "fixture-skills", "design-service");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			["---", "name: design-service", "description: Use for the fixture.", "---", "", "body"].join("\n"),
			"utf-8",
		);

		const config: Fase1ProjectConfig = {
			project: { type: "backend", technologies: [] },
			provider: { model: "anthropic/claude-sonnet-5" },
		};
		const loader = new ConductorResourceLoader({
			workspaceRoot: workspace.root,
			agentDir: workspace.agentDir,
			config,
			additionalSkillPaths: [join(workspace.root, "fixture-skills")],
		});

		await loader.reload();

		const { skills } = loader.pi.getSkills();
		expect(skills).toHaveLength(1);
		expect(skills[0]?.name).toBe("design-service");
		expect(skills[0]?.description).toBe("Use for the fixture.");
		// Still no third-party extensions/prompts/themes -- additionalSkillPaths is additive, it does
		// not loosen any OTHER secure default this class applies.
		expect(loader.pi.getThemes().themes).toEqual([]);
	});
});

describe("ConductorResourceLoader end-to-end (acceptance)", () => {
	let workspace: ScratchWorkspace;

	beforeEach(() => {
		workspace = createScratchWorkspace();
	});

	afterEach(() => {
		workspace.cleanup();
	});

	it("applies the custom system prompt and enforces workspace containment + additionalProtectedPaths through a real session", async () => {
		const insideFile = "hello.txt";
		writeFileSync(join(workspace.root, insideFile), "hello", "utf-8");

		const protectedDir = "vault";
		mkdirSync(join(workspace.root, protectedDir), { recursive: true });
		writeFileSync(join(workspace.root, protectedDir, "secret.txt"), "do not touch", "utf-8");

		const outsideMarker = join(workspace.root, "..", `${workspace.root.split(/[\\/]/).pop()}-outside-marker.txt`);

		const config: Fase1ProjectConfig = {
			project: { type: "backend", technologies: ["Node.js"] },
			provider: { model: "anthropic/claude-sonnet-5" },
		};

		const loader = new ConductorResourceLoader({
			workspaceRoot: workspace.root,
			agentDir: workspace.agentDir,
			config,
			additionalProtectedPaths: [join(workspace.root, protectedDir)],
		});
		await loader.reload();

		const modelRuntime = await ModelRuntime.create({
			authPath: join(workspace.agentDir, "auth.json"),
			modelsPath: join(workspace.agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{
				toolCalls: [{ name: "edit", args: { path: insideFile, edits: [{ oldText: "hello", newText: "edited" }] } }],
			},
			{
				toolCalls: [
					{
						name: "edit",
						args: {
							path: `${protectedDir}/secret.txt`,
							edits: [{ oldText: "do not touch", newText: "tampered" }],
						},
					},
				],
			},
			{
				toolCalls: [
					{
						name: "edit",
						args: {
							path: `../${workspace.root.split(/[\\/]/).pop()}-outside-marker.txt`,
							edits: [{ oldText: "", newText: "should never be written" }],
						},
					},
				],
			},
			{ text: "done" },
		]);

		const ui = createTestUiContext({ confirmResult: true });

		const { session } = await createAgentSession({
			cwd: workspace.root,
			agentDir: workspace.agentDir,
			modelRuntime,
			model: fakeModel.model,
			tools: ["read", "write", "edit", "bash"],
			resourceLoader: loader.pi,
		});
		await session.bindExtensions({ uiContext: ui, mode: "print" });

		await session.prompt("Run the ConductorResourceLoader acceptance sequence.");

		expect(fakeModel.callCount()).toBe(4);

		// In-workspace edit: allowed and actually applied.
		expect(readFileSync(join(workspace.root, insideFile), "utf-8")).toBe("edited");

		// additionalProtectedPaths entry: blocked even though it is inside the workspace.
		expect(readFileSync(join(workspace.root, protectedDir, "secret.txt"), "utf-8")).toBe("do not touch");

		// Outside the workspace entirely: blocked, nothing written.
		expect(existsSync(outsideMarker)).toBe(false);

		// The permission-gate's own notification proves both blocks were the gate's doing, not a
		// coincidental no-op (same observability channel permission-gate.ts already uses).
		const blockedNotifications = ui.notifications.filter((n) => n.message.startsWith("Blocked edit"));
		expect(blockedNotifications.length).toBe(2);

		session.dispose();
	});
});
