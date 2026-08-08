# Gate 2 — Especificação (fonte da verdade): Fase 8 — Autonomous mode

**Demanda:** `Fase 8 — Autonomous mode` (`plano_desenvolvimento.md` linhas 1431-1454), lida junto com §4.8
"Modos de execução" (linhas 577-592 — a lista de características de `conductor auto`: aprovação automática
de decisões técnicas de baixo risco, commits por gate, checkpoints de contexto, recuperação após
interrupção, orçamento máximo, paralelismo controlado, interrupção em sign-offs, registro `needs-human`),
§4.7 "Estado persistido" (linhas 507-528 — o `GateState`/`GateStatus` já travado que esta fase reusa sem
reabrir), e §10 invariantes 10/11 (linhas 1652-1653 — "toda transição de gate possui evidência", "sign-offs
não podem ser fabricados").

**Gates cobertos por este documento:** Gate 1 (descoberta, já rodado nesta sessão — ver journal `[gate 1]
decision`/`[gate 1] decision` desta demanda) + Gate 2 (esta especificação). Calibração já registrada no
diário (`[gate 0] plan`): demanda tamanho **Feature**, full depth Gates 1-12 (não greenfield — reusa
infraestrutura de gates/evidências da Fase 4, `GateModelRole`/resolução de modelo da Fase 7, journal/diary
da Fase 6 — mas é um motor de orquestração novo o suficiente para merecer spec e ADR próprios). Gate 3
(segurança) explicitamente **não** colapsado nem light: esta fase decide **quando um sign-off pode ser
pulado**, toca credenciais/tokens de provedor por indireção (Fase 7), e introduz um novo arquivo de estado
(`.cdt/auto/<slug>.continue.json`) fora do subtree hoje protegido — três superfícies que o `CLAUDE.md` já
classifica como gatilho de Gate 3 completo por definição própria.

**Papel responsável:** `product-owner` (skill `refine-backlog`), delegando a `business-analyst`
(`map-requirements`) e `quality-assurance` (`test-strategy`) — Gate 2 do fluxo Conductor.

**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/fase8-autonomous-mode` (de
`develop`, já criada — ver journal `[gate 0] plan`). **Esta é uma tarefa de escrita de spec** — sem código,
sem commit/push (fica para o orquestrador).

**Princípio orientador (herdado do Gate 1, hipótese H-Fase8 desta sessão):** `conductor auto` deve ser um
**orquestrador FINO** que só chama a superfície já existente — `gate start/evidence/approve/reject/calibrate`
(ADR 0005, Fase 4) e a resolução de modelo/orçamento já existente (ADR 0008 §5, `shared-budget.ts` Fase 3) —
nunca uma segunda camada de decisão paralela. **Falsificador explícito:** se a implementação precisar de um
segundo caminho de aprovação fora de `confirmOrDeny`, ou um segundo mutador de `GateState` fora dos comandos
`gate *`, a hipótese cai e a demanda reabre o Gate 4/ADR 0005. Esta spec é escrita para que nenhuma FR abaixo
force essa reabertura — e nomeia explicitamente (Grupo H) onde isso seria mais fácil de errar por acidente.

**Ator novo:** não é uma pessoa nova — o ator "Executor autônomo/agendado" já existe na tabela de atores do
Gate 1 (`gate1-discovery.md` linha 123: "Roda `conductor auto` ou `cdt-triage` sem checkpoint por gate; aprova
automaticamente decisões de baixo risco; para em sign-offs; grava `needs-human`"). O que esta fase adiciona é
um **ator de sistema**: o processo orquestrador de `conductor auto`, que move sequenciamento/condições de
parada/checkpoint de fora do prompt (`.claude/commands/cdt-auto.md`, hoje prosa) para dentro de código
determinístico — a delegação de trabalho substantivo por gate continua **agentic** (os mesmos subagentes de
papel que `/cdt` já invoca via Task tool).

**Consome (lido integralmente antes de escrever este documento):**
- `plano_desenvolvimento.md` linhas 1431-1454 (Fase 8 em si), 577-592 (§4.8, modo "Autonomous" e suas 8
  características), 507-528 (§4.7, `GateState`/`GateStatus` já travado), 1652-1653 (§10 invariantes 10/11).
- `.claude/commands\cdt-auto.md` (arquivo completo) — o protocolo de PROMPT hoje em produção: 3 condições de
  parada ("exhaustive, nothing else halts the run"), a tabela de política de auto-decisão (técnico=auto,
  sign-off=`needs-human`), o formato do checkpoint (`last_gate`/`next_gate`/`demand_branch`/
  `depth_calibration`/`deferred_human_decisions`), o protocolo de gitflow por gate. **`conductor auto` é a
  versão determinística/programática deste prompt** — não um mecanismo novo.
- Journal desta sessão, Gate 0 e Gate 1 desta mesma demanda (`cdt journal recall`) — a hipótese H-Fase8, os 6
  achados/questões (a)-(f) que o Gate 1 explicitamente devolveu para este Gate 2 resolver, e a calibração de
  profundidade.
- `packages/conductor-cli/src/commands/gate.ts` (arquivo completo) — `GateStateStoreView` (status/start/
  attachEvidence/approve/reject/calibrate), `ConfirmChannel` (`(title, message) => Promise<boolean>`),
  `GateApprovalMethod = "human" | "auto"`, `resolveTargetGate`, o comentário de `runGateApprove` ("this IS the
  one real channel"). A superfície inteira que `conductor auto` compõe sobre, nunca reimplementa.
- `packages/conductor-runtime/src/shared-budget.ts` (arquivo completo) — `SharedBudget.reserve()`
  check-e-reserve síncrono, nunca lança, teto de **tokens**; `createSharedBudget(limit)` construído **uma
  vez** no composition root e passado por referência (o comentário do próprio arquivo: "no code path can
  construct a child's own budget instead of reusing this one").
- `packages/conductor-providers/src/usage-ledger.ts` (arquivo completo) — `costUsd: number | null`, que
  colapsa para `null` no agregado assim que uma chamada tem preço desconhecido (BR-10/F1 do ADR 0008) — a
  razão pela qual um teto em dólares não pode ser fail-closed contra um `null` legítimo.
- `docs/adr/0005-fase4-gate-state-machine.md` (lido integralmente) — a máquina de estados `GateState`
  persistida, `MANDATORY_GATES = {3,5,7,8,9}` de fonte única, o mint de `Approval{method:"human"}` **só** via
  `mintHumanApproval` consumindo o resultado de `confirmOrDeny` (nunca um confirm paralelo — "condição
  vinculante"), `defaultProtectedPaths()` cobrindo `.conductor/gates/` mas **nada de `.cdt/`**, o verdict
  tri-estado terminal (`approved`/`refused`/`could-not-verify`), a calibração que nunca alcança o piso
  obrigatório (R24).
- `docs/adr/0008-fase7-model-routing-and-providers.md` (lido integralmente) — `GateModelRole`, o piso
  `max(rank do gate, rank da persona)`, `resolveModelForGate`/`evaluateModelPrecondition` como os únicos
  pontos de imposição fail-closed (D4, três pontos: abertura de gate, delegação `task`, composição de
  sessão), `MANDATORY_GATES` importado (nunca um literal novo) — o precedente **direto** de "nunca tocar o
  enum travado" que esta fase deve seguir para qualquer evento novo de orquestração.
- `docs/conductor/gate2-spec-fase7.md` — formato de referência (estrutura exata deste documento).

---

## 1. O que já existe vs. o que a Fase 8 constrói

| Capacidade | Já existe | Fase 8 constrói/especifica |
|---|---|---|
| `GateStateStoreView` (`gate start/status/evidence/approve/reject/calibrate`) | **Sim**, ADR 0005 (Fase 4) — persistido, fail-closed, protected-path. | Reusado **sem nenhuma mudança de forma**. `conductor auto` é um CALLER desta superfície, nunca um segundo mutador. |
| `ConfirmChannel`/`confirmOrDeny` como único sink de sign-off | **Sim**, ADR 0005 §6 — `!hasUI → deny`, mint de `method:"human"` só via `mintHumanApproval`. | Reusado **literalmente**. O canal que `conductor auto` monta tem que ser o MESMO sink (Grupo H, decisão flagada #5). |
| `SharedBudget` (tokens, `reserve`/`settle` síncrono) | **Sim**, ADR 0004 §5 (Fase 3) — construído uma vez no composition root, nunca um filho com cota própria. | `--budget N` passa a SER o construtor dessa MESMA instância para o run inteiro (Grupo D, decisão flagada #2). |
| `UsageLedger` (`costUsd: number \| null`) | **Sim**, ADR 0008 D9 (Fase 7) — observabilidade derivada, nunca autoriza gasto. | **Não** é o mecanismo de `--budget` — tokens e custo em $ continuam DISTINTOS (BR-6 do ADR 0008, herdada, não redecidida aqui). |
| `resolveModelForGate`/`evaluateModelPrecondition`/`GateModelRole` | **Sim**, ADR 0008 D1-D4 (Fase 7) — imposição fail-closed em 3 pontos, incluindo a própria abertura de gate. | Reusado sem segunda lógica de seleção (Grupo G). `conductor auto` delega ao MESMO ponto P1 que um `gate start` manual já usa. |
| `MANDATORY_GATES = {3,5,7,8,9}` de fonte única | **Sim**, `builtin-roles-data.ts` (ADR 0005 §4). | Reusado por import, nunca um literal novo — mesmo precedente que ADR 0008 D4 já seguiu. |
| Sequenciamento/condições de parada/checkpoint | **Sim, mas só como PROSA** — `.claude/commands/cdt-auto.md`, um protocolo de prompt que um harness de terceiro interpreta. | Fase 8 torna isso um **motor determinístico em código**, que chama os MESMOS subagentes de papel que `/cdt` já invoca — nunca uma segunda forma de delegação. |
| Formato do arquivo de checkpoint (`last_gate`/`next_gate`/`demand_branch`/`depth_calibration`/`deferred_human_decisions`) | **Sim**, já documentado em `cdt-auto.md`. | Fase 8 implementa a leitura/escrita real **e** o modelo de confiança (hint-only, nunca evidência — Grupo C, decisão flagada #3). |
| `defaultProtectedPaths()` | **Sim**, cobre `.conductor/gates/`, `~/.conductor/{library,diary,providers}`, `~/.pi/agent`, `.conductor-agent`. | **Não cobre `.cdt/auto/`** hoje — achado do Gate 1, flagado para o Gate 3/4 (§9), não decidido nesta spec. |
| Git protocol (branch por demanda, commit por gate aprovado) | **Sim**, `CLAUDE.md` — hoje aplicado manualmente por quem conduz `/cdt`. | Fase 8 torna isso automático e determinístico (Grupo F). |
| Classificação de "demanda de baixo risco" | **Não existe em lugar nenhum.** Nada hoje impede `conductor auto "rewrite the auth system"` de tentar Gates 1-8 sem supervisão (achado literal do Gate 1). | O gap central desta fase — Grupo B (decisão flagada #1). |
| Orçamento/tokens como condição de parada de um RUN inteiro (distinto do teto por-chamada que `SharedBudget` já impõe) | **Não existe.** `SharedBudget` já impõe um teto por-reserva; nada hoje reage a esse teto no nível de um RUN de `conductor auto` (checkpoint + halt gracioso). | Grupo D/E — achado novo desta spec, não antecipado pelo Gate 1 (ver §9). |

---

## 2. Goals

1. **G1 — `conductor auto <demanda>` percorre os gates aplicáveis de uma demanda de baixo risco sem parar
   por checkpoint humano, delegando trabalho substantivo aos mesmos subagentes de papel que `/cdt` já usa.**
   É o critério de saída literal do plano. *Grounding:* §8.6.
2. **G2 — "Baixo risco" é uma classificação explícita, auditável e fail-closed sob incerteza — nunca
   implícita.** Fecha o achado (f) do Gate 1: hoje nada define o termo. *Grounding:* §8.1.
3. **G3 — `--continue` retoma de um checkpoint tratado como dica de retomada, nunca como evidência —
   sempre reverificado contra o `GateState` real.** Fecha o achado (b)/(e) do Gate 1. *Grounding:* §8.3.
4. **G4 — `--budget N` impõe um teto de TOKENS reusando a MESMA `SharedBudget` do run, nunca um contador
   paralelo.** Fecha o achado (c) do Gate 1. *Grounding:* §8.2.
5. **G5 — As condições de parada de um run são exaustivas e testáveis como comportamento observável, não
   como prosa que um harness interpreta.** *Grounding:* §8.4.
6. **G6 — Cada gate aprovado gera exatamente um commit na branch da demanda — o rastro por-gate nunca é
   apagado por um squash silencioso.** Reuso determinístico do gitflow já obrigatório.
7. **G7 — A seleção de modelo por gate/papel reusa o pipeline da Fase 7 (ADR 0008) sem nenhuma lógica de
   seleção paralela.** Mesmo princípio "composição antes de fork" das fases anteriores.
8. **G8 — O canal de sign-off do modo autônomo é ESTRUTURALMENTE o mesmo `confirmOrDeny`/`ConfirmChannel`
   da Fase 4 — nunca um canal sintético que resolve `true` sem uma confirmação real.** Fecha o achado (a) do
   Gate 1 e é o alvo nomeado do Gate 9 desta demanda. *Grounding:* herdado de ADR 0005 §6 (§8.5).

---

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Paralelismo controlado** (característica geral de `conductor auto` citada no plano §4.8, mas ausente dos entregáveis literais da Fase 8, linhas 1442-1448) | Os 3 entregáveis literais desta fase são `conductor auto` / `--continue` / `--budget`, todos sequenciais por natureza (um `GateState` avança gate a gate). Paralelismo de GRUPOS dentro de um gate já existe como padrão manual (worktree por grupo + subagentes em paralelo, usado ad hoc nas Fases 5-7) — mas torná-lo um mecanismo built-in de `conductor auto` é escopo novo, não nomeado pelo critério de saída desta fase. | Fase futura não nomeada (§9 questão 6) |
| **Modos Headless/CI (`conductor --plain --json`), RPC, SDK** | O próprio §4.8 do plano lista "Autonomous" como uma seção PRÓPRIA, distinta de "Headless/CI"/"RPC"/"SDK" (linhas 594-604) — são taxonomias irmãs, não a mesma capacidade sob nomes diferentes. `conductor auto` decide AUTONOMAMENTE; headless/RPC/SDK são sobre COMO um processo externo controla uma sessão — questões ortogonais. | Fase 9 (MCP e integrações) ou não nomeada |
| **Reconciliar os 3 vocabulários de tier de modelo, ou reabrir `GateModelRole`** | Já resolvido pelo ADR 0008 (D1: dois eixos que nunca se fundem). Esta fase REUSA a resolução, não a redecide. | Já entregue (ADR 0008) |
| **Um segundo mutador de `GateState` ou um segundo caminho de aprovação fora de `confirmOrDeny`** | É o falsificador explícito da hipótese H-Fase8 (cabeçalho). Se a implementação precisar disso, a hipótese caiu e a demanda REABRE o Gate 4/ADR 0005 — não é uma escolha desta spec, é uma trava. | N/A — reabertura do Gate 4 se acontecer |
| **Executar autonomamente Gates 9-14 além do que o piso `{3,5,7,8,9}` já exige quando um desses gates é alcançado no meio de um run** | O critério de saída do plano fala literalmente em "Gates 1–8" para uma demanda de baixo risco — mas essa frase pré-data a regra não-negociável do próprio `CLAUDE.md` que veda colapsar `{3,5,7,8,9}` (que INCLUI o Gate 9). Esta spec não resolve essa tensão por conta própria — ver §9 questão 2. O que fica fora, sem ambiguidade: qualquer expectativa de que Gates 10-14 (release/observabilidade/postmortem/pentest de infra) rodem autonomamente nesta fase — não são citados pelo critério de saída em nenhuma leitura. | Gate 3/4 desta demanda (a tensão 1-8 vs. mandatórios) |
| **Números exatos** (limiar de contexto ~90%, valor default de `--budget` quando omitido, timeouts/backoff de retry do orquestrador) | Comportamento observável definido (Grupo E); os números são decisão de arquitetura/tuning, mesmo padrão já aplicado pelas Fases 5-7 a cooldown/backoff/TTL. | Gate 4/6 |
| **Um comando `conductor models trust`-like ou qualquer concessão de pin TOFU nova** | Já é um follow-up nomeado da própria Fase 7 (ADR 0008 §17.2, risco aceito "controles TOFU são efetivamente sempre-nega para o usuário legítimo"). Não é escopo desta fase. | Fase 7 follow-up, não desta fase |
| **Novo backend Docker ou serviço em background para o orquestrador** | `conductor auto` é uma máquina de estados de PROCESSO CLI (lê/escreve `GateState` + o checkpoint do run), não um serviço hospedado — mesmo padrão "nenhuma infraestrutura nova" já aplicado pelas Fases 5-7. | N/A |

---

## 4. Glossário (linguagem ubíqua)

*Grounding:* **Domain-Driven Design — Complete Professional Guide §1.1/§1.8/§1.12** (top **0.699** nesta
sessão: "a ubiquitous language pays for itself wherever the same word means different things... and the code
will be edited by people who were not in the conversation that settled it" — exatamente o caso de "checkpoint"
abaixo, colidindo entre o glossário da Fase 0 e o vocabulário desta fase).

| Termo | Definição | Fonte |
|---|---|---|
| **Run** | A unidade de execução de `conductor auto` — do momento em que o processo inicia (fresh ou `--continue`) até atingir uma condição de parada (Grupo E). Um run pode abranger vários gates. | Glossário desta spec |
| **Run checkpoint** (Fase 8) | O arquivo `.cdt/auto/<slug>.continue.json` que registra onde um RUN parou (`last_gate`/`next_gate`/`demand_branch`/`depth_calibration`/`deferred_human_decisions`) — usado só para LOCALIZAR onde retomar; nunca tratado como evidência (G3/BR-5). **Termo escolhido deliberadamente para não colidir** com o próximo item. | `cdt-auto.md`; esta spec |
| **Session checkpoint** (Pi, herdado) | Termo JÁ existente no glossário da Fase 0 (`gate1-discovery.md` linha 238): "Marco explícito de estado recuperável DENTRO DE UMA SESSÃO — usado tanto para retomada quanto para auditoria de evidência", parte da árvore append-only de mensagens/tool-calls do Pi. **Conceito de SESSÃO, mais fino** que o run checkpoint acima (uma sessão de chat pode ter dezenas; um run de `conductor auto` produz no máximo um run checkpoint por parada). A colisão de nome que o Gate 1 flagou (achado e) fica resolvida por este glossário: em qualquer texto/código/journal desta fase, "checkpoint" desacompanhado do qualificador ("run" ou "session") é considerado ambíguo e deve ser evitado. | `gate1-discovery.md` linha 238 |
| **Demanda de baixo risco** | Uma classificação EXPLÍCITA, registrada como `Decision` auditável (nunca um julgamento silencioso), que autoriza `conductor auto` a tentar os gates aplicáveis sem parar por checkpoint humano em decisões técnicas — sujeita ao veto absoluto do ruleset estático (Grupo B) e ao piso obrigatório `{3,5,7,8,9}` (que nunca é bypassado pela classificação, só pela aprovação real de cada gate). | Grupo B desta spec |
| **Condição de parada (stop condition)** | Um dos estados exaustivos que encerra um run ANTES de aterrissar em `develop`: contexto ~90%, sign-off necessário (`needs-human`), orçamento esgotado, ou concluído (`done`). "Terminar um gate" não é uma condição de parada. | `cdt-auto.md`; Grupo E |
| **Decisão auto-aprovada** (`method: "auto"`) | Uma decisão TÉCNICA (arquitetura, testes, implementação, CI, correções de pentest) que `conductor auto` decide e registra sem intervenção humana — distinta de um sign-off. Mesma forma de `GateApprovalMethod` que `gate.ts` já declara. | `gate.ts`; `cdt-auto.md` |
| **Sign-off** | Uma decisão de AUTORIDADE humana (aceite de risco CISO/PO, autorização de Gate 14, release do Gate 10) que `conductor auto` NUNCA fabrica — ao encontrar uma, registra `needs-human` e para. | `cdt-auto.md`; ADR 0005 §6 |
| **`needs-human`** | Um `GateStatus` já existente (`gate.ts` linha 43, herdado do plano §4.7) — o estado que um gate obrigatório assume quando `confirmOrDeny` nega (headless) ou quando a classificação de risco recusa prosseguir sem humano. Nunca um valor novo é adicionado ao enum por esta fase (mesmo precedente do ADR 0008 D4). | `gate.ts`; ADR 0005 |
| **`ConfirmChannel`** | `(title, message) => Promise<boolean>` — o tipo já travado em `gate.ts` linha 182, produção ligada a `confirmOrDeny`. `conductor auto` constrói UM channel deste tipo, headless por natureza (`!hasUI → deny`), nunca um segundo tipo de canal. | `gate.ts` |
| **`SharedBudget`** (herdado) | Teto de TOKENS compartilhado por referência por toda uma árvore de delegação (ADR 0004 §5). `--budget N` desta fase É o construtor desta MESMA instância para o run inteiro — nunca um segundo contador. | `shared-budget.ts` |

---

## 5. Requisitos funcionais (FR)

*Grounding para Given/When/Then:* **Specification by Example — Complete Professional Guide §2.12/§2.13**
(mesma base de todas as fases desta série).

### Grupo A — `conductor auto <demanda>` (run novo) — G1

**FR-1 — Um run novo abre a branch da demanda e inicia o Gate 1 pela superfície já existente.**
> Given nenhum `GateState` prévio para esta demanda e `develop` limpo,
> When alguém roda `conductor auto "adicionar recuperação de senha"`,
> Then uma branch `feature/adicionar-recuperacao-de-senha` é criada a partir de `develop`, `gate start 1`
> é chamado com sucesso, e o(s) subagente(s) de papel do Gate 1 começam a produzir discovery — registrado no
> diário exatamente como um `/cdt` manual registraria.

**FR-2 — A calibração de profundidade é registrada pelo MESMO mecanismo `gate calibrate` já travado.**
> Given uma demanda classificada como "small bug" (< 50 LOC de sinal),
> When `conductor auto` computa sua calibração de profundidade,
> Then ele emite o equivalente de `gate calibrate --collapse <gates não-mandatórios>` com `method:"auto"` — e
> `gate status` mostra a MESMA calibração que um humano rodando `/cdt` veria — nunca uma segunda noção de
> "colapsado" que só `conductor auto` enxerga.

### Grupo B — Classificação de "baixo risco" (G2, decisão flagada #1)

**FR-3 — Um ruleset estático de veto é avaliado antes de qualquer auto-avaliação, e é absoluto.**
> Given uma demanda cuja descrição ou diff toca autenticação, PII, tokens/credenciais, ou APIs externas — o
> MESMO critério mínimo que o `CLAUDE.md` já usa como piso do Gate 3 ("does this touch auth, PII, tokens, or
> external APIs?"),
> When `conductor auto` classifica o risco,
> Then a demanda é marcada COMO NÃO sendo de baixo risco, independentemente de qualquer flag `--risk`
> fornecida — o run para IMEDIATAMENTE como `needs-human`, ANTES de abrir o Gate 1, nomeando qual padrão
> casou.

**FR-4 — Na ausência de veto, a auto-avaliação tem default fail-closed para `needs-human` sob qualquer
incerteza.**
> Given uma demanda que não casa o ruleset estático,
> When a auto-avaliação de `conductor auto` não consegue classificar com confiança a demanda como baixo risco
> (escopo ambíguo, raio de impacto pouco claro, ou a própria descrição da demanda é subespecificada),
> Then o run para como `needs-human` ANTES de abrir o Gate 1 — nunca assume baixo risco por padrão e
> prossegue. *Grounding:* §8.1 (Router with Unclear Lane — "mandatory unclear route wired to a conservative
> handler or human").

**FR-5 — Uma flag `--risk=low` explícita é honrada só onde não conflita com o veto, e é registrada distinta
de uma auto-avaliação.**
> Given `conductor auto --risk=low "adicionar filtro de busca"` sem casar o ruleset estático (FR-3),
> When o run inicia,
> Then a `Decision` de classificação registra `method` equivalente a "humano" (afirmado explicitamente) —
> nunca `"auto"` (auto-avaliado) — a mesma distinção que o projeto já aplica a `GateApprovalMethod`, nunca
> colapsando os dois.

**FR-6 — A classificação é sempre uma `Decision` registrada e auditável — nunca um julgamento interno não
registrado.**
> Given qualquer invocação de `conductor auto` (bem-sucedida ou recusada antes do Gate 1),
> When alguém roda `cdt journal recall` para esta demanda,
> Then existe exatamente UMA `Decision` de classificação de risco, consultável sem reabrir nenhum transcript.

### Grupo C — `conductor auto --continue [slug]` e o run checkpoint (G3, decisão flagada #3/#4)

**FR-7 — `--continue` reverifica contra o `GateState` real; o run checkpoint só localiza onde retomar.**
> Given um run checkpoint que afirma `next_gate: 6` para a demanda X,
> When `conductor auto --continue X` roda,
> Then o orquestrador primeiro lê `gate status` para X; se o `GateState` mostra que o Gate 5 ainda não está
> `approved`, a retomada continua a PARTIR do Gate 5 (ou de onde quer que o `GateState` prove que o run
> realmente está) — nunca do Gate 6 só porque o checkpoint disse isso. *Grounding:* §8.3.

**FR-8 — Um run checkpoint ausente ou corrompido não bloqueia a retomada quando o `GateState` existe.**
> Given a demanda X tem `GateState` real e persistido, mas seu run checkpoint foi apagado ou é JSON
> ilegível,
> When `conductor auto --continue X` roda,
> Then a retomada ainda tem sucesso lendo `gate status` diretamente — o checkpoint é conveniência, nunca
> pré-requisito.

**FR-9 — O schema do run checkpoint é exatamente o já documentado pelo `cdt-auto.md`.**
> Given um run atinge uma condição de parada,
> When o checkpoint é escrito,
> Then é um JSON em `.cdt/auto/<slug>.continue.json` com `last_gate`, `next_gate`, `demand_branch`,
> `depth_calibration`, e `deferred_human_decisions` — nenhum campo adicional é tratado como autoritativo por
> `--continue` (FR-7 já garante isso pela reverificação).

### Grupo D — `conductor auto --budget <N>` (G4, decisão flagada #2)

**FR-10 — `--budget N` constrói a MESMA instância de `SharedBudget` que os subagentes do run compartilham.**
> Given `conductor auto "..." --budget 100000`,
> When o run monta sua árvore de delegação para o subagente do Gate 1,
> Then `createSharedBudget(100000)` é chamado UMA VEZ no composition root do run, e essa ÚNICA instância (por
> referência) é o que TODO subagente de TODO gate subsequente reserva/liquida contra — nunca um segundo
> contador que o gasto de um subagente não debita. *Grounding:* §8.2.

**FR-11 — Esgotamento de orçamento para o run graciosamente.**
> Given um run cuja `SharedBudget` tem 0 restante,
> When a próxima chamada de modelo tentaria `reserve()`,
> Then `reserve` devolve `null`, o run não inicia nenhum trabalho novo, escreve um run checkpoint registrando
> `status: "budget-exceeded"`, registra a parada como `Decision`, faz push da branch, e para — a MESMA forma
> graciosa da parada por contexto ~90% — nunca um `BudgetExhaustedError` não capturado chegando ao usuário
> como um crash.

**FR-12 — Omitir `--budget` não remove o teto — usa o default do produto.**
> Given `conductor auto "..."` sem `--budget`,
> When o run constrói sua `SharedBudget`,
> Then um limite DEFAULT (número exato = Gate 4/6, não fechado aqui) é aplicado — nunca "sem teto nenhum",
> que reabriria a mesma classe de risco que o teto existe para evitar.

### Grupo E — Condições de parada (G5, comportamento testável)

**FR-13 — Contexto ~90% faz checkpoint e para.**
> Given a estimativa de uso de contexto do run cruza ~90% da janela do modelo,
> When o gate corrente termina seu trabalho,
> Then, NESTA ORDEM: o run checkpoint é escrito, a parada é registrada no diário, a branch recebe push, e o
> run para — nunca uma parada no MEIO de um gate deixando evidência parcial não commitada.

**FR-14 — Sign-off necessário para o run como `needs-human`.**
> Given o `ConfirmChannel` de um gate obrigatório resolve para `false`/nega (headless, sem TTY),
> When `gate approve` é tentado,
> Then `GateState.status` vira `needs-human`, o run registra a parada, faz push, e para — nunca re-tenta o
> mesmo confirm, nunca cai para um segundo canal.

**FR-15 — Concluído (`done`) aterrissa em `develop`.**
> Given todos os gates aplicáveis à calibração deste run estão `approved` — respeitando sempre o piso
> `{3,5,7,8,9}` (ver §9 questão 2 sobre a tensão entre "Gates 1-8" do texto do plano e essa regra
> não-negociável),
> When o último gate aplicável é aprovado,
> Then a branch recebe push e é aterrissada em `develop` (merge ou PR, conforme o remoto exigir), e o run
> termina com status `landed` — nenhum run checkpoint adicional é necessário.

**FR-16 — Orçamento esgotado é sua própria condição de parada, distinta de `needs-human`.**
> Given a condição de FR-11,
> When o run para,
> Then o motivo registrado é `budget-exceeded`, nunca colapsado em `needs-human` — são causas diferentes (uma
> é operacional, a outra é autoridade humana) e um leitor do diário precisa distingui-las sem reabrir o
> transcript. *Achado novo desta spec, não antecipado pelo Gate 1 — ver §9 questão 3.*

**FR-17 — Terminar um gate, sozinho, nunca é uma condição de parada.**
> Given o Gate N foi aprovado e commitado, o Gate N+1 é aplicável, e nenhuma das condições FR-13/14/16/15
> vale,
> When o run continua,
> Then o Gate N+1 começa na MESMA invocação — sem resumo-e-espera, sem sugestão de `--continue` quando nada
> de fato parou.

### Grupo F — Commit por gate (G6)

**FR-18 — Todo gate aprovado que mudou arquivos é commitado na branch da demanda.**
> Given o Gate N é aprovado e produziu mudanças de arquivo,
> When a aprovação é registrada,
> Then um commit `gate <N>: <resumo>` é criado na branch da demanda — nunca deferido para um commit
> agregador no final do run.

**FR-19 — Um gate que não mudou nenhum arquivo não é commitado.**
> Given o Gate N é aprovado mas não produziu nenhuma mudança de arquivo,
> When a aprovação é registrada,
> Then nenhum commit vazio é criado — mesma exceção já documentada no protocolo git do `CLAUDE.md`, reusada
> sem redecidir.

### Grupo G — Resolução de modelo/papel por gate (G7)

**FR-20 — A resolução de modelo para a delegação de `conductor auto` reusa `resolveModelForGate`/
`evaluateModelPrecondition` (ADR 0008) sem segundo caminho.**
> Given o Gate 8 é alcançado e seu `GateModelRole` é `slow`,
> When `conductor auto` abre o Gate 8,
> Then a MESMA checagem `evaluateModelPrecondition` que um `gate start 8` manual já roda é o que autoriza (ou
> recusa) o trabalho daquele gate — `conductor auto` nunca contorna isso chamando um model runtime
> diretamente.

**FR-21 — Um gate cuja pré-condição de modelo recusa fail-closed para o run.**
> Given a resolução de modelo para o Gate N não produz nenhum candidato compatível,
> When `conductor auto` tenta abrir o Gate N,
> Then o run para nomeando o gate e o `GateModelRole` que faltou — mesma recusa que um `gate start` manual já
> produziria (D4 do ADR 0008), nunca um segundo tipo de erro.

### Grupo H — Canal de sign-off (G8, decisão flagada #5, alvo do Gate 9)

**FR-22 — O `ConfirmChannel` do modo autônomo é vinculado ao MESMO sink `confirmOrDeny` da Fase 4.**
> Given `conductor auto` roda headless (sem TTY),
> When ele alcança o passo de aprovação de um gate obrigatório,
> Then o `ConfirmChannel` que ele passa para `runGateApprove` é o MESMO canal apoiado em `confirmOrDeny` que
> qualquer outro chamador headless usa (`!hasUI → deny`) — nunca um canal que `conductor auto` constrói por
> conta própria e que poderia resolver `true` sem uma interação humana real.

**FR-23 — Esta costura é um alvo nomeado do Gate 9 desta demanda.**
> Given a condição vinculante de FR-22,
> When o Gate 9 desta demanda (pentest de aplicação) rodar,
> Then um dos ataques executados é especificamente "tentar forçar `conductor auto` a aprovar um gate
> obrigatório sem um `confirm` real resolvendo `true`" — nomeado aqui para que o Gate 9 não precise
> redescobrir esta superfície.

---

## 6. Business rules

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | A classificação de risco nunca é implícita — sempre uma `Decision` auditável registrada ANTES do Gate 1 abrir; ausência de classificação explícita colapsa para `needs-human` (fail-closed), nunca para "prossiga assumindo baixo risco". | Achado (f) do Gate 1; Prompt Engineering PPP §13.5 (§8.1) | FR-3, FR-4, FR-6 |
| **BR-2** | O veto do ruleset estático (auth/PII/tokens/APIs externas) é absoluto — nenhuma flag do usuário o sobrepõe. Mesmo critério mínimo que o `CLAUDE.md` já usa como piso do Gate 3, nunca redecidido aqui. | `CLAUDE.md`, regra não-negociável 2 | FR-3, FR-5 |
| **BR-3** | `--budget` semeia/vincula a MESMA instância de `SharedBudget` compartilhada pelos subagentes do run — nunca um segundo contador paralelo de tokens. Reuso sobre duplicação (precedente ADR 0004 §5, "nenhum filho recebe cota própria"). | `shared-budget.ts`; Pragmatic Programming Practices §1.4 (§8.2) | FR-10 |
| **BR-4** | Esgotamento de orçamento para o run graciosamente — nunca continua silenciosamente além de uma reserva negada, e nunca deixa um `BudgetExhaustedError` não capturado chegar ao usuário como crash (mesma disciplina que `task.ts` já aplica na borda de delegação). | `shared-budget.ts`; `tools/task.ts` (Fase 3) | FR-11, FR-16 |
| **BR-5** | O run checkpoint é DICA, nunca evidência e nunca autoritativo. Em `--continue`, o orquestrador SEMPRE relê o `GateState` real primeiro; um descompasso é resolvido a favor do `GateState`, e um checkpoint ausente/corrompido nunca bloqueia a retomada. | Achado (b)/(e) do Gate 1; Secure and Reliable Systems Design §2.12 "When not to rely on recovery as the control" (§8.3) | FR-7, FR-8, FR-9 |
| **BR-6** | "Run checkpoint" (Fase 8) e "session checkpoint" (Pi, glossário pré-existente da Fase 0) são conceitos DISTINTOS — nenhum texto/código/journal desta fase usa "checkpoint" desacompanhado do qualificador onde os dois poderiam ser confundidos. | Achado (e) do Gate 1; Domain-Driven Design §1.1/§1.12 (§4) | Glossário; todo o Grupo C |
| **BR-7** | A resolução de modelo/papel por gate reusa `resolveModelForGate`/`evaluateModelPrecondition` (ADR 0008) — `conductor auto` nunca implementa uma segunda lógica de seleção; um gate cuja pré-condição de modelo recusa fail-closed produz a MESMA recusa que um `gate start` manual já produziria. | ADR 0008 D4 | FR-20, FR-21 |
| **BR-8** | O `ConfirmChannel` do modo autônomo é construído vinculado ao MESMO `confirmOrDeny` que a Fase 4 já estabeleceu — nunca um canal sintético. É isto (não uma convenção de prompt) que torna auto-aprovação de um gate obrigatório ESTRUTURALMENTE impossível para o loop autônomo. | ADR 0005 §6 (herdado, §8.5) | FR-22, FR-23 |
| **BR-9** | As condições de parada de um run são exaustivas: contexto ~90%, sign-off necessário, orçamento esgotado, concluído. Terminar um gate, um grupo paralelo, ou uma subtarefa NUNCA é, por si só, uma condição de parada — o run continua para o próximo gate aplicável na MESMA invocação. | `cdt-auto.md` ("stop conditions — exhaustive"); Prompt Engineering PPP §6.5 "Stop Conditions and Knowing When to Halt" (§8.4) | FR-13, FR-14, FR-15, FR-16, FR-17 |
| **BR-10** | Cada gate aprovado que mudou arquivos gera exatamente um commit `gate <N>: <resumo>` na branch da demanda; um gate que não mudou nada não é commitado. Substituir "checkpoint humano por gate" por "evidência mecanicamente verificada + lotes pequenos" não é um relaxamento de rigor — é a mesma direção que melhora estabilidade E throughput. | `CLAUDE.md` (protocolo git); Measuring Software Delivery Performance §2.3/§2.5 (§8.6) | FR-18, FR-19 |

---

## 7. Edge cases

1. **Demanda que toca autenticação, mesmo com `--risk=low` explícito.** O veto estático (BR-2) recusa antes
   do Gate 1 abrir, nomeando o padrão casado — a flag do usuário nunca é honrada em conflito com o veto
   (FR-3/FR-5), e o REFUSO é registrado em voz alta (nunca silenciosamente ignorado nem silenciosamente
   aceito).
2. **`--continue` com checkpoint afirmando `next_gate: 6`, mas o `GateState` real mostra o Gate 5 ainda
   `rejected`.** A retomada continua do que o `GateState` prova (Gate 5), nunca do que o checkpoint afirma
   (FR-7).
3. **`--continue` com o arquivo de checkpoint apagado/JSON malformado, mas `GateState` existe e é válido.**
   A retomada tem sucesso lendo `gate status` diretamente — o checkpoint nunca é pré-requisito (FR-8).
4. **`--budget N` onde N é menor que a reserva mínima de uma única chamada de modelo.** A primeira
   `reserve()` devolve `null` imediatamente; o run para ANTES de qualquer trabalho, `budget-exceeded` é
   registrado, nada fica corrompido (FR-11).
5. **Dois `conductor auto --continue` concorrentes para a mesma demanda.** A mesma disciplina de lock+CAS
   que `gate-store.ts` já garante (ADR 0005 §3.3) cobre isso — nenhum mecanismo de concorrência novo é
   inventado por esta fase.
6. **Um gate obrigatório (ex.: Gate 9) é alcançado no meio de um run classificado como baixo risco.** O
   sign-off/`needs-human` dispara pela incapacidade estrutural (BR-8) — o run para, INDEPENDENTEMENTE de
   quão "baixo risco" a classificação inicial foi. A classificação afeta se o run PODE COMEÇAR sem
   supervisão; nunca contorna a máquina de sign-off por-gate (FR-14, FR-22).
7. **Contexto ~90% é atingido no MEIO do trabalho de um gate, não numa fronteira limpa.** O run termina o
   trabalho do gate CORRENTE antes de fazer checkpoint (mesma regra já em `cdt-auto.md`) — nunca faz
   checkpoint deixando evidência parcial/não commitada (FR-13).
8. **`--risk=low` fornecido para uma demanda que TAMBÉM casa o veto estático** (ex.: "`--risk=low`,
   implementar login OAuth"). A flag não é honrada onde conflita com o veto (BR-2); o conflito é registrado
   como "override tentado e recusado" — nem silenciosamente aceito, nem silenciosamente ignorado (edge 1,
   FR-5).
9. **O run checkpoint existe, mas seu `demand_branch` não bate com o branch/estado real do repositório de
   trabalho.** Resolvido pela MESMA disciplina "conteúdo, não nome, é a verdade" que o envelope de
   `GateState` já aplica (ADR 0005 §3.1) — a retomada nunca avança cegamente sobre um descompasso, o
   descompasso é reportado.

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 2` (backend
saudável). **Cobertura honesta:** uma citação forte (0.699-0.705) para classificação/glossário, o resto
moderado (0.58-0.64), reportado como tal — mesmo padrão já estabelecido nas Fases 5-7 desta série para
tópicos de orquestração agent-native que o corpus (majoritariamente arquitetura/engenharia geral) não cobre
em profundidade.

1. **Classificação com default seguro sob incerteza, rota "unclear" cabeada para um handler conservador ou
   humano** → **Prompt Engineering — Principles, Patterns and Practice §13.5 "Flow Patterns" (Router with
   Unclear Lane)** (top **0.705** nesta sessão — "cheap classification front-end with a safe default...
   mandatory `unclear` route wired to a conservative handler or human") — base direta de G2/BR-1/FR-3/FR-4,
   confirmando com uma consulta fresca de Gate 2 a mesma citação que o Gate 1 já havia trazido com cobertura
   0.58-0.62.
2. **Um teto de recurso compartilhado tem UM lar, tudo deriva dele — nunca um segundo contador paralelo** →
   **Pragmatic Programming Practices — Complete Professional Guide §1.4 "Architecture: single source of
   truth"** (top **0.588**: "give each fact one home and have everything derive from it") — base de
   G4/BR-3/FR-10, a razão pela qual `--budget` tem que vincular à MESMA `SharedBudget`, nunca criar uma
   segunda.
3. **Recuperação/checkpoint só é um controle válido onde o estado restaurado é confiável e verificável —
   não onde é uma crença não verificada** → **Secure and Reliable Systems Design — Complete Professional
   Guide §2.12 "When not to rely on recovery as the control"** (top **0.641**: "that bound exists only where
   the damage lives in state you hold and can restore. Everywhere else, a rehearsed recovery plan is a
   second layer that gets believed and can never actually fire") — base direta de G3/BR-5/FR-7/FR-8: o run
   checkpoint só é seguro como PONTEIRO para onde reverificar, nunca como o próprio estado confiável.
4. **Condições de parada precisam ser exaustivas e explícitas, não implícitas ou descobertas em tempo de
   execução** → **Prompt Engineering — Principles, Patterns and Practice §6.5 "Stop Conditions and Knowing
   When to Halt"** (top **0.588**) — base de G5/BR-9/Grupo E, a mesma leitura já registrada no diário do
   Gate 6 da Fase 6 para o template de `cdt-auto` ("loops need unambiguous exit conditions, not implicit
   ones"), agora aplicada às condições de parada de `conductor auto` em si.
5. **Vocabulário único evitando colisão de termos (glossário)** → **Domain-Driven Design — Complete
   Professional Guide §1.1/§1.8/§1.12** (top **0.699**, mesma base de todas as fases desta série) — base do
   §4 e especificamente da desambiguação "run checkpoint" vs. "session checkpoint" (decisão flagada #4).
6. **Substituir um gate de aprovação humana externa por testes automatizados + lotes pequenos MELHORA
   estabilidade, não é um relaxamento de rigor** → **Measuring Software Delivery Performance — Complete
   Professional Guide §2.3 "Small batches are safer" / §2.5** (top **0.637**/**0.630**: "Before: external
   change-approval board (slow, ~no stability gain). After: peer review in PRs + automated tests + small
   batches -> faster lead time AND lower change failure rate") — base direta da política de auto-decisão
   (G1/BR-10): confirma com uma nova consulta de Gate 2 a mesma citação que o Gate 1 já havia trazido.
7. **Canal único de confirmação, não-forjável, reusado por todo entry point** → **cobertura fraca/fora do
   alvo nesta rodada específica** (melhor resultado: Messaging and Integration Patterns §3.12, top 0.614,
   sobre garantias de entrega, não sobre canais de confirmação). **Não re-forçado.** G8/BR-8/FR-22 continuam
   fundamentados no grounding JÁ REGISTRADO pelo ADR 0005 §6 desta mesma demanda-mãe (Building Secure and
   Reliable Systems §3.3/§3.8 — "sensitive actions require multi-party authorization"; Security Engineering
   Principles §2.9/§2.12 — "uncertainty deny; an error must never read as permission") — herdado, não
   redecidido.
8. **Given/When/Then, exemplos concretos** → **Specification by Example — Complete Professional Guide
   §2.12/§2.13** (mesma base de todas as fases) — base de todo o §5.
9. **Resolução de modelo por gate/papel** → não re-consultado nesta sessão; herdado literalmente do
   grounding já registrado no ADR 0008 (Managing Software Complexity §3.1, Domain-Driven Design §2.4) — G7
   REUSA a decisão, não a redecide, mesmo princípio "não re-forçar uma citação já estabelecida" aplicado
   pelo próprio ADR 0008 a decisões herdadas do Gate 3.

---

## 9. Questões abertas para o Gate 3 e Gate 4

Registradas aqui porque nasceram durante a especificação, mas **não são decisões desta PO** — são insumo,
não resposta. As 5 primeiras são as que o Gate 1 já havia devolvido e que esta spec resolveu como DECISÃO (e
por isso NÃO reaparecem aqui); as questões abaixo são as que permanecem genuinamente em aberto, incluindo 3
achados NOVOS desta sessão de Gate 2 que o Gate 1 não antecipou.

1. **`defaultProtectedPaths()` para `.cdt/auto/`.** Esta spec decide o MODELO DE CONFIANÇA (BR-5: hint-only,
   sempre reverificado) — mas a recomendação do Gate 1 de também ADICIONAR o subtree aos protected-paths é
   um detalhe de implementação, não de spec. Pergunta para o Gate 3/4: dado que BR-5 já neutraliza o risco de
   um checkpoint forjado (ele nunca é confiado para avançar um gate), a proteção do caminho ainda vale como
   defesa-em-profundidade (mesmo raciocínio "duas camadas, nenhuma sozinha basta" que o ADR 0005 §9.1 já
   aplicou a `.conductor/gates/`), ou é cerimônia sem efeito de segurança adicional dado que BR-5 já fecha o
   vetor prático?
2. **A tensão "Gates 1-8" (texto literal do plano) vs. `{3,5,7,8,9}` nunca-colapsável (regra não-negociável
   do `CLAUDE.md`, que INCLUI o Gate 9).** Achado desta sessão de Gate 2, não antecipado pelo Gate 1. O
   critério de saída da Fase 8 diz literalmente que uma demanda de baixo risco "deverá percorrer
   automaticamente Gates 1–8" — mas o Gate 9 (pentest de aplicação) é um dos 5 gates que o `CLAUDE.md`
   proíbe colapsar "regardless of how small the change looks". Hipótese de trabalho desta spec, NÃO uma
   decisão fechada: a frase do plano é anterior à formalização da regra não-negociável e deve ser lida como
   "no mínimo até o Gate 8, continuando por qualquer gate adicional que a calibração da demanda exija, nunca
   pulando `{3,5,7,8,9}`" — nunca como uma licença para pular o Gate 9. FR-15 já foi escrita para não
   contradizer essa leitura, mas a reconciliação formal é do Gate 3/4 (mesmo padrão que o ADR 0005 §4 já
   aplicou para resolver a discrepância `{3,5,7,8}` vs. `{3,5,7,8,9}` entre `CLAUDE.md` e `roles.py`: código/
   regra vigente pesa mais que prosa antiga).
3. **Orçamento esgotado como uma 4ª condição de parada, além das 3 que `cdt-auto.md` hoje declara
   "exaustivas, nada mais para o run".** Achado desta sessão de Gate 2, não antecipado pelo Gate 1. O
   `cdt-auto.md` atual (protocolo de PROMPT) foi escrito antes de `--budget` existir como flag determinística
   — sua lista de 3 condições não menciona orçamento. Esta spec (FR-16) trata `budget-exceeded` como uma
   condição de parada GENUINAMENTE DISTINTA de `needs-human` (uma é operacional, a outra é autoridade
   humana). O Gate 4 precisa ratificar essa extensão estruturalmente (é um evento de orquestração novo, nunca
   um valor novo em `GateStatus` — mesmo precedente do ADR 0008 D4), e o Gate 6 precisa atualizar o
   `cdt-auto.md` para que sua lista pare de se autodeclarar exaustiva com 3 quando a versão determinística
   desta fase tem 4.
4. **Mecanismo exato da auto-avaliação de risco (FR-4).** O QUE conta como "incerteza" o suficiente para
   cair em `needs-human` é uma decisão de design/prompt do Gate 4/6 — esta spec só define o comportamento
   observável (default fail-closed), não o mecanismo interno de julgamento.
5. **Onde `conductor auto` vive fisicamente.** A hipótese H-Fase8 (cabeçalho) é que é uma adição FINA a
   `@conductor/cli` (ex.: `commands/auto.ts`), nunca um pacote novo com um segundo mutador de estado — mas
   isso é uma decisão de arquitetura, a ser ratificada (ou a hipótese falsificada) no Gate 4, seguindo o
   mesmo padrão de decisão de path já aplicado pelas Fases 5-7 (`@conductor/library`, `@conductor/providers`
   só nasceram como pacotes novos quando esconder profundidade real atrás de interface estreita justificava).
6. **Paralelismo controlado** (non-goal §3) — se e quando uma fase futura quiser isso, que mecanismo? O
   padrão manual já usado ad hoc nas Fases 5-7 (worktree por grupo + subagentes em paralelo) é candidato,
   mas tornar isso um mecanismo built-in de `conductor auto` não foi avaliado por esta spec.
7. **Valor default de `--budget` quando omitido (FR-12).** Um número precisa existir para que "omitir
   `--budget`" não signifique "sem teto" — o valor exato é Gate 4/6, mesmo padrão de "todo número desta
   fase é um default sobreponível, declarado como tal" já aplicado pelo ADR 0008 a cooldown/backoff/TTL.
8. **A demanda que falha o veto estático (FR-3) ainda abre uma branch/registra um `GateState` inicial, ou
   recusa antes mesmo disso?** Esta spec (FR-3) diz "para antes do Gate 1 abrir", mas não especifica se isso
   significa "a branch nunca é criada" ou "a branch é criada, mas `gate start 1` nunca é chamado" — uma
   questão de sequenciamento para o Gate 4 decidir, sem consequência de segurança (ambas são fail-closed),
   só de UX/auditabilidade.

---

## Registro no diário

`cdt journal add --gate 2 --kind decision` a partir de `C:\development\source\projects\conductor`, ao final
desta sessão, registrando:

1. **Gate 2 Fase 8 fechado** — 23 FRs em 8 grupos (A-H), 10 business rules, 9 edge cases, 8 questões abertas
   para os Gates 3/4. As 5 decisões que o Gate 1 devolveu explicitamente para este gate foram TODAS
   resolvidas como decisão de spec (nunca deixadas em aberto): (1) baixo risco = veto estático absoluto
   (auth/PII/tokens/APIs externas, mesmo piso do Gate 3 do `CLAUDE.md`) + auto-avaliação fail-closed sob
   incerteza (Router-with-Unclear-Lane) + override humano explícito distinguível; (2) `--budget` semeia a
   MESMA instância de `SharedBudget` do run inteiro, nunca um segundo contador — tokens, nunca dólares,
   porque `costUsd` colapsa para `null` legitimamente; (3) o run checkpoint é hint-only, sempre reverificado
   contra o `GateState` real em `--continue`, nunca avança um gate pela própria palavra — a extensão real de
   `defaultProtectedPaths()` fica flagada para o Gate 3/4, não decidida aqui; (4) "checkpoint" desambiguado
   em "run checkpoint" (Fase 8, arquivo de resume de RUN) vs. "session checkpoint" (Pi, pré-existente,
   árvore de sessão); (5) o `ConfirmChannel` do modo autônomo tem que vincular ao MESMO `confirmOrDeny` da
   Fase 4 — nunca um canal sintético — nomeado explicitamente como alvo do Gate 9 desta demanda.
2. **3 achados NOVOS desta sessão de Gate 2, não antecipados pelo Gate 1** — registrar como questões
   abertas, não como decisões: (a) tensão entre o texto literal do plano ("Gates 1-8" para baixo risco) e a
   regra não-negociável `{3,5,7,8,9}` do `CLAUDE.md` (que inclui o Gate 9) — hipótese de trabalho declarada
   sem decidir; (b) esgotamento de orçamento é uma 4ª condição de parada genuína, distinta de `needs-human`,
   que o `cdt-auto.md` atual (escrito antes de `--budget` existir) ainda não lista em sua "lista exaustiva de
   3" — Gate 4 precisa ratificar, Gate 6 precisa atualizar o prompt; (c) sequenciamento exato de quando o
   veto estático recusa uma demanda (antes de criar a branch, ou depois) não tem consequência de segurança
   mas fica em aberto para o Gate 4.
3. **Grounding desta sessão**: 1 citação forte (0.699-0.705, DDD + Router-with-Unclear-Lane) para
   classificação de risco e glossário; 4 citações moderadas (0.58-0.64) para budget/checkpoint/stop
   conditions/small-batches; 1 lacuna honestamente declarada (canal de confirmação único — cobertura fraca
   nesta rodada específica, apoiada em vez disso no grounding já registrado pelo ADR 0005 §6 da mesma
   demanda-mãe, não re-forçada por citação nova).