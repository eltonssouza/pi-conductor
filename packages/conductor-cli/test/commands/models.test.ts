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
 * GATE 8 (validação FR-a-FR) loop-back — a ambiguidade que este arquivo declarou, resolvida.
 *
 * O cabeçalho original registrava uma "IMPORTANT AMBIGUITY": `ResolutionContext`'s real shape não
 * estava fixada no ADR §16 e `@conductor/providers` ainda não tinha exports, então os testes
 * `ctx`-dependentes usavam `fixtureContext()` — um placeholder opaco carregando um campo
 * `resolutions: Map<gate, ModelResolution>` — e o arquivo previa "a small Gate 6 (or a dedicated Gate 6
 * loop-back) adjustment once `ResolutionContext`'s real fields land". **Os campos reais aterrissaram
 * no mesmo commit do Gate 6 e o ajuste não foi feito**, o que deixou `models.ts` lendo um campo que a
 * `buildResolutionContext` real nunca produz (defeito registrado no Gate 8). Este é o ajuste: os
 * fixtures abaixo constroem `ResolutionContext` **reais** (`gateModelRoles`/`bindingsByRole`/`catalog`/
 * `untrustedBindings`, `types.ts`) e o comando roda o `resolveModelForGate` **real**. As asserções de
 * saída renderizada — que é o que a spec exige — são as mesmas de antes, intocadas.
 *
 * O teste de edge-case 8 (gate fora de 1-14) continua sem fixture nenhum: essa checagem tem que rodar
 * antes de `ctx` ser consultado, e passar `undefined` é o que prova isso.
 */

import type { ResolutionContext, ResolvedCandidate } from "@conductor/providers";
import { sanitizeForTerminal } from "@conductor/runtime";
import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { runModelsList, runModelsWhy } from "../../src/commands/models.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject } from "../support/scratch.ts";

/** Um `Model<Api>` de catálogo mínimo -- só os campos que o renderizador/o resolvedor tocam. */
function catalogModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "anthropic-messages",
		provider,
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		contextWindow: 200_000,
		maxTokens: 8192,
	} as unknown as Model<Api>;
}

function candidate(provider: string, modelId: string, credential: ResolvedCandidate["credential"]): ResolvedCandidate {
	return {
		ref: { provider, modelId },
		rank: 3, // `slow`, o piso do Gate 9 -- nunca abaixo (R48)
		declaredIn: "project-policy",
		credential,
		availability: { state: "reachable", checkedAt: "2026-08-07T00:00:00.000Z" },
	};
}

/** Um `ResolutionContext` REAL (a forma de `types.ts`), não um cast opaco. */
function realContext(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
	return {
		gateModelRoles: { 9: { role: "slow", source: "builtin" } },
		bindingsByRole: {},
		catalog: {},
		...overrides,
	};
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

			// Contexto real de um projeto recém-criado: nenhum binding em lugar nenhum.
			const code = runModelsList({ io, ctx: realContext() });

			expect(code).toBe(0);
			expect(stdout().trim().length).toBeGreaterThan(0);
			expect(stdout()).toMatch(/conductor login/);
			// FR-12: as 14 linhas existem e cada uma nomeia a recusa -- nunca uma linha vazia.
			expect(stdout()).toMatch(/gate 09: refused --/);
		} finally {
			project.cleanup();
		}
	});
});

describe("runModelsWhy <gate> -- FR-13, narrates the resolution pipeline stage by stage", () => {
	it("prints the resolved model when the pipeline succeeds", () => {
		const project = createScratchProject();
		try {
			const ctx = realContext({
				bindingsByRole: {
					slow: [
						candidate("anthropic", "claude-opus-4-8", {
							configured: true,
							source: "stored",
							authorizedByPolicy: true,
						}),
					],
				},
				catalog: { "anthropic::claude-opus-4-8": catalogModel("anthropic", "claude-opus-4-8") },
			});
			const { io, stdout } = createCapturingIo(project.root);

			const code = runModelsWhy({ io, ctx, gate: 9 });

			expect(code).toBe(0);
			expect(stdout()).toMatch(/anthropic/);
			expect(stdout()).toMatch(/claude-opus-4-8/);
			// FR-13: a narração é etapa a etapa, não só o resultado final.
			expect(stdout()).toMatch(/\[gate-role\]/);
			expect(stdout()).toMatch(/\[selection\]/);
		} finally {
			project.cleanup();
		}
	});

	it("names the exact stage where the chain stopped when refused, never just a bare result", () => {
		const project = createScratchProject();
		try {
			// Gate 9 mapeado para `slow`, e nenhum binding declarado para esse papel.
			const { io, stdout } = createCapturingIo(project.root);

			const code = runModelsWhy({ io, ctx: realContext(), gate: 9 });

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
			// Binding válido no catálogo, mas sem credencial nenhuma -> refusal `no-credential`, cuja
			// trace inclui a etapa `credential`. Nada em `ResolutionStep` carrega valor de segredo.
			const ctx = realContext({
				bindingsByRole: {
					slow: [candidate("anthropic", "claude-opus-4-8", { configured: false, authorizedByPolicy: true })],
				},
				catalog: { "anthropic::claude-opus-4-8": catalogModel("anthropic", "claude-opus-4-8") },
			});
			const { io, stdout } = createCapturingIo(project.root);

			runModelsWhy({ io, ctx, gate: 9 });

			expect(stdout()).toMatch(/anthropic/);
			expect(stdout()).toMatch(/\[credential\]/);
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
			// A forma real de T73(b): o único binding do papel apontava para um endpoint fora do catálogo
			// oficial sem pin TOFU, então `buildResolutionContext` o registrou em `untrustedBindings` e
			// NUNCA em `bindingsByRole` -- e a resolução recusa nomeando provedor e host (R54(ii)).
			const ctx = realContext({
				untrustedBindings: {
					slow: [{ ref: { provider: hostileProvider, modelId: "some-model" }, host: hostileHost }],
				},
			});
			const { io, stdout } = createCapturingIo(project.root);

			runModelsWhy({ io, ctx, gate: 9 });

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
