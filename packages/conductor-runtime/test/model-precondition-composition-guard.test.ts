/**
 * Test-first (Gate 5) for Fase 7 D4 — "recusa fail-closed imposta em três pontos de autorização de
 * trabalho, ZERO mudança na máquina de gates" (docs/adr/0008-fase7-model-routing-and-providers.md §6,
 * §16 appendix "@conductor/runtime — a PORTA"). The ADR is explicit, quoted verbatim in its own §6.2:
 *
 *   "gate-state-policy.ts não muda. evaluateAdvance continua respondendo só sobre evidência e ordem de
 *   gates. A pré-condição de modelo é uma SEGUNDA verificação, independente e composta, com verdict
 *   próprio (ModelPreconditionVerdict) — nunca um valor novo em GateAdvanceVerdict."
 *
 * This file is a COMPOSITION REGRESSION GUARD, not a test of `evaluateModelPrecondition`'s own
 * resolution behavior (that belongs to whichever module Gate 6 introduces to hold it — this file does
 * not assume its filename, only its PUBLIC CONTRACT from the ADR §16 appendix, imported through the
 * package barrel `../src/index.ts`, the same surface `@conductor/cli`'s composition root would use).
 * Two things must both hold, together, for Gate 6 to close this file GREEN:
 *
 *   1. `evaluateModelPrecondition` exists and is importable from `@conductor/runtime`'s public surface
 *      — RED today: the symbol does not exist anywhere in this package yet.
 *   2. `evaluateAdvance`'s REAL, already-implemented return shape (`GateAdvanceVerdict`,
 *      `src/gate-state-policy.ts:45-48`) stays byte-for-byte what it already is today — this half
 *      already passes (it exercises code Fase 4 shipped) and is the locked-down baseline: if a future
 *      Gate 6 pass ever "helpfully" added a model-related arm to `GateAdvanceVerdict` instead of
 *      composing a genuinely SEPARATE `ModelPreconditionVerdict` beside it, this same assertion would
 *      turn RED for a NEW, different reason (a `kind` value `gate-state-policy.ts` never had before
 *      Fase 7) — exactly the regression D4 rules out.
 *
 * `evaluateAdvance` itself is called for REAL here (never a mock/double for the thing this file
 * protects — Unit Testing Principles §3.9/§3.12, same discipline `gate-state-policy.test.ts` already
 * established for this exact function), against a plain `GateState` fixture built the same way that
 * file's own `makeGateState`/`approvedRecord`/`notStartedRecord` helpers do (duplicated here rather
 * than imported: those helpers are test-file-local, not exported, in the existing Fase 4 file).
 */

// Type-only, per ADR 0008 §16's own port contract ("@conductor/runtime — a PORTA (nenhuma
// implementação, nenhum import do adapter)"): `@conductor/providers` is declared as a devDependency
// ONLY, never a runtime dependency (packages/conductor-runtime/package.json) — signalling type-only
// usage for the port's interface shape, never a real bundling dependency (D2: "a seta aponta para
// dentro... o runtime nunca importa @conductor/providers"). A plain `import type` compiles to NOTHING
// at runtime (erased by the transform before module resolution ever runs), so it is SAFE even though
// `packages/conductor-providers/src/index.ts` does not exist yet (the sibling stream's own RED state) —
// `npx vitest run` never touches that file. `tsgo --noEmit` WILL fail on this import until the sibling
// stream's Gate 6 lands `@conductor/providers/src/index.ts` — expected and fine (task brief's own
// framing: "your imports of its TYPES... may themselves be part of the RED state").
import type { ModelResolution, ResolutionRefusal, ResolveModelRequest } from "@conductor/providers";
import { describe, expect, it } from "vitest";
import type { GateRecord, GateState } from "../src/gate-state.ts";
import { evaluateAdvance, type GateAdvanceVerdict } from "../src/gate-state-policy.ts";
import { TOTAL_FLOW_GATES } from "../src/gate-state-store.ts";

/**
 * ADR 0005 §18 / gate3-addendum-fase4.md T42 (`packages/conductor-config/src/builtin-roles-data.ts:305`,
 * `MANDATORY_GATES = new Set([3, 5, 7, 8, 9])`). Duplicated here as a LITERAL, never imported: this
 * package (`@conductor/runtime`) deliberately carries ZERO dependency on `@conductor/config`
 * (ADR 0002 §3.1's dependency-direction invariant — restated at `builtin-roles-data.ts:298-303`'s own
 * doc comment: "gate-state-policy.ts's evaluateAdvance/isMandatorySatisfied/evaluateCalibration take
 * this set as a PARAMETER rather than importing it directly, so that package's
 * zero-dependency-on-@conductor/config invariant ... still holds"). `packages/conductor-runtime/test/
 * gate-state-policy.test.ts` (Fase 4) already established this exact precedent for THIS package's own
 * test suite (its own local `const MANDATORY_GATES` at the top of that file) — mirrored here verbatim,
 * not re-derived. `TOTAL_FLOW_GATES`, by contrast, lives in THIS SAME package (`gate-state-store.ts`)
 * so it IS imported for real below, never a hardcoded literal `14` (ADR 0008 §14.2's own closing list;
 * quality-baseline category 4, "no un-synced hardcoded assumptions").
 */
const MANDATORY_GATES: ReadonlySet<number> = new Set([3, 5, 7, 8, 9]);
const DEMAND_ID = "demand-fase7";
const BRANCH = "feature/fase7-model-routing-e-provedores";

function approvedRecord(gate: number): GateRecord {
	return {
		gate,
		status: "approved",
		evidence: [
			{
				gate,
				ref: { kind: "test-run", id: `run-${gate}` },
				provenance: "runtime-derived",
				recordedAt: "2026-08-07T00:00:00.000Z",
			},
		],
		decisions: [],
		risks: [],
		approvals: [
			{
				gate,
				demandId: DEMAND_ID,
				branch: BRANCH,
				method: "human",
				source: "session-abc",
				approvedAt: "2026-08-07T00:00:00.000Z",
			},
		],
		startedAt: "2026-08-06T00:00:00.000Z",
		completedAt: "2026-08-07T00:00:00.000Z",
	};
}

function notStartedRecord(gate: number): GateRecord {
	return { gate, status: "not-started", evidence: [], decisions: [], risks: [], approvals: [] };
}

/** A GateState where EVERY mandatory gate up to and including TOTAL_FLOW_GATES is genuinely approved
 * — the "everything about EVIDENCE/ORDER is fine" baseline, so `evaluateAdvance`'s only possible
 * verdict for this fixture is `{ kind: "approved" }`. This isolates the baseline assertion below from
 * any reason to fail OTHER than the one it exists to catch (a shape drift in `GateAdvanceVerdict`
 * itself), never a coincidental "the fixture itself wasn't fully approved" false RED. */
function makeFullyApprovedGateState(): GateState {
	const gates: Record<number, GateRecord> = {};
	for (let gate = 1; gate <= TOTAL_FLOW_GATES; gate++) {
		gates[gate] = MANDATORY_GATES.has(gate) ? approvedRecord(gate) : notStartedRecord(gate);
	}
	return {
		demandId: DEMAND_ID,
		repoId: "repo-pi",
		branch: BRANCH,
		currentGate: TOTAL_FLOW_GATES,
		gates,
		startedAt: "2026-08-06T00:00:00.000Z",
	};
}

describe("D4 composition regression guard — evaluateModelPrecondition composes BESIDE evaluateAdvance, never inside it (ADR 0008 §6.2, §16)", () => {
	it("evaluateAdvance's REAL return shape is untouched by Fase 7: exactly the locked union {approved|refused|could-not-verify}, single 'kind' key, never a model-related variant — the baseline a future accidental merge into GateAdvanceVerdict would break", () => {
		const state = makeFullyApprovedGateState();

		const verdict: GateAdvanceVerdict = evaluateAdvance(state, TOTAL_FLOW_GATES, MANDATORY_GATES);

		// Structural snapshot of the LOCKED shape (src/gate-state-policy.ts:45-48) — evidence/order only,
		// exactly as ADR 0005 §18 left it and D4 requires it to stay. A `kind` outside this exact union,
		// or an extra top-level key (e.g. a `model`/`modelRole` field bolted on), is D4's precise
		// regression: a model-related concern leaking INTO GateAdvanceVerdict instead of composing
		// alongside it.
		expect(Object.keys(verdict).sort()).toEqual(["kind"]);
		expect(verdict.kind).toBe("approved");
		const allowedKinds: ReadonlyArray<GateAdvanceVerdict["kind"]> = ["approved", "refused", "could-not-verify"];
		expect(allowedKinds).toContain(verdict.kind);
	});

	it("ModelPreconditionVerdict / evaluateModelPrecondition exist as a SEPARATE, composed contract on @conductor/runtime's public surface (ADR 0008 §16 appendix) — FAILS today: not implemented until Gate 6", async () => {
		// Deliberately a DYNAMIC import of the package barrel, not a static one, and not a guess at
		// Gate 6's eventual filename: D4 only fixes that this does NOT live in gate-state-policy.ts, not
		// where it DOES live. A static `import { evaluateModelPrecondition } from "../src/some-guess.ts"`
		// would fail this whole FILE at collection time if the guess is wrong, making a real regression
		// in evaluateAdvance's shape (the thing the test above exists to catch) indistinguishable from
		// "the module doesn't exist yet". A dynamic import against the already-real barrel isolates the
		// RED to exactly this one test, for exactly this one reason (the barrel exists and resolves
		// today; only the named export is missing).
		const runtimeModule = (await import("../src/index.ts")) as Record<string, unknown>;

		expect(typeof runtimeModule.evaluateModelPrecondition).toBe("function");

		// Typed against the REAL cross-package contract (ADR 0008 §16): a fake `ModelResolutionPort`
		// implementation (Unit Testing Principles: a hand-rolled test double for a collaborator this
		// file does not own the implementation of, never the real @conductor/providers engine — that
		// engine's OWN resolution behavior is the sibling stream's test scope, not this composition
		// guard's).
		const refusal: ResolutionRefusal = { kind: "no-binding-for-role", gate: 9, role: "slow" };
		const fakePort = {
			resolveForGate: (_request: ResolveModelRequest): ModelResolution => ({
				resolved: false,
				refusal,
				trace: { gate: 9, at: "2026-08-07T00:00:00.000Z", steps: [] },
			}),
		};
		const evaluateModelPrecondition = runtimeModule.evaluateModelPrecondition as (
			gate: number,
			port: typeof fakePort,
		) => { kind: string };
		const verdict = evaluateModelPrecondition(9, fakePort);

		// D4's own contract shape (§16 appendix): "satisfied" | "refused" — NEVER any of
		// evaluateAdvance's own kind values ("approved"/"could-not-verify"). The two verdict types must
		// stay textually distinguishable, never collapsed into one union by an implementation shortcut
		// that would blur "evidence/order" refusals with "no model authorized" refusals.
		expect(["satisfied", "refused"]).toContain(verdict.kind);
		expect(verdict.kind).not.toBe("approved");
		expect(verdict.kind).not.toBe("could-not-verify");
	});
});
