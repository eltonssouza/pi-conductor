/**
 * D11 (docs/adr/0008-fase7-model-routing-and-providers.md §21, "Loop-back do Gate 8 — D6 amendment"):
 * **o modelo flat de sessão (config Fase 1, `provider.model`) é o binding universal implícito quando
 * `modelPolicy` está genuinamente ausente.**
 *
 * O achado que estes testes travam (Gate 8, medido contra o binário real): §8.2 sempre declarou
 * "política ausente ⇒ os defaults built-in valem (o produto funciona sem config)", mas nenhum
 * `ModelBinding` built-in jamais existiu — então, com zero política (o estado de TODO projeto
 * Conductor hoje, incluindo este repositório, que sequer tem `.conductor/`), a resolução não tinha
 * candidato nenhum pra gate nenhum, e ligar `evaluateModelPrecondition` de verdade recusaria
 * `conductor gate start N` universalmente: uma regressão de comportamento, não uma feature de
 * segurança.
 *
 * As três linhas da tabela do §21, cada uma com seu teste aqui:
 *   1. política AUSENTE (ou presente com `bindings: []`) ⇒ todo `GateModelRole`, pra todo gate,
 *      resolve pro modelo flat — `declaredIn: "builtin-default"`, satisfazendo QUALQUER rank pedido
 *      (não há segundo modelo contra o qual comparar tier; exigir tier aqui recusaria todo projeto,
 *      exatamente o que a frase do §8.2 já proibia).
 *   2. política PRESENTE com ao menos 1 `ModelBinding` real ⇒ cascata normal: um papel SEM binding
 *      próprio **não** cai de volta pro flat model (seria o downgrade silencioso que BR-3/FR-14/R48
 *      proíbem). Recusa fail-closed nomeando o papel.
 *   3. política PRESENTE e ilegível ⇒ inalterado, `policy-unreadable` — nunca colapsa pra nenhum dos
 *      dois casos acima (R49(iii)).
 *
 * Usa um `ModelRuntime` REAL e hermético (`InMemoryCredentialStore`, `modelsPath: null`,
 * `allowModelNetwork: false`) — o mesmo padrão de `build-context-fail-closed.test.ts` — nunca um stub
 * da função sob teste.
 */

import { DEFAULT_GATE_MODEL_ROLES } from "@conductor/config";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ModelRef, ResolutionContext } from "../src/index.ts";
import { buildResolutionContext, createAvailabilityCache, resolveModelForGate } from "../src/index.ts";

/** Este teste não é sobre TOFU pinning; uma resposta fixa é legítima aqui (não é mock da SUT). */
const alwaysTrustedStore = { isTrusted: (_contentHash: string) => true };

/** Modelo do catálogo oficial do fornecedor (`packages/ai/src/providers/data/anthropic.json`) — o
 * mesmo valor que `conductor init` escreve como `provider.model` por omissão. */
const SESSION_MODEL: ModelRef = { provider: "anthropic", modelId: "claude-sonnet-5" };

/** Um SEGUNDO modelo real do catálogo, pra política explícita (papel `slow`) — deliberadamente
 * diferente do flat model, pra que "resolveu pro flat" e "resolveu pelo binding" nunca sejam
 * indistinguíveis numa asserção. */
const POLICY_MODEL: ModelRef = { provider: "anthropic", modelId: "claude-opus-4-8" };

async function credentialedRuntime(): Promise<ModelRuntime> {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () => ({ type: "api_key" as const, key: "sk-ant-fake-test-only" }));
	return ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
}

/** Sem credencial NENHUMA — o estado real de uma máquina que nunca rodou `conductor login`. */
async function uncredentialedRuntime(): Promise<ModelRuntime> {
	return ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
}

interface ContextOverrides {
	policy?: Parameters<typeof buildResolutionContext>[0]["policy"];
	sessionModel?: ModelRef;
	modelRuntime?: ModelRuntime;
}

async function contextFor(overrides: ContextOverrides = {}): Promise<ResolutionContext> {
	const modelRuntime = overrides.modelRuntime ?? (await credentialedRuntime());
	return buildResolutionContext({
		workspaceRoot: process.cwd(),
		modelRuntime,
		policy: overrides.policy,
		...(overrides.sessionModel !== undefined ? { sessionModel: overrides.sessionModel } : {}),
		trust: alwaysTrustedStore,
		availability: createAvailabilityCache(),
	});
}

const ALL_GATES = Object.keys(DEFAULT_GATE_MODEL_ROLES).map(Number);

describe("D11/§21 linha 1 — política AUSENTE: o modelo flat de sessão é o binding universal", () => {
	it("resolve os 14 gates pro modelo flat quando não há seção `modelPolicy` nenhuma", async () => {
		const ctx = await contextFor({ policy: undefined, sessionModel: SESSION_MODEL });

		for (const gate of ALL_GATES) {
			const result = resolveModelForGate({ gate, purpose: "gate-open" }, ctx);
			expect(result.resolved, `gate ${gate} deveria resolver pelo fallback universal`).toBe(true);
			if (result.resolved) {
				expect(result.ref).toEqual(SESSION_MODEL);
			}
		}
	});

	it("trata `bindings: []` numa política presente exatamente como ausência (a tabela do §21 junta os dois casos)", async () => {
		const ctx = await contextFor({
			policy: { schema: 1, bindings: [], egress: { crossProvider: "deny" } },
			sessionModel: SESSION_MODEL,
		});

		const result = resolveModelForGate({ gate: 8, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(true);
		if (result.resolved) expect(result.ref).toEqual(SESSION_MODEL);
	});

	it("satisfaz QUALQUER rank pedido — inclusive o piso mais alto (`slow`, gate 8) combinado com uma persona `strategic`", async () => {
		const ctx = await contextFor({ sessionModel: SESSION_MODEL });

		// max(rank(gate 8 = slow) = 3, rank(strategic) = 2) = 3, o piso mais alto que o produto produz.
		const result = resolveModelForGate(
			{ gate: 8, purpose: "delegation", persona: { name: "software-architect", modelRole: "strategic" } },
			ctx,
		);

		expect(result.resolved, "o fallback universal nunca pode ser recusado por `below-tier-floor`").toBe(true);
	});

	it("marca o candidato sintético como `builtin-default` no rastro — visível em `models why`, nunca escondido", async () => {
		const ctx = await contextFor({ sessionModel: SESSION_MODEL });

		const result = resolveModelForGate({ gate: 1, purpose: "report" }, ctx);

		const bindingsStep = result.trace.steps.find(
			(step): step is Extract<typeof step, { stage: "bindings" }> => step.stage === "bindings",
		);
		expect(bindingsStep?.candidates).toHaveLength(1);
		expect(bindingsStep?.candidates[0]?.declaredIn).toBe("builtin-default");
		expect(bindingsStep?.candidates[0]?.ref).toEqual(SESSION_MODEL);
	});

	it("resolve mesmo SEM credencial configurada — 'preservado byte a byte' (abrir um gate nunca chamou um modelo)", async () => {
		const ctx = await contextFor({
			sessionModel: SESSION_MODEL,
			modelRuntime: await uncredentialedRuntime(),
		});

		const result = resolveModelForGate({ gate: 1, purpose: "gate-open" }, ctx);

		// A regressão que isto trava: com o filtro de credencial aplicado ao candidato sintético,
		// `conductor gate start 1` passaria a recusar em toda máquina que nunca rodou `conductor
		// login` -- exatamente a recusa universal que o §21 existe pra impedir.
		expect(result.resolved).toBe(true);
		if (result.resolved) expect(result.ref).toEqual(SESSION_MODEL);
	});

	it("continua reportando o status REAL de credencial no rastro, mesmo sem filtrar por ele (a informação não é apagada)", async () => {
		const ctx = await contextFor({
			sessionModel: SESSION_MODEL,
			modelRuntime: await uncredentialedRuntime(),
		});

		const result = resolveModelForGate({ gate: 1, purpose: "report" }, ctx);

		const credentialStep = result.trace.steps.find(
			(step): step is Extract<typeof step, { stage: "credential" }> => step.stage === "credential",
		);
		expect(credentialStep?.perProvider[0]).toMatchObject({ provider: "anthropic", configured: false });
	});

	it("NÃO inventa modelo nenhum quando não há modelo flat pra ancorar (sem `sessionModel` ⇒ recusa nomeada)", async () => {
		const ctx = await contextFor({ sessionModel: undefined });

		const result = resolveModelForGate({ gate: 1, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) expect(result.refusal.kind).toBe("no-binding-for-role");
	});

	it("recusa (nunca fabrica) quando o modelo flat não existe no catálogo do fornecedor", async () => {
		const ctx = await contextFor({
			sessionModel: { provider: "anthropic", modelId: "claude-that-never-shipped" },
		});

		const result = resolveModelForGate({ gate: 1, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
	});
});

describe("D11/§21 linha 2 — política REAL: o fallback universal desaparece, a recusa fail-closed volta", () => {
	it("um papel SEM binding próprio recusa `no-binding-for-role`, nunca cai de volta pro modelo flat (BR-3/FR-14/R48)", async () => {
		const ctx = await contextFor({
			policy: {
				schema: 1,
				bindings: [{ role: "slow", provider: POLICY_MODEL.provider, modelId: POLICY_MODEL.modelId }],
				egress: { crossProvider: "deny" },
			},
			sessionModel: SESSION_MODEL,
		});

		// Gate 1 -> "plan". A política declara apenas "slow".
		const result = resolveModelForGate({ gate: 1, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(false);
		if (!result.resolved) {
			expect(result.refusal.kind).toBe("no-binding-for-role");
			if (result.refusal.kind === "no-binding-for-role") expect(result.refusal.role).toBe("plan");
		}
	});

	it("o papel COM binding continua resolvendo pelo binding declarado (a política não fica globalmente quebrada)", async () => {
		const ctx = await contextFor({
			policy: {
				schema: 1,
				bindings: [{ role: "slow", provider: POLICY_MODEL.provider, modelId: POLICY_MODEL.modelId }],
				egress: { crossProvider: "deny" },
			},
			sessionModel: SESSION_MODEL,
		});

		// Gate 8 -> "slow".
		const result = resolveModelForGate({ gate: 8, purpose: "gate-open" }, ctx);

		expect(result.resolved).toBe(true);
		if (result.resolved) {
			expect(result.ref).toEqual(POLICY_MODEL);
			// E, explicitamente, NUNCA o modelo flat: sair do modo-compatibilidade tem que ser observável.
			expect(result.ref).not.toEqual(SESSION_MODEL);
		}
	});
});

describe("D11/§21 linha 3 — política PRESENTE e ilegível: inalterada, nunca colapsa pra modo-compatibilidade", () => {
	it("`policy-unreadable` vence o fallback universal, mesmo com um `sessionModel` perfeitamente válido", async () => {
		const ctx = await contextFor({ sessionModel: SESSION_MODEL });
		const unreadable: ResolutionContext = { ...ctx, policyUnreadable: "policy.bindings must be an array" };

		const result = resolveModelForGate({ gate: 1, purpose: "gate-open" }, unreadable);

		expect(result.resolved).toBe(false);
		if (!result.resolved) expect(result.refusal.kind).toBe("policy-unreadable");
	});
});
