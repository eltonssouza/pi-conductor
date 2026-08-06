/**
 * Test-first (Gate 5) for FR-9 / R17a (ADR 0004 §2.3 correction #2; gate3-addendum-fase3.md T31):
 * "decideToolCall precisa de um branch `task` (paralelo a write/edit/conductor_note): valida os
 * params, então confirmOrDeny com uma mensagem que superfície o papel-alvo e a autoridade que ele
 * alcança ... a aprovação de task é a aprovação de tudo que ele pode rodar, então a aprovação tem
 * que mostrar isso, senão é aprovação-teatro."
 *
 * Drives the REAL, already-shipped `createPermissionGateExtension` (src/permission-gate.ts) exactly
 * the way test/permission-gate.test.ts already does for every other tool -- this file only adds the
 * "task" case, deliberately in a separate file so it never collides with a parallel stream editing
 * that shared test file. Today `permission-gate.ts` has no "task" branch, so a `task` call falls
 * through to the generic "no policy declared for tool ... -- fail closed" default deny, which never
 * calls `ctx.ui.confirm()` at all -- these tests fail RED for that reason.
 */

import type {
	CustomToolCallEvent,
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPermissionGateExtension } from "../src/permission-gate.ts";
import { createTestUiContext, type TestUiContext } from "./support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

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

function fakeContext(ui: TestUiContext, hasUI: boolean): ExtensionContext {
	return { ui, hasUI } as unknown as ExtensionContext;
}

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function taskEvent(role: string, prompt = "do the thing"): CustomToolCallEvent {
	return {
		type: "tool_call",
		toolCallId: "task-1",
		toolName: "task",
		input: { role, prompt },
	};
}

describe("permission-gate: task (FR-9/R17a, ADR 0004 §2.3 correction #2)", () => {
	it("requires human approval, surfacing the TARGET ROLE in the approval message -- not the generic no-policy-declared fail-closed default", async () => {
		const extension = createPermissionGateExtension({ workspaceRoot: workspace.root });
		const handler = captureToolCallHandler(extension.factory);
		const ui = createTestUiContext({ confirmResult: true });

		const result = await handler(taskEvent("software-engineer"), fakeContext(ui, true));

		expect(result).toBeUndefined(); // approved
		expect(ui.confirmCalls).toHaveLength(1);
		// R17a: "a aprovação de task ... superfície o papel-alvo e a autoridade que ele alcança" -- the
		// approval prompt must name the specific role being delegated to, not a generic "Approve task?".
		expect(ui.confirmCalls[0]?.message ?? ui.confirmCalls[0]?.title).toContain("software-engineer");
	});

	it("denies (fail closed) when the user does not approve the delegation -- and the denial comes from a real confirm() call, not the generic no-policy-declared fallback every unmapped tool already gets", async () => {
		const extension = createPermissionGateExtension({ workspaceRoot: workspace.root });
		const handler = captureToolCallHandler(extension.factory);
		const ui = createTestUiContext({ confirmResult: false });

		const result = await handler(taskEvent("software-engineer"), fakeContext(ui, true));

		expect(result?.block).toBe(true);
		// Discriminator against the pre-existing catch-all default-deny branch (which denies WITHOUT
		// ever calling ctx.ui.confirm() at all, regardless of confirmResult) -- a real task branch
		// must actually ask, and the denial reason must reflect a real "not approved", not the
		// generic "no policy declared for tool ... -- fail closed" text.
		expect(ui.confirmCalls).toHaveLength(1);
		expect(result?.reason).toMatch(/not approved/);
		expect(result?.reason).not.toMatch(/no policy declared/);
	});

	it("denies when there is no UI to ask -- same fail-closed discipline as bash/write/edit, with a task-specific denial reason (not the generic no-policy-declared fallback)", async () => {
		const extension = createPermissionGateExtension({ workspaceRoot: workspace.root });
		const handler = captureToolCallHandler(extension.factory);
		const ui = createTestUiContext({ confirmResult: true });

		const result = await handler(taskEvent("software-engineer"), fakeContext(ui, false));

		expect(result?.block).toBe(true);
		expect(ui.confirmCalls).toHaveLength(0);
		// The generic default-deny branch ALSO produces block:true with zero confirm calls for any
		// unmapped tool name, with or without a UI -- so those two assertions alone cannot tell "no
		// task branch exists yet" apart from "a real task branch correctly fails closed with no UI".
		// The reason text is the discriminator: confirmOrDeny's own no-UI path reads "not approved
		// (denied, or approval timed out -- fail closed)", distinct from "no policy declared".
		expect(result?.reason).toMatch(/not approved/);
	});

	it("never even asks for approval when the target role name is missing/malformed -- validated before approval, same ordering as conductor_note's 'note' check, with a role-specific validation reason", async () => {
		const extension = createPermissionGateExtension({ workspaceRoot: workspace.root });
		const handler = captureToolCallHandler(extension.factory);
		const ui = createTestUiContext({ confirmResult: true });

		const malformed: CustomToolCallEvent = {
			type: "tool_call",
			toolCallId: "task-2",
			toolName: "task",
			input: { role: "", prompt: "do the thing" },
		};
		const result = await handler(malformed, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(ui.confirmCalls).toHaveLength(0);
		// Discriminator: the generic default-deny fallback's reason names the TOOL ("task"), never
		// the missing PARAMETER -- a real validation branch (mirroring conductor_note's own
		// non-empty-string check) must name "role" specifically.
		expect(result?.reason).toMatch(/role/i);
	});
});
