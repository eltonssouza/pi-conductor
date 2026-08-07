/**
 * Test-first (Gate 5) for R49/T68 (ADR 0008-fase7-model-routing-and-providers.md §6, §5.1 D3): the
 * resolution is fail-closed and UNIVERSAL across all 14 gates. `resolveModelForGate` NEVER throws --
 * every failure mode collapses to `{resolved: false, refusal, trace}`, a typed absence value, never a
 * thrown exception a caller could forget to catch (and never silently "proceed anyway").
 *
 * Six refusal kinds are exercised, one per test, each proven not merely by checking the return shape but
 * by wrapping the call so the test itself would fail if `resolveModelForGate` threw instead of returning:
 *   unsupported-gate, no-gate-mapping, no-binding-for-role, no-credential, all-candidates-unavailable,
 *   policy-unreadable (§8.2/D6: a PRESENT-but-corrupt policy must never collapse to "absent" -- that
 *   would be the exact hole an attacker corrupting a restrictive policy would want).
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { describe, expect, it } from "vitest";
import { resolveModelForGate } from "../src/index.ts";
import { baseContext, registerCandidate } from "./support/fixtures.ts";

const okCredential = { configured: true, source: "stored" as const, authorizedByPolicy: true };
const reachable = { state: "reachable" as const, checkedAt: "2026-08-07T00:00:00.000Z" };
const unreachable = {
	state: "unreachable" as const,
	checkedAt: "2026-08-07T00:00:00.000Z",
	detail: "connect ECONNREFUSED",
};

/** Calls resolveModelForGate and fails the test explicitly if it throws, instead of letting the runner
 * report an uncaught-exception failure -- makes the "never throws" claim an assertion, not an accident. */
function callWithoutThrowing(request: Parameters<typeof resolveModelForGate>[0], ctx: unknown) {
	let threw: unknown;
	let result: ReturnType<typeof resolveModelForGate> | undefined;
	try {
		result = resolveModelForGate(request, ctx as never);
	} catch (error) {
		threw = error;
	}
	expect(threw, `resolveModelForGate must never throw; it threw: ${String(threw)}`).toBeUndefined();
	return result as ReturnType<typeof resolveModelForGate>;
}

describe("R49/T68: resolveModelForGate is fail-closed and never throws, for every refusal kind", () => {
	it("unsupported-gate: gate outside 1..14 (edge case 8) refuses naming the valid range, never throws", () => {
		const ctx = baseContext();

		for (const badGate of [0, 15, -1]) {
			const result = callWithoutThrowing({ gate: badGate, purpose: "gate-open" }, ctx);
			expect(result.resolved, `gate=${badGate}`).toBe(false);
			if (!result.resolved) {
				expect(result.refusal.kind, `gate=${badGate}`).toBe("unsupported-gate");
				if (result.refusal.kind === "unsupported-gate") expect(result.refusal.validRange).toEqual([1, 14]);
			}
		}
	});

	it("no-gate-mapping: a gate within 1..14 but absent from gateModelRoles refuses naming exactly that gate (FR-10)", () => {
		const ctx = baseContext({ gateModelRoles: {} }); // gate 12 intentionally NOT mapped

		const result = callWithoutThrowing({ gate: 12, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("no-gate-mapping");
			if (result.refusal.kind === "no-gate-mapping") expect(result.refusal.gate).toBe(12);
		}
	});

	it("no-binding-for-role: the gate maps to a role, but no binding in the policy names any candidate for it (FR-8/FR-14)", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } }); // bindingsByRole.slow is empty

		const result = callWithoutThrowing({ gate: 9, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("no-binding-for-role");
			if (result.refusal.kind === "no-binding-for-role") {
				expect(result.refusal.gate).toBe(9);
				expect(result.refusal.role).toBe("slow");
			}
		}
	});

	it("no-credential: a binding exists and is authorized, but the provider has no configured credential at all", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-uncredentialed",
			rank: 3,
			declaredIn: "project-policy",
			credential: { configured: false, authorizedByPolicy: true },
			availability: reachable,
		});

		const result = callWithoutThrowing({ gate: 9, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("no-credential");
			if (result.refusal.kind === "no-credential") expect(result.refusal.providers).toContain("anthropic");
		}
	});

	it("all-candidates-unavailable: every authorized, credentialed binding is unreachable -- no fallback candidate exists either", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-down",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: unreachable,
		});

		const result = callWithoutThrowing({ gate: 9, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("all-candidates-unavailable");
			if (result.refusal.kind === "all-candidates-unavailable")
				expect(result.refusal.providers).toContain("anthropic");
		}
	});

	it("policy-unreadable: a PRESENT-but-corrupt policy refuses naming the gate -- it never collapses to 'absent' and falls back to built-in defaults (D6/§8.2, the anti-tamper property)", () => {
		const ctx = baseContext({
			gateModelRoles: { 9: { role: "slow", source: "builtin" } },
			policyUnreadable: "invalid JSON at .conductor/config.json:modelPolicy",
		});
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-would-otherwise-resolve",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = callWithoutThrowing({ gate: 9, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("policy-unreadable");
			if (result.refusal.kind === "policy-unreadable") expect(result.refusal.gate).toBe(9);
		}
	});
});
