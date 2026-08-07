/**
 * Test-first (Gate 5, Fase 5) for GateStateEnvelope schema migration (ADR 0006 §7.3, `docs/adr/0006-
 * fase5-library-and-grounding.md`): a reader must accept BOTH `schemaVersion: 1` and `schemaVersion:
 * 2`; a v1 envelope that SOMEHOW carries a populated `groundingCitations` (the "impossible today" case
 * §7.3 still asks to be defended against — a hand-edited file under a protected path, or a future
 * downgrade) must be refused as `could-not-verify`, never silently "interpreted as best it can" (the
 * same direction R28/T44 already fixed for a checksum mismatch).
 *
 * `createGateStateStore`/`isValidEnvelopeShape` are ALREADY fully implemented (Fase 4 Gate 6 landed) —
 * these tests target a REAL, still-open gap in that already-shipped reader: it hard-refuses any
 * `schemaVersion` other than the literal `1` (gate-state-store.ts's own `isValidEnvelopeShape`), so it
 * cannot accept `schemaVersion: 2` yet, and it has no defense at all against a v1 envelope carrying a
 * `groundingCitations` field a genuine v1 producer could never have written (ADR §5.2 item 3: zero v1
 * file in the world has ever populated that field, since no producer ever existed before this fase).
 * Both gaps fail RED below for that reason, not because anything throws "not implemented".
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GroundingCitation } from "../src/gate-grounding.ts";
import type { Decision } from "../src/gate-state.ts";
import { createGateStateStore, type GateStateEnvelopeV1 } from "../src/gate-state-store.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;
let gatesDir: string;

const DEMAND_ID = "demand-fase5-schema";
const REPO_ID = "repo-pi";
const BRANCH = "feature/fase5-schema-v2";

beforeEach(() => {
	workspace = createScratchWorkspace();
	gatesDir = join(workspace.root, ".conductor", "gates");
});

afterEach(() => {
	workspace.cleanup();
});

function makeStore() {
	return createGateStateStore({ gatesDir, demandId: DEMAND_ID, repoId: REPO_ID, branch: BRANCH });
}

function envelopePath(): string {
	const sanitizedBranch = BRANCH.replace(/[\\/:*?"<>|]/g, "-");
	const hash8 = createHash("sha256").update(BRANCH, "utf8").digest("hex").slice(0, 8);
	return join(gatesDir, `${sanitizedBranch}--${hash8}.json`);
}

/**
 * Test-only, disciplined transcription of gate-state-store.ts's own private
 * `canonicalizeJsonForChecksum`/`computeStateChecksum` — needed ONLY so a hand-crafted, tampered
 * fixture below can carry a checksum the REAL, unmodified reader accepts as valid, isolating each test
 * to the ONE schema-level defense under test rather than an incidental checksum mismatch. Mirrors
 * gate-state-store.ts's own header note on why literal reuse-by-import is not available for a
 * module-local, non-exported helper.
 */
function canonicalizeForTest(value: unknown, ancestors: WeakSet<object>): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("not finite");
		return value;
	}
	if (typeof value !== "object") throw new TypeError("not JSON-serializable");
	if (ancestors.has(value)) throw new TypeError("circular");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return value.map((item) => canonicalizeForTest(item, ancestors));
		const entries = Object.entries(value as Record<string, unknown>);
		return Object.fromEntries(
			entries
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => [k, canonicalizeForTest(v, ancestors)]),
		);
	} finally {
		ancestors.delete(value);
	}
}

function checksumForTest(state: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(canonicalizeForTest(state, new WeakSet())), "utf8")
		.digest("hex");
}

function sampleCitation(): GroundingCitation {
	return {
		queryEventId: "q-1",
		chunkHash: "hash-1",
		question: "why does D3 require a finiteness guard?",
		source: "Managing Software Complexity",
		section: "§3.1",
		path: "managing-software-complexity.md",
		category: "architecture",
		corpusVersion: "corpus-v1",
		embeddingModel: "bge-m3",
		score: 0.691,
		retrievedAt: "2026-08-06T00:00:00.000Z",
		mode: "hybrid",
	};
}

describe("GateStateEnvelope schema migration (ADR 0006 §7.3) — the reader accepts schemaVersion: 2", () => {
	it("reads back an envelope whose schemaVersion was upgraded to 2 with its state (and checksum) unchanged — FAILS today: isValidEnvelopeShape hard-refuses anything but the literal 1", () => {
		const store = makeStore();
		const seeded = store.mutate((current) => current); // bootstraps + writes a genuine, checksummed v1 envelope
		expect(seeded.ok).toBe(true);

		const onDisk = JSON.parse(readFileSync(envelopePath(), "utf8")) as GateStateEnvelopeV1;
		// Checksum is computed over `state` alone (gate-state-store.ts's own computeStateChecksum) — it
		// stays genuinely valid across this edit because `state` itself is untouched, only
		// schemaVersion changes.
		const upgraded = { ...onDisk, schemaVersion: 2 };
		writeFileSync(envelopePath(), JSON.stringify(upgraded), "utf8");

		const reread = makeStore().read();

		expect(reread.ok).toBe(true);
	});
});

describe("GateStateEnvelope schema migration (ADR 0006 §7.3) — a v1 envelope carrying a populated groundingCitations is refused, never silently accepted", () => {
	it("returns could-not-verify for a schemaVersion:1 envelope whose state has a Decision.groundingCitations already populated — the 'impossible today' case a genuine v1 producer could never have written; FAILS today: nothing currently checks for this", () => {
		const store = makeStore();
		const seeded = store.mutate((current) => current);
		expect(seeded.ok).toBe(true);

		const onDisk = JSON.parse(readFileSync(envelopePath(), "utf8")) as GateStateEnvelopeV1;
		const taintedDecision: Decision = {
			gate: 5,
			kind: "decision",
			text: "a v1 file cannot legitimately carry this",
			method: "auto",
			groundingCitations: [sampleCitation()],
			recordedAt: "2026-08-06T00:00:00.000Z",
		};
		const taintedState = {
			...onDisk.state,
			gates: {
				...onDisk.state.gates,
				5: { ...onDisk.state.gates[5], decisions: [...onDisk.state.gates[5].decisions, taintedDecision] },
			},
		};
		const tampered: GateStateEnvelopeV1 = {
			...onDisk,
			state: taintedState,
			// Genuinely valid for the TAMPERED state — isolates this test to the schema-level defense
			// under test, never an incidental checksum mismatch masking it.
			checksum: checksumForTest(taintedState),
		};
		writeFileSync(envelopePath(), JSON.stringify(tampered), "utf8");

		const reread = makeStore().read();

		expect(reread.ok).toBe(false);
		if (reread.ok) return;
		expect(reread.error.kind).toBe("could-not-verify");
	});
});
