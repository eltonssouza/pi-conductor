/**
 * `createPersistedGateStateStore` — the REAL `GateStateStoreView` adapter (Gate 6 wiring closure,
 * Fase 4 "Gates e evidências") over `@conductor/runtime`'s `createGateStateStore`/`evaluateAdvance`/
 * `evaluateCalibration`/`hasSufficientEvidenceForMandatoryGate`/`mintHumanApproval`. Replaces
 * `commands/gate.ts`'s former `createInMemoryGateStateStore` — a temporary, non-persisted stand-in that
 * file's own header always flagged as "PENDING INTEGRATION": `conductor gate status` after closing the
 * CLI process used to lose everything, which is not what Fase 4 promises (PERSISTED gate state). This
 * file is that pending integration, landed for real.
 *
 * `GateStateStoreView` (commands/gate.ts) takes `demandId` as a CALL-time argument on every method;
 * `@conductor/runtime`'s `createGateStateStore` fixes `demandId`/`repoId`/`branch`/`gatesDir` at
 * CONSTRUCTION time (ADR 0005 §3.1: "one store instance = one demand's file"). `storeFor()` below
 * bridges the two by constructing a fresh, cheap `GateStateStore` per call (it only derives a file path
 * and closes over options — no I/O happens until `.read()`/`.mutate()` is actually invoked), so this
 * adapter's own map from "one CLI invocation" to "one demand's on-disk file" stays exactly the
 * `GateStateStoreView` contract callers already depend on.
 *
 * Gate-1 auto-open (documented at length in `commands/gate.ts`'s former in-memory adapter, carried over
 * here verbatim as a CLI-ergonomics default, NOT a `GateStateStore` contract): `createDefaultGateState`
 * (gate-state-store.ts) deliberately bootstraps EVERY gate — including 1 — as `not-started` at
 * `currentGate: 0`. `readOrBootstrap` below is the one place that ergonomic default is layered on top,
 * exactly once, the first time a demand's file is ever created, so `conductor gate status` / `conductor
 * gate evidence --gate 1 ...` stay usable on a fresh demand with no `gate start 1` warm-up — matching
 * every demand's own real starting point (CLAUDE.md's own gate table: "Gate 1 — Domain discovery"
 * always runs first). `gate-state-store.ts`'s own bootstrap is untouched (out of this pendency's scope,
 * and already locked by that file's own Gate-5 tests) — the auto-open stays a layer above it.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { MANDATORY_GATES } from "@conductor/config";
import {
	type CalibrationDecision,
	createGateStateStore,
	type Decision,
	type Evidence,
	evaluateAdvance,
	evaluateCalibration,
	// Fase 7 D4 (see the ModelResolutionPort doc comment below): `evaluateModelPrecondition` is a REAL
	// value import -- the sibling Fase-7 stream that owns `@conductor/runtime` landed it during this
	// same Gate 6 pass (packages/conductor-runtime/src/model-precondition.ts). It is safe to import
	// directly even though `@conductor/providers` (a DIFFERENT sibling package, still landing) is not
	// yet resolvable: `model-precondition.ts`'s own header confirms it only ever TYPE-imports from
	// `@conductor/providers` ("A plain `import type` compiles to nothing at runtime, so this file is
	// safe to import and test even before the sibling stream's `@conductor/providers/src/index.ts`
	// lands") -- confirmed here by a full `npx vitest run` of this package after adding this import
	// (339/340, the one pre-existing/expected failure unrelated to this line). `ModelResolutionPort`
	// stays type-only: this file never constructs a real adapter (that needs `@conductor/providers`'s
	// engine, out of this stream's scope) -- only the composition root that eventually calls
	// `createPersistedGateStateStore` will.
	evaluateModelPrecondition,
	type GateRecord,
	type GateState,
	type GateStateMutationError,
	type GateStateStore,
	hasSufficientEvidenceForMandatoryGate,
	type ModelResolutionPort,
	mintAutoApproval,
	mintHumanApproval,
} from "@conductor/runtime";
import { DEFAULT_GIT_STATUS_TIMEOUT_MS, getGitStatus, resolveTimeoutMs } from "../git-status.ts";
import {
	GateCommandError,
	type GateRecordSnapshot,
	type GateStateStoreView,
	type GateStatusSnapshot,
	type InteractivityWitness,
} from "./gate.ts";

export interface PersistedGateStateStoreOptions {
	/** Absolute path to the `.conductor/gates` directory (ADR 0005 §3.1). */
	gatesDir: string;
	repoId: string;
	branch: string;
	/**
	 * Fase 7 D4 (ADR 0008 §6/§16 -- "recusa fail-closed imposta em três pontos de autorização de
	 * trabalho", P1 = gate opening, this file). The evaluator (`evaluateModelPrecondition`, imported
	 * for real above) is fixed; only the PORT is injected -- the same Dependency Inversion seam
	 * `commands/gate.ts`'s `GateStateStoreView`/`RoleRegistryView` decoupling already uses ("never a
	 * concrete [cross-package] type directly"), with the real adapter built by the composition root
	 * (`commands/model-context.ts`'s `createGateModelResolutionPort`, over `@conductor/providers`).
	 *
	 * **REQUIRED, deliberately (ADR 0008 §21/D11, Gate-8 loop-back).** It was optional in the first
	 * Gate-6 pass, and Gate 8 measured the consequence: production never passed one, so the
	 * `if (options.modelResolutionPort)` guard that used to sit in `start()` made the whole
	 * fail-closed check permanently INERT -- the mutation "`evaluateModelPrecondition` always returns
	 * satisfied" SURVIVED both this package's and `@conductor/runtime`'s full suites. §21's remedy is
	 * exactly this signature: "`evaluateModelPrecondition` passa a ser chamado incondicionalmente a
	 * partir do composition root, nunca atrás de um campo opcional que a produção nunca preenche".
	 * Making it required moves that guarantee into the type system, where it cannot silently regress:
	 * a future caller that forgets the port does not compile. Mirrors `MANDATORY_GATES` at this very
	 * call site -- injected into every policy call, never left to a default.
	 *
	 * *Grounding:* **SOLID Design Principles §3.1/§3.2/§3.6** (0.656/0.648/0.639: the Dependency
	 * Inversion Principle -- depend on an abstraction the consumer owns, "wire implementations via a
	 * dependency-injection container at the composition root").
	 *
	 * `start()` runs the precondition BEFORE `evaluateAdvance` (ADR §6.2 point 3: a "no model for this
	 * gate" refusal is a cheaper, more actionable diagnostic than an evidence/order refusal), refusing
	 * gate opening on `{kind:"refused"}` the same way an `evaluateAdvance` refusal already does -- a
	 * second, independent, composed verdict, never a new arm bolted onto `GateAdvanceVerdict` itself
	 * (D4's own explicit "zero mudança na máquina de gates" -- see the regression guard in
	 * `@conductor/runtime`'s own test suite).
	 */
	modelResolutionPort: ModelResolutionPort;

	/**
	 * Fase 8 / D3 layer 2 (ADR 0009 §5.3/§16, Gate 3 T75/R56 — **Gate 8 loop-back, finding 5**: wired for
	 * real here; Gate 6's first pass declared this out of its touched-files scope, see `gate.ts`'s own
	 * `InteractivityWitness` doc comment). The independent interactivity witness `approve()` below crosses
	 * against `confirmResult` before ever minting `method:"human"` — production default
	 * `defaultInteractivityWitness` (below), reading the REAL process TTY state via a code path
	 * deliberately distinct from `io.tty`/`resolveConfirmChannel` (D3 layer 1, `tty-confirm.ts`'s own
	 * seam). The binding rule: `confirmResult === true && isInteractive() === false` never mints — the
	 * same `needs-human` branch a `confirmResult !== true` already produces.
	 *
	 * **REQUIRED, deliberately** — same discipline as `modelResolutionPort` above (ADR 0008 §21/D11): an
	 * optional field with a production default nothing overrides in a test is precisely the shape that
	 * already made `modelResolutionPort`'s own fail-closed check silently inert once (Gate 8 found it).
	 * Making this required moves the guarantee into the type system: a future caller (production or test)
	 * that forgets to state which posture it wants does not compile — it cannot silently inherit whatever
	 * `process.stdin.isTTY` happens to be under that call site's own process (unstable across test
	 * runners/CI, and exactly the ambiguity a security-relevant witness must never have).
	 *
	 * *Grounding:* **SOLID Design Principles §3.1/§3.2/§3.6** (Dependency Inversion — depend on an
	 * abstraction the consumer owns, wire the concrete witness at the composition root), same citation
	 * already recorded above for `modelResolutionPort`; this is the same pattern applied to a second,
	 * independent security-relevant collaborator.
	 */
	isInteractive: InteractivityWitness;
}

/**
 * Fase 8 / D3 layer 2 (ADR 0009 §5.3): the production default `InteractivityWitness`, reading the REAL
 * process TTY state directly (`process.stdin`/`process.stdout`) — a code path deliberately distinct from
 * `io.tty`/`tty-confirm.ts`'s injected `TtyStreams` seam (D3 layer 1), so forging a sign-off requires
 * defeating BOTH independently. Composition roots (`cli.ts`'s `case "gate"`, `commands/auto.ts`'s
 * internal store) pass this; tests pass an explicit double from `test/support/interactivity-witness.ts`.
 */
export const defaultInteractivityWitness: InteractivityWitness = () =>
	Boolean(process.stdin.isTTY && process.stdout.isTTY);

function describeStoreError(error: GateStateMutationError): string {
	switch (error.kind) {
		case "could-not-verify":
			return error.reason;
		case "locked":
			return `gate state is locked (held since ${error.heldSince}) -- try again`;
		case "io-error":
			return `gate state I/O error: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
	}
}

function storeFor(options: PersistedGateStateStoreOptions, demandId: string): GateStateStore {
	return createGateStateStore({
		gatesDir: options.gatesDir,
		demandId,
		repoId: options.repoId,
		branch: options.branch,
	});
}

/**
 * `existsSync(store.filePath)` is a cheap pre-check so a `gate status`/`gate evidence` call against an
 * ALREADY-bootstrapped demand never pays for an unconditional write (and lock acquisition) — the actual
 * correctness backstop against the check-then-act race with a concurrent first touch is `mutate()`'s own
 * `current.currentGate !== 0` guard inside the callback below, not this pre-check.
 */
function readOrBootstrap(store: GateStateStore): GateState {
	if (!existsSync(store.filePath)) {
		const bootstrapped = store.mutate((current) => {
			if (current.currentGate !== 0) return current; // lost the race to a concurrent first touch
			const gateOne = current.gates[1];
			return {
				...current,
				currentGate: 1,
				gates: {
					...current.gates,
					1: { ...gateOne, status: "in-progress", startedAt: gateOne.startedAt ?? new Date().toISOString() },
				},
			};
		});
		if (!bootstrapped.ok) {
			throw new GateCommandError(`gate state could not be initialized: ${describeStoreError(bootstrapped.error)}`);
		}
		return bootstrapped.value.next;
	}
	const result = store.read();
	if (!result.ok) {
		throw new GateCommandError(`gate state could not be read: ${describeStoreError(result.error)}`);
	}
	return result.value.state;
}

/** Projects the real, persisted `GateState` aggregate onto `commands/gate.ts`'s CLI-local
 * `GateStatusSnapshot` placeholder shape (unchanged by this pendency — see that file's own header on
 * why reshaping it is a separate, future concern). Gates still `not-started` are omitted, same
 * ergonomic behavior the former in-memory adapter already had: a demand nobody has touched at all
 * renders as `gates: []` (`formatGateStatusReport`'s own "(no gate has been started yet…)" fallback). */
function projectSnapshot(state: GateState): GateStatusSnapshot {
	const gates: GateRecordSnapshot[] = Object.values(state.gates)
		.filter((record) => record.status !== "not-started")
		.sort((a, b) => a.gate - b.gate)
		.map((record) => ({
			gate: record.gate,
			status: record.status,
			evidenceCount: record.evidence.length,
			decisionsCount: record.decisions.length,
			risksCount: record.risks.length,
			approvalsCount: record.approvals.length,
			startedAt: record.startedAt,
			completedAt: record.completedAt,
		}));
	return {
		demandId: state.demandId,
		branch: state.branch,
		currentGate: state.currentGate,
		gates,
		mandatoryGates: [...MANDATORY_GATES].sort((a, b) => a - b),
		// GATE 8 (QA validation) finding, ADR 0005 §5 bullet 3: `state.calibration` was already
		// persisted correctly (verified against the raw envelope JSON) but never projected here, so
		// `gate status` had no way to ever show it -- closed alongside `formatGateStatusReport`'s own
		// new rendering branch (commands/gate.ts).
		...(state.calibration
			? { calibration: { collapsedGates: state.calibration.collapsedGates, method: state.calibration.method } }
			: {}),
	};
}

const EMPTY_GATE_RECORD: Omit<GateRecord, "gate"> = {
	status: "not-started",
	evidence: [],
	decisions: [],
	risks: [],
	approvals: [],
};

export function createPersistedGateStateStore(options: PersistedGateStateStoreOptions): GateStateStoreView {
	return {
		status(demandId) {
			const store = storeFor(options, demandId);
			return projectSnapshot(readOrBootstrap(store));
		},

		start(demandId, gate) {
			const store = storeFor(options, demandId);
			readOrBootstrap(store); // ensures the demand/gate-1 auto-open exists before evaluating the floor
			// Fase 7 D4 (ADR 0008 §6.2 point 3): the model-resolution precondition is evaluated BEFORE
			// evaluateAdvance -- a "no model authorized for this gate" refusal is a cheaper, more
			// actionable diagnostic than an evidence/order refusal, and the ADR requires exactly this
			// order (two round-trips to the same fix otherwise: "gate 8 not approved" now, "no model"
			// on the next attempt). A SECOND, independent, composed verdict (`ModelPreconditionVerdict`)
			// -- never a value folded into `GateAdvanceVerdict` itself (D4's own "zero mudança na
			// máquina de gates", guarded by @conductor/runtime's own composition-regression test).
			// UNCONDITIONAL (ADR 0008 §21/D11, Gate-8 loop-back): the `if (options.modelResolutionPort)`
			// guard that used to wrap these lines is precisely what made this check inert -- production
			// never passed a port, so the mutation "evaluateModelPrecondition always returns satisfied"
			// survived every suite. The port is now a REQUIRED option (see its doc comment above), so
			// there is nothing left to guard against. Same (gate, port, MANDATORY_GATES) call shape as
			// evaluateAdvance/evaluateCalibration below.
			const modelVerdict = evaluateModelPrecondition(gate, options.modelResolutionPort, MANDATORY_GATES);
			if (modelVerdict.kind === "refused") {
				throw new GateCommandError(`cannot start gate ${gate}: ${modelVerdict.humanReadable}`);
			}
			// R23/FR-2: fail-closed against the REAL mandatory-floor policy (gate-state-policy.ts's
			// evaluateAdvance/isMandatorySatisfied), never a second, duplicated inline check -- this is
			// exactly the wiring this pendency closes; a bug inside this callback (including the throw
			// below) propagates straight out of store.mutate(), per that function's own documented contract.
			const result = store.mutate((current) => {
				const verdict = evaluateAdvance(current, gate, MANDATORY_GATES);
				if (verdict.kind !== "approved") {
					const detail =
						verdict.kind === "refused"
							? `mandatory ${verdict.missingMandatoryGates.map((g) => `gate ${g}`).join(", ")} not yet approved`
							: verdict.reason;
					throw new GateCommandError(`cannot start gate ${gate}: ${detail}`);
				}
				const existing = current.gates[gate] ?? { gate, ...EMPTY_GATE_RECORD };
				return {
					...current,
					currentGate: gate,
					gates: {
						...current.gates,
						[gate]: {
							...existing,
							status: "in-progress",
							startedAt: existing.startedAt ?? new Date().toISOString(),
						},
					},
				};
			});
			if (!result.ok) throw new GateCommandError(`cannot start gate ${gate}: ${describeStoreError(result.error)}`);
			return projectSnapshot(result.value.next);
		},

		attachEvidence(demandId, gate, attachment) {
			const store = storeFor(options, demandId);
			readOrBootstrap(store);
			const result = store.mutate((current) => {
				const record = current.gates[gate];
				// FR-6: refuse attaching evidence to a gate that was never started for this demand.
				if (!record || record.status === "not-started") {
					throw new GateCommandError(`cannot attach evidence: gate ${gate} was never started for this demand`);
				}
				// `note` is OMITTED entirely (never a present key holding `undefined`) when not supplied --
				// gate-state-store.ts's own checksum (canonicalizeJsonForChecksum) fail-closed REJECTS any
				// value that is not null/string/boolean/number/object (R28's own "JSON-serializable only"
				// contract), and `undefined` fails that check the moment it is enumerated via
				// Object.entries -- a present `note: undefined` key would make EVERY mutate() on this gate
				// throw, not just this one attach.
				const evidence: Evidence = {
					gate,
					ref: attachment.ref,
					provenance: attachment.provenance,
					recordedAt: new Date().toISOString(),
					...(attachment.note !== undefined ? { note: attachment.note } : {}),
				};
				return {
					...current,
					gates: { ...current.gates, [gate]: { ...record, evidence: [...record.evidence, evidence] } },
				};
			});
			if (!result.ok) {
				throw new GateCommandError(`cannot attach evidence to gate ${gate}: ${describeStoreError(result.error)}`);
			}
			return projectSnapshot(result.value.next);
		},

		approve(demandId, gate, confirmResult, meta) {
			const store = storeFor(options, demandId);
			readOrBootstrap(store);
			const result = store.mutate((current) => {
				const record = current.gates[gate];
				if (!record || record.status === "not-started" || record.status === "rejected") {
					throw new GateCommandError(`cannot approve gate ${gate}: it was never started (or is rejected)`);
				}
				// FR-13/ADR 0005 §15: approving an already-approved gate is deterministic and never
				// ambiguous -- the ADR's own follow-up resolves this as IDEMPOTENT: reaffirm the existing
				// state, never mint a second, redundant Approval. Without this guard every re-approve call
				// below would unconditionally call mintHumanApproval again and append yet another genuine
				// Approval (approvalsCount growing 1, 2, 3, ... on every retry of an already-closed gate) --
				// exactly the "ambiguous" outcome FR-13 forbids. A caller that genuinely wants to redo
				// sign-off must reopen the gate explicitly (`gate reject` then re-approve), a different,
				// already-handled state transition, not this one.
				if (record.status === "approved") {
					return current;
				}
				// FR-8/BR-6/R25: a mandatory gate needs at least one RUNTIME-DERIVED evidence item, not
				// merely a non-empty evidence list -- the same golden rule gate-state-policy.ts's own
				// isMandatorySatisfied now consults (this pendency's sibling fix), applied here too so
				// approval-time and advance-time never disagree about what "enough evidence" means.
				if (MANDATORY_GATES.has(gate) && !hasSufficientEvidenceForMandatoryGate(record.evidence)) {
					throw new GateCommandError(
						`cannot approve mandatory gate ${gate}: insufficient evidence -- at least one runtime-derived item is required (R25/BR-6)`,
					);
				}
				// R22: this adapter never writes method:"human" itself -- it only calls the sole factory
				// (mintHumanApproval), which itself only ever mints from a confirmResult that already came
				// out of the one real channel (runGateApprove's own options.confirm).
				// D3 layer 2 (Gate 8 loop-back finding 5): the boolean fed into mintHumanApproval is the
				// AND of confirmResult and the independent interactivity witness -- a `true` confirmResult
				// alone is no longer sufficient; a synthetic `true` reaching this point through a wiring
				// bug in the channel (layer 1) still cannot mint on a non-interactive process. Computed
				// here, not passed to mintHumanApproval as a second parameter, because that factory's own
				// signature is locked (ADR 0005 §6 -- "do not change these shapes without a new ADR").
				const effectiveConfirmResult = confirmResult === true && options.isInteractive();
				const approval = mintHumanApproval(effectiveConfirmResult, {
					gate,
					demandId,
					branch: current.branch,
					source: meta.source,
				});
				if (approval === null) {
					// FR-11: never approved -- needs-human, never silently left "in-progress".
					return { ...current, gates: { ...current.gates, [gate]: { ...record, status: "needs-human" } } };
				}
				return {
					...current,
					gates: {
						...current.gates,
						[gate]: {
							...record,
							status: "approved",
							completedAt: new Date().toISOString(),
							approvals: [...record.approvals, approval],
						},
					},
				};
			});
			if (!result.ok) throw new GateCommandError(`cannot approve gate ${gate}: ${describeStoreError(result.error)}`);
			return projectSnapshot(result.value.next);
		},

		reject(demandId, gate, reason) {
			const store = storeFor(options, demandId);
			readOrBootstrap(store);
			const result = store.mutate((current) => {
				const record: GateRecord = current.gates[gate] ?? { gate, ...EMPTY_GATE_RECORD };
				const decision: Decision = {
					gate,
					// D4 §6.3 (ADR 0006): a rejection is a state transition the rejecter judges, never a
					// groundable technical decision -- "kind: decision" is reserved for gate-grounding.ts's
					// recordGroundedDecision alone (the sole-mint invariant test/gate-grounding-sole-mint.test.ts
					// enforces by static scan across the whole monorepo).
					kind: "rejection",
					text: reason,
					// This code path never calls mintHumanApproval (no confirm channel is threaded through
					// GateStateStoreView.reject at all) -- "auto" is the only honest tag it may ever write;
					// "human" is reserved for the one real sole-mint factory (R22's own sole-mint discipline).
					method: "auto",
					recordedAt: new Date().toISOString(),
				};
				return {
					...current,
					gates: {
						...current.gates,
						[gate]: { ...record, status: "rejected", decisions: [...record.decisions, decision] },
					},
				};
			});
			if (!result.ok) throw new GateCommandError(`cannot reject gate ${gate}: ${describeStoreError(result.error)}`);
			return projectSnapshot(result.value.next);
		},

		calibrate(demandId, collapsedGates, method) {
			const store = storeFor(options, demandId);
			readOrBootstrap(store);
			// R24: refuse AT REGISTRATION time, before any Decision is persisted -- never silently trimmed
			// to the legal subset. Checked outside the mutate() transaction (pure, no I/O, cheap) so a
			// refusal never even attempts the lock/write.
			const evalResult = evaluateCalibration(collapsedGates, MANDATORY_GATES);
			if (!evalResult.ok) {
				const offendingLabel = evalResult.offendingMandatory.map((g) => `gate ${g}`).join(", ");
				throw new GateCommandError(`calibration refused: cannot collapse mandatory ${offendingLabel}`);
			}
			const result = store.mutate((current) => {
				const decision: CalibrationDecision = {
					gate: current.currentGate,
					kind: "calibration",
					text: `collapsed gate(s) ${collapsedGates.join(", ")}`,
					method,
					collapsedGates,
					recordedAt: new Date().toISOString(),
				};
				return { ...current, calibration: decision };
			});
			if (!result.ok) throw new GateCommandError(`cannot register calibration: ${describeStoreError(result.error)}`);
			return projectSnapshot(result.value.next);
		},

		// FASE 8 / N1 (docs/adr/0009-fase8-autonomous-mode.md §1.1/§14, Gate 6 wiring closure): the FIRST
		// call site of @conductor/runtime's mintAutoApproval, composing the SAME store.mutate every other
		// method on this interface already uses (never a second mutator). GUARDED by MANDATORY_GATES,
		// checked BEFORE any store I/O at all -- a mandatory gate refuses unconditionally, independent of
		// whether it was ever started (gate-approve-auto-mandatory-guard.test.ts's it.each calls this with
		// no prior store.start() at all, so the refusal must not depend on gate/demand state).
		approveAuto(demandId, gate) {
			if (MANDATORY_GATES.has(gate)) {
				throw new GateCommandError(
					`cannot auto-approve gate ${gate}: it is a mandatory gate (N1/R55) -- a mandatory gate is never auto-cunhado, only a genuine human sign-off (\`conductor gate approve\`) can close it`,
				);
			}
			const store = storeFor(options, demandId);
			readOrBootstrap(store);
			const result = store.mutate((current) => {
				const record = current.gates[gate];
				if (!record || record.status === "not-started" || record.status === "rejected") {
					throw new GateCommandError(`cannot auto-approve gate ${gate}: it was never started (or is rejected)`);
				}
				// Mirrors approve()'s own idempotency guard: re-approving an already-approved gate reaffirms
				// the existing state, never mints a second, redundant Approval.
				if (record.status === "approved") {
					return current;
				}
				// Gate 8 loop-back, finding 1 (hollow gate completion): a non-mandatory gate is exempt from
				// hasSufficientEvidenceForMandatoryGate's stronger runtime-derived/git-commit bar (R25's
				// golden rule is a MANDATORY-gate floor, BR-6), but "exempt from the strong bar" was never
				// meant to read as "exempt from having done anything at all". Before this fix, approveAuto
				// minted method:"auto" for a gate with ZERO attached evidence -- because no subagent
				// delegation exists yet (runAuto's own header, step (c)), every non-mandatory gate a headless
				// run passed through was recorded as genuinely "approved" while representing no real work
				// whatsoever. This floor is deliberately LIGHTER than the mandatory one (any attached
				// evidence item counts, author-declared or runtime-derived -- see gate-evidence.ts's own
				// EvidenceProvenanceInfo) because a non-mandatory gate never had the stronger bar to begin
				// with; it only refuses the ZERO case, forcing a hollow run to fail loud (the caller,
				// runAuto, already converts any GateCommandError here into a needs-human stop, never a
				// silent false completion).
				if (record.evidence.length === 0) {
					throw new GateCommandError(
						`cannot auto-approve gate ${gate}: no evidence attached -- an auto-approved gate can never be a hollow completion, even when non-mandatory (Gate 8 loop-back finding 1)`,
					);
				}
				// N1: the ONE producer of method:"auto" for this call site -- mintAutoApproval itself can
				// never return a method:"human" value under any input (BR-7), so this mint can never be
				// confused with a genuine human sign-off however it is later read back.
				const approval = mintAutoApproval({ gate, demandId, branch: current.branch, source: "conductor-auto" });
				return {
					...current,
					gates: {
						...current.gates,
						[gate]: {
							...record,
							status: "approved",
							completedAt: new Date().toISOString(),
							approvals: [...record.approvals, approval],
						},
					},
				};
			});
			if (!result.ok)
				throw new GateCommandError(`cannot auto-approve gate ${gate}: ${describeStoreError(result.error)}`);
			return projectSnapshot(result.value.next);
		},
	};
}

/**
 * Resolves the `(repoId, branch)` pair a persisted `GateStateStore` is keyed by, from `cwd` alone --
 * this CLI already treats `cwd` as the trusted workspace root everywhere else (init.ts/doctor.ts: no
 * upward `.git` walk), so `.conductor/gates` lives directly under it (workspace-policy.ts's own
 * `defaultProtectedPaths(workspaceRoot)` already protects exactly this subtree).
 *
 * `branch`: reuses `getGitStatus` (git-status.ts) -- already this CLI's one shared git-branch check
 * (doctor.ts / chat's own status line) -- rather than a second, drifting `git branch --show-current`
 * call. Degrades to the fixed sentinel `"no-branch"` outside a git repository (informational-only,
 * matching `getGitStatus`'s own "this check is informational only, never blocking" contract) -- this
 * keeps `conductor gate *` usable against a plain (non-git) scratch/demo directory, exactly what this
 * package's own acceptance tests exercise.
 *
 * `repoId`: ADR 0005 §15 leaves the real source an EXPLICIT open question ("derivar de git remote
 * get-url origin OU um UUID persistido na 1ª escrita — sub-pergunta aberta", tagged Low risk, R5).
 * Resolving that open ADR question is out of this wiring pendency's scope. This is a deliberate,
 * narrow, DOCUMENTED interim choice, not a silent resolution of it: a stable sha256 hash of the
 * resolved `cwd` itself, so gate state persisted from the same clone/location never drifts across
 * separate `conductor gate` invocations, without requiring a git remote (this package's own scratch
 * acceptance tests are not git repositories at all). Content-authoritative verification
 * (gate-state-store.ts's own demandId/repoId/branch check) means a mismatch here fails closed as
 * `could-not-verify`, never a silent cross-repo mixup -- the safer of the two failure directions while
 * §15 stays open.
 */
export async function resolveGateGitContext(cwd: string): Promise<{ repoId: string; branch: string }> {
	const timeoutMs = resolveTimeoutMs(process.env.CONDUCTOR_GATE_GIT_TIMEOUT_MS, DEFAULT_GIT_STATUS_TIMEOUT_MS);
	const status = await getGitStatus(cwd, timeoutMs);
	const branch = status.kind === "unavailable" ? "no-branch" : status.branch;
	const repoId = createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, 16);
	return { repoId, branch };
}
