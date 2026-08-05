/**
 * Unit tests for the permission-gate extension's pi.on("tool_call") handler, exercised directly
 * against synthetic events/contexts — no AgentSession involved. The full multi-turn, real-session
 * proof (approved edit actually applied to disk, blocked edit's reason surfaced, bash gated, JSONL
 * persist/resume) lives in acceptance.test.ts; this file focuses on the gate's decision logic
 * itself, including the specific tool-by-tool policy table from gate3-threat-model.md §5.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	BashToolCallEvent,
	EditToolCallEvent,
	ExtensionAPI,
	ExtensionContext,
	GrepToolCallEvent,
	ReadToolCallEvent,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPermissionGateExtension, type PermissionGateDecision } from "../src/permission-gate.ts";
import { createTestUiContext, type TestUiContext } from "./support/test-ui.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

type ToolCallHandler = (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | undefined>;

/** Capture the pi.on("tool_call", handler) registration without loading a real extension runtime. */
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
let decisions: PermissionGateDecision[];

beforeEach(() => {
	workspace = createScratchWorkspace();
	decisions = [];
});

afterEach(() => {
	workspace.cleanup();
});

function makeHandler(approvalTimeoutMs = 200) {
	const extension = createPermissionGateExtension({
		workspaceRoot: workspace.root,
		approvalTimeoutMs,
		onDecision: (decision) => decisions.push(decision),
	});
	return captureToolCallHandler(extension.factory);
}

describe("permission-gate: read", () => {
	it("allows a read inside the workspace without prompting for approval", async () => {
		writeFileSync(join(workspace.root, "in.txt"), "x");
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: ReadToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "read",
			input: { path: "in.txt" },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result).toBeUndefined();
		expect(ui.confirmCalls).toHaveLength(0);
		expect(decisions[0]).toMatchObject({ toolName: "read", allowed: true, requiredApproval: false });
		// Observability (quality-baseline category 6): every decision carries a real, parseable
		// UTC timestamp — never a placeholder — so it can be correlated in an evidence trail.
		expect(decisions[0]?.timestamp).toBeTruthy();
		expect(new Date(decisions[0]?.timestamp as string).toISOString()).toBe(decisions[0]?.timestamp);
	});

	it("denies a read outside the workspace", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: ReadToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "read",
			input: { path: "../outside.txt" },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(result?.reason).toMatch(/outside the workspace root/);
	});
});

describe("permission-gate: write / edit", () => {
	it("approves an edit inside the workspace when the user confirms", async () => {
		writeFileSync(join(workspace.root, "in.txt"), "x");
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: EditToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "edit",
			input: { path: "in.txt", edits: [{ oldText: "x", newText: "y" }] },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result).toBeUndefined();
		expect(ui.confirmCalls).toHaveLength(1);
		expect(decisions[0]).toMatchObject({ toolName: "edit", allowed: true, requiredApproval: true });
	});

	it("blocks an edit inside the workspace when the user denies approval", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: false });

		const event: EditToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "edit",
			input: { path: "in.txt", edits: [{ oldText: "x", newText: "y" }] },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(ui.confirmCalls).toHaveLength(1);
	});

	it("blocks a workspace-escaping edit WITHOUT even prompting for approval (containment checked first)", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: EditToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "edit",
			input: { path: "../outside.txt", edits: [{ oldText: "", newText: "pwned" }] },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(result?.reason).toMatch(/outside the workspace root/);
		expect(ui.confirmCalls).toHaveLength(0);
	});

	it("blocks a write into a protected path even inside the workspace", async () => {
		const nested = join(workspace.root, "secrets");
		mkdirSync(nested);
		const extension = createPermissionGateExtension({
			workspaceRoot: workspace.root,
			additionalProtectedPaths: [nested],
			onDecision: (decision) => decisions.push(decision),
		});
		const handler = captureToolCallHandler(extension.factory);
		const ui = createTestUiContext({ confirmResult: true });

		const event: EditToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "edit",
			input: { path: join(nested, "token"), edits: [{ oldText: "", newText: "leak" }] },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(result?.reason).toMatch(/protected location/);
		expect(ui.confirmCalls).toHaveLength(0);
	});

	it("fails closed when the tool input is malformed (internal error, never allow)", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "edit",
			// A malformed path (not a string) makes the real canonicalization code throw at
			// runtime; the handler must still deny, never let this surface as an unhandled
			// rejection or an accidental allow.
			input: { path: undefined as unknown as string, edits: [] },
		} as EditToolCallEvent;
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("policy evaluation error — fail closed");
	});
});

describe("permission-gate: bash", () => {
	it("approves bash when the user confirms", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: BashToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "bash",
			input: { command: 'node -e "process.exit(0)"' },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result).toBeUndefined();
		expect(decisions[0]).toMatchObject({ toolName: "bash", allowed: true, requiredApproval: true });
	});

	it("blocks bash when there is no UI to ask (fail closed)", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: BashToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "bash",
			input: { command: "ls" },
		};
		const result = await handler(event, fakeContext(ui, false));

		expect(result?.block).toBe(true);
	});

	it("blocks bash on approval timeout (fail closed, not fail open)", async () => {
		const handler = makeHandler(25);
		const ui = createTestUiContext({ hangConfirm: true });

		const event: BashToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "bash",
			input: { command: "ls" },
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
	});
});

describe("permission-gate: tools with no declared policy", () => {
	it("denies grep by default (no policy declared -> fail closed)", async () => {
		const handler = makeHandler();
		const ui = createTestUiContext({ confirmResult: true });

		const event: GrepToolCallEvent = {
			type: "tool_call",
			toolCallId: "1",
			toolName: "grep",
			input: { pattern: "x" } as GrepToolCallEvent["input"],
		};
		const result = await handler(event, fakeContext(ui, true));

		expect(result?.block).toBe(true);
		expect(result?.reason).toMatch(/no policy declared/);
	});
});
