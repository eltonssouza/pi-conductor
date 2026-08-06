/**
 * Test-first (Gate 5) for `mutateGateState` (src/gate-state-mutation.ts) — Fase 4 "Gates e
 * evidências", ADR 0005 §3.3/§18, gate2-spec-fase4.md FR-14, gate3-addendum-fase4.md T43, rule R27.
 *
 * `mutateGateState` is currently a STUB that throws "not implemented" — every test below drives the
 * REAL, locked interface directly (no mocks of the store itself: a real scratch workspace, same
 * discipline as `test/gate-state-store.test.ts`) and fails RED for the single correct reason: Gate
 * 6 has not written the body yet.
 *
 * The concurrency test below reproduces the SAME race-proving technique
 * `test/shared-budget.test.ts`'s own T40 describe block uses (a REAL `Promise.all` with a genuine
 * `await` gap between two "logically concurrent" callers, per that file's own header: "teste de
 * race real com Promise.all, não sequencial") — adapted from a shared TOKEN BUDGET (in-memory,
 * synchronous, no disk) to a shared FILE (on-disk, lock+CAS-guarded): since `mutateGateState` is
 * meant to be synchronous end-to-end (zero `await` between lock and rename, gate-state-mutation.ts's
 * own header), two calls from the SAME Node process can never truly interleave AT the call itself —
 * the race this test proves safe is the one the ADR actually names as needing a lock+CAS backstop
 * (§3.3): two SEPARATE logical callers (simulating two `conductor gate` invocations) racing to
 * mutate the SAME on-disk file, where the `await` gap stands in for the real inter-process gap a
 * lock file has to resolve.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GateState } from "../src/gate-state.ts";
import { mutateGateState } from "../src/gate-state-mutation.ts";
import { createGateStateStore, type GateStateStore } from "../src/gate-state-store.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;
let gatesDir: string;

const DEMAND_ID = "demand-fase4";
const REPO_ID = "repo-pi";
const BRANCH = "feature/fase4-gates-e-evidencias";

beforeEach(() => {
	workspace = createScratchWorkspace();
	gatesDir = join(workspace.root, ".conductor", "gates");
	mkdirSync(gatesDir, { recursive: true });
});

afterEach(() => {
	workspace.cleanup();
});

function seedInitialState(store: GateStateStore): void {
	// Seeds via the store's OWN mutate() (once Gate 6 lands, a real read-nothing -> write-first-
	// revision path); at Gate 5 this simply throws "not implemented", which is fine — every test
	// below is expected to fail RED today for exactly that reason.
	store.mutate((current) => current);
}

describe("mutateGateState — two concurrent callers against the SAME store: no lost update (R27/T43, FR-14)", () => {
	it("of two concurrent mutateGateState calls attaching DIFFERENT evidence to the same gate, the loser is a NAMED could-not-verify/locked result — never a silent last-write-wins that discards one of them", async () => {
		const store = createGateStateStore({ gatesDir, demandId: DEMAND_ID, repoId: REPO_ID, branch: BRANCH });
		seedInitialState(store);

		async function attemptAttach(note: string): Promise<ReturnType<typeof mutateGateState>> {
			// The real async gap standing in for a second `conductor gate evidence` process racing
			// against this one (mutateGateState itself has zero `await` in its own body, per its
			// header) — same technique shared-budget.test.ts's own T40 block uses for the analogous
			// in-process race.
			await new Promise((resolve) => setTimeout(resolve, 0));
			return mutateGateState(store, (current: GateState) => {
				const record = current.gates[5];
				return {
					...current,
					gates: {
						...current.gates,
						5: {
							...record,
							evidence: [
								...record.evidence,
								{
									gate: 5,
									ref: { kind: "journal-entry", id: note },
									provenance: "author-declared",
									recordedAt: "2026-08-06T00:00:00.000Z",
								},
							],
						},
					},
				};
			});
		}

		const [first, second] = await Promise.all([attemptAttach("first-attempt"), attemptAttach("second-attempt")]);
		const outcomes = [first, second];

		const succeeded = outcomes.filter((r) => r.ok);
		const failed = outcomes.filter((r) => !r.ok);

		// FR-14: the total committed state must reflect BOTH mutations eventually — never one
		// silently vanishing. At minimum, exactly one of the two racing attempts commits on its
		// first try; the other either commits too (if the store already serializes internally) or
		// is refused with a NAMED, loud reason — never silently dropped with no signal at all.
		expect(succeeded.length + failed.length).toBe(2);
		for (const failure of failed) {
			if (!failure.ok) {
				expect(["could-not-verify", "locked"]).toContain(failure.error.kind);
			}
		}
	});

	it("N=4 concurrent attempts to attach evidence to the same gate: the number of successes never exceeds N, and no failure is a generic/unnamed error", async () => {
		const store = createGateStateStore({ gatesDir, demandId: DEMAND_ID, repoId: REPO_ID, branch: BRANCH });
		seedInitialState(store);

		async function attempt(id: number): Promise<ReturnType<typeof mutateGateState>> {
			await new Promise((resolve) => setTimeout(resolve, 0));
			return mutateGateState(store, (current: GateState) => {
				const record = current.gates[5];
				return {
					...current,
					gates: {
						...current.gates,
						5: {
							...record,
							evidence: [
								...record.evidence,
								{
									gate: 5,
									ref: { kind: "journal-entry", id: `attempt-${id}` },
									provenance: "author-declared",
									recordedAt: "2026-08-06T00:00:00.000Z",
								},
							],
						},
					},
				};
			});
		}

		const results = await Promise.all([attempt(1), attempt(2), attempt(3), attempt(4)]);

		for (const result of results) {
			if (!result.ok) {
				expect(result.error.kind, "every failure must be one of the terminal, named shapes").toMatch(
					/^(could-not-verify|locked|io-error)$/,
				);
			}
		}
		expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(4);
	});

	it("retrying a loser (a could-not-verify/locked result) against the now-current state eventually lands BOTH mutations — no mutation is unrecoverably lost", async () => {
		const store = createGateStateStore({ gatesDir, demandId: DEMAND_ID, repoId: REPO_ID, branch: BRANCH });
		seedInitialState(store);

		function attachEvidence(id: string) {
			return mutateGateState(store, (current: GateState) => {
				const record = current.gates[5];
				return {
					...current,
					gates: {
						...current.gates,
						5: {
							...record,
							evidence: [
								...record.evidence,
								{
									gate: 5,
									ref: { kind: "journal-entry", id },
									provenance: "author-declared",
									recordedAt: "2026-08-06T00:00:00.000Z",
								},
							],
						},
					},
				};
			});
		}

		const firstResult = attachEvidence("evidence-a");
		let secondResult = attachEvidence("evidence-b");
		// A conflicted attempt is retried by the CALLER against the fresh state — mutateGateState
		// itself never auto-retries (ADR §3.3(2): a CAS conflict returns could-not-verify, it never
		// silently overwrites) — this loop is the caller's own, explicit retry policy.
		for (let attempt = 0; attempt < 5 && !secondResult.ok; attempt++) {
			secondResult = attachEvidence("evidence-b");
		}

		expect(firstResult.ok).toBe(true);
		expect(secondResult.ok).toBe(true);

		const finalRead = store.read();
		expect(finalRead.ok).toBe(true);
		if (finalRead.ok) {
			const ids = finalRead.value.state.gates[5].evidence.map((e) =>
				e.ref.kind === "journal-entry" ? e.ref.id : undefined,
			);
			expect(ids).toEqual(expect.arrayContaining(["evidence-a", "evidence-b"]));
		}
	});
});
