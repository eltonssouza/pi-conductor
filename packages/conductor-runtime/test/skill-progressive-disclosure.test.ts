/**
 * G3 / FR-5 / FR-6 (gate2-spec-fase3.md, Grupo C — Progressive disclosure) — Gate 8 loop-back.
 *
 * Gate 8 (real-CLI validation) found that `session.ts`/`resource-loader.ts` had `noSkills: true`
 * hardcoded with ZERO `additionalSkillPaths` on every code path, so no real `conductor chat` session
 * ever had a single one of the 44 ported skills available — despite `conductor skills list`
 * cataloging them correctly (catalog-only, never wired to a live session) and despite the Pi
 * framework ALREADY solving progressive disclosure natively
 * (`packages/coding-agent/src/core/skills.ts`'s `formatSkillsForPrompt`: injects only
 * name+description+`<location>`, instructs the model to use `read` for the body —
 * `skill-containment.ts`'s own header already documents this finding). The fix is NOT a new
 * disclosure mechanism — it is pointing `additionalSkillPaths` (a `DefaultResourceLoaderOptions`
 * field Pi's own resource-loader always merges in regardless of `noSkills`, confirmed by reading
 * `packages/coding-agent/src/core/resource-loader.ts`'s `reload()`: `noSkills` only suppresses
 * ambient/auto-discovered resources, never an explicit, caller-supplied path list) at a real
 * directory.
 *
 * This test proves the two GWTs literally, through a REAL `createConductorSession` (not a unit
 * test of the formatter in isolation, which already exists upstream in Pi's own test suite) —
 * Outside-In Development's own "the acceptance test of the external loop proves wiring the internal
 * loop alone doesn't" (the exact grounding this phase's Gate 8 journal entry already cites for why
 * FR-2 and FR-5/FR-6 both slipped through isolated unit tests before).
 *
 *   FR-5: the assembled system prompt that reaches the model contains, for the fixture skill, only
 *         name + description + `<location>` — never a string that only exists in the skill's body.
 *   FR-6: the skill's body enters the conversation ONLY as the result of a `read` tool call, and
 *         even after that call, a LATER turn's system prompt still does not contain the body (never
 *         reinjected).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConductorSession } from "../src/session.ts";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import { registerFakeModel } from "./support/fake-model.ts";
import { createTestUiContext } from "./support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

interface CapturedToolEvent {
	toolName: string;
	result: unknown;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 20_000, intervalMs = 10): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitUntil: condition never became true");
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

const SKILL_DESCRIPTION = "Use when creating or modifying a service or API for the progressive-disclosure fixture.";
const SKILL_BODY_MARKER = "STEP-MARKER-77321: this exact procedure text must never leak into the system prompt.";

let workspace: ScratchWorkspace;
let skillsRootDir: string;
let skillFilePath: string;

beforeEach(() => {
	workspace = createScratchWorkspace();
	skillsRootDir = join(workspace.root, "fixture-skills");
	const skillDir = join(skillsRootDir, "design-service");
	mkdirSync(skillDir, { recursive: true });
	skillFilePath = join(skillDir, "SKILL.md");
	writeFileSync(
		skillFilePath,
		[
			"---",
			"name: design-service",
			`description: ${SKILL_DESCRIPTION}`,
			"---",
			"",
			"# Design Service",
			"",
			SKILL_BODY_MARKER,
		].join("\n"),
		"utf-8",
	);
});

afterEach(() => {
	workspace.cleanup();
});

it(
	"FR-5: a real session's system prompt carries only the skill's name+description+location, never its body",
	async () => {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(workspace.agentDir, "auth.json"),
			modelsPath: join(workspace.agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [{ text: "no tool needed yet" }]);

		const conductorSession = await createConductorSession({
			workspaceRoot: workspace.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir: workspace.agentDir,
			additionalSkillPaths: [skillsRootDir],
		});
		await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
		await conductorSession.session.prompt("hi");

		const prompt = fakeModel.lastSystemPrompt();
		expect(prompt).toBeTruthy();
		expect(prompt).toContain("design-service");
		expect(prompt).toContain(SKILL_DESCRIPTION);
		expect(prompt).toContain(skillFilePath);
		// The body is present ONLY in the SKILL.md file on disk, never inlined into the prompt itself.
		expect(prompt).not.toContain(SKILL_BODY_MARKER);

		conductorSession.dispose();
	},
	20_000,
);

it(
	"FR-6: the skill body reaches the conversation only via a real `read` tool result, and is still " +
		"absent from a later turn's system prompt (never reinjected)",
	async () => {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(workspace.agentDir, "auth.json"),
			modelsPath: join(workspace.agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{ toolCalls: [{ name: "read", args: { path: skillFilePath } }] },
			{ text: "done" },
		]);

		const conductorSession = await createConductorSession({
			workspaceRoot: workspace.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir: workspace.agentDir,
			additionalSkillPaths: [skillsRootDir],
		});

		const events: CapturedToolEvent[] = [];
		conductorSession.session.subscribe((event) => {
			if (event.type === "tool_execution_end") events.push({ toolName: event.toolName, result: event.result });
		});

		await conductorSession.session.bindExtensions({ uiContext: createTestUiContext(), mode: "print" });
		await conductorSession.session.prompt("Follow the design-service skill.");
		await waitUntil(() => events.some((e) => e.toolName === "read"));

		const readEvent = events.find((e) => e.toolName === "read");
		expect(readEvent).toBeDefined();
		// The body arrives as the READ TOOL'S OWN result -- a tool-result channel, not the system prompt.
		expect(JSON.stringify(readEvent!.result)).toContain(SKILL_BODY_MARKER);

		// The turn AFTER the read tool call still gets a system prompt with no reinjected body -- the
		// guarantee holds across the whole conversation, not just before the first tool call.
		const promptAfterRead = fakeModel.lastSystemPrompt();
		expect(promptAfterRead).not.toContain(SKILL_BODY_MARKER);
		expect(promptAfterRead).toContain("design-service");

		expect(fakeModel.callCount()).toBe(2);
		conductorSession.dispose();
	},
	20_000,
);
