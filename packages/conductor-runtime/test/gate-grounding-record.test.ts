/**
 * Test-first (Gate 5) for D4's two mint functions (ADR 0006 §6, `docs/adr/0006-fase5-library-and-
 * grounding.md`) — `recordGroundedDecision`/`recordUngroundedDecision` (src/gate-grounding.ts) are
 * currently unconditional throws ("not implemented"). Every test below fails RED for that one reason
 * today, driven against the REAL `GateStateStore` (createGateStateStore is already fully implemented,
 * Fase 4 Gate 6 landed) and a FAKE `GroundingLedgerReader`.
 *
 * Why a fake, not a real SQLite-backed ledger (grounding, already run by the orchestrator): Unit
 * Testing Principles §3.12 ("the real collaborator is cheap and in-process... a value object, a pure
 * calculator" needs no double) does NOT apply here — `@conductor/library`'s real ledger does not exist
 * yet in this fase, and even once it does, it is an out-of-process I/O boundary (SQLite/JSONL), the
 * kind of collaborator Outside-In Development §2.8/§2.12 says to drive with a double shaped by the
 * CALLER's own needs ("a fake shaped by caller needs", not a mock of the collaborator's internals) —
 * exactly `ResolveEvidenceRefContext`'s own `gitCommitExists` fake this package already uses for the
 * identical split ("fake the expensive collaborator, test the ordering/decision for real").
 *
 * The central property under test (T53's own attack shape, ADR §6.1 item 1): `recordGroundedDecision`
 * NEVER accepts a ready-made citation — it receives PONTEIROS and resolves them against the ledger,
 * copying whatever the ledger observed. The fixture below deliberately uses an implausible source/
 * section/score (a fixture no author would plausibly type from memory) specifically so a passing test
 * proves the citation came from the LEDGER, not from anything nearby in the input.
 */

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type GroundingLedgerReader,
	type RagQueryEventView,
	type RagUnreachableEventView,
	type RecordDecisionError,
	recordGroundedDecision,
	recordUngroundedDecision,
	UNREACHABLE_WINDOW_MS,
} from "../src/gate-grounding.ts";
import { createGateStateStore } from "../src/gate-state-store.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;
let gatesDir: string;

const DEMAND_ID = "demand-fase5-grounding";
const REPO_ID = "repo-pi";
const BRANCH = "feature/fase5-library-e-grounding";

beforeEach(() => {
	workspace = createScratchWorkspace();
	gatesDir = join(workspace.root, ".conductor", "gates");
});

afterEach(() => {
	workspace.cleanup();
});

function makeStore() {
	return createGateStateStore({ gatesDir, demandId: DEMAND_ID, repoId: REPO_ID, branch: BRANCH });
}

/** Deliberately implausible source/section/score (see this file's own header) — a fixture no author
 * would plausibly type from memory, so a matching assertion can only be satisfied by the function
 * genuinely copying what the LEDGER returned. */
function sampleQueryEvent(overrides: Partial<RagQueryEventView> = {}): RagQueryEventView {
	return {
		id: "q-1",
		question: "how should the SSRF guard validate the resolved IP?",
		enrichedQuery:
			"project:backend stack:node gate:4 role:software-architect how should the SSRF guard validate the resolved IP?",
		mode: "hybrid",
		corpusVersion: "corpus-v7",
		embeddingModel: "bge-m3",
		at: "2026-08-06T12:00:00.000Z",
		hits: [
			{
				chunkHash: "hash-1",
				source: "Zzyzx Field Manual for Ferret Husbandry",
				section: "§0 (deliberately implausible fixture)",
				path: "zzyzx.md",
				category: "unrelated",
				score: 0.913,
			},
		],
		...overrides,
	};
}

function fakeLedger(overrides: Partial<GroundingLedgerReader> = {}): GroundingLedgerReader {
	return {
		findQueryEvent: () => null,
		findRecentUnreachable: () => null,
		...overrides,
	};
}

describe("recordGroundedDecision — the citation reflects the LEDGER, never what the caller declared (D4 §6.1, R34)", () => {
	it("mints groundingCitations purely from the resolved RagQueryEventView — the caller's own input type cannot even carry source/section/score, only pointers", () => {
		const store = makeStore();
		const event = sampleQueryEvent();
		const ledger = fakeLedger({ findQueryEvent: (id) => (id === "q-1" ? event : null) });

		const result = recordGroundedDecision(
			store,
			{
				gate: 4,
				text: "chose node:sqlite for D1",
				method: "auto",
				citations: [{ queryEventId: "q-1", chunkHash: "hash-1" }],
			},
			ledger,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const decisions = result.value.next.gates[4].decisions;
		expect(decisions).toHaveLength(1);
		expect(decisions[0].kind).toBe("decision");
		expect(decisions[0].groundingCitations).toEqual([
			{
				queryEventId: "q-1",
				chunkHash: "hash-1",
				question: event.question,
				source: "Zzyzx Field Manual for Ferret Husbandry",
				section: "§0 (deliberately implausible fixture)",
				path: "zzyzx.md",
				category: "unrelated",
				corpusVersion: "corpus-v7",
				embeddingModel: "bge-m3",
				score: 0.913,
				retrievedAt: event.at,
				mode: "hybrid",
			},
		]);
	});

	it("persists the decision to disk — a fresh store instance re-reads the same citation (proves it went through GateStateStore.mutate, not just the in-memory return value)", () => {
		const store = makeStore();
		const event = sampleQueryEvent();
		const ledger = fakeLedger({ findQueryEvent: (id) => (id === "q-1" ? event : null) });

		recordGroundedDecision(
			store,
			{
				gate: 4,
				text: "chose node:sqlite for D1",
				method: "auto",
				citations: [{ queryEventId: "q-1", chunkHash: "hash-1" }],
			},
			ledger,
		);

		const reread = makeStore().read();
		expect(reread.ok).toBe(true);
		if (!reread.ok) return;
		expect(reread.value.state.gates[4].decisions[0]?.groundingCitations?.[0]?.chunkHash).toBe("hash-1");
	});

	it("refuses with citation-unresolved when the queryEventId does not resolve against the ledger — a dangling pointer is never attached as if it were real", () => {
		const store = makeStore();
		const ledger = fakeLedger(); // findQueryEvent always null

		const result = recordGroundedDecision(
			store,
			{ gate: 4, text: "...", method: "auto", citations: [{ queryEventId: "missing", chunkHash: "hash-1" }] },
			ledger,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual({ kind: "citation-unresolved", queryEventId: "missing", chunkHash: "hash-1" });
	});

	it("refuses with citation-unresolved when the queryEventId resolves but the chunkHash is not among that event's own hits", () => {
		const store = makeStore();
		const event = sampleQueryEvent();
		const ledger = fakeLedger({ findQueryEvent: (id) => (id === "q-1" ? event : null) });

		const result = recordGroundedDecision(
			store,
			{ gate: 4, text: "...", method: "auto", citations: [{ queryEventId: "q-1", chunkHash: "not-a-real-hash" }] },
			ledger,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual({ kind: "citation-unresolved", queryEventId: "q-1", chunkHash: "not-a-real-hash" });
	});

	it("refuses with citation-required when citations is empty — the ONLY legitimate empty-citations path is recordUngroundedDecision below (FR-16 fail-closed)", () => {
		const store = makeStore();
		const ledger = fakeLedger();

		const result = recordGroundedDecision(store, { gate: 4, text: "...", method: "auto", citations: [] }, ledger);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual({ kind: "citation-required" });
	});

	it("refuses with citation-invalid, never crashing the checksum, when a resolved hit carries a non-finite score (D3 §5.3 applied at the mint boundary)", () => {
		const store = makeStore();
		const event = sampleQueryEvent({
			hits: [{ chunkHash: "hash-1", source: "S", section: "1", path: "p.md", category: "c", score: Number.NaN }],
		});
		const ledger = fakeLedger({ findQueryEvent: (id) => (id === "q-1" ? event : null) });

		const result = recordGroundedDecision(
			store,
			{ gate: 4, text: "...", method: "auto", citations: [{ queryEventId: "q-1", chunkHash: "hash-1" }] },
			ledger,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("citation-invalid");
	});
});

describe("GroundingLedgerReader that throws — R36: a failing adapter never crashes recordGroundedDecision; it collapses to the same refusal a genuine null would produce, never a thrown exception (gate3-addendum-fase5.md §8 T55)", () => {
	it("does not propagate an exception thrown by findQueryEvent (simulated EACCES/corruption) — treated as citation-unresolved, never a crash", () => {
		const store = makeStore();
		const ledger = fakeLedger({
			findQueryEvent: () => {
				throw new Error("EACCES: permission denied, open '~/.conductor/library/projects/x/events.jsonl'");
			},
		});
		const input = {
			gate: 4,
			text: "...",
			method: "auto" as const,
			citations: [{ queryEventId: "q-1", chunkHash: "hash-1" }],
		};

		expect(() => recordGroundedDecision(store, input, ledger)).not.toThrow();

		const result = recordGroundedDecision(store, input, ledger);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect((result.error as RecordDecisionError).kind).toBe("citation-unresolved");
	});
});

describe("recordUngroundedDecision — FR-17 requires a runtime-recorded rag-unreachable within the window, or an explicit attributed override (D11/D13, R35)", () => {
	it("accepts when a rag-unreachable was recorded 5 minutes before `now` (inside the 15-minute window)", () => {
		const store = makeStore();
		const now = new Date("2026-08-06T12:15:00.000Z");
		const unreachable: RagUnreachableEventView = {
			id: "u-1",
			backend: "embeddings",
			reason: "connect ECONNREFUSED 127.0.0.1:11434",
			at: "2026-08-06T12:10:00.000Z",
		};
		const ledger = fakeLedger({ findRecentUnreachable: () => unreachable });

		const result = recordUngroundedDecision(
			store,
			{ gate: 4, text: "proceeding ungrounded", method: "auto" },
			ledger,
			now,
		);

		expect(result.ok).toBe(true);
	});

	it("passes the UNREACHABLE_WINDOW_MS constant (15 minutes) to the ledger — never a locally re-derived window (D13 §16.3: a fixed constant of the code)", () => {
		const store = makeStore();
		const now = new Date("2026-08-06T12:15:00.000Z");
		const calls: { now: Date; windowMs: number }[] = [];
		const ledger = fakeLedger({
			findRecentUnreachable: (calledNow, windowMs) => {
				calls.push({ now: calledNow, windowMs });
				return null;
			},
		});

		recordUngroundedDecision(store, { gate: 4, text: "proceeding ungrounded", method: "auto" }, ledger, now);

		expect(UNREACHABLE_WINDOW_MS).toBe(15 * 60_000);
		expect(calls).toEqual([{ now, windowMs: UNREACHABLE_WINDOW_MS }]);
	});

	it("refuses with no-recent-unreachable when the ledger has nothing recent and no override is given", () => {
		const store = makeStore();
		const ledger = fakeLedger(); // findRecentUnreachable always null

		const result = recordUngroundedDecision(
			store,
			{ gate: 4, text: "proceeding ungrounded", method: "auto" },
			ledger,
			new Date(),
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual({ kind: "no-recent-unreachable" });
	});

	it("accepts an explicit, attributed override even with no recent rag-unreachable event (R35(i)(b), the [skip-ground] analogue)", () => {
		const store = makeStore();
		const ledger = fakeLedger();

		const result = recordUngroundedDecision(
			store,
			{
				gate: 4,
				text: "proceeding ungrounded",
				method: "human",
				override: { reason: "backend down for maintenance, confirmed manually", acceptedBy: "elton" },
			},
			ledger,
			new Date(),
		);

		expect(result.ok).toBe(true);
	});

	it("does not propagate an exception thrown by findRecentUnreachable — collapses to no-recent-unreachable, never a crash (R36) — the only remaining path is the explicit override", () => {
		const store = makeStore();
		const ledger = fakeLedger({
			findRecentUnreachable: () => {
				throw new Error("ENOENT: no such file or directory, open '~/.conductor/library/projects/x/events.jsonl'");
			},
		});
		const input = { gate: 4, text: "proceeding ungrounded", method: "auto" as const };

		expect(() => recordUngroundedDecision(store, input, ledger, new Date())).not.toThrow();

		const result = recordUngroundedDecision(store, input, ledger, new Date());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual({ kind: "no-recent-unreachable" });
	});
});
