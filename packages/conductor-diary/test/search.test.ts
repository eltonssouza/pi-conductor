/**
 * Test-first (Gate 5) for `search` (src/search.ts) -- D6/G4, ADR 0007 §9 + §16 Apêndice
 * (docs/adr/0007-fase6-diary-and-capture.md).
 *
 * `search` is currently a STUB that throws "not implemented" -- every test below fails RED for that
 * one reason today (Gate 6 implements the body). Written against the REAL, locked contract (FR-8/FR-9/
 * BR-8) so each becomes the actual proof once Gate 6 fills the body in.
 */

import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../src/journal-entry.ts";
import { type JournalSearchFilters, search } from "../src/search.ts";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
	return {
		id: "j-1",
		schemaVersion: 1,
		ts: "2026-08-01T10:00:00.000Z",
		sessionId: "session-1",
		author: "backend-engineer",
		kind: "decision",
		gate: 4,
		source: "manual",
		text: "adotar node:sqlite para o índice do diário",
		provenance: {},
		...overrides,
	};
}

function fakeReader(entries: readonly JournalEntry[]) {
	return {
		readAll: () => entries,
		readActive: () => entries,
	};
}

describe("search -- facet filter by kind (structured, not semantic -- D6)", () => {
	it("returns only entries whose kind matches the requested filter", () => {
		const entries = [
			entry({ id: "j-1", kind: "decision" }),
			entry({ id: "j-2", kind: "error", text: "backend indisponível" }),
			entry({ id: "j-3", kind: "decision", text: "outra decisão" }),
		];
		const reader = fakeReader(entries);
		const filters: JournalSearchFilters = { kind: ["decision"] };

		const result = search(filters, reader);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.entries.map((e) => e.id).sort()).toEqual(["j-1", "j-3"]);
			expect(result.entries.every((e) => e.kind === "decision")).toBe(true);
		}
	});
});

describe("search -- facet filters: gate / sessionId / since / until (structured, never semantic)", () => {
	it("filters by gate", () => {
		const entries = [entry({ id: "j-1", gate: 4 }), entry({ id: "j-2", gate: 5 })];
		const result = search({ gate: 5 }, fakeReader(entries));

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.entries.map((e) => e.id)).toEqual(["j-2"]);
	});

	it("filters by sessionId", () => {
		const entries = [entry({ id: "j-1", sessionId: "session-a" }), entry({ id: "j-2", sessionId: "session-b" })];
		const result = search({ sessionId: "session-b" }, fakeReader(entries));

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.entries.map((e) => e.id)).toEqual(["j-2"]);
	});

	it("filters by since/until (an ISO-8601 date range over ts)", () => {
		const entries = [
			entry({ id: "j-1", ts: "2026-01-01T00:00:00.000Z" }),
			entry({ id: "j-2", ts: "2026-08-01T00:00:00.000Z" }),
			entry({ id: "j-3", ts: "2026-12-31T00:00:00.000Z" }),
		];
		const result = search(
			{ since: "2026-07-01T00:00:00.000Z", until: "2026-09-01T00:00:00.000Z" },
			fakeReader(entries),
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.entries.map((e) => e.id)).toEqual(["j-2"]);
	});
});

describe("search -- an unrecognized facet is reported EXPLICITLY, never silently treated as no filter (FR-9/BR-8)", () => {
	it('returns {ok:false, kind:"unknown-facet", facet, value, available} for a kind outside JOURNAL_KINDS', () => {
		const reader = fakeReader([entry()]);

		// A caller (the CLI's --kind flag parsing) that lets an invalid value reach `search` this way
		// must get an explicit refusal naming BOTH the offending value and the accepted set -- never a
		// silently-empty or silently-unfiltered result.
		const result = search({ kind: ["not-a-real-kind" as JournalEntry["kind"]] }, reader);

		expect(result).toMatchObject({ ok: false, kind: "unknown-facet", facet: "kind" });
		if (!result.ok) {
			expect(result.value).toBe("not-a-real-kind");
			expect(result.available.length).toBeGreaterThan(0);
		}
	});

	it('returns {ok:false, kind:"unknown-facet", facet:"gate", ...} for a gate outside 1-14', () => {
		const reader = fakeReader([entry()]);

		const result = search({ gate: 99 }, reader);

		expect(result).toMatchObject({ ok: false, kind: "unknown-facet", facet: "gate", value: "99" });
	});
});
