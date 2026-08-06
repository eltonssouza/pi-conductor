/**
 * Test-first (Gate 5) for gate sign-off minting (`mintHumanApproval`/`mintAutoApproval`/
 * `isGenuineHumanApproval`, src/gate-approval.ts) — Fase 4 "Gates e evidências", ADR 0005 §6/§18
 * appendix, gate2-spec-fase4.md Grupo D FR-7/FR-10/FR-11, gate3-addendum-fase4.md T40, rule R22.
 *
 * All three functions are currently STUBS that unconditionally throw "not implemented" — every test
 * below fails RED for that one reason today, the same precedent `test/tools/task.test.ts`'s own header
 * documents for `runTask` at its own Gate 5. They are written against the REAL, locked contract (ADR
 * 0005 §6) so that once Gate 6 fills each body, each test becomes the actual proof of the FR/rule it
 * names — not a redundant re-statement of "it doesn't throw".
 *
 * The STATIC "no other file constructs method:\"human\" by hand" half of R22's non-fabrication
 * guarantee lives in its own file, gate-approval-sole-mint.test.ts (mirrors
 * test/tools/task-sole-constructor.test.ts's own discipline for T41's "sole constructor").
 */

import { describe, expect, it } from "vitest";
import { confirmOrDeny } from "../src/confirm.ts";
import {
	type Approval,
	type ApprovalMeta,
	isGenuineHumanApproval,
	mintAutoApproval,
	mintHumanApproval,
} from "../src/gate-approval.ts";
import { createTestUiContext } from "./support/test-ui.ts";

const META: ApprovalMeta = { gate: 5, demandId: "demand-1", branch: "feature/fase4-gates-e-evidencias", source: "session-abc" };

describe('mintHumanApproval (R22: the sole producer of method:"human")', () => {
	it("mints a human Approval carrying the caller's gate/demandId/branch/source when confirmResult is true", () => {
		const approval = mintHumanApproval(true, META);

		expect(approval).not.toBeNull();
		expect(approval?.method).toBe("human");
		expect(approval?.gate).toBe(5);
		expect(approval?.demandId).toBe("demand-1");
		expect(approval?.branch).toBe("feature/fase4-gates-e-evidencias");
		expect(approval?.source).toBe("session-abc");
	});

	it("stamps approvedAt as an ISO-8601 string, never a Date (ADR 0005 §9.2 checksum gotcha)", () => {
		const approval = mintHumanApproval(true, META);

		expect(typeof approval?.approvedAt).toBe("string");
		expect(new Date(approval!.approvedAt).toISOString()).toBe(approval!.approvedAt);
	});

	it('returns null -- never throws -- when confirmResult is false (fail-closed, mirrors SharedBudget.reserve()\'s "uncertainty returns null" contract)', () => {
		expect(mintHumanApproval(false, META)).toBeNull();
	});

	it("headless/no-UI (T40b): confirmOrDeny resolves false without ever prompting, and that false can never mint human", async () => {
		// The realistic shape of "invoke the mint without the channel": a headless ctx (no UI bound)
		// goes through the REAL confirmOrDeny (Fase 2, already GREEN) and resolves to `false` --
		// mintHumanApproval must never treat some other boolean as "human" just because the caller
		// wanted a shortcut. `confirmResult: true` on the test double proves the deny is because there
		// is NO UI, not because the double happened to say no.
		const ui = createTestUiContext({ confirmResult: true });
		const confirmed = await confirmOrDeny({ ui, hasUI: false }, "Approve gate 5?", "sign-off for gate 5");

		expect(confirmed).toBe(false);
		expect(ui.confirmCalls).toHaveLength(0); // never even attempted to prompt (confirm.ts's own contract)
		expect(mintHumanApproval(confirmed, META)).toBeNull();
	});

	it("timeout/deny on the real channel also can never mint human", async () => {
		const ui = createTestUiContext({ confirmResult: false });
		const confirmed = await confirmOrDeny({ ui, hasUI: true }, "Approve gate 5?", "sign-off for gate 5");

		expect(confirmed).toBe(false);
		expect(mintHumanApproval(confirmed, META)).toBeNull();
	});

	it('a hand-built object literal claiming method:"human" is detectably NOT a genuine mint (isGenuineHumanApproval)', () => {
		const forged = { ...META, method: "human", approvedAt: new Date().toISOString() } as unknown as Approval;

		expect(isGenuineHumanApproval(forged)).toBe(false);
	});

	it("a real mint IS recognized as genuine by isGenuineHumanApproval", () => {
		const approval = mintHumanApproval(true, META);

		expect(isGenuineHumanApproval(approval!)).toBe(true);
	});
});

describe('mintAutoApproval (FR-10: the sole producer of method:"auto" -- BR-7 never collapses into human)', () => {
	it('always mints method:"auto"', () => {
		const approval = mintAutoApproval(META);

		expect(approval.method).toBe("auto");
		expect(approval.gate).toBe(5);
		expect(approval.demandId).toBe("demand-1");
	});

	it("stamps approvedAt as an ISO-8601 string", () => {
		const approval = mintAutoApproval(META);

		expect(new Date(approval.approvedAt).toISOString()).toBe(approval.approvedAt);
	});

	it("is never recognized as a genuine human mint -- an auto approval is structurally distinguishable from a human one", () => {
		const approval = mintAutoApproval(META);

		expect(isGenuineHumanApproval(approval)).toBe(false);
	});
});
