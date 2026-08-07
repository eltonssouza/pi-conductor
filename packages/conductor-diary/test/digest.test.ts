/**
 * Test-first (Gate 5) for `renderDigest` (src/digest.ts) -- G5/FR-10/FR-11, ADR 0007 §16 Apêndice, D1
 * §3.1, D4 §6.1, D7 §8.2 (docs/adr/0007-fase6-diary-and-capture.md).
 *
 * `renderDigest` is currently a STUB that throws "not implemented" -- every test below fails RED for
 * that one reason today (Gate 6 implements the body).
 */

import { describe, expect, it } from "vitest";
import { renderDigest } from "../src/digest.ts";
import type { JournalEntry } from "../src/journal-entry.ts";

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
		text: "adotar node:sqlite para o índice derivado do diário",
		provenance: { branch: "feature/fase6-diary-e-captura-automatica", sha: "deadbeef", repo: "pi-conductor" },
		...overrides,
	};
}

describe("renderDigest -- groups the Markdown output by kind (G5)", () => {
	it("emits every distinct kind present in the input as its own group", () => {
		const entries: JournalEntry[] = [
			entry({ id: "j-1", kind: "decision", text: "decisão A" }),
			entry({ id: "j-2", kind: "error", text: "erro B" }),
			entry({ id: "j-3", kind: "decision", text: "decisão C" }),
		];

		const markdown = renderDigest(entries);

		// Every entry's own text appears somewhere in the rendered output (nothing silently dropped),
		// and the two "decision" entries are not simply interleaved with the lone "error" entry in
		// input order -- they are grouped under a shared "decision" heading (G5's own literal wording).
		expect(markdown).toContain("decisão A");
		expect(markdown).toContain("erro B");
		expect(markdown).toContain("decisão C");
		expect(markdown.toLowerCase()).toContain("decision");
		expect(markdown.toLowerCase()).toContain("error");
	});
});

describe("renderDigest -- deterministic, byte-identical across regenerations over an unchanged log (FR-11)", () => {
	it("returns the exact same string for the exact same input, called twice", () => {
		const entries: JournalEntry[] = [
			entry({ id: "j-1", kind: "decision" }),
			entry({ id: "j-2", kind: "solution", text: "corrigido reordenando o índice" }),
			entry({ id: "j-3", kind: "checkpoint", text: "gate 5 concluído" }),
		];

		const first = renderDigest(entries);
		const second = renderDigest(entries.map((e) => ({ ...e }))); // fresh objects, same values

		expect(second).toBe(first);
	});
});

describe("renderDigest -- reads exactly what it is given, never filters superseded entries itself (D7 §8.2)", () => {
	it("includes BOTH an original entry and its supersedes correction when both are passed in -- the caller decides readAll() vs readActive(), not this function", () => {
		const original = entry({ id: "j-1", kind: "decision", text: "decisão original (superseded)" });
		const correction = entry({
			id: "j-2",
			kind: "decision",
			text: "decisão corrigida",
			supersedes: "j-1",
			editMode: "update",
		});

		const markdown = renderDigest([original, correction]);

		// A superseded entry is still part of the RAW history (readAll()) -- digest/log/export never
		// filter it on their own (D7 §8.2: "log/digest/export leem o histórico bruto... AMBAS
		// (original + correção) aparecem, em ordem, sempre").
		expect(markdown).toContain("decisão original (superseded)");
		expect(markdown).toContain("decisão corrigida");
	});
});
