/**
 * O composition root da Fase 7 — **começado no Gate 8 como loop-back para o Gate 6** (porque o Gate 6
 * entregou todas as peças — o motor de `@conductor/providers`, a política/trust de
 * `@conductor/config`, a porta de `@conductor/runtime`, os 5 comandos — e **nenhum lugar que as
 * ligasse**) e **fechado agora pelo loop-back D11** (ADR 0008 §21). ADR 0008 §16 chama este ponto pelo
 * nome em três lugares distintos ("only the composition root that eventually calls
 * `createPersistedGateStateStore`...", "o real caller (a CLI composition root, `@conductor/cli`)",
 * "wire implementations via a dependency-injection container at the composition root").
 *
 * Este módulo constrói os colaboradores reais de `login`/`logout`/`auth`/`models`/`models why` **e** da
 * pré-condição de modelo do `gate start` (D4 P1) — deliberadamente os MESMOS, por um único caminho:
 * `models why <gate>` só é um diagnóstico útil da recusa de `gate start <gate>` se as duas passarem
 * pelo mesmo `ResolutionContext` (é o que `model-precondition-enforcement.test.ts` trava).
 *
 * **Quatro decisões conscientes, cada uma declarada em vez de silenciosa:**
 *
 * 1. **Credencial e catálogo são POR-MÁQUINA, nunca do workspace (D10/§8.1, secure-default 65).**
 *    `ModelRuntime.create({allowModelNetwork:false})` sem `authPath`/`modelsPath` cai nos defaults do
 *    Pi (`getAgentDir()/auth.json`, `getAgentDir()/models.json`) — exatamente o que `chat.ts:151` já
 *    faz para a sessão pai, e o que `task.ts` passou a fazer para o filho de delegação. Um clone
 *    hostil não planta catálogo nem credencial que este processo leia.
 * 2. **`AuthStorage` é o ÚNICO escritor de credencial (BR-1/R50/T69).** Nunca um arquivo paralelo à
 *    la `pi-ai/src/cli.ts`. `AuthStorage.create()` (default por-máquina) traz lock `proper-lockfile`
 *    + `0600`/`0700` + escrita atômica de graça.
 * 3. **A política de modelo AGORA tem casa em disco (FR-11, fechada pelo D11).** `.conductor/
 *    config.json`, seção `modelPolicy` — acrescentada ao schema real de `@conductor/config` neste
 *    mesmo loop-back, validada por `resolveProjectModelPolicy`/`parseModelPolicy` (D6/R54: input
 *    repo-supplied, não-confiável). Os três estados de §8.2/§21 são propagados distintamente:
 *    ausente ⇒ modo-compatibilidade (item 4); presente e válida ⇒ cascata normal; presente e
 *    ilegível ⇒ `policyUnreadable` (**nunca** colapsa em "ausente", R49(iii)).
 * 4. **D11/§21 — o modelo flat de sessão é o binding universal quando não há política.** Sem isto,
 *    ligar `evaluateModelPrecondition` de verdade recusaria `conductor gate start N` em **todo**
 *    projeto Conductor existente (nenhum `ModelBinding` built-in jamais existiu), o que §21 classifica
 *    explicitamente como "uma regressão de comportamento, não uma feature de segurança".
 *
 * O trust store é lido do caminho por-máquina irmão do da política (mesma forma de
 * `PolicyTrustStore`/`RoleTrustStore`): ausente ⇒ `isTrusted()` devolve `false` para tudo, que é a
 * direção fail-closed correta (R54(ii): um endpoint não-oficial sem pin nunca é usado).
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	ConfigNotFoundError,
	loadModelPolicyTrustStore,
	type ModelPolicy,
	readConfig,
	resolveProjectModelPolicy,
} from "@conductor/config";
import { computeProjectId } from "@conductor/library";
import {
	type AvailabilityCache,
	buildResolutionContext,
	createAvailabilityCache,
	type ModelRef,
	type ResolutionContext,
	resolveModelForGate,
} from "@conductor/providers";
import type { ModelResolutionPort } from "@conductor/runtime";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PROVIDER_MODEL } from "./init.ts";

/** Os dois seams que `CliIO` expõe (`createModelRuntime`/`createCredentialStore`), com os defaults de
 * produção aqui — mesma convenção de `ChatOptions.createModelRuntime` (`commands/chat.ts:106/148`). */
export async function defaultCreateModelRuntime(): Promise<ModelRuntime> {
	return ModelRuntime.create({ allowModelNetwork: false });
}

export function defaultCreateCredentialStore(): CredentialStore {
	return AuthStorage.create();
}

/**
 * D7: o cache de disponibilidade é **em memória, por processo** — nenhum estado em disco (a superfície
 * que o Gate 3 §7 nomeou explicitamente como gatilho de retorno ao threat model). Um processo de CLI
 * vive um comando, então este cache nasce e morre com ele; `buildResolutionContext` só faz `get()`
 * (nunca `probe()`), de modo que `conductor models` custa **zero** chamada de rede (SLI 7).
 *
 * Sem `probeImpl` injetado, o `defaultProbeImpl` do cache **falha fechado** (nunca afirma
 * reachability sem evidência) — a direção correta enquanto o probe real por provedor (que precisa do
 * endpoint de metadados do catálogo, §9.1) não é fiado. Como este caminho nunca chama `probe()`, isso
 * hoje não muda nenhuma decisão: todo provedor fica `not-probed`, que `resolve.ts` trata como
 * elegível ("sem evidência de problema", D7) — e a chamada real continua sendo o health-check do
 * primário.
 */
export function createCliAvailabilityCache(): AvailabilityCache {
	return createAvailabilityCache();
}

/**
 * Divide o `provider.model` plano da Fase 1 ("provider/modelId") no par que `@conductor/providers`
 * consome. Devolve `undefined` em vez de lançar para uma string malformada: `assertValidConfigShape`
 * já garante a forma no caminho de leitura, então isto é apenas a direção fail-closed para um valor
 * que chegasse por outro caminho — um modelo que não dá pra nomear nunca vira um binding universal.
 * `split` com limite explícito porque um `modelId` legítimo pode conter "/" em alguns provedores.
 */
export function parseFlatProviderModel(flat: string): ModelRef | undefined {
	const separatorIndex = flat.indexOf("/");
	if (separatorIndex <= 0) return undefined;
	const provider = flat.slice(0, separatorIndex);
	const modelId = flat.slice(separatorIndex + 1);
	if (provider.length === 0 || modelId.length === 0) return undefined;
	return { provider, modelId };
}

/** O que o config do projeto contribui para a resolução: a política (nos seus três estados) e o
 * modelo flat de sessão que D11 promove a binding universal quando não há política. */
export interface ProjectModelInputs {
	policy: ModelPolicy | undefined;
	policyUnreadable: string | undefined;
	sessionModel: ModelRef | undefined;
}

/**
 * Lê `.conductor/config.json` e projeta os três estados de §8.2/§21 mais o modelo flat.
 *
 * **Config AUSENTE ⇒ `DEFAULT_PROVIDER_MODEL`** (`init.ts`, o valor exato que `conductor init`
 * grava). Extensão declarada do §21, cuja tabela pressupõe um config existente: um diretório sem
 * `.conductor/` e um projeto recém-`init`ado passam a se comportar de forma idêntica, e nenhum
 * `conductor gate start` que funcionava antes da Fase 7 vira recusa — que é literalmente o objetivo
 * do D11 ("preservado byte a byte"). Não é invenção de referência: é a MESMA constante que o produto
 * já usa como default publicado, no único lugar do monorepo em que ela é definida.
 *
 * **Config PRESENTE mas inválido/ilegível ⇒ `policyUnreadable`**, jamais o default acima: o config é
 * onde a política mora, então um config que não pode ser lido é uma política que não pode ser lida —
 * a direção fail-closed do §8.2 (um config restritivo corrompido nunca deve ler como "sem política").
 */
export function loadProjectModelInputs(workspaceRoot: string): ProjectModelInputs {
	let config: ReturnType<typeof readConfig>;
	try {
		config = readConfig(workspaceRoot);
	} catch (error) {
		if (error instanceof ConfigNotFoundError) {
			return {
				policy: undefined,
				policyUnreadable: undefined,
				sessionModel: parseFlatProviderModel(DEFAULT_PROVIDER_MODEL),
			};
		}
		return {
			policy: undefined,
			policyUnreadable: `.conductor/config.json could not be read (${error instanceof Error ? error.message : String(error)})`,
			sessionModel: undefined,
		};
	}

	const sessionModel = parseFlatProviderModel(config.provider.model);
	const resolved = resolveProjectModelPolicy(config);
	if (resolved.kind === "unreadable") {
		return { policy: undefined, policyUnreadable: resolved.reason, sessionModel };
	}
	if (resolved.kind === "absent") {
		return { policy: undefined, policyUnreadable: undefined, sessionModel };
	}
	return { policy: resolved.policy, policyUnreadable: undefined, sessionModel };
}

/**
 * **GATE 9 (pentest da Fase 7) — achado F-G9-2 / T73 / R54(ii): o pin não pode morar dentro do
 * repositório que ele existe para desconfiar.**
 *
 * Até este fix o trust store de produção era `<workspaceRoot>/.conductor/model-policy-trust.json` —
 * dentro do workspace, não coberto pelo `.conductor/.gitignore` (que só ignora `/sessions/`) e
 * portanto **commitável e clonável**. O pentest provou o resultado end-to-end: um clone que planta a
 * política hostil planta junto a própria aprovação dela, e `models why 9` passa a resolver para o
 * endpoint do atacante. Um pin controlado pelo mesmo ator de quem ele deveria proteger não é um
 * controle — é decoração. (Pior ainda: era o ÚNICO trust store do Conductor ausente de
 * `defaultProtectedPaths()`, então as próprias ferramentas `write`/`edit` do agente podiam
 * auto-concedê-lo — corrigido junto, em `workspace-policy.ts`.)
 *
 * O caminho passa a ser **por-máquina e por-projeto**, reusando LITERALMENTE a convenção que a Fase 6
 * já estabeleceu para o diário (`resolveJournalContext`: `computeProjectId(realpathSync(cwd))` +
 * `~/.conductor/<subsistema>/projects/<projectId>/`) — nenhuma convenção nova é inventada aqui, e o
 * `~/.conductor/providers` inteiro entra em `defaultProtectedPaths()` exatamente como
 * `~/.conductor/{library,diary}` já estão. Isto também alinha o código ao que o ADR 0008 §8.1 já
 * dizia por escrito ("catálogo e credencial ... **por-máquina**") e ao que o cabeçalho deste próprio
 * módulo já afirmava ("o trust store é lido do caminho por-máquina irmão do da política") — a
 * divergência era entre a prosa e a implementação, e o pentest a encontrou pelo lado da prosa.
 *
 * Nenhum pin existente é quebrado por esta mudança: não há (nem nunca houve) comando que conceda um
 * pin, então o conjunto de pins legítimos em produção é vazio por construção.
 */
export function resolveModelPolicyTrustStorePath(workspaceRoot: string, homeDir: string = homedir()): string {
	const projectId = computeProjectId(realpathSync(workspaceRoot));
	return join(homeDir, ".conductor", "providers", "projects", projectId, "model-policy-trust.json");
}

export interface BuildCliResolutionContextOptions {
	workspaceRoot: string;
	modelRuntime: ModelRuntime;
	/** Test seam; produção resolve para o caminho POR-MÁQUINA de
	 * `resolveModelPolicyTrustStorePath` (F-G9-2 — nunca mais um caminho dentro do workspace). */
	trustStorePath?: string;
	/** Test seam (mesma convenção de `CliIO.homeDir`); produção usa o home real da máquina. */
	homeDir?: string;
}

export async function buildCliResolutionContext(options: BuildCliResolutionContextOptions): Promise<ResolutionContext> {
	const trustStorePath =
		options.trustStorePath ?? resolveModelPolicyTrustStorePath(options.workspaceRoot, options.homeDir);
	const { policy, policyUnreadable, sessionModel } = loadProjectModelInputs(options.workspaceRoot);
	const ctx = await buildResolutionContext({
		workspaceRoot: options.workspaceRoot,
		modelRuntime: options.modelRuntime,
		policy,
		...(sessionModel !== undefined ? { sessionModel } : {}),
		trust: loadModelPolicyTrustStore(trustStorePath),
		availability: createCliAvailabilityCache(),
	});
	// `policyUnreadable` é definido AQUI (não dentro de `buildResolutionContext`, que recebe uma
	// política já parseada) porque quem sabe distinguir "não havia seção" de "havia e não parseia" é
	// este composition root, que leu o arquivo. §8.2/R49(iii): `resolveModelForGate` refuta com
	// `policy-unreadable` antes de qualquer outra etapa, inclusive antes do fallback universal.
	return policyUnreadable !== undefined ? { ...ctx, policyUnreadable } : ctx;
}

/**
 * O adapter real da porta que `@conductor/runtime` declara (`ModelResolutionPort`, D4/§16) — a peça
 * que faltava para `evaluateModelPrecondition` deixar de ser código morto.
 *
 * `resolveForGate` é SÍNCRONO por contrato (§16), e é por isso que o `ResolutionContext` é construído
 * antes, na borda async: D3's "I/O nas bordas, política no meio", de ponta a ponta.
 */
export function createCliModelResolutionPort(ctx: ResolutionContext, activeProvider?: string): ModelResolutionPort {
	return {
		// F-G9-3/T66/R47 (Gate 9 pentest): `activeProvider` anchors the same-provider egress floor
		// (BR6). It was absent here, so stage 7's cross-provider region was permanently empty and a
		// repo-supplied policy could route a MANDATORY gate to another provider -- satisfied by a merely
		// ambient `source:"environment"` credential, the literal shape of the DEEPSEEK_API_KEY incident
		// -- with no `consent-required` refusal. The request-level default must never be "no anchor":
		// with no anchor there is no boundary to cross, and BR6 silently evaporates.
		resolveForGate: (request) => {
			// An explicit `activeProvider` on the request always wins; the injected one is the default a
			// caller that does not know the project (e.g. `evaluateModelPrecondition`, whose contract is
			// `{gate, purpose}` only) would otherwise leave empty.
			const anchor = request.activeProvider ?? activeProvider;
			return resolveModelForGate({ ...request, ...(anchor !== undefined ? { activeProvider: anchor } : {}) }, ctx);
		},
	};
}

/**
 * O provedor que o projeto realmente escolheu (`provider.model` da Fase 1), que ancora o piso do
 * mesmo-provedor (BR6/R47). Lido pela mesma função que o resto deste módulo já usa, de modo que
 * "qual é o provedor ativo" tem uma definição só.
 */
export function resolveActiveProvider(workspaceRoot: string): string | undefined {
	return loadProjectModelInputs(workspaceRoot).sessionModel?.provider;
}

/**
 * Constrói a porta real para o caminho de `gate start` (D4 P1), **sempre** — nunca atrás de um campo
 * opcional que a produção não preenche (§21: "`evaluateModelPrecondition` passa a ser chamado
 * incondicionalmente a partir do composition root").
 *
 * Se a construção do `ModelRuntime` falhar (um `~/.pi/agent/models.json` corrompido, por exemplo), a
 * porta degrada para uma que RECUSA, nunca para uma que aprova (R49(iii): um erro jamais lê como
 * permissão) e nunca para a ausência de porta. O impacto fica contido em `gate start`, o único
 * consumidor da porta — `gate status`/`evidence`/`approve` seguem funcionando.
 */
export async function createGateModelResolutionPort(options: {
	workspaceRoot: string;
	createModelRuntime: () => Promise<ModelRuntime>;
	/** Test seam (`CliIO.homeDir`); produção usa o home real — onde o trust store por-máquina vive. */
	homeDir?: string;
}): Promise<ModelResolutionPort> {
	try {
		const modelRuntime = await options.createModelRuntime();
		const ctx = await buildCliResolutionContext({
			workspaceRoot: options.workspaceRoot,
			modelRuntime,
			...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
		});
		// F-G9-3: `gate start` é o ponto de autorização (D4 P1) — é exatamente onde o piso do
		// mesmo-provedor precisa de âncora, não só o comando de relatório.
		return createCliModelResolutionPort(ctx, resolveActiveProvider(options.workspaceRoot));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			resolveForGate: (request) => ({
				resolved: false,
				refusal: { kind: "policy-unreadable", gate: request.gate, detail: `model runtime unavailable: ${detail}` },
				trace: { gate: request.gate, at: new Date().toISOString(), steps: [] },
			}),
		};
	}
}
