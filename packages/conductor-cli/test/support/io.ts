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
 *
 * `isInteractive` (Gate 8 loop-back, ADR 0009 §5.3, finding 5): an optional fifth-arg override for
 * `CliIO.isInteractive` -- same optional/backward-compatible shape as `tty`/`homeDir`. A test whose
 * subject is the genuine interactive `gate approve` happy path (a simulated TTY answering "y", meaning
 * to reach a real `status:"approved"`) must pass `() => true` here explicitly -- `tty` alone only
 * simulates D3 LAYER 1 (which `ConfirmChannel` gets built); the independent layer 2 witness reads the
 * REAL process's own TTY state (`process.stdin.isTTY`), which is `undefined` under a test runner
 * regardless of what `tty` fakes, so omitting this seam correctly still refuses under vitest -- see
 * `../../src/cli.ts`'s own `CliIO.isInteractive` doc comment for the full rationale.
 */

import type { CliIO } from "../../src/cli.ts";
import type { InteractivityWitness } from "../../src/commands/gate.ts";
import type { TtyStreams } from "../../src/tty-confirm.ts";

export interface CapturingIo {
	io: CliIO;
	stdout(): string;
	stderr(): string;
}

export function createCapturingIo(
	cwd: string,
	tty?: TtyStreams,
	homeDir?: string,
	isInteractive?: InteractivityWitness,
): CapturingIo {
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
			...(isInteractive ? { isInteractive } : {}),
		},
		stdout: () => stdoutBuf,
		stderr: () => stderrBuf,
	};
}
