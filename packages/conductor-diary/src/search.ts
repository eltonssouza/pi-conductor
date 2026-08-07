/**
 * @conductor/diary -- search.ts (D6/G4, ADR 0007 §9 + §16 Apêndice;
 * docs/adr/0007-fase6-diary-and-capture.md).
 *
 * GATE 5 (test-first): `search` is a STUB that throws "not implemented" -- Gate 6 implements the body.
 *
 * `search` -- lookup ESTRUTURADO por faceta (G4/FR-8, §9.1): filtra por `kind`/`gate`/`sessionId`/
 * intervalo de datas/texto EXATO (substring, NÃO semântico -- isso é `recall.ts`, D6) sobre o índice
 * derivado. Mais perto do `log` do conductor-main do que do `recall`. É o tipo SEPARADO de `recall` --
 * `recall(...)`/`search(...)` são funções DISTINTAS por TIPO, nunca um booleano num verbo só (D6, a
 * mesma disciplina que a Fase 5 aplicou a `recordGroundedDecision`/`recordUngroundedDecision`, ADR 0006
 * §14.2: "não há parâmetro booleano que os una... a distinção passa a ser garantida pelo compilador").
 *
 * Um valor de faceta NÃO reconhecido (um `--kind` fora de `JOURNAL_KINDS`, um `--gate` fora de 1-14) é
 * REPORTADO explicitamente, nomeando o inválido e os aceitos (FR-9/BR-8) -- nunca tratado como "sem
 * filtro" / silenciosamente ignorado.
 *
 * `search` lê entradas ATIVAS (`reader.readActive()`, D7/BR-5) -- uma entrada `superseded` para de
 * contar como corrente, o mesmo escopo de leitura que `recall`. `log`/`digest`/export (fora do escopo
 * deste arquivo) leem o histórico bruto (`readAll()`) em vez disso.
 */

import type { JournalEntry, JournalKind } from "./journal-entry.ts";
import type { JournalReader } from "./journal-reader.ts";

export interface JournalSearchFilters {
	kind?: JournalKind[];
	gate?: number;
	sessionId?: string;
	/** ISO-8601. */
	since?: string;
	/** ISO-8601. */
	until?: string;
	/** substring EXATA (NÃO semântico -- isso é `recall`). */
	text?: string;
}

export type JournalSearchOutcome =
	| { ok: true; entries: JournalEntry[] }
	| { ok: false; kind: "unknown-facet"; facet: string; value: string; available: string[] }; // FR-9/BR-8

export function search(_filters: JournalSearchFilters, _reader: JournalReader): JournalSearchOutcome {
	throw new Error("not implemented");
}
