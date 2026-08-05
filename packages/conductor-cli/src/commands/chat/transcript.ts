/**
 * Transcript line formatting for `conductor chat` (docs/adr/0002-fase1-cli-foundation.md §7.4:
 * "Text/Container para o transcrito"). Pure -- takes a `SessionEntry` (or a live `AgentMessage`) and
 * returns a plain-text line, or `undefined` when the entry has nothing meaningful to show in a thin
 * (Fase 1) transcript. No TUI dependency: the caller wraps the returned string in a `Text` component.
 *
 * Two callers:
 *   - Resume replay (chat.ts, startup): iterates `sessionManager.getEntries()` so a resumed session's
 *     prior turns are visible immediately, not just "a JSONL file exists on disk" (the round B2 task's
 *     own bar for what "sessão persistente" must mean end to end).
 *   - Live rendering (chat.ts, `message_end`/`tool_execution_end` events): the same summarizer applied
 *     to newly completed turns, so replayed history and live turns render identically.
 *
 * Deliberately thin, matching ADR §7.4's scope: no streaming deltas, no markdown rendering, no diff
 * rendering for edits -- one line per completed message/tool result. `thinking_level_change`,
 * `model_change`, `compaction`, `branch_summary`, `custom`, `label`, and `session_info` entries are
 * skipped (return `undefined`) as not meaningful to a Fase 1 transcript reader; a fuller renderer is
 * out of scope here (ADR §7.4/§7.5's "thin, not a skeleton" framing, same posture as
 * ConductorResourceLoader's §4.2 scope table).
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

const MAX_TOOL_RESULT_PREVIEW_CHARS = 200;

function truncate(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => {
			return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text";
		})
		.map((block) => block.text)
		.join("\n");
}

function summarizeToolCalls(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((block): block is { type: "toolCall"; name: string } => {
			return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "toolCall";
		})
		.map((block) => `[requested tool: ${block.name}]`);
}

/** Formats one `SessionEntry` as zero or more transcript lines (a message can carry both text and
 * tool-call blocks, e.g. an assistant turn that explains itself then calls a tool). */
export function summarizeEntryForTranscript(entry: SessionEntry): string[] {
	if (entry.type !== "message") return [];

	const message = entry.message as { role?: string; content?: unknown; toolName?: string };

	switch (message.role) {
		case "user": {
			const text = extractText(message.content);
			return text.length > 0 ? [`> ${text}`] : [];
		}
		case "assistant": {
			const text = extractText(message.content);
			const toolCalls = summarizeToolCalls(message.content);
			const lines: string[] = [];
			if (text.length > 0) lines.push(text);
			lines.push(...toolCalls);
			return lines;
		}
		case "toolResult": {
			const text = truncate(extractText(message.content), MAX_TOOL_RESULT_PREVIEW_CHARS);
			const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
			return text.length > 0 ? [`[${toolName} result] ${text}`] : [`[${toolName} result]`];
		}
		default:
			// custom/unrecognized message roles: not meaningful to a Fase 1 thin transcript.
			return [];
	}
}

/** Replays a full entry list (e.g. `sessionManager.getEntries()` on `--resume`) into transcript
 * lines, in order -- the concrete mechanism behind "prior turns visible", not just "a file exists". */
export function replayTranscript(entries: readonly SessionEntry[]): string[] {
	return entries.flatMap((entry) => summarizeEntryForTranscript(entry));
}
