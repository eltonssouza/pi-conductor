/**
 * An in-memory CliIO double for tests: captures everything a command would otherwise print to
 * stdout/stderr, so command/dispatcher tests can assert on output without touching the real
 * process streams.
 */

import type { CliIO } from "../../src/cli.ts";

export interface CapturingIo {
	io: CliIO;
	stdout(): string;
	stderr(): string;
}

export function createCapturingIo(cwd: string): CapturingIo {
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
		},
		stdout: () => stdoutBuf,
		stderr: () => stderrBuf,
	};
}
