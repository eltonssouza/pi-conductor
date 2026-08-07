/**
 * Test-first (Gate 5) for D3's finiteness guard (ADR 0006 §5.3, `docs/adr/0006-fase5-library-and-
 * grounding.md`) — `validateGroundingCitation` (src/gate-grounding.ts) is currently an unconditional
 * throw ("not implemented"), the same precedent every Fase-4 Gate-5 stream already established
 * (gate-approval.ts, gate-evidence.ts). Every test below fails RED for that one reason today.
 *
 * Why this guard exists at all (not a hypothetical attacker): `canonicalizeJsonForChecksum`
 * (gate-state-store.ts:148-151) THROWS on any non-finite number reaching the checksummed `GateState` —
 * and since the checksum covers the WHOLE state, a single `score: NaN` would brick every future
 * mutation of that gate with a misleading "checksum input must contain only finite numbers" error, not
 * a citation-shaped diagnosis. ADR §5.3 names the concrete, non-adversarial path to `NaN`: D14's
 * min-max rerank-score normalization has a zero denominator whenever the candidate set is tied — a
 * completely ordinary day, not an attack.
 *
 * Grounding (already run by the orchestrator, `cdt library ... --gate 5`): Unit Testing Principles
 * §3.12 ("the real collaborator is cheap and in-process... a pure calculator needs no test double") —
 * `validateGroundingCitation` is exactly that pure calculator, exercised directly with plain object
 * fixtures below, no double of any kind.
 */

import { describe, expect, it } from "vitest";
import { type GroundingCitation, validateGroundingCitation } from "../src/gate-grounding.ts";

function validCitation(overrides: Partial<GroundingCitation> = {}): GroundingCitation {
	return {
		queryEventId: "q-1",
		chunkHash: "hash-1",
		question: "how should the SSRF guard validate the resolved IP?",
		source: "Penetration Testing — Complete Professional Guide",
		section: "§12.9",
		path: "penetration-testing.md",
		category: "security",
		corpusVersion: "corpus-v7",
		embeddingModel: "bge-m3",
		score: 0.736,
		retrievedAt: "2026-08-06T12:00:00.000Z",
		mode: "hybrid",
		...overrides,
	};
}

describe("validateGroundingCitation — the finiteness guard before ANY citation reaches the checksummed GateState (D3 §5.3)", () => {
	it("accepts a score at each boundary of the closed interval [0,1], and a midpoint", () => {
		expect(validateGroundingCitation(validCitation({ score: 0 }))).toEqual({ ok: true });
		expect(validateGroundingCitation(validCitation({ score: 1 }))).toEqual({ ok: true });
		expect(validateGroundingCitation(validCitation({ score: 0.5 }))).toEqual({ ok: true });
	});

	it("refuses NaN — the concrete, non-adversarial bug D14's min-max rerank normalization produces on a zero denominator (ADR §17.2), never silently clamped into range", () => {
		const result = validateGroundingCitation(validCitation({ score: Number.NaN }));
		expect(result.ok).toBe(false);
	});

	it("refuses Infinity", () => {
		expect(validateGroundingCitation(validCitation({ score: Number.POSITIVE_INFINITY })).ok).toBe(false);
	});

	it("refuses a negative score", () => {
		expect(validateGroundingCitation(validCitation({ score: -1 })).ok).toBe(false);
	});

	it("refuses a score above 1", () => {
		expect(validateGroundingCitation(validCitation({ score: 1.5 })).ok).toBe(false);
	});

	it("refuses an undefined score — a hand-edited/corrupted ledger line has no runtime type guarantee even though GroundingCitation types `score` as `number`", () => {
		const corrupted = validCitation({ score: undefined as unknown as number });
		expect(validateGroundingCitation(corrupted).ok).toBe(false);
	});

	it("never clamps a refused score into range — a clamp would hide the exact rerank-normalization bug that produced it (ADR §5.3's own reading of Managing Software Complexity §3.1, 'defining errors out of existence')", () => {
		const result = validateGroundingCitation(validCitation({ score: Number.NaN }));
		// A silent-clamp implementation would return { ok: true } with some in-range score instead.
		expect(result).not.toMatchObject({ ok: true });
	});

	it("an ok:true result never carries a `reason` key — omitted, never present-as-undefined (the aggregate-wide discipline ADR §5.3 generalizes from gate-store.ts's own `note` precedent, gate-store.ts:201-206)", () => {
		const result = validateGroundingCitation(validCitation({ score: 0.5 }));
		expect(result.ok).toBe(true);
		expect(Object.keys(result)).toEqual(["ok"]);
	});

	it("an ok:false result always carries a non-empty `reason` string", () => {
		const result = validateGroundingCitation(validCitation({ score: Number.NaN }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason.length).toBeGreaterThan(0);
	});
});
