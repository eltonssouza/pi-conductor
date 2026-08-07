/**
 * `@conductor/library` public surface (docs/adr/0006-fase5-library-and-grounding.md D8/§11.1).
 *
 * GATE 5 (test-first): every function re-exported here is a STUB throwing "not implemented" --
 * see each module's own header for what Gate 6 implements. `corpus-store.ts`/`embedding-client.ts`
 * have no dedicated Gate-5 test this round (see their own file headers) and are re-exported for
 * package-shape completeness only.
 */

export * from "./chunking.ts";
export * from "./code-index.ts";
export * from "./corpus-store.ts";
export * from "./embedding-client.ts";
export * from "./fts-query.ts";
export * from "./grounding-ledger.ts";
export * from "./hybrid-search.ts";
export * from "./library-home.ts";
export * from "./query-enrichment.ts";
export * from "./remote-endpoint.ts";
