/**
 * Test-first (Gate 5) for `curateCaptureEvent` (src/capture.ts) -- D5/G7, ADR 0007 §7 + §16 Apêndice
 * (docs/adr/0007-fase6-diary-and-capture.md).
 *
 * `curateCaptureEvent` is currently a STUB that throws "not implemented" -- every test below fails RED
 * for that one reason today (Gate 6 implements the body).
 *
 * Two DECIDED AMBIGUITIES this file locks (documented in src/capture.ts's own header, not invented
 * silently): (1) the subagent label for `agent-settled` (FR-17) -- `JournalAddInput.sessionId` stays
 * the SUBAGENT's own `event.sessionId`, and `parentSessionId` is carried in a `text` prefix, since
 * `JournalAddInput` has no dedicated field for it; (2) `null` is returned for an event whose `summary`
 * is empty -- the one case the Gate 5 task brief itself suggested as an example, not enumerated
 * verbatim by the ADR.
 */

import { describe, expect, it } from "vitest";
import { type CaptureConfig, type CaptureEvent, curateCaptureEvent } from "../src/capture.ts";
import { JOURNAL_KINDS } from "../src/journal-entry.ts";

function config(overrides: Partial<CaptureConfig> = {}): CaptureConfig {
	return { enabled: true, captureHighRiskBodies: false, rawBufferLimit: 500, ...overrides };
}

describe("curateCaptureEvent -- every CaptureEvent variant maps to a curated JournalAddInput with source:\"capture\"", () => {
	it('"turn-end" curates to a JournalAddInput with source:"capture" and a valid kind', () => {
		const event: CaptureEvent = {
			kind: "turn-end",
			sessionId: "session-1",
			summary: "decidiu adotar node:sqlite para o índice do diário",
			gate: 6,
		};

		const result = curateCaptureEvent(event, config());

		expect(result).not.toBeNull();
		expect(result?.source).toBe("capture");
		expect(JOURNAL_KINDS).toContain(result?.kind);
		expect(result?.sessionId).toBe("session-1");
		expect(result?.gate).toBe(6);
	});

	it('"agent-settled" curates to a JournalAddInput with source:"capture"', () => {
		const event: CaptureEvent = {
			kind: "agent-settled",
			sessionId: "subagent-session-9",
			parentSessionId: "orchestrator-session-1",
			summary: "sdet concluiu os testes RED da Fase 6",
			gate: 5,
		};

		const result = curateCaptureEvent(event, config());

		expect(result).not.toBeNull();
		expect(result?.source).toBe("capture");
		expect(JOURNAL_KINDS).toContain(result?.kind);
	});

	it('"session-shutdown" curates to a JournalAddInput with source:"capture"', () => {
		const event: CaptureEvent = {
			kind: "session-shutdown",
			sessionId: "session-1",
			summary: "sessão encerrada após aprovar o gate 6",
		};

		const result = curateCaptureEvent(event, config());

		expect(result).not.toBeNull();
		expect(result?.source).toBe("capture");
		expect(result?.sessionId).toBe("session-1");
		expect(JOURNAL_KINDS).toContain(result?.kind);
	});

	it('"gate-concluded" curates to a JournalAddInput with source:"capture", carrying the gate number', () => {
		const event: CaptureEvent = { kind: "gate-concluded", gate: 7, sessionId: "session-1", outcome: "approved" };

		const result = curateCaptureEvent(event, config());

		expect(result).not.toBeNull();
		expect(result?.source).toBe("capture");
		expect(result?.gate).toBe(7);
		expect(JOURNAL_KINDS).toContain(result?.kind);
	});
});

describe("curateCaptureEvent -- captureHighRiskBodies:false (default, R42/T61 secure-default) never amplifies a summary into a longer verbatim-shaped body", () => {
	it("the curated text is never dramatically larger than the summary it was built from, even when the summary itself already looks long/verbatim-shaped", () => {
		// Simulates an upstream caller accidentally handing this function a summary that already
		// resembles a raw verbatim excerpt (a long paragraph) -- curateCaptureEvent has no OTHER
		// source of content to pull from (CaptureEvent carries no rawBody/toolResult field in any
		// variant), so the curated text must never grow past a small, fixed labeling overhead on top
		// of what summary already contained.
		const longSummary =
			"Este é um resumo longo que imita, de propósito, um corpo verbatim de tool-result: " +
			"linha 1 do stack trace, linha 2 do stack trace, linha 3 do stack trace, e mais um bloco " +
			"de texto para simular um payload extenso que a captura NUNCA deveria amplificar.";
		const event: CaptureEvent = { kind: "turn-end", sessionId: "session-1", summary: longSummary };

		const result = curateCaptureEvent(event, config({ captureHighRiskBodies: false }));

		expect(result).not.toBeNull();
		// Small fixed overhead budget for a label/prefix -- proves the function is not concatenating
		// unrelated extra content (e.g. a hypothetical full transcript) on top of the given summary.
		expect(result!.text.length).toBeLessThanOrEqual(longSummary.length + 100);
	});
});

describe('curateCaptureEvent -- "agent-settled" labels the subagent (FR-17): never merged unlabeled into the orchestrator\'s own session', () => {
	it("keeps JournalAddInput.sessionId as the SUBAGENT's own session (event.sessionId), never overwritten by parentSessionId", () => {
		const event: CaptureEvent = {
			kind: "agent-settled",
			sessionId: "subagent-session-9",
			parentSessionId: "orchestrator-session-1",
			summary: "sdet concluiu os testes RED da Fase 6",
		};

		const result = curateCaptureEvent(event, config());

		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("subagent-session-9");
	});

	it("carries parentSessionId somewhere in the curated text -- the only surface JournalAddInput exposes for it today (decided ambiguity, see src/capture.ts header)", () => {
		const event: CaptureEvent = {
			kind: "agent-settled",
			sessionId: "subagent-session-9",
			parentSessionId: "orchestrator-session-1",
			summary: "sdet concluiu os testes RED da Fase 6",
		};

		const result = curateCaptureEvent(event, config());

		expect(result).not.toBeNull();
		expect(result?.text).toContain("orchestrator-session-1");
	});
});

describe("curateCaptureEvent -- returns null when the event has no curable content (decided ambiguity: an empty summary)", () => {
	it('returns null for a "turn-end" event whose summary is empty', () => {
		const event: CaptureEvent = { kind: "turn-end", sessionId: "session-1", summary: "" };

		const result = curateCaptureEvent(event, config());

		expect(result).toBeNull();
	});

	it('returns null for a "turn-end" event whose summary is only whitespace', () => {
		const event: CaptureEvent = { kind: "turn-end", sessionId: "session-1", summary: "   " };

		const result = curateCaptureEvent(event, config());

		expect(result).toBeNull();
	});
});
