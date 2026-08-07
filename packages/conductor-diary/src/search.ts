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

import { JOURNAL_KINDS, type JournalEntry, type JournalKind } from "./journal-entry.ts";
import type { JournalReader } from "./journal-reader.ts";

const MIN_GATE = 1;
const MAX_GATE = 14;
const VALID_GATES: readonly string[] = Array.from({ length: MAX_GATE - MIN_GATE + 1 }, (_, i) => String(i + MIN_GATE));

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

/** Every `filters.kind` entry must be a member of the closed `JOURNAL_KINDS` vocabulary -- an
 * unrecognized value is REPORTED explicitly (FR-9/BR-8), naming both the offender and the accepted
 * set, never silently dropped or treated as "no filter". */
function validateKindFacet(kind: readonly JournalKind[] | undefined): JournalSearchOutcome | undefined {
	if (!kind) return undefined;
	for (const value of kind) {
		if (!JOURNAL_KINDS.includes(value)) {
			return {
				ok: false,
				kind: "unknown-facet",
				facet: "kind",
				value: String(value),
				available: [...JOURNAL_KINDS],
			};
		}
	}
	return undefined;
}

/** `filters.gate` must be an integer in 1-14 (the closed gate range this whole flow uses) -- outside
 * it is REPORTED explicitly (FR-9/BR-8), never silently ignored. */
function validateGateFacet(gate: number | undefined): JournalSearchOutcome | undefined {
	if (gate === undefined) return undefined;
	if (!Number.isInteger(gate) || gate < MIN_GATE || gate > MAX_GATE) {
		return { ok: false, kind: "unknown-facet", facet: "gate", value: String(gate), available: [...VALID_GATES] };
	}
	return undefined;
}

/** `since`/`until` must be parseable ISO-8601 instants -- an unparseable value is REPORTED explicitly
 * rather than silently matching everything (a malformed date range that were treated as "no filter"
 * would be the same silent-widening class of bug FR-9/BR-8 exists to close). */
function validateDateFacet(facet: "since" | "until", value: string | undefined): JournalSearchOutcome | undefined {
	if (value === undefined) return undefined;
	if (Number.isNaN(Date.parse(value))) {
		return { ok: false, kind: "unknown-facet", facet, value, available: ["an ISO-8601 date-time string"] };
	}
	return undefined;
}

export function search(filters: JournalSearchFilters, reader: JournalReader): JournalSearchOutcome {
	const invalid =
		validateKindFacet(filters.kind) ??
		validateGateFacet(filters.gate) ??
		validateDateFacet("since", filters.since) ??
		validateDateFacet("until", filters.until);
	if (invalid) return invalid;

	const sinceMs = filters.since !== undefined ? Date.parse(filters.since) : undefined;
	const untilMs = filters.until !== undefined ? Date.parse(filters.until) : undefined;

	// Current knowledge only (D7/BR-5) -- a superseded entry stops counting as current, the same read
	// scope `recall` uses; `log`/`digest`/export read `readAll()` instead (out of scope here).
	const entries = reader.readActive().filter((entry) => {
		if (filters.kind && !filters.kind.includes(entry.kind)) return false;
		if (filters.gate !== undefined && entry.gate !== filters.gate) return false;
		if (filters.sessionId !== undefined && entry.sessionId !== filters.sessionId) return false;
		if (sinceMs !== undefined && Date.parse(entry.ts) < sinceMs) return false;
		if (untilMs !== undefined && Date.parse(entry.ts) > untilMs) return false;
		if (filters.text !== undefined && !entry.text.includes(filters.text)) return false;
		return true;
	});

	return { ok: true, entries: [...entries] };
}
