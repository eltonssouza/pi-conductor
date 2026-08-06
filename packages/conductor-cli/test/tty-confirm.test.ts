/**
 * Unit tests for the TTY confirmation channel (Gate 6 loop-back, src/tty-confirm.ts) -- the missing
 * POSITIVE path Gate 8 found live: `cli.ts`'s `headlessConfirmChannel` was hardcoded to always resolve
 * `false`, with no branch at all for a real interactive terminal, so `mintHumanApproval`'s one
 * production call site could never be fed a genuine `true`. These tests exercise
 * `createTtyConfirmChannel`/`resolveConfirmChannel` directly against INJECTED in-memory `node:stream`
 * streams -- never a real pty -- mirroring the same "inject the collaborator, test the decision for
 * real" split `@conductor/runtime`'s own `gate-evidence.ts` (`gitCommitExists`) already uses.
 *
 * End-to-end proof that this channel actually drives `conductor gate approve` to a genuine
 * `status:"approved"` (a real mandatory gate, a real git-commit evidence ref, a real persisted store)
 * lives in `test/commands/gate-cli.acceptance.test.ts` instead -- this file is the unit level for the
 * channel/selection logic itself.
 */

import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	createTtyConfirmChannel,
	headlessConfirmChannel,
	resolveConfirmChannel,
	type TtyStreams,
} from "../src/tty-confirm.ts";

interface FakeTty {
	streams: TtyStreams;
	written: () => string;
	push: (line: string) => void;
	end: () => void;
}

function fakeTty(options: { isTTY?: boolean } = {}): FakeTty {
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
		push: (line: string) => {
			stdin.push(`${line}\n`);
		},
		end: () => {
			stdin.push(null);
		},
	};
}

describe("createTtyConfirmChannel (Gate 6 loop-back: the real interactive path mintHumanApproval was missing)", () => {
	it('resolves true for a "y" answer', async () => {
		const fake = fakeTty();
		const channel = createTtyConfirmChannel(fake.streams);

		const resultPromise = channel("Approve gate 3?", "Approve gate 3 for demand default?");
		fake.push("y");

		expect(await resultPromise).toBe(true);
	});

	it('resolves true for a "yes" answer, case-insensitive and trimmed', async () => {
		const fake = fakeTty();
		const channel = createTtyConfirmChannel(fake.streams);

		const resultPromise = channel("Approve gate 3?", "message");
		fake.push("  YES  ");

		expect(await resultPromise).toBe(true);
	});

	it('resolves false for a "n" answer', async () => {
		const fake = fakeTty();
		const channel = createTtyConfirmChannel(fake.streams);

		const resultPromise = channel("Approve gate 3?", "message");
		fake.push("n");

		expect(await resultPromise).toBe(false);
	});

	it("resolves false for an empty line -- deny is the safe default on ambiguity, never true", async () => {
		const fake = fakeTty();
		const channel = createTtyConfirmChannel(fake.streams);

		const resultPromise = channel("Approve gate 3?", "message");
		fake.push("");

		expect(await resultPromise).toBe(false);
	});

	it("resolves false, never hangs, if the input stream ends before any answer is given (fail-closed on stream close)", async () => {
		const fake = fakeTty();
		const channel = createTtyConfirmChannel(fake.streams);

		const resultPromise = channel("Approve gate 3?", "message");
		fake.end();

		expect(await resultPromise).toBe(false);
	});

	it("writes the title and message to the output stream before prompting", async () => {
		const fake = fakeTty();
		const channel = createTtyConfirmChannel(fake.streams);

		const resultPromise = channel("Approve gate 3?", "Approve gate 3 for demand default?");
		fake.push("y");
		await resultPromise;

		expect(fake.written()).toContain("Approve gate 3?");
		expect(fake.written()).toContain("Approve gate 3 for demand default?");
	});
});

describe("resolveConfirmChannel (Gate 6 loop-back decision 1: pick the real TTY channel only when both stdin AND stdout are genuinely interactive)", () => {
	it("returns the headless, always-false channel when streams is undefined (no tty info at all -- e.g. an older/plain CliIO)", async () => {
		const channel = resolveConfirmChannel(undefined);

		expect(channel).toBe(headlessConfirmChannel);
		expect(await channel("t", "m")).toBe(false);
	});

	it("returns the headless channel when stdin is not a TTY (e.g. piped input) even though stdout is", async () => {
		const stdout = new Writable({
			write(_c, _e, cb) {
				cb();
			},
		}) as Writable & { isTTY?: boolean };
		stdout.isTTY = true;
		const stdin = new Readable({ read() {} }) as Readable & { isTTY?: boolean };
		stdin.isTTY = false;

		const channel = resolveConfirmChannel({ stdin, stdout });

		expect(channel).toBe(headlessConfirmChannel);
		expect(await channel("t", "m")).toBe(false);
	});

	it("returns the headless channel when stdout is not a TTY (e.g. redirected to a file) even though stdin is", async () => {
		const stdout = new Writable({
			write(_c, _e, cb) {
				cb();
			},
		}) as Writable & { isTTY?: boolean };
		stdout.isTTY = false;
		const stdin = new Readable({ read() {} }) as Readable & { isTTY?: boolean };
		stdin.isTTY = true;

		const channel = resolveConfirmChannel({ stdin, stdout });

		expect(channel).toBe(headlessConfirmChannel);
		expect(await channel("t", "m")).toBe(false);
	});

	it("returns a real interactive channel (not the headless one) when BOTH stdin and stdout are TTY", async () => {
		const fake = fakeTty({ isTTY: true });

		const channel = resolveConfirmChannel(fake.streams);
		expect(channel).not.toBe(headlessConfirmChannel);

		const resultPromise = channel("t", "m");
		fake.push("y");
		expect(await resultPromise).toBe(true);
	});
});
