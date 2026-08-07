/**
 * Grounding citation minting (Gate 5, Fase 5 "Library e grounding" — ADR 0006 §5/§6/§19 appendix,
 * docs/conductor/gate2-spec-fase5.md FR-14/FR-16/FR-17, docs/conductor/gate3-addendum-fase5.md
 * T53/T54/T55, rules R34/R35/R36).
 *
 * GATE 5 (test-first): every function below is an unconditional throw ("not implemented") — the SAME
 * precedent this package already uses for every Fase-4 Gate-5 stream (gate-approval.ts,
 * gate-evidence.ts, gate-state-policy.ts, gate-state-store.ts). The TYPES here are NOT a sketch — they
 * transcribe ADR 0006 §19's locked appendix contract for this slice verbatim. Gate 6 fills the bodies
 * in for real.
 *
 * Scope (ADR §11.1/§11.2): this file owns the port (`GroundingLedgerReader`) and the two mint
 * functions (`recordGroundedDecision`/`recordUngroundedDecision`) — the ONLY producers of a
 * `Decision{kind:"decision"}` carrying `groundingCitations`, and the only place `groundingCitations`
 * is ever written (test/gate-grounding-sole-mint.test.ts is the static-scan invariant that proves
 * this structurally, not just by convention). `@conductor/library` (a future package, D8) implements
 * this port as an adapter over its own SQLite-backed ledger; this package NEVER imports
 * `@conductor/library` (the dependency arrow points inward, ADR §11.2 — "conductor-runtime and the
 * Library never depend on one another directly").
 *
 * The non-forgeability guarantee (ADR §6.2) is the SUM of three structural properties, none of which
 * is a construction-token/brand (ADR 0005 §7's own correction: a `Symbol` does not survive
 * `JSON.stringify`, so a token re-checked against a re-read record always reads `false` for genuine
 * and forged alike):
 *   1. Sole-mint by static scan (test/gate-grounding-sole-mint.test.ts) — a property of the CODE,
 *      verified in CI every commit, not a property of the persisted data.
 *   2. Protected-path (`~/.conductor/library` joins `defaultProtectedPaths()`, D9) — neither the
 *      GateState nor the ledger that feeds it are reachable by the agent's own write/edit/bash tools.
 *   3. Resolution against a runtime-derived ledger (`GroundingLedgerReader`, below) — a citation is
 *      built from what the ledger OBSERVED, never from what the caller declared. This is the exact
 *      shape `gate-evidence.ts:resolveEvidenceRef` (+ `gate.ts:runGateEvidence`, which always
 *      OVERWRITES the caller-declared provenance before persisting) already established for a
 *      sibling field — D4 is that same discipline applied to `groundingCitations`.
 *
 * R36 (gate3-addendum-fase5.md §8, T55): a `GroundingLedgerReader` implementation must NEVER throw —
 * every failure mode (directory missing, unreadable/EACCES, a corrupted line, a `projectId` mismatch)
 * collapses to `null` in both `findQueryEvent` and `findRecentUnreachable`, mirroring
 * `policy-trust-store.ts`'s own R11a ("absent | invalid | hash-not-found all collapse to
 * isTrusted()===false. Never throws."). The two mint functions below additionally defend against a
 * MISBEHAVING adapter that violates this contract anyway: a thrown exception from either ledger method
 * must never propagate out of `recordGroundedDecision`/`recordUngroundedDecision` — it collapses to
 * the SAME "did not resolve" refusal a genuine `null` would have produced (see
 * test/gate-grounding-record.test.ts's own "GroundingLedgerReader that throws" suite). The absence or
 * illegibility of the ledger is NEVER synthesized into a `rag-unreachable` (T55): "cannot prove
 * anything happened" and "the runtime tried and failed" are different facts, and only the latter
 * satisfies `recordUngroundedDecision`'s FR-17 path.
 */

import type { Result } from "@earendil-works/pi-agent-core";
import type { ApprovalMethod } from "./gate-approval.ts";
import type { GateState } from "./gate-state.ts";
import type { GateStateMutationError, GateStateStore } from "./gate-state-store.ts";

/**
 * ADR §5.1/§19: the structured citation. Every field is populated from what the runtime OBSERVED at
 * query time — never from what a caller typed. `embeddingModel`/`corpusVersion` are the citation's
 * "passport" (Context Engineering §10.2/§4.3, cited at ADR §5.1): without them, a citation cannot be
 * re-verified even in principle once the corpus/model changes.
 */
export interface GroundingCitation {
	/** Id of the `rag-query` event the RUNTIME recorded (D13) — the non-forgeability anchor. */
	queryEventId: string;
	/** sha256 of the chunk's body AT QUERY TIME — the passage's own "passport". */
	chunkHash: string;
	/** The question ACTUALLY searched (already enriched, FR-3) — as the runtime observed it. */
	question: string;
	source: string;
	section: string;
	path: string;
	category: string;
	/** BR-5: a snapshot, never a live pointer — the corpus version at the moment of the query. */
	corpusVersion: string;
	/** The index IS the embedding model (Context Engineering §4.3) — without this the citation is
	 * irreproducible. */
	embeddingModel: string;
	/** FINITE and in [0,1] — validated by `validateGroundingCitation` BEFORE persisting (D3 §5.3). */
	score: number;
	/** ISO-8601 string — never a `Date` (ADR 0005 §9.2's checksum gotcha). */
	retrievedAt: string;
	/** Distinguishes a genuine hybrid search from a `--lexical-only` one (D11) — never inferred. */
	mode: "hybrid" | "lexical-only";
}

/**
 * D3 §5.3's finiteness guard, factored out as its own testable unit: `Number.isFinite(score)` AND
 * `0 <= score <= 1`, or refusal — NEVER a silent clamp (clamping would hide the exact bug D14's
 * min-max rerank normalization produces on a tied candidate set: `(x - min) / (max - min)` with a
 * zero denominator is `NaN` by ordinary arithmetic, not an attack). `canonicalizeJsonForChecksum`
 * (gate-state-store.ts) THROWS on a non-finite number reaching the checksum boundary — this guard
 * exists so that failure happens HERE, with a citation-shaped diagnosis, never as a generic
 * "GateState checksum input must contain only finite numbers" surfacing from an unrelated call site.
 *
 * `{ ok: true }` never carries a `reason` key (omitted, not present-as-undefined) — the same
 * aggregate-wide discipline `gate-store.ts:201-206` already established for `Evidence.note`.
 */
export type ValidateGroundingCitationResult = { ok: true } | { ok: false; reason: string };

export function validateGroundingCitation(_citation: GroundingCitation): ValidateGroundingCitationResult {
	throw new Error("not implemented");
}

/** One hit inside a recorded `rag-query` event — the shape `@conductor/library`'s ledger adapter
 * projects each search result into (ADR §19). */
export interface RagQueryEventHitView {
	chunkHash: string;
	source: string;
	section: string;
	path: string;
	category: string;
	score: number;
}

/** A `rag-query` event exactly as the runtime recorded it (D13) — the PORT's view of one search. */
export interface RagQueryEventView {
	id: string;
	question: string;
	enrichedQuery: string;
	mode: "hybrid" | "lexical-only";
	corpusVersion: string;
	embeddingModel: string;
	/** ISO-8601 — the moment the search ran (becomes `GroundingCitation.retrievedAt` on resolution). */
	at: string;
	hits: readonly RagQueryEventHitView[];
}

/** A `rag-unreachable` event exactly as the runtime recorded it (D11/D13) — never synthesized from an
 * absent/illegible ledger (R36/T55). */
export interface RagUnreachableEventView {
	id: string;
	backend: string;
	reason: string;
	at: string;
}

/**
 * PORT (D8/ADR §11.2): `@conductor/library` is the adapter; `@conductor/runtime` NEVER imports
 * `@conductor/library`. R36 (gate3-addendum-fase5.md T55): a genuine implementation NEVER throws —
 * every failure (missing directory, EACCES, corrupted line, `projectId` mismatch) collapses to `null`
 * in BOTH methods. The two mint functions below defend against a misbehaving implementation that
 * violates this anyway (see this file's own header).
 */
export interface GroundingLedgerReader {
	findQueryEvent(queryEventId: string): RagQueryEventView | null;
	findRecentUnreachable(now: Date, windowMs: number): RagUnreachableEventView | null;
}

/** D13 §16.3: a fixed constant of the CODE, never configurable via `policy.json` — a configurable
 * window would reopen exactly the bypass-by-configuration R35 exists to close ("window = 10 years"). */
export const UNREACHABLE_WINDOW_MS = 15 * 60_000;

/**
 * Terminal error union for both mint functions (ADR §19). `citation-required`/`citation-unresolved`/
 * `citation-invalid` are `recordGroundedDecision`'s own refusals; `no-recent-unreachable` is
 * `recordUngroundedDecision`'s; `store` wraps whatever `GateStateStore.mutate()` itself reports
 * (lock/io-error/could-not-verify) — never a fourth, silently-invented bucket.
 */
export type RecordDecisionError =
	| { kind: "citation-required" }
	| { kind: "citation-unresolved"; queryEventId: string; chunkHash: string }
	| { kind: "citation-invalid"; reason: string }
	| { kind: "no-recent-unreachable" }
	| { kind: "store"; error: GateStateMutationError };

/**
 * The ONE producer of `Decision{kind:"decision"}` carrying `groundingCitations` (D4 §6.1/§6.2).
 *
 * Contract (never relaxed by Gate 6):
 *   1. NEVER accepts a ready-made `GroundingCitation`. `input.citations` are PONTEIROS
 *      `(queryEventId, chunkHash)` — every field of the eventual `GroundingCitation` (question,
 *      source, section, score, corpusVersion, embeddingModel, mode, retrievedAt) is filled in from
 *      what `ledger.findQueryEvent(queryEventId)` returns, never from anything the caller passed.
 *   2. A pointer whose `queryEventId` does not resolve (`ledger.findQueryEvent` returns `null`), OR
 *      whose `chunkHash` is not among that event's own `hits`, is a refusal
 *      (`{ kind: "citation-unresolved", queryEventId, chunkHash }`) — never "attach it anyway".
 *   3. `input.citations` empty is a refusal (`{ kind: "citation-required" }`) — the ONLY legitimate
 *      empty-citations path is the separate, explicitly-named `recordUngroundedDecision` below
 *      (D11/§14.2: two functions, never a boolean flag that blurs the two).
 *   4. A `GroundingLedgerReader` that throws (a misbehaving adapter violating R36) is caught here and
 *      collapses to the SAME `citation-unresolved` refusal a genuine `null` would have produced —
 *      never an uncaught exception (R36, gate3-addendum-fase5.md T55).
 *   5. Each resolved citation is passed through `validateGroundingCitation` before the mutation is
 *      even attempted — a non-finite/out-of-range score is `{ kind: "citation-invalid", reason }`,
 *      never silently clamped or forwarded to `GateStateStore.mutate()` to fail there with a
 *      misleading checksum error (D3 §5.3).
 */
export function recordGroundedDecision(
	_store: GateStateStore,
	_input: {
		gate: number;
		text: string;
		method: ApprovalMethod;
		citations: readonly { queryEventId: string; chunkHash: string }[];
	},
	_ledger: GroundingLedgerReader,
): Result<{ next: GateState; revision: number }, RecordDecisionError> {
	throw new Error("not implemented");
}

/**
 * The FR-17 escape hatch, SEPARATE and NAMED (D11/§14.2 — never a boolean parameter on
 * `recordGroundedDecision`). Accepted only when EITHER:
 *   (a) `ledger.findRecentUnreachable(now, UNREACHABLE_WINDOW_MS)` resolves a `rag-unreachable` the
 *       runtime genuinely recorded within the fixed 15-minute window (R35(i)(a)) — passing the
 *       constant unchanged, never a locally re-derived window; or
 *   (b) `input.override` is present, carrying an explicit, ATTRIBUTED risk-accept
 *       (`{ reason, acceptedBy }`) — the `[skip-ground]` analogue (R35(i)(b)) — loud and journaled,
 *       never a silent omission.
 * Neither present is a refusal (`{ kind: "no-recent-unreachable" }`). A `GroundingLedgerReader` that
 * throws collapses to the same refusal as a genuine `null` (R36) — an absent/illegible ledger is NEVER
 * synthesized into proof of unreachability (T55): the only escape left when the ledger itself cannot
 * be trusted is the explicit, attributed override in (b).
 */
export function recordUngroundedDecision(
	_store: GateStateStore,
	_input: { gate: number; text: string; method: ApprovalMethod; override?: { reason: string; acceptedBy: string } },
	_ledger: GroundingLedgerReader,
	_now: Date,
): Result<{ next: GateState; revision: number }, RecordDecisionError> {
	throw new Error("not implemented");
}
