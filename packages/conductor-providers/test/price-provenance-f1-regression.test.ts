/**
 * Test-first (Gate 5) for F1 -- a REAL, already-confirmed defect in the vendor substrate, not a
 * hypothetical (ADR 0008-fase7-model-routing-and-providers.md §1.1 table row F1, §11.1 D9):
 *
 *   `Model.cost` is a REQUIRED field on the `Model<Api>` type (packages/ai/src/types.ts:792), and
 *   `packages/coding-agent/src/core/provider-composer.ts:157` (`modelFromJson`) fills a `models.json`
 *   model definition that has NO `cost` block with:
 *
 *       cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
 *
 *   -- so "no price was ever declared for this model" arrives at the runtime type-level INDISTINGUISHABLE
 *   from "this model genuinely costs $0". D9's decision: the ledger must NEVER read `Model.cost` as price
 *   truth. `priced` has to be decided by PROVENANCE (is this (provider, modelId) pair present in the
 *   vendor's OWN generated catalog, `getBuiltinModel`/`MODELS` via the public subpath
 *   `@earendil-works/pi-ai/providers/all`?) -- never by the value that already arrived zero-filled.
 *
 * This test reaches the REAL zero-fill via the REAL vendor call path -- `ModelRuntime.create()` composing
 * a custom provider declared in a scratch `models.json` (no `cost` block on its one model), then
 * `runtime.getModel(...)` -- never a hand-built `Model` literal with `cost: {0,0,0,0}` typed in directly.
 * That is the concrete repro Gate 6 can rerun to confirm the fix.
 *
 * JUDGMENT CALL flagged for Gate 6: the ADR never names the function that computes `PriceProvenance` for
 * a given model. This file assumes `resolvePriceProvenance(ref: ModelRef): PriceProvenance`, deliberately
 * taking only a `ModelRef` (provider+modelId) rather than a full `Model` -- so it is structurally
 * IMPOSSIBLE for a correct implementation to read the caller-supplied (possibly zero-filled) `.cost` at
 * all; it must look the pair up against the vendor catalog independently. `PriceProvenance`'s two
 * `known:false` reasons ("model-not-in-vendor-catalog" vs "declared-without-cost") are not disambiguated
 * anywhere in the ADR text for this exact scenario (a model added under a custom, non-vendor provider) --
 * this test asserts `known: false` firmly and accepts either declared reason, rather than guessing one.
 *
 * Fails RED today: `../src/index.ts` does not exist yet.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePriceProvenance } from "../src/index.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

afterEach(() => {
	workspace?.cleanup();
});

describe("F1 regression: a model declared in models.json WITHOUT a cost block never reads as a known, real price", () => {
	it("reproduces the real vendor zero-fill (provider-composer.ts:157) via ModelRuntime.create(), then proves the price-provenance logic reports known:false instead of trusting it", async () => {
		workspace = createScratchWorkspace();
		const modelsJsonPath = join(workspace.agentDir, "models.json");
		const CUSTOM_PROVIDER = "acme-custom-provider-f1-repro";
		const CUSTOM_MODEL_ID = "acme-custom-model-without-cost";
		writeFileSync(
			modelsJsonPath,
			JSON.stringify({
				providers: {
					[CUSTOM_PROVIDER]: {
						baseUrl: "https://acme-custom-provider.invalid/v1",
						api: "openai-completions",
						models: [
							{
								id: CUSTOM_MODEL_ID,
								reasoning: false,
								input: ["text"],
								contextWindow: 32_000,
								maxTokens: 4_096,
								// deliberately NO "cost" field -- this is the exact shape that reaches
								// provider-composer.ts:157's `definition.cost ?? {0,0,0,0}` zero-fill.
							},
						],
					},
				},
			}),
		);

		const modelRuntime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: modelsJsonPath,
			allowModelNetwork: false,
		});

		// Step 1: prove the REAL defect is reproduced via the REAL vendor composition path -- not asserted
		// against a hand-built literal.
		const composedModel = modelRuntime.getModel(CUSTOM_PROVIDER, CUSTOM_MODEL_ID);
		expect(composedModel).toBeDefined();
		expect(composedModel?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

		// Step 2: the not-yet-existing price-provenance logic must NEVER read that zeroed `.cost` as
		// "known, real pricing" -- it has to independently fail to find this (provider, modelId) pair in
		// the vendor's OWN generated catalog and report the absence honestly (BR-10/F1).
		const provenance = resolvePriceProvenance({ provider: CUSTOM_PROVIDER, modelId: CUSTOM_MODEL_ID });

		expect(provenance.known).toBe(false);
		if (!provenance.known) {
			expect(["model-not-in-vendor-catalog", "declared-without-cost"]).toContain(provenance.reason);
		}
	});

	it("a REAL vendor built-in model (present in the generated catalog) reports known:true with the catalog's own rates -- the positive case, so the negative case above cannot be satisfied by an implementation that just always returns known:false", async () => {
		const { getBuiltinModels } = await import("@earendil-works/pi-ai/providers/all");
		const anthropicModels = getBuiltinModels("anthropic");
		expect(anthropicModels.length).toBeGreaterThan(0); // sanity: the generated catalog data is present in this checkout.
		const [knownModel] = anthropicModels;

		const provenance = resolvePriceProvenance({ provider: "anthropic", modelId: knownModel!.id });

		expect(provenance.known).toBe(true);
		if (provenance.known) {
			expect(provenance.source).toBe("vendor-catalog");
			expect(provenance.rates).toBeDefined();
		}
	});
});
