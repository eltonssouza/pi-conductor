/**
 * Test-first (Gate 5) for SharedBudget (Gate 2 spec Grupo G: FR-16/FR-17; ADR 0004 §5;
 * gate3-addendum-fase3.md T33a/T33b/T40, R16a/R16b).
 *
 * `createSharedBudget` is currently a STUB that throws "not implemented" (src/shared-budget.ts) —
 * every test below drives the REAL, locked interface directly (no mocks of `SharedBudget` itself;
 * per Unit Testing Principles — Complete Professional Guide §2.5/§3.12, "test the contract" and
 * "the real collaborator is cheap and in-process" — a value-shaped budget object is exactly that
 * case, so this file never substitutes a test double for the thing under test) and fails RED for
 * the single correct reason: Gate 6 has not written the body yet.
 *
 * The T40 tests are the most important in this file (gate3-addendum-fase3.md §9, T40): they encode
 * the precise reconciliation the Gate 3↔4 loop-back locked in, not just "a budget that runs out" —
 * see each test's own header for which precision it pins.
 */

import { describe, expect, it } from "vitest";
import { type BudgetReservation, createSharedBudget } from "../src/shared-budget.ts";

describe("SharedBudget: FR-16/BR-4/BR-8 — a child's spend is deducted from the SAME shared quota as the parent", () => {
	it("a reservation settled through one reference is visible via any other reference to the SAME object (no copy, no separate quota)", () => {
		const parentBudget = createSharedBudget(1000);
		// R16b by construction: there is no `SharedBudget` constructor a "child" could call to get its
		// own quota — a child that shares budget with its parent, by this contract, is the SAME object
		// reference, never a second instance. This IS the mechanism BR-4 names ("nunca uma cota
		// própria"), not a convention layered on top of two independent budgets.
		const childBudget = parentBudget;

		const reservation = childBudget.reserve(300);
		expect(reservation).not.toBeNull();
		childBudget.settle(reservation as BudgetReservation, { input: 200, output: 100, total: 300 });

		expect(parentBudget.remaining()).toBe(700);
	});
});

describe("SharedBudget: FR-17/R16a — exhaustion is a graceful, fail-closed signal, never a thrown exception", () => {
	it("reserve() returns null once the limit is spent, and never throws doing so", () => {
		const budget = createSharedBudget(50);
		const first = budget.reserve(50);
		expect(first).not.toBeNull();

		expect(() => budget.reserve(1)).not.toThrow();
		expect(budget.reserve(1)).toBeNull();
	});

	it("an estimate larger than the WHOLE limit is rejected outright, not partially granted", () => {
		const budget = createSharedBudget(100);
		expect(budget.reserve(101)).toBeNull();
		expect(budget.remaining()).toBe(100); // untouched — a rejected reservation must not debit anything
	});
});

describe("SharedBudget: R16a — an invalid estimate is treated as \"uncertain\" and denied, never silently allowed", () => {
	it("rejects NaN and negative estimates instead of treating them as zero-cost or unlimited", () => {
		const budget = createSharedBudget(100);
		expect(budget.reserve(Number.NaN)).toBeNull();
		expect(budget.reserve(-10)).toBeNull();
		expect(budget.remaining()).toBe(100);
	});
});

describe("SharedBudget: T40 (gate3-addendum-fase3.md §9) — reserve() debits AT reserve-time, closing the reserve→settle race", () => {
	// Precision #1 (§9 T40 mitigation item 1): "reserve DEBITA no reserve-time (reserva otimista),
	// nunca 'registra intenção e debita só no settle'". Proven WITHOUT any async gap at all: two
	// back-to-back synchronous reserve() calls must already see each other's debit, because if the
	// debit were deferred to settle(), both would see the same stale `remaining()` and both would
	// wrongly succeed.
	it("a second reserve() immediately sees the first reserve()'s debit, even though neither has settled yet", () => {
		const budget = createSharedBudget(100);

		const first = budget.reserve(60);
		const second = budget.reserve(60); // 60 + 60 > 100 -- must be rejected

		expect(first).not.toBeNull();
		expect(second).toBeNull();
		expect(budget.remaining()).toBe(40);
	});

	// The literal scenario the Gate 4 prompt raised (§9 T40's own framing): "e se uma chamada
	// assíncrona (o streaming do modelo) acontecer ENTRE reserve e settle, abrindo uma janela onde
	// outro subagente reserva sobre um saldo desatualizado?" — simulated here with a REAL `await` gap
	// (via Promise.all + a macrotask) between two concurrent workers' own reserve() and settle(),
	// matching the task's own instruction: "teste de race real com Promise.all, não sequencial".
	it("N concurrent subagents whose combined estimates exceed the limit: the total committed spend never exceeds the limit by more than one in-flight reservation", async () => {
		const budget = createSharedBudget(100);

		async function simulateSubagentTurn(estimate: number, actual: number): Promise<boolean> {
			const reservation = budget.reserve(estimate);
			if (reservation === null) return false;
			// A real asynchronous gap standing in for the model's own streaming turn — if `reserve`
			// deferred its debit to `settle`, both concurrent workers would race through this gap
			// reading the SAME stale `remaining()` and both would have "succeeded" above.
			await new Promise((resolve) => setTimeout(resolve, 0));
			budget.settle(reservation, { input: actual, output: 0, total: actual });
			return true;
		}

		const results = await Promise.all([
			simulateSubagentTurn(60, 60),
			simulateSubagentTurn(60, 60),
			simulateSubagentTurn(60, 60),
			simulateSubagentTurn(60, 60),
		]);

		const succeeded = results.filter(Boolean).length;
		// Only ONE 60-unit reservation fits inside a 100-unit limit; if `reserve` debited lazily, up
		// to all four could have "succeeded" concurrently before any of them settled.
		expect(succeeded).toBe(1);
		expect(budget.remaining()).toBe(40);
	});

	// Precision #2 (§9 T40 mitigation item 2 / the ADR's own restated bound): "o bound de
	// 'uma em voo' só vale com estimate teto-superior; senão, ceiling-check fail-closed no settle".
	// This drives the OTHER side of that bound: an estimate that UNDER-shoots the real cost must not
	// let `remaining()` silently go negative/unnoticed — the ceiling-check has to fire at settle time,
	// immediately, not only be caught by the NEXT reserve() call.
	it("settle() applies a ceiling-check: an actual cost that overshoots its estimate is reflected in remaining() immediately, and the budget fails closed once truly exhausted", () => {
		const budget = createSharedBudget(100);

		const reservation = budget.reserve(10); // an under-estimate relative to what actually gets spent
		expect(reservation).not.toBeNull();
		budget.settle(reservation as BudgetReservation, { input: 90, output: 10, total: 100 }); // real cost = 100

		// The real spend (100) has now consumed the ENTIRE limit -- remaining() must reflect the real
		// cost from settle(), not the optimistic 10-unit debit reserve() applied before the true cost
		// was known.
		expect(budget.remaining()).toBeLessThanOrEqual(0);

		// R16a/R16b: with the limit truly exhausted by real spend, the NEXT reservation attempt --
		// however small -- must fail closed, proving the ceiling-check's effect persists rather than
		// being forgiven on the next call.
		expect(budget.reserve(1)).toBeNull();
	});
});
