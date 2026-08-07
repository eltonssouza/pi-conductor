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
 *
 * `homeDir` (Gate 6 real-wiring loop-back, Grupo F "captura automática"): an optional fourth-arg
 * override for `CliIO.homeDir` -- same optional/backward-compatible shape as `tty`. Tests that exercise
 * `gate approve`/`reject`'s new gate-concluded diary capture pass a scratch directory (`../support/
 * scratch-home.ts`'s `createScratchHome`) here so the write never touches this machine's real
 * `~/.conductor/diary`.
 */

import type { CliIO } from "../../src/cli.ts";
import type { TtyStreams } from "../../src/tty-confirm.ts";

export interface CapturingIo {
	io: CliIO;
	stdout(): string;
	stderr(): string;
}

export function createCapturingIo(cwd: string, tty?: TtyStreams, homeDir?: string): CapturingIo {
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
			...(homeDir ? { homeDir } : {}),
		},
		stdout: () => stdoutBuf,
		stderr: () => stderrBuf,
	};
}
