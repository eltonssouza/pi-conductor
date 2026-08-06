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

	/**
	 * T21 sink #5 / GAP-C (gate3-addendum-fase2.md; docs/adr/0003-fase2-security-architecture.md
	 * §6.2 sink #5; gate2-spec-fase2.md BR-12): "mensagens de erro re-lançadas... fail-closed.ts
	 * devolve reason: policy evaluation error — fail closed: <message>, e <message> pode conter a
	 * string ofensora" (e.g. a thrown error embedding a secret-shaped value from a path/command an
	 * upstream evaluator was processing when it failed). This `reason` flows into the audit trail,
	 * the notify sink, and any log — so it must be redacted at its own source, independent of
	 * whether every downstream consumer also redacts (R6: "cada um redige independente").
	 */
	it("masks a secret-shaped value embedded in the thrown error's message (T21 sink #5)", async () => {
		const result = await evaluatePolicyFailClosed(() => {
			throw new Error("could not resolve path containing sk-ant-api03-FAKEFAKEFAKEFAKEFAKE");
		});
		expect(result.block).toBe(true);
		expect(result.reason).not.toContain("sk-ant-api03-FAKEFAKEFAKEFAKEFAKE");
		expect(result.reason).toContain("[REDACTED:");
		expect(result.reason).toContain("policy evaluation error — fail closed");
	});

	it("does not mask an ordinary error message with no secret-shaped content", async () => {
		const result = await evaluatePolicyFailClosed(() => {
			throw new Error("boom");
		});
		expect(result.reason).toBe("policy evaluation error — fail closed: boom");
	});
});
