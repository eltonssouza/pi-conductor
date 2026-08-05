/**
 * `ExtensionUIContext` adapter over `packages/tui` for `conductor chat`
 * (docs/adr/0002-fase1-cli-foundation.md §7.4). This is the piece that proves T14
 * (`gate3-fase1-addendum.md` §2 T14 / §3 secure default 11) end to end against a REAL terminal
 * renderer, not just the `test-ui.ts` fake used by every test through round B1.
 *
 * VERIFIED FINDING (ADR 0002 §12 follow-up, closed here): `packages/tui`'s `Text` component does
 * NOT strip or escape ANSI/control sequences on its own -- `packages/tui/src/components/text.ts`'s
 * own `render()` comment says so explicitly ("Wrap text (this preserves ANSI codes but does NOT
 * pad)", text.ts:66). This is by design (Text also renders legitimately-styled/colored content), but
 * it means Conductor's sanitization at the `confirmOrDeny()` sink
 * (`@conductor/runtime`'s `confirm.ts`, which calls `sanitizeForTerminal()` before ever invoking
 * `ctx.ui.confirm()`) is the SOLE line of defense against a model-controlled path/command/note
 * forging the approval prompt's display -- not defense-in-depth over a renderer that also escapes.
 * This module therefore never re-derives or second-guesses the string it is given: whatever
 * `title`/`message` `confirm()` receives is rendered as a literal, single-purpose `Text` line, exactly
 * as received, on the (correct) assumption that the caller (confirm.ts) already sanitized it.
 *
 * Scope (ISP -- SOLID Design Principles -- Complete Professional Guide §3.3, "each client depends
 * only on what it uses"): `ExtensionUIContext`'s full surface is large because it also serves
 * third-party extension authoring (footers, headers, custom overlays, editor swapping, theming).
 * Fase 1's `ConductorResourceLoader` always sets `noExtensions`/`noSkills`/`noPromptTemplates`: true
 * (resource-loader.ts) and registers only the first-party permission-gate, whose own call surface is
 * exactly two methods -- `ctx.ui.confirm` (permission-gate.ts via confirm.ts) and `ctx.ui.notify`
 * (permission-gate.ts:160) -- grep-verified, not assumed. `select`/`onTerminalInput`/`setStatus`/
 * `setTitle`/`getEditorText`/`setEditorText`/`pasteToEditor` are implemented for real anyway (cheap,
 * and `select` is confirm's own building block). Every other member below is a documented no-op:
 * structurally required by the `ExtensionUIContext` type (bindExtensions needs the full interface),
 * but provably unreachable in Fase 1's locked-down runtime -- same rationale
 * conductor-runtime/test/support/test-ui.ts already established for its own no-op `select`/`input`.
 * Building real footer/header/theming/tool-output-expansion chrome for callers that cannot exist yet
 * is exactly the "reflex of one interface per class" ADR 0002 §11 already declined to pay for
 * (Managing Software Complexity -- Complete Professional Guide §2.12).
 */

import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, type EditorComponent, type SelectItem, SelectList, Text, type TUI } from "@earendil-works/pi-tui";
import { plainSelectListTheme } from "./theme.ts";

export interface ConductorChatUiOptions {
	tui: TUI;
	/** The chat input editor -- focus is restored to it once any dialog closes. */
	editor: EditorComponent;
	/** The live transcript container `notify()` lines get appended to. */
	transcript: Container;
	/** The status line component `setStatus()` updates. */
	statusText: Text;
}

/**
 * Shows `choices` as a real, focusable `SelectList` overlay and resolves to the chosen `value`, or
 * `undefined` on cancel (Escape/Ctrl+C), abort, or timeout. Fail-closed by construction: every path
 * that is NOT an explicit "approve"-shaped selection resolves `undefined`, matching
 * `confirmOrDeny()`'s own "deny unless explicitly approved" default (conductor-runtime/src/confirm.ts).
 */
function showChoiceOverlay(
	tui: TUI,
	editorFocusTarget: EditorComponent,
	title: string,
	choices: SelectItem[],
	opts?: { signal?: AbortSignal; timeout?: number },
): Promise<string | undefined> {
	return new Promise((resolve) => {
		if (opts?.signal?.aborted) {
			resolve(undefined);
			return;
		}

		let settled = false;
		const promptText = new Text(title, 1, 1);
		const selectList = new SelectList(choices, Math.min(choices.length, 6), plainSelectListTheme);
		const promptBox = new Container();
		promptBox.addChild(promptText);
		promptBox.addChild(selectList);

		const handle = tui.showOverlay(promptBox, { anchor: "center", width: "70%", minWidth: 30 });

		const settle = (value: string | undefined) => {
			if (settled) return;
			settled = true;
			handle.hide();
			tui.setFocus(editorFocusTarget);
			tui.requestRender();
			resolve(value);
		};

		selectList.onSelect = (item) => settle(item.value);
		selectList.onCancel = () => settle(undefined);

		tui.setFocus(selectList);
		tui.requestRender();

		if (opts?.signal) {
			opts.signal.addEventListener("abort", () => settle(undefined), { once: true });
		}
		if (opts?.timeout !== undefined) {
			const timer = setTimeout(() => settle(undefined), opts.timeout);
			timer.unref?.();
		}
	});
}

function notifyPrefix(type: "info" | "warning" | "error" | undefined): string {
	if (type === "error") return "[error] ";
	if (type === "warning") return "[warning] ";
	return "[info] ";
}

const UNSUPPORTED_IN_FASE1 =
	"not supported by conductor chat in Fase 1 -- no loaded extension calls this (ConductorResourceLoader " +
	"always sets noExtensions/noSkills/noPromptTemplates: true; see resource-loader.ts). Real chrome " +
	"(footer/header/theming/tool-output-expansion) is deferred to the phase that introduces a caller for it.";

export function createConductorChatUiContext(options: ConductorChatUiOptions): ExtensionUIContext {
	const { tui, editor, transcript, statusText } = options;
	const statusFields = new Map<string, string>();
	let toolsExpanded = false;

	function renderStatus(): void {
		const line = Array.from(statusFields.values())
			.filter((v) => v.length > 0)
			.join("  ");
		statusText.setText(line);
		tui.requestRender();
	}

	// `as unknown as Theme`: Theme is a nominal class (@earendil-works/pi-coding-agent's theme.ts)
	// whose real constructor/instances are not part of the public entrypoint (see theme.ts's own
	// header comment). Same "partial-cast, documented, deliberate" pattern already established by
	// conductor-runtime/test/support/test-ui.ts for the same class of unreachable-but-type-required
	// surface -- `ctx.ui.theme` is read by extensions this Fase 1 runtime never loads.
	const inertTheme = {} as unknown as Theme;

	const context: ExtensionUIContext = {
		select: (title, choiceLabels, opts) =>
			showChoiceOverlay(
				tui,
				editor,
				title,
				choiceLabels.map((label) => ({ value: label, label })),
				opts,
			),

		confirm: async (title, message, opts) => {
			const result = await showChoiceOverlay(
				tui,
				editor,
				`${title}\n${message}`,
				[
					{ value: "approve", label: "Approve" },
					{ value: "deny", label: "Deny" },
				],
				opts,
			);
			return result === "approve";
		},

		// Structurally required, provably unreachable in Fase 1 (see module header). A real
		// multi-line text-input dialog is genuine UI work disproportionate to a caller that cannot
		// exist yet -- mirrors test-ui.ts's own choice to no-op `input`.
		input: async () => undefined,

		notify: (message, type) => {
			transcript.addChild(new Text(`${notifyPrefix(type)}${message}`, 1, 0));
			tui.requestRender();
		},

		onTerminalInput: (handler) => tui.addInputListener(handler),

		setStatus: (key, text) => {
			if (text === undefined) statusFields.delete(key);
			else statusFields.set(key, text);
			renderStatus();
		},

		setTitle: (title) => tui.terminal.setTitle(title),

		getEditorText: () => editor.getText(),
		setEditorText: (text) => editor.setText(text),
		pasteToEditor: (text) => editor.handleInput(`\x1b[200~${text}\x1b[201~`),

		// --- Documented no-ops below: structurally required by ExtensionUIContext, unreachable in
		// Fase 1's locked-down runtime (see module header for the grep-verified call-surface proof). ---
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		custom: () => Promise.reject(new Error(`ctx.ui.custom() ${UNSUPPORTED_IN_FASE1}`)),
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: inertTheme,
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: UNSUPPORTED_IN_FASE1 }),
		getToolsExpanded: () => toolsExpanded,
		setToolsExpanded: (expanded) => {
			toolsExpanded = expanded;
		},
	};

	return context;
}
