/**
 * Delegation Graph Validator — `buildMergedGraph`/`findCycle`/`validateDelegationGraph`
 * (docs/adr/0004-fase3-roles-skills-subagents.md §4/§16; T32/R17b, docs/conductor/gate3-addendum-fase3.md).
 *
 * Exact signatures from ADR §16's appendix — reproduced verbatim so Gate 6 does not reinvent the
 * interface. Behavior reference (semantics, not code to port): `conductor-main/conductor/roles.py`'s
 * `merge_spawns`/`find_cycle` — a pure, dict-shaped DFS with no I/O, already unit-tested there. This
 * module is the pi-conductor's own port of that BEHAVIOR (union-never-override merge, first-seen
 * dedup, white/gray/black DFS), not a copy of the Python.
 *
 * GATE 5 (test-first): every function below is a STUB that throws "not implemented" — Gate 6
 * implements the bodies.
 *
 * The two validations this module owns run at DIFFERENT times, per ADR §4's "onde vive a checagem"
 * decision (answers gate2-spec-fase3.md §9 #4):
 *   - Cycle + unknown-target are STATIC properties of the graph as a whole — checked ONCE, when the
 *     Role Registry is built over the MERGED graph (built-in ∪ project additions). A failure here
 *     means the registry as a whole does not load ("fail-closed for the built-in": a project addition
 *     is REJECTED before it can widen the built-in graph into a cycle — R15/R17b).
 *   - `canSpawn`-authorized + depth-cap are necessarily PER-CALL checks (Gate 6's `task` tool), because
 *     they depend on data that does not exist at load time: which role is running now, and how deep
 *     the live delegation chain already is. Not this module's job — named here only so the boundary is
 *     explicit and this module is not mistaken for the whole of R17b.
 *
 * FR-12 deliberately DIVERGES from `merge_spawns`'s own behavior for an unknown edge target:
 * `merge_spawns` silently DROPS an edge to an unknown role (`t in known`, roles.py:353); this fase's
 * spec (gate2-spec-fase3.md FR-12, checkpointed at Gate 2) makes an unknown target a NAMED ERROR
 * instead — "a validação falha nomeando o alvo desconhecido — o grafo nunca contém uma aresta para um
 * nó que não existe." `buildMergedGraph` itself still follows the reference's drop-silently shape (it
 * is graph algebra, not validation); `validateDelegationGraph` is where FR-12's naming happens, by
 * inspecting `projectAdditions`/`builtin` for edges whose target never appears as an `id` in either
 * list, BEFORE (or alongside) computing the merged graph and its cycles.
 */

export type DelegationGraph = ReadonlyMap<string, ReadonlyArray<string>>;

export type DelegationGraphError =
	| { kind: "cycle"; path: string[] } // FR-10/FR-11 — the exact cycle path, e.g. ["A", "B", "A"], never a generic message
	| { kind: "unknown-target"; from: string; target: string }; // FR-12 — named, never a silent drop

export interface ValidateDelegationGraphResult {
	ok: boolean;
	graph: DelegationGraph;
	errors: DelegationGraphError[];
}

/**
 * UNION never override, first-seen-order dedup: for every role named as an `id` in `builtin` OR
 * `projectAdditions`, `merged[role] = dedup(builtin[role] ?? [] , projectAdditions[role] ?? [])`.
 * `builtin` is always a subgraph of the result — a project addition can only ADD an edge, never
 * silently strip one a built-in role shipped with (mirrors `merge_spawns`'s "no silent loss": the
 * built-in `canSpawn` lives in code, not in a project file, so a project role shadowing the same name
 * must never be able to strip those shipped edges just by existing).
 */
export function buildMergedGraph(
	builtin: ReadonlyArray<{ id: string; canSpawn: string[] }>,
	projectAdditions: ReadonlyArray<{ id: string; canSpawn: string[] }>,
): DelegationGraph {
	throw new Error("not implemented");
}

/**
 * The first delegation cycle in `graph`, returned as the exact path (e.g. `["A", "B", "C", "A"]`), or
 * `null` when the graph is acyclic. A white/gray/black depth-first search — the same algorithm shape
 * as `conductor-main/conductor/roles.py`'s `find_cycle`, so the merged (runtime) graph and any other
 * caller are proven acyclic by ONE algorithm.
 */
export function findCycle(graph: DelegationGraph): string[] | null {
	throw new Error("not implemented");
}

/**
 * Runs at Role Registry LOAD time (not per-`task`-call): builds the merged graph, checks every edge
 * target actually exists as a role (FR-12, named — never a silent drop), and runs `findCycle` over
 * the result (FR-10/FR-11). `ok: false` on either failure mode means the registry does not load — a
 * project addition is never allowed to widen the built-in graph into a cycle or an edge to nowhere.
 */
export function validateDelegationGraph(
	builtin: ReadonlyArray<{ id: string; canSpawn: string[] }>,
	projectAdditions: ReadonlyArray<{ id: string; canSpawn: string[] }>,
): ValidateDelegationGraphResult {
	throw new Error("not implemented");
}
