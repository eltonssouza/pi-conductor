/**
 * SharedBudget — one token budget shared, by reference, across an entire delegation tree (Gate 2
 * spec Grupo G: FR-16/FR-17; ADR 0004 §5; gate3-addendum-fase3.md T33a/T33b/T40, R16a/R16b).
 *
 * GATE 5 (test-first): `createSharedBudget` and `createBudgetGuardedModelRuntime` are STUBS that
 * throw "not implemented" — Gate 6 implements the bodies. This mirrors this package's own
 * `redaction.ts` precedent ("GATE 5: redactSecrets()/redactSessionEntryForPersistence() are STUBS
 * that throw") rather than a silent no-op: every test below calls the real, locked interface
 * (ADR 0004 §16 appendix — do not change these shapes without a new ADR) and fails RED for the
 * single, correct reason that Gate 6 has not written the body yet.
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
export function createSharedBudget(_limit: number): SharedBudget {
	throw new Error(
		"createSharedBudget: not implemented (Gate 6) — see docs/adr/0004-fase3-roles-skills-subagents.md §5.2/§5.3 " +
			"and docs/conductor/gate3-addendum-fase3.md §9 T40 for the binding reserve/settle contract",
	);
}

/**
 * Wraps a Pi `ModelRuntime` so every `streamSimple` call is preceded by a budget check that can
 * deny the call outright (ADR §5.1): a `Proxy` over `ModelRuntime.streamSimple`, NOT the
 * `before_provider_request` extension hook — that hook's own runner wraps every handler in a
 * try/catch and continues with the original payload on a throw (`runner.ts:1016-1048`), so a
 * budget guard placed there would be silently defeated. The genuine, non-swallowed throw has to
 * come from the seam `CreateAgentSessionOptions.modelRuntime` actually calls.
 *
 * `base` is intentionally typed as `T` (not the concrete `ModelRuntime` class) so this stub's
 * signature does not force this package to import `@earendil-works/pi-coding-agent`'s `ModelRuntime`
 * before Gate 6 needs to — the real Gate 6 implementation will narrow this to `ModelRuntime`.
 */
export function createBudgetGuardedModelRuntime<T>(_base: T, _budget: SharedBudget): T {
	throw new Error(
		"createBudgetGuardedModelRuntime: not implemented (Gate 6) — see docs/adr/0004-fase3-roles-skills-subagents.md §5.1 " +
			"(Proxy over ModelRuntime.streamSimple, never before_provider_request)",
	);
}
