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

import type { JournalEntry } from "./journal-entry.ts";

export function renderDigest(_entries: readonly JournalEntry[]): string {
	throw new Error("not implemented");
}
