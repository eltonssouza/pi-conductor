# ADR 0008 — Fase 7 (Model routing e provedores): **dois eixos de tier que nunca se fundem** (`ModelRole` intocado + `GateModelRole` novo, com camada anticorrupção para os 7 nomes do plano), o pipeline de resolução como uma **função pura que devolve um valor de ausência explícita e um rastro sempre presente**, recusa fail-closed imposta em **três pontos de autorização de trabalho**, fallback como **dois pisos ANDados que a máquina expõe em vez de resolver**, política de modelo como **input não-confiável com TOFU sobre a metade que carrega autoridade**, health-check **sob demanda em memória, nunca no caminho quente**, e um ledger de custo cuja **proveniência de preço** — não o valor — decide se o custo é conhecido

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-07
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 7 — Model routing e provedores` (`plano_desenvolvimento.md` linhas 1404-1429, lidas junto
  com §4.15 "Modelos e provedores", §4.1/§4.3, §9.4/§9.5, §10 invariantes 5/16/17 e §14 riscos), branch
  `feature/fase7-model-routing-e-provedores` (de `develop`)
- **Autor (papel):** `software-architect`
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças criam um ADR sucessor, não editam este. **Este ADR NÃO
  supersede o ADR 0004 §16.** O tipo `ModelRole` (`"strategic" | "standard" | "lightweight"`,
  `role-loader.ts:44`) permanece **literalmente** como está — mesma cardinalidade, mesmos valores, mesma
  semântica ("a intensidade pretendida de um papel"). A camada de resolução desta fase é construída **por
  cima** dele, com um tipo **novo e separado** (`GateModelRole`, D1), nunca por reinterpretação silenciosa do
  travado. Da Fase 4 (ADR 0005) nada é reaberto: `GateState`, `GateRecord`, `GateStatus`, `evaluateAdvance`,
  `isMandatorySatisfied`, `resolveEvidenceRef` e `hasSufficientEvidenceForMandatoryGate` permanecem
  **inalterados** — a recusa desta fase **compõe** ao lado deles, no adaptador de CLI que a própria Fase 4
  estabeleceu como seu ponto de composição (D4). Três **adições** a código herdado são declaradas
  explicitamente em §14.2 (duas entradas em `defaultProtectedPaths()`, uma linha de `export` no pacote
  vendor) — adições, não mudanças de forma.

- **Insumo herdado (código aberto e lido nesta sessão, não presumido):**
  - **ADR 0004 §2/§16** (Fase 3) — `ConductorRole`/`ModelRole` travados; a frase "(e) o `model` resolvido a
    partir do `modelRole` do papel" (§2, linha 109) que descreve uma resolução **que nunca foi construída**;
    e §15: *"**Fase 7:** model routing avançado (o `modelRole` desta fase é a indirection simples)"*.
  - **ADR 0005 §18** (Fase 4) — o contrato travado da máquina de gates; `MANDATORY_GATES = {3,5,7,8,9}`
    (`builtin-roles-data.ts:305`), `TOTAL_FLOW_GATES = 14` (`gate-state-store.ts:291`), `evaluateAdvance`/
    `evaluateCalibration`/`isMandatorySatisfied` (`gate-state-policy.ts:141/153/191`), e o **ponto de
    estrangulamento real** de toda transição de gate: `createPersistedGateStateStore`
    (`gate-store.ts:151`), cujos cinco métodos mutantes passam todos por `readOrBootstrap` (`:82`) e já
    lançam `GateCommandError` de dentro do `mutate` como canal de recusa (`:166-172`, `:198`, `:248`).
  - **ADR 0006 §12/D8** (Fase 5) — a **regra de dependência port+adapter** (`@conductor/runtime` declara a
    porta, o pacote de domínio é o adaptador, a CLI injeta) e o **molde de ledger append-only**:
    `grounding-ledger.ts` (writer síncrono que **lança** em I/O + reader que **nunca lança**, `mode: 0o600`,
    linha corrompida pulada, escopo por `projectId`), `library-home.ts` (`~/.conductor/<dominio>/projects/
    <projectId>/`), e o protected-path D9.
  - **ADR 0007 §6/§11/§12.4** (Fase 6) — o precedente **direto** desta fase em três pontos: o log
    autoritativo **por-máquina** como decisão de segurança (não convenção), a tabela de SLI/SLO com a
    distinção honesta "SLO de latência × invariante com error-budget zero", e a disciplina de declarar em
    §12.4 exatamente **quais** linhas de código travado mudam.
  - **Gate 2 spec Fase 7** (`docs/conductor/gate2-spec-fase7.md`) — 8 goals (G1–G8), 23 FR (grupos A–H), 10
    BR, 9 edge cases, 8 questões abertas (§9) roteadas para este gate.
  - **Gate 3 addendum Fase 7** (`docs/conductor/gate3-addendum-fase7.md`) — 9 ameaças (T65–T73), as **9
    regras vinculantes R46–R54** (§4), os secure-defaults 55–63, os 4 GAPs (7A–7D) e as duas resoluções de
    OQ#2/OQ#3. **É o insumo vinculante desta fase.**
  - **Substrato vendor, lido verbatim:** `model-resolver.ts:606-700` (`findInitialModel`, com o passo 4 —
    numerado 4 no código, "5" na prosa da spec — que é a causa raiz de T65), `:382-410` (`resolveCliModel`),
    `:20` (`defaultModelPerProvider`); `model-runtime.ts:388/392/418/458/528/541/549/553`
    (`getModels`/`getModel`/`getAvailableSnapshot`/`hasConfiguredAuth`/`setRuntimeApiKey`/
    `removeRuntimeApiKey`/`listCredentials`/`getProviderAuthStatus`); `runtime-credentials.ts:12-22`
    (**o achado F2 abaixo**); `auth-storage.ts:228-378` (`AuthStorage`, `proper-lockfile`, `0600`/`0700`);
    `model-config.ts:141-208` (o schema de `models.json`: `baseUrl`, `apiKey` **inline**, `cost` opcional);
    `provider-composer.ts:157` (**o achado F1 abaixo**); `types.ts:761-808` (`ModelCostRates`/`Model`);
    `env-api-keys.ts:68-145`; `task.ts:501-551` (o incidente `DEEPSEEK_API_KEY` documentado + o
    `agentDir = join(input.workspaceRoot, ".conductor-agent")` — **o achado F3 abaixo**);
    `chat.ts:260-276/325-332/342-365` (o seam `--role`); `session.ts:42-166` (`CreateConductorSessionOptions`,
    `model: Model<any>` obrigatório); `shared-budget.ts:31-68`; `workspace-policy.ts:129-170`
    (`defaultProtectedPaths`); `terminal-sanitize.ts:62` (`sanitizeForTerminal`).

- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, `CLAUDE.md` Gate 4):** §13 reconcilia ponto a ponto com
  R46–R54; §14 fecha as 4 GAPs e as 8 questões abertas da spec; **§15 devolve ao Gate 3 três superfícies
  novas que este gate expõe** — duas delas **descobertas lendo código**, não deduzidas do documento (F1/F3
  abaixo) — todas mitigadas inline por secure-default e roteadas para verificação empírica no Gate 9.

---

## 1. Contexto

### 1.1 Os três achados de código que reorganizam este ADR

Antes de qualquer decisão: a spec do Gate 2 e o addendum do Gate 3 fizeram **três suposições sobre o
substrato** que a leitura do código **contradiz**. Nenhuma é fatal; todas mudam o desenho. Registrá-las é
parte do trabalho deste gate — não contorná-las em silêncio.

| # | A suposição | O que o código diz | Consequência de desenho |
|---|---|---|---|
| **F1** | FR-23/BR-10 pressupõem "uma tabela de preço por modelo" cuja **ausência** é detectável — "custo desconhecido, nunca zero". | `Model.cost` é um campo **obrigatório** (`types.ts:792`), e `provider-composer.ts:157` preenche um modelo declarado em `models.json` **sem** bloco `cost` com `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`. **A ausência de preço já chega ao runtime indistinguível de "de graça".** | O ledger **não pode ler `Model.cost` como verdade de preço**. `priced` tem que vir da **proveniência do catálogo** (o par `(provider, id)` existe no catálogo gerado do vendor?), não do valor. **D9.** |
| **F2** | FR-1/FR-3 e BR-1 pressupõem compor `login`/`logout` sobre `ModelRuntime.setRuntimeApiKey`/`removeRuntimeApiKey` para **persistir**/**remover** credencial. | `RuntimeCredentials` (`runtime-credentials.ts:12-22`) é um **overlay em memória**: `setRuntimeApiKey` grava num `Map` do processo; `removeRuntimeApiKey` **apaga só o override** e **não toca `auth.json`**. Um `logout` assim implementado é **exatamente** a "credencial-fantasma" que FR-3/BR-9/T72 proíbem. Pior: `@earendil-works/pi-coding-agent` **não exporta** a classe `AuthStorage` (`index.ts:26` exporta apenas `readStoredCredential`) — não há, hoje, caminho **público** de escrita persistente. | Compor sobre o `CredentialStore` endurecido exige **alargar em uma linha** o export do pacote vendor — estritamente melhor do que a única alternativa (uma segunda implementação de storage, proibida por BR-1/R50). **D8.** |
| **F3** | T73 modela "política repo-supplied com `baseUrl` hostil" como um risco **futuro**, a ser evitado pela escolha de path do Gate 4. | Já existe em código: `createGovernedChildSessionSpawner` (`task.ts:541-547`) constrói o `ModelRuntime` do filho com `authPath`/`modelsPath` = `join(input.workspaceRoot, ".conductor-agent", …)` — **dentro do workspace**, e `.conductor-agent` **não** está em `defaultProtectedPaths()`. Um clone que carregue `.conductor-agent/models.json` declarando um provedor `openai-compatible` com `baseUrl` do atacante **e `apiKey` inline** (ambos permitidos pelo schema, `model-config.ts:195-196`) é T73 materializado. Hoje é **inerte** porque o fix GAP-5 da Fase 3 herda o modelo do pai por referência; **deixa de ser inerte no minuto em que esta fase resolve modelo por papel.** Simetricamente: `getAgentDir()` (`~/.pi/agent/`, `config.ts:515-521`) guarda `auth.json` **e** `models.json` e **também não** é protected-path — `~/.ssh`, `~/.aws`, `~/.config` e `~/.conductor/{library,diary}` são; `~/.pi` não. | Dois protected-paths novos + o spawner do filho deixa de apontar para dentro do workspace. **D10**, e **loop-back ao Gate 3** (§15). |

### 1.2 O fato dominante herdado, e a torção da Fase 7

O fato dominante das Fases 0–6 continua: **um único processo de SO, sem sandbox, com o privilégio do
usuário**; toda garantia é **política dentro de um processo confiado**.

A torção que o Gate 3 nomeou (§0 do addendum) e que organiza este ADR: **a resolução de modelo é uma decisão
de autorização, não uma escolha de conveniência.** Ela responde "qual modelo, de qual provedor, com qual
credencial, está autorizado a executar este gate" — e três das cinco etapas do pipeline consomem input que
não é confiável (a política repo-supplied, a resposta de disponibilidade de um provedor externo, e um pool
que pode incluir uma credencial **ambiente** que ninguém pretendeu autorizar).

Três consequências, e nenhuma delas é sobre desempenho de roteamento:

1. **A Fase 7 constrói exatamente o mecanismo que o comentário do fix da Fase 3 nomeia como condição para
   fechar o buraco de verdade** — e, ao construí-lo, cria um **caminho primário** que a herança-por-referência
   não cobre. Se o ramo "`modelRole` sem mapeamento" reusar `findInitialModel` passo 4
   (`model-resolver.ts:681-696`), o incidente `DEEPSEEK_API_KEY` **reabre na fonte** (T65). Toda a §5/D3
   existe para que esse ramo **não exista**: não há "ramo sem mapeamento" que produza um modelo — há um
   **valor de ausência** (D4).
2. **Toda saída desta fase é egress.** Fallback (Grupo F) e health-check (Grupo G) existem para tocar
   **outros** provedores. A pergunta padrão do Gate 3 (`CLAUDE.md` BR6) é respondida **sim, por construção** —
   logo o consentimento não é um caso especial, é o caminho normal (D5/D7).
3. **O produto desta fase é uma decisão, e uma decisão precisa ser explicável.** `models why <gate>` não é
   um comando de conveniência: é o mecanismo pelo qual uma recusa fail-closed deixa de ser uma parede e
   passa a ser um diagnóstico acionável. Por isso o **rastro é parte do tipo de retorno da resolução**, não
   um efeito colateral de logging (D3).

### 1.3 Atributos de qualidade priorizados para esta decisão

Ordenados. A ordem **é** a decisão; ela resolve os empates abaixo.

1. **Não-autorização por acidente.** Nenhum modelo executa sem ter sido **explicitamente** autorizado. A
   presença de uma credencial **habilita**; nunca **autoriza**. Vence conveniência, vence "fazer o laço
   avançar", vence paridade com o comportamento default do vendor.
2. **Fail-closed em toda a cascata.** Ausência, erro, timeout, config ilegível, provedor mudo — todos
   colapsam para "indisponível/ausente", nunca para "prossiga". Um erro nunca lê como permissão.
3. **Explicabilidade da decisão.** Uma recusa que não diz **onde** a cadeia parou é uma recusa que o usuário
   vai contornar desligando o mecanismo. O rastro é parte do contrato, não do log.
4. **Contenção entre domínios de confiança.** Catálogo/credencial (por-máquina, endurecido) ≠ política de
   roteamento (workspace, repo-supplied, não-confiável) ≠ ledger (observabilidade derivada) ≠ `SharedBudget`
   (autorização de gasto). Um vazamento aqui é o dano que R46/R50/R54 existem para impedir.
5. **Baixa complexidade acidental (Ousterhout).** Nenhum cliente HTTP de provedor novo, nenhum backend
   Docker, nenhum poller em background, nenhum motor de política novo, nenhum segundo canal de
   consentimento, nenhum segundo log de egress. Reuso do que já existe — inclusive dos **erros** já
   cometidos e corrigidos.

*Grounding:* **Managing Software Complexity §3.1** (0.643 nesta sessão: *"information hiding and defining
errors out of existence"* — a razão de a ausência ser um **valor de retorno modelado** em vez de uma exceção
que cada chamador tem que lembrar de tratar) e **§2.12** (0.615: *"when not to deepen a module"* — a razão de
o ledger não virar um terceiro pacote e de o health-check não virar um subsistema reativo);
**Security Engineering Principles §2.2/§2.12** (herdado do Gate 3, 0.634: fail-closed no caminho de
autorização) para o item 2.

---

## 2. Decisão central, e o mapa D1–D10

**O roteamento de modelo é uma decisão de autorização expressa como uma função pura sobre dois eixos de tier
que nunca se fundem, que devolve ou um `Model` explicitamente autorizado por uma política deliberada, ou uma
ausência tipada acompanhada do rastro de onde a cadeia parou — e que, quando os dois pisos independentes
(tier mínimo e mesmo-provedor) não podem ser satisfeitos ao mesmo tempo, expõe o conflito ao humano em vez de
o resolver em silêncio.**

Tudo o mais decorre disso. As dez decisões:

| # | Decisão | Fecha / responde |
|---|---|---|
| **D1** | **Dois eixos, nunca um.** `ModelRole` (3 valores) **intocado**; `GateModelRole` **novo** (4 valores = a tabela do `CLAUDE.md`, 1:1); os 7 nomes do plano §4.15 entram por uma **camada anticorrupção** explícita, nunca como um terceiro enum; piso efetivo = `max(rank do gate, rank da persona)` | spec §9 questão 1 (OQ#1), BR-7, G3 |
| **D2** | **Pacote novo `@conductor/providers`** para o motor; a **política** em `@conductor/config`; a **porta** em `@conductor/runtime`; a **injeção** na CLI (port+adapter, ADR 0006 D8) | spec §9 questão 4 (OQ#4), OQ#6 |
| **D3** | O pipeline é `resolveModelForGate(...) → ModelResolution` — **valor, nunca exceção**; o `ResolutionTrace` é **parte do retorno**, resolvida ou não; determinístico (FR-6) | Grupos B/C, FR-6..13 |
| **D4** | **Recusa fail-closed imposta em três pontos de autorização de trabalho** (abertura de gate, delegação `task`, composição de sessão), pelo canal de recusa que a Fase 4 já tem; `gate-state*.ts` **inalterados** | **GAP-7A / T68 / R49**, FR-14/15 |
| **D5** | **Fallback = dois pisos ANDados**; veto **absoluto** nos 5 obrigatórios, **opt-in default-deny** nos outros 9; consentimento pelo `ConfirmChannel` da Fase 4, TTY-gated; backoff/cooldown com números concretos declarados como **defaults sintonizáveis** | **GAP-7B / T66/T67 / R47/R48**, FR-16..19, edge 6 |
| **D6** | **A política de modelo é input não-confiável**: roteamento no workspace (`.conductor/config.json`), catálogo/credencial **por-máquina**; **remap descendente** e **`baseUrl` custom** exigem pin TOFU; o resolvedor **nunca** lê um `models.json` do workspace | **GAP-7C / T73 / R54**, FR-11, edge 9 |
| **D7** | **Health-check sob demanda, cache em memória com TTL, probe barato com timeout duro**, nunca no caminho quente do turno, nunca contra endpoint não-confiado antes do pin; **é egress e vai para o audit trail** | **GAP-7D / T70 / R51**, FR-20/21, edge 5 |
| **D8** | **`login`/`logout`/`auth`/`models`/`models why`** compostos sobre `ModelRuntime` + o `CredentialStore` endurecido — com **uma linha** de export a mais no vendor (F2), nunca uma segunda implementação; `auth` e `models` permanecem **distintos** | Grupos A/D, spec §9 questão 7, **F2** |
| **D9** | **Ledger de uso/custo** em `@conductor/providers`, JSONL append-only por-máquina protected-path; `costUsd: number \| null` + `priced` decidido pela **proveniência do catálogo**, nunca pelo valor de `Model.cost` (**F1**); `SharedBudget` intocado | BR-6/BR-10, T71/R52, spec §9 questão 6, **F1** |
| **D10** | **Dois protected-paths novos** (`getAgentDir()`, `<workspaceRoot>/.conductor-agent`) e o spawner do filho deixa de apontar catálogo/credencial para dentro do workspace | **F3**, T69/T73, loop-back §15 |

---

## 3. D1 — Dois eixos de tier que nunca se fundem

### 3.1 O achado, reafirmado com precisão

Existem hoje **três** vocabulários, mas **não** três eixos. O `CLAUDE.md` já declara a separação real:

> *"A persona's tier (strategic/standard/lightweight) says how strong a model that **expert** wants. It does
> not say what the **work** needs — Gate 1 (discovery) and Gate 8 (review) are different workloads even when
> the same persona runs them. A model role is that second axis."*

Logo:
- **Eixo 1 — intensidade da persona.** `ModelRole` (`strategic|standard|lightweight`), travado no ADR 0004
  §16, carregado hoje pelos **37** papéis built-in (verificado: 14 `strategic`, 21 `standard`, 2
  `lightweight` nos frontmatters de `templates/agents/*.md`).
- **Eixo 2 — carga de trabalho do gate.** A tabela de 14 linhas do `CLAUDE.md` (`@plan|@slow|@default|@smol`),
  hoje prosa, que G3/FR-9 tornam executável.
- **A lista de 7 do plano §4.15** (`strategic/planning/standard/fast/lightweight/security/review`) **não é um
  terceiro eixo**: é o **eixo 2 escrito com granularidade diferente e contaminado por três nomes do eixo 1**.
  `planning`, `security` e `review` são rótulos de **carga de trabalho** (o que o gate faz), não de
  intensidade de persona; `strategic`/`standard`/`lightweight` são literalmente os três nomes do eixo 1
  aparecendo num lugar onde não pertencem; `fast` é `lightweight` de novo, por um terceiro nome.

### 3.2 A decisão

1. **`ModelRole` permanece exatamente como está** — 3 valores, mesma semântica, ADR 0004 §16 **não
   superseded**. Nenhum dos 37 frontmatters muda.
2. **Um tipo novo e separado carrega o eixo 2:**
   ```ts
   export type GateModelRole = "plan" | "slow" | "default" | "smol";
   ```
   4 valores, **1:1 com a tabela do `CLAUDE.md`** — a fonte que FR-9 tem que tornar executável. Escolher
   qualquer outra cardinalidade aqui criaria, por construção, a **segunda fonte de verdade** que BR-7 existe
   para impedir: a tabela não poderia mais ser transcrita sem tradução.
3. **Os 7 nomes do plano entram por uma camada anticorrupção explícita, nunca como enum:**
   ```ts
   export function normalizePlanModelRole(name: string):
     | { ok: true; role: GateModelRole; alias: boolean }
     | { ok: false; reason: "unknown-model-role"; known: readonly string[] };
   ```
   com a tabela **declarada, testável e diagnosticável**: `planning→plan`, `strategic→slow`, `review→slow`,
   `security→slow`, `standard→default`, `fast→smol`, `lightweight→smol`. Um alias aceito emite um
   **diagnóstico nomeando o valor canônico** (nunca uma tradução silenciosa — BR-7).
4. **O nome `security` não sobrevive como tier, e isso é declarado em voz alta.** O critério de saída literal
   do plano ("Gate 9 requer `security`; nenhum configurado → execução recusada") é preservado **no
   mecanismo**, não no rótulo: Gate 9 → `slow`; sem modelo ligado a `slow` → recusa nomeando gate **e**
   papel. O que se perderia — "quero um modelo *especificamente* de segurança no Gate 9, diferente do
   reasoner que uso no Gate 8" — é recuperado sem enum novo e sem sistema de tags, pelo **override de modelo
   por-gate** da política (D6): `gates: { "9": { model: "anthropic/…" } }`. Um campo opcional fecha o caso
   real; um quinto tier ou um sistema de capability-tags que ninguém popula seria complexidade acidental
   (Managing Software Complexity §2.12).
5. **Como os dois eixos se combinam — a regra `max`, que o próprio `CLAUDE.md` já escreve:**
   > *"A role's Model above is the most expensive role among the gates it serves: one that ever reviews
   > should degrade to the reasoner, never to the cheap model."*

   Formalizado: um `rank` inteiro por `GateModelRole` (`smol=0, default=1, plan=2, slow=3`) e uma projeção do
   eixo 1 nele (`lightweight→0, standard→1, strategic→2`); o **piso efetivo** de uma resolução é
   `max(rank(gate), rank(persona))`. Um `security-engineer` (`strategic`, rank 2) rodando o Gate 11
   (`@default`, rank 1) resolve com piso 2 — nunca cai para o modelo barato.
6. **O `rank` é um default declarado, não uma verdade descoberta.** A ordem `smol<default<plan<slow` é uma
   escolha deste ADR e é **sobreponível pelo operador** por binding (`rank?: number` na política). *Grounding:*
   **Solution Architecture §2.12** (0.593 nesta sessão: requisitos "filled with figures invented under
   pressure, which are then treated as constraints for the life of the system" — um número inventado que não
   se pode corrigir é pior que nenhum).

*Grounding:* **Domain-Driven Design §2.4 "contexts as integration units"** (**0.737** — o hit mais forte
desta sessão: contextos com modelo e linguagem próprios integrados por **contrato publicado + camada
anticorrupção**; é literalmente o desenho de `normalizePlanModelRole`) e **§2.3** (0.669: *"trying to force
one universal model across teams produces a brittle, over-coupled system where every change ripples
everywhere"* — a razão de **não** fundir os dois eixos num enum de 7).

### 3.3 Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Estender `ModelRole` para os 7 valores do plano** | Supersede ADR 0004 §16 (custo alto e desnecessário); força reexame dos 37 frontmatters; e — o argumento decisivo — **funde dois eixos que o `CLAUDE.md` já separou por design**. `security` como *intensidade de persona* é incoerente: o `security-engineer` já declara `strategic`; "quão forte" e "que trabalho" não são a mesma pergunta. |
| **Manter só 3 valores e mapear gate→`ModelRole` direto** | Faz `@plan` e `@slow` colapsarem no mesmo `strategic`, destruindo a distinção que a tabela do `CLAUDE.md` faz entre Gate 1 (planejar) e Gate 8 (revisar) — e que é a razão de a tabela existir. Perde a indireção por-projeto que o `CLAUDE.md` chama de *"indirection **you** control"*. |
| **`GateModelRole` com os 7 valores do plano** | Impede a transcrição 1:1 da única tabela que existe de verdade (14 linhas, `CLAUDE.md`), criando a segunda fonte de verdade de BR-7 — o erro exato que este achado denuncia. Três dos sete (`strategic/standard/lightweight`) seriam homônimos do eixo 1 dentro do mesmo sistema. |
| **Enum de 4 + sistema de capability-tags (`security`, `review`) ANDado ao rank** | O mecanismo mais expressivo, e o único candidato sério. Rejeitado por Ousterhout: tags só valem se alguém as popular, e nada no produto hoje as popula — seria interface nova, custo de configuração novo, e um caminho de "tag ausente" que ou é fail-open (inaceitável) ou torna todo projeto não-configurado imediatamente inoperante. O override de modelo por-gate (item 4) resolve o caso concreto com um campo opcional. |

---

## 4. D2 — Onde isto vive: `@conductor/providers` novo, política em `@conductor/config`, porta em `@conductor/runtime`

### 4.1 O achado de path, resolvido

A feature matrix da Fase 0 nomeia `extensions/model-router` e `packages/providers`. **Nenhum dos dois existe**
nesta convenção: não há `extensions/` em lugar nenhum do repo, e a convenção real é `conductor-*`
(`conductor-cli`, `conductor-config`, `conductor-diary`, `conductor-library`, `conductor-project`,
`conductor-runtime`, `conductor-secrets`). A matriz descreve uma intenção, não este layout.

### 4.2 A decisão — quatro pacotes, cada um pela razão certa

| Pacote | O que ganha | Por quê |
|---|---|---|
| **`@conductor/config`** (existente) | `ModelPolicy` (tipos + parse + validação), `normalizePlanModelRole`, `ModelPolicyTrustStore` (TOFU), extensão de `secret-detection` para recusar `apiKey` inline | Já é o dono de `.conductor/config.json`, de `policy-loader.ts`, de `policy-trust-store.ts` e de `secret-detection.ts`. É onde "config repo-supplied é input não-confiável" **já mora**. E é **dado puro**: nenhuma dependência de `pi-ai`/`pi-coding-agent` entra aqui — `role-loader.ts` documenta no próprio cabeçalho que evita deliberadamente essa dependência, e o loop-back do Gate 8 da Fase 6 já estabeleceu esse critério como decisivo ao mover a redação para `@conductor/secrets`. |
| **`@conductor/providers`** (**novo**) | O motor: `resolveModelForGate`, o catálogo/credencial view, o prober de disponibilidade, o construtor de `ResolutionTrace`, o ledger de uso | **Precisa** de `@earendil-works/pi-ai` (`Model`, `builtinProviders` via o subpath público `pi-ai/providers/all`) e de `pi-coding-agent` (`ModelRuntime`). É um **módulo profundo com interface estreita**: ~40 provedores, catálogo composto, prioridade de credencial e disponibilidade atrás de três funções. |
| **`@conductor/runtime`** (existente) | A **porta** `ModelResolutionPort` (interface, sem implementação) + a imposição fail-closed nos pontos de trabalho (D4) | Regra de dependência: a seta aponta para dentro. O runtime **declara** o que precisa e **nunca importa** `@conductor/providers` — exatamente o padrão port+adapter de ADR 0006 D8 (o runtime declara a port da Library, a Library é o adapter, a CLI injeta). |
| **`@conductor/cli`** (existente) | Os 5 comandos + a injeção do adaptador nos pontos de composição | Composition root, como em todas as fases anteriores. |

*Grounding:* **Managing Software Complexity §3.1/§3.3** (0.643/0.615: *information hiding*, "hiding vs.
leakage" — um pacote novo se justifica quando esconde profundidade atrás de uma interface estreita, não
quando só move arquivos) e **§2.12** (0.615: *"when not to deepen a module"* — a razão de o ledger **não**
virar um terceiro pacote, §11). Precedente interno mais forte que a citação: o loop-back do Gate 8 da Fase 6,
que moveu código para o pacote-folha certo precisamente para não arrastar `pi-agent-core`/`pi-ai`/
`pi-coding-agent` para um pacote que não os queria.

### 4.3 Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Tudo em `@conductor/runtime`** | O runtime já tem 17 módulos + `tools/`; ganharia uma segunda responsabilidade não relacionada. Pior: tornaria o motor de resolução **não testável sem a pilha de sessão inteira**, matando a possibilidade de testes RED puros no Gate 5. |
| **Tudo em `@conductor/config`** | Arrasta `pi-ai`+`pi-coding-agent` como dependências reais para um pacote deliberadamente livre delas — o erro exato que o Gate 8 da Fase 6 corrigiu. |
| **Um `@conductor/model-router` + um `@conductor/cost` separados** | Dois pacotes onde um basta; a interface entre eles seria maior que o código que esconderiam. Complexidade acidental. |
| **Manter tudo na CLI** | Torna o motor inalcançável pelo `task` tool (runtime) sem inverter a dependência CLI→runtime. |

---

## 5. D3 — O pipeline: um valor de ausência tipado e um rastro que sempre existe

### 5.1 O contrato (completo em §16)

```ts
export function resolveModelForGate(request: ResolveModelRequest, ctx: ResolutionContext): ModelResolution;
```

- **Puro sobre um snapshot.** `ResolutionContext` carrega um **snapshot já lido** (política validada,
  catálogo, status de credencial por provedor, mapa de disponibilidade) — nenhum I/O acontece dentro de
  `resolveModelForGate`. Todo I/O é da borda (`buildResolutionContext`, async). É o mesmo split "I/O nas
  bordas, política no meio" que `role-loader.ts` e `policy-loader.ts` já documentam.
- **Nunca lança.** O retorno é `{resolved:true, …} | {resolved:false, refusal, …}` (R49(i)).
- **O rastro é parte do retorno, sempre** — inclusive no sucesso. É o que `models why` imprime, é o que o
  audit trail registra numa recusa, e é a razão de a explicabilidade não depender de um logger.
- **Determinístico (FR-6).** Empate entre candidatos é resolvido por uma ordem **declarada**: (1) ordem de
  declaração na política do projeto; (2) ordem de declaração na política do usuário; (3) `provider` e depois
  `modelId` em ordem lexicográfica. Nunca "o primeiro que o `Map` devolveu".

### 5.2 As seis etapas, e o que cada uma pode recusar

O pipeline do plano §4.15 (`Gate → Model role → Política do projeto → Modelos configurados → Disponibilidade
→ Modelo selecionado`), com uma etapa a mais que o plano não nomeia mas que T65 exige (**autorização**,
separada de **credencial**):

| # | Etapa | O que faz | Recusa possível |
|---|---|---|---|
| 1 | **Gate → papel** | `gate ∈ 1..14` → `GateModelRole`, do default built-in ou do override do projeto (FR-9/FR-11) | `unsupported-gate` (fora de 1–14, edge 8); `no-gate-mapping` (FR-10) |
| 2 | **Piso efetivo** | `max(rank(gate), rank(persona))` (D1.5) | — (nunca recusa; produz um número) |
| 3 | **Política → bindings** | os `ModelBinding[]` ligados àquele papel, na ordem declarada | `no-binding-for-role` (FR-8/FR-14) |
| 4 | **Validação de catálogo + autorização** | cada binding é resolvido contra o catálogo **conhecido**; `baseUrl` custom / provedor fora do catálogo exige pin TOFU (D6/R54); **nenhum candidato entra por auto-descoberta** (R46/T65) | `unknown-model`, `unknown-provider`, `untrusted-endpoint` |
| 5 | **Credencial** | `getProviderAuthStatus(provider)` → `{configured, source}`; **`source:"environment"` é reportado mas nunca autoriza sozinho** — só conta se o binding já autorizou o par (provider, model) | `no-credential` (nomeando os provedores e a origem que faltou) |
| 6 | **Disponibilidade** | descarta candidatos **em cooldown**; **não** exige probe positivo do primário (D7) | `all-candidates-unavailable` |
| 7 | **Seleção / pisos** | aplica os dois pisos ANDados (D5) | `below-tier-floor`, `consent-required`, `both-floors-unsatisfiable` |

**A etapa 4 é a que fecha T65 na fonte.** Não existe, em nenhum ponto deste pipeline, um ramo que produza um
`Model` a partir de "existe uma credencial para algum provedor". `findInitialModel` **não é chamado** por
este caminho; `resolveCliModel`/`parseModelPattern` são reusados apenas como **primitivo de casamento de
texto→modelo** dentro da etapa 4, sobre um conjunto **já restrito** aos bindings declarados — nunca sobre
`getAvailableSnapshot()`.

*Grounding:* **Solution Architecture §3.5** (0.593, herdado do Gate 2: *"the solution is derived from
prioritized drivers … and the chosen trade-offs are recorded so they can be revisited"* — a cascata com
critério de parada explícito e registrado) e **Managing Software Complexity §3.1** (0.643: *"defining errors
out of existence"* — a ausência é um estado do domínio, modelado no tipo, não um erro que se propaga).

---

## 6. D4 — A recusa fail-closed: três pontos de imposição, zero mudança na máquina de gates

### 6.1 O que "recusar a execução" concretamente é

**Não** é uma exceção. `resolveModelForGate` devolve `{resolved:false, refusal, trace}`. A **imposição** —
transformar essa ausência em "este trabalho não acontece" — é feita nos três lugares, e **só** nos três
lugares, onde uma nova unidade de trabalho que consome modelo é autorizada:

| # | Ponto | Mecanismo concreto | Por que aqui |
|---|---|---|---|
| **P1** | **Abertura de gate** — `gate start <N>` | Nova pré-condição dentro do `store.mutate(...)` de `start`, em `gate-store.ts:158-190`, **ao lado** de `evaluateAdvance` (`:166`), lançando o `GateCommandError` que aquele bloco **já** lança em `:172` | É o ponto de estrangulamento **real** de toda transição (os cinco métodos mutantes passam por `readOrBootstrap`, `:82`), é o mais **barato** (recusa antes de qualquer gasto), e é o único que realiza literalmente o critério de saída do plano ("Gate 9 … execução recusada") |
| **P2** | **Delegação `task`** | `runTask` resolve o modelo do papel-alvo pelo par (gate corrente, `ConductorRoleView.modelRole`); ausência ⇒ o tool devolve **resultado de erro nomeado**, o filho **não é criado** | Fecha o seam `task.ts:511-526` pela porta certa: o filho passa a receber um modelo **resolvido explicitamente** em vez de herdado por referência — e, criticamente, `SpawnChildSessionInput.model` **continua obrigatório** (R16b-like, erro de compilação na omissão): muda **quem calcula**, nunca **se é obrigatório** |
| **P3** | **Composição de sessão** — `conductor chat --gate <N>` | `prepareChat` (`chat.ts:193`) resolve pelo pipeline antes de `createConductorSession`; ausência ⇒ retorna `{ok:false, message}` e **nenhum `ModelRuntime` chega a colocar uma chamada** | É onde o dinheiro é gasto. Fecha o seam `chat.ts:325-332` |

**Fronteira de compatibilidade, declarada:** `conductor chat` **sem** `--gate` mantém o comportamento de hoje
(`config.provider.model` via `modelRuntime.getModel`, `chat.ts:267-268`) — um modelo único, explicitamente
configurado pelo usuário. Isso **não** reabre T65: continua sendo uma autorização deliberada, e
`findInitialModel` continua sem call-site na CLI do Conductor.

### 6.2 Como isso compõe com a Fase 4 sem reabrir o ADR 0005

Três precisões que valem o parágrafo:

1. **`gate-state-policy.ts` não muda.** `evaluateAdvance` continua respondendo **só** sobre evidência e
   ordem de gates. A pré-condição de modelo é uma **segunda verificação, independente e composta**, com
   verdict próprio (`ModelPreconditionVerdict`) — nunca um valor novo em `GateAdvanceVerdict`.
2. **`GateStatus` não ganha valor.** Um `gate start` recusado por falta de modelo **não persiste estado**: o
   gate permanece `not-started`. Não há "gate bloqueado por modelo" no envelope — a recusa é do comando, não
   do estado. Isso evita tocar o enum travado e evita um estado durável que dependeria de config volátil.
3. **A ordem importa e é declarada:** a pré-condição de modelo roda **antes** de `evaluateAdvance`. Motivo:
   uma mensagem "você não tem modelo para o Gate 9" é acionável; "você não satisfez o Gate 8" seguida, na
   próxima tentativa, de "você não tem modelo" é dois round-trips para o mesmo diagnóstico.

### 6.3 Escopo (fecha GAP-7A / OQ#2), exatamente como o Gate 3 cravou

- **Recusa fail-closed: UNIVERSAL, todos os 14 gates.** Não há gate para o qual "prossiga com um modelo não
  autorizado porque a resolução falhou" seja o modo de falha seguro.
- **Veto a fallback automático: ABSOLUTO nos 5 obrigatórios `{3,5,7,8,9}`** (lidos de
  `MANDATORY_GATES`, `builtin-roles-data.ts:305` — **nunca** um literal novo), **opt-in-only e default-deny
  nos outros 9** — e mesmo nos 9, o piso de tier (R48) e o consentimento cross-provider (R47) continuam
  valendo integralmente (D5).
- **Nos 5 obrigatórios, o piso de tier não é relaxável nem com consentimento.** Um humano não pode consentir
  em anular o never-collapse. Isso é imposto no tipo: o caminho de consentimento (D5) simplesmente **não
  existe** para o caso `below-tier-floor` quando `MANDATORY_GATES.has(gate)`.

*Grounding:* **Security Engineering Principles §2.12/§2.2** (herdado do Gate 3, 0.634) e **Stability Patterns
§2.12** (herdado do Gate 2, 0.593: *"the call has no fallback and the request cannot proceed without it —
trip the breaker and the user gets the same error the timeout would"* — a recusa imediata e explícita **é** o
comportamento correto, não uma degradação).

---

## 7. D5 — Fallback: dois pisos ANDados, que a máquina expõe em vez de resolver

### 7.1 O algoritmo (fecha GAP-7B / OQ#3)

Executado **apenas** quando o primário está genuinamente indisponível (FR-16 — nunca como otimização de
custo/velocidade):

```
floor            := max(rank(gate), rank(persona))
activeProvider   := o provedor do modelo primário (o que o usuário está ativamente usando)

C  := bindings do papel, validados no catálogo, autorizados, credenciados, fora de cooldown
Cok:= { c ∈ C : rank(c) ≥ floor ∧ provider(c) = activeProvider }         -- satisfaz OS DOIS pisos
if Cok ≠ ∅ → seleciona o primeiro (ordem determinística de §5.1); ZERO consentimento necessário

-- só aqui os dois pisos divergem:
A := { c ∈ C : provider(c) = activeProvider ∧ rank(c) < floor }          -- mesmo provedor, tier abaixo
B := { c ∈ C : provider(c) ≠ activeProvider ∧ rank(c) ≥ floor }          -- tier ok, outro provedor

A → REJEITADO sempre (R48/T67). Não é oferecido, não é consentível, nem nos 9 não-obrigatórios.
B → CONSENT-REQUIRED (R47/T66), e:
     - gate ∈ MANDATORY_GATES → nunca automático; só consentimento explícito, por-evento, com TTY
     - gate ∉ MANDATORY_GATES → automático SOMENTE se a política declarou opt-in E o destino está
       na allowlist de destinos; caso contrário, consentimento explícito, por-evento, com TTY
     - sem TTY (laço autônomo) → não há consentimento sintetizável ⇒ REFUSE

nenhum consentimento obtenível → refusal = both-floors-unsatisfiable, DIVULGANDO A e B com seus custos
```

A frase que este algoritmo materializa: **os dois critérios não competem — os dois valem. Quando não há
candidato que satisfaça ambos, a máquina expõe o conflito; ela não o resolve.**

### 7.2 O canal de consentimento — reuso, não invenção

Um **único** mecanismo, com dois níveis, ambos já existentes no repo:

1. **Pré-declarado (config):** `modelPolicy.egress.crossProvider: "deny" | "ask" | "allow-listed"`, default
   **`"deny"`**; com `"allow-listed"`, `allowedDestinations: string[]` (ids de provedor). Este campo **não**
   é relevante-para-segurança apenas por ser config: como qualquer parte da política, é repo-supplied, e
   elevá-lo de `"deny"` exige o pin TOFU (D6).
2. **Por-evento (interativo):** o **mesmo** `ConfirmChannel` da Fase 4
   (`gate.ts:182`, `(title, message) => Promise<boolean>`) — nunca um segundo canal de confirmação. A
   mensagem **divulga o destino real** (provedor + host, BR1), o tier de origem e destino, e o custo relativo.
   Todo texto de provedor/URL renderizado passa por `sanitizeForTerminal`
   (`conductor-runtime/src/terminal-sanitize.ts:62`) — um nome de provedor vindo de política hostil não
   escreve escapes no terminal do usuário (§15, superfície 3).
3. **Sem TTY ⇒ `deny`.** A ausência de humano **é** a condição de fail-closed (R47(iii)). O laço autônomo
   nunca sintetiza o próprio consentimento.

**Todo fallback — inclusive dentro do mesmo provedor — gera um evento de egress** (FR-19/BR-5/invariante 17)
no **audit trail que já existe** (`.conductor/audit.jsonl`, já protected-path, já inapagável pelo agente).
Zero superfície de persistência nova para egress.

### 7.3 Cooldown, backoff, timeouts — os números (edge case 6, fecha spec §9 questão 5)

Declarados como **defaults do produto, sobreponíveis pelo operador**, e explicitamente marcados como
**candidatos a sintonia no Gate 11** — não como constantes descobertas:

| Parâmetro | Default | Justificativa |
|---|---|---|
| Timeout de probe | **2 000 ms** | Um probe de reachability que demora mais que isso já respondeu a pergunta ("não está saudável"). Curto o bastante para caber no orçamento de `models why` (SLI 3). |
| Tentativas por provedor, por resolução | **2** (inicial + 1) | O vendor **já** faz retry same-model transiente (`set_auto_retry`). Uma segunda camada multiplicativa é exatamente a "tempestade" de T70. |
| Backoff | base **500 ms**, fator **2**, cap **8 s**, **full jitter** (`random(0, min(cap, base·2ⁿ))`) | *Grounding:* **Secure and Reliable Systems Design §1.5/§1.3** (herdado do Gate 3, 0.605: *"bounded attempts + exponential backoff with jitter (avoid herds); per-client rate limiting (prevent amplification)"*). |
| Cooldown por provedor | `min(30 s · 2^falhasConsecutivas, 15 min)`; reset na 1ª resposta boa | Piso de 30 s impede que um laço turno-a-turno martele; teto de 15 min garante que uma indisponibilidade transitória se cure **dentro de uma sessão** sem intervenção. |
| Escopo do cooldown | **em memória, por processo** | Persistir "provedor X está ruim" criaria estado em disco que o agente poderia adulterar para forçar um fallback — a superfície que o Gate 3 §7 nomeou como gatilho de retorno. Não a criamos (D7). |

### 7.4 Compatibilidade do candidato (fecha spec §9 questão 8)

A pergunta era: a resolução **primária** também valida compatibilidade de ferramentas e contexto mínimo, ou
só o fallback? A resposta segue exatamente a lógica de R46:

- **Primário: confia no binding deliberado.** O operador escolheu aquele modelo para aquele papel; a escolha
  **é** a asserção de adequação. Um modelo mal escolhido falha alto e cedo no primeiro turno — falha
  detectável, não silenciosa.
- **Fallback: tem que provar, porque ninguém o escolheu para este momento.** Um candidato automático precisa
  satisfazer, além dos dois pisos: `contextWindow ≥ contextWindow(primário)` — **encolher o contexto em
  silêncio é um downgrade de capacidade em outra dimensão, a mesma classe de T67** — e pertencer a uma
  família de `api` com suporte a ferramentas equivalente.

---

## 8. D6 — A política de modelo é input não-confiável (fecha GAP-7C / T73 / R54)

### 8.1 A decisão de onde cada metade vive

| Metade | Onde | Confiança |
|---|---|---|
| **Roteamento** — overrides `gate→GateModelRole`, `ModelBinding[]` (referências `provider/modelId`), `rank`, `egress.*`, overrides de modelo por-gate | `.conductor/config.json`, nova seção `modelPolicy` (schema já versionado, já protected-path, já varrido por `secret-detection.ts` na escrita) | **Repo-supplied = NÃO-CONFIÁVEL.** Compartilhável com o time (é o ponto de FR-11), mas nunca confiado por ser um arquivo do projeto |
| **Catálogo e credencial** — endpoints, `baseUrl`, chaves | **Por-máquina**: `getAgentDir()`/`auth.json` e `getAgentDir()`/`models.json` (os defaults globais do Pi que `chat.ts:151` já usa) | Confiança do usuário local; **nunca** lidos de dentro do workspace (D10) |

**Uma referência, nunca uma definição.** Um `ModelBinding` diz `{ provider: "anthropic", modelId:
"claude-opus-5" }`. Ele **não pode** declarar `baseUrl`, `apiKey`, `headers` ou `cost` — esses campos são
**recusados na validação de schema**, não ignorados. Um projeto pode dizer *qual* modelo usar; jamais *para
onde mandar* nem *com que credencial*. Isso corta a metade crítica de T73 (o `baseUrl` hostil) na fronteira de
tipos, antes de qualquer lógica.

### 8.2 O que ainda exige TOFU, e o que não

`ModelPolicyTrustStore` reusa **a forma exata** de `PolicyTrustStore` (`policy-trust-store.ts:53-80`:
`schema`+`trusted[]` com `{kind, contentHash, grantedAt}`, `isTrusted()` que **nunca lança** e devolve
`false` para todo caso incerto). O pin é exigido **só** para a metade que carrega autoridade — proporcional,
não cerimonial:

| Mudança na política do projeto | Exige pin? | Por quê |
|---|---|---|
| Remapear um gate para um papel de rank **≥** o default built-in — *subida* (ex.: Gate 11 `@default`→`@slow`, rank 1→3) | **Não** | Só pode ficar mais estrito. Não abre nada. |
| Remapear um gate para um papel de rank **<** o default — *descida* (ex.: Gate 9 `@slow`→`@smol`, rank 3→0) | **SIM** | É T67 realizado por config: rebaixar um gate obrigatório por arquivo de repo. Sem pin, **o default built-in prevalece** e a divergência é reportada. **Nota:** o exemplo que a própria spec dá para FR-11 — *"Gate 8 usa `@plan` neste projeto, não `@slow`"* — é uma **descida** (rank 3→2) num gate **obrigatório**, e portanto cai exatamente neste caso: é legítimo, é suportado, e exige o pin. FR-11 continua satisfeita; o que muda é que a sobreposição passa a ser um ato consciente e não um efeito de um arquivo clonado. |
| Adicionar/alterar `ModelBinding` para um provedor **do catálogo built-in** | **Não** | Só pode nomear modelos que o catálogo do vendor já conhece; o `baseUrl` continua sendo o oficial. |
| Nomear um provedor **fora** do catálogo built-in (declarado no `models.json` por-máquina, ex.: um `openai-compatible` local) | **SIM** | É o par (identidade de modelo, endpoint não-oficial) que T73(b) descreve — mesmo com o `baseUrl` vindo do lado confiável, o **ato de rotear conteúdo de gate para ele** é uma decisão que um clone não pode tomar sozinho. |
| Elevar `egress.crossProvider` acima de `"deny"`, ou acrescentar destino à allowlist | **SIM** | Autoriza egress por arquivo de repo — o núcleo de T66. |

**Modelo inexistente (edge case 9):** recusado **no momento da resolução, nomeando o modelo inválido**
(`refusal.kind === "unknown-model"`), nunca aceito como "válido mas nunca resolve" (R54(i)).

**Fail-closed de leitura:** política ausente ⇒ os defaults built-in valem (o produto funciona sem config).
Política **presente e ilegível/inválida** ⇒ `refusal.kind === "policy-unreadable"` — **não** cai para os
defaults. Motivo: "ilegível" e "ausente" não são a mesma coisa; tratar corrupção como ausência é a porta pela
qual um atacante desliga uma política restritiva corrompendo-a (R49(iii)).

*Grounding:* precedente de código deste monorepo é mais forte que qualquer citação aqui — Fase 2 **T28/R11**
(`PolicyTrustStore`, TOFU com pin informado) e Fase 3 **T37/R15** (`RoleTrustStore`, definição repo-supplied
não-confiável). O Gate 3 já registrou a citação (**Secure Code Review §2.2**, taint source→sink, 0.571;
**Secure and Reliable Systems Design §3.3**, zero-trust networking, 0.592); não é re-fabricada aqui.

---

## 9. D7 — Health check: sob demanda, em memória, fora do caminho quente (fecha GAP-7D / T70 / R51)

### 9.1 A decisão

| Dimensão | Escolha | Justificativa |
|---|---|---|
| **Gatilho** | **Sob demanda**, nunca polling periódico, nunca serviço em background | Um poller é um subsistema (ciclo de vida, cancelamento, backpressure) para responder uma pergunta que só importa no instante da resolução. |
| **Cache** | **Em memória, por processo**, TTL **60 s** para sucesso; falha alimenta o cooldown de §7.3 | Zero estado novo em disco ⇒ zero superfície nova de adulteração (o gatilho de retorno que o Gate 3 §7 nomeou explicitamente). |
| **Natureza do probe** | GET leve ao endpoint de metadados/modelos do provedor, `AbortSignal` + timeout 2 s. **Nunca** uma chamada de modelo | R51(i): a verificação não consome tokens nem dinheiro. |
| **Caminho quente** | **O primário nunca é probado.** A chamada real **é** o health-check do primário | Resolve a tensão de BR-8 sem heurística: o turno feliz paga **0 ms** de probe. Probes existem para (a) relatório de `models`/`why` e (b) ordenar/pular candidatos de **fallback**. |
| **Isolamento de falha** | Uma falha de probe **nunca** derruba o comando; o provedor vira `unreachable`, os demais seguem (FR-21) | Mesma disciplina de `doctor.ts`. |
| **Egress** | Cada probe emite evento no audit trail: `{kind:"provider-probe", provider, host, at}` — **host, nunca path/prompt** | BR-5/invariante 17. |
| **Endpoint não-confiado** | Um provedor com `baseUrl` não-oficial **não é probado** antes do pin TOFU | O probe **é** egress: sondar o endpoint do atacante já lhe entrega "este projeto existe e me tem configurado". Sondar-para-decidir-se-confio inverte a ordem. |

### 9.2 Edge case 5 — "desligado" vs. "mal configurado", com regra concreta

| Sintoma | Classificação | Mensagem |
|---|---|---|
| `ECONNREFUSED`, `EHOSTUNREACH`, timeout, sobre host sintaticamente válido | **`unreachable`** | "provedor X indisponível — o serviço local está rodando?" |
| `ENOTFOUND`/DNS, URL inválida, `404` no endpoint de metadados | **`misconfigured`** | "provedor X mal configurado — verifique `baseUrl` em `models.json`" |
| `401`/`403` | **`unauthenticated`** | "provedor X inacessível com a credencial atual — `conductor login X`" |

Três estados, três ações diferentes do usuário. Colapsá-los num "indisponível" é o erro que edge 5 pede para
não cometer.

*Grounding:* **Container Orchestration with Kubernetes §3.12** (**0.664**: *"the failure is applying all
three [autoscaling, probes, externalized config] where the conditions don't hold"* — a razão de **não**
construir maquinário de probe onde a chamada real já responde) e **Stability Patterns §1.2** (0.575:
timeouts); **Reactive Systems §2.12/§3.12/§3.5** (herdado do Gate 2, 0.571: um health-check de provedor não
precisa de arquitetura reativa dedicada).

---

## 10. D8 — Os cinco comandos, compostos sobre o substrato endurecido

### 10.1 A composição correta, e a linha que falta (F2)

`conductor login`/`logout` precisam **persistir/remover** credencial no store endurecido (`AuthStorage`:
`proper-lockfile`, `0600`/`0700`, escrita atômica, `auth-storage.ts:228-378`). Os métodos que a spec nomeou
(`ModelRuntime.setRuntimeApiKey`/`removeRuntimeApiKey`) **não fazem isso** — são um overlay em memória
(`runtime-credentials.ts:12-22`). E `AuthStorage` **não é exportada** por
`@earendil-works/pi-coding-agent` (`index.ts:26` exporta apenas `readStoredCredential` **daquele mesmo
módulo**).

**Decisão:** alargar o export do pacote vendor em **uma linha** —
`export { AuthStorage } from "./core/auth-storage.ts";` — e compor sobre ela. Justificativa em três passos:
(i) o módulo **já** faz parte da superfície pública (o `readStoredCredential` vizinho já é exportado), então
não é uma fronteira nova, é uma omissão; (ii) é um pacote **do próprio workspace**, não uma dependência
externa forkada; (iii) a única alternativa é implementar um `CredentialStore` próprio e passá-lo em
`ModelRuntime.create({credentials})` — que é **literalmente** a segunda implementação de storage que BR-1/R50
proíbem, e que reintroduziria o anti-padrão de `pi-ai/src/cli.ts`. Entre tocar uma linha de export e
reimplementar lock+chmod+escrita atômica, a escolha não é próxima.

| Comando | Composição |
|---|---|
| `login [provider]` | Sem argumento: lista provedores conhecidos com status (FR-2). Com argumento: se o provedor tem `auth.oauth`, conduz o **mesmo** fluxo do vendor (`provider.auth.oauth.login({signal, prompt, notify})`, o objeto obtido de `pi-ai/providers/all`), headless — `prompt`/`notify` ligados ao stdio da CLI, não à TUI; senão, pede a API key com **eco desligado**. Persiste via `credentialStore.modify(provider, async () => credential)` (lock + atômico). Nunca um arquivo paralelo (BR-1/R50) |
| `logout <provider>` | `credentialStore.read(provider)` primeiro: se ausente, reporta **explicitamente** "nada a remover" (FR-4/BR-9). Se presente, `credentialStore.delete(provider)` — **remove do disco** — e só então `removeRuntimeApiKey` para o overlay do processo. Nunca "esquece" da sessão deixando o segredo em disco (T72) |
| `auth` | Por provedor conhecido: `getProviderAuthStatus(provider)` → `{configured, source}` com `source ∈ {runtime, stored, environment}` **exposto** (FR-5). Ordem de prioridade `runtime > stored > environment` declarada como **contrato** (edge 4), não acidente. **Uma credencial `environment` aparece como presente e explicitamente marcada como não-autorizante** — visibilidade é parte da defesa de T65 (R46(ii)) |
| `models` | Tabela dos 14 gates: gate · `GateModelRole` · origem do mapeamento (built-in/política) · rank efetivo · modelo resolvido **ou** a recusa nomeada. Projeto sem provedor nenhum ⇒ mensagem explícita apontando `conductor login` (edge 1), nunca tabela vazia |
| `models why <gate>` | Imprime a `ResolutionTrace` como o pipeline literal do §4.15, etapa a etapa, com os candidatos **rejeitados e o porquê de cada um**. Gate fora de 1–14 ⇒ recusa nomeando o intervalo (edge 8). **Nunca imprime material de credencial** — só id de provedor e `source` (R50) |

**Nota anti-padrão, reafirmada:** `packages/ai/src/cli.ts` (grava `auth.json` no CWD com `writeFileSync`
simples, sem lock, sem `chmod`) **não** é alvo de composição em nenhum ponto. É a ferramenta de dev do pacote
vendor, e é o exemplo do que não fazer.

### 10.2 `auth` e `models` permanecem distintos (fecha spec §9 questão 7)

Não colapsam num verbo com sub-flags. O argumento decisivo é de **pré-condição, não de gosto**: `auth`
precisa funcionar num projeto **sem política nenhuma** (é o primeiro comando que alguém roda), enquanto
`models` pressupõe o mapeamento gate→papel. Fundi-los faria a pergunta "minha chave foi vista?" responder com
um erro de política. Respondem a perguntas de contextos diferentes — identidade de credencial × autorização
de rota (**DDD §2.4**, 0.737).

**Consequência para `doctor`:** `checkModelResolution` (`doctor.ts:176-204`) — hoje um único
`config.provider.model`, sem dimensão gate/papel — passa a **delegar** ao mesmo motor, reportando o resumo
por-gate em vez de duplicar uma verificação achatada. Uma fonte de verdade, dois apresentadores.

---

## 11. D9 — Ledger de uso e custo: a proveniência do preço, nunca o valor

### 11.1 O achado F1 e o que ele obriga

`Model.cost` é **obrigatório** no tipo (`types.ts:792`) e `provider-composer.ts:157` preenche um modelo
declarado sem bloco `cost` com **zeros**. Logo: **ler `Model.cost` e reportar o produto é exatamente o
"silenciosamente zero" que BR-10 proíbe** — o bug já está pré-montado no substrato.

**Decisão:** `priced` é decidido pela **proveniência**, não pelo valor:

```ts
export type PriceProvenance =
  | { known: true;  source: "vendor-catalog"; rates: ModelCostRates }
  | { known: false; reason: "model-not-in-vendor-catalog" | "declared-without-cost" };
```

O par `(provider, modelId)` é procurado no **catálogo gerado do vendor** (`getBuiltinModel`/`MODELS`, via o
subpath público `@earendil-works/pi-ai/providers/all`). Presente ⇒ `known:true` com as rates do catálogo.
Ausente (isto é, veio de `models.json`) ⇒ `known:false` **mesmo que `cost` traga números** — um preço
auto-declarado num arquivo de config não é uma fonte de preço para governança (a mesma disciplina
`runtime-derived` × `author-declared` de `gate-evidence.ts`, R14/R52(i)).

`costUsd: number | null`. **`null` é o único valor de "desconhecido".** Zero significa zero.

### 11.2 Forma, local e disciplina

- **Pacote:** `@conductor/providers`, módulo `usage-ledger.ts`. Um terceiro pacote para um JSONL append-only
  seria complexidade acidental (Managing Software Complexity §2.12); e a única lógica não-trivial do ledger —
  **preço** — mora no contexto de provedores.
- **Não no `@conductor/diary`**, deliberadamente: o diário é um **ledger de evidência de governança** cujos
  ids alimentam `runtimeRecordedJournalEntryIds` (ADR 0007 D2). Misturar linhas de medição num log de
  evidência põe registros não-evidenciais numa estrutura cuja garantia é justamente "toda linha é evidência".
- **Path:** `~/.conductor/usage/projects/<projectId>/usage.jsonl` — mesma convenção `library-home.ts`, mesmo
  `computeProjectId`, **protected-path** (§14.2), pelo mesmo motivo confused-deputy de Library/Diary/audit.
- **Molde:** `grounding-ledger.ts` verbatim — writer **síncrono que lança** em I/O real
  (`appendFileSync`, `mode: 0o600`), reader que **nunca lança** (ausente/corrompido ⇒ vazio, linha ruim
  pulada). Reader fail-closed ⇒ custo **"desconhecido"**, jamais zero (R52(ii)).
- **Redação:** o ledger é um **sink novo de persistência**; entra na disciplina pré-escrita de
  `REDACTION_SINKS`. Na prática ele guarda **contagens e identificadores**, nunca conteúdo de prompt — a
  minimização na origem é o controle primário (o padrão D5 da Fase 6), a redação é o complementar.
- **`SharedBudget` intocado (BR-6):** continua sendo a **autorização** de gasto (teto de tokens, reserva
  síncrona, ADR 0004 §5). O ledger é **observabilidade derivada** e nunca é consultado para autorizar nada —
  o que também é a razão de a integridade dele ser P2 e não P1 (T71).
- **Atribuição (FR-22):** os números vêm do que o runtime **observou** (o par `reserve`/`settle` que
  `SharedBudget` já recebe), não de uma auto-declaração do provedor usada para governança.

---

## 12. SLIs / SLOs por componente (objetivo explícito do Gate 4)

Medidos/instrumentados no Gate 11; **definidos aqui**, antes da primeira linha de código. Mesma distinção
honesta do ADR 0007 §11.

| # | Componente | SLI | Alvo (candidato) | Tipo |
|---|---|---|---|---|
| 1 | Resolução | Latência de `resolveModelForGate` com contexto já construído (caminho feliz, sem I/O) | p95 < **20 ms** | SLO |
| 2 | Resolução | Latência de `buildResolutionContext` (política + catálogo + status de credencial, sem probe) | p95 < **250 ms** | SLO |
| 3 | CLI | Latência de `conductor models` (14 gates, sem probes) | p95 < **300 ms** | SLO |
| 4 | CLI | Latência de `conductor models why <gate>` **com** probes | p95 < **2,5 s** (limitado pelo timeout de 2 s + jitter) | SLO |
| 5 | CLI | Latência de `conductor auth` (sem rede) | p95 < **250 ms** | SLO |
| 6 | CLI | Parte não-interativa de `conductor login <provider>` (persistir + revalidar) | p95 < **1,5 s** | SLO |
| 7 | Health-check | Latência acrescentada ao turno em andamento pelo probe | **0 ms** | Invariante, error-budget 0 (BR-8/D7) |
| 8 | Resolução | Execução com um `Model` que a política não autorizou explicitamente (auto-descoberta por env-var) | **0** | Invariante, error-budget 0 (R46/T65) |
| 9 | Gates | Gate aberto / subagente criado / sessão composta sem modelo resolvido | **0** | Invariante, error-budget 0 (R49/T68) |
| 10 | Fallback | Gate obrigatório executando abaixo do piso de tier | **0** | Invariante, error-budget 0 (R48/T67) |
| 11 | Fallback | Fallback cross-provider automático sem consentimento registrado | **0** | Invariante, error-budget 0 (R47/T66) |
| 12 | Egress | Operação de rede do model routing sem evento correspondente no audit trail | **0** | Invariante, error-budget 0 (BR-5/FR-19) |
| 13 | Credencial | Material de credencial aparecendo em trace, log, erro, ledger ou argv | **0** | Invariante, error-budget 0 (R50/T69) |
| 14 | Ledger | Custo reportado como `0` para modelo de preço desconhecido | **0** | Invariante, error-budget 0 (BR-10/R52/F1) |
| 15 | Health-check | Probe emitido a provedor em cooldown, ou a endpoint não-confiado sem pin | **0** | Invariante, error-budget 0 (R51/R54) |
| 16 | Resiliência | `conductor models`/`auth` completando apesar de ≥1 provedor indisponível | **100 %** | Invariante (FR-21) |
| 17 | Determinismo | Mesma resolução, mesmas condições, 2× ⇒ mesmo `Model` | **100 %** | Invariante (FR-6) |

**Honestidade sobre a natureza destes números.** *Grounding:* **Site Reliability Engineering §1.12**
(herdado, ADR 0006 §18/ADR 0007 §11, 0.661: SLOs pressupõem *"a continuously served, user-facing request path
with enough traffic that the ratio is a measurement"*) — um CLI single-user **não é isso**. Só 1–6 são SLOs
de verdade (latência, com distribuição real ao longo do uso); 7–17 são **invariantes com error-budget zero**,
asseverados por teste no Gate 5/7, não estimados por amostragem. Reforço desta sessão: **Software
Architecture and Quality Attributes §2.12** (0.563: *"no user can perceive the target… the number becomes an
acceptance test, so the team defends it in review"* — a razão de não inventar um p99 para caminho que ninguém
observa) e **Observability §2.12** (0.579: não instrumentar os três pilares onde um basta).

---

## 13. Reconciliação R46–R54 (o mandato do Gate 3 §4)

| Regra | Onde satisfeita | Status |
|---|---|---|
| **R46** (resolução nunca autoriza por credencial ambiente) | §5.2 etapas 4–5 — não existe ramo "sem mapeamento" que produza modelo; `findInitialModel` **sem call-site** neste caminho; `source:"environment"` é reportado (D8/`auth`) e nunca autoriza | **Confirmada**, com residual herdado (autorização deliberada é uso legítimo; teto = execução do processo, T17/R1) |
| **R47** (fallback cross-provider exige consentimento) | §7.1/§7.2 — `B` é sempre consent-gated; sem TTY ⇒ deny; evento de egress no audit trail em **todo** fallback | **Confirmada** |
| **R48** (tier mínimo é piso duro, absoluto nos 5 obrigatórios) | §7.1 — `A` rejeitado sempre; o caminho de consentimento **não existe no tipo** para `below-tier-floor` em gate obrigatório (§6.3) | **Confirmada** |
| **R49** (resolução falha-fechada, universal aos 14) | §5.1 (valor de ausência, nunca exceção) + §6 (imposição nos 3 pontos) + §8.2 (política ilegível ≠ ausente) | **Confirmada** |
| **R50** (credencial só via storage endurecido; nunca arquivo paralelo/log/argv) | §10.1 — `credentialStore.modify/delete` sobre `AuthStorage`; trace/erros nomeiam **provedor**, nunca chave; OAuth via o objeto `Provider` do vendor, sem argv | **Confirmada**, com a extensão declarada de §14.2 (uma linha de export) |
| **R51** (health-check barato, bounded, não-bloqueante, é egress) | §9 — probe leve com timeout 2 s, nunca chamada paga; bounded+backoff+jitter+cooldown+cap (§7.3); primário nunca probado ⇒ 0 ms no caminho quente; evento de egress | **Confirmada** |
| **R52** (ledger derivado-do-runtime, append-only, fail-closed; não sobrecarrega `SharedBudget`) | §11 — molde `grounding-ledger.ts`; `costUsd: null` + `priced` por proveniência (**F1**); `SharedBudget` inalterado | **Confirmada**, e **endurecida** pelo achado F1 (proveniência, não valor) |
| **R53** (login/logout não degradam o lock; logout remove do disco e reporta honestamente) | §10.1 — escrita só via `CredentialStore`/`AuthStorage`; `read`-antes-de-`delete` para FR-4/BR-9; **F2 corrigido** (o caminho que a spec sugeria produziria exatamente a credencial-fantasma) | **Confirmada**, e **F2 é a razão de a regra não ser trivial** |
| **R54** (política é input não-confiável; modelo validado contra catálogo; `baseUrl` custom é egress-consentido) | §8 — binding é **referência**, `baseUrl`/`apiKey` **recusados no schema**; validação contra `builtinProviders()`/`getBuiltinModel`; TOFU na metade que carrega autoridade; **path decidido** (roteamento no workspace, catálogo/credencial por-máquina) | **Confirmada**, com a decisão de path que R54(iii) exigia deste gate |

---

## 14. Resolução das GAPs e das questões abertas

### 14.1 As 4 GAPs do Gate 3 (7A–7D) e as 8 questões da spec (§9)

| Item | Origem | Resolução neste ADR |
|---|---|---|
| **GAP-7A** (FR-15 deve cravar o escopo fail-closed) | T67/T68 | **§6.3** — recusa universal aos 14; veto a fallback automático absoluto nos 5 obrigatórios, opt-in-only e default-deny nos 9; nos obrigatórios o piso não é relaxável nem com consentimento, imposto **no tipo** |
| **GAP-7B** (BR-4/FR-18 devem cravar "dois pisos ANDados") | T66/T67 | **§7.1** — algoritmo explícito; `A` rejeitado, `B` consent-gated, divergência ⇒ `both-floors-unsatisfiable` divulgando ambos |
| **GAP-7C** (política é input não-confiável; `baseUrl` é exfil) | T73 | **§8** — binding é referência pura (`baseUrl`/`apiKey` recusados no schema), catálogo/credencial por-máquina, TOFU proporcional, `unknown-model` recusado nomeando |
| **GAP-7D** (health-check é egress e vetor de amplificação) | T70 | **§9** — probe barato, bounded, cache em memória, 0 ms no caminho quente, evento de egress, endpoint não-confiado não é probado antes do pin |
| **OQ#1** — 3 vocabulários de tier | spec §9.1 | **§3/D1** — dois eixos que não se fundem; `ModelRole` intocado; `GateModelRole` novo (4 = `CLAUDE.md`); ACL para os 7 do plano; piso = `max` |
| **OQ#2** — escopo do "gate crítico" | spec §9.2 → Gate 3 | **§6.3** — ratificada a resolução do Gate 3, sem sobreposição |
| **OQ#3** — BR6 × tier mínimo | spec §9.3 → Gate 3 | **§7.1** — ratificada a resolução do Gate 3, com o algoritmo que a materializa |
| **OQ#4** — onde o pacote vive | spec §9.4 | **§4/D2** — `@conductor/providers` novo + política em `config` + porta em `runtime` + injeção na CLI |
| **OQ#5** — mecanismo de health-check e cooldown | spec §9.5 | **§9 + §7.3** — sob demanda, cache em memória com TTL 60 s; timeout 2 s; 2 tentativas; backoff 500 ms/×2/cap 8 s/full jitter; cooldown `min(30 s·2ⁿ, 15 min)` — defaults sobreponíveis |
| **OQ#6** — pacote físico do ledger | spec §9.6 | **§11/D9** — `@conductor/providers`, `usage-ledger.ts`, path por-máquina protected |
| **OQ#7** — `auth` × `models` | spec §9.7 | **§10.2** — distintos, por pré-condição (`auth` funciona sem política); `doctor` passa a delegar |
| **OQ#8** — resolução primária valida ferramentas/contexto? | spec §9.8 | **§7.4** — primário confia no binding deliberado; **fallback** tem que provar (`contextWindow` ≥ primário, família de `api` compatível) |

### 14.2 A extensão declarada — o que exatamente muda em código já existente

Quatro mudanças, e só quatro:

| Antes | Depois | Onde | Por quê |
|---|---|---|---|
| `defaultProtectedPaths()` — sem `~/.pi/agent` | `+ getAgentDir()` (subárvore inteira) | `workspace-policy.ts:129-170` | **F3**: `auth.json` (credenciais) e `models.json` (endpoints) são hoje legíveis/escrevíveis pelas próprias tools do agente. Mesma razão confused-deputy de `~/.conductor/{library,diary}` |
| `defaultProtectedPaths(workspaceRoot)` — sem `.conductor-agent` | `+ join(workspaceRoot, ".conductor-agent")` | idem | **F3**: o diretório de credencial/catálogo do filho de delegação |
| Filho: `agentDir = join(input.workspaceRoot, ".conductor-agent")`, `authPath`/`modelsPath` sob ele | `authPath`/`modelsPath` **por-máquina** (defaults do Pi), como `chat.ts:151` já faz para o pai | `task.ts:541-547` | **F3**: um clone não pode plantar catálogo/credencial que o filho consulte |
| `pi-coding-agent/index.ts` — exporta só `readStoredCredential` daquele módulo | `+ export { AuthStorage }` | `packages/coding-agent/src/index.ts:26` | **F2**: sem isso não há caminho **público** de escrita persistente, e a alternativa é uma segunda implementação de storage (BR-1/R50 proíbem) |

`ModelRole`, `ConductorRole`, `GateState`, `GateRecord`, `GateStatus`, `evaluateAdvance`,
`isMandatorySatisfied`, `evaluateCalibration`, `resolveEvidenceRef`,
`hasSufficientEvidenceForMandatoryGate`, `SharedBudget`, `REDACTION_SINKS` (a redação do ledger reusa o
mecanismo, e se um valor de sink novo for necessário será uma **adição** ao enum, no molde de ADR 0007 §12.4)
e `CreateConductorSessionOptions` permanecem **literalmente** como estão.

---

## 15. Reconciliação com o Gate 3 addendum (protocolo iterativo) — três superfícies que RETORNAM

O mandato (Gate 3 §7): *"se o Gate 4 expuser uma superfície nova, retornar a este gate"*. Avaliei cada
decisão. **Três retornam** — duas delas **descobertas lendo código**, não deduzidas do documento. Todas são
mitigadas **inline** por secure-default e **nenhuma é bloqueante**; todas viram item de escopo do Gate 9.

| # | Superfície nova | Classe | Mitigação inline (secure default) | Item para o Gate 9 |
|---|---|---|---|---|
| **S1** | **`getAgentDir()` (`~/.pi/agent/`) não é protected-path** — `auth.json` (credencial) e `models.json` (endpoint/`baseUrl`/`apiKey` inline) são hoje alcançáveis por `read`/`write`/`edit`/`bash` do próprio agente. T69(a)+T73(b) por uma porta que **nenhuma fase fechou** | **T69/T73 materializados**, prob. Média, impacto **Alto** | **Secure-default 64:** `getAgentDir()` inteiro entra em `defaultProtectedPaths()` (§14.2) | Tentar `read` de `~/.pi/agent/auth.json` e `write` de um provedor hostil em `~/.pi/agent/models.json` pela ferramenta do agente; confirmar **negado** |
| **S2** | **O filho de delegação lê catálogo/credencial de dentro do workspace** — `task.ts:541-547` aponta `authPath`/`modelsPath` para `<workspaceRoot>/.conductor-agent/`, que **não** é protected. Hoje inerte (o fix GAP-5 herda o modelo do pai); **deixa de ser inerte** quando esta fase resolve modelo por papel | **T73 materializado em código existente**, prob. Média, impacto **Crítico** | **Secure-default 65:** o resolvedor **nunca** lê `models.json` do workspace; o spawner passa a usar os paths por-máquina; `.conductor-agent` entra em protected-paths (§14.2) | Plantar `.conductor-agent/models.json` num clone com `openai-compatible` + `baseUrl` de captura local e `apiKey` inline; confirmar que **nenhum turno do filho** alcança o endpoint |
| **S3** | **O prompt de consentimento de fallback renderiza texto de origem não-confiável** — nome de provedor / host vindos da política repo-supplied, num terminal | **Spoofing/escape de terminal**, prob. Baixa, impacto Médio | **Secure-default 66:** todo identificador de provedor/host renderizado em consentimento ou em `models why` passa por `sanitizeForTerminal` (`terminal-sanitize.ts:62`) — primitivo existente, reusado | Política com nome de provedor contendo escapes ANSI/CR; confirmar prompt não forjável |

**Avaliadas e que NÃO retornam:**
- **Cache de disponibilidade** — o Gate 3 §7 nomeou explicitamente "um cache de disponibilidade que persista
  o pool de modelos" como gatilho de retorno. **D7 não persiste nada** (em memória, por processo). A
  fronteira não é aberta — é evitada por construção.
- **Cooldown/backoff como superfície de DoS** — coberto por R51 e pelos bounds concretos de §7.3; nenhum
  mecanismo novo.
- **Pacote novo `@conductor/providers`** — não é fronteira de confiança: é código do mesmo processo confiado,
  sem estado durável próprio além do ledger, cujo path já herda o protected-path de Library/Diary.
- **Ledger de custo** — novo sink de persistência, mas dentro da disciplina R52 já modelada por T71
  (append-only, fail-closed, por-máquina, protected, minimizado na origem). Não é superfície nova, é a
  aplicação de uma regra existente.

Os residuais herdados permanecem **declarados e não fechados**: o teto de execução do processo confiado
(T17/R1), a exfiltração por config **deliberada do próprio usuário** (uso, não ataque), e a ausência de
sandbox. O design reduz o risco a um nível aceitável e **detectável**, não a zero.

---

## 16. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. Os nomes de tipo e a forma dos
> retornos **são** a decisão; corpos e detalhes de I/O são Gate 6.

```ts
// ================= @conductor/config — vocabulário e política (dado puro, sem deps do Pi) =========

/** Eixo 2 — carga de trabalho do gate. 1:1 com a tabela "Model roles per gate" do CLAUDE.md (D1). */
export type GateModelRole = "plan" | "slow" | "default" | "smol";

/** Ordem default do produto — sobreponível por binding (`rank?`). NÃO é uma verdade descoberta (D1.6). */
export const DEFAULT_GATE_MODEL_ROLE_RANK: Readonly<Record<GateModelRole, number>> = {
  smol: 0, default: 1, plan: 2, slow: 3,
};

/** Projeção do eixo 1 (ModelRole, ADR 0004 §16 — INTOCADO) no mesmo rank, para a regra `max` (D1.5). */
export const MODEL_ROLE_RANK: Readonly<Record<ModelRole, number>> = {
  lightweight: 0, standard: 1, strategic: 2,
};

/** Camada anticorrupção para os 7 nomes do plano §4.15 — nunca um enum, nunca tradução silenciosa. */
export function normalizePlanModelRole(name: string):
  | { ok: true; role: GateModelRole; alias: boolean }
  | { ok: false; reason: "unknown-model-role"; known: readonly string[] };

/** Default built-in: os 14 gates da tabela do CLAUDE.md, tornada dado (FR-9). */
export const DEFAULT_GATE_MODEL_ROLES: Readonly<Record<number, GateModelRole>>;

/** Um binding é uma REFERÊNCIA. `baseUrl`/`apiKey`/`headers`/`cost` são RECUSADOS no schema (D6/R54). */
export interface ModelBinding {
  role: GateModelRole;
  provider: string;
  modelId: string;
  /** Sobrepõe DEFAULT_GATE_MODEL_ROLE_RANK[role] para ESTE binding. */
  rank?: number;
  minContextWindow?: number;
}

export interface ModelPolicy {
  schema: 1;
  /** FR-11: override do mapeamento gate→papel. Descida de rank exige pin TOFU (D6/§8.2). */
  gateRoles?: Readonly<Record<number, GateModelRole>>;
  bindings: readonly ModelBinding[];
  /** Recupera o caso "um modelo específico para o Gate 9" sem quinto tier (D1.4). */
  gates?: Readonly<Record<number, { model?: string }>>;
  egress: {
    crossProvider: "deny" | "ask" | "allow-listed";   // default "deny"
    allowedDestinations?: readonly string[];           // só com "allow-listed"
  };
  fallback?: {
    /** Default-deny; irrelevante para MANDATORY_GATES, onde automático nunca é permitido (§6.3). */
    automaticForNonMandatoryGates?: boolean;
  };
}

export type ModelPolicyDiagnostic =
  | { kind: "legacy-model-role-alias"; found: string; canonical: GateModelRole }
  | { kind: "forbidden-field"; path: string; field: "baseUrl" | "apiKey" | "headers" | "cost" }
  | { kind: "downward-gate-remap-requires-pin"; gate: number; declared: GateModelRole; builtin: GateModelRole }
  | { kind: "untrusted-provider-requires-pin"; provider: string }
  | { kind: "egress-elevation-requires-pin"; declared: ModelPolicy["egress"]["crossProvider"] };

export function parseModelPolicy(raw: unknown):
  | { ok: true; policy: ModelPolicy; diagnostics: readonly ModelPolicyDiagnostic[] }
  | { ok: false; reason: string };

/** Mesma FORMA de PolicyTrustStore (policy-trust-store.ts:53-80). isTrusted NUNCA lança. */
export interface ModelPolicyTrustStore { isTrusted(contentHash: string): boolean; }
export function loadModelPolicyTrustStore(filePath: string, options?: { onError?(e: unknown): void }): ModelPolicyTrustStore;

// ================= @conductor/runtime — a PORTA (nenhuma implementação, nenhum import do adapter) ==

export interface ModelResolutionPort {
  resolveForGate(request: ResolveModelRequest): ModelResolution;
}

/** Pré-condição composta ao lado de evaluateAdvance — NUNCA um valor novo em GateAdvanceVerdict (D4). */
export type ModelPreconditionVerdict =
  | { kind: "satisfied"; provider: string; modelId: string }
  | { kind: "refused"; refusal: ResolutionRefusal; humanReadable: string };

export function evaluateModelPrecondition(gate: number, port: ModelResolutionPort): ModelPreconditionVerdict;

// ================= @conductor/providers — o motor ================================================

export interface ModelRef { provider: string; modelId: string; }

export interface ResolveModelRequest {
  gate: number;                 // 1..TOTAL_FLOW_GATES
  /** Presente quando a resolução é para um papel (task/subagente); ausente na abertura de gate. */
  persona?: { name: string; modelRole: ModelRole };
  /** O provedor "ativamente usado" — a âncora do piso do mesmo provedor (BR6/D5). */
  activeProvider?: string;
  purpose: "gate-open" | "delegation" | "session" | "report";
}

export type ResolutionRefusal =
  | { kind: "unsupported-gate"; gate: number; validRange: [number, number] }
  | { kind: "no-gate-mapping"; gate: number }
  | { kind: "no-binding-for-role"; gate: number; role: GateModelRole }
  | { kind: "unknown-model"; gate: number; declared: string }
  | { kind: "unknown-provider"; gate: number; declared: string }
  | { kind: "untrusted-endpoint"; gate: number; provider: string; host: string }
  | { kind: "no-credential"; gate: number; role: GateModelRole; providers: readonly string[] }
  | { kind: "all-candidates-unavailable"; gate: number; providers: readonly string[] }
  | { kind: "below-tier-floor"; gate: number; requiredRank: number; bestRank: number; candidate: ModelRef }
  | { kind: "consent-required"; gate: number; candidate: ModelRef; destinationHost: string }
  | { kind: "both-floors-unsatisfiable"; gate: number;
      sameProviderBelowTier: readonly ModelRef[]; crossProviderAtTier: readonly ModelRef[] }
  | { kind: "policy-unreadable"; gate: number; detail: string };

export type ModelResolution =
  | { resolved: true;  model: Model<Api>; ref: ModelRef; effectiveRank: number;
      fallbackOf?: { from: ModelRef; consent: "same-provider" | "explicit" | "pre-authorized" };
      trace: ResolutionTrace }
  | { resolved: false; refusal: ResolutionRefusal; trace: ResolutionTrace };

/** O rastro É parte do retorno — resolvida ou não. É o que `models why` imprime (D3/FR-13). */
export interface ResolutionTrace {
  gate: number;
  at: string;                    // ISO-8601 UTC
  steps: readonly ResolutionStep[];
}

export type ResolutionStep =
  | { stage: "gate-role";      role: GateModelRole; source: "builtin" | "project-policy"; pinned?: boolean }
  | { stage: "floor";          gateRank: number; personaRank?: number; effective: number }
  | { stage: "bindings";       role: GateModelRole; candidates: readonly CandidateView[] }
  | { stage: "catalog";        accepted: readonly ModelRef[];
                               rejected: readonly { ref: string; why: "unknown-model" | "unknown-provider" | "untrusted-endpoint" }[] }
  | { stage: "credential";     perProvider: readonly {
                                 provider: string; configured: boolean;
                                 source?: "runtime" | "stored" | "environment";
                                 authorizedByPolicy: boolean;   // R46: environment sozinho NUNCA autoriza
                               }[] }
  | { stage: "availability";   perProvider: readonly {
                                 provider: string;
                                 state: "not-probed" | "reachable" | "unreachable" | "misconfigured" | "unauthenticated" | "cooldown";
                                 checkedAt?: string; cooldownUntil?: string;
                               }[] }
  | { stage: "selection";      selected?: ModelRef; rejected: readonly { ref: ModelRef; why: ResolutionRefusal["kind"] }[] };

export interface CandidateView { ref: ModelRef; rank: number; declaredIn: "project-policy" | "user-policy" | "builtin-default"; }

/** Toda a I/O da resolução mora AQUI (borda); resolveModelForGate é puro sobre o snapshot (D3). */
export function buildResolutionContext(options: {
  workspaceRoot: string;
  modelRuntime: ModelRuntime;
  policy: ModelPolicy | undefined;
  trust: ModelPolicyTrustStore;
  availability: AvailabilityCache;
}): Promise<ResolutionContext>;

export function resolveModelForGate(request: ResolveModelRequest, ctx: ResolutionContext): ModelResolution;

// ---- Disponibilidade (D7): em memória, por processo. NENHUM estado em disco. ----
export type ProviderAvailability =
  | { state: "reachable"; checkedAt: string }
  | { state: "unreachable" | "misconfigured" | "unauthenticated"; checkedAt: string; detail: string }
  | { state: "cooldown"; until: string; consecutiveFailures: number };

export interface AvailabilityCache {
  get(provider: string): ProviderAvailability | undefined;
  /** Probe barato com timeout duro; NUNCA uma chamada de modelo (R51). Nunca lança. */
  probe(provider: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ProviderAvailability>;
}

export const AVAILABILITY_DEFAULTS = {
  probeTimeoutMs: 2_000,
  successTtlMs: 60_000,
  attemptsPerResolution: 2,
  backoffBaseMs: 500, backoffFactor: 2, backoffCapMs: 8_000,   // full jitter
  cooldownBaseMs: 30_000, cooldownCapMs: 15 * 60_000,
} as const;

// ---- Ledger de uso/custo (D9) — molde grounding-ledger.ts ----
export type PriceProvenance =
  | { known: true;  source: "vendor-catalog"; rates: ModelCostRates }
  | { known: false; reason: "model-not-in-vendor-catalog" | "declared-without-cost" };

export interface UsageRecord {
  id: string; at: string; projectId: string;
  demandId?: string; gate?: number; gateModelRole?: GateModelRole; role?: string;
  provider: string; modelId: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** null é o ÚNICO "desconhecido". Zero significa zero (BR-10/F1). */
  costUsd: number | null;
  priced: PriceProvenance;
  fallbackOf?: { from: ModelRef; consent: "same-provider" | "explicit" | "pre-authorized" };
}

/** Síncrono, LANÇA em falha de I/O real (molde do writer de grounding-ledger.ts). */
export interface UsageLedgerWriter { append(record: Omit<UsageRecord, "id" | "at">): { id: string; at: string }; }
/** NUNCA lança: ausente/corrompido ⇒ vazio ⇒ custo "desconhecido", jamais zero (R52). */
export interface UsageLedgerReader {
  totals(filter: { gate?: number; role?: string; since?: Date }):
    { tokens: UsageRecord["tokens"]; costUsd: number | null; unpricedCalls: number };
}
export function openUsageLedgerWriter(path: string): UsageLedgerWriter;
export function openUsageLedgerReader(path: string, projectId: string): UsageLedgerReader;

// ================= @conductor/cli — comandos (composição, nunca reimplementação) ==================
export function runLogin(options: { provider?: string; io: CliIO; credentials: CredentialStore; modelRuntime: ModelRuntime }): Promise<number>;
export function runLogout(options: { provider: string; io: CliIO; credentials: CredentialStore; modelRuntime: ModelRuntime }): Promise<number>;
export function runAuthStatus(options: { io: CliIO; modelRuntime: ModelRuntime }): Promise<number>;
export function runModelsList(options: { io: CliIO; ctx: ResolutionContext }): number;
export function runModelsWhy(options: { io: CliIO; ctx: ResolutionContext; gate: number }): number;
```

---

## 17. Consequências

### 17.1 Positivas

1. **A causa raiz do `DEEPSEEK_API_KEY` fecha na fonte, não só no sintoma.** Não existe, em nenhum ponto do
   pipeline primário, um ramo que produza um modelo a partir de "existe uma chave no ambiente". O comentário
   de `task.ts:524` — *"closing the hole until a real `modelRole` → `Model` registry exists"* — deixa de
   descrever uma promessa e passa a descrever um fato, e a herança-por-referência do filho vira **redundância
   defensiva**, não a única barreira.
2. **Três defeitos reais achados antes de escrever código** (F1/F2/F3), dois deles em suposições que a spec e
   o threat model tratavam como resolvidas. Especificamente, F2 significa que a implementação "óbvia" de
   `logout` sugerida pela leitura da spec produziria a credencial-fantasma que a própria spec proíbe.
3. **`ModelRole` não é reaberto**, e nem por isso os 7 nomes do plano são ignorados: entram por uma tradução
   nomeada, testável e diagnosticável. Zero frontmatter muda; zero segunda fonte de verdade nasce.
4. **A tabela do `CLAUDE.md` vira dado sem virar cópia.** É transcrita 1:1 porque o tipo foi escolhido para
   caber nela — não o contrário.
5. **Zero dependências novas de terceiros e zero infraestrutura nova.** Nenhum provedor HTTP escrito, nenhum
   Docker, nenhum poller, nenhum segundo canal de consentimento, nenhum segundo log de egress. O inventário
   de cadeia de suprimentos do Gate 7 não cresce.
6. **Funções puras** (`normalizePlanModelRole`, `resolveModelForGate` sobre snapshot, o cálculo de piso, a
   seleção de fallback, o cálculo de custo a partir de proveniência) permitem ao Gate 5 escrever testes RED
   reais **antes** de qualquer rede, credencial ou provedor existir.
7. **Uma recusa vira um diagnóstico.** `models why <gate>` transforma o fail-closed de parede em instrução —
   o que é a única defesa real contra o usuário desligar o mecanismo.

### 17.2 Riscos aceitos (com mitigação)

| # | Risco | Sev. | Mitigação | Residual |
|---|---|---|---|---|
| R1 | Execução de código no processo confiado reconfigura a política e autoriza o que quiser | Alto | Protected-paths (D10), TOFU sobre a metade com autoridade (D6), audit trail de egress | **Declarado, não resolvido** — teto herdado T17/R1 |
| R2 | Config **deliberada** do usuário aponta a um endpoint de exfiltração | Médio-Alto | Divulgação do destino + consentimento (D5), `baseUrl` fora do alcance da política de repo (D6) | **Declarado** — uso deliberado é uso, não ataque |
| R3 | Fail-closed universal torna o produto inoperante num projeto mal configurado | Médio | `models`/`models why`/`doctor` dão o diagnóstico exato; ausência de política ⇒ defaults built-in valem | **Assumido deliberadamente** — é o critério de saída do plano |
| R4 | Os números de cooldown/backoff/TTL estão errados para algum provedor real | Baixo | Todos sobreponíveis; nenhum é constante escondida; Gate 11 sintoniza | **Declarado** — inventados sob incerteza, e ditos como tal |
| R5 | Contagem de tokens do provedor difere da observada; custo reportado diverge da fatura | Baixo | Uso derivado-do-runtime para governança; ledger é observabilidade (BR-6) | **Declarado** — o teto real (`SharedBudget`) não depende do ledger |
| R6 | Sem tamper-evidence criptográfica no ledger de uso | Baixo | Append-only + reader fail-closed + protected-path | **Declarado** — mesma GAP-4D herdada |
| R7 | A regra `max(gate, persona)` pode encarecer um gate barato rodado por persona forte | Baixo | É deliberado (é a regra que o próprio `CLAUDE.md` escreve); override por-gate disponível | **Assumido** |

### 17.3 Negativas / custos assumidos

1. **Um pacote novo** (`@conductor/providers`) — mais um alvo de build/test/lint, mais uma entrada no
   inventário do Gate 7.
2. **Uma linha de export num pacote vendor** (§14.2) — pequena, mas é uma mudança em código que o princípio
   "composição antes de fork" prefere não tocar. Aceita por ser estritamente menor que a alternativa.
3. **O nome `security` desaparece do vocabulário de tier.** O plano §4.15 continuará dizendo `security`; o
   código dirá `slow` + override por-gate. É uma divergência **documentada** entre plano e implementação, não
   um esquecimento — e resolvê-la de outro jeito custava um enum de 7 ou um sistema de tags.
4. **`conductor chat` sem `--gate` continua no caminho antigo.** Duas rotas de resolução coexistem durante
   esta fase; a unificação é follow-up, não escopo.
5. **Disponibilidade não sobrevive ao processo.** Um comando novo re-descobre cooldowns. Custo aceito em
   troca de zero estado adulterável em disco.

---

## 18. Rastreabilidade

| Origem | Item | Onde neste ADR |
|---|---|---|
| plano §4.15 (pipeline de resolução) | `Gate → papel → política → modelos → disponibilidade → selecionado` | §5.2, §16 (`ResolutionStep`) |
| plano §4.15 (critério de saída) | "Gate 9 requer security … execução recusada" | §3.2 item 4, §6 |
| plano §4.15 (8 restrições de fallback) | tier mínimo, consentimento, ferramentas, contexto, cooldown | §7.1, §7.3, §7.4 |
| plano §10 inv. 5/16/17 | modelo mínimo em gate crítico / fallback respeita tier / egress gera evento | §6.3, §7.1, §7.2 |
| spec G1–G8 | os 8 goals | D8, D3, D1, D8, D4, D5, D7, D9 |
| spec FR-1..5 (Grupo A) | login/logout/auth | §10 |
| spec FR-6..8 (Grupo B) | resolução `modelRole → Model` | §5, §3 |
| spec FR-9..11 (Grupo C) | gate → papel, executável e sobreponível | §3.2, §8 |
| spec FR-12/13 (Grupo D) | `models` / `models why` | §10, §16 (`ResolutionTrace`) |
| spec FR-14/15 (Grupo E) | recusa fail-closed | §6 |
| spec FR-16..19 (Grupo F) | fallback controlado | §7 |
| spec FR-20/21 (Grupo G) | health check | §9 |
| spec FR-22/23 (Grupo H) | tokens atribuíveis, custo com ausência reportada | §11 |
| spec BR-1..10 | as 10 regras | §10.1 (BR-1/9), §5.2 (BR-2), §6.3 (BR-3), §7.1 (BR-4), §7.2/§9 (BR-5), §11 (BR-6/10), §3 (BR-7), §9 (BR-8) |
| spec edge 1..9 | os 9 casos | §10 (1), §3.2/§6 (2), §10.1 (3), §10 (4), §9.2 (5), §7.3 (6), §10.1 (7), §10 (8), §8.2 (9) |
| Gate 3 T65..T73 / R46..R54 | as 9 ameaças e regras | §13 |
| Gate 3 GAP-7A..7D | as 4 lacunas | §14.1 |
| Gate 3 §7b | verificação empírica | §15 (S1–S3) + as 9 já listadas pelo Gate 3 |

---

## 19. Grounding (biblioteca) — consultas desta sessão

Rodadas via `cdt library "<pergunta>" --gate <N>` a partir de `C:\development\source\projects\conductor`
(backend saudável). **Cobertura honesta:** uma citação **forte** e três **moderadas-altas** para as decisões
estruturais; o resto **moderado (0.55–0.66)**, reportado como tal — o padrão já estabelecido nas Fases 5/6
para tópicos agente-nativos que o corpus não cobre em profundidade. Nada foi forçado.

1. **Dois modelos/vocabulários coexistindo, integrados por contrato + camada anticorrupção** → **Domain-Driven
   Design — Complete Professional Guide §2.4 "contexts as integration units"** (**0.737**, o hit mais forte
   desta sessão) e **§2.3** (0.669: *"trying to force one universal model across teams produces a brittle,
   over-coupled system where every change ripples everywhere"*). **Base direta de D1** (dois eixos que não se
   fundem + `normalizePlanModelRole`) e de **D2/§10.2** (`auth` × `models` como contextos distintos).
2. **ADR como artefato: rationale, alternativas, consequências, revisitável** → **The Practice of Architecting
   — Complete Professional Guide §2.2 "architecture Decision Records"** (**0.708**), **§2.8 "Checklist: ADRs"**
   (0.655), **§1.12** (0.669) e **Software Architecture and Quality Attributes §1.12 "when not to treat a
   decision as architectural"** (0.663). Base da **forma** deste documento e do critério de o que entrou como
   D-item e o que ficou como detalhe de Gate 6.
3. **Módulo profundo / interface estreita / esconder informação e "definir erros fora de existência"** →
   **Managing Software Complexity §3.1** (0.643), **§3.3 "hiding vs. leakage"** (0.615), **§2.12 "when not to
   deepen a module"** (0.615/0.600). **Base de D2** (por que um pacote novo, e por que **não** três) e de
   **D3** (a ausência como valor modelado em vez de exceção propagada).
4. **Quando NÃO construir maquinário de probe/elasticidade/config externalizada** → **Container Orchestration
   with Kubernetes §3.12 "When not to autoscale, probe, or externalize configuration"** (**0.664**/0.658:
   *"the failure is applying all three where the conditions don't hold"*). **Base de D7** (sob demanda, em
   memória, primário nunca probado). Complementado por **Stability Patterns for Production §1.2** (0.575,
   timeouts) e **Reactive Systems §2.12/§3.12/§3.5** (herdado do Gate 2, 0.571: health-check de provedor não
   precisa de arquitetura reativa).
5. **Cascata de resolução derivada de drivers priorizados, com trade-offs registrados e revisitáveis** →
   **Solution Architecture — Complete Professional Guide §3.5** (0.593/0.577, herdado do Gate 2) e **§2.12
   "When not to gather requirements up front"** (0.593: números *"invented under pressure, which are then
   treated as constraints for the life of the system"*). **Base de §5** (a cascata) e de **§7.3/D1.6** (por
   que todo número desta fase é um default sobreponível, declarado como tal).
6. **Escrever alvo de qualidade só onde alguém percebe** → **Software Architecture and Quality Attributes
   §2.12** (0.563: *"no user can perceive the target… the number becomes an acceptance test, so the team
   defends it in review"*) e **§3.5** (0.560), **Observability §2.12** (0.579). **Base de §12** — a razão de
   6 SLOs e 11 invariantes, e não 17 SLOs.
7. **Herdadas do Gate 3, não re-consultadas (a decisão de grounding já está no registro daquele gate):**
   **Security Engineering Principles §2.2/§2.5/§2.12** (0.634, fail-closed no caminho de autorização — §6,
   §8.2), **Secure and Reliable Systems Design §3.5/§3.2/§3.3** (0.650, least-privilege/zero-trust — §8,
   §15), **§1.5/§1.3** (0.605, bounded attempts + backoff com jitter — §7.3), **Stability Patterns §2.12**
   (0.593, "no fallback possible → trip the breaker" — §6.3), **Secure Code Review §2.2** (0.571, taint
   source→sink — §8).
8. **Declarado NÃO coberto (não forçado):** **medição de custo/telemetria de tokens de LLM multi-provedor** —
   a spec §8.5 já declarou (melhor resultado 0.532, fora do alvo) e nada nesta sessão mudou isso. D9 é
   fundamentado em **prior art de código deste monorepo** (o molde `grounding-ledger.ts`, a distinção
   `runtime-derived`/`author-declared` de `gate-evidence.ts`, a separação `SharedBudget`/observabilidade de
   ADR 0004 §5) **e no achado F1 lido no código** — não numa citação fabricada.

---

## 20. Nota sobre a forma deste documento (por que um único ADR)

O Gate 4 permitia um companheiro `docs/conductor/gate4-design-fase7.md` para o algoritmo/estruturas de dados.
**Não foi criado**, por precedente: as Fases 5 e 6 (ADR 0006, 1 481 linhas; ADR 0007, 1 093 linhas) mantiveram
tudo num ADR único com o apêndice §16 de contratos TypeScript, e a rastreabilidade Gate 5 → Gate 6 → Gate 8
das duas fases anteriores depende de **um** documento por fase. Dividir aqui criaria um segundo lugar para
procurar a mesma decisão — exatamente a duplicação que este ADR passa 20 seções combatendo em outro domínio.
