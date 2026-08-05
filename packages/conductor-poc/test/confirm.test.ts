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
});
