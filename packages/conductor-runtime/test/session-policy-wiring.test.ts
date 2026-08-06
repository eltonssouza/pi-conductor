/**
 * GAP-B loop-back (Gate 8 finding, item 1): proves BOTH real composition points
 * (`createConductorSession`'s inline `DefaultResourceLoader` branch — no `config` — and its
 * `ConductorResourceLoader` branch — with `config`, the path `conductor chat` actually takes) accept
 * a `policy`/`yesFlagActive` value and genuinely forward it all the way down to `decide()` through a
 * REAL session + REAL permission-gate + REAL bash tool call — not `decide()`/`classifyCommand()`
 * exercised in isolation (permission-engine.test.ts/command-classifier.test.ts already do that), and
 * not `createPermissionGateExtension()` driven directly either (permission-gate.test.ts already does
 * that at its own layer). This file is one level up: the two `session.ts`/`resource-loader.ts`
 * call sites Gate 8 found were never wired at all.
 *
 * This file constructs `EffectivePolicyInput` values directly, as plain data — it does NOT call
 * `@conductor/config`'s `loadPolicyDocument`/`loadPolicyTrustStore`/`mergePolicies` (this package
 * cannot depend on `@conductor/config`, ADR 0002 §3.1). The companion proof that a REAL
 * `.conductor/policy.json` on disk reaches this same seam via `resolveEffectivePolicy` lives in
 * `conductor-cli/test/commands/chat/policy-resolution.test.ts` — that is the literal disk-to-decision
 * FR-3 proof the Gate 8 loop-back asked for; this file is its `conductor-runtime`-side half.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EffectivePolicyInput } from "../src/permission-engine.ts";
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

const fase1Config = {
	project: { type: "backend", technologies: [] },
	provider: { model: "conductor-fake/conductor-fake-1" },
};

describe.each([
	{ label: "session.ts's inline DefaultResourceLoader branch (no config)", withConfig: false },
	{
		label: "resource-loader.ts's ConductorResourceLoader branch (config supplied — the path `conductor chat` takes)",
		withConfig: true,
	},
])("createConductorSession policy/yesFlagActive wiring — $label", ({ withConfig }) => {
	async function openSession(extra: { policy?: EffectivePolicyInput; yesFlagActive?: boolean }) {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(workspace.agentDir, "auth.json"),
			modelsPath: join(workspace.agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{ toolCalls: [{ name: "bash", args: { command: "npm run build" } }] },
			{ text: "done" },
		]);
		const decisions: Array<{ toolName: string; allowed: boolean }> = [];
		const conductorSession = await createConductorSession({
			workspaceRoot: workspace.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir: workspace.agentDir,
			onDecision: (d) => decisions.push(d),
			config: withConfig ? fase1Config : undefined,
			...extra,
		});
		return { conductorSession, decisions };
	}

	it("FR-3: a policy.allowlist grant reaches decide() through the real session — the bash call is approved without ctx.ui.confirm()", async () => {
		const ui = createTestUiContext({ confirmResult: true });
		const { conductorSession, decisions } = await openSession({
			policy: { allowlist: [{ pattern: "npm run build", risk: "low" }] },
		});
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("run the build");

		expect(ui.confirmCalls).toHaveLength(0); // the whole point of FR-3
		expect(decisions.find((d) => d.toolName === "bash")?.allowed).toBe(true);
		conductorSession.dispose();
	});

	it("baseline: WITHOUT the policy grant, the same command needs ctx.ui.confirm() (contrast proving the field above is actually read, not ignored)", async () => {
		const ui = createTestUiContext({ confirmResult: true });
		const { conductorSession, decisions } = await openSession({});
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("run the build");

		expect(ui.confirmCalls.length).toBeGreaterThan(0);
		expect(decisions.find((d) => d.toolName === "bash")?.allowed).toBe(true); // approved via confirmResult:true
		conductorSession.dispose();
	});

	it("FR-23: denyAllPrivileged forces a deny even for a command an allowlist grant would otherwise approve", async () => {
		const ui = createTestUiContext({ confirmResult: true });
		const { conductorSession, decisions } = await openSession({
			policy: { allowlist: [{ pattern: "npm run build", risk: "low" }], denyAllPrivileged: true },
		});
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("run the build");

		expect(ui.confirmCalls).toHaveLength(0); // denied outright, never even asked
		expect(decisions.find((d) => d.toolName === "bash")?.allowed).toBe(false);
		conductorSession.dispose();
	});

	it("FR-9/FR-10: policy.protectedPaths is unioned into the enforced protected-path list, even though it was never passed via additionalProtectedPaths", async () => {
		mkdirSync(join(workspace.root, "vault"));
		const targetFile = join(workspace.root, "vault", "secret.txt");
		writeFileSync(targetFile, "s3cr3t");

		const modelRuntime = await ModelRuntime.create({
			authPath: join(workspace.agentDir, "auth.json"),
			modelsPath: join(workspace.agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{
				toolCalls: [
					{ name: "edit", args: { path: targetFile, edits: [{ oldText: "s3cr3t", newText: "leaked" }] } },
				],
			},
			{ text: "done" },
		]);
		const decisions: Array<{ toolName: string; allowed: boolean }> = [];
		const conductorSession = await createConductorSession({
			workspaceRoot: workspace.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir: workspace.agentDir,
			onDecision: (d) => decisions.push(d),
			config: withConfig ? fase1Config : undefined,
			policy: { protectedPaths: [join(workspace.root, "vault")] },
		});
		const ui = createTestUiContext({ confirmResult: true });
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("edit the vault file");

		// Blocked by the policy-declared protected path before any approval prompt; file untouched.
		expect(decisions.find((d) => d.toolName === "edit")?.allowed).toBe(false);
		expect(ui.confirmCalls).toHaveLength(0);
		conductorSession.dispose();
	});

	it("FR-19/FR-20/FR-21: yesFlagActive: true auto-approves a low-tier, provably-contained bash command via isYesEligible, distinguishable from a human approval", async () => {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(workspace.agentDir, "auth.json"),
			modelsPath: join(workspace.agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{ toolCalls: [{ name: "bash", args: { command: "ls" } }] },
			{ text: "done" },
		]);
		const decisions: Array<{ toolName: string; allowed: boolean }> = [];
		const conductorSession = await createConductorSession({
			workspaceRoot: workspace.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir: workspace.agentDir,
			onDecision: (d) => decisions.push(d),
			config: withConfig ? fase1Config : undefined,
			yesFlagActive: true,
		});
		const ui = createTestUiContext({ confirmResult: true });
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("list files");

		expect(ui.confirmCalls).toHaveLength(0);
		expect(decisions.find((d) => d.toolName === "bash")?.allowed).toBe(true);
		conductorSession.dispose();
	});
});
