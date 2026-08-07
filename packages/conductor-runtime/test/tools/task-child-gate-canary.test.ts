/**
 * R13/T30 "guard-canário bloqueante" (gate3-addendum-fase3.md §4 R13, §9.3 (f); ADR 0004 §2.2/§13
 * risk R5) -- the ONE piece of R13/T30/T41 coverage this Fase's quality-baseline review found
 * missing: an executable, re-runnable proof that a REAL destructive tool call made BY a delegation
 * child is denied/classified IDENTICAL to how the exact same call is denied at the top level, not
 * merely "the same objects reach the collaborator" (task.test.ts's own BR-7 describe block, which
 * proves reference-equality of the wiring, not that the wiring actually fires on a real call).
 *
 * WHY THIS DRIVES `createPermissionGateExtension` DIRECTLY, NOT A REAL SPAWNED CHILD SESSION: an
 * earlier version of this test drove a full, real `createGovernedChildSessionSpawner()` round trip
 * (matching chat/task-delegation.test.ts's own end-to-end pattern) and discovered a SEPARATE,
 * genuine finding in the process -- `tools/task.ts`'s own deliberate choice to omit `model` from the
 * child's `createAgentSession` call (its header: "Pi's own `findInitialModel` resolves it from
 * settings") means Pi's `findInitialModel` (model-resolver.js, priority step 4: "first available
 * model with valid API key") can silently select a REAL, live provider auto-discovered from ANY
 * provider API-key environment variable present in the process (`@earendil-works/pi-ai`'s
 * `env-api-keys.js`), completely independent of the scratch `authPath`/`modelsPath` this function
 * scopes itself to -- confirmed directly in this dev environment (a `DEEPSEEK_API_KEY` happened to be
 * set), which made a REAL network call to a live model instead of exercising the test's own mocked
 * `ModelRuntime.create`. `allowModelNetwork: false` does NOT prevent this. This is now flagged
 * separately as its own quality-baseline finding (a test-hermeticity / production-determinism gap,
 * not an R13 concern) rather than folded into this file -- see this Fase's own Gate 6 checkpoint
 * journal entry. Driving the REAL permission-gate extension directly, with a synthetic `ToolCallEvent`
 * (exactly `permission-gate.task.test.ts`'s own `captureToolCallHandler`/`fakeContext` pattern),
 * proves the R13 claim this file is actually about -- the CHILD'S GATE WIRING denies a destructive
 * call -- with zero dependency on model resolution, zero network risk, and zero flakiness.
 *
 * Mechanism under test (task.ts's own header, `createGovernedChildSessionSpawner`): the child session
 * NEVER has `bindExtensions({ uiContext, ... })` called on it, so Pi's own `hasUI()` (runner.js:
 * `uiContext !== noOpUIContext`) is `false` for every tool call the child makes -- `confirm.ts`'s
 * `confirmOrDeny` denies unconditionally when `!ctx.hasUI`. This test constructs the gate with
 * EXACTLY the extension factory `createGovernedChildSessionSpawner` calls
 * (`createPermissionGateExtension`, same option shape) and drives a REAL "bash" `ToolCallEvent`
 * through it with `hasUI: false` -- proving the gate a delegation child actually runs under produces
 * the identical deny/classify/audit outcome `permission-gate.task.test.ts`'s own "denies when there
 * is no UI to ask" test already proves for the top-level session's gate.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	CustomToolCallEvent,
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AuditEntry } from "../../src/audit-trail.ts";
import { createAuditTrailWriter } from "../../src/audit-trail.ts";
import { createPermissionGateExtension } from "../../src/permission-gate.ts";
import { createTestUiContext } from "../support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "../support/workspace.ts";

type ToolCallHandler = (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | undefined>;

function captureToolCallHandler(factory: (pi: ExtensionAPI) => void): ToolCallHandler {
	let captured: ToolCallHandler | undefined;
	const fakePi = {
		on: (eventName: string, handler: ToolCallHandler) => {
			if (eventName === "tool_call") captured = handler;
		},
	};
	factory(fakePi as unknown as ExtensionAPI);
	if (!captured) throw new Error("factory did not register a tool_call handler");
	return captured;
}

function bashEvent(command: string): CustomToolCallEvent {
	return { type: "tool_call", toolCallId: "child-bash-1", toolName: "bash", input: { command } };
}

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

it("a destructive bash call is denied by the SAME extension construction createGovernedChildSessionSpawner uses for a delegation child's own gate, with hasUI:false (no UI ever bound to a child session) -- identical deny/reason/approvalMethod to the top-level 'no UI' case (permission-gate.task.test.ts)", async () => {
	const auditPath = join(workspace.root, ".conductor", "audit.jsonl");
	// R13/R14/T41: the SAME shared writer instance a delegation's parent gate audits to -- this is
	// exactly the `auditTrailWriter` option tools/task.ts's `createGovernedChildSessionSpawner`
	// passes through from `SpawnChildSessionInput.auditTrailWriter`, never a second, unlinked one.
	const auditTrailWriter = createAuditTrailWriter(auditPath);

	// The EXACT extension construction tools/task.ts's `createGovernedChildSessionSpawner` uses for
	// a governed child (see its own `resourceLoader`'s `extensionFactories` entry) -- same options
	// shape, same factory function, so this is not a parallel reimplementation of the gate.
	const extension = createPermissionGateExtension({
		workspaceRoot: workspace.root,
		additionalProtectedPaths: [],
		policy: {},
		yesFlagActive: false,
		auditTrailWriter,
	});
	const handler = captureToolCallHandler(extension.factory);

	// The defining structural fact this canary pins: a delegation child NEVER gets
	// `bindExtensions()` called on it (task.ts's own header) -- so its `ExtensionContext.hasUI` is
	// `false` for every tool call, exactly like this synthetic context, never a UI this test would
	// need to script an approval through. A `ui` object is still supplied (a real session always
	// has SOME ui reference internally) to prove the denial comes from the `!hasUI` short-circuit
	// in confirm.ts, not from `ui` being `undefined` and crashing.
	const ui = createTestUiContext({ confirmResult: true });
	const ctx = { ui, hasUI: false } as unknown as ExtensionContext;

	const result = await handler(bashEvent("npm run build"), ctx);

	expect(result?.block).toBe(true);
	// Never even asked -- confirmOrDeny's own `!ctx.hasUI` short-circuit returns `false` before
	// calling `ctx.ui.confirm()` at all (confirm.ts:30) -- proving this is the structural "no UI
	// bound" path, not a human denial.
	expect(ui.confirmCalls).toHaveLength(0);
	// Same discriminator permission-gate.task.test.ts's own "no UI" test uses: the reason text is
	// confirmOrDeny's fail-closed message, never the generic "no policy declared for tool" fallback
	// every UNMAPPED tool name gets -- proving `bash` was actually classified and routed to the
	// real approval branch, exactly as it would be outside a delegation.
	expect(result?.reason).toMatch(/not approved/);
	expect(result?.reason).not.toMatch(/no policy declared/);

	const entries = readFileSync(auditPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as AuditEntry);
	const bashEntry = entries.find((entry) => entry.toolName === "bash");
	expect(bashEntry).toBeDefined();
	expect(bashEntry?.decision).toBe("deny");
	expect(bashEntry?.approvalMethod).toBe("human");
	expect(bashEntry?.permissionLevel).toBe("exec");
	expect(bashEntry?.reason).toMatch(/not approved/);
});

it("the SAME child-gate construction denies a CRITICAL-tier command unconditionally, before any approval branch even runs -- proving classification itself (not only the approval step) is fully re-established for a delegation child", async () => {
	const auditPath = join(workspace.root, ".conductor", "audit.jsonl");
	const auditTrailWriter = createAuditTrailWriter(auditPath);
	const extension = createPermissionGateExtension({
		workspaceRoot: workspace.root,
		additionalProtectedPaths: [],
		policy: {},
		yesFlagActive: false,
		auditTrailWriter,
	});
	const handler = captureToolCallHandler(extension.factory);

	// hasUI: true this time -- a critical-tier command must be denied even when a human WOULD have
	// been available to approve, because command-classifier.ts's critical tier has no approval path
	// at all (permission-engine.ts denies it outright, before confirmOrDeny is ever reached).
	const ui = createTestUiContext({ confirmResult: true });
	const ctx = { ui, hasUI: true } as unknown as ExtensionContext;

	const result = await handler(bashEvent("rm -rf /"), ctx);

	expect(result?.block).toBe(true);
	expect(ui.confirmCalls).toHaveLength(0); // never even asked -- critical tier has no approval path

	const entries = readFileSync(auditPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as AuditEntry);
	const bashEntry = entries.find((entry) => entry.toolName === "bash");
	expect(bashEntry?.decision).toBe("deny");
	expect(bashEntry?.riskTier).toBe("critical");
	expect(bashEntry?.approvalMethod).toBe("none");
});
