import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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
 */

export const DEFAULT_APPROVAL_TIMEOUT_MS = 30_000;

export async function confirmOrDeny(
	_ctx: Pick<ExtensionContext, "ui" | "hasUI">,
	_title: string,
	_message: string,
	_timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS,
): Promise<boolean> {
	throw new Error("not implemented");
}
