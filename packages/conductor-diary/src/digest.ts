/**
 * @conductor/diary -- digest.ts (G5/FR-10/FR-11, ADR 0007 §16 Apêndice, D1 §3.1, D4 §6.1, D7 §8.2;
 * docs/adr/0007-fase6-diary-and-capture.md).
 *
 * GATE 5 (test-first): `renderDigest` is a STUB that throws "not implemented" -- Gate 6 implements the
 * body.
 *
 * PURA -- sem I/O. Recebe um array de `JournalEntry` JÁ LIDO por quem chama (`reader.readAll()` para o
 * histórico bruto incl. `superseded`, ou `reader.readActive()` para só a corrente -- esta função NÃO
 * decide isso; quem chama decide se passa `readAll()` ou `readActive()`, D7 §8.2: "`log`/`digest`/
 * export leem o histórico bruto ... AMBAS (original + correção) aparecem, em ordem, sempre").
 *
 * Markdown agrupado por `kind` (G5). DETERMINÍSTICA: a mesma entrada de input produz o MESMO Markdown
 * byte-idêntico em 2 chamadas (FR-11, SLI §11 item 9) -- nenhuma dependência em `Date.now()`/
 * `Math.random()`/ordem de iteração de objeto não determinística dentro do corpo real que Gate 6
 * escreve; a ordenação de saída tem que ser uma função pura da entrada (ex.: por `ts`, nunca por ordem
 * de inserção de um `Map`/`Set` não especificado).
 *
 * É o ÚNICO artefato do Diary que toca o workspace (D4 §6.1: "`<workspaceRoot>/qualquer-lugar/
 * digest.md` -- DERIVADO, escrito só quando o usuário pede") -- derivado, regenerável sem perda, nunca
 * autoritativo (não alimenta `runtimeRecordedJournalEntryIds`/evidência, D2).
 */

import { JOURNAL_KINDS, type JournalEntry, type JournalKind } from "./journal-entry.ts";

/** Deterministic ordering key for an entry INSIDE its kind group: `ts` first (chronological), `id` as
 * a stable tie-breaker. Never relies on array/Map iteration order (this file's own header: "ordem de
 * iteração de objeto não determinística" is exactly what this guards against) -- two arrays holding
 * the SAME entries in a DIFFERENT order must still render byte-identically. */
function compareEntries(a: JournalEntry, b: JournalEntry): number {
	if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
	if (a.id !== b.id) return a.id < b.id ? -1 : 1;
	return 0;
}

export function renderDigest(entries: readonly JournalEntry[]): string {
	const groups = new Map<JournalKind, JournalEntry[]>();
	for (const entry of entries) {
		const bucket = groups.get(entry.kind);
		if (bucket) bucket.push(entry);
		else groups.set(entry.kind, [entry]);
	}

	const lines: string[] = ["# Diary digest", ""];

	// Group order is the CANONICAL kind vocabulary (JOURNAL_KINDS), never input/insertion order --
	// a function of the entry's own `kind` value, not of how the caller happened to array them.
	for (const kind of JOURNAL_KINDS) {
		const bucket = groups.get(kind);
		if (!bucket || bucket.length === 0) continue;

		lines.push(`## ${kind}`, "");
		for (const entry of [...bucket].sort(compareEntries)) {
			const gateLabel = entry.gate !== undefined ? ` (gate ${entry.gate})` : "";
			const supersedesLabel = entry.supersedes !== undefined ? ` (supersedes ${entry.supersedes})` : "";
			lines.push(`- **${entry.ts}**${gateLabel} [${entry.sessionId}]${supersedesLabel} ${entry.text}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
