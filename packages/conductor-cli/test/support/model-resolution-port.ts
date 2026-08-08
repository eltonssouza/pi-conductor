/**
 * `ModelResolutionPort` doubles for tests whose subject is the gate STORE's own semantics (approve
 * idempotency, decision kinds, evidence), not Fase 7's model precondition.
 *
 * Why this file exists at all: ADR 0008 §21/D11 made `PersistedGateStateStoreOptions.
 * modelResolutionPort` REQUIRED. That is the point of the change -- while it was optional, production
 * never passed one and the fail-closed check was permanently inert (the mutation
 * "`evaluateModelPrecondition` always returns satisfied" survived every suite). Making it required
 * means a caller cannot forget it; it also means these older tests have to state, explicitly, that
 * they are not exercising that axis. `alwaysSatisfiedModelResolutionPort()` is that explicit
 * statement -- a stub for a collaborator genuinely outside the test's subject, not a way to disable a
 * check the test should be feeling.
 *
 * The precondition's REAL enforcement (both directions: a policy that refuses, and no policy at all
 * that must still advance) is locked end-to-end, through `runCli`, by
 * `test/commands/model-precondition-enforcement.test.ts`.
 */

import type { ModelResolution, ResolveModelRequest } from "@conductor/providers";
import type { ModelResolutionPort } from "@conductor/runtime";

const STUB_MODEL = {
	id: "claude-sonnet-5",
	name: "claude-sonnet-5",
	provider: "anthropic",
	api: "anthropic-messages",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	contextWindow: 200_000,
	maxTokens: 8192,
} as never;

/** Resolves every gate. Use ONLY where the model precondition is not the subject under test. */
export function alwaysSatisfiedModelResolutionPort(): ModelResolutionPort {
	return {
		resolveForGate: (request: ResolveModelRequest): ModelResolution => ({
			resolved: true,
			model: STUB_MODEL,
			ref: { provider: "anthropic", modelId: "claude-sonnet-5" },
			effectiveRank: 3,
			trace: { gate: request.gate, at: new Date().toISOString(), steps: [] },
		}),
	};
}
