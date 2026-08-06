/**
 * `createConductorSession({ config })` — round B2 (`conductor chat`) wiring, Gate 5 (red first).
 *
 * ADR 0002 §3.2/§4 named this exact extension point and round B1's resource-loader.ts header
 * comment flagged it explicitly as round B2's job rather than building it speculatively (Outside-In
 * Development — Complete Professional Guide §3.3, "needs become roles become interfaces": the caller
 * that needs a collaborator is what should shape it). This file proves three things a `conductor
 * chat` caller depends on:
 *   1. Without `config`, behavior is byte-for-byte unchanged from round A/B1 (no custom prompt) —
 *      a regression guard for the 78 tests that already depended on the old, unconditional inline
 *      DefaultResourceLoader construction.
 *   2. With `config`, the Fase 1 system prompt actually reaches the model (not just the
 *      resourceLoader in isolation — resource-loader.test.ts already covers that layer; this proves
 *      the wiring through createConductorSession end to end).
 *   3. With `config`, `onDecision` (observability) still fires — the config path builds its own
 *      internal permission-gate extension (ConductorResourceLoader can't share the instance the
 *      inline branch would have built), so this is the concrete regression this file exists to catch
 *      if that threading were ever dropped.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildFase1SystemPrompt, type Fase1ProjectConfig } from "../src/resource-loader.ts";
import { createConductorSession } from "../src/session.ts";
import { registerFakeModel } from "./support/fake-model.ts";
import { createTestUiContext } from "./support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

it("without config: the model receives Pi's own default system prompt, not the Fase 1 one (round A/B1 behavior unchanged)", async () => {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [{ text: "ok" }]);

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir: workspace.agentDir,
	});
	await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
	await conductorSession.session.prompt("hi");

	// Pi's own generic default prompt (DefaultResourceLoader with no systemPromptOverride) — proves
	// the `config`-driven branch (ConductorResourceLoader) was NOT taken when config is omitted.
	expect(fakeModel.lastSystemPrompt()).toBeTruthy();
	expect(fakeModel.lastSystemPrompt()).not.toContain("You are Conductor,");
	conductorSession.dispose();
});

it("with config: the Fase 1 system prompt built from config reaches the model", async () => {
	const config: Fase1ProjectConfig = {
		project: { type: "backend", technologies: ["Node/TypeScript"] },
		provider: { model: "conductor-fake/conductor-fake-1" },
	};

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [{ text: "ok" }]);

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir: workspace.agentDir,
		config,
	});
	await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
	await conductorSession.session.prompt("hi");

	// The session's own context-building appends a "Current working directory" line after the
	// resourceLoader's system prompt (verified by this failure before this fix), so this asserts
	// containment, not full equality -- resource-loader.test.ts already covers
	// buildFase1SystemPrompt's exact text and ConductorResourceLoader's getSystemPrompt() in
	// isolation; this test's job is proving the wiring reaches the live model call, nothing more.
	expect(fakeModel.lastSystemPrompt()).toContain(buildFase1SystemPrompt(config));
	conductorSession.dispose();
});

it("with config: onDecision (observability) still fires -- the config path's own internal permission-gate is not silently unobserved", async () => {
	const targetFile = "hello.txt";
	writeFileSync(join(workspace.root, targetFile), "hello", "utf-8");

	const config: Fase1ProjectConfig = {
		project: { type: "backend", technologies: [] },
		provider: { model: "conductor-fake/conductor-fake-1" },
	};

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "read", args: { path: targetFile } }] },
		{ text: "done" },
	]);

	const decisions: Array<{ toolName: string; allowed: boolean }> = [];

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir: workspace.agentDir,
		config,
		onDecision: (decision) => decisions.push(decision),
	});
	await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
	await conductorSession.session.prompt("read the file");

	expect(decisions.find((d) => d.toolName === "read")?.allowed).toBe(true);
	conductorSession.dispose();
});

it("with config: additionalProtectedPaths is still enforced through the config-driven permission-gate (T13)", async () => {
	const protectedFile = join(workspace.root, "config.json");
	writeFileSync(protectedFile, JSON.stringify({ schema: 1 }), "utf-8");

	const config: Fase1ProjectConfig = {
		project: { type: "backend", technologies: [] },
		provider: { model: "conductor-fake/conductor-fake-1" },
	};

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "edit", args: { path: "config.json", edits: [{ oldText: "1", newText: "2" }] } }] },
		{ text: "done" },
	]);

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir: workspace.agentDir,
		config,
		additionalProtectedPaths: [protectedFile],
	});
	await conductorSession.session.bindExtensions({
		uiContext: createTestUiContext({ confirmResult: true }),
		mode: "print",
	});
	await conductorSession.session.prompt("edit config.json");

	// Blocked by workspace-policy before any approval prompt — the file is untouched.
	expect(readFileSync(protectedFile, "utf-8")).toBe(JSON.stringify({ schema: 1 }));
	conductorSession.dispose();
});
