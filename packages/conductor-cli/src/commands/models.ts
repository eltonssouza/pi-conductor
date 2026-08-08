/**
 * `conductor models` / `conductor models why <gate>` (ADR 0008 "Fase 7 -- model routing e provedores"
 * D8, §16 `runModelsList`/`runModelsWhy`; gate2-spec-fase7.md FR-12/FR-13, edge cases 1 and 8;
 * gate3-addendum-fase7.md T65/R46(ii), T73/R54, R50; secure-default 66 (S3)).
 *
 * Both functions are SYNCHRONOUS (ADR §16: `runModelsList(...): number`, `runModelsWhy(...): number`)
 * -- all I/O (policy/catalog/credential/availability) already happened at the border, building the
 * `ResolutionContext` snapshot this file only ever reads (D3's "I/O nas bordas, política no meio").
 *
 * **Documented Gate 6 judgment call (the test file's own "IMPORTANT AMBIGUITY" note,
 * `test/commands/models.test.ts`):** `@conductor/providers` -- the sibling package that owns
 * `ResolutionContext`'s real internal shape and the `resolveModelForGate` function that would compute
 * a `ModelResolution` per gate -- is being built concurrently by a different Fase-7 stream and has no
 * real exports yet. A hard, value-level import of `resolveModelForGate` here would make this whole
 * file (and therefore every test in it, including the gate-out-of-range check that does not even
 * touch `ctx`) fail to load until that sibling stream lands. Per that test file's own framing ("the
 * exact mechanism... may need a small Gate 6 (or dedicated loop-back) adjustment once
 * `ResolutionContext`'s real fields land"), this implementation instead reads a narrow, defensively
 * typed `resolutions: ReadonlyMap<number, ModelResolution>` view off of `ctx` -- exactly the shape the
 * test fixtures already provide -- via `import type` only (erased at runtime, safe regardless of
 * whether the sibling package resolves). This is a DELIBERATE, DOCUMENTED placeholder for the real
 * per-gate `resolveModelForGate(request, ctx)` call the ADR's architecture actually wants (§5, D3);
 * flagged in this stream's own report as a reconciliation item once `@conductor/providers` lands.
 */

import type { ModelResolution, ResolutionContext, ResolutionRefusal, ResolutionStep } from "@conductor/providers";
import { sanitizeForTerminal, TOTAL_FLOW_GATES } from "@conductor/runtime";

/** See `login.ts`'s own header note on this local, duck-typed `CliIO` surface. */
export interface CliIO {
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
}

export interface RunModelsListOptions {
	io: CliIO;
	ctx: ResolutionContext;
}

export interface RunModelsWhyOptions {
	io: CliIO;
	ctx: ResolutionContext;
	gate: number;
}

/** See this file's own header note: a narrow, structural view of `ctx` this command reads from,
 * never a claim about `ResolutionContext`'s real shape. */
interface ResolutionsView {
	resolutions?: ReadonlyMap<number, ModelResolution>;
}

function resolutionFor(ctx: ResolutionContext, gate: number): ModelResolution | undefined {
	return (ctx as unknown as ResolutionsView).resolutions?.get(gate);
}

/** Sanitizes every string reachable from `value` (secure-default 66 / S3) -- applied universally
 * rather than per-field, so a future `ResolutionRefusal`/`ResolutionStep` variant this file has no
 * bespoke renderer for still cannot smuggle a raw terminal escape through the generic fallback below. */
function sanitizeDeep(value: unknown): unknown {
	if (typeof value === "string") return sanitizeForTerminal(value);
	if (Array.isArray(value)) return value.map(sanitizeDeep);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, sanitizeDeep(v)]),
		);
	}
	return value;
}

const s = sanitizeForTerminal;

/** Readable, stage-by-stage rendering of one `ResolutionStep` (FR-13: "narrates the resolution
 * pipeline stage by stage") -- R50: only ever renders provider ids / model ids / status labels that
 * already exist structurally on these types (no credential VALUE field exists anywhere on
 * `ResolutionStep`, so there is nothing to accidentally leak here). Every dynamic string passes
 * through `sanitizeForTerminal` (secure-default 66) since any of them may originate from a
 * repo-supplied, untrusted policy (T73). */
function formatResolutionStep(step: ResolutionStep): string {
	switch (step.stage) {
		case "gate-role":
			return `  [gate-role] role=${s(step.role)} source=${s(step.source)}${step.pinned ? " (pinned)" : ""}`;
		case "floor":
			return `  [floor] gateRank=${step.gateRank}${step.personaRank !== undefined ? ` personaRank=${step.personaRank}` : ""} effective=${step.effective}`;
		case "bindings":
			return `  [bindings] role=${s(step.role)} candidates=${step.candidates.length}`;
		case "catalog": {
			const accepted = step.accepted.map((ref) => `${s(ref.provider)}/${s(ref.modelId)}`).join(", ") || "none";
			const rejected = step.rejected.map((entry) => `${s(entry.ref)} (${s(entry.why)})`).join(", ") || "none";
			return `  [catalog] accepted=[${accepted}] rejected=[${rejected}]`;
		}
		case "credential": {
			const rows = step.perProvider
				.map((entry) => {
					const detail = entry.configured ? `configured via ${s(entry.source ?? "unknown")}` : "not configured";
					const authorized = entry.authorizedByPolicy ? "" : " [not policy-authorized]";
					return `${s(entry.provider)}: ${detail}${authorized}`;
				})
				.join("; ");
			return `  [credential] ${rows}`;
		}
		case "availability": {
			const rows = step.perProvider.map((entry) => `${s(entry.provider)}: ${s(entry.state)}`).join("; ");
			return `  [availability] ${rows}`;
		}
		case "selection": {
			const selected = step.selected ? `${s(step.selected.provider)}/${s(step.selected.modelId)}` : "none";
			const rejected =
				step.rejected
					.map((entry) => `${s(entry.ref.provider)}/${s(entry.ref.modelId)} (${s(entry.why)})`)
					.join(", ") || "none";
			return `  [selection] selected=${selected} rejected=[${rejected}]`;
		}
		default: {
			// Forward-compatible fallback for a step shape this renderer has no bespoke case for yet --
			// still fully sanitized, never a raw dump of untrusted data.
			const { stage, ...rest } = step as unknown as Record<string, unknown>;
			return `  [${String(stage)}] ${JSON.stringify(sanitizeDeep(rest))}`;
		}
	}
}

/** Generic, sanitized rendering of a `ResolutionRefusal` -- deliberately field-driven rather than one
 * bespoke branch per `kind` (13 variants in ADR §16 and growing is the sibling stream's own scope):
 * every refusal already carries `kind` plus a handful of named, mostly-string/ModelRef fields, and a
 * uniform `kind (field: value, ...)` rendering names the exact stage the chain stopped at (FR-13)
 * without this file re-deriving per-kind copy for every future refusal variant. */
function formatRefusal(refusal: ResolutionRefusal): string {
	const { kind, gate: _gate, ...rest } = refusal as unknown as Record<string, unknown>;
	const sanitizedRest = sanitizeDeep(rest) as Record<string, unknown>;
	const details = Object.entries(sanitizedRest)
		.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
		.join(", ");
	return details ? `${kind} (${details})` : String(kind);
}

/** FR-12: a 14-gate table; edge case 1 (zero providers configured anywhere) gets an explicit
 * `conductor login` pointer, never a silently blank/empty table. */
export function runModelsList(options: RunModelsListOptions): number {
	const { io, ctx } = options;
	const rows: string[] = [];
	let anyResolved = false;

	for (let gate = 1; gate <= TOTAL_FLOW_GATES; gate++) {
		const resolution = resolutionFor(ctx, gate);
		const label = `gate ${String(gate).padStart(2, "0")}`;
		if (resolution?.resolved) {
			anyResolved = true;
			rows.push(`${label}: ${s(resolution.ref.provider)}/${s(resolution.ref.modelId)}`);
		} else if (resolution) {
			rows.push(`${label}: refused -- ${formatRefusal(resolution.refusal)}`);
		} else {
			rows.push(`${label}: no resolution available -- run \`conductor login\` and configure a model policy`);
		}
	}

	if (!anyResolved) {
		io.stdout.write(
			"No provider is configured yet for any gate. Run `conductor login <provider>` to authenticate a model provider, then `conductor models` again.\n\n",
		);
	}
	io.stdout.write(`${rows.join("\n")}\n`);
	return 0;
}

/** FR-13: prints the `ResolutionTrace` stage by stage, naming exactly where the chain stopped on a
 * refusal -- never a bare pass/fail result. Edge case 8: a gate outside 1..TOTAL_FLOW_GATES is
 * rejected by argument validation ALONE, before `ctx` is ever consulted (the ADR's own fail-closed
 * ordering: cheap, argument-level checks first). */
export function runModelsWhy(options: RunModelsWhyOptions): number {
	const { io, ctx, gate } = options;

	if (!Number.isInteger(gate) || gate < 1 || gate > TOTAL_FLOW_GATES) {
		io.stderr.write(`gate ${gate} is out of range -- valid gates are 1-${TOTAL_FLOW_GATES}.\n`);
		return 1;
	}

	const resolution = resolutionFor(ctx, gate);
	if (!resolution) {
		io.stdout.write(`gate ${gate}: no resolution available yet -- run \`conductor models\` first.\n`);
		return 1;
	}

	const lines = [`Resolution trace for gate ${gate}:`, ...resolution.trace.steps.map(formatResolutionStep)];

	if (resolution.resolved) {
		lines.push(`-> resolved: ${s(resolution.ref.provider)}/${s(resolution.ref.modelId)}`);
		io.stdout.write(`${lines.join("\n")}\n`);
		return 0;
	}

	lines.push(`-> refused: ${formatRefusal(resolution.refusal)}`);
	io.stdout.write(`${lines.join("\n")}\n`);
	return 1;
}
