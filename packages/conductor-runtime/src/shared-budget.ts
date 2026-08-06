/**
 * SharedBudget — one token budget shared, by reference, across an entire delegation tree (Gate 2
 * spec Grupo G: FR-16/FR-17; ADR 0004 §5; gate3-addendum-fase3.md T33a/T33b/T40, R16a/R16b).
 *
 * GATE 6: `createSharedBudget` and `createBudgetGuardedModelRuntime` are now implemented for real,
 * against the exact, locked interface Gate 5 pinned below (ADR 0004 §16 appendix — do not change
 * these shapes without a new ADR). `createSharedBudget` is exercised directly by
 * `test/shared-budget.test.ts`; `createBudgetGuardedModelRuntime` is wired into the real
 * `createGovernedChildSessionSpawner` production path in `tools/task.ts` (no dedicated unit test of
 * its own yet — Gate 7 follow-up — but it is a genuine, reachable call site, not dead code).
 *
 * The interface itself already encodes three binding decisions from ADR 0004 §5 / the Gate 3
 * reconciliation (gate3-addendum-fase3.md §9 T40) that Gate 6's implementation MUST satisfy, not
 * just "some working budget":
 *
 *   1. `reserve(estimate)` is check-AND-reserve in ONE synchronous call — it DEBITS `remaining()`
 *      immediately (optimistic reservation), never defers the debit to `settle()`. This is what
 *      closes the T40 "reserve→settle window" race: a second concurrent `reserve()` must observe
 *      the already-debited balance, not a stale one (ADR §5.3).
 *   2. `reserve`/`settle` have ZERO `await`/Promise in their own body and there is deliberately NO
 *      separate `check()` — the API cannot express the two-call TOCTOU shape T33b warns about.
 *   3. `reserve` NEVER throws — an exhausted or unreadable budget returns `null` (R16a: "incerteza
 *      nega", but as a graceful signal, never an exception the caller must remember to catch).
 *      `settle()` applies a ceiling-check so a real cost that overshoots its estimate is reflected in
 *      `remaining()` immediately, not silently forgiven until the next `reserve()` (T40's second
 *      precision: "estimate teto-superior OU ceiling-check no settle").
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface BudgetUsage {
	input: number;
	output: number;
	total: number;
}

/** Opaque handle returned by `reserve()`; passed back unchanged to `settle()`. */
export interface BudgetReservation {
	readonly estimatedCost: number;
}

export interface SharedBudget {
	/**
	 * Check-AND-reserve in a single synchronous call (ADR §5.2/§5.3). Returns `null` — never
	 * throws — when the estimate would exceed `remaining()`, or the budget's internal state is not
	 * confidently readable (R16a: unknown/illegible = treated as exhausted, not as "allow").
	 */
	reserve(estimatedCost: number): BudgetReservation | null;
	/** Reconciles the estimate already debited by `reserve` with the real cost of the call. */
	settle(reservation: BudgetReservation, actual: BudgetUsage): void;
	remaining(): number;
	readonly limit: number;
}

/** Thrown by callers (e.g. the `task` tool, FR-17) that choose to surface exhaustion as an
 * exception at their own boundary — `SharedBudget` itself never throws this or anything else. */
export class BudgetExhaustedError extends Error {}

/**
 * Constructs the ONE `SharedBudget` object for a top-level session's entire delegation tree
 * (ADR §5.2: "construído uma vez no composition root ... passado por referência por toda a
 * recursão"). `sharedBudget` is a REQUIRED, non-optional constructor parameter of the `task` tool
 * (see tools/task.ts's `CreateTaskToolOptions`) specifically so no code path can construct a
 * child's own budget instead of reusing this one — R16b ("nenhum filho recebe cota própria") holds
 * by construction (a TypeScript compile error on omission), not by a convention a future edit could
 * forget.
 */
export function createSharedBudget(limit: number): SharedBudget {
	let spent = 0;

	return {
		limit,
		remaining: () => limit - spent,
		reserve(estimatedCost: number): BudgetReservation | null {
			// R16a: an estimate that isn't a finite, non-negative number is "uncertain" -- denied outright,
			// never treated as zero-cost or unlimited.
			if (!Number.isFinite(estimatedCost) || estimatedCost < 0) return null;
			if (estimatedCost > limit - spent) return null;
			// T40 precision #1 (gate3-addendum-fase3.md §9): DEBIT HERE, synchronously, before returning --
			// never defer the debit to settle(). This single line is what closes the reserve->settle race:
			// a second, concurrent reserve() -- even one separated from this one by a real `await` gap, as
			// the Promise.all test proves -- observes `remaining()` already reduced by this reservation,
			// never a stale value. Nothing between this check and this mutation ever awaits.
			spent += estimatedCost;
			return { estimatedCost };
		},
		settle(reservation: BudgetReservation, actual: BudgetUsage): void {
			// Reconcile the optimistic debit reserve() already applied with the real cost, synchronously.
			// If `actual.total` overshoots `reservation.estimatedCost` (an under-estimate), this INCREASES
			// `spent` beyond what reserve() alone committed -- T40 precision #2, the "ceiling-check on
			// settle": the overshoot lands in remaining() immediately, not forgiven until some later
			// reserve() happens to notice. If `actual.total` undershoots the estimate, the difference is
			// credited back the same way -- settle() is the single place either direction is reconciled.
			spent += actual.total - reservation.estimatedCost;
		},
	};
}

/**
 * Wraps a Pi `ModelRuntime` so every `streamSimple` call is preceded by a budget check that can
 * deny the call outright (ADR §5.1): a `Proxy` over `ModelRuntime.streamSimple`, NOT the
 * `before_provider_request` extension hook — that hook's own runner wraps every handler in a
 * try/catch and continues with the original payload on a throw (`runner.ts:1016-1048`), so a
 * budget guard placed there would be silently defeated. The genuine, non-swallowed throw has to
 * come from the seam `CreateAgentSessionOptions.modelRuntime` actually calls.
 *
 * Gate 6 narrows the Gate-5 stub's generic `<T>` signature to the concrete `ModelRuntime` class, per
 * this function's own Gate-5 doc ("the real Gate 6 implementation will narrow this to
 * `ModelRuntime`") — real production wiring (this file's own `createGovernedChildSessionSpawner` in
 * `tools/task.ts`) needs to actually call `.streamSimple`/`.result()`, which requires the concrete
 * type. `ModelRuntime` has no genuine `#`-private runtime fields (TypeScript `private` erases to a
 * plain property), so proxying an instance is safe; every non-`streamSimple` property access is still
 * explicitly re-bound to `target` below rather than left to resolve against the Proxy receiver, as
 * cheap insurance against any method that closes over `this` expecting a real `ModelRuntime` identity.
 */
const DEFAULT_MODEL_CALL_TOKEN_ESTIMATE = 4_000;

function settleModelCallUsage(
	stream: ReturnType<ModelRuntime["streamSimple"]>,
	budget: SharedBudget,
	reservation: BudgetReservation,
): void {
	stream.result().then(
		(message) => {
			const usage = message.usage;
			budget.settle(reservation, { input: usage.input, output: usage.output, total: usage.totalTokens });
		},
		() => {
			// The call failed before producing any usage at all -- no tokens were actually billed, so
			// credit the full reservation back rather than leave it permanently (and wrongly) debited.
			budget.settle(reservation, { input: 0, output: 0, total: 0 });
		},
	);
}

export function createBudgetGuardedModelRuntime(base: ModelRuntime, budget: SharedBudget): ModelRuntime {
	return new Proxy(base, {
		get(target, prop, receiver) {
			if (prop === "streamSimple") {
				return (...args: Parameters<ModelRuntime["streamSimple"]>): ReturnType<ModelRuntime["streamSimple"]> => {
					// ADR §5.1: the genuine, NON-swallowed throw `before_provider_request` cannot give us --
					// that hook's own runner wraps every handler in try/catch and continues with the
					// original payload on a throw (runner.ts:1016-1048). This Proxy instead sits on the
					// actual seam `CreateAgentSessionOptions.modelRuntime` calls, so a throw here propagates
					// through the real `await` chain of the Agent's own `streamFn` -- the child's `task`
					// wrapper (`runTask`'s try/catch around `spawnChildSession`) converts it into the
					// graceful `Result.error` FR-17 requires, never a crash of the parent.
					const reservation = budget.reserve(DEFAULT_MODEL_CALL_TOKEN_ESTIMATE);
					if (reservation === null) {
						throw new BudgetExhaustedError(
							"SharedBudget exhausted or unreadable — denying this model call before it starts (R16a, ADR 0004 §5.1)",
						);
					}
					const stream = target.streamSimple(...args);
					settleModelCallUsage(stream, budget, reservation);
					return stream;
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
