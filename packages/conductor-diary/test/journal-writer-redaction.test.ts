/**
 * Gate 6 regression test (added alongside the implementation, not part of the original Gate 5 stub's
 * suite): docs/adr/0007-fase6-diary-and-capture.md D8/§10.1 -- "toda escrita do Diary... deep-redige TODO
 * leaf string, antes de tocar o disco... a redação acontece no ponto único de escrita (o JournalWriter),
 * nunca presumindo que um chamador upstream já redigiu." SLI/SLO §11 item 5 names this an INVARIANT with
 * error-budget zero ("entrada persistida com qualquer leaf não-redigido = 0").
 *
 * `journal-writer.ts`'s own header documents the GATE-6 DECISION behind HOW this is implemented (a local
 * `deepRedact`/`redactLeaf` pair importing `redactSecrets` from `@conductor/secrets` directly, rather
 * than `@conductor/runtime`'s `redactSessionEntryForPersistence` -- see that file for the full reasoning).
 * That wiring was not anticipated by the original `test/journal-writer.test.ts` (a parallel Gate-5 stream
 * wrote it before this decision existed), so it has no regression coverage of its own without this file --
 * a real, would-be-silent gap this test closes, distinct from (and never editing) the Gate-5-owned suite.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openJournalWriter } from "../src/journal-writer.ts";

const scratchDirs: string[] = [];

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-diary-writer-redaction-"));
	scratchDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (scratchDirs.length > 0) {
		const dir = scratchDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

// A real secret-shaped string @conductor/secrets' matcher recognizes (an Anthropic-style API key
// prefix) -- not a mock, the same "exercise the real matcher" discipline this monorepo's own
// redaction tests already use for sibling sinks.
const SECRET_SHAPED_TEXT =
	"a chave e sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn";

describe("JournalWriter.append deep-redacts secret-shaped text before it touches disk (D8/§10.1)", () => {
	it("redacts a secret-shaped substring in both the returned entry AND the persisted JSONL line", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);

		const entry = writer.append({
			kind: "decision",
			text: SECRET_SHAPED_TEXT,
			sessionId: "session-0001",
			author: "sdet",
			source: "manual",
		});

		expect(entry.text).not.toContain("sk-ant-api03-");
		const onDisk = readFileSync(entriesPath, "utf8").trim();
		expect(onDisk).not.toContain("sk-ant-api03-");
		expect(JSON.parse(onDisk).text).toBe(entry.text);
	});

	it("never mangles non-secret-shaped structural fields (id/ts) while redacting", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);

		const entry = writer.append({
			kind: "decision",
			text: "texto comum, sem segredo nenhum",
			sessionId: "session-0001",
			author: "sdet",
			source: "manual",
		});

		expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
		expect(entry.id.length).toBeGreaterThan(0);
		expect(entry.text).toBe("texto comum, sem segredo nenhum");
	});
});

describe("JournalWriter.supersede deep-redacts the correction's new text before it touches disk (D8/§10.1)", () => {
	it("redacts a secret-shaped substring in supersede's newText, in both the returned entry and on disk", () => {
		const entriesPath = join(scratchDir(), "entries.jsonl");
		const writer = openJournalWriter(entriesPath);
		const original = writer.append({
			kind: "decision",
			text: "versao original, sem segredo",
			sessionId: "session-0001",
			author: "sdet",
			source: "manual",
		});

		const result = writer.supersede(original.id, SECRET_SHAPED_TEXT, "update");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok:true");
		expect(result.entry.text).not.toContain("sk-ant-api03-");
		const lines = readFileSync(entriesPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[1]).not.toContain("sk-ant-api03-");
	});
});
