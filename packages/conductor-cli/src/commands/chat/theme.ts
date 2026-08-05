/**
 * Minimal, uncolored themes for the `packages/tui` components `conductor chat` composes
 * (`Editor`/`SelectList`). `@earendil-works/pi-coding-agent`'s own theme machinery
 * (`getEditorTheme()`, the default `theme` proxy, `setTheme()`, `getAvailableThemesWithPaths()`) is
 * NOT exported from its public entrypoint (verified: `packages/coding-agent/src/index.ts` exports
 * only `getMarkdownTheme`/`getSelectListTheme`/`getSettingsListTheme`/`initTheme`/`Theme` from
 * `theme.ts` -- not `getEditorTheme` and not the default-theme singleton), so a sibling package
 * consuming only the public SDK surface cannot reuse it directly (same constraint documented in
 * conductor-runtime/test/support/fake-model.ts for coding-agent's private test harness).
 *
 * Building color styling from scratch is out of proportion for Fase 1's exit criterion ("TUI
 * inicial" -- functional, not themed; ADR 0002 §1.3's "don't build more than the phase needs"
 * applies here the same way it does everywhere else in this ADR). These functions are the identity
 * function (no ANSI codes) -- fully functional, just uncolored. Swapping in real styling later is a
 * pure drop-in replacement of this one file; nothing else in `commands/chat` depends on styling.
 */

import type { EditorTheme, SelectListTheme } from "@earendil-works/pi-tui";

const identity = (text: string): string => text;

export const plainSelectListTheme: SelectListTheme = {
	selectedPrefix: identity,
	selectedText: identity,
	description: identity,
	scrollInfo: identity,
	noMatch: identity,
};

export const plainEditorTheme: EditorTheme = {
	borderColor: identity,
	selectList: plainSelectListTheme,
};
