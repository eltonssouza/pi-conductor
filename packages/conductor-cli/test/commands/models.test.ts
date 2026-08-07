/**
 * Gate 5 RED -- `conductor models` / `conductor models why <gate>` (ADR 0008 D8, §16 `runModelsList`/
 * `runModelsWhy`; gate2-spec-fase7.md FR-12/FR-13, edge cases 1 and 8; gate3-addendum-fase7.md
 * T65/R46(ii) and T73/R54 no-credential/no-raw-endpoint leakage, R50; secure-default 66 (S3)).
 *
 * `runModelsList`/`runModelsWhy` do not exist yet (`../../src/commands/models.ts`) -- the static import
 * below makes THIS WHOLE FILE fail to load ("Cannot find module") until Gate 6 creates it. That
 * module-resolution failure IS the RED signal for every test below; once Gate 6 exists, each test's own
 * body is the real spec.
 *
 * IMPORTANT AMBIGUITY, flagged for the orchestrator/Gate 6 (not something this stream can resolve): ADR
 * 0008 §16 fully specifies `ModelResolution`/`ResolutionRefusal`/`ResolutionTrace`/`ResolutionStep`'s
 * shapes, but NOT `ResolutionContext`'s own internal fields -- only `buildResolutionContext(options):
 * Promise<ResolutionContext>`'s INPUT shape is given, and `@conductor/providers` (the sibling package
 * that owns this type) is being built in parallel by a different stream with no real exports yet. The
 * tests below that need a `ctx` therefore use `fixtureContext()`, a deliberately opaque placeholder cast
 * via `as unknown as ResolutionContext` -- NOT a claim about the real shape. The edge-case-8 test (gate
 * number out of range) needs no such fixture -- that check should run before `ctx` is ever consulted, so
 * it is written with full confidence. The other three ctx-dependent tests document the DESIRED rendered
 * OUTPUT precisely (which is what matters for the spec), but the exact mechanism for making a fixture
 * drive that output may need a small Gate 6 (or a dedicated Gate 6 loop-back) adjustment once
 * `ResolutionContext`'s real fields land -- documented here so that is expected, not a surprise.
 */

import type {
	ModelResolution,
	ResolutionContext,
	ResolutionRefusal,
	ResolutionStep,
	ResolutionTrace,
} from "@conductor/providers";
import { sanitizeForTerminal } from "@conductor/runtime";
import { describe, expect, it } from "vitest";
import { runModelsList, runModelsWhy } from "../../src/commands/models.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject } from "../support/scratch.ts";

/** See the file header's "IMPORTANT AMBIGUITY" note. */
function fixtureContext(seed: Record<string, unknown> = {}): ResolutionContext {
	return seed as unknown as ResolutionContext;
}

function traceFor(gate: number, steps: readonly ResolutionStep[]): ResolutionTrace {
	return { gate, at: "2026-08-07T00:00:00.000Z", steps };
}

describe("runModelsWhy <gate> -- edge case 8, a gate number outside 1-14 refuses naming the valid range", () => {
	it("never touches ctx and names the valid range, instead of a generic/unlabeled error", () => {
		const project = createScratchProject();
		try {
			const { io, stdout, stderr } = createCapturingIo(project.root);

			// ctx is intentionally `undefined` here: an out-of-range gate must be rejected by argument
			// validation ALONE, before any resolution context is ever consulted -- the one ctx-dependent
			// test in this file that needs no fixture and no ambiguity caveat.
			const code = runModelsWhy({ io, ctx: undefined as unknown as ResolutionContext, gate: 15 });

			expect(code).not.toBe(0);
			const output = stdout() + stderr();
			expect(output).toMatch(/15/);
			expect(output).toMatch(/1.*14|1-14|1 to 14/);
		} finally {
			project.cleanup();
		}
	});

	it("also refuses gate 0, the same way", () => {
		const project = createScratchProject();
		try {
			const { io, stdout, stderr } = createCapturingIo(project.root);
			const code = runModelsWhy({ io, ctx: undefined as unknown as ResolutionContext, gate: 0 });
			expect(code).not.toBe(0);
			expect(stdout() + stderr()).toMatch(/0/);
		} finally {
			project.cleanup();
		}
	});
});

describe("runModelsList -- FR-12, a 14-gate table; edge case 1, zero providers configured", () => {
	it("reports an explicit 'run conductor login' message, never a blank/empty table", () => {
		const project = createScratchProject();
		try {
			const { io, stdout } = createCapturingIo(project.root);

			const code = runModelsList({ io, ctx: fixtureContext() });

			expect(code).toBe(0);
			expect(stdout().trim().length).toBeGreaterThan(0);
			expect(stdout()).toMatch(/conductor login/);
		} finally {
			project.cleanup();
		}
	});
});

describe("runModelsWhy <gate> -- FR-13, narrates the resolution pipeline stage by stage", () => {
	it("prints the resolved model when the pipeline succeeds", () => {
		const project = createScratchProject();
		try {
			// Cast the whole literal rather than hand-authoring a full, valid `Model<Api>` (a large vendor
			// type with many required fields, e.g. cost/contextWindow/maxTokens -- see fake-model.ts) --
			// this fixture only needs `ref` (what `runModelsWhy` actually renders per §16) to exercise the
			// assertions below; `model` is filled with the minimum shape a renderer would plausibly touch.
			const resolved = {
				resolved: true,
				model: { provider: "anthropic", id: "claude-opus-4-8" },
				ref: { provider: "anthropic", modelId: "claude-opus-4-8" },
				effectiveRank: 3,
				trace: traceFor(9, [
					{ stage: "gate-role", role: "slow", source: "builtin" },
					{ stage: "floor", gateRank: 3, effective: 3 },
					{
						stage: "selection",
						selected: { provider: "anthropic", modelId: "claude-opus-4-8" },
						rejected: [],
					},
				]),
			} as unknown as ModelResolution;
			const { io, stdout } = createCapturingIo(project.root);

			const code = runModelsWhy({ io, ctx: fixtureContext({ resolutions: new Map([[9, resolved]]) }), gate: 9 });

			expect(code).toBe(0);
			expect(stdout()).toMatch(/anthropic/);
			expect(stdout()).toMatch(/claude-opus-4-8/);
		} finally {
			project.cleanup();
		}
	});

	it("names the exact stage where the chain stopped when refused, never just a bare result", () => {
		const project = createScratchProject();
		try {
			const refusal: ResolutionRefusal = { kind: "no-binding-for-role", gate: 9, role: "slow" };
			const refused: ModelResolution = {
				resolved: false,
				refusal,
				trace: traceFor(9, [
					{ stage: "gate-role", role: "slow", source: "builtin" },
					{ stage: "bindings", role: "slow", candidates: [] },
				]),
			};
			const { io, stdout } = createCapturingIo(project.root);

			const code = runModelsWhy({ io, ctx: fixtureContext({ resolutions: new Map([[9, refused]]) }), gate: 9 });

			expect(code).not.toBe(0);
			expect(stdout()).toMatch(/no-binding-for-role|no binding/i);
			expect(stdout()).toMatch(/slow/);
		} finally {
			project.cleanup();
		}
	});
});

describe("runModelsWhy <gate> -- R50, never prints raw credential material, only provider id + source", () => {
	it("omits any credential/key-shaped value from a credential-stage trace", () => {
		const project = createScratchProject();
		try {
			const refusal: ResolutionRefusal = { kind: "no-credential", gate: 9, role: "slow", providers: ["anthropic"] };
			const refused: ModelResolution = {
				resolved: false,
				refusal,
				trace: traceFor(9, [
					{
						stage: "credential",
						perProvider: [{ provider: "anthropic", configured: false, authorizedByPolicy: false }],
					},
				]),
			};
			const { io, stdout } = createCapturingIo(project.root);

			runModelsWhy({ io, ctx: fixtureContext({ resolutions: new Map([[9, refused]]) }), gate: 9 });

			expect(stdout()).toMatch(/anthropic/);
			expect(stdout()).not.toMatch(/sk-[a-zA-Z0-9-]{10,}/); // no api-key-shaped token ever, by construction
		} finally {
			project.cleanup();
		}
	});
});

describe("runModelsWhy <gate> -- secure-default 66 (S3), a hostile provider/host string is sanitized before it reaches the terminal", () => {
	it("never writes a raw ESC (\\x1b) byte from an untrusted-endpoint refusal's provider/host fields", () => {
		const project = createScratchProject();
		try {
			// T73: a repo-supplied policy can name a hostile `baseUrl`/provider -- the refusal's own
			// `provider`/`host` fields are therefore untrusted, model-adjacent text, the same taint class
			// terminal-sanitize.ts's own header already treats as DATA never markup (T14, inherited from
			// Fase 1's confirm-prompt sink; here the sink is `runModelsWhy`'s own stdout render, a DIFFERENT
			// sink than `confirmOrDeny()`'s -- confirmOrDeny already sanitizes unconditionally at ITS OWN
			// sink, but that does not cover this one; verified by reading confirm.ts before writing this
			// test, see this stream's report).
			const hostileHost = "evil\x1b[2Jhost.example.com";
			const hostileProvider = "evil\x1b[31mprovider";
			const refusal: ResolutionRefusal = {
				kind: "untrusted-endpoint",
				gate: 9,
				provider: hostileProvider,
				host: hostileHost,
			};
			const refused: ModelResolution = {
				resolved: false,
				refusal,
				trace: traceFor(9, [
					{
						stage: "catalog",
						accepted: [],
						rejected: [{ ref: `${hostileProvider}/some-model`, why: "untrusted-endpoint" }],
					},
				]),
			};
			const { io, stdout } = createCapturingIo(project.root);

			runModelsWhy({ io, ctx: fixtureContext({ resolutions: new Map([[9, refused]]) }), gate: 9 });

			const output = stdout();
			expect(output).not.toContain("\x1b");
			// The sanitized text must still be present -- this is redaction of CONTROL BYTES, never a
			// blanket redaction of the whole field (a project author still needs to see which host was
			// rejected).
			expect(output).toContain(sanitizeForTerminal(hostileHost));
			expect(output).toContain(sanitizeForTerminal(hostileProvider));
		} finally {
			project.cleanup();
		}
	});
});
