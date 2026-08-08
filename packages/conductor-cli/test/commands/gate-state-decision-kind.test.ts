/**
 * Test-first (Gate 5, Fase 5 "Library e grounding") for D4 §6.3 (ADR 0006, `docs/adr/0006-fase5-
 * library-and-grounding.md`): `Decision["kind"]` gains `"rejection"`, and `commands/gate-store.ts`'s
 * `reject()` (gate-store.ts:283-308) must write it instead of `kind: "decision"`.
 *
 * Why this matters beyond vocabulary: a rejection is a state transition the rejecter judges, not a
 * groundable technical decision — D4 §6.3 names this explicitly ("não faz sentido exigir grounding de
 * 'o gate foi rejeitado por este motivo'"). Conflating the two under one `kind` also breaks the
 * sole-mint invariant test/gate-grounding-sole-mint.test.ts locks: a `Decision{kind:"decision"}`
 * literal is supposed to be constructible in exactly ONE file (gate-grounding.ts's
 * `recordGroundedDecision`) — `reject()` writing the same `kind` from a completely different code path
 * would make that invariant false of legitimate code, not just of an attacker.
 *
 * `createGateStateStore`/`createPersistedGateStateStore` are ALREADY fully implemented (Fase 4 Gate 6
 * landed) — this test targets a REAL, still-open defect in that already-shipped code, not a stub
 * throw: `reject()` today unconditionally writes `kind: "decision"` (verified by reading the file at
 * this Gate 5 task's own assignment). The test below FAILS against current code for exactly that
 * reason, and documents the fix Gate 6 must make.
 */

import { join } from "node:path";
import { createGateStateStore } from "@conductor/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersistedGateStateStore } from "../../src/commands/gate-store.ts";
import { alwaysInteractiveWitness } from "../support/interactivity-witness.ts";
import { alwaysSatisfiedModelResolutionPort } from "../support/model-resolution-port.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const DEMAND = "demand-reject-kind";
const REPO_ID = "test-repo";
const BRANCH = "feature/fase5-demo";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

function gatesDir(): string {
	return join(project.root, ".conductor", "gates");
}

function makeCliStore() {
	// `modelResolutionPort` is required since ADR 0008 §21/D11 -- see test/support/model-resolution-port.ts
	// for why this stub is a statement of scope, not a disabled check. This file's subject is what
	// `reject()` writes as a Decision `kind`, not model routing. `isInteractive` is required since Gate 8
	// loop-back finding 5 -- this file's subject is `reject()`, not `approve()`'s D3 layer 2, so an
	// "interactive" double is the correct explicit statement of scope (see
	// test/support/interactivity-witness.ts).
	return createPersistedGateStateStore({
		gatesDir: gatesDir(),
		repoId: REPO_ID,
		branch: BRANCH,
		modelResolutionPort: alwaysSatisfiedModelResolutionPort(),
		isInteractive: alwaysInteractiveWitness(),
	});
}

/** Reads the RAW persisted GateState via the same runtime store the CLI adapter wraps — the CLI's own
 * `GateStateStoreView`/`GateStatusSnapshot` projection (commands/gate.ts) only exposes `decisionsCount`,
 * never the decisions' own `kind`, so this is the only way to observe what `reject()` actually wrote. */
function readRawDecisions(gate: number) {
	const raw = createGateStateStore({ gatesDir: gatesDir(), demandId: DEMAND, repoId: REPO_ID, branch: BRANCH });
	const result = raw.read();
	if (!result.ok) throw new Error(`could not read raw gate state: ${JSON.stringify(result.error)}`);
	return result.value.state.gates[gate].decisions;
}

describe('gate reject() persists Decision{kind:"rejection"}, not kind:"decision" (ADR 0006 §6.3/§7.1, D4)', () => {
	it('reject() writes a Decision whose kind is "rejection" — FAILS today: production code still writes kind:"decision" (Gate 6 fixes commands/gate-store.ts:283-308)', () => {
		const store = makeCliStore();
		store.start(DEMAND, 2);

		store.reject(DEMAND, 2, "insufficient security review");

		const decisions = readRawDecisions(2);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({ kind: "rejection", text: "insufficient security review" });
		// A rejection is a state transition, never conflated with a groundable technical decision
		// (D4 §6.3) — this is the exact assertion that fails today.
		expect(decisions[0].kind).not.toBe("decision");
	});
});
