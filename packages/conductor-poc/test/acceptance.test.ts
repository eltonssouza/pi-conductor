/**
 * Fase-0 walking skeleton — outer acceptance test (Gate 5, outside-in).
 *
 * Drives the whole vertical slice end-to-end exactly as scoped by
 * plano_desenvolvimento.md §8 / docs/conductor/gate1-discovery.md §1.4 (H1's falsifiability
 * criterion) / docs/conductor/gate3-threat-model.md §2 (the six trust-boundary crossings):
 *   1. Open an agent session over a scratch workspace (never the real repo).
 *   2. Call a model (here: the scripted fake provider — see live-model.acceptance.test.ts for
 *      the one real DEEPSEEK_API_KEY call; grounded below).
 *   3. Read a file inside the workspace via the built-in `read` tool.
 *   4. Edit a file THROUGH the permission-gate extension: one edit inside the workspace is
 *      approved and applied; one edit attempting to escape the workspace is blocked, with the
 *      block reason surfaced.
 *   5. Run a trivial, side-effect-free command via the gated `bash` tool.
 *   6. Persist the session (JSONL) and resume it with a brand-new AgentSession handle backed only
 *      by the file on disk, proving the resumed session sees the prior turns/tool results.
 *
 * Grounding for splitting the model-call boundary (mock for this test, one real call elsewhere):
 * Outside-In Development — Complete Professional Guide §1.12 ("the walking skeleton earns its
 * cost where ... the thinnest real behaviour can be exercised end to end in seconds") and §1.9
 * ("use the outer test to define 'done'"): a live network call to a third-party LLM is neither
 * fast nor deterministic, which is exactly what the outer acceptance test must be to serve as
 * "done" for every other run of this suite (task instructions explicitly allow this split when
 * full live wiring is disproportionate; the library's corpus does not have a passage specific to
 * "mocking third-party API boundaries in CI", so this citation is applied by the same
 * fast/deterministic-skeleton principle, not forced beyond what §1.9/§1.12 say).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
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

it("opens a session, reads, edits with approval (approved + blocked), runs bash, persists and resumes", async () => {
	// --- Fixtures inside the workspace -------------------------------------------------------
	const targetFile = "hello.txt";
	writeFileSync(join(workspace.root, targetFile), "hello conductor", "utf-8");

	// A sibling location clearly outside the workspace root — the escape target.
	const outsideMarker = join(workspace.root, "..", `${workspace.root.split(/[\\/]/).pop()}-outside-marker.txt`);

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});

	const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
		// 1. read the fixture file
		{ toolCalls: [{ name: "read", args: { path: targetFile } }] },
		// 2. edit inside the workspace — should be APPROVED and applied
		{
			toolCalls: [
				{
					name: "edit",
					args: { path: targetFile, edits: [{ oldText: "hello conductor", newText: "hello from Fase 0" }] },
				},
			],
		},
		// 3. edit attempting to escape the workspace — should be BLOCKED
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
		// 4. a trivial, side-effect-free bash command — gated
		{ toolCalls: [{ name: "bash", args: { command: 'node -e "process.exit(0)"' } }] },
		// 5. done
		{ text: "walking skeleton complete" },
	]);

	const decisions: Array<{ toolName: string; allowed: boolean; reason?: string }> = [];
	const ui = createTestUiContext({ confirmResult: true });

	const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions"));

	const conductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: fakeModel.model,
		modelRuntime,
		sessionManager,
		agentDir: workspace.agentDir,
		onDecision: (decision) => decisions.push(decision),
	});

	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });

	// Step 1+2: session open + (fake) model call happen as part of prompt().
	const result = await conductorSession.session.prompt("Run the Fase 0 walking-skeleton sequence.");
	expect(result).toBeDefined();

	// The fake model produced 5 turns — proves the multi-turn tool-calling loop actually ran.
	expect(fakeModel.callCount()).toBe(5);

	// Step 3: read succeeded (no approval needed, just workspace containment).
	const readDecision = decisions.find((d) => d.toolName === "read");
	expect(readDecision?.allowed).toBe(true);

	// Step 4a: the in-workspace edit was approved AND actually applied to disk.
	const approvedEditDecision = decisions.filter((d) => d.toolName === "edit")[0];
	expect(approvedEditDecision?.allowed).toBe(true);
	expect(readFileSync(join(workspace.root, targetFile), "utf-8")).toBe("hello from Fase 0");

	// Step 4b: the escape attempt was blocked, with the reason surfaced, and nothing was written
	// outside the workspace.
	const blockedEditDecision = decisions.filter((d) => d.toolName === "edit")[1];
	expect(blockedEditDecision?.allowed).toBe(false);
	expect(blockedEditDecision?.reason).toBeTruthy();
	expect(existsSync(outsideMarker)).toBe(false);

	// Step 5: bash ran through the gate too (approval required + granted).
	const bashDecision = decisions.find((d) => d.toolName === "bash");
	expect(bashDecision?.allowed).toBe(true);
	expect(ui.confirmCalls.length).toBeGreaterThanOrEqual(2); // approved edit + bash

	const sessionFile = conductorSession.session.sessionFile;
	expect(sessionFile).toBeTruthy();
	conductorSession.dispose();

	// Step 6: resume with a brand-new AgentSession handle backed only by the JSONL file on disk —
	// a fresh ModelRuntime, fresh SessionManager.open(), fresh permission-gate instance. Proves
	// the resumed session reconstructs prior turns/tool results, not just that a file exists.
	const resumedModelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: join(workspace.agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const resumedModel = registerFakeModel(resumedModelRuntime, "conductor-fake", [{ text: "unused" }]);
	const resumedSessionManager = SessionManager.open(sessionFile as string);

	const resumedConductorSession = await createConductorSession({
		workspaceRoot: workspace.root,
		model: resumedModel.model,
		modelRuntime: resumedModelRuntime,
		sessionManager: resumedSessionManager,
		agentDir: workspace.agentDir,
	});

	const resumedEntries = resumedSessionManager.getEntries();
	const resumedText = JSON.stringify(resumedEntries);
	// The prior tool result (approved edit's new content) must be visible in the resumed
	// session's own entries — reconstructed from disk, not carried over in memory.
	expect(resumedText).toContain("hello from Fase 0");
	expect(resumedText).toContain("walking skeleton complete");

	resumedConductorSession.dispose();
});
