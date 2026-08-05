/**
 * Terminal control-sequence sanitization (Fase-1 Gate 3 addendum T14,
 * docs/conductor/gate3-fase1-addendum.md §2 T14 / §3 secure default 11; docs/adr/0002-fase1-cli-foundation.md
 * §7.4): the approval prompt (`ctx.ui.confirm()`) renders text that can be model-controlled — a
 * tool's `path`/`command`/`note` argument, possibly itself shaped by prompt injection
 * (gate3-threat-model.md T5). A path/command/note containing ANSI/CSI/OSC escape sequences could
 * manipulate the *display* of the approval prompt itself — reposition the cursor, clear/overwrite
 * the line, hide the real target, or paint a fake "safe" command over a dangerous one — attacking the
 * integrity of the human-in-the-loop control the rest of the permission-gate depends on. This is not
 * a bypass of the gate's chokepoint (the gate has already decided containment/policy before this text
 * is ever shown); it is an attack on whether the human approver can trust what they are reading.
 *
 * Treat model-controlled text as DATA, never as terminal markup — the same taint source->sink framing
 * gate3-fase1-addendum.md already applies to T13 (Secure Code Review — Complete Professional Guide
 * §2.2/§2.5: validate/sanitize at the sink), here with the render sink instead of the filesystem
 * sink. Responsibility is the Conductor's, not the Pi UI implementation's: never assume a given
 * `ctx.ui` renderer already escapes control sequences — verify, and sanitize regardless (the addendum's
 * explicit instruction; the library has no dedicated chapter on terminal-escape injection specifically —
 * reported honestly there rather than a forced citation, same posture as the addendum's own T14 write-up).
 */

/**
 * CSI (Control Sequence Introducer) sequences: ESC '[' + parameter bytes (0x30-0x3F) + intermediate
 * bytes (0x20-0x2F) + a single final byte (0x40-0x7E) — ECMA-48 grammar. Covers cursor movement,
 * line/screen clearing, color/SGR codes, cursor show/hide, and more.
 */
const CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * OSC (Operating System Command) sequences: ESC ']' + payload, terminated by BEL or ST (ESC '\').
 * Used for window-title changes and terminal hyperlinks (OSC 8) — both plausible vectors for
 * disguising the approval prompt's real content.
 */
const OSC_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Other two-byte escape sequences: ESC + a single byte in 0x30-0x7E — covers all three of ECMA-48's
 * remaining two-byte escape classes (Fp 0x30-0x3F: e.g. `ESC 7`/`ESC 8` DECSC/DECRC save/restore
 * cursor; Fe 0x40-0x5F: e.g. `ESC M` reverse index, plus a malformed/unterminated CSI or OSC prefix
 * left behind by the two patterns above; Fs 0x60-0x7E: e.g. `ESC c` RIS full reset). Deliberately
 * broad — any single byte here is stripped as a precaution, not just the specific codes with a
 * well-known meaning, since an undocumented/proprietary terminal escape is still an escape.
 */
const OTHER_TWO_BYTE_ESCAPE_PATTERN = /\x1b[0-~]/g;

/**
 * Catch-all: any remaining C0 control byte (0x00-0x1F) except tab (0x09) and newline (0x0A), DEL
 * (0x7F), and any C1 control byte (0x80-0x9F). This also mops up a bare/leftover ESC (0x1B) that a
 * malformed or truncated escape sequence left behind after the patterns above — no raw control byte
 * survives to reach a terminal renderer, even for a sequence this module's specific patterns did not
 * anticipate. `\n`/`\t` are preserved so a multi-line or tab-formatted message stays legible.
 */
const RESIDUAL_CONTROL_BYTES_PATTERN = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/**
 * Strip ANSI/CSI/OSC terminal escape sequences and raw C0/C1 control bytes from `input`, preserving
 * plain newlines and tabs. Pure, total (never throws), and idempotent (re-sanitizing already-clean
 * text is a no-op). Callers must apply this to every string that reaches a terminal-rendering sink —
 * see `confirm.ts`'s `confirmOrDeny()`, the single chokepoint all of write/edit/bash/conductor_note's
 * approval prompts already funnel through.
 */
export function sanitizeForTerminal(input: string): string {
	return input
		.replace(CSI_PATTERN, "")
		.replace(OSC_PATTERN, "")
		.replace(OTHER_TWO_BYTE_ESCAPE_PATTERN, "")
		.replace(RESIDUAL_CONTROL_BYTES_PATTERN, "");
}
