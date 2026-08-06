import { describe, expect, it } from "vitest";
import { confirmOrDeny } from "../src/confirm.ts";
import { createTestUiContext } from "./support/test-ui.ts";

describe("confirmOrDeny", () => {
	it("denies immediately when no UI is bound (hasUI: false)", async () => {
		const ui = createTestUiContext({ confirmResult: true });
		const result = await confirmOrDeny({ ui, hasUI: false }, "t", "m");
		expect(result).toBe(false);
		// No UI available means we must not even attempt to prompt.
		expect(ui.confirmCalls).toHaveLength(0);
	});

	it("allows when ctx.ui.confirm() resolves true", async () => {
		const ui = createTestUiContext({ confirmResult: true });
		const result = await confirmOrDeny({ ui, hasUI: true }, "t", "m");
		expect(result).toBe(true);
		expect(ui.confirmCalls).toEqual([{ title: "t", message: "m" }]);
	});

	it("denies when ctx.ui.confirm() resolves false", async () => {
		const ui = createTestUiContext({ confirmResult: false });
		const result = await confirmOrDeny({ ui, hasUI: true }, "t", "m");
		expect(result).toBe(false);
	});

	it("denies when ctx.ui.confirm() rejects", async () => {
		const ui = {
			...createTestUiContext(),
			confirm: async () => {
				throw new Error("dialog crashed");
			},
		};
		const result = await confirmOrDeny({ ui, hasUI: true }, "t", "m");
		expect(result).toBe(false);
	});

	it("denies on timeout even though confirm() never settles (fail closed, not fail open)", async () => {
		const ui = createTestUiContext({ hangConfirm: true });
		const result = await confirmOrDeny({ ui, hasUI: true }, "t", "m", 25);
		expect(result).toBe(false);
	});

	// T14 (gate3-fase1-addendum.md §2 T14, §3 secure default 11): title/message may contain
	// model-controlled text (a tool's path/command/note argument). confirmOrDeny is the single sink
	// every approval call site (write/edit/bash/conductor_note) funnels through, so sanitizing here
	// covers all of them at once — see permission-gate.test.ts for a proof at each individual call
	// site through the real gate.
	describe("terminal sanitization (T14)", () => {
		it("strips a real ANSI escape sequence (clear-line + cursor-move) from the message before it reaches ctx.ui.confirm()", async () => {
			const ui = createTestUiContext({ confirmResult: true });
			// \x1b[2K clears the current line; \x1b[1G moves the cursor to column 1 — together, a
			// real sequence that could overwrite/hide the approval prompt's own text if rendered raw.
			const maliciousPath = "hello.txt\x1b[2K\x1b[1GAPPROVED — nothing to see here";

			await confirmOrDeny({ ui, hasUI: true }, "Approve edit?", `edit ${maliciousPath}`);

			expect(ui.confirmCalls).toHaveLength(1);
			const shownMessage = ui.confirmCalls[0]?.message as string;
			expect(shownMessage).not.toContain("\x1b");
			expect(shownMessage).not.toContain("\x1b[2K");
			expect(shownMessage).not.toContain("\x1b[1G");
			// The literal (non-control) text on either side of the escape sequence still comes
			// through — this is sanitization, not a truncation that would hide the real target.
			expect(shownMessage).toContain("hello.txt");
			expect(shownMessage).toContain("APPROVED — nothing to see here");
		});

		it("strips an OSC sequence (e.g. a forged terminal title/hyperlink) from the message", async () => {
			const ui = createTestUiContext({ confirmResult: true });
			// OSC 0 (set window title), BEL-terminated.
			const maliciousCommand = "rm -rf /tmp/x\x1b]0;Definitely Not Dangerous\x07 && echo done";

			await confirmOrDeny({ ui, hasUI: true }, "Approve bash command?", maliciousCommand);

			const shownMessage = ui.confirmCalls[0]?.message as string;
			expect(shownMessage).not.toContain("\x1b");
			expect(shownMessage).not.toContain("\x07");
			expect(shownMessage).toContain("rm -rf /tmp/x");
		});

		it("sanitizes the title as well as the message", async () => {
			const ui = createTestUiContext({ confirmResult: true });

			await confirmOrDeny({ ui, hasUI: true }, "Approve edit\x1b[2K?", "m");

			expect(ui.confirmCalls[0]?.title).not.toContain("\x1b");
		});

		it("preserves plain newlines and tabs (sanitization does not mangle ordinary multi-line content)", async () => {
			const ui = createTestUiContext({ confirmResult: true });

			await confirmOrDeny({ ui, hasUI: true }, "t", "line one\n\tindented line two");

			expect(ui.confirmCalls[0]?.message).toBe("line one\n\tindented line two");
		});
	});
});
