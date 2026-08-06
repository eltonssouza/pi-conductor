/**
 * Real interactive TTY confirmation channel for `conductor gate approve`/`conductor gate calibrate`
 * (Gate 6, Fase 4 "Gates e evidências" — Gate 8 loop-back).
 *
 * Gate 8 ran the real CLI end-to-end and found `status:"approved"` structurally UNREACHABLE for any
 * gate: `cli.ts`'s `headlessConfirmChannel` was hardcoded to always resolve `false`, with NO branch at
 * all for a real interactive terminal — so `mintHumanApproval`'s one production call site
 * (`gate-store.ts`'s `approve()`) was NEVER fed a `true`. This file is the missing POSITIVE path.
 *
 * Why not reuse `ctx.ui.confirm()`/`confirmOrDeny` (Pi's own session-scoped confirm, `confirm.ts`):
 * `conductor gate approve` runs as a STANDALONE OS process invocation (`bin/conductor.js`), outside any
 * active Pi chat session — there is no `ExtensionContext`/`ctx.ui` to bind to at this call site at all
 * (`cli.ts` never constructs one for the bare `gate *` subcommands). `confirmOrDeny` is therefore not an
 * option here, not merely a choice not taken; a new, minimal TTY prompt is the only way this channel can
 * ever exist. It is kept as small as `confirmOrDeny` itself and preserves the same fail-closed spirit
 * at the one place that matters — the boolean handed to `mintHumanApproval`:
 *   - no real TTY on stdin+stdout (`resolveConfirmChannel` below) -> the headless, always-`false`
 *     channel is used instead of ever constructing this one; a script/CI/autonomous-loop invocation
 *     keeps falling through to `needs-human` (FR-11), exactly as it already correctly did before this
 *     loop-back — this file only ADDS the positive path, it never removes the negative default.
 *   - the input stream closing or erroring before an answer is given -> resolves `false`, never hangs
 *     forever and never defaults to `true` on ambiguity (mirrors `confirmOrDeny`'s own "any uncertainty
 *     denies" direction, ADR 0005 §6).
 *   - only a literal `y`/`yes` (case-insensitive, trimmed) answer resolves `true`; anything else —
 *     including an empty line, "n", or a typo — resolves `false`. Deny is the safe default on ambiguity,
 *     same as `confirmOrDeny`'s own timeout branch.
 * Deliberately WITHOUT a fixed timeout (unlike `confirmOrDeny`'s 30s window): `confirmOrDeny` bounds a
 * session UI that might never be answered by anyone; a real, foreground, interactive TTY prompt is a
 * human being asked a direct question and is conventionally expected to wait for them (the same
 * un-timed `y/N` convention `git commit --interactive`, `npm init`, etc. already use) — imposing an
 * arbitrary timeout here would silently deny a slow-but-present human, which is a worse failure mode
 * than waiting. (Library grounding: a query this session — "prompt interativo de confirmação y/n em
 * terminal sem timeout, fail-closed no fechamento/erro do stream" — returned only generic
 * tracer-code/defensive-programming material, top score 0.591, nothing prompt-specific; this mirrors
 * `cli.ts`'s own header note that this project's library corpus does not cover CLI-tool-specific
 * interaction design, so this narrow design choice is grounded in the established in-repo precedent
 * (`confirm.ts`'s "any uncertainty denies" direction) and ordinary CLI convention, not forced onto a
 * weak citation.)
 *
 * R22/sole-mint preserved: this file is a NEW MEANS of producing the `confirmResult` boolean
 * `runGateApprove`/`runGateCalibrate` (`commands/gate.ts`) hand to `GateStateStoreView.approve`, which
 * alone calls `mintHumanApproval` (`@conductor/runtime`'s `gate-approval.ts`) — it is not a second,
 * parallel path that itself constructs an `Approval` or writes the literal `method:"human"`. Exactly one
 * function in the whole codebase is still permitted to write that literal (enforced by
 * `gate-approval-sole-mint.test.ts`'s static scan) — this file only supplies one of the now-two real
 * ways to arrive at the `true` fed into it (the other, still unwired per Gate 8's own finding, would be
 * a future in-session `ctx.ui.confirm()` call site for the `/cdt` checkpoint flow).
 */

import { createInterface } from "node:readline";
import type { ConfirmChannel } from "./commands/gate.ts";

/** The minimal stream pair a TTY confirm channel needs — deliberately NOT `NodeJS.ReadStream`/
 * `NodeJS.WriteStream` directly (those types pull in the whole real Node stream surface); this is the
 * "inject the collaborator" seam (mirrors `gate-evidence.ts`'s own `gitCommitExists` injection): production
 * (`bin/conductor.js` via `cli.ts`'s `CliIO.tty`) passes real `process.stdin`/`process.stdout`; tests pass
 * an in-memory `node:stream` `Readable`/`Writable` pair with `isTTY` set explicitly, never a real pty. */
export interface TtyStreams {
	stdin: NodeJS.ReadableStream & { isTTY?: boolean };
	stdout: NodeJS.WritableStream & { isTTY?: boolean };
}

/**
 * Builds a `ConfirmChannel` (`commands/gate.ts`) backed by a real readline y/n prompt over `streams`.
 * Assumes the caller (`resolveConfirmChannel` below) already decided a real TTY is present — this
 * function does not itself re-check `isTTY`, so it stays trivially testable against injected in-memory
 * streams that never claim to be a real terminal.
 */
export function createTtyConfirmChannel(streams: TtyStreams): ConfirmChannel {
	return (title, message) =>
		new Promise<boolean>((resolve) => {
			let settled = false;
			const rl = createInterface({ input: streams.stdin, output: streams.stdout });

			const settle = (value: boolean): void => {
				if (settled) return;
				settled = true;
				rl.close();
				resolve(value);
			};

			// Fail-closed: the input stream closing/erroring before an answer is given denies, never
			// hangs and never defaults to `true` (this file's own header, "any uncertainty denies").
			rl.on("close", () => settle(false));
			streams.stdin.on("error", () => settle(false));

			streams.stdout.write(`\n${title}\n${message}\n`);
			rl.question("Approve? [y/N] ", (answer) => {
				const normalized = answer.trim().toLowerCase();
				settle(normalized === "y" || normalized === "yes");
			});
		});
}

/** Headless-by-default channel — the SAME fail-closed placeholder `cli.ts` used to define locally
 * (unchanged behavior, just relocated so `resolveConfirmChannel` below has both branches side by side).
 * Resolving `false` unconditionally can never be mistaken for "human said yes" (R22): a mandatory gate
 * approved this way correctly falls through to `needs-human` (FR-11) instead of ever fabricating a
 * sign-off nothing will ever really answer. */
export const headlessConfirmChannel: ConfirmChannel = async () => false;

/**
 * Picks the real channel `conductor gate approve`/`calibrate` should use (Gate 8 loop-back's decision
 * 1): a genuine interactive TTY on BOTH stdin and stdout (the same convention most CLIs — git, npm —
 * already check before ever prompting) gets the real `createTtyConfirmChannel` prompt; anything else
 * (`streams` omitted entirely, or either stream not a TTY — piped/redirected input, a CI runner, the
 * autonomous loop) stays on `headlessConfirmChannel` — the fail-closed default Gate 8 already confirmed
 * is correct, just no longer the ONLY path that exists.
 */
export function resolveConfirmChannel(streams: TtyStreams | undefined): ConfirmChannel {
	if (streams?.stdin.isTTY && streams.stdout.isTTY) {
		return createTtyConfirmChannel(streams);
	}
	return headlessConfirmChannel;
}
