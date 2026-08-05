/**
 * `commands/chat/transcript.ts` (docs/adr/0002-fase1-cli-foundation.md §7.4) -- Gate 5 (red first).
 * Pure formatting against fixture SessionEntry objects -- no TUI, no live session, no filesystem.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { replayTranscript, summarizeEntryForTranscript } from "../../../src/commands/chat/transcript.ts";

function userEntry(text: string): SessionEntry {
	return {
		type: "message",
		id: "e1",
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: text, timestamp: Date.now() },
	} as SessionEntry;
}

function assistantTextEntry(text: string): SessionEntry {
	return {
		type: "message",
		id: "e2",
		parentId: "e1",
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-completions",
			provider: "conductor-fake",
			model: "conductor-fake-1",
			stopReason: "stop",
			timestamp: Date.now(),
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
		},
	} as unknown as SessionEntry;
}

function assistantToolCallEntry(toolName: string): SessionEntry {
	return {
		type: "message",
		id: "e3",
		parentId: "e2",
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "tc1", name: toolName, arguments: {} }],
			api: "openai-completions",
			provider: "conductor-fake",
			model: "conductor-fake-1",
			stopReason: "toolUse",
			timestamp: Date.now(),
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
		},
	} as unknown as SessionEntry;
}

function toolResultEntry(toolName: string, text: string): SessionEntry {
	return {
		type: "message",
		id: "e4",
		parentId: "e3",
		timestamp: new Date().toISOString(),
		message: { role: "toolResult", toolCallId: "tc1", toolName, content: [{ type: "text", text }] },
	} as unknown as SessionEntry;
}

function nonMessageEntry(): SessionEntry {
	return {
		type: "compaction",
		id: "e5",
		parentId: "e4",
		timestamp: new Date().toISOString(),
		summary: "compacted",
		firstKeptEntryId: "e1",
		tokensBefore: 100,
	} as unknown as SessionEntry;
}

describe("summarizeEntryForTranscript", () => {
	it("formats a user message with a leading marker", () => {
		expect(summarizeEntryForTranscript(userEntry("hello there"))).toEqual(["> hello there"]);
	});

	it("skips a user message with empty content rather than emitting a blank line", () => {
		expect(summarizeEntryForTranscript(userEntry(""))).toEqual([]);
	});

	it("formats an assistant text message as-is (no marker)", () => {
		expect(summarizeEntryForTranscript(assistantTextEntry("here is the answer"))).toEqual(["here is the answer"]);
	});

	it("formats an assistant tool-call message as a bracketed tool-request line", () => {
		expect(summarizeEntryForTranscript(assistantToolCallEntry("read"))).toEqual(["[requested tool: read]"]);
	});

	it("formats a tool result with the tool name and a truncated preview", () => {
		expect(summarizeEntryForTranscript(toolResultEntry("read", "file contents here"))).toEqual([
			"[read result] file contents here",
		]);
	});

	it("truncates a very long tool result rather than flooding the transcript", () => {
		const longText = "x".repeat(500);
		const [line] = summarizeEntryForTranscript(toolResultEntry("bash", longText));
		expect(line.length).toBeLessThan(500);
		expect(line).toContain("…");
	});

	it("skips non-message entries (compaction, branch_summary, etc.) -- not meaningful to a thin transcript", () => {
		expect(summarizeEntryForTranscript(nonMessageEntry())).toEqual([]);
	});
});

describe("replayTranscript", () => {
	it("replays a full entry list in order, skipping non-message entries, for resumed-session history", () => {
		const entries = [userEntry("what's 2+2?"), nonMessageEntry(), assistantTextEntry("4")];
		expect(replayTranscript(entries)).toEqual(["> what's 2+2?", "4"]);
	});

	it("returns an empty array for a fresh session with no prior entries", () => {
		expect(replayTranscript([])).toEqual([]);
	});
});
