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
	const builtinById = new Map(builtin.map((role) => [role.id, role.canSpawn] as const));
	const projectById = new Map(projectAdditions.map((role) => [role.id, role.canSpawn] as const));
	const allIds = new Set<string>([...builtinById.keys(), ...projectById.keys()]);

	const merged = new Map<string, string[]>();
	for (const id of allIds) {
		const builtinEdges = builtinById.get(id) ?? [];
		const projectEdges = projectById.get(id) ?? [];
		// Union never override, first-seen order: the built-in edges always come first (never
		// silently stripped by a project addition of the same role id), a project edge already
		// present in builtin is deduped rather than duplicated.
		const seen = new Set<string>();
		const edges: string[] = [];
		for (const target of [...builtinEdges, ...projectEdges]) {
			if (!seen.has(target)) {
				seen.add(target);
				edges.push(target);
			}
		}
		merged.set(id, edges);
	}
	return merged;
}

/**
 * The first delegation cycle in `graph`, returned as the exact path (e.g. `["A", "B", "C", "A"]`), or
 * `null` when the graph is acyclic. A white/gray/black depth-first search — the same algorithm shape
 * as `conductor-main/conductor/roles.py`'s `find_cycle`, so the merged (runtime) graph and any other
 * caller are proven acyclic by ONE algorithm.
 */
export function findCycle(graph: DelegationGraph): string[] | null {
	// White/gray/black DFS (roles.py's find_cycle behavior, ported): "gray" = on the current
	// recursion stack (an ancestor of the node being visited), "black" = fully explored, no path to
	// a cycle through it. A node not in `colors` is implicitly white (unvisited) — using a Map
	// rather than pre-sizing from graph.keys() lets a canSpawn target that is not itself a graph key
	// (an edge to a leaf that never appears as its own `id`) still be visited as a childless node,
	// without findCycle needing to know about validateDelegationGraph's separate unknown-target check.
	const colors = new Map<string, "gray" | "black">();
	const stack: string[] = [];

	function visit(node: string): string[] | null {
		colors.set(node, "gray");
		stack.push(node);

		for (const neighbor of graph.get(node) ?? []) {
			const color = colors.get(neighbor);
			if (color === "gray") {
				// Closed a cycle back to an ancestor still on the stack: the exact path is that
				// ancestor's position onward, plus the repeated node to make the closure explicit
				// (FR-10/FR-11: "the exact path", e.g. ["A", "B", "A"], never a generic message).
				const cycleStart = stack.indexOf(neighbor);
				return [...stack.slice(cycleStart), neighbor];
			}
			if (color !== "black") {
				const cycle = visit(neighbor);
				if (cycle) return cycle;
			}
		}

		stack.pop();
		colors.set(node, "black");
		return null;
	}

	for (const node of graph.keys()) {
		if (!colors.has(node)) {
			const cycle = visit(node);
			if (cycle) return cycle;
		}
	}
	return null;
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
	const graph = buildMergedGraph(builtin, projectAdditions);
	const errors: DelegationGraphError[] = [];

	// FR-12: named, never a silent drop. Checked against the MERGED graph's own key set (the union
	// of every `id` declared by builtin OR project) rather than re-deriving it from the two input
	// lists a second time — one source of truth for "what counts as a known role".
	const knownIds = new Set(graph.keys());
	for (const [from, targets] of graph) {
		for (const target of targets) {
			if (!knownIds.has(target)) {
				errors.push({ kind: "unknown-target", from, target });
			}
		}
	}

	// R17b/T32: acyclicity is checked over the MERGED graph, fail-closed for the built-in — a
	// project addition that closes a cycle the built-in alone did not have is rejected exactly like
	// a cycle the built-in shipped with; validateDelegationGraph does not distinguish the two.
	const cycle = findCycle(graph);
	if (cycle) {
		errors.push({ kind: "cycle", path: cycle });
	}

	return { ok: errors.length === 0, graph, errors };
}
