/**
 * Query enrichment -- PURE (docs/adr/0006-fase5-library-and-grounding.md Apêndice §19; gate2-spec-
 * fase5.md FR-3/G4).
 *
 * GATE 5 (test-first): `enrichQuery` is a STUB that throws "not implemented" -- Gate 6 implements the
 * body. This file ships the signature test/query-enrichment.test.ts and hybrid-search.ts's caller
 * already compile and test against.
 *
 * FR-3 generalizes the reference's own `_project_context` (conductor-main/conductor/library.py, which
 * only prefixes project type + stack) to the FOUR axes the plan's own RAG pipeline names
 * (plano_desenvolvimento.md §4.11): project, stack, gate, and role -- role being the axis the
 * reference never had. The raw question is never searched un-enriched (FR-3's own Given/When/Then);
 * when NONE of the four axes are known (an empty/undefined context), enrichment degrades gracefully
 * -- the raw question still gets searched, it is not an error condition (Context Engineering --
 * Designing Information Environments for LLM Systems §4.1 "RAG Is a Context Decision, Not a Model
 * Feature": the `question -> [rewrite/expand] -> search` pipeline step is optional per-call, not a
 * hard gate that blocks search when context is thin).
 */

/** The four enrichment axes the plan's RAG pipeline names (plano_desenvolvimento.md §4.11). Every
 * field is optional -- a caller with no project/stack/gate/role context still gets a searchable
 * (unenriched, or minimally enriched) query back, never a thrown error. */
export interface QueryEnrichmentContext {
	projectType?: string;
	technologies?: string[];
	gate?: number;
	role?: string;
}

/**
 * Prefixes/rewrites `raw` with whichever of the four `ctx` axes are present, so the EFFECTIVELY
 * searched question always carries as much of the calling context as is known (FR-3). Never throws
 * on a partially- or fully-empty `ctx`; the raw question is always recoverable from the output (a
 * caller must never lose the literal question by enriching it).
 */
export function enrichQuery(raw: string, ctx: QueryEnrichmentContext): string {
	throw new Error("not implemented");
}
