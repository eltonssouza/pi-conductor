/**
 * `resolvePriceProvenance` -- D9/F1 (docs/adr/0008-fase7-model-routing-and-providers.md §11.1): `priced`
 * is decided by PROVENANCE -- is this (provider, modelId) pair present in the vendor's OWN generated
 * catalog (`getBuiltinModels`, `@earendil-works/pi-ai/providers/all`) -- never by the VALUE that already
 * arrived zero-filled. `Model.cost` is a REQUIRED field on `Model<Api>`
 * (packages/ai/src/types.ts:792), and `provider-composer.ts:157` (`modelFromJson`) fills a `models.json`
 * model definition that has NO `cost` block with `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`
 * -- so "no price was ever declared" arrives at the runtime type level INDISTINGUISHABLE from "genuinely
 * free". Reading `Model.cost` and reporting the product would be exactly the "silently zero" BR-10
 * forbids.
 *
 * Takes only a `ModelRef` (provider + modelId), deliberately never a full `Model` -- so it is
 * structurally IMPOSSIBLE for a correct caller to read the caller-supplied, possibly-zero-filled `.cost`
 * at all. It looks the pair up against the vendor catalog independently, every time.
 */

import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ModelRef, PriceProvenance } from "./types.ts";

export function resolvePriceProvenance(ref: ModelRef): PriceProvenance {
	let models: ReturnType<typeof getBuiltinModels>;
	try {
		models = getBuiltinModels(ref.provider as BuiltinProvider);
	} catch {
		// An unrecognized provider must never throw a pure lookup -- fail closed to "not in the vendor
		// catalog", the same disposition an empty result already produces.
		models = [];
	}
	const found = models.find((model) => model.id === ref.modelId);
	if (!found) {
		return { known: false, reason: "model-not-in-vendor-catalog" };
	}
	return {
		known: true,
		source: "vendor-catalog",
		rates: {
			input: found.cost.input,
			output: found.cost.output,
			cacheRead: found.cost.cacheRead,
			cacheWrite: found.cost.cacheWrite,
		},
	};
}
