/**
 * GateStateStore — the I/O boundary for a demand's persisted `GateState` (ADR 0005 §2 "Borda
 * (adapter de I/O)"; §3 formato/localização/escrita atômica; R27/R28, FR-12/14/15).
 *
 * GATE 5 (test-first): `createGateStateStore` is a STUB that throws "not implemented" — Gate 6
 * implements the body. Every test in `test/gate-state-store.test.ts` drives this REAL, locked
 * interface directly (no fs mocking — a real scratch workspace, same discipline as
 * `workspace-policy.test.ts`) and fails RED for the single correct reason: Gate 6 has not written
 * the body yet.
 *
 * One store instance = one demand's file (ADR §3.1: "um arquivo por demanda"), never a global/
 * shared store indexed by demandId at call time — construction fixes `demandId`/`repoId`/`branch`/
 * `filePath` once, the same shape as `createAuditTrailWriter(filePath)`/`createSharedBudget(limit)`
 * already use in this package. `mutateGateState` (gate-state-mutation.ts, R27) is a separate,
 * thin orchestration function that takes a `GateStateStore` — see that file's header for why its
 * signature intentionally differs from the ADR §18 illustrative one-arg (`demandId: string`) form:
 * a bare `demandId` cannot alone locate `.conductor/gates/<sanitized-branch>--<hash8>.json` (the
 * envelope's `demandId`/`repoId`/`branch` are content-authoritative, checked AGAINST an
 * already-resolved file, never used to derive it by scanning) — the ADR's own appendix disclaimer
 * ("illustrative of contract, not production-ready code") explicitly allows this kind of adaptation.
 *
 * Content, not filename, is the truth (ADR §3.1): `read()`/`mutate()` MUST verify the envelope's
 * own `demandId`/`repoId`/`branch` against what this store was constructed with BEFORE trusting the
 * file — a mismatch is a `could-not-verify`, never silently accepted because the filename looked
 * right.
 */

import type { Result } from "@earendil-works/pi-agent-core";
import type { GateState } from "./gate-state.ts";

/** FR-12: schema version is a LITERAL from the very first write (harness-table.ts precedent: a
 * literal `schemaVersion: 1`, not `number`, so a v2 becomes a discriminated union instead of a
 * guess-the-shape problem). */
export interface GateStateEnvelopeV1 {
	schemaVersion: 1;
	/** Content-authoritative (ADR §3.1) — every reader verifies these three against what it expected
	 * BEFORE trusting the file; never trusts the filename alone. */
	demandId: string;
	repoId: string;
	branch: string;
	/** CAS monotonic counter (R27) — incremented by exactly 1 on every successful mutation. */
	revision: number;
	/** sha256(canonicalizeJson(state)) — integrity-against-ACCIDENT (bit-rot, a torn write), never
	 * claimed as tamper-evidence against a local editor who would simply recompute it (ADR §9.2/R28). */
	checksum: string;
	state: GateState;
}

/**
 * Terminal, 3-shape error union (R26/R28) — never a 4th silent bucket. Every failure mode this
 * store can produce collapses into exactly one of these three, and NONE of them is ever silently
 * upgraded to a successful read/write by a caller's default-case fallthrough.
 */
export type GateStateMutationError =
	/** Illegible / schema mismatch / checksum mismatch / CAS-conflict (someone else's revision won
	 * the race) — the state could not be trusted, never treated as "assume approved". */
	| { kind: "could-not-verify"; reason: string }
	/** Another writer currently holds the exclusive lock; the caller MAY retry. */
	| { kind: "locked"; heldSince: string }
	/** `rename`/`fsync`/`write` failed for a reason unrelated to the content's validity (disk full,
	 * a transient Windows sharing violation, …). */
	| { kind: "io-error"; cause: unknown };

export interface GateStateStoreOptions {
	/** Absolute path to the `.conductor/gates` directory (ADR §3.1). Must already exist or be
	 * creatable by the store itself — Gate 6's concern, not this stub's. */
	gatesDir: string;
	demandId: string;
	repoId: string;
	branch: string;
}

export interface GateStateStore {
	/** Absolute path this store reads/writes — `<gatesDir>/<sanitized-branch>--<hash8>.json` (ADR
	 * §3.1). Human-scannable, NEVER authoritative on its own (content is verified against it). */
	readonly filePath: string;

	/**
	 * Read-only, fail-closed (BR-9/FR-15/R28): illegible file, JSON parse failure, schema mismatch,
	 * or checksum mismatch all resolve to `{ kind: "could-not-verify" }` — a file that has never
	 * been written yet resolves to the SAME `could-not-verify` shape (never a silently-invented
	 * default `GateState`, and never a thrown exception a caller could forget to catch).
	 */
	read(): Result<GateStateEnvelopeV1, GateStateMutationError>;

	/**
	 * Check-and-write (R27): acquire the exclusive lock (`O_EXCL`/`CREATE_NEW`, stale-by-age
	 * rename-aside retry), read+verify the current envelope, invoke `mutate` with the CURRENT
	 * `GateState`, then persist the result via write-temp-in-the-SAME-directory + `fsync` +
	 * `renameSync` (never `os.tmpdir()` — cross-volume renames are not atomic) before releasing the
	 * lock. A CAS check on `revision` is the backstop even when the lock itself was somehow bypassed
	 * (a broken stale-lock reclaim): a revision mismatch at write time returns `could-not-verify`,
	 * NEVER silently overwrites the other writer's mutation.
	 *
	 * A bug INSIDE the `mutate` callback throws out of this call (it is never caught and turned into
	 * a misleadingly generic `io-error`) — only genuine I/O/lock/CAS failures produce the
	 * `GateStateMutationError` union.
	 */
	mutate(
		mutate: (current: GateState) => GateState,
	): Result<{ next: GateState; revision: number }, GateStateMutationError>;
}

export function createGateStateStore(_options: GateStateStoreOptions): GateStateStore {
	throw new Error("not implemented");
}
