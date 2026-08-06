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
 *
 * T14 sanitization (gate3-fase1-addendum.md §2 T14; ADR 0002 §7.4, binding: "e o adapter que
 * conductor-cli escreve para desenhar ctx.ui.confirm()/o transcrito ... devem escapar caracteres de
 * controle C0/C1 e sequências CSI/OSC"): assistant text and tool-result text originate from the
 * model/tool -- untrusted, per the same taint framing terminal-sanitize.ts's header already applies
 * to confirm.ts's title/message. Gate 8 (docs/conductor/gate8-validation-fase1.md §6.1) found this
 * module was NOT sanitizing before round B2 shipped: `confirmOrDeny()` protected the approval-dialog
 * sink only, while this module fed raw, unsanitized text straight into `Text` (text.ts:66's own
 * comment confirms `Text` passes control bytes through unmodified). Fixed by sanitizing every line
 * this module ever returns, in one place -- both callers (resume-replay and live `message_end`) go
 * through `summarizeEntryForTranscript`/`replayTranscript`, so neither caller can forget it, mirroring
 * confirm.ts's own "single sink" discipline (Software Construction Practices - Complete Professional
 * Guide §2.3/§2.8: validate/sanitize untrusted input at the boundary before it travels further --
 * the library has no chapter on terminal-escape injection specifically, same honest gap
 * terminal-sanitize.ts's own header already discloses).
 */

import { redactSecrets, sanitizeForTerminal } from "@conductor/runtime";
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
 * tool-call blocks, e.g. an assistant turn that explains itself then calls a tool). Every returned
 * line is redacted THEN sanitized (T14 + FR-13, see module header) -- this is the single funnel both
 * the resume-replay and live-rendering callers share, so neither transform can be forgotten by
 * either caller.
 *
 * FR-13 (gate2-spec-fase2.md Grupo D; gate3-addendum-fase2.md T21 sink #1; ADR 0003 §6.2 sink #1):
 * "sanitização de terminal != redação de segredo" -- Fase 1's T14 fix only stripped ANSI/CSI/OSC
 * control sequences here; it never masked a secret VALUE arriving as ordinary printable text (e.g. a
 * `bash` result echoing `ANTHROPIC_API_KEY=sk-ant-...`). `redactSecrets` runs FIRST, per ADR §6.2's
 * sink #1 ("redactSecrets antes de sanitizeForTerminal, no mesmo funil") -- masking a secret's bytes
 * before terminal-sanitization runs means the two transforms cannot interact (a control byte hiding
 * inside a would-be secret span is still caught by sanitizeForTerminal afterward, since redaction
 * only ever replaces a span with the fixed, control-byte-free `[REDACTED:label]` placeholder). Reuses
 * the exact `@conductor/secrets` matcher instance the Fase 1 Secret Scanner and the audit-trail
 * redaction wrapper already use (one definition of "secret-shaped" in the monorepo) -- never a second
 * regex list to drift out of sync with FR-14/FR-15's word-boundary/entropy corrections.
 */
export function summarizeEntryForTranscript(entry: SessionEntry): string[] {
	return rawSummarizeEntryForTranscript(entry).map((line) => sanitizeForTerminal(redactSecrets(line)));
}

function rawSummarizeEntryForTranscript(entry: SessionEntry): string[] {
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
