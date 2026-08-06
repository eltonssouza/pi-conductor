/**
 * A controllable ExtensionUIContext double for tests. Adapted from
 * `packages/conductor-runtime/test/support/test-ui.ts` -- deliberately duplicated rather than
 * imported across the package boundary (not part of that package's public surface; mirrors
 * `test/support/scratch.ts`'s own documented convention of "each package keeps an independent copy
 * on purpose").
 *
 * ExtensionUIContext's full surface is large (footer/header/editor/theme/autocomplete -- TUI
 * concerns the permission-gate never touches). This double implements only the members the
 * permission-gate actually calls (`confirm`, `notify`) plus harmless no-ops for `select`/`input`,
 * and is cast to the full interface deliberately (not an oversight -- documented here so a future
 * reader does not "complete" it needlessly).
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface TestUiOptions {
	/** What confirm() resolves to when it doesn't hang. Default: false (fail closed by default). */
	confirmResult?: boolean;
	/** If true, confirm() returns a promise that never settles -- exercises confirmOrDeny's own timeout. */
	hangConfirm?: boolean;
}

export interface TestUiContext extends ExtensionUIContext {
	readonly notifications: ReadonlyArray<{ message: string; type?: "info" | "warning" | "error" }>;
	readonly confirmCalls: ReadonlyArray<{ title: string; message: string }>;
}

export function createTestUiContext(options: TestUiOptions = {}): TestUiContext {
	const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
	const confirmCalls: Array<{ title: string; message: string }> = [];

	const partial = {
		notifications,
		confirmCalls,
		select: async () => undefined,
		confirm: async (title: string, message: string) => {
			confirmCalls.push({ title, message });
			if (options.hangConfirm) {
				return await new Promise<boolean>(() => {
					// Deliberately never resolves/rejects.
				});
			}
			return options.confirmResult ?? false;
		},
		input: async () => undefined,
		notify: (message: string, type?: "info" | "warning" | "error") => {
			notifications.push({ message, type });
		},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
	};

	return partial as unknown as TestUiContext;
}
