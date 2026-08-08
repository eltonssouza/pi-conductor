/**
 * GATE 8 -> GATE 6 loop-back (Fase 7, ADR 0008 §21/D11) — **o teste que mata a mutação que sobreviveu.**
 *
 * O achado exato do Gate 8: a mutação "`evaluateModelPrecondition` sempre devolve `satisfied`"
 * SOBREVIVEU contra `@conductor/runtime` (446/446) e `@conductor/cli` (340/340). Nenhum teste em lugar
 * nenhum observava a pré-condição RECUSANDO de verdade, porque a imposição estava atrás de um campo
 * opcional (`PersistedGateStateStoreOptions.modelResolutionPort`) que **a produção nunca preenchia** —
 * o `if (options.modelResolutionPort)` de `gate-store.ts` deixava a checagem permanentemente inerte.
 * O teste de unidade de `evaluateModelPrecondition` (em `@conductor/runtime`) passava e continuava
 * passando sob a mutação inversa também: ele testa a FUNÇÃO, não o FIO.
 *
 * Por isso este arquivo é deliberadamente de INTEGRAÇÃO e entra pelo ponto de entrada real do usuário
 * (`runCli(["gate", "start", N])`), atravessando `cli.ts` -> `createPersistedGateStateStore` ->
 * `evaluateModelPrecondition` -> `@conductor/providers`' `resolveModelForGate` sobre um
 * `ResolutionContext` REAL construído a partir de um `.conductor/config.json` REAL em disco.
 * *Grounding:* **Specification by Example** (o exemplo executável tem que percorrer o caminho do
 * usuário) e **Agile Testing** (um teste verde sobre um componente desconectado não critica o produto)
 * — o mesmo critério que a Fase 6 já aplicou quando pegou a captura automática nunca chamada.
 *
 * **As duas direções importam, e é por isso que ambas estão aqui.** Um teste que provasse só a recusa
 * deixaria passar o defeito oposto — recusar TODO projeto —, que é uma regressão contra 100% dos
 * projetos existentes (este repositório inclusive: `pi` sequer tem um diretório `.conductor/`). §21
 * decidiu D11 exatamente para impedir esse segundo defeito, então ele precisa de guarda própria.
 *
 * `createModelRuntime` é o seam de teste que `CliIO` já expõe (Gate 8): sem ele estes testes
 * construiriam um `ModelRuntime` real lendo o `~/.pi/agent/auth.json` DESTA máquina, e o resultado
 * passaria a depender de a máquina ter feito login — exatamente o tipo de teste dependente de ambiente
 * que a memória de sessão deste projeto registra como inaceitável. O `ModelRuntime` aqui é REAL
 * (nunca um stub da SUT), apenas hermético: `InMemoryCredentialStore` + `modelsPath: null` +
 * `allowModelNetwork: false`.
 */

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIO, runCli } from "../../src/cli.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

async function hermeticModelRuntime(): Promise<ModelRuntime> {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () => ({ type: "api_key" as const, key: "sk-ant-fake-test-only" }));
	return ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
}

function ioFor(cwd: string): ReturnType<typeof createCapturingIo> {
	const captured = createCapturingIo(cwd);
	const io: CliIO = { ...captured.io, createModelRuntime: hermeticModelRuntime };
	return { ...captured, io };
}

function baseConfig(): Record<string, unknown> {
	return {
		schema: 1,
		project: { type: "backend", technologies: [], evidence: [], detectedAt: "2026-08-07T12:00:00.000Z" },
		workspace: { root: "." },
		provider: { model: "anthropic/claude-sonnet-5" },
	};
}

/** Uma política REAL que liga apenas o papel `slow` — o papel `plan` (gate 1) fica sem binding nenhum. */
function configWithPolicyBindingOnlySlow(): Record<string, unknown> {
	return {
		...baseConfig(),
		modelPolicy: {
			schema: 1,
			bindings: [{ role: "slow", provider: "anthropic", modelId: "claude-opus-4-8" }],
			egress: { crossProvider: "deny" },
		},
	};
}

describe("direção (a) — política REAL com um papel sem binding: `gate start` RECUSA de verdade (FR-14/BR-3/D4 P1)", () => {
	it("`gate start 1` é recusado nomeando o papel sem binding, e o gate NÃO é aberto", async () => {
		project.writeJson(".conductor/config.json", configWithPolicyBindingOnlySlow());
		const { io, stderr } = ioFor(project.root);

		const code = await runCli(["gate", "start", "1"], io);

		// A mutação que isto mata: com `evaluateModelPrecondition` devolvendo sempre `satisfied` (ou
		// com o `if (options.modelResolutionPort)` de volta), gate 1 abre normalmente e `code` é 0 --
		// exatamente o que o Gate 8 mediu e reportou como sobrevivente.
		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/no model bound to role "plan"/);
	});

	it("a recusa é de verdade: o estado em disco não avança (o gate recusado nunca aparece no `gate status`)", async () => {
		project.writeJson(".conductor/config.json", configWithPolicyBindingOnlySlow());

		// Gate 2 (também `plan`), e não o gate 1: `readOrBootstrap` (gate-store.ts) auto-abre o gate 1
		// em QUALQUER comando `gate *` -- inclusive `gate status` -- como ergonomia documentada de CLI,
		// então a presença do gate 1 nunca provaria nada sobre este `start`.
		const start = ioFor(project.root);
		const code = await runCli(["gate", "start", "2"], start.io);
		const status = ioFor(project.root);
		await runCli(["gate", "status"], status.io);

		expect(code).not.toBe(0);
		expect(start.stderr()).toMatch(/no model bound to role "plan"/);
		expect(status.stdout()).not.toMatch(/Gate 2:/);
	});

	it("a pré-condição de modelo é avaliada ANTES de `evaluateAdvance` (ADR §6.2 ponto 3 — o diagnóstico mais barato primeiro)", async () => {
		project.writeJson(".conductor/config.json", configWithPolicyBindingOnlySlow());
		const { io, stderr } = ioFor(project.root);

		// Gate 5 falharia nas DUAS checagens: obrigatório 3 não aprovado (evaluateAdvance) e papel
		// `default` sem binding (pré-condição de modelo). A mensagem tem que ser a do MODELO.
		const code = await runCli(["gate", "start", "5"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/no model bound to role/);
		expect(stderr()).not.toMatch(/not yet approved/);
	});

	it("a recusa vem da pré-condição de MODELO, não da ordenação de gates — o mesmo `gate start 1` passa sem a política", async () => {
		// Controle pareado: mesmo comando, mesmo gate, mesma máquina; a ÚNICA variável é a política.
		project.writeJson(".conductor/config.json", baseConfig());
		const withoutPolicy = ioFor(project.root);
		expect(await runCli(["gate", "start", "1"], withoutPolicy.io)).toBe(0);

		const other = createScratchProject();
		try {
			other.writeJson(".conductor/config.json", configWithPolicyBindingOnlySlow());
			const withPolicy = ioFor(other.root);
			expect(await runCli(["gate", "start", "1"], withPolicy.io)).not.toBe(0);
		} finally {
			other.cleanup();
		}
	});

	it("`models why 1` e `gate start 1` concordam — os dois passam pelo MESMO contexto de resolução real", async () => {
		project.writeJson(".conductor/config.json", configWithPolicyBindingOnlySlow());

		const why = ioFor(project.root);
		const whyCode = await runCli(["models", "why", "1"], why.io);
		const start = ioFor(project.root);
		await runCli(["gate", "start", "1"], start.io);

		expect(whyCode).not.toBe(0);
		expect(why.stdout()).toMatch(/no-binding-for-role/);
		expect(why.stdout()).toMatch(/plan/);
		expect(start.stderr()).toMatch(/role "plan"/);
	});

	it("o papel COM binding continua resolvendo — a política não é rejeitada em bloco (gate 8 -> `slow`)", async () => {
		project.writeJson(".conductor/config.json", configWithPolicyBindingOnlySlow());
		const { io, stdout } = ioFor(project.root);

		const code = await runCli(["models", "why", "8"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/claude-opus-4-8/);
	});
});

describe("direção (b) — NENHUMA política: o projeto continua avançando pelo modelo flat (D11/§21 linha 1)", () => {
	it("`gate start 1` num projeto com config mas SEM seção `modelPolicy` abre o gate normalmente", async () => {
		project.writeJson(".conductor/config.json", baseConfig());
		const { io, stdout } = ioFor(project.root);

		const code = await runCli(["gate", "start", "1"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/in-progress/);
	});

	it("`gate start 1` num diretório SEM `.conductor/config.json` nenhum abre o gate normalmente (o estado deste próprio repositório)", async () => {
		const { io, stdout } = ioFor(project.root);

		const code = await runCli(["gate", "start", "1"], io);

		// A regressão que isto trava: ligar a pré-condição sem D11 recusaria TODO projeto Conductor
		// existente, o que §21 classifica explicitamente como "uma regressão de comportamento, não uma
		// feature de segurança".
		expect(code).toBe(0);
		expect(stdout()).toMatch(/in-progress/);
	});

	it("`bindings: []` numa política presente também mantém o modo-compatibilidade (§21 junta os dois casos)", async () => {
		project.writeJson(".conductor/config.json", {
			...baseConfig(),
			modelPolicy: { schema: 1, bindings: [], egress: { crossProvider: "deny" } },
		});
		const { io } = ioFor(project.root);

		expect(await runCli(["gate", "start", "1"], io)).toBe(0);
	});

	it("o modo-compatibilidade vale para os 14 gates, inclusive os de piso mais alto (`slow`)", async () => {
		project.writeJson(".conductor/config.json", baseConfig());
		const { io, stdout } = ioFor(project.root);

		// Gate 3 é `slow` (rank 3, o piso mais alto do produto) e é um dos 5 obrigatórios.
		const code = await runCli(["models", "why", "3"], io);

		expect(code).toBe(0);
		expect(stdout()).toMatch(/claude-sonnet-5/);
		expect(stdout()).toMatch(/builtin-default|\[selection\]/);
	});
});

describe("uma política PRESENTE e ilegível nunca cai no modo-compatibilidade (§21 linha 3 / R49(iii))", () => {
	it("`gate start 1` recusa quando a política declara um campo proibido (T73(b)), em vez de degradar para o modelo flat", async () => {
		project.writeJson(".conductor/config.json", {
			...baseConfig(),
			modelPolicy: {
				schema: 1,
				bindings: [
					{ role: "plan", provider: "anthropic", modelId: "claude-sonnet-5", baseUrl: "https://exfil.invalid" },
				],
				egress: { crossProvider: "deny" },
			},
		});
		const { io, stderr } = ioFor(project.root);

		const code = await runCli(["gate", "start", "1"], io);

		expect(code).not.toBe(0);
		expect(stderr()).toMatch(/unreadable/i);
	});
});
