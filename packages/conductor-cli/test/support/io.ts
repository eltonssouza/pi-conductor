/**
 * An in-memory CliIO double for tests: captures everything a command would otherwise print to
 * stdout/stderr, so command/dispatcher tests can assert on output without touching the real
 * process streams.
 *
 * `tty` (Gate 6 loop-back) is an optional third-arg override for `CliIO.tty` -- omitted by default
 * (matching production `CliIO`'s own optionality), so every existing call site of this helper keeps
 * behaving exactly as before (headless, `gate approve`/`calibrate` always resolve `needs-human`/`auto`).
 * Tests that need a real-vs-simulated TTY pass it explicitly -- see `../support/tty.ts`'s
 * `fakeTtyStreams` for the paired in-memory stream double.
 */

import type { CliIO } from "../../src/cli.ts";
import type { TtyStreams } from "../../src/tty-confirm.ts";

export interface CapturingIo {
	io: CliIO;
	stdout(): string;
	stderr(): string;
}

export function createCapturingIo(cwd: string, tty?: TtyStreams): CapturingIo {
	let stdoutBuf = "";
	let stderrBuf = "";

	return {
		io: {
			cwd,
			stdout: {
				write: (s: string) => {
					stdoutBuf += s;
				},
			},
			stderr: {
				write: (s: string) => {
					stderrBuf += s;
				},
			},
			...(tty ? { tty } : {}),
		},
		stdout: () => stdoutBuf,
		stderr: () => stderrBuf,
	};
}
