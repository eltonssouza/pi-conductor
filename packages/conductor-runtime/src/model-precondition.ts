/**
 * Fase 7 ("Model routing e provedores") D4 — the model-authorization pre-condition composed BESIDE
 * `evaluateAdvance` (gate-state-policy.ts) at the gate-start authorization point (P1), never merged
 * into it (docs/adr/0008-fase7-model-routing-and-providers.md §6 "D4 — recusa fail-closed: três
 * pontos de imposição, zero mudança na máquina de gates"; §16 appendix, the locked contract this
 * file implements). `GateAdvanceVerdict` (ADR 0005 §18, gate-state-policy.ts:45-48) stays exactly
 * what Fase 4 shipped — this module never adds a variant to it. Quoted verbatim from the ADR's own
 * §6.2: "gate-state-policy.ts não muda... A pré-condição de modelo é uma SEGUNDA verificação,
 * independente e composta, com verdict próprio (ModelPreconditionVerdict) — nunca um valor novo em
 * GateAdvanceVerdict." `test/model-precondition-composition-guard.test.ts` is the regression
 * tripwire that proves this stays true.
 *
 * `@conductor/providers` (the resolution engine, D2 §4) is imported TYPE-ONLY — this package
 * (`@conductor/runtime`) declares only the PORT (`ModelResolutionPort`) it consumes, never the
 * adapter/implementation (ADR §16 "@conductor/runtime — a PORTA (nenhuma implementação, nenhum
 * import do adapter)"; `package.json`'s own `@conductor/providers` devDependency entry signals
 * exactly this: type-only usage, never a real bundling/runtime dependency — the same port+adapter
 * rule ADR 0006 D8 already established for `@conductor/library`). A plain `import type` compiles to
 * nothing at runtime, so this file is safe to import and test even before the sibling stream's
 * `@conductor/providers/src/index.ts` lands.
 */

// Type-only per D2/§16 — see this file's own header. Never a value import: `@conductor/providers`
// stays a devDependency in package.json, never a real dependency.
import type { ModelResolution, ResolutionRefusal, ResolveModelRequest } from "@conductor/providers";

/** The one and only collaborator this module calls (ADR §16 appendix). No implementation lives
 * here — the CLI composition root injects the real adapter (`@conductor/providers`'s engine),
 * exactly as `@conductor/library`'s own port/adapter split already works (ADR 0006 D8). */
export interface ModelResolutionPort {
	resolveForGate(request: ResolveModelRequest): ModelResolution;
}

/**
 * A SEPARATE, composed verdict (ADR §16) — deliberately NOT a member of `GateAdvanceVerdict`'s union
 * (`"approved" | "refused" | "could-not-verify"`, gate-state-policy.ts:45-48). Its two `kind` values
 * (`"satisfied"`/`"refused"`) are chosen to be textually distinguishable from every one of
 * `GateAdvanceVerdict`'s own kinds, so the two verdict families can never be confused by a reader or
 * accidentally collapsed into one union by a future edit.
 */
export type ModelPreconditionVerdict =
	| { kind: "satisfied"; provider: string; modelId: string }
	| { kind: "refused"; refusal: ResolutionRefusal; humanReadable: string };

/**
 * ADR 0005 §18 / gate3-addendum-fase4.md T42 (`@conductor/config`'s `builtin-roles-data.ts:305`,
 * `MANDATORY_GATES = new Set([3, 5, 7, 8, 9])`). Duplicated here as a documented LITERAL, never
 * imported — this package deliberately carries ZERO dependency on `@conductor/config` (ADR 0002
 * §3.1's dependency-direction invariant, restated at `builtin-roles-data.ts:298-303`'s own doc
 * comment and confirmed still true this session: `grep -rn "@conductor/config"
 * packages/conductor-runtime/src` finds only comments, zero real imports). Serves only as
 * `evaluateModelPrecondition`'s default for the third parameter (below) — the real caller (the CLI
 * composition root, `@conductor/cli`) always supplies the genuine `MANDATORY_GATES` explicitly,
 * mirroring `gate-store.ts`'s own `evaluateAdvance(current, gate, MANDATORY_GATES)` /
 * `evaluateCalibration(collapsedGates, MANDATORY_GATES)` call shape exactly.
 */
const DEFAULT_MANDATORY_GATES: ReadonlySet<number> = new Set([3, 5, 7, 8, 9]);

/**
 * Renders a `ResolutionRefusal` (the ADR §16 union) into the human-readable text
 * `models why <gate>` and the P1/P2/P3 refusal message (D4 §6.1) both need. `mandatoryGates` is
 * consulted ONLY to enrich the wording for the two refusal kinds where the never-collapse floor is
 * genuinely non-relaxable (R48/§6.3: "nos 5 obrigatórios, o piso de tier não é relaxável nem com
 * consentimento") — it never changes WHETHER a refusal happened, only how it reads.
 *
 * EXPORTED (N2, ADR 0010 "Wiring de delegação real de subagentes em runAuto" §5/D3, additive, ZERO
 * behavior change): this function used to be private to this module. FR-2b of that demand's spec
 * requires `runAuto`'s own model-precondition refusal (a SEPARATE call, `purpose:"delegation"`,
 * resolved DIRECTLY against the same `ModelResolutionPort` rather than through
 * `evaluateModelPrecondition`, which discards `resolution.model`) to reuse this EXACT formatting —
 * "describeRefusal-shaped, never a second formatting function" (spec FR-2b's own words). Making it
 * `export` is the only change here: the function's body, behavior, and every existing call site
 * (`evaluateModelPrecondition` below) are untouched.
 */
export function describeRefusal(refusal: ResolutionRefusal, mandatoryGates: ReadonlySet<number>): string {
	const mandatoryNote = (gate: number) =>
		mandatoryGates.has(gate) ? " (mandatory gate — the tier floor is not relaxable, even with consent)" : "";
	switch (refusal.kind) {
		case "unsupported-gate":
			return `gate ${refusal.gate} is outside the supported range [${refusal.validRange[0]}, ${refusal.validRange[1]}]`;
		case "no-gate-mapping":
			return `gate ${refusal.gate} has no model role mapping`;
		case "no-binding-for-role":
			return `gate ${refusal.gate}: no model bound to role "${refusal.role}"${mandatoryNote(refusal.gate)}`;
		case "unknown-model":
			return `gate ${refusal.gate}: declared model "${refusal.declared}" is not known to the catalog`;
		case "unknown-provider":
			return `gate ${refusal.gate}: declared provider "${refusal.declared}" is not known to the catalog`;
		case "untrusted-endpoint":
			return `gate ${refusal.gate}: provider "${refusal.provider}" at "${refusal.host}" is not trusted (TOFU pin required)`;
		case "no-credential":
			return `gate ${refusal.gate}: no credential configured for role "${refusal.role}" (checked: ${refusal.providers.join(", ")})`;
		case "all-candidates-unavailable":
			return `gate ${refusal.gate}: every candidate provider is unavailable (${refusal.providers.join(", ")})`;
		case "below-tier-floor":
			return `gate ${refusal.gate}: best candidate rank ${refusal.bestRank} is below the required floor ${refusal.requiredRank}${mandatoryNote(refusal.gate)}`;
		case "consent-required":
			return `gate ${refusal.gate}: candidate crosses to provider host "${refusal.destinationHost}" and requires explicit egress consent`;
		case "both-floors-unsatisfiable":
			return `gate ${refusal.gate}: no candidate satisfies both the tier floor and the same-provider floor${mandatoryNote(refusal.gate)}`;
		case "policy-unreadable":
			return `gate ${refusal.gate}: model policy is unreadable (${refusal.detail})`;
		default: {
			// Defensive catch-all (Software Construction Practices §3.3 — minimize paths, then check
			// them automatically), deliberately NOT a `const exhaustive: never = refusal` assertion: this
			// package's own tsgo pass runs concurrently with the sibling `@conductor/providers` stream
			// that owns `ResolutionRefusal`'s real variant set (type-only import, D2/§16) -- a `never`
			// assertion here would coincidentally succeed or fail depending on that OTHER package's
			// build-order/resolution state rather than on a defect in this file. A future
			// `ResolutionRefusal` variant this switch does not yet know about still degrades to a
			// readable message instead of a silent drop.
			const unknown = refusal as { kind?: unknown };
			return `model precondition refused (kind: ${String(unknown.kind)})`;
		}
	}
}

/**
 * D4's P1 imposition point (`gate start <N>`, ADR §6.1 table): asks the injected port to resolve a
 * model for `gate`, and translates its ADR-§16 `ModelResolution` into the SEPARATE
 * `ModelPreconditionVerdict` this module owns. Pure — the port call is the only collaborator, no I/O
 * of its own, never throws (mirrors `evaluateAdvance`'s own terminal-verdict discipline,
 * gate-state-policy.ts).
 *
 * `mandatoryGates` is an explicit parameter, never imported — see `DEFAULT_MANDATORY_GATES`'s own
 * doc comment above for why, and `gate-state.ts`/`gate-state-policy.ts`'s `mandatory: ReadonlySet
 * <number>` parameter for the structural precedent this mirrors. The default lets a caller that only
 * cares about the two-shape contract (this Fase's own composition-guard test) call with just
 * `(gate, port)` and still get a correct, non-crashing result for the 5 real mandatory gates —
 * never `undefined.has(...)`. The real composition root (`@conductor/cli`) always supplies the
 * genuine set explicitly.
 */
export function evaluateModelPrecondition(
	gate: number,
	port: ModelResolutionPort,
	mandatoryGates: ReadonlySet<number> = DEFAULT_MANDATORY_GATES,
): ModelPreconditionVerdict {
	const request: ResolveModelRequest = { gate, purpose: "gate-open" };
	const resolution = port.resolveForGate(request);
	if (resolution.resolved) {
		return { kind: "satisfied", provider: resolution.ref.provider, modelId: resolution.ref.modelId };
	}
	return {
		kind: "refused",
		refusal: resolution.refusal,
		humanReadable: describeRefusal(resolution.refusal, mandatoryGates),
	};
}
