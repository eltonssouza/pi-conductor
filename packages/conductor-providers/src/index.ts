/**
 * `@conductor/providers` -- public entry point (docs/adr/0008-fase7-model-routing-and-providers.md §16,
 * "@conductor/providers -- o motor" section). See resolve.ts/resolution-context.ts/availability-cache.ts/
 * price-provenance.ts/usage-ledger.ts/types.ts for the implementation and per-module grounding notes.
 */

export {
	AVAILABILITY_DEFAULTS,
	type CreateAvailabilityCacheOptions,
	createAvailabilityCache,
} from "./availability-cache.ts";
export { resolvePriceProvenance } from "./price-provenance.ts";
export { type BuildResolutionContextOptions, buildResolutionContext } from "./resolution-context.ts";
export { resolveModelForGate } from "./resolve.ts";
export type {
	AvailabilityCache,
	AvailabilityStatus,
	CandidateView,
	CredentialStatus,
	ModelRef,
	ModelResolution,
	PriceProvenance,
	ProviderAvailability,
	ResolutionContext,
	ResolutionRefusal,
	ResolutionStep,
	ResolutionTrace,
	ResolvedCandidate,
	ResolveModelRequest,
	UsageRecord,
} from "./types.ts";
export {
	openUsageLedgerReader,
	openUsageLedgerWriter,
	type UsageLedgerReader,
	type UsageLedgerWriter,
} from "./usage-ledger.ts";
