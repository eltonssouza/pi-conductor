/**
 * `conductor models` / `conductor models why <gate>` (ADR 0008 "Fase 7 -- model routing e provedores"
 * D8, §16 `runModelsList`/`runModelsWhy`; gate2-spec-fase7.md FR-12/FR-13, edge cases 1 and 8;
 * gate3-addendum-fase7.md T65/R46(ii), T73/R54, R50; secure-default 66 (S3)).
 *
 * Both functions are SYNCHRONOUS (ADR §16: `runModelsList(...): number`, `runModelsWhy(...): number`)
 * -- all I/O (policy/catalog/credential/availability) already happened at the border, building the
 * `ResolutionContext` snapshot this file only ever reads (D3's "I/O nas bordas, política no meio").
 *
 * **GATE 8 (validação FR-a-FR) loop-back para o Gate 6 — a reconciliação que o Gate 6 declarou
 * pendente e nunca fez.** O Gate 6 escreveu este arquivo enquanto `@conductor/providers` (o pacote
 * irmão que possui `ResolutionContext` e `resolveModelForGate`) ainda estava sendo construído em
 * paralelo, e por isso leu um placeholder: um campo `resolutions: ReadonlyMap<number, ModelResolution>`
 * projetado sobre `ctx` via cast, com o cabeçalho declarando "um item de reconciliação assim que
 * `@conductor/providers` aterrissar". **`@conductor/providers` aterrissou no MESMO commit** (Gate 6,
 * `cf80bdb1b`) e a reconciliação não aconteceu: o `ResolutionContext` real
 * (`resolution-context.ts`'s `buildResolutionContext`) devolve `{gateModelRoles, bindingsByRole,
 * catalog, untrustedBindings}` — **nunca um campo `resolutions`**. Consequência medida no Gate 8:
 * mesmo com um contexto real e correto, TODOS os 14 gates renderizavam "no resolution available" e
 * `models why` sempre devolvia 1 — FR-12/FR-13 insatisfeitas por código, não por teste.
 *
 * A correção é a chamada que a arquitetura do ADR sempre quis (§5/D3): `resolveModelForGate(request,
 * ctx)`, por gate, com `purpose: "report"` (§16 `ResolveModelRequest.purpose`) — a função é PURA e
 * NUNCA lança (R49(i)), então chamá-la 14× num comando de relatório não faz I/O nenhum e não pode
 * derrubar o comando. O import passa a ser de VALOR (não mais `import type`), o que é seguro e
 * correto: `@conductor/providers` já é `dependency` real de `@conductor/cli` (`package.json`).
 */

import type { ModelResolution, ResolutionContext, ResolutionRefusal, ResolutionStep } from "@conductor/providers";
import { resolveModelForGate } from "@conductor/providers";
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

/** The real pipeline (ADR §5/D3), per gate. `purpose: "report"` is §16's own value for exactly this
 * caller: a visibility command, never a work-authorization point (those are P1/P2/P3, D4 §6.1).
 * `resolveModelForGate` is pure and never throws (R49(i)) -- there is nothing here to guard. */
function resolutionFor(ctx: ResolutionContext, gate: number): ModelResolution {
	return resolveModelForGate({ gate, purpose: "report" }, ctx);
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

/**
 * D11/§21: did this gate resolve through the UNIVERSAL FALLBACK (the session's flat `provider.model`,
 * because the project declares no `ModelBinding` at all) rather than through a declared binding? Read
 * off the trace's own `bindings` step -- `declaredIn: "builtin-default"` is exactly the marker
 * `buildResolutionContext` stamps on the synthetic candidate, so this needs no second source of truth.
 */
function resolvedViaUniversalFallback(resolution: ModelResolution): boolean {
	const bindings = resolution.trace.steps.find(
		(step): step is Extract<ResolutionStep, { stage: "bindings" }> => step.stage === "bindings",
	);
	// `?? false`: a resolution with no `bindings` step at all is NOT a fallback resolution -- absence of
	// evidence must never read as evidence here, or a future refusal shape with a truncated trace would
	// silently start claiming compatibility mode.
	return bindings?.candidates.every((c) => c.declaredIn === "builtin-default") ?? false;
}

/** Whether every provider this resolution touched actually has a credential configured. In
 * compatibility mode the credential is deliberately NOT a filter (§21: opening a gate never called a
 * model), so this is the only place the fact still reaches the user -- reporting a model as resolved
 * while silently swallowing "you have no credential for it" would delete exactly the information the
 * caller needs (Managing Software Complexity §3.12, §21's own grounding). */
function hasCredential(resolution: ModelResolution): boolean {
	const credential = resolution.trace.steps.find(
		(step): step is Extract<ResolutionStep, { stage: "credential" }> => step.stage === "credential",
	);
	return (
		credential !== undefined && credential.perProvider.length > 0 && credential.perProvider.every((e) => e.configured)
	);
}

/** FR-12: a 14-gate table; edge case 1 (zero providers configured anywhere) gets an explicit
 * `conductor login` pointer, never a silently blank/empty table. */
export function runModelsList(options: RunModelsListOptions): number {
	const { io, ctx } = options;
	const rows: string[] = [];
	let anyResolved = false;
	let anyCredentialed = false;
	let allResolvedViaFallback = true;

	for (let gate = 1; gate <= TOTAL_FLOW_GATES; gate++) {
		const resolution = resolutionFor(ctx, gate);
		const label = `gate ${String(gate).padStart(2, "0")}`;
		if (resolution.resolved) {
			anyResolved = true;
			if (hasCredential(resolution)) anyCredentialed = true;
			if (!resolvedViaUniversalFallback(resolution)) allResolvedViaFallback = false;
			rows.push(`${label}: ${s(resolution.ref.provider)}/${s(resolution.ref.modelId)}`);
		} else {
			allResolvedViaFallback = false;
			rows.push(`${label}: refused -- ${formatRefusal(resolution.refusal)}`);
		}
	}

	// Edge case 1 (zero providers configured anywhere) survives D11 intact: compatibility mode makes a
	// gate RESOLVE without a credential, so "nothing resolved" is no longer the only way to be in that
	// state -- "nothing resolved to a credentialed provider" is. Keying the pointer off the credential
	// rather than off the resolution is what keeps the message honest in both modes.
	if (!anyResolved || !anyCredentialed) {
		io.stdout.write(
			"No provider is configured yet for any gate. Run `conductor login <provider>` to authenticate a model provider, then `conductor models` again.\n\n",
		);
	}
	if (anyResolved && allResolvedViaFallback) {
		io.stdout.write(
			"This project declares no `modelPolicy`, so every gate resolves to the session model from `provider.model` (ADR 0008 D11 compatibility mode). Add `modelPolicy.bindings` to .conductor/config.json to route gates per tier.\n\n",
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
