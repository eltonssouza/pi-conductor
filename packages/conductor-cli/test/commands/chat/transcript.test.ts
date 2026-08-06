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

/**
 * T14 gap (gate3-fase1-addendum.md §2 T14; ADR 0002 §7.4, "o transcrito"; Gate 8 finding §6.1,
 * docs/conductor/gate8-validation-fase1.md): `sanitizeForTerminal()` was wired into confirm.ts's
 * approval-dialog sink only. This is the second sink the same ADR names -- the live chat transcript
 * -- which funnels EVERY line through this module (`summarizeEntryForTranscript`/`replayTranscript`,
 * both call sites in chat.ts: resume-replay at chat.ts:197-198 and live `message_end` at
 * chat.ts:258-261) before wrapping it in a `Text` component that is confirmed (text.ts:66's own
 * comment) to pass raw bytes through unmodified. Sanitizing once here, at the single funnel both
 * call sites share, covers both without either caller having to remember to do it themselves --
 * the same "sole sink" discipline confirm.ts already applies (terminal-sanitize.ts's own header).
 */
describe("summarizeEntryForTranscript / replayTranscript -- terminal sanitization (T14)", () => {
	it("strips a real CSI clear-screen+cursor-home escape sequence from assistant text, preserving the plain text on either side", () => {
		const malicious = "before\x1b[2J\x1b[Hafter";
		const [line] = summarizeEntryForTranscript(assistantTextEntry(malicious));
		expect(line).not.toContain("\x1b");
		expect(line).not.toContain("\x1b[2J");
		expect(line).not.toContain("\x1b[H");
		expect(line).toContain("before");
		expect(line).toContain("after");
	});

	it("strips an OSC sequence (forged terminal title) from a tool result's text, preserving the plain text", () => {
		const malicious = "safe-prefix\x1b]0;Definitely Not Dangerous\x07safe-suffix";
		const [line] = summarizeEntryForTranscript(toolResultEntry("bash", malicious));
		expect(line).not.toContain("\x1b");
		expect(line).not.toContain("\x07");
		expect(line).toContain("safe-prefix");
		expect(line).toContain("safe-suffix");
	});

	it("strips control bytes from a user-typed line too (defense in depth, even though the human typed it themselves)", () => {
		const [line] = summarizeEntryForTranscript(userEntry("hello\x1b[2Kworld"));
		expect(line).not.toContain("\x1b");
	});

	it("still preserves plain newlines and tabs (sanitization must not mangle ordinary multi-line tool output)", () => {
		const [line] = summarizeEntryForTranscript(toolResultEntry("read", "line one\n\tindented line two"));
		expect(line).toBe("[read result] line one\n\tindented line two");
	});

	it("sanitizes every line replayTranscript replays on --resume, not just live events", () => {
		const entries = [assistantTextEntry("safe\x1b[2K\x1b[1Gunsafe")];
		const [line] = replayTranscript(entries);
		expect(line).not.toContain("\x1b");
		expect(line).toBe("safeunsafe");
	});
});

/**
 * FR-13 (docs/conductor/gate2-spec-fase2.md Grupo D; gate3-addendum-fase2.md T21 sink #1;
 * docs/adr/0003-fase2-security-architecture.md §6.2 sink #1): "sanitização de terminal != redação de
 * segredo" -- T14 above only strips ANSI/CSI/OSC control sequences, it does not mask a secret VALUE
 * that arrives as ordinary printable text (e.g. a `bash` result echoing an env var). Gate 8 (this
 * session) found this module still only called `sanitizeForTerminal`, never
 * `redactSecrets`/`@conductor/runtime` -- the exact regression FR-13 names by number
 * ("gate8-validation-fase1.md §6.1 documentou... a Fase 1 só resolveu a primeira [sanitização]").
 */
describe("summarizeEntryForTranscript / replayTranscript -- secret redaction (FR-13)", () => {
	it("masks a known-prefix secret inside a bash tool result's stdout, leaving the surrounding text legible", () => {
		const [line] = summarizeEntryForTranscript(
			toolResultEntry("bash", "ANTHROPIC_API_KEY=sk-ant-api03-FAKEFAKEFAKEFAKEFAKE"),
		);
		expect(line).not.toContain("sk-ant-api03-FAKEFAKEFAKEFAKEFAKE");
		expect(line).toContain("[REDACTED:");
		expect(line).toContain("ANTHROPIC_API_KEY=");
	});

	it("masks a secret embedded as a substring (FR-14's word-boundary correction, reused here)", () => {
		const [line] = summarizeEntryForTranscript(assistantTextEntry("token is anthropic/sk-ant-api03-FAKEFAKEFAKEFAKE"));
		expect(line).not.toContain("sk-ant-api03-FAKEFAKEFAKEFAKE");
		expect(line).toContain("anthropic/[REDACTED:");
	});

	it("does NOT mask a 40-char git-SHA-shaped hex string (FR-15: no false positive)", () => {
		const sha = "a".repeat(40);
		const [line] = summarizeEntryForTranscript(toolResultEntry("bash", `commit ${sha}`));
		expect(line).toContain(sha);
		expect(line).not.toContain("[REDACTED:");
	});

	it("redacts on --resume replay too, not just live rendering", () => {
		const entries = [toolResultEntry("bash", "leaked: sk-ant-api03-FAKEFAKEFAKEFAKEFAKE")];
		const [line] = replayTranscript(entries);
		expect(line).not.toContain("sk-ant-api03-FAKEFAKEFAKEFAKEFAKE");
		expect(line).toContain("[REDACTED:");
	});
});
