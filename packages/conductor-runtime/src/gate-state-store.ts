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

import { createHash, randomBytes } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { Result } from "@earendil-works/pi-agent-core";
import type { GateRecord, GateState } from "./gate-state.ts";

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

// ---------------------------------------------------------------------------------------------
// Path derivation (ADR 0005 §3.1) — one file per demand, name human-scannable but NEVER
// authoritative (content is verified against it, see readEnvelopeFile below).
// ---------------------------------------------------------------------------------------------

/** Characters illegal in a Windows filename — same set the ADR names verbatim. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

function deriveEnvelopeFilePath(gatesDir: string, branch: string): string {
	const sanitizedBranch = branch.replace(ILLEGAL_FILENAME_CHARS, "-");
	// hash8 disambiguates two branches that collide after sanitization (e.g. "feature/foo-bar" vs
	// "feature-foo/bar") — appended, never relied on alone, so the name stays human-scannable.
	const hash8 = createHash("sha256").update(branch, "utf8").digest("hex").slice(0, 8);
	return join(gatesDir, `${sanitizedBranch}--${hash8}.json`);
}

// ---------------------------------------------------------------------------------------------
// Canonical JSON + checksum (R28/ADR §9.2) — integrity-against-ACCIDENT (bit-rot, a torn write),
// never claimed as tamper-evidence against a local editor who would simply recompute it.
//
// ADR §9.2 names `canonicalizeJson` from `packages/evals/src/vitest-evals/harness-table.ts` as the
// precedent to REUSE rather than reinvent — but that function is a private, unexported module-local
// helper in a package `conductor-runtime` does not (and per ADR 0002 §3.1 should not) depend on.
// Literal reuse-by-import is therefore not available; this is a disciplined, narrow transcription of
// the SAME algorithm (sort object keys for a stable key order, reject NaN/Infinity, reject circular
// references) — not a second, drifting design — so the checksum is stable across writes for the same
// logical content, which is all R28 actually requires.
// ---------------------------------------------------------------------------------------------

function canonicalizeJsonForChecksum(value: unknown, ancestors: WeakSet<object>): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("GateState checksum input must contain only finite numbers.");
		return value;
	}
	if (typeof value !== "object") throw new TypeError("GateState checksum input must be JSON-serializable.");
	if (ancestors.has(value)) throw new TypeError("GateState checksum input must not contain circular references.");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((item) => canonicalizeJsonForChecksum(item, ancestors));
		}
		const entries = Object.entries(value as Record<string, unknown>);
		return Object.fromEntries(
			entries
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([key, item]) => [key, canonicalizeJsonForChecksum(item, ancestors)]),
		);
	} finally {
		ancestors.delete(value);
	}
}

function computeStateChecksum(state: GateState): string {
	const canonical = canonicalizeJsonForChecksum(state, new WeakSet());
	return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errnoCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? (error as NodeJS.ErrnoException).code
		: undefined;
}

// ---------------------------------------------------------------------------------------------
// Envelope shape validation (BR-9/FR-15/R28) — fail-closed on anything short of a fully-typed,
// schema-valid envelope. Never a partial/best-effort parse that lets a caller reach in for "the
// fields it needs" out of a shape that hasn't been fully checked.
// ---------------------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidGateStateShape(value: unknown): value is GateState {
	if (!isPlainObject(value)) return false;
	const { demandId, repoId, branch, currentGate, gates, startedAt } = value;
	if (typeof demandId !== "string" || typeof repoId !== "string" || typeof branch !== "string") return false;
	if (typeof currentGate !== "number" || !Number.isFinite(currentGate)) return false;
	if (!isPlainObject(gates)) return false;
	if (typeof startedAt !== "string") return false;
	return true;
}

function isValidEnvelopeShape(value: unknown): value is GateStateEnvelopeV1 {
	if (!isPlainObject(value)) return false;
	// schemaVersion is a LITERAL 1 (FR-12), never just `typeof === "number"` — a v2 (or any other
	// value) fails closed here rather than being guessed at.
	if (value.schemaVersion !== 1) return false;
	if (typeof value.demandId !== "string" || typeof value.repoId !== "string" || typeof value.branch !== "string") {
		return false;
	}
	if (typeof value.revision !== "number" || !Number.isFinite(value.revision)) return false;
	if (typeof value.checksum !== "string") return false;
	if (!isValidGateStateShape(value.state)) return false;
	return true;
}

// ---------------------------------------------------------------------------------------------
// Default bootstrap state — the "read nothing -> write first revision" path `mutate()` needs when
// no envelope has ever been written for this demand yet (gate-state-mutation.test.ts's own
// `seedInitialState` exercises exactly this path via `store.mutate((current) => current)`).
//
// Pre-populates a GateRecord for every one of the 14 flow gates, each `not-started` with empty
// (never undefined) evidence/decisions/risks/approvals arrays: `GateRecord`'s array fields are
// non-optional by type (gate-state.ts), and a caller's mutate callback (e.g. `gate evidence`
// attaching to `current.gates[N].evidence`) must be able to spread/append onto a real record for
// any gate number from its very first mutation — never `undefined` for a gate nobody has
// explicitly "started" yet.
// ---------------------------------------------------------------------------------------------

const TOTAL_FLOW_GATES = 14;

function createDefaultGateState(options: GateStateStoreOptions): GateState {
	const gates: Record<number, GateRecord> = {};
	for (let gate = 1; gate <= TOTAL_FLOW_GATES; gate += 1) {
		gates[gate] = { gate, status: "not-started", evidence: [], decisions: [], risks: [], approvals: [] };
	}
	return {
		demandId: options.demandId,
		repoId: options.repoId,
		branch: options.branch,
		currentGate: 0,
		gates,
		startedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------------------------
// Synchronous sleep for the bounded retry loops below (lock acquisition backoff, rename retry).
// `Atomics.wait` blocks the current thread without an `await`/microtask — Node (unlike a browser)
// explicitly allows this on the main thread — which is what keeps the whole mutate() call the
// single synchronous stack the reserve()-style atomicity argument (ADR §3.2/§3.3) depends on.
// ---------------------------------------------------------------------------------------------

function sleepSyncMs(ms: number): void {
	if (ms <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------------------------
// Exclusive lock (R27/ADR §3.3) — cross-process serialization. `O_CREAT|O_EXCL` ("wx") is atomic
// create-if-absent on POSIX and Windows alike; the loser of the race gets EEXIST deterministically.
// Stale-by-AGE reclaim (never liveness-by-PID, which Windows cannot check reliably): a lock older
// than STALE_LOCK_AGE_MS is renamed aside atomically and re-acquired, never deleted-and-proceeded
// (that would reopen the exact race a lock exists to close).
// ---------------------------------------------------------------------------------------------

const STALE_LOCK_AGE_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 25;
const MAX_LOCK_ACQUIRE_ATTEMPTS = 20;

type LockAcquireResult = { ok: true; fd: number } | { ok: false; error: GateStateMutationError };

function acquireLock(lockPath: string): LockAcquireResult {
	for (let attempt = 0; attempt < MAX_LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
		try {
			const fd = openSync(lockPath, "wx", 0o600);
			writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
			return { ok: true, fd };
		} catch (error) {
			if (errnoCode(error) !== "EEXIST") {
				return { ok: false, error: { kind: "io-error", cause: error } };
			}
			let heldSince = new Date().toISOString();
			try {
				const stats = statSync(lockPath);
				heldSince = stats.mtime.toISOString();
				if (Date.now() - stats.mtimeMs > STALE_LOCK_AGE_MS) {
					// Rename-aside atomically -- never delete-and-proceed silently (that would reintroduce
					// the exact race a lock exists to close, per ADR §3.3).
					renameSync(lockPath, `${lockPath}.stale-${Date.now()}`);
					continue;
				}
			} catch {
				// The lock vanished between our EEXIST and this stat (the other writer just released it,
				// or a concurrent stale-reclaim beat us to it) -- fine, just retry the acquire below.
			}
			if (attempt === MAX_LOCK_ACQUIRE_ATTEMPTS - 1) {
				return { ok: false, error: { kind: "locked", heldSince } };
			}
			sleepSyncMs(LOCK_RETRY_DELAY_MS);
		}
	}
	return { ok: false, error: { kind: "locked", heldSince: new Date().toISOString() } };
}

function releaseLock(lockPath: string, fd: number): void {
	try {
		closeSync(fd);
	} finally {
		try {
			rmSync(lockPath, { force: true });
		} catch {
			// Best-effort cleanup -- a stray lock file self-heals via the stale-by-age reclaim above;
			// a cleanup failure here must never mask (or overwrite) the real mutation result already
			// computed by the caller.
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Atomic write (R27/ADR §3.2) — temp file in the SAME directory as the destination (never
// `os.tmpdir()`, which can be a different volume and make the final rename non-atomic), fsync'd
// before the rename so the bytes are durable before the name is ever repointed at them. Bounded
// retry-with-backoff on the rename itself (ADR §3.2 residual: Windows `MoveFileExW` can transiently
// fail EPERM/EBUSY under an AV/indexer/backup handle) -- never a single-shot rename that gives up
// immediately, but also never an unbounded retry that could hang a CLI command forever.
// ---------------------------------------------------------------------------------------------

const RENAME_RETRY_DELAYS_MS = [10, 20, 40];

function writeEnvelopeAtomic(
	destPath: string,
	gatesDir: string,
	envelope: GateStateEnvelopeV1,
): GateStateMutationError | null {
	const tempPath = join(gatesDir, `.${basename(destPath)}.tmp-${randomBytes(4).toString("hex")}`);

	let fd: number;
	try {
		fd = openSync(tempPath, "w", 0o600);
	} catch (error) {
		return { kind: "io-error", cause: error };
	}
	try {
		writeFileSync(fd, JSON.stringify(envelope), "utf8");
		fsyncSync(fd);
	} catch (error) {
		try {
			closeSync(fd);
		} catch {
			// The write/fsync already failed; a close failure on top of that is not a new, distinct
			// fact worth reporting -- the original error is.
		}
		try {
			rmSync(tempPath, { force: true });
		} catch {
			// Best-effort cleanup of the half-written temp file -- it never replaces destPath (no
			// rename was attempted), so leaving it behind on a cleanup failure is not a correctness
			// problem, only litter.
		}
		return { kind: "io-error", cause: error };
	}
	closeSync(fd);

	let lastError: unknown;
	for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			renameSync(tempPath, destPath);
			return null;
		} catch (error) {
			lastError = error;
			if (attempt < RENAME_RETRY_DELAYS_MS.length) sleepSyncMs(RENAME_RETRY_DELAYS_MS[attempt]);
		}
	}
	try {
		rmSync(tempPath, { force: true });
	} catch {
		// Same as above: best-effort only, never lets a cleanup failure mask the real rename failure.
	}
	return { kind: "io-error", cause: lastError };
}

export function createGateStateStore(options: GateStateStoreOptions): GateStateStore {
	const filePath = deriveEnvelopeFilePath(options.gatesDir, options.branch);
	const lockPath = `${filePath}.lock`;

	type ReadOutcome =
		| { kind: "not-found" }
		| { kind: "parsed"; envelope: GateStateEnvelopeV1 }
		| { kind: "error"; error: GateStateMutationError };

	/**
	 * Shared by `read()` and `mutate()`'s own internal read-before-write step: parse + schema
	 * validation + content-authoritative identity check (ADR §3.1 — verify demandId/repoId/branch
	 * against what this store was constructed for BEFORE trusting the file, never the filename
	 * alone). Deliberately does NOT verify the checksum -- that is `read()`'s own, stricter
	 * responsibility (see its own comment below for why `mutate()` must not gate the caller's
	 * callback on a stale/inherited checksum it is about to overwrite anyway).
	 */
	function readEnvelopeFile(): ReadOutcome {
		let raw: string;
		try {
			raw = readFileSync(filePath, "utf8");
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return { kind: "not-found" };
			return { kind: "error", error: { kind: "io-error", cause: error } };
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			return {
				kind: "error",
				error: { kind: "could-not-verify", reason: `gate state file is not valid JSON: ${describeError(error)}` },
			};
		}

		if (!isValidEnvelopeShape(parsed)) {
			return {
				kind: "error",
				error: { kind: "could-not-verify", reason: "gate state envelope failed schema validation" },
			};
		}

		if (
			parsed.demandId !== options.demandId ||
			parsed.repoId !== options.repoId ||
			parsed.branch !== options.branch
		) {
			return {
				kind: "error",
				error: {
					kind: "could-not-verify",
					reason:
						"gate state envelope demandId/repoId/branch does not match this store (content-authoritative check failed)",
				},
			};
		}

		return { kind: "parsed", envelope: parsed };
	}

	return {
		filePath,

		read(): Result<GateStateEnvelopeV1, GateStateMutationError> {
			const outcome = readEnvelopeFile();
			if (outcome.kind === "not-found") {
				// BR-9/G5: a file that has never been written yet is NOT "everything approved so far" --
				// it is exactly as unverifiable as a corrupted one, same terminal shape, never a silently
				// invented empty GateState.
				return Result.err({ kind: "could-not-verify", reason: "gate state file has never been written yet" });
			}
			if (outcome.kind === "error") return Result.err(outcome.error);

			// R28/T44: checksum verified HERE, at the read boundary a human/reviewer/`gate status`
			// actually trusts -- a mismatch means the syntactically-valid envelope's content was
			// silently altered (bit-rot, a torn write BR-9's parse/schema check alone cannot catch).
			let expectedChecksum: string;
			try {
				expectedChecksum = computeStateChecksum(outcome.envelope.state);
			} catch (error) {
				return Result.err({
					kind: "could-not-verify",
					reason: `gate state checksum could not be computed: ${describeError(error)}`,
				});
			}
			if (expectedChecksum !== outcome.envelope.checksum) {
				return Result.err({
					kind: "could-not-verify",
					reason:
						"gate state checksum mismatch -- possible silent corruption (R28, anti-accident, not tamper-evidence)",
				});
			}

			return Result.ok(outcome.envelope);
		},

		mutate(
			mutateFn: (current: GateState) => GateState,
		): Result<{ next: GateState; revision: number }, GateStateMutationError> {
			// Self-healing (ADR §3.1: "must already exist or be creatable by the store itself") --
			// mkdir is idempotent and never mutates the envelope itself.
			mkdirSync(options.gatesDir, { recursive: true });

			const lock = acquireLock(lockPath);
			if (!lock.ok) return Result.err(lock.error);

			try {
				const outcome = readEnvelopeFile();
				let currentState: GateState;
				let currentRevision: number;

				if (outcome.kind === "not-found") {
					// The "read nothing -> write first revision" bootstrap path (this file's own header) --
					// revision 0 so the very first successful write becomes revision 1, same convention as
					// every subsequent mutation (+1 per success, R27).
					currentState = createDefaultGateState(options);
					currentRevision = 0;
				} else if (outcome.kind === "error") {
					// A corrupted/mismatched EXISTING file is never silently replaced by a fresh bootstrap
					// state -- that would be exactly the fail-open T44 warns about (corruption papered
					// over instead of surfaced). Refuse before the callback ever runs.
					return Result.err(outcome.error);
				} else {
					currentState = outcome.envelope.state;
					currentRevision = outcome.envelope.revision;
				}

				// R27/T43: zero `await`/microtask between this read and the write below (the
				// `shared-budget.ts:reserve()` pattern) -- and a bug INSIDE `mutateFn` throws OUT of this
				// call, uncaught, never swallowed into a misleadingly generic io-error (this file's own
				// header / test/gate-state-store.test.ts's own explicit assertion of that contract).
				const nextState = mutateFn(currentState);

				// CAS backstop (R27, ADR §3.3(2)): re-verify the revision on disk immediately before
				// writing, still inside the lock -- the only way this could ever differ is a broken
				// stale-lock reclaim (another writer wrongly judged us dead). A mismatch degrades to
				// could-not-verify, NEVER a silent overwrite of the other writer's mutation.
				const recheck = readEnvelopeFile();
				if (recheck.kind === "error") return Result.err(recheck.error);
				const diskRevision = recheck.kind === "parsed" ? recheck.envelope.revision : 0;
				if (diskRevision !== currentRevision) {
					return Result.err({
						kind: "could-not-verify",
						reason: "gate state revision changed during mutation (CAS conflict) -- refusing to overwrite",
					});
				}

				const nextRevision = currentRevision + 1;
				let checksum: string;
				try {
					checksum = computeStateChecksum(nextState);
				} catch (error) {
					return Result.err({
						kind: "could-not-verify",
						reason: `unable to checksum the mutated gate state: ${describeError(error)}`,
					});
				}

				const envelope: GateStateEnvelopeV1 = {
					schemaVersion: 1,
					demandId: options.demandId,
					repoId: options.repoId,
					branch: options.branch,
					revision: nextRevision,
					checksum,
					state: nextState,
				};

				const writeError = writeEnvelopeAtomic(filePath, options.gatesDir, envelope);
				if (writeError) return Result.err(writeError);

				return Result.ok({ next: nextState, revision: nextRevision });
			} finally {
				releaseLock(lockPath, lock.fd);
			}
		},
	};
}
