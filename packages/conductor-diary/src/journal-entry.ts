/**
 * @conductor/diary -- journal-entry.ts (NOVO pacote; ADR 0007 "Fase 6 -- Diary e captura automática"
 * §16 Apêndice, D1/D2/D3/D5/D7/D8; docs/adr/0007-fase6-diary-and-capture.md).
 *
 * PURE data shapes only -- zero I/O, zero `node:fs` import. This file is the single source of truth
 * for every type shared across the whole `@conductor/diary` surface (recall.ts, search.ts, digest.ts,
 * capture.ts here, and journal-writer.ts/journal-reader.ts a PARALLEL Gate 5 stream owns) -- the same
 * "declared once, every other file imports FROM here" discipline this monorepo already uses for
 * `@conductor/runtime`'s gate-evidence.ts (EvidenceRef/EvidenceProvenance, see that file's own header)
 * and gate-grounding.ts (GroundingCitation).
 *
 * TYPE-OWNERSHIP DECISION (an ADR ambiguity resolved here, not invented -- see this Gate 5 pass's own
 * final report for the full reasoning): ADR §16's code fence groups `JournalAddInput` under the
 * "writer (BORDA: fs...)" comment banner, immediately before `JournalWriter`/`openJournalWriter` --
 * textually suggesting it belongs in journal-writer.ts. This file claims it instead, because (a)
 * `JournalAddInput` is a plain data shape with no I/O of its own (the actual I/O -- deep-redact, mint
 * id, append -- is `JournalWriter.append`'s job, not this type's); (b) TWO independent consumers need
 * it: `JournalWriter.append` (the parallel stream's file) AND `curateCaptureEvent` (capture.ts, owned
 * here, D5 §7.3: "a curadoria de um evento em JournalAddInput é uma função PURA... a ESCRITA é o
 * JournalWriter"); (c) a shape two siblings both depend on belongs in the file NEITHER of them is,
 * exactly the reasoning gate-evidence.ts's own header already states for why EvidenceRef/
 * EvidenceProvenance live there and gate-state.ts imports them rather than redeclaring. Once
 * journal-writer.ts lands, it is expected to `import type { JournalAddInput } from "./journal-entry.ts"`
 * rather than redeclare it -- if the parallel stream instead declared its own copy, the two must
 * converge on this one at merge time (the orchestrator resolves per this Gate 5 task's own brief).
 */

/** O vocabulário FECHADO -- verbatim de conductor-main journal.py:43 KINDS (assert-behaviour-over-prose:
 *  os 6 valores do CÓDIGO, incl. "checkpoint", não os 5 da prosa do CLAUDE.md pai). Um valor fora deste
 *  conjunto é recusado nomeando os válidos (FR-2/BR-7), nunca aceito como texto livre disfarçado de
 *  categoria (ADR §3.2). D1 §3.3: o enum NÃO cresce para risco/aprovação/hipótese/aprendizado -- esses
 *  já têm fonte de verdade própria (Risk/Approval em GateState) ou mapeiam para reasoning/plan. */
export type JournalKind = "reasoning" | "decision" | "plan" | "error" | "solution" | "checkpoint";
export const JOURNAL_KINDS: readonly JournalKind[] = [
	"reasoning",
	"decision",
	"plan",
	"error",
	"solution",
	"checkpoint",
] as const;

/** Como a entrada entrou no diário -- a distinção que D3/D5 exigem, NUNCA fundida (T60/R41: um
 *  documento ingerido é dado citado; uma entrada manual é uma decisão; uma captura é uma observação).
 *  Rotulada na saída de recall/search via `citedAs`/entry.source (ADR §5.2). */
export type JournalSource = "manual" | "capture" | "document";

/** Correção append-only (D7 §8.1): os modos de `journal.py`'s EDIT_MODES -- o mesmo append por baixo,
 *  o modo só diz como ler a intenção depois. */
export type EditMode = "update" | "forget" | "invalidate";

/** Proveniência best-effort -- cada campo INDEPENDENTEMENTE omitido (nunca inventado) quando o git não
 *  resolve (BR-3/FR-3; journal.py:_stamp_provenance's per-field independent None). `sha` é
 *  machine-read do HEAD, NUNCA derivado do `text` (BR-8). */
export interface JournalProvenance {
	branch?: string;
	sha?: string;
	repo?: string;
}

export interface JournalEntry {
	/** Runtime-mintado (randomUUID), NUNCA um --id do autor (FR-4/BR-8). É este id que a Fase 4
	 *  resolve como EvidenceRef{journal-entry} (G12/FR-25, D2). */
	id: string;
	/** LITERAL -- versionado desde a 1ª escrita (FR-21; a regra do monorepo). v2 vira união
	 *  discriminada quando o schema evoluir. */
	schemaVersion: 1;
	/** ISO-8601 string, NUNCA um Date (a armadilha do canonicalizer da Fase 4). */
	ts: string;
	sessionId: string;
	author: string;
	kind: JournalKind;
	/** 1..14 quando presente. */
	gate?: number;
	source: JournalSource;
	/** JÁ redigido antes desta forma ser persistida (BR-2/D8 -- deep-redação no JournalWriter, o 8º
	 *  sink fechado de REDACTION_SINKS). */
	text: string;
	provenance: JournalProvenance;
	/** Correção (D7/FR-23): aponta para o id do original -- NUNCA uma mutação. Um `supersedes` para um
	 *  id inexistente é recusado antes de escrever (nunca uma ref pendurada, edge case 6). */
	supersedes?: string;
	editMode?: EditMode;
}

/** Input de uma escrita -- SEM campo `id` (o runtime o minta, FR-4/BR-8). Ver a nota de "TYPE-OWNERSHIP
 *  DECISION" no cabeçalho deste arquivo para por que este tipo vive aqui, e não em journal-writer.ts. */
export interface JournalAddInput {
	kind: JournalKind;
	text: string;
	sessionId: string;
	author: string;
	gate?: number;
	source: JournalSource;
}
