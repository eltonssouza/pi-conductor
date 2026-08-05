import { describe, expect, it } from "vitest";
import { evaluatePolicyFailClosed } from "../src/fail-closed.ts";

describe("evaluatePolicyFailClosed", () => {
	it("returns the decision unchanged when evaluate resolves normally", async () => {
		const result = await evaluatePolicyFailClosed(() => ({ block: false }));
		expect(result).toEqual({ block: false });
	});

	it("returns the decision unchanged for an explicit block", async () => {
		const result = await evaluatePolicyFailClosed(() => ({ block: true, reason: "denied by policy" }));
		expect(result).toEqual({ block: true, reason: "denied by policy" });
	});

	it("converts a synchronous throw into a fail-closed block", async () => {
		const result = await evaluatePolicyFailClosed(() => {
			throw new Error("boom");
		});
		expect(result.block).toBe(true);
		expect(result.reason).toContain("policy evaluation error — fail closed");
		expect(result.reason).toContain("boom");
	});

	it("converts an async rejection into a fail-closed block", async () => {
		const result = await evaluatePolicyFailClosed(async () => {
			throw new Error("async boom");
		});
		expect(result.block).toBe(true);
		expect(result.reason).toContain("policy evaluation error — fail closed");
		expect(result.reason).toContain("async boom");
	});

	it("handles a thrown non-Error value without itself throwing", async () => {
		const result = await evaluatePolicyFailClosed(() => {
			throw "a plain string failure";
		});
		expect(result.block).toBe(true);
		expect(result.reason).toContain("a plain string failure");
	});

	it("never throws, even under repeated failures", async () => {
		for (let i = 0; i < 5; i++) {
			await expect(
				evaluatePolicyFailClosed(() => {
					throw new Error(`failure ${i}`);
				}),
			).resolves.toMatchObject({ block: true });
		}
	});
});
