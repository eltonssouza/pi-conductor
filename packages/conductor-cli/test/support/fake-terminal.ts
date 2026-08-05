/**
 * A minimal recording `Terminal` double for testing `commands/chat`'s real TUI wiring
 * (`TuiMainScreen` + `Editor` + `SelectList`) headlessly. Deliberately NOT an ANSI-emulating virtual
 * terminal (`packages/tui/test/virtual-terminal.ts` uses `@xterm/headless` for that, to test
 * `packages/tui` itself pixel-accurately) -- this package's tests need to prove DATA correctness
 * (the right text reaches the right component, a malicious escape sequence never reaches the raw
 * write stream, a keypress resolves the right promise), not pixel-perfect rendering, which is
 * `packages/tui`'s own test suite's job (round B2 task instruction: reuse what a package's own
 * suite already does to test itself headlessly rather than inventing a new strategy -- here that
 * means "record raw writes", the same minimal contract `packages/tui`'s own `Terminal` interface
 * asks an implementer for).
 */

import type { Terminal } from "@earendil-works/pi-tui";

export class FakeTerminal implements Terminal {
	private inputHandler?: (data: string) => void;
	private resizeHandler?: () => void;
	private _columns: number;
	private _rows: number;
	private writes: string[] = [];

	constructor(columns = 80, rows = 24) {
		this._columns = columns;
		this._rows = rows;
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;
	}

	stop(): void {
		this.inputHandler = undefined;
		this.resizeHandler = undefined;
	}

	async drainInput(): Promise<void> {}

	write(data: string): void {
		this.writes.push(data);
	}

	get columns(): number {
		return this._columns;
	}

	get rows(): number {
		return this._rows;
	}

	get kittyProtocolActive(): boolean {
		return false;
	}

	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}

	setTitle(title: string): void {
		this.writes.push(`\x1b]0;${title}\x07`);
	}

	setProgress(): void {}

	// --- Test-only helpers, not part of the Terminal interface ---

	/** Simulates one already-parsed key sequence arriving from the terminal (e.g. "\r" for Enter,
	 * "\x1b[B" for Down, "\x1b" for Escape) -- mirrors how ProcessTerminal's own StdinBuffer already
	 * delivers one sequence per callback invocation. */
	sendInput(data: string): void {
		this.inputHandler?.(data);
	}

	resize(columns: number, rows: number): void {
		this._columns = columns;
		this._rows = rows;
		this.resizeHandler?.();
	}

	/** Every byte ever written to this terminal, concatenated in order. */
	allWrites(): string {
		return this.writes.join("");
	}
}
