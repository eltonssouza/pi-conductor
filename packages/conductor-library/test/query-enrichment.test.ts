/**
 * Test-first (Gate 5) for `enrichQuery` (src/query-enrichment.ts) -- gate2-spec-fase5.md FR-3/G4,
 * ADR 0006 §11.1/Apêndice §19.
 *
 * `enrichQuery` is currently a STUB that throws "not implemented" -- every test below fails RED for
 * that one reason today (Gate 6 implements the body).
 */
import { describe, expect, it } from "vitest";
import { enrichQuery, type QueryEnrichmentContext } from "../src/query-enrichment.ts";

const RAW_QUESTION = "how should credentials be handled?";

describe("enrichQuery (FR-3/G4: project + stack + gate + role, before search)", () => {
	it("carries all four axes (project type, stack, gate, role) alongside the raw question", () => {
		const ctx: QueryEnrichmentContext = {
			projectType: "backend",
			technologies: ["python", "django"],
			gate: 3,
			role: "security-engineer",
		};

		const enriched = enrichQuery(RAW_QUESTION, ctx);

		expect(enriched).toContain(RAW_QUESTION);
		expect(enriched).toMatch(/backend/i);
		expect(enriched).toMatch(/python/i);
		expect(enriched).toMatch(/django/i);
		expect(enriched).toMatch(/gate\s*3|gate 3|3.*security/i);
		expect(enriched).toMatch(/security-engineer/i);
	});

	it("degrades gracefully with no context at all: the raw question still passes through, never throws", () => {
		expect(() => enrichQuery(RAW_QUESTION, {})).not.toThrow();
		expect(enrichQuery(RAW_QUESTION, {})).toContain(RAW_QUESTION);
	});

	it("degrades gracefully with only ONE axis known (role), without referencing the missing ones", () => {
		const enriched = enrichQuery(RAW_QUESTION, { role: "backend-engineer" });

		expect(enriched).toContain(RAW_QUESTION);
		expect(enriched).toMatch(/backend-engineer/i);
	});

	it("degrades gracefully with only the gate axis known, without crashing on the absent role/project/stack", () => {
		const enriched = enrichQuery(RAW_QUESTION, { gate: 5 });

		expect(enriched).toContain(RAW_QUESTION);
		expect(enriched).toMatch(/gate\s*5|gate 5/i);
	});

	it("never searches the raw question un-enriched when context IS available (FR-3's own Given/When/Then)", () => {
		const ctx: QueryEnrichmentContext = { projectType: "backend", gate: 3, role: "security-engineer" };

		const enriched = enrichQuery(RAW_QUESTION, ctx);

		// The enriched question must be a strict superset of the raw one -- never byte-identical when
		// context was available (otherwise enrichment silently did nothing).
		expect(enriched).not.toBe(RAW_QUESTION);
		expect(enriched.length).toBeGreaterThan(RAW_QUESTION.length);
	});
});
