/**
 * FR-11 end-to-end (docs/conductor/gate2-spec-fase7.md Grupo C; ADR 0008 §8.1's own `modelPolicy`
 * schema table, and §21's "**Também fecha FR-11 de ponta a ponta:** a seção `modelPolicy` de
 * `.conductor/config.json` (§8.1 já a projetava, nunca foi acrescentada ao schema real) precisa
 * existir de fato pra qualquer projeto sair do modo compatibilidade").
 *
 * O achado do Gate 8 que estes testes fecham: `parseModelPolicy` (model-policy.ts) estava
 * implementado e testado desde o Gate 6, mas **nenhum arquivo em disco jamais o alimentava** —
 * `assertValidConfigShape` validava `schema`/`project`/`workspace`/`provider` e nada mais, então
 * FR-11 (override projeto→papel do mapeamento gate→papel) era literalmente **inalcançável**: não
 * havia onde escrever a política.
 *
 * Três invariantes de segurança que estes testes travam junto com a feature:
 *   1. A validação estrutural do config é RASA sobre `modelPolicy` (objeto ou nada). A validação
 *      PROFUNDA é de `parseModelPolicy`, e uma política inválida tem que produzir
 *      "presente-mas-ilegível" (§8.2/R49(iii)) — nunca derrubar `readConfig`, o que quebraria
 *      `conductor doctor`/`config show` inteiros e faria uma política corrompida ser
 *      indistinguível de um config corrompido.
 *   2. "Ilegível" NUNCA colapsa para "ausente" — é exatamente o buraco que um atacante que corrompe
 *      uma política restritiva quer abrir (§8.2, linha 3 da tabela do §21).
 *   3. A seção nova entra no MESMO varredor de segredos do caminho de escrita (`assertNoRawSecrets`,
 *      T11/secure default 8) — a alegação do ADR §8.1 de que `modelPolicy` está "already swept by
 *      secret-detection on write" é verificada aqui contra o código real, não assumida.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigValidationError } from "../src/errors.ts";
import { resolveProjectModelPolicy } from "../src/model-policy.ts";
import { readConfig } from "../src/read-config.ts";
import type { ConductorConfig } from "../src/schema.ts";
import { assertValidConfigShape } from "../src/schema-validation.ts";
import { writeConfig } from "../src/write-config.ts";
import { createScratchWorkspace } from "./support/workspace.ts";

function baseConfig(): ConductorConfig {
	return {
		schema: 1,
		project: { type: "backend", technologies: [], evidence: [], detectedAt: "2026-08-07T12:00:00.000Z" },
		workspace: { root: "." },
		provider: { model: "anthropic/claude-sonnet-5" },
	};
}

const VALID_POLICY = {
	schema: 1,
	bindings: [{ role: "slow", provider: "anthropic", modelId: "claude-opus-4-8" }],
	gateRoles: { 11: "slow" },
	egress: { crossProvider: "deny" },
} as const;

describe("`.conductor/config.json` ganha a seção `modelPolicy` (FR-11, ADR §8.1/§21)", () => {
	it("aceita e faz round-trip de um config COM `modelPolicy` (write -> read), sem perder a seção", () => {
		const workspace = createScratchWorkspace();
		try {
			const config = { ...baseConfig(), modelPolicy: VALID_POLICY } as unknown as ConductorConfig;

			writeConfig(workspace.root, config);
			const reread = readConfig(workspace.root);

			expect(reread.modelPolicy).toBeDefined();
			expect(reread.modelPolicy?.bindings).toHaveLength(1);
		} finally {
			workspace.cleanup();
		}
	});

	it("continua aceitando um config SEM `modelPolicy` — a seção é opcional, nenhum projeto existente quebra", () => {
		expect(() => assertValidConfigShape(baseConfig())).not.toThrow();
	});

	it("recusa `modelPolicy` que não seja um objeto (checagem estrutural rasa, na borda)", () => {
		const config = { ...baseConfig(), modelPolicy: "não é um objeto" };

		expect(() => assertValidConfigShape(config)).toThrow(ConfigValidationError);
	});
});

describe("`resolveProjectModelPolicy` — o parser real, ligado ao config real", () => {
	it("devolve `absent` quando não há seção nenhuma (o estado de todo projeto hoje ⇒ modo-compatibilidade D11)", () => {
		expect(resolveProjectModelPolicy(baseConfig()).kind).toBe("absent");
	});

	it("devolve a política parseada, com os `gateRoles` do projeto — FR-11 finalmente alcançável", () => {
		const config = { ...baseConfig(), modelPolicy: VALID_POLICY } as unknown as ConductorConfig;

		const result = resolveProjectModelPolicy(config);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.policy.gateRoles?.[11]).toBe("slow");
			expect(result.policy.bindings[0]?.modelId).toBe("claude-opus-4-8");
		}
	});

	it("propaga os diagnósticos de TOFU do parser (um remap descendente exige pin) em vez de os engolir", () => {
		// Gate 8 é `slow` (rank 3) por omissão; declarar `plan` (rank 2) é um remap DESCENDENTE.
		const config = {
			...baseConfig(),
			modelPolicy: { ...VALID_POLICY, gateRoles: { 8: "plan" } },
		} as unknown as ConductorConfig;

		const result = resolveProjectModelPolicy(config);

		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.diagnostics.map((d) => d.kind)).toContain("downward-gate-remap-requires-pin");
		}
	});

	it("uma política PRESENTE mas inválida vira `unreadable`, NUNCA `absent` (§8.2/R49(iii), linha 3 do §21)", () => {
		// `baseUrl` num binding é o vetor T73(b) — o parser rejeita a política INTEIRA, atomicamente.
		const config = {
			...baseConfig(),
			modelPolicy: {
				schema: 1,
				bindings: [
					{ role: "slow", provider: "anthropic", modelId: "claude-opus-4-8", baseUrl: "https://evil.invalid" },
				],
				egress: { crossProvider: "deny" },
			},
		} as unknown as ConductorConfig;

		const result = resolveProjectModelPolicy(config);

		expect(result.kind).toBe("unreadable");
		if (result.kind === "unreadable") expect(result.reason).toMatch(/baseUrl/);
	});

	it("uma política inválida NÃO derruba `readConfig` — doctor/config show continuam utilizáveis", () => {
		const workspace = createScratchWorkspace();
		try {
			// Escrito CRU (nunca por `writeConfig`): é exatamente a forma de um config hand-editado, o
			// caminho pelo qual uma política inválida realmente chega ao disco.
			mkdirSync(join(workspace.root, ".conductor"), { recursive: true });
			writeFileSync(
				join(workspace.root, ".conductor", "config.json"),
				JSON.stringify({
					...baseConfig(),
					modelPolicy: { schema: 99, bindings: [], egress: { crossProvider: "deny" } },
				}),
				"utf8",
			);

			const config = readConfig(workspace.root);

			expect(config.provider.model).toBe("anthropic/claude-sonnet-5");
			expect(resolveProjectModelPolicy(config).kind).toBe("unreadable");
		} finally {
			workspace.cleanup();
		}
	});
});

describe("a seção nova entra no varredor de segredos do caminho de escrita (T11 / ADR §8.1)", () => {
	it("recusa gravar um config cuja `modelPolicy` carrega um campo nomeado como credencial com valor cru", () => {
		const workspace = createScratchWorkspace();
		try {
			const config = {
				...baseConfig(),
				modelPolicy: {
					schema: 1,
					bindings: [
						{ role: "slow", provider: "anthropic", modelId: "claude-opus-4-8", apiKey: "hunter2-not-a-ref" },
					],
					egress: { crossProvider: "deny" },
				},
			} as unknown as ConductorConfig;

			// Prova que `assertNoRawSecrets` percorre a árvore INTEIRA (inclusive campos fora do schema
			// tipado), e não apenas os caminhos `provider.*` que a Fase 1 conhecia.
			expect(() => writeConfig(workspace.root, config)).toThrow(ConfigValidationError);
		} finally {
			workspace.cleanup();
		}
	});

	it("recusa gravar um valor com prefixo de segredo conhecido em qualquer lugar dentro de `modelPolicy`", () => {
		const workspace = createScratchWorkspace();
		try {
			const config = {
				...baseConfig(),
				modelPolicy: {
					schema: 1,
					bindings: [{ role: "slow", provider: "sk-ant-api03-realkeyshapedvalue", modelId: "x" }],
					egress: { crossProvider: "deny" },
				},
			} as unknown as ConductorConfig;

			expect(() => writeConfig(workspace.root, config)).toThrow(ConfigValidationError);
		} finally {
			workspace.cleanup();
		}
	});
});
