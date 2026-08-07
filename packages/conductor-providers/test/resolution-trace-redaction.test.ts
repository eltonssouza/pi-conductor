/**
 * Test-first (Gate 5) for R50/T69 (ADR 0008-fase7-model-routing-and-providers.md §16, ResolutionStep
 * stage "credential"): the trace's credential stage records ONLY
 *   `{provider, configured, source, authorizedByPolicy}`
 * -- never credential material. "Errors nomeiam o provedor, nunca a chave" (R50(ii)).
 *
 * The attack surface this proves closed: a `Model` (real vendor type, `@earendil-works/pi-ai`) can
 * legitimately carry a `headers` map (e.g. a custom `Authorization` header for an openai-compatible
 * provider, `model-config.ts`'s own schema) -- if trace-building code ever copied a whole candidate/Model
 * object into the trace instead of hand-picking the four allowed fields, a secret sitting in `headers`
 * would leak into `models why`'s output and the audit trail. This test plants a realistic-looking fake
 * secret in exactly that field and proves it never reaches `JSON.stringify(trace)`.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { describe, expect, it } from "vitest";
import { resolveModelForGate } from "../src/index.ts";
import { baseContext, registerCandidate } from "./support/fixtures.ts";

const FAKE_SECRET = "sk-ant-FAKE-TEST-VALUE-1234567890";

const okCredential = { configured: true, source: "stored" as const, authorizedByPolicy: true };
const reachable = { state: "reachable" as const, checkedAt: "2026-08-07T00:00:00.000Z" };

describe("R50/T69: the ResolutionTrace never carries credential material, even when it is reachable from a candidate's Model object", () => {
	it("a fake secret sitting in the resolved Model's headers never appears anywhere in JSON.stringify(trace)", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-with-inline-header-secret",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
			model: { headers: { Authorization: `Bearer ${FAKE_SECRET}` } },
		});

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		expect(result.resolved).toBe(true);
		const serializedTrace = JSON.stringify(result.trace);
		expect(serializedTrace).not.toContain(FAKE_SECRET);
		expect(serializedTrace).not.toContain("Authorization");
	});

	it("every entry in the credential trace stage exposes ONLY the four contracted fields -- no extra field could smuggle a secret through", () => {
		const ctx = baseContext({ gateModelRoles: { 9: { role: "slow", source: "builtin" } } });
		registerCandidate(ctx, "slow", {
			provider: "anthropic",
			modelId: "claude-plain",
			rank: 3,
			declaredIn: "project-policy",
			credential: okCredential,
			availability: reachable,
		});

		const result = resolveModelForGate({ gate: 9, purpose: "gate-open" }, ctx as never);

		const credentialStep = result.trace.steps.find(
			(step): step is Extract<typeof step, { stage: "credential" }> => step.stage === "credential",
		);
		expect(credentialStep).toBeDefined();
		if (credentialStep) {
			const allowedKeys = ["provider", "configured", "source", "authorizedByPolicy"];
			expect(credentialStep.perProvider.length).toBeGreaterThan(0);
			for (const entry of credentialStep.perProvider) {
				expect(entry).toHaveProperty("provider");
				expect(entry).toHaveProperty("configured");
				expect(entry).toHaveProperty("authorizedByPolicy");
				for (const key of Object.keys(entry)) {
					expect(allowedKeys).toContain(key);
				}
			}
		}
	});
});
