/**
 * `commands/chat/policy-resolution.ts` — GAP-B loop-back (Gate 8 finding, item 1). Gate 8's dominant
 * finding: `loadPolicyDocument`/`loadPolicyTrustStore`/`mergePolicies` (`@conductor/config`) were
 * implemented and unit-tested since Gate 5, but NO production code path ever called them — a real
 * `.conductor/policy.json` on disk was 100% inert. This file is the disk-to-decision proof: a REAL
 * policy.json + REAL policy-trust.json on a scratch project's disk, loaded through
 * `resolveEffectivePolicy` (this module — the one place allowed to import both `@conductor/config`
 * and `@conductor/runtime`, per `policy-loader.ts`'s own header), fed into a REAL
 * `createConductorSession`, driving a REAL bash tool call through the REAL permission-gate.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PolicyDocument } from "@conductor/config";
import { createConductorSession } from "@conductor/runtime";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	resolveConductorPolicyPath,
	resolveConductorPolicyTrustStorePath,
	resolveEffectivePolicy,
} from "../../../src/commands/chat/policy-resolution.ts";
import { registerFakeModel } from "../../support/fake-model.ts";
import { createScratchProject, type ScratchProject } from "../../support/scratch.ts";

/**
 * A minimal, local `ExtensionUIContext` double -- this package has no shared "fake UI" test helper
 * of its own (conductor-runtime's own `test/support/test-ui.ts` is private to that package, per this
 * codebase's "each package keeps an independent copy on purpose" convention -- see scratch.ts's own
 * header). Implements only what the permission-gate actually calls (`confirm`/`notify`), same
 * partial-cast pattern conductor-runtime's test-ui.ts and this package's own
 * `tui-ui-context.ts` header already document and justify.
 */
function createFakeUiContext(confirmResult: boolean): ExtensionUIContext & { confirmCalls: unknown[] } {
	const confirmCalls: unknown[] = [];
	const partial = {
		confirmCalls,
		select: async () => undefined,
		confirm: async () => {
			confirmCalls.push({});
			return confirmResult;
		},
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
	};
	return partial as unknown as ExtensionUIContext & { confirmCalls: unknown[] };
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function writePolicyDocument(doc: PolicyDocument): string {
	const raw = JSON.stringify(doc);
	project.write(join(".conductor", "policy.json"), raw);
	return createHash("sha256").update(raw, "utf8").digest("hex");
}

function writeTrustStore(entries: Array<{ kind: "project" | "user-global"; contentHash: string }>): void {
	project.writeJson(join(".conductor", "policy-trust.json"), {
		schema: 1,
		trusted: entries.map((e) => ({ ...e, grantedAt: new Date().toISOString() })),
	});
}

describe("resolveEffectivePolicy (real filesystem, real loadPolicyDocument/loadPolicyTrustStore/mergePolicies)", () => {
	it("resolves an all-absent, safe-by-default policy when .conductor/policy.json does not exist at all (the common case)", () => {
		const policy = resolveEffectivePolicy(project.root);
		expect(policy).toEqual({ protectedPaths: [], allowlist: [], network: [], denyAllPrivileged: false });
	});

	it("FR-9/FR-10: a protectedPaths restriction is honored even with NO trust store entry at all (restrictions never require trust)", () => {
		writePolicyDocument({ schema: 1, protectedPaths: [join(project.root, "vault")] });
		const policy = resolveEffectivePolicy(project.root);
		expect(policy.protectedPaths).toContain(join(project.root, "vault"));
		expect(policy.denyAllPrivileged).toBe(false);
	});

	it("R3/R4: an allowlist grant is NOT honored without a matching, trusted contentHash in policy-trust.json (trust-on-first-use, fail closed by default)", () => {
		writePolicyDocument({ schema: 1, allowlist: [{ pattern: "npm run build", risk: "low" }] });
		// No policy-trust.json written at all.
		const policy = resolveEffectivePolicy(project.root);
		expect(policy.allowlist).toEqual([]);
	});

	it("R3/R4: an allowlist grant IS honored once its exact contentHash is trusted for the 'project' kind", () => {
		const contentHash = writePolicyDocument({ schema: 1, allowlist: [{ pattern: "npm run build", risk: "low" }] });
		writeTrustStore([{ kind: "project", contentHash }]);

		const policy = resolveEffectivePolicy(project.root);
		expect(policy.allowlist).toEqual([{ pattern: "npm run build", risk: "low" }]);
	});

	it("R3: a STALE trust entry (policy.json edited after being trusted) is NOT honored — a different contentHash never inherits the old grant", () => {
		const originalHash = writePolicyDocument({ schema: 1, allowlist: [{ pattern: "npm run build", risk: "low" }] });
		writeTrustStore([{ kind: "project", contentHash: originalHash }]);

		// Edit the policy after the fact -- the content, and therefore the hash, changes.
		writePolicyDocument({ schema: 1, allowlist: [{ pattern: "rm -rf /", risk: "low" }] });

		const policy = resolveEffectivePolicy(project.root);
		expect(policy.allowlist).toEqual([]); // the new content was never approved
	});

	it("FR-23/FR-24: a malformed policy.json sets denyAllPrivileged, distinct from an absent one", () => {
		project.write(join(".conductor", "policy.json"), "{ this is not valid json");
		const policy = resolveEffectivePolicy(project.root);
		expect(policy.denyAllPrivileged).toBe(true);
	});

	it("path helpers point at the exact filenames the rest of the codebase already expects (.conductor/policy.json, .conductor/policy-trust.json)", () => {
		expect(resolveConductorPolicyPath(project.root)).toBe(join(project.root, ".conductor", "policy.json"));
		expect(resolveConductorPolicyTrustStorePath(project.root)).toBe(
			join(project.root, ".conductor", "policy-trust.json"),
		);
	});
});

/**
 * The literal FR-3 proof the Gate 8 loop-back asked for: "an integration test that creates a real
 * .conductor/policy.json in a test project directory, calls createConductorSession for real, fires a
 * bash tool call that only the loaded policy would authorize, and confirms it passes without
 * ctx.ui.confirm() (end-to-end proof of FR-3)".
 */
describe("resolveEffectivePolicy wired into a real createConductorSession (FR-3 end-to-end)", () => {
	it("a real, on-disk, trusted policy.json allowlist grant reaches decide() and auto-approves the matching bash command — no ctx.ui.confirm()", async () => {
		const contentHash = writePolicyDocument({ schema: 1, allowlist: [{ pattern: "npm run build", risk: "low" }] });
		writeTrustStore([{ kind: "project", contentHash }]);

		const agentDir = join(project.root, ".conductor");
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{ toolCalls: [{ name: "bash", args: { command: "npm run build" } }] },
			{ text: "done" },
		]);

		const decisions: Array<{ toolName: string; allowed: boolean }> = [];
		const conductorSession = await createConductorSession({
			workspaceRoot: project.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir,
			onDecision: (d) => decisions.push(d),
			policy: resolveEffectivePolicy(project.root), // the ACTUAL disk-loading composition
		});
		const ui = createFakeUiContext(true);
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("run the build");

		expect(ui.confirmCalls).toHaveLength(0); // never asked a human -- the whole point of FR-3
		expect(decisions.find((d) => d.toolName === "bash")).toMatchObject({ toolName: "bash", allowed: true });

		conductorSession.dispose();
	});

	it("baseline contrast: WITHOUT resolveEffectivePolicy wired in at all, the identical on-disk grant is never consulted, so the same command needs approval", async () => {
		const contentHash = writePolicyDocument({ schema: 1, allowlist: [{ pattern: "npm run build", risk: "low" }] });
		writeTrustStore([{ kind: "project", contentHash }]);

		const agentDir = join(project.root, ".conductor");
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const fakeModel = registerFakeModel(modelRuntime, "conductor-fake", [
			{ toolCalls: [{ name: "bash", args: { command: "npm run build" } }] },
			{ text: "done" },
		]);

		const conductorSession = await createConductorSession({
			workspaceRoot: project.root,
			model: fakeModel.model,
			modelRuntime,
			agentDir,
			// policy: intentionally omitted -- this is the pre-loop-back state.
		});
		const ui = createFakeUiContext(true);
		await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
		await conductorSession.session.prompt("run the build");

		expect(ui.confirmCalls.length).toBeGreaterThan(0);
		conductorSession.dispose();
	});
});
