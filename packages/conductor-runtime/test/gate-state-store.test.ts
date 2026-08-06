/**
 * Test-first (Gate 5) for `GateStateStore` (src/gate-state-store.ts) — Fase 4 "Gates e evidências",
 * ADR 0005 §2/§3/§9 (formato/localização/escrita atômica/checksum), gate2-spec-fase4.md FR-12/
 * FR-14/FR-15, gate3-addendum-fase4.md T43/T44, rules R27/R28.
 *
 * `createGateStateStore` is currently a STUB that throws "not implemented" (src/gate-state-store.ts)
 * — every test below drives the REAL, locked interface directly (no mocking of `fs`: a real scratch
 * workspace, the same discipline `test/workspace-policy.test.ts` already uses — Unit Testing
 * Principles — Complete Professional Guide §3.9/§3.12, "mock only unmanaged out-of-process
 * dependencies... the real collaborator is cheap" does NOT apply to the local filesystem itself
 * here, since the whole point under test IS the filesystem contract: atomic write, fail-closed
 * read) and fails RED for the single correct reason: Gate 6 has not written the body yet.
 *
 * Fixture naming note: `expectedEnvelopePath()` below independently mirrors ADR 0005 §3.1's naming
 * scheme (`<sanitized-branch>--<hash8>.json`, hash8 = first 8 hex chars of sha256(branch)) ONLY so
 * these tests can pre-seed a fixture file at the exact path Gate 6's real `createGateStateStore`
 * will read from — this helper is test-only, never imported by production code, and is NOT the
 * "real logic" this Gate defers to Gate 6 (it is a literal transcription of an already-decided,
 * already-documented naming rule, not new design).
 */

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GateState } from "../src/gate-state.ts";
import { createGateStateStore, type GateStateEnvelopeV1 } from "../src/gate-state-store.ts";
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

/** Mirrors ADR 0005 §3.1's naming scheme — see this file's own header for why this is test-only. */
function expectedEnvelopePath(dir: string, branch: string): string {
	const sanitizedBranch = branch.replace(/[\\/:*?"<>|]/g, "-");
	const hash8 = createHash("sha256").update(branch, "utf8").digest("hex").slice(0, 8);
	return join(dir, `${sanitizedBranch}--${hash8}.json`);
}

function minimalGateState(overrides: Partial<GateState> = {}): GateState {
	return {
		demandId: DEMAND_ID,
		repoId: REPO_ID,
		branch: BRANCH,
		currentGate: 5,
		gates: {
			5: { gate: 5, status: "in-progress", evidence: [], decisions: [], risks: [], approvals: [] },
		},
		startedAt: "2026-08-06T00:00:00.000Z",
		...overrides,
	};
}

function validEnvelope(overrides: Partial<GateStateEnvelopeV1> = {}): GateStateEnvelopeV1 {
	return {
		schemaVersion: 1,
		demandId: DEMAND_ID,
		repoId: REPO_ID,
		branch: BRANCH,
		revision: 1,
		// Deliberately NOT the real sha256(canonicalizeJson(state)) — checksum-specific tests set this
		// explicitly; tests that are not about the checksum never inspect it, only whether read()
		// succeeds or fails for a DIFFERENT, more specific reason (parse/schema).
		checksum: "irrelevant-for-non-checksum-tests",
		state: minimalGateState(),
		...overrides,
	};
}

function makeStore() {
	return createGateStateStore({ gatesDir, demandId: DEMAND_ID, repoId: REPO_ID, branch: BRANCH });
}

// -------------------------------------------------------------------------------------------------
// Test 3 (task brief) — fail-closed on corrupted/incompatible/incomplete state (R28/T44, FR-15).
// Invalid JSON, incompatible schema, a missing field: ALL deny — never "assume approved by default".
// -------------------------------------------------------------------------------------------------

describe("GateStateStore.read() — fail-closed on corrupted or invalid state (R28/T44, FR-15)", () => {
	it("returns could-not-verify (never a thrown crash, never a default GateState) when the file contains invalid JSON", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		writeFileSync(path, "{ this is not valid json ]]]", "utf8");

		const store = makeStore();
		const result = store.read();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("could-not-verify");
	});

	it("returns could-not-verify when schemaVersion does not match the literal 1 this store expects", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		// Deliberately malformed for the test (schemaVersion is typed as the literal 1).
		const malformed = { ...validEnvelope(), schemaVersion: 2 } as unknown as GateStateEnvelopeV1;
		writeFileSync(path, JSON.stringify(malformed), "utf8");

		const store = makeStore();
		const result = store.read();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("could-not-verify");
	});

	it("returns could-not-verify when a required field is missing entirely (state.gates absent)", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		const envelope = validEnvelope();
		const { gates: _omitted, ...stateWithoutGates } = envelope.state;
		const malformed = { ...envelope, state: stateWithoutGates };
		writeFileSync(path, JSON.stringify(malformed), "utf8");

		const store = makeStore();
		const result = store.read();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("could-not-verify");
	});

	it("returns could-not-verify — never ok:true with an invented empty GateState — when the file has never been written at all", () => {
		// Deliberately never created (mirrors workspace-policy.test.ts's own "protection does not
		// require the target to already exist" discipline, applied here to a READ rather than a
		// write-deny): a store must never treat "nothing on disk yet" as "everything is approved so
		// far", the exact BR-9/G5 failure direction this whole Gate exists to lock down.
		const store = makeStore();
		const result = store.read();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("could-not-verify");
	});

	it("returns could-not-verify on a checksum mismatch — a syntactically valid envelope whose content was silently altered (R28: anti-accident, not tamper-evidence)", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		writeFileSync(
			path,
			JSON.stringify(
				validEnvelope({ checksum: "0000000000000000000000000000000000000000000000000000000000000000" }),
			),
			"utf8",
		);

		const store = makeStore();
		const result = store.read();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("could-not-verify");
	});

	it("returns could-not-verify when the envelope's own demandId/repoId/branch do not match what this store was constructed for (content-authoritative, ADR §3.1 — never trusts the filename alone)", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		writeFileSync(path, JSON.stringify(validEnvelope({ demandId: "some-other-demand" })), "utf8");

		const store = makeStore();
		const result = store.read();

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("could-not-verify");
	});
});

// -------------------------------------------------------------------------------------------------
// Test 2 (task brief) — atomic write: a failure mid-write never leaves a torn/truncated file
// observable; the file on disk is always EITHER the complete old content or the complete new
// content (R27/T43).
// -------------------------------------------------------------------------------------------------

describe("GateStateStore.mutate() — atomic write, crash-simulated (R27/T43)", () => {
	it("a write that fails mid-flight leaves the pre-existing envelope byte-for-byte intact — never a torn/truncated file, never a mix of old and new (temp+rename discipline)", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		const oldEnvelope = validEnvelope({ revision: 1 });
		writeFileSync(path, JSON.stringify(oldEnvelope), "utf8");
		const oldRaw = readFileSync(path, "utf8");

		// Hold an exclusive handle on the DESTINATION file so the final rename-into-place step of an
		// atomic write can never complete — on Windows, MoveFileExW onto a path with an open handle
		// (Node's default fs.openSync sharing flags do not include FILE_SHARE_DELETE) fails with a
		// sharing violation (EBUSY/EPERM), exactly the residual ADR 0005 §3.2/R2 names. This lets the
		// test simulate "the process died/was blocked mid-write" WITHOUT knowing Gate 6's internal
		// temp-file naming scheme — only the final destination path (`store.filePath`-equivalent)
		// needs to be known, and it is fixed by the ADR's own naming rule.
		const blockingFd = openSync(path, "r+");
		try {
			const store = makeStore();
			// Whatever this call reports (an io-error in the real Gate-6 implementation; a thrown
			// "not implemented" in this RED stub) is not what this test asserts on — the FILE is.
			try {
				store.mutate((current) => ({ ...current, currentGate: current.currentGate + 1 }));
			} catch {
				// A thrown error here (the current stub) or a returned Result.err in the real
				// implementation are both acceptable outcomes for THIS assertion's purpose.
			}
		} finally {
			closeSync(blockingFd);
		}

		const rawAfter = readFileSync(path, "utf8");
		expect(() => JSON.parse(rawAfter)).not.toThrow();
		expect(rawAfter).toBe(oldRaw);
	});

	it("a bug INSIDE the caller's mutate callback throws out of mutate() — it is never caught and silently turned into a generic io-error", () => {
		const path = expectedEnvelopePath(gatesDir, BRANCH);
		writeFileSync(path, JSON.stringify(validEnvelope()), "utf8");

		const store = makeStore();
		const boom = new Error("a genuine bug in the caller's own mutate callback");

		expect(() =>
			store.mutate(() => {
				throw boom;
			}),
		).toThrow();
	});
});
