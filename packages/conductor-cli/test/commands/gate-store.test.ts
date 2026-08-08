/**
 * Direct unit tests for `createPersistedGateStateStore` (Gate 6 wiring closure, Fase 4 "Gates e
 * evidências") — `commands/gate-store.ts`. Written as a quality-baseline follow-up (category 3, test
 * coverage): every existing test that touches this real, persisted adapter goes through `cli.ts`'s
 * `runGateCommand`, whose only wired confirm channel (`headlessConfirmChannel`) always resolves
 * `false` (see `cli.ts`'s own header) — so `gate approve` driven through `runCli` can only ever
 * reach `needs-human`, never `approved`. That leaves the store's OWN `approve()` happy path (a
 * `confirmResult: true` that genuinely mints an `Approval` and reaches `status: "approved"`) with
 * ZERO coverage anywhere in this diff — this file closes that gap by constructing the store directly
 * and calling its `GateStateStoreView` methods with a controlled `confirmResult`, the same level
 * `test/support/fake-gate-store.ts`'s own fake is exercised at in `gate.test.ts`.
 *
 * FR-13 (gate2-spec-fase4.md §Grupo F; ADR 0005 §15): "Aprovar um gate já aprovado é determinístico e
 * comunicado, nunca ambíguo" — the ADR's own follow-up resolves this as **idempotent**: re-approving
 * reaffirms the existing state, never mints a second, redundant `Approval`. This file's second
 * `describe` block locks that decision with a real regression test.
 */

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersistedGateStateStore } from "../../src/commands/gate-store.ts";
import { alwaysInteractiveWitness, neverInteractiveWitness } from "../support/interactivity-witness.ts";
import { alwaysSatisfiedModelResolutionPort } from "../support/model-resolution-port.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const DEMAND = "demand-1";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function makeStore(options: { isInteractive?: ReturnType<typeof alwaysInteractiveWitness> } = {}) {
	// `modelResolutionPort` is required since ADR 0008 §21/D11 -- see test/support/model-resolution-port.ts
	// for why this stub is a statement of scope, not a disabled check. This file's subject is the
	// store's own `approve()` happy path and FR-13 idempotency, not model routing.
	// `isInteractive` is required since Gate 8 loop-back finding 5 -- see
	// test/support/interactivity-witness.ts for why. Defaults to "interactive" here because most of this
	// file's tests want a genuine confirmResult:true to actually mint -- the one describe block that
	// exercises D3 layer 2 itself overrides it explicitly with neverInteractiveWitness().
	return createPersistedGateStateStore({
		gatesDir: join(project.root, ".conductor", "gates"),
		repoId: "test-repo",
		branch: "feature/fase4-demo",
		modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
		isInteractive: options.isInteractive ?? alwaysInteractiveWitness(),
	});
}

describe("createPersistedGateStateStore.approve — the real happy path (previously uncovered)", () => {
	it("a true confirmResult mints a genuine Approval and reaches status: approved, persisted to disk", () => {
		const store = makeStore();
		store.start(DEMAND, 1); // gate 1 is not mandatory -- approvable with no evidence

		const snapshot = store.approve(DEMAND, 1, true, { source: "test" });

		const gate1 = snapshot.gates.find((g) => g.gate === 1);
		expect(gate1?.status).toBe("approved");
		expect(gate1?.approvalsCount).toBe(1);

		// Re-reads from a FRESH store instance -- proves the approval is on disk, not just in the
		// return value of the mutate() call above.
		const reread = makeStore().status(DEMAND);
		expect(reread.gates.find((g) => g.gate === 1)?.status).toBe("approved");
	});
});

describe("createPersistedGateStateStore.approve — FR-13: re-approving an already-approved gate is idempotent (ADR 0005 §15)", () => {
	it("does NOT mint a second, redundant Approval when approve() is called again on an already-approved gate", () => {
		const store = makeStore();
		store.start(DEMAND, 1);

		store.approve(DEMAND, 1, true, { source: "first-approval" });
		const secondSnapshot = store.approve(DEMAND, 1, true, { source: "second-approval-attempt" });

		const gate1 = secondSnapshot.gates.find((g) => g.gate === 1);
		expect(gate1?.status).toBe("approved");
		// The bug this locks: without an idempotency guard, every re-approve call unconditionally
		// appends another Approval (approvalsCount keeps growing: 1, 2, 3, ...) -- ADR 0005 §15
		// explicitly decided re-approval must REAFFIRM the state, never mint a redundant second one.
		expect(gate1?.approvalsCount).toBe(1);
	});

	it("stays idempotent across more than two calls", () => {
		const store = makeStore();
		store.start(DEMAND, 1);

		store.approve(DEMAND, 1, true, { source: "a" });
		store.approve(DEMAND, 1, true, { source: "b" });
		const thirdSnapshot = store.approve(DEMAND, 1, true, { source: "c" });

		expect(thirdSnapshot.gates.find((g) => g.gate === 1)?.approvalsCount).toBe(1);
	});
});

describe("createPersistedGateStateStore.approve — D3 layer 2 (Gate 8 loop-back finding 5, ADR 0009 §5.3): confirmResult:true alone is never sufficient to mint method:human", () => {
	it("a genuinely true confirmResult on a NON-interactive process never mints an Approval -- falls to needs-human instead, the same branch a false confirmResult already produces", () => {
		const store = makeStore({ isInteractive: neverInteractiveWitness() });
		store.start(DEMAND, 1);

		// Simulates exactly the T75 attack this layer exists to survive: a `true` reaching this call
		// (e.g. through a compromised/miswired confirm channel further up the call stack) is STILL not
		// enough on its own -- the independent witness must ALSO claim a real interactive TTY.
		const snapshot = store.approve(DEMAND, 1, true, { source: "test" });

		const gate1 = snapshot.gates.find((g) => g.gate === 1);
		expect(gate1?.status).toBe("needs-human");
		expect(gate1?.approvalsCount).toBe(0);

		// Persisted, not just the in-memory return value -- a fresh store instance re-reading from disk
		// must see the SAME refusal (never approved, however briefly, at any point).
		const reread = makeStore({ isInteractive: neverInteractiveWitness() }).status(DEMAND);
		expect(reread.gates.find((g) => g.gate === 1)?.status).toBe("needs-human");
	});

	it("a true confirmResult on a genuinely interactive process still mints normally -- D3 layer 2 adds a refusal, it never regresses the real interactive happy path", () => {
		const store = makeStore({ isInteractive: alwaysInteractiveWitness() });
		store.start(DEMAND, 1);

		const snapshot = store.approve(DEMAND, 1, true, { source: "test" });

		const gate1 = snapshot.gates.find((g) => g.gate === 1);
		expect(gate1?.status).toBe("approved");
		expect(gate1?.approvalsCount).toBe(1);
	});

	it("a false confirmResult on a non-interactive process is unaffected -- still needs-human, for the ordinary FR-11 reason, not because of layer 2", () => {
		const store = makeStore({ isInteractive: neverInteractiveWitness() });
		store.start(DEMAND, 1);

		const snapshot = store.approve(DEMAND, 1, false, { source: "test" });

		expect(snapshot.gates.find((g) => g.gate === 1)?.status).toBe("needs-human");
	});
});

describe("createPersistedGateStateStore.approveAuto — Gate 8 loop-back, finding 1: never a hollow completion, even for a non-mandatory gate", () => {
	it("refuses (throws) to auto-approve a started, non-mandatory gate with ZERO attached evidence -- persisted state stays in-progress, never approved", () => {
		const store = makeStore();
		store.start(DEMAND, 1); // gate 1 is not mandatory

		expect(() => store.approveAuto(DEMAND, 1)).toThrow(/no evidence attached/i);

		const reread = makeStore().status(DEMAND);
		expect(reread.gates.find((g) => g.gate === 1)?.status).toBe("in-progress");
	});

	it("succeeds once at least one evidence item is attached, and the resulting Approval is genuinely method:auto", () => {
		const store = makeStore();
		store.start(DEMAND, 1);
		store.attachEvidence(DEMAND, 1, { ref: { kind: "file", path: "README.md" }, provenance: "author-declared" });

		const snapshot = store.approveAuto(DEMAND, 1);

		const gate1 = snapshot.gates.find((g) => g.gate === 1);
		expect(gate1?.status).toBe("approved");
		expect(gate1?.approvalsCount).toBe(1);
	});
});
