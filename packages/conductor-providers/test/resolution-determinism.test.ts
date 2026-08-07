/**
 * Test-first (Gate 5) for FR-6 (gate2-spec-fase7.md Grupo B) / ADR 0008-fase7-model-routing-and-providers.md
 * §5.1 (D3): resolveModelForGate is DETERMINISTIC. The same request over the same ResolutionContext
 * snapshot, invoked twice, resolves to the identical Model/ModelRef -- never "whichever candidate a Map
 * iteration happened to return first". Tie-break order is DECLARED (§5.1), not incidental:
 *   (1) declaration order in the project policy
 *   (2) declaration order in the user policy
 *   (3) provider, then modelId, lexicographic
 *
 * `resolveModelForGate`/`buildResolutionContext` do not exist yet (Gate 6 scope) -- every test below
 * fails RED today because `../src/index.ts` does not exist, exactly as intended for this Gate-5 stream
 * (contrast with this repo's older Gate-5 convention of a throwing stub -- this stream's task brief is
 * explicit: no src/ files at all).
 */

import { describe, expect, it } from "vitest";
import { resolveModelForGate } from "../src/index.ts";
import { baseContext, type ResolutionContextFixture, registerCandidate } from "./support/fixtures.ts";

const okCredential = { configured: true, source: "stored" as const, authorizedByPolicy: true };
const reachable = { state: "reachable" as const, checkedAt: "2026-08-07T00:00:00.000Z" };

function contextWithSingleCandidate(): ResolutionContextFixture {
	const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
	registerCandidate(ctx, "slow", {
		provider: "anthropic",
		modelId: "claude-opus-test",
		rank: 3,
		declaredIn: "project-policy",
		credential: okCredential,
		availability: reachable,
	});
	return ctx;
}

describe("resolveModelForGate determinism (FR-6, ADR §5.1 D3)", () => {
	it("the same request over the same context snapshot, invoked twice, resolves to the identical Model and ModelRef", () => {
		const ctx = contextWithSingleCandidate();
		const request = { gate: 9, purpose: "gate-open" as const };

		const first = resolveModelForGate(request, ctx as never);
		const second = resolveModelForGate(request, ctx as never);

		expect(first.resolved).toBe(true);
		expect(second.resolved).toBe(true);
		if (first.resolved && second.resolved) {
			expect(second.ref).toEqual(first.ref);
			expect(second.model).toEqual(first.model);
		}
	});

	it("tie-break rule 1: among candidates all declared in the PROJECT policy, the one declared FIRST in the array wins -- never object/Map iteration order", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "openai",
			modelId: "gpt-declared-first",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-declared-second",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(true);
		if (result.resolved) expect(result.ref).toEqual({ provider: "openai", modelId: "gpt-declared-first" });
	});

	it("tie-break rule 1 over rule 2: a PROJECT-policy candidate wins over a USER-policy candidate of equal rank, even when the user-policy one is declared earlier in binding order", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "openai",
			modelId: "gpt-user-policy-first-in-array",
			rank: 3,
			declaredIn: "user-policy",
			credential: okCredential,
			availability: reachable,
		});
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-project-policy-second-in-array",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(true);
		if (result.resolved) {
			expect(result.ref).toEqual({ provider: "anthropic", modelId: "claude-project-policy-second-in-array" });
		}
	});

	it("tie-break rule 3 (last resort): with no project/user policy declaration, candidates are ordered by provider then modelId, lexicographic", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "openai",
			modelId: "z-model",
			rank: 3,
			declaredIn: "builtin-default",
			credential: okCredential,
			availability: reachable,
		});
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "a-model",
			rank: 3,
			declaredIn: "builtin-default",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(true);
		// "anthropic" < "openai" lexicographically -- must win over provider-declaration/array order.
		if (result.resolved) expect(result.ref.provider).toBe("anthropic");
	});
});
