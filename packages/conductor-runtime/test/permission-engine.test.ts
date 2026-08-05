/**
 * Test-first (Gate 5) for the Permission Engine — the PDP half of the ADR 0003 §2 PDP/PEP split
 * (Gate 2 spec Grupo B/F/G: FR-2, FR-6, FR-7, FR-8, FR-19..24; ADR 0003 §2/§4; gate3-addendum-fase2.md
 * T17, T23, T24, T27, R1, R5, R8, R10).
 *
 * `resolvePermissionLevel`, `decide`, and `isYesEligible` are STUBS that throw for every input (see
 * src/permission-engine.ts) — every test below is RED until Gate 6 builds the real decision table.
 *
 * The `isYesEligible` suite is deliberately an exhaustive negative-case matrix, not a single
 * happy-path example: the orchestrator's requirement is that --yes bypassing a protected-path/
 * critical decision be STRUCTURALLY impossible, so the test has to try every plausible way to
 * trick the predicate into `true`, not just document the intended rule (Unit Testing Principles —
 * Complete Professional Guide §2.9, "cover behavior and its failure paths, not mechanics" —
 * grounded via `cdt library "testing an invariant across many constructed variations..." --gate 5`,
 * run from C:\development\source\projects\conductor, top 0.629).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClassificationResult } from "../src/command-classifier.ts";
import type { PolicyDecision } from "../src/fail-closed.ts";
import {
	decide,
	isYesEligible,
	type PermissionEngineOptions,
	type PermissionLevel,
	resolvePermissionLevel,
} from "../src/permission-engine.ts";
import { evaluateToolPath } from "../src/workspace-policy.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
	mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
});

afterEach(() => {
	workspace.cleanup();
});

describe("resolvePermissionLevel: FR-22/BR-2/R10/T27 — fail-closed level resolution (requirement #5)", () => {
	it("maps 'read' to the 'read' level", () => {
		expect(resolvePermissionLevel("read")).toBe("read");
	});

	it("maps 'write' to the 'write' level", () => {
		expect(resolvePermissionLevel("write")).toBe("write");
	});

	it("maps 'edit' to the 'write' level (same containment discipline as write)", () => {
		expect(resolvePermissionLevel("edit")).toBe("write");
	});

	it("maps 'bash' to the 'exec' level", () => {
		expect(resolvePermissionLevel("bash")).toBe("exec");
	});

	it("an unrecognized tool name resolves to 'security' — the level of GREATEST scrutiny, never a permissive default", () => {
		expect(resolvePermissionLevel("some_never_registered_tool_xyz")).toBe("security");
	});

	it("an empty tool name resolves to 'security', not to undefined-treated-as-permissive", () => {
		expect(resolvePermissionLevel("")).toBe("security");
	});

	it("is case-sensitive — a near-miss like 'READ' is NOT silently coerced to the permissive 'read' level", () => {
		expect(resolvePermissionLevel("READ")).toBe("security");
	});
});

describe("decide: FR-22/BR-2 — a tool with no declared policy is denied, never given silent allow or approval", () => {
	it("denies an unrecognized tool outright, with a 'no policy declared' reason, resolved at the 'security' level", () => {
		const options: PermissionEngineOptions = { workspace: { workspaceRoot: workspace.root }, yesFlagActive: false };
		const result = decide("some_never_registered_tool_xyz", {}, options);
		expect(result.outcome.kind).toBe("deny");
		expect((result.outcome as { kind: "deny"; reason: string }).reason).toMatch(/no policy declared/);
		expect(result.permissionLevel).toBe("security");
	});

	it("never grants approval-only (needs-approval) or allow to an undeclared tool", () => {
		const options: PermissionEngineOptions = { workspace: { workspaceRoot: workspace.root }, yesFlagActive: false };
		const result = decide("some_never_registered_tool_xyz", {}, options);
		expect(result.outcome.kind).not.toBe("needs-approval");
		expect(result.outcome.kind).not.toBe("allow");
	});
});

describe("decide: BR-8/T23/T24 — a 'critical' tier bash command has NO approval path, human-available-or-not, --yes-or-not", () => {
	it("denies a known-catastrophic bash command outright (never needs-approval)", () => {
		const options: PermissionEngineOptions = { workspace: { workspaceRoot: workspace.root }, yesFlagActive: false };
		const result = decide("bash", { command: "rm -rf /" }, options);
		expect(result.outcome.kind).toBe("deny");
	});

	it("denies the same command even with --yes active — critical never has an approval path for --yes to skip", () => {
		const options: PermissionEngineOptions = { workspace: { workspaceRoot: workspace.root }, yesFlagActive: true };
		const result = decide("bash", { command: "rm -rf /" }, options);
		expect(result.outcome.kind).toBe("deny");
	});

	it("denies a bash command targeting a protected path outright, even with --yes active (T23/T24 closed at the engine level)", () => {
		const options: PermissionEngineOptions = { workspace: { workspaceRoot: workspace.root }, yesFlagActive: true };
		const result = decide("bash", { command: "rm .conductor/policy.json" }, options);
		expect(result.outcome.kind).toBe("deny");
	});
});

describe("decide: FR-6/FR-7/FR-8/R5 — Network level is default-deny except an explicitly consented destination", () => {
	// The concrete tool name/call-site for a non-tool-call network check (e.g. `conductor doctor`'s
	// Library-backend ping, FR-8) is Gate 6 wiring; `permissionLevelOverride` is the seam this Gate-5
	// stream defines so the decision contract itself can be pinned now (see permission-engine.ts doc).

	it("FR-6: denies a network operation to an unconsented destination", () => {
		const options: PermissionEngineOptions = {
			workspace: { workspaceRoot: workspace.root },
			yesFlagActive: false,
			permissionLevelOverride: "network",
			networkDestination: "library.internal:8080",
			policy: {},
		};
		const result = decide("doctor_library_ping", { destination: "library.internal:8080" }, options);
		expect(result.outcome.kind).toBe("deny");
		expect((result.outcome as { kind: "deny"; reason: string }).reason).toMatch(/network destination/);
		expect(result.permissionLevel).toBe("network");
	});

	it("FR-8: the doctor's Library-backend ping goes through the SAME default-deny rule — it is not an exempt legacy special case (the exact state Fase 1 shipped, ADR 0002 §7.2 item 4)", () => {
		const options: PermissionEngineOptions = {
			workspace: { workspaceRoot: workspace.root },
			yesFlagActive: false,
			permissionLevelOverride: "network",
			networkDestination: "library.internal:8080",
			// No policy.network entry at all — nothing has ever consented to this destination.
		};
		const result = decide("doctor_library_ping", { destination: "library.internal:8080" }, options);
		expect(result.outcome.kind).toBe("deny");
	});

	it("FR-7: allows a network operation to an explicitly consented destination", () => {
		const options: PermissionEngineOptions = {
			workspace: { workspaceRoot: workspace.root },
			yesFlagActive: false,
			permissionLevelOverride: "network",
			networkDestination: "library.internal:8080",
			policy: { network: [{ destination: "library.internal:8080" }] },
		};
		const result = decide("doctor_library_ping", { destination: "library.internal:8080" }, options);
		expect(result.outcome.kind).toBe("allow");
	});

	it("BR-10/R5: consent is per-destination — a policy consenting a DIFFERENT destination does not cover the one actually requested", () => {
		const options: PermissionEngineOptions = {
			workspace: { workspaceRoot: workspace.root },
			yesFlagActive: false,
			permissionLevelOverride: "network",
			networkDestination: "evil.example:443",
			policy: { network: [{ destination: "library.internal:8080" }] },
		};
		const result = decide("doctor_library_ping", { destination: "evil.example:443" }, options);
		expect(result.outcome.kind).toBe("deny");
	});

	it("BR-3/R5: --yes never substitutes for network consent", () => {
		const options: PermissionEngineOptions = {
			workspace: { workspaceRoot: workspace.root },
			yesFlagActive: true,
			permissionLevelOverride: "network",
			networkDestination: "evil.example:443",
			policy: {},
		};
		const result = decide("doctor_library_ping", { destination: "evil.example:443" }, options);
		expect(result.outcome.kind).toBe("deny");
	});
});

describe("isYesEligible: R8/T24 — structural impossibility of --yes reaching a protected path or a 'critical' tier (requirement #4)", () => {
	function safeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
		return {
			tier: "low",
			signals: [],
			provablyContained: true,
			hasUnanalyzableSpan: false,
			displayCommand: "ls -la",
			...overrides,
		};
	}

	const safeBaseDecision: PolicyDecision = { block: false };
	const safeLevel: PermissionLevel = "write";
	const safeNetworkConsented = true;

	it("positive control: the fully-proven-safe case IS yes-eligible (proves the predicate isn't trivially 'always false')", () => {
		expect(isYesEligible(safeClassification(), safeBaseDecision, safeLevel, safeNetworkConsented)).toBe(true);
	});

	type Attempt = [ClassificationResult, PolicyDecision, PermissionLevel, boolean];

	const attempts: Array<{ name: string; build: () => Attempt }> = [
		{
			name: "prong 1 — base decision is an outright DENY over a REAL protected-path verdict (the orchestrator's exact scenario)",
			build: () => {
				const denyOverProtectedPath = evaluateToolPath(join(".conductor", "policy.json"), {
					workspaceRoot: workspace.root,
				});
				const baseDecision: PolicyDecision = { block: true, reason: denyOverProtectedPath.reason };
				return [safeClassification(), baseDecision, safeLevel, safeNetworkConsented];
			},
		},
		{
			name: "prong 1 — base decision is DENY even though every classification field looks perfectly safe",
			build: () => [
				safeClassification(),
				{ block: true, reason: "denied by policy" },
				safeLevel,
				safeNetworkConsented,
			],
		},
		{
			name: "prong 2 — permission level is 'security'",
			build: () => [safeClassification(), safeBaseDecision, "security", safeNetworkConsented],
		},
		{
			name: "prong 3 — level is 'network' and the destination is NOT consented",
			build: () => [safeClassification(), safeBaseDecision, "network", false],
		},
		{
			name: "prong 4 — classification tier is 'high'",
			build: () => [safeClassification({ tier: "high" }), safeBaseDecision, safeLevel, safeNetworkConsented],
		},
		{
			name: "prong 4 — classification tier is 'critical' (BR-8: must NEVER be --yes-approvable)",
			build: () => [safeClassification({ tier: "critical" }), safeBaseDecision, safeLevel, safeNetworkConsented],
		},
		{
			name: "prong 5 — provablyContained is false (absence of a raised flag is not proof of safety)",
			build: () => [
				safeClassification({ provablyContained: false }),
				safeBaseDecision,
				safeLevel,
				safeNetworkConsented,
			],
		},
		{
			name: "prong 5 — provablyContained is false even though tier claims 'low'",
			build: () => [
				safeClassification({ tier: "low", provablyContained: false }),
				safeBaseDecision,
				safeLevel,
				safeNetworkConsented,
			],
		},
		{
			name: "prong 6 — hasUnanalyzableSpan is true, even with tier 'low' and provablyContained true",
			build: () => [
				safeClassification({ tier: "low", provablyContained: true, hasUnanalyzableSpan: true }),
				safeBaseDecision,
				safeLevel,
				safeNetworkConsented,
			],
		},
		{
			name: "combined attack — tier 'critical' AND provablyContained forced true (an internally contradictory, attacker-shaped result) must still be ineligible",
			build: () => [
				safeClassification({ tier: "critical", provablyContained: true, hasUnanalyzableSpan: false }),
				safeBaseDecision,
				safeLevel,
				safeNetworkConsented,
			],
		},
		{
			name: "combined attack — DENY base decision AND every classification field forged to look maximally safe",
			build: () => [
				safeClassification({ tier: "low", provablyContained: true, hasUnanalyzableSpan: false }),
				{ block: true, reason: '"..." resolves into a protected location' },
				"write",
				true,
			],
		},
		{
			name: "combined attack — network level, consented, but tier is 'critical' (consent must not override the tier ceiling)",
			build: () => [safeClassification({ tier: "critical" }), safeBaseDecision, "network", true],
		},
	];

	it.each(attempts)("$name -> NOT eligible", ({ build }) => {
		const [result, baseDecision, level, networkConsented] = build();
		expect(isYesEligible(result, baseDecision, level, networkConsented)).toBe(false);
	});
});
