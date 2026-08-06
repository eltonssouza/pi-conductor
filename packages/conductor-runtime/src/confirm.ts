import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeForTerminal } from "./terminal-sanitize.ts";

/**
 * Approval gate for write/edit/bash (gate3-threat-model.md §4 T8, §5 item 2):
 * `ctx.ui.confirm()` is opt-in per call-site and its timeout auto-resolve behavior is not
 * guaranteed by the framework across run modes (recon §5, §9) — so the Conductor permission-gate
 * owns its own timeout with an explicit DENY default, rather than trusting whatever a given UI
 * implementation's `opts.timeout` produces internally.
 *
 * Secure defaults enforced here, independent of Pi's own implementation:
 *   - No UI bound (`ctx.hasUI === false`) -> deny immediately (no human to ask).
 *   - `ctx.ui.confirm()` rejects -> deny.
 *   - `ctx.ui.confirm()` does not settle within `timeoutMs` -> deny (never allow-on-timeout).
 *   - `ctx.ui.confirm()` resolves `true` -> allow.
 *   - `title`/`message` are sanitized (see terminal-sanitize.ts, T14) before ever reaching
 *     `ctx.ui.confirm()` — this is the single sink every one of the gate's four approval call sites
 *     (write, edit, bash, conductor_note; permission-gate.ts) funnels through, so the protection
 *     cannot be forgotten by a call site or reintroduced by a new one.
 */

export const DEFAULT_APPROVAL_TIMEOUT_MS = 30_000;

export async function confirmOrDeny(
	ctx: Pick<ExtensionContext, "ui" | "hasUI">,
	title: string,
	message: string,
	timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS,
): Promise<boolean> {
	if (!ctx.hasUI) {
		return false;
	}

	// T14 (gate3-fase1-addendum.md §2 T14 / §3 secure default 11): title/message may embed
	// model-controlled text (a tool's path/command/note argument). Sanitize unconditionally at this
	// sink — never assume a caller already did it, and never assume the bound UI's own renderer
	// escapes control sequences either.
	const safeTitle = sanitizeForTerminal(title);
	const safeMessage = sanitizeForTerminal(message);

	return await new Promise<boolean>((resolvePromise) => {
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolvePromise(false);
		}, timeoutMs);
		// Don't let this timer keep the process alive on its own (matters for CLI/test runs).
		timer.unref?.();

		ctx.ui
			.confirm(safeTitle, safeMessage, { timeout: timeoutMs })
			.then((result) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolvePromise(result === true);
			})
			.catch(() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolvePromise(false);
			});
	});
}
