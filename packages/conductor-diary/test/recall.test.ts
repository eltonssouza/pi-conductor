/**
 * Test-first (Gate 5) for `recall` (src/recall.ts) -- D6/G3, ADR 0007 §9 + §16 Apêndice
 * (docs/adr/0007-fase6-diary-and-capture.md).
 *
 * `recall` is currently a STUB that throws "not implemented" -- every test below fails RED for that
 * one reason today (Gate 6 implements the body). Written against the REAL, locked contract so each
 * becomes the actual proof of FR-5/FR-6/R41/T60/BR-10 once Gate 6 fills the body in.
 *
 * `it.todo` note (backend-unreachable): see src/recall.ts's own "DECLARED AMBIGUITY" header comment --
 * the ADR §16 signature `recall(query, reader, ctx)` has no injectable collaborator through which this
 * Gate 5 pass could produce an unreachable-embeddings condition without inventing a seam the ADR's own
 * "illustrative, not production-ready" appendix does not specify. Deferred to Gate 6 as a documented
 * `it.todo`, never silently dropped -- the same precedent this monorepo already uses for
 * `redaction.test.ts`'s "sessionExport" case (a required guarantee whose plumbing does not exist yet).
 */

import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../src/journal-entry.ts";
import { recall, type RecallContext, type RecalledEntry } from "../src/recall.ts";

// Minimal fake JournalReader (journal-reader.ts is a parallel Gate 5 stream's file, not owned here) --
// shape-compatible with the port recall.ts declares (readAll/readActive), the same "fake the
// collaborator" discipline this monorepo already uses elsewhere (e.g. gate-evidence.ts's injected
// `gitCommitExists`).
function fakeReader(entries: readonly JournalEntry[]) {
	return {
		readAll: () => entries,
		readActive: () => entries,
	};
}

function sampleEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
	return {
		id: "j-1",
		schemaVersion: 1,
		ts: "2026-08-01T10:00:00.000Z",
		sessionId: "session-1",
		author: "backend-engineer",
		kind: "decision",
		gate: 4,
		source: "manual",
		text: "adotar node:sqlite para o índice derivado do diário, arquivo por projeto",
		provenance: { branch: "feature/fase6-diary-e-captura-automatica", sha: "deadbeef", repo: "pi-conductor" },
		...overrides,
	};
}

function ctx(overrides: Partial<RecallContext> = {}): RecallContext {
	return { now: new Date("2026-08-07T12:00:00.000Z"), ...overrides };
}

describe("recall -- FR-6: no matching memory is reported explicitly, never invented", () => {
	it('returns {ok:true, hits:[], reason:"no-matching-memory"} when the diary has no entries at all', () => {
		const reader = fakeReader([]);

		const result = recall("o que decidimos sobre o schema do índice do diário?", reader, ctx());

		expect(result).toEqual({ ok: true, hits: [], reason: "no-matching-memory" });
	});
});

describe("recall -- every returned hit carries citedAs (R41/T60: data cited, never a directive)", () => {
	it("labels every hit with source + sessionId + ts (+gate when present) -- never merges the passage into an instruction", () => {
		const target = sampleEntry({ id: "j-1" });
		const reader = fakeReader([target]);

		// Query text overlaps heavily with the entry's own text -- an obvious, unambiguous match any
		// real hybrid (lexical+dense) implementation is expected to surface.
		const result = recall("índice derivado do diário arquivo por projeto", reader, ctx());

		expect(result.ok).toBe(true);
		const hits = (result as { ok: true; hits: RecalledEntry[] }).hits;
		expect(hits.length).toBeGreaterThan(0);
		for (const hit of hits) {
			expect(hit.citedAs).toEqual({
				source: hit.entry.source,
				sessionId: hit.entry.sessionId,
				gate: hit.entry.gate,
				ts: hit.entry.ts,
			});
		}
	});
});

describe("recall -- score guard (ADR 0006 §5.3: the same finiteness guard validateGroundingCitation already applies)", () => {
	it("every hit's score is a finite number -- never NaN/Infinity leaking from a broken rank computation", () => {
		const reader = fakeReader([
			sampleEntry({ id: "j-1" }),
			sampleEntry({ id: "j-2", text: "outra decisão relacionada ao índice do diário" }),
		]);

		const result = recall("índice do diário", reader, ctx());

		expect(result.ok).toBe(true);
		const hits = (result as { ok: true; hits: RecalledEntry[] }).hits;
		expect(hits.length).toBeGreaterThan(0);
		for (const hit of hits) {
			expect(Number.isFinite(hit.score)).toBe(true);
		}
	});
});

describe("recall -- backend-unreachable (FR-12 parity: a HIGH failure, never a degraded ok:true)", () => {
	// DEFERRED (see this file's own header + src/recall.ts's "DECLARED AMBIGUITY"): the current
	// 3-param signature has no seam to inject an unreachable-embeddings condition without inventing
	// one the ADR does not specify. Gate 6 must decide the seam (most likely mirroring
	// conductor-cli/library.ts's `deps.embeddingClient` precedent) before this can be written for
	// real -- documented as a deliberate deferral, never silently dropped.
	it.todo(
		'returns {ok:false, kind:"backend-unreachable", backend:"embeddings", reason} when the embeddings backend cannot be reached -- BLOCKED on Gate 6 deciding the injectable collaborator seam (recall\'s ADR §16 signature has none)',
	);
});
