/**
 * `createConductorSession({ toolsOverride, systemPromptOverride })` -- the mechanism `conductor chat
 * --role <slug>` uses to hold a role to its own declared tools/persona (Fase 3, ADR 0004 §16
 * appendix's `ConductorRole.tools`/`systemPrompt`; session.ts's own doc comments for these two
 * options). Exercised here directly against the raw options, independent of any real or synthetic
 * `ChatRole` value.
 *
 * Gate 6 real-wiring loop-back context: `@conductor/cli`'s own `chat.test.ts` used to prove this same
 * live-session mechanism through two of `role-resolution.ts`'s placeholder catalog's roles. That
 * catalog has since been replaced with the REAL, file-backed 37-role catalog, which surfaced Gap 2
 * (the orchestrator's finding): no built-in role declares a non-empty `tools` list yet, so
 * `chat.ts`'s own `--role` path now refuses before it can ever reach this mechanism with real data
 * (see `chat.ts`'s `prepareChat`). This file keeps the MECHANISM ITSELF under test at the layer where
 * it actually lives (`session.ts`), independent of whether any real role data exists yet -- the same
 * split `session-config.test.ts` already established for the `config` option.
 */

import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
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

it("toolsOverride restricts the session's tools -- a call outside that list never even reaches the permission-gate as a decision", async () => {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		{ toolCalls: [{ name: "write", args: { path: "should-never-be-created.txt", content: "x" } }] },
		{ text: "turn-completed-after-restricted-tool-call" },
	]);

	const decisions: Array<{ toolName: string; allowed: boolean }> = [];

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir: workspace.agentDir,
		onDecision: (decision) => decisions.push(decision),
		toolsOverride: ["read"],
	});
	await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
	await conductorSession.session.prompt("try to write a file");

	// "write" never even reached the permission-gate as a decision -- the same, stronger proof
	// task-registration.acceptance.test.ts's own second test uses for "not reachable": Pi's SDK never
	// dispatches a tool_call event for a name absent from the session's own tools allowlist.
	expect(decisions.find((d) => d.toolName === "write")).toBeUndefined();
	// The turn still completes -- restriction degrades the tool call gracefully, it does not hang or
	// crash the session.
	expect(fakeModel.callCount()).toBe(2);

	conductorSession.dispose();
});

it("systemPromptOverride replaces the session's system prompt outright, reaching the live model call", async () => {
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
		// config is ALSO supplied, deliberately -- proves the override REPLACES the Fase 1
		// config-derived prompt (precedence), not merely that no config was given.
		config: {
			project: { type: "backend", technologies: ["Node/TypeScript"] },
			provider: { model: "conductor-fake/conductor-fake-1" },
		},
		systemPromptOverride: "You are a fixture role persona.",
	});
	await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
	await conductorSession.session.prompt("hi");

	expect(fakeModel.lastSystemPrompt()).toContain("You are a fixture role persona.");
	// Never the Fase 1 config-derived prompt's own fingerprint text (resource-loader.ts's
	// buildFase1SystemPrompt) -- proves the override REPLACED it, not merely prepended.
	expect(fakeModel.lastSystemPrompt()).not.toContain("Detected technologies");

	conductorSession.dispose();
});
