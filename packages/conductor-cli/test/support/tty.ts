/**
 * An in-memory `TtyStreams` double for tests (Gate 6 loop-back) -- never a real pty. Mirrors
 * `test/tty-confirm.test.ts`'s own local fixture, promoted here so end-to-end acceptance tests
 * (`test/commands/gate-cli.acceptance.test.ts`) can build one without duplicating the setup.
 */

import { Readable, Writable } from "node:stream";
import type { TtyStreams } from "../../src/tty-confirm.ts";

export interface FakeTty {
	streams: TtyStreams;
	written: () => string;
	/** Feeds one line of simulated keyboard input (e.g. "y", "n") to the fake TTY prompt. */
	answer: (line: string) => void;
	/** Ends the fake stdin (simulates the terminal closing before an answer is given). */
	end: () => void;
}

export function fakeTtyStreams(options: { isTTY?: boolean } = {}): FakeTty {
	let chunks = "";
	const stdout = new Writable({
		write(chunk, _enc, callback) {
			chunks += chunk.toString();
			callback();
		},
	}) as Writable & { isTTY?: boolean };
	stdout.isTTY = options.isTTY ?? true;

	const stdin = new Readable({ read() {} }) as Readable & { isTTY?: boolean };
	stdin.isTTY = options.isTTY ?? true;

	return {
		streams: { stdin, stdout },
		written: () => chunks,
		answer: (line: string) => {
			stdin.push(`${line}\n`);
		},
		end: () => {
			stdin.push(null);
		},
	};
}
