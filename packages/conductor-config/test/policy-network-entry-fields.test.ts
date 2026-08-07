/**
 * Test-first (Gate 5, Fase 5) for D10's `PolicyNetworkEntry` extension (ADR 0006 §13.2/§19,
 * `docs/adr/0006-fase5-library-and-grounding.md`): `scheme`/`port`/`allowPlaintext`/
 * `allowPrivateAddress`, so a future SSRF guard (`@conductor/library`'s `connectRemote`) has enough
 * information at connection time — "validar a STRING destination no momento em que o grant é
 * concedido não defende contra nada que importe" (ADR §13.2).
 *
 * `loadPolicyDocument`/`validatePolicyDocument`/`isValidNetwork` are ALREADY fully implemented (Fase 2
 * Gate 6 landed) — these tests target a REAL, still-open gap in that already-shipped validation:
 * `isValidNetwork` (policy-loader.ts) checks ONLY that `destination` is a string today, so a network
 * entry carrying an out-of-enum `scheme`, a malformed `port`, or a non-boolean flag is silently
 * ACCEPTED as `status: "loaded"` instead of being refused as `status: "invalid"`. Every test below
 * fails RED for that reason, not because a function throws "not implemented".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicyDocument } from "../src/policy-loader.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

function policyPath(): string {
	return join(workspace.root, ".conductor", "policy.json");
}

function writePolicyFile(raw: string): void {
	mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
	writeFileSync(policyPath(), raw);
}

describe("PolicyNetworkEntry gains scheme/port/allowPlaintext/allowPrivateAddress (D10, ADR 0006 §13.2/§19)", () => {
	it('rejects a network entry with an out-of-enum scheme (only "https"/"http" are valid) — FAILS today: isValidNetwork only checks `destination`, so an invalid scheme is silently accepted as loaded', () => {
		writePolicyFile(JSON.stringify({ schema: 1, network: [{ destination: "library.internal", scheme: "ftp" }] }));
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
	});

	it("rejects a network entry whose port is not a positive integer in the valid TCP range", () => {
		writePolicyFile(JSON.stringify({ schema: 1, network: [{ destination: "library.internal", port: -1 }] }));
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
	});

	it("rejects a network entry whose port is not even a number (a numeric string masquerading as one)", () => {
		writePolicyFile(JSON.stringify({ schema: 1, network: [{ destination: "library.internal", port: "8080" }] }));
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
	});

	it("rejects a non-boolean allowPlaintext", () => {
		writePolicyFile(
			JSON.stringify({ schema: 1, network: [{ destination: "library.internal", allowPlaintext: "yes" }] }),
		);
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
	});

	it("rejects a non-boolean allowPrivateAddress", () => {
		writePolicyFile(
			JSON.stringify({ schema: 1, network: [{ destination: "library.internal", allowPrivateAddress: 1 }] }),
		);
		const result = loadPolicyDocument(policyPath());
		expect(result.status).toBe("invalid");
	});
});
