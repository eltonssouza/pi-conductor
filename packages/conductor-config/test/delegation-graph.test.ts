/**
 * Gate 5 (test-first) for delegation-graph.ts — derives FR-10/FR-11/FR-12 (docs/conductor/gate2-spec-fase3.md
 * Grupo E) and BR-3, plus T32/R17b (docs/conductor/gate3-addendum-fase3.md) and ADR 0004 §4's
 * load-time-vs-per-call split. Every test below MUST fail RED right now: `buildMergedGraph`/
 * `findCycle`/`validateDelegationGraph` are stubs that throw "not implemented" (Gate 6 implements the
 * bodies).
 *
 * Behavior reference (semantics, not code to port): `conductor-main/conductor/roles.py`'s
 * `merge_spawns`/`find_cycle` — a pure, already-unit-tested DFS this fase ports the BEHAVIOR of, not
 * the Python.
 */

import { describe, expect, it } from "vitest";
import { buildMergedGraph, findCycle, validateDelegationGraph } from "../src/delegation-graph.ts";

// ---------------------------------------------------------------------------------------------
// buildMergedGraph — union never override, first-seen dedup (roles.py:merge_spawns's behavior)
// ---------------------------------------------------------------------------------------------

describe("buildMergedGraph", () => {
	it("is the identity graph when there are no project additions", () => {
		const builtin = [
			{ id: "tech-lead", canSpawn: ["software-engineer", "backend-engineer"] },
			{ id: "software-engineer", canSpawn: [] },
			{ id: "backend-engineer", canSpawn: [] },
		];

		const merged = buildMergedGraph(builtin, []);

		expect(merged.get("tech-lead")).toEqual(["software-engineer", "backend-engineer"]);
		expect(merged.get("software-engineer")).toEqual([]);
	});

	// AC-T6a-01 analog: a role with ZERO built-in canSpawn gains one via a pure project addition.
	it("a project addition can ADD an edge to a role that had none in the builtin graph", () => {
		const builtin = [
			{ id: "business-analyst", canSpawn: [] as string[] },
			{ id: "security-engineer", canSpawn: [] as string[] },
		];
		const projectAdditions = [{ id: "business-analyst", canSpawn: ["security-engineer"] }];

		const merged = buildMergedGraph(builtin, projectAdditions);

		expect(merged.get("business-analyst")).toEqual(["security-engineer"]);
	});

	// "no silent loss": builtin is always a subgraph of the result — a project role of the same name
	// must never be able to strip a shipped edge just by existing (only ADD is possible here; removal
	// is not an operation this merge exposes).
	it("never drops a builtin edge even when a project addition for the same role exists", () => {
		const builtin = [
			{ id: "tech-lead", canSpawn: ["software-engineer"] },
			{ id: "software-engineer", canSpawn: [] as string[] },
			{ id: "sdet", canSpawn: [] as string[] },
		];
		const projectAdditions = [{ id: "tech-lead", canSpawn: ["sdet"] }];

		const merged = buildMergedGraph(builtin, projectAdditions);

		expect(merged.get("tech-lead")).toEqual(expect.arrayContaining(["software-engineer", "sdet"]));
	});

	it("de-duplicates an edge present in both the builtin and a project addition (first-seen order)", () => {
		const builtin = [
			{ id: "tech-lead", canSpawn: ["software-engineer"] },
			{ id: "software-engineer", canSpawn: [] as string[] },
		];
		const projectAdditions = [{ id: "tech-lead", canSpawn: ["software-engineer"] }];

		const merged = buildMergedGraph(builtin, projectAdditions);

		expect(merged.get("tech-lead")).toEqual(["software-engineer"]);
	});
});

// ---------------------------------------------------------------------------------------------
// findCycle — pure DFS over an already-built graph
// ---------------------------------------------------------------------------------------------

describe("findCycle", () => {
	it("returns null for an acyclic graph", () => {
		const graph = new Map([
			["tech-lead", ["software-engineer", "backend-engineer"]],
			["software-engineer", []],
			["backend-engineer", []],
		]);

		expect(findCycle(graph)).toBeNull();
	});

	it("finds a 2-node cycle and names the exact path", () => {
		const graph = new Map([
			["A", ["B"]],
			["B", ["A"]],
		]);

		expect(findCycle(graph)).toEqual(["A", "B", "A"]);
	});

	it("finds a 3+-node cycle and names the exact path", () => {
		const graph = new Map([
			["A", ["B"]],
			["B", ["C"]],
			["C", ["A"]],
		]);

		expect(findCycle(graph)).toEqual(["A", "B", "C", "A"]);
	});
});

// ---------------------------------------------------------------------------------------------
// validateDelegationGraph — FR-10/FR-11/FR-12/BR-3: runs at LOAD time over the MERGED graph,
// fail-closed for the builtin (a project addition never gets to widen the builtin into a cycle
// or an edge to nowhere).
// ---------------------------------------------------------------------------------------------

describe("validateDelegationGraph", () => {
	it("FR-10: rejects a 2-node cycle introduced entirely by the builtin graph, naming the exact cycle", () => {
		const builtin = [
			{ id: "A", canSpawn: ["B"] },
			{ id: "B", canSpawn: ["A"] },
		];

		const result = validateDelegationGraph(builtin, []);

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(expect.arrayContaining([{ kind: "cycle", path: ["A", "B", "A"] }]));
	});

	it("FR-11: rejects a 3+-node cycle, naming the full cycle path", () => {
		const builtin = [
			{ id: "A", canSpawn: ["B"] },
			{ id: "B", canSpawn: ["C"] },
			{ id: "C", canSpawn: ["A"] },
		];

		const result = validateDelegationGraph(builtin, []);

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(expect.arrayContaining([{ kind: "cycle", path: ["A", "B", "C", "A"] }]));
	});

	it("FR-12: rejects a canSpawn edge to a role that does not exist anywhere, naming the unknown target", () => {
		const builtin = [{ id: "A", canSpawn: ["papel-fantasma"] }];

		const result = validateDelegationGraph(builtin, []);

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(
			expect.arrayContaining([{ kind: "unknown-target", from: "A", target: "papel-fantasma" }]),
		);
	});

	// R17b/T32: aciclicidade é verificada sobre o grafo MERGED (built-in ∪ projeto), fail-closed pro
	// built-in — um projeto NUNCA amplia o grafo built-in para um ciclo, mesmo que o builtin sozinho
	// fosse acíclico.
	it("BR-3/R17b: rejects a cycle introduced ONLY by a project addition on an otherwise-acyclic builtin", () => {
		const builtin = [
			{ id: "A", canSpawn: ["B"] },
			{ id: "B", canSpawn: [] as string[] },
		];
		const projectAdditions = [{ id: "B", canSpawn: ["A"] }]; // closes A -> B -> A

		const result = validateDelegationGraph(builtin, projectAdditions);

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(expect.arrayContaining([{ kind: "cycle", path: ["A", "B", "A"] }]));
	});

	it("accepts a valid merged graph (acyclic, every target known) with zero errors", () => {
		const builtin = [
			{ id: "tech-lead", canSpawn: ["software-engineer", "sdet"] },
			{ id: "software-engineer", canSpawn: [] as string[] },
			{ id: "sdet", canSpawn: [] as string[] },
		];
		const projectAdditions = [{ id: "software-engineer", canSpawn: ["sdet"] }];

		const result = validateDelegationGraph(builtin, projectAdditions);

		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
	});
});
