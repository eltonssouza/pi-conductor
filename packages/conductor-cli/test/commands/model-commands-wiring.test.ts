/**
 * GATE 8 (validação FR-a-FR) loop-back para o Gate 6 — Fase 7.
 *
 * **O defeito que estes testes travam.** O Gate 6 entregou `runLogin`/`runLogout`/`runAuthStatus`/
 * `runModelsList`/`runModelsWhy` (os 5 entregáveis literais da fase, `gate2-spec-fase7.md` §1 linha
 * "Os 5 entregáveis literais desta fase") como funções corretas e testadas em unidade — mas
 * **nenhuma delas foi registrada no dispatcher real** (`runCli`, `src/cli.ts`). `grep` por
 * `runLogin|runLogout|runAuthStatus|runModelsList|runModelsWhy` fora de `/test/` encontrava, antes
 * desta correção, **zero call sites de produção**: quem rodasse `conductor login anthropic` recebia
 * `unknown command "login"`. FR-1..FR-5 (Grupo A) e FR-12/FR-13 (Grupo D) eram inalcançáveis pelo
 * produto — exatamente o padrão que o Gate 8 da Fase 6 já pegou uma vez (a captura automática
 * implementada e testada, nunca chamada do composition root).
 *
 * Estes testes exercitam o **ponto de entrada real do usuário** (`runCli(argv, io)`), nunca a função
 * de comando diretamente — é essa a diferença entre "a função existe" e "o comando existe".
 * *Grounding:* **Specification by Example** (o exemplo executável tem que percorrer o mesmo caminho
 * que o usuário percorre) e **Agile Testing** (quadrante 2/3: um teste de unidade verde sobre um
 * componente desconectado não critica o produto).
 *
 * `createModelRuntime`/`createCredentialStore` são seams de TESTE em `CliIO` (mesma convenção
 * opcional e retrocompatível de `tty`/`homeDir` já estabelecida naquele tipo, e simetria direta com
 * `ChatOptions.createModelRuntime` que `commands/chat.ts` já usa): sem eles, este teste construiria
 * um `ModelRuntime` real, lendo o `~/.pi/agent/auth.json` DESTA máquina — I/O de credencial real
 * dentro de uma suíte de testes, exatamente o que a memória de sessão registrou como inaceitável.
 */

import { describe, expect, it } from "vitest";
import { type CliIO, runCli } from "../../src/cli.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject } from "../support/scratch.ts";

/** Duplas mínimas: só os métodos que os 4 comandos realmente chamam. Nunca toca disco/rede. */
function fakeModelRuntime(): unknown {
	const providers = [
		{ id: "anthropic", name: "Anthropic" },
		{ id: "deepseek", name: "DeepSeek" },
	];
	return {
		getProviders: () => providers,
		getProvider: (id: string) => providers.find((p) => p.id === id),
		getProviderAuthStatus: (id: string) =>
			// `deepseek` configurado por env-var é a forma do incidente T65: `conductor auth` TEM que
			// reportá-la (R46(ii)), mesmo que a resolução nunca a autorize sozinha.
			id === "deepseek" ? { configured: true, source: "environment" } : { configured: false },
		getModel: () => undefined,
		removeRuntimeApiKey: () => {},
	};
}

function fakeCredentialStore(): unknown {
	return {
		read: async () => undefined,
		delete: async () => {},
		modify: async () => {},
		list: async () => [],
	};
}

function ioWithModelSeams(cwd: string): ReturnType<typeof createCapturingIo> {
	const captured = createCapturingIo(cwd);
	const io: CliIO = {
		...captured.io,
		createModelRuntime: async () => fakeModelRuntime() as never,
		createCredentialStore: async () => fakeCredentialStore() as never,
	};
	return { ...captured, io };
}

describe("runCli dispatch — os 5 entregáveis da Fase 7 são alcançáveis pelo binário real (FR-1..FR-5, FR-12, FR-13)", () => {
	for (const argv of [["login"], ["logout", "anthropic"], ["auth"], ["models"], ["models", "why", "9"]]) {
		it(`\`conductor ${argv.join(" ")}\` não cai no ramo "unknown command" do dispatcher`, async () => {
			const project = createScratchProject();
			try {
				const { io, stdout, stderr } = ioWithModelSeams(project.root);

				await runCli(argv, io);

				const output = stdout() + stderr();
				expect(output).not.toMatch(/unknown command/);
			} finally {
				project.cleanup();
			}
		});
	}

	it("`conductor auth` reporta a origem exata da credencial, incluindo `environment` (FR-5, R46(ii)/T65)", async () => {
		const project = createScratchProject();
		try {
			const { io, stdout } = ioWithModelSeams(project.root);

			const code = await runCli(["auth"], io);

			expect(code).toBe(0);
			expect(stdout()).toMatch(/deepseek: configured \(source: environment\)/);
			expect(stdout()).toMatch(/anthropic: not configured/);
		} finally {
			project.cleanup();
		}
	});

	it("`conductor login` sem provider lista os provedores conhecidos, nunca um erro genérico (FR-2)", async () => {
		const project = createScratchProject();
		try {
			const { io, stdout } = ioWithModelSeams(project.root);

			const code = await runCli(["login"], io);

			expect(code).toBe(0);
			expect(stdout()).toMatch(/anthropic/);
			expect(stdout()).toMatch(/conductor login <provider>/);
		} finally {
			project.cleanup();
		}
	});

	it("`conductor logout <provider>` sem credencial armazenada reporta explicitamente que não havia nada a remover (FR-4/BR-9)", async () => {
		const project = createScratchProject();
		try {
			const { io, stdout, stderr } = ioWithModelSeams(project.root);

			await runCli(["logout", "anthropic"], io);

			expect(stdout() + stderr()).toMatch(/nothing to remove|no stored credential/i);
		} finally {
			project.cleanup();
		}
	});

	it("`conductor models why 15` recusa nomeando o intervalo válido pelo dispatcher real (edge case 8)", async () => {
		const project = createScratchProject();
		try {
			const { io, stdout, stderr } = ioWithModelSeams(project.root);

			const code = await runCli(["models", "why", "15"], io);

			expect(code).not.toBe(0);
			expect(stdout() + stderr()).toMatch(/1-14|1 to 14/);
		} finally {
			project.cleanup();
		}
	});

	it("`conductor models` num projeto sem política nenhuma imprime as 14 linhas com a recusa nomeada, nunca uma tabela vazia (FR-12, edge case 1)", async () => {
		const project = createScratchProject();
		try {
			const { io, stdout } = ioWithModelSeams(project.root);

			const code = await runCli(["models"], io);

			expect(code).toBe(0);
			expect(stdout()).toMatch(/conductor login/);
			for (const gate of [1, 9, 14]) {
				expect(stdout()).toMatch(new RegExp(`gate ${String(gate).padStart(2, "0")}:`));
			}
		} finally {
			project.cleanup();
		}
	});

	it("o USAGE do `--help` documenta os 5 comandos — um comando ausente da ajuda é indistinguível de inexistente para o usuário", async () => {
		const project = createScratchProject();
		try {
			const { io, stdout } = ioWithModelSeams(project.root);

			await runCli(["--help"], io);

			for (const fragment of ["conductor login", "conductor logout", "conductor auth", "conductor models"]) {
				expect(stdout()).toContain(fragment);
			}
		} finally {
			project.cleanup();
		}
	});
});
