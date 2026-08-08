# Gate 2 — Especificação (fonte da verdade): Wiring de delegação real de subagentes em `runAuto`

**Demanda:** `feature/auto-subagent-delegation` — follow-up disclosed pela própria Fase 8 (ADR
0009 §20, "Loop-back do Gate 8"): `runAuto` (`packages/conductor-cli/src/commands/auto.ts`) sequencia os 14
gates, mas o passo (c) do seu próprio loop ("delegar trabalho aos subagentes de papel") nunca teve call site —
o cabeçalho da função já confessa isso em voz alta desde o Gate 6 da Fase 8. Esta demanda fecha esse passo:
liga `runAuto` à infraestrutura de delegação REAL que a Fase 3 já construiu e testou
(`packages/conductor-runtime/src/tools/task.ts`), nunca uma segunda implementação dela.

**Gates cobertos por este documento:** Gate 0/1 (descoberta, já rodados nesta sessão — ver journal `[gate 0]
plan` e `[gate 1] decision` desta demanda) + Gate 2 (esta especificação).

**Papel responsável:** `product-owner` (skill `refine-backlog`), delegando a `business-analyst`
(`map-requirements`) e `quality-assurance` (`test-strategy`) — Gate 2 do fluxo Conductor.

**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/auto-subagent-delegation` (de
`develop`). **Esta é uma tarefa de escrita de spec** — sem código, sem commit/push (fica para o Gate 4/6).

**Princípio orientador (herdado de H-Fase8 e reafirmado pelo Gate 1 desta demanda):** `runAuto` continua sendo
o orquestrador FINO da Fase 8 — esta demanda não o transforma num segundo `runTask`, nem reabre
`createGovernedChildSessionSpawner`. Ela é uma nova CHAMADORA legítima da infraestrutura de delegação já
existente, da mesma forma que `session.ts`'s `createTaskTool` já é uma chamadora dela para o caminho
model-driven (`/cdt` manual). **Falsificador explícito, estendido de H-Fase8:** se esta demanda precisar de um
segundo call site literal de `createAgentSession(`, de uma segunda `SharedBudget`, ou de uma segunda lógica de
autorização role-a-role, a hipótese cai e a demanda reabre o ADR 0004/0009.

**Consome (lido integralmente antes de escrever este documento):**
- Journal desta sessão, Gate 0 e Gate 1 (`cdt journal recall "subagent delegation runAuto gate1 findings"`) —
  os 4 achados que este Gate 2 resolve como decisão de spec.
- `docs/adr/0009-fase8-autonomous-mode.md` (integral, incluindo §20 "Loop-back do Gate 8" — o gap que esta
  demanda fecha, e §1-§19, a disciplina "compõe, nunca reimplementa" que esta demanda estende).
- `packages/conductor-cli/src/commands/auto.ts` (arquivo completo) — `runAuto` real (Gate 6 da Fase 8), o loop
  por-gate, o passo (c) hoje vazio (linhas 658-659), `RunStopReason`, `stopRun`, o padrão try/catch já aplicado
  ao branch mandatório de aprovação.
- `packages/conductor-runtime/src/tools/task.ts` (arquivo completo) — `TaskToolParams`, `SpawnChildSessionInput`
  (o campo `model: Model<any>` OBRIGATÓRIO, GAP-5), `DelegationEvidence`, `createGovernedChildSessionSpawner`
  (o único outro call site permitido de `createAgentSession`, travado por scan estático em
  `task-sole-constructor.test.ts`), `runTask` (autorização role-a-role: `canSpawn`/depth-cap — responde a uma
  pergunta que não se aplica a um chamador determinístico/tabelado), `createTaskTool` (como `session.ts` já
  compõe tudo isso para o caminho model-driven).
- `packages/conductor-config/src/builtin-roles-data.ts` (`BUILTIN_GATE_ROLES`, `MANDATORY_GATES`) e
  `packages/conductor-config/src/model-role.ts` (`GateModelRole`, `DEFAULT_GATE_MODEL_ROLES`).
- `packages/conductor-runtime/src/gate-evidence.ts` (arquivo completo) — `EvidenceRef` (4 kinds, "declared ONCE,
  HERE"), `EvidenceProvenance`, `resolveEvidenceRef`, `hasSufficientEvidenceForMandatoryGate` (o "golden rule",
  já estendido uma vez pelo Gate-8-loop-back da Fase 8 para aceitar `git-commit` — o precedente direto para
  esta spec estender de novo).
- `packages/conductor-runtime/src/model-precondition.ts` (`evaluateModelPrecondition`, `ModelResolutionPort`,
  `ModelPreconditionVerdict`) e `packages/conductor-providers/src/types.ts`
  (`ResolveModelRequest{gate,persona?,activeProvider?,purpose}`, `ModelResolution{resolved:true;model:Model<Api>;
  ...}`) — confirmando que `purpose: "delegation"` já é um literal do union travado do ADR 0008 §16, SEM
  NENHUM call site hoje (`grep '"delegation"'` no monorepo só acerta a própria declaração de tipo).
- `packages/conductor-cli/src/commands/model-context.ts` (`createGateModelResolutionPort`,
  `createCliModelResolutionPort`) — a porta real que `runAuto` já constrói para a pré-condição do gate, e que
  esta demanda reusa para também obter o `Model` concreto.
- `packages/conductor-cli/src/commands/chat.ts` (`loadRealRoleRegistryAndSkills`, `toTaskRoleRegistryView`,
  `resolveEffectivePolicy`) e `packages/conductor-cli/src/commands/audit-trail.ts` (`createAuditTrailWriter`) —
  os colaboradores que `runAuto` precisa construir para si mesmo (não tem sessão-pai de quem herdar), e que já
  existem prontos, usados hoje por `chat.ts`'s composition root para o mesmo propósito.
- `packages/conductor-cli/src/cli.ts:452` — como o composition root já constrói `evidenceContext` para
  `gate evidence` manual (o padrão exato que `runAuto` precisa replicar, estendido com o 5º kind).
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:670` — confirmando `Model<Api>.contextWindow: number`
  como campo real (o denominador concreto para o limiar de ~90% do FR-6).
- `docs/conductor/gate2-spec-fase8.md` — formato de referência (estrutura exata deste documento).

---

## 1. O que já existe vs. o que esta demanda constrói

| Capacidade | Já existe | Esta demanda constrói/especifica |
|---|---|---|
| `runAuto` sequenciando os 14 gates, condições de parada, checkpoint, budget de RUN | **Sim**, Fase 8 (ADR 0009, Gates 5-9 fechados) — `commands/auto.ts`. | Reusado **sem nenhuma mudança de forma** ao loop já existente — esta demanda só preenche o passo (c), hoje um comentário vazio. |
| Delegação governada a um papel (autorização, budget, evidência, spawn in-process) | **Sim**, Fase 3 (ADR 0004) — `tools/task.ts`: `runTask`/`createGovernedChildSessionSpawner`/`createTaskTool`. Testada e usada hoje pelo caminho model-driven (`/cdt` manual via a ferramenta `task`). | `runAuto` se torna a **segunda** chamadora legítima de `createGovernedChildSessionSpawner` — nunca uma segunda implementação, nunca um segundo call site de `createAgentSession`. |
| `BUILTIN_GATE_ROLES[gate]` — candidatos por gate | **Sim**, `builtin-roles-data.ts` — mas sempre ≥1 candidato, sem designação de "líder". | O gap achado no Gate 1: uma regra de seleção determinística (Grupo A). |
| `resolveModelForGate`/`evaluateModelPrecondition`/`GateModelRole` | **Sim**, ADR 0008 (Fase 7) — `runGateStart` já impõe a pré-condição (`purpose:"gate-open"`, sem `persona`) antes de abrir um gate. `purpose:"delegation"` já é um literal do contrato travado (§16 apêndice), **zero call site**. | O primeiro caller real de `purpose:"delegation"` (Grupo B) — mesmo padrão de "primitivo construído e nunca ligado" que o próprio N1 do ADR 0009 já nomeou. |
| `EvidenceRef` (4 kinds: `git-commit`/`file`/`journal-entry`/`test-run`) | **Sim**, `gate-evidence.ts` — já estendido uma vez (Gate-8-loop-back da Fase 8, que adicionou `git-commit` ao golden rule). | Um 5º kind, `"delegation"` (Grupo E) — o padrão de extensão já tem precedente direto neste mesmo arquivo. |
| `RunStopReason` com 4 variantes, `"context-limit"` declarado mas nunca produzido | **Sim**, ADR 0009 §16/§20 — a lacuna nomeada explicitamente como bloqueada pela MESMA fiação que esta demanda fecha. | O primeiro código-caminho que produz `"context-limit"` de verdade (Grupo F) — sem tocar a forma do tipo. |
| `approveAuto`'s guarda `evidence.length===0` (Gate-8-loop-back) | **Sim** — hoje é a ÚNICA coisa que impede uma aprovação vazia, porque nada nunca anexava evidência real. | Deixa de ser um workaround estrutural — passa a ser satisfeita por trabalho genuíno (Grupo E/FR-5c). |
| Tratamento de falha do branch mandatório de `runGateApprove` (try/catch) | **Sim**, Gate-8-loop-back já corrigiu esse branch especificamente. | Estende a MESMA disciplina ao novo passo (c) — nenhuma exceção de spawn propaga como crash (Grupo G). |
| `roleRegistry`/`effectivePolicy`/`auditTrailWriter` construídos para uma sessão | **Sim**, mas hoje só a partir de uma sessão-pai (`chat.ts`'s composition root, via `loadRealRoleRegistryAndSkills`/`resolveEffectivePolicy`/`createAuditTrailWriter`). | `runAuto` (processo CLI puro, sem sessão-pai) constrói os MESMOS colaboradores pelas MESMAS funções — nunca uma segunda forma de carregá-los. |

---

## 2. Goals

1. **G1 — A seleção do papel que executa o trabalho substantivo de cada gate é determinística e tabelada,
   nunca um julgamento de modelo sobre a demanda.** Fecha o achado 1 do Gate 1.
2. **G2 — `runAuto` resolve um `Model` concreto por papel/gate reusando o MESMO
   `ModelResolutionPort` já construído para a pré-condição do gate — nunca um segundo runtime de modelo, nunca
   o campo `model` omitido.** Fecha o achado 4 do Gate 1 (GAP-5 estendido a este novo chamador).
3. **G3 — O prompt de delegação nunca interpola texto bruto e não confiável (demand string, diff) como
   instrução ao vivo — e a superfície residual é nomeada explicitamente para o Gate 3, nunca escondida.** Fecha
   o achado 2 do Gate 1 (nomeação, não mitigação completa).
4. **G4 — `runAuto` spawna uma sessão-filha real por gate aplicável via `createGovernedChildSessionSpawner`,
   nunca via a camada de autorização role-a-role de `runTask` (que responde a uma pergunta que não se aplica
   aqui) e nunca via um segundo call site de `createAgentSession`.**
5. **G5 — Evidência de delegação é um 5º `EvidenceRef` kind, genuinamente `runtime-derived` — nunca
   subestimada como `{kind:"file"}`.** Fecha o achado 3 do Gate 1.
6. **G6 — `"context-limit"` (`RunStopReason`) passa a ser produzido de verdade, medindo a janela POR-CHAMADA
   do modelo resolvido — nunca conflado com o orçamento acumulado do RUN (`SharedBudget`).** Fecha o Gate 8
   loop-back §20 da Fase 8.
7. **G7 — Toda falha da delegação (erro do modelo, budget esgotado, uma falha futura de timeout) degrada para
   uma das condições de parada já exaustivas de `runAuto` — nunca um crash, nunca um gate silenciosamente
   pulado.**

---

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta demanda | Onde pertence |
|---|---|---|
| **Paralelismo/múltiplos subagentes por gate** | Non-goal explícito já registrado pela spec-mãe (`gate2-spec-fase8.md` §3, "Paralelismo controlado" — "torná-lo um mecanismo built-in de `conductor auto` é escopo novo, não nomeado"). Esta demanda mantém exatamente **um** papel-líder por gate (Grupo A). | Fase futura não nomeada |
| **Redesenhar `createGovernedChildSessionSpawner`/`runTask`** | Esta demanda é uma CALLER da infraestrutura de delegação, nunca sua reimplementação — mesma disciplina "compõe, nunca reimplementa" que H-Fase8 já aplicou ao `gate *`, estendida aqui à Fase 3. | N/A — reabertura do ADR 0004 se acontecer |
| **Resolver (não só nomear) a superfície de prompt-injection do FR-3b** | O Gate 1 desta demanda já flagou isto explicitamente para o Gate 3 — decidir a mitigação é trabalho de modelagem de ameaças, não de especificação funcional. | Gate 3 desta demanda |
| **Mecanismo de timeout para um turno de subagente** | Confirmado por leitura de `task.ts`: o SDK do Pi não expõe hoje nenhum timeout configurável para `session.prompt(...)`. Inventar um aqui seria um mecanismo novo não pedido por nenhum achado do Gate 1. | Gate 4/6 se/quando um caso real aparecer |
| **Corrigir a assimetria pré-existente entre `test-run` e `journal-entry` no branch runtime-derived de `hasSufficientEvidenceForMandatoryGate`** | Achado NOVO desta sessão (§9), notado ao ler `gate-evidence.ts:209` linha por linha — o código só checa `ref.kind === "test-run"`, nunca `"journal-entry"`, apesar do comentário do arquivo descrever os dois como equivalentes. Corrigir isso é uma mudança ortogonal ao que esta demanda pediu. | Gate 4 desta demanda decide se vale a pena resolver junto |
| **Sub-orçamentos por-subagente / mitigação adicional de DoS intra-run** | Risco já aceito e declarado pelo próprio ADR 0009 (§17.2, R4: "sub-budgets por-subagente = non-goal (T79)") — não redecidido aqui. | Risco aceito, ADR 0009 |
| **Mudar a forma de `RunStopReason`, `GateState`, `GateStatus`, ou `EvidenceRef`'s 4 kinds já existentes** | `RunStopReason` já é um union de 4 membros travado pelo ADR 0009 §16 — esta demanda só passa a produzir o 4º valor que já existia no tipo. `EvidenceRef` ganha um 5º MEMBRO NOVO (aditivo), nunca uma mudança nos 4 já existentes. | N/A — travado |
| **Qualquer número exato** (estimativa de tokens da reserva de delegação, o limiar exato "~90%") | Mesmo padrão já aplicado por todas as fases desta série: comportamento observável é spec, o número é decisão de Gate 4/6. | Gate 4/6 |

---

## 4. Glossário (linguagem ubíqua)

| Termo | Definição | Fonte |
|---|---|---|
| **Papel-líder (lead role)** | O ÚNICO papel que `runAuto` delega para executar o trabalho substantivo de um gate — `BUILTIN_GATE_ROLES[gate][0]`, o primeiro slug da lista, na MESMA ordem que a linha `**Roles:**` daquele gate já lista no `CLAUDE.md`/`templates/flow.md`. Nunca escolhido por conteúdo da demanda, nunca por um modelo. | Grupo A desta spec |
| **Delegação real** | Uma chamada genuína a `createGovernedChildSessionSpawner` que produz um `SpawnChildSessionResult` de verdade (sessão-filha disc-backed, tokens gastos, arquivos tocados) — em oposição ao passo (c) hoje vazio de `runAuto`, cujo comentário já confessa "no reachable call site". | `tools/task.ts`; ADR 0009 §20 |
| **`purpose: "delegation"`** | O valor de `ResolveModelRequest.purpose` (ADR 0008 §16, já travado) reservado para "resolver um Model para um PAPEL, não para abrir um gate diretamente" — existente no tipo desde a Fase 7, sem nenhum caller até esta demanda. | `@conductor/providers/types.ts` |
| **Evidência de delegação (`EvidenceRef{kind:"delegation"}`)** | O 5º kind de `EvidenceRef` (Grupo E) — um `sessionId` cuja resolução exige pertencer a um set (`runtimeRecordedDelegationSessionIds`) que só `runAuto` populou NA MESMA invocação de processo em que ele mesmo observou o spawn acontecer — nunca um `--ref` digitado por um humano ou alegado por um modelo. `provenance` é sempre `"runtime-derived"`, nunca `"author-declared"`. | Grupo E desta spec |
| **Sinal de contexto por-chamada** | O uso de tokens de UMA sessão-filha (`session.getSessionStats().tokens.total`), medido contra `Model.contextWindow` (um campo real do SDK, `pi-ai/types.d.ts:670`) — DISTINTO do orçamento acumulado do RUN inteiro que `SharedBudget` já mede (D6, ADR 0009 §20: "medida fundamentalmente diferente"). Os dois nunca são conflados. | Grupo F desta spec; ADR 0009 §20 |
| **Falha de delegação** | Qualquer rejeição/exceção de `createGovernedChildSessionSpawner` (erro de modelo, credencial, ferramenta negada) OU um `reserve()` que devolve `null` no momento de delegar — em ambos os casos, `runAuto` degrada para uma condição de parada já exaustiva (`needs-human`/`budget-exceeded`), nunca uma exceção não capturada. | Grupo G desta spec |

---

## 5. Requisitos funcionais (FR)

*Grounding para Given/When/Then:* **Specification by Example — Complete Professional Guide §2.12/§2.13**
(mesma base de todas as fases desta série).

### Grupo A — Seleção determinística do papel-líder por gate (G1, resolve achado 1 do Gate 1)

**FR-1 — O papel-líder de um gate é o primeiro slug de `BUILTIN_GATE_ROLES[gate]`, sempre.**
> Given `BUILTIN_GATE_ROLES[gate]` (`builtin-roles-data.ts`) lista N ≥ 1 papéis candidatos, na MESMA ordem que
> a linha `**Roles:**` daquele gate já lista em `CLAUDE.md`/`templates/flow.md` (o próprio cabeçalho do
> arquivo já descreve essa tabela como "a flow's per-gate role table"),
> When `runAuto` precisa de um papel para delegar o trabalho substantivo do gate G,
> Then o papel-líder é `BUILTIN_GATE_ROLES[G][0]` — nenhuma heurística de conteúdo da demanda, nenhuma
> pontuação, nenhuma escolha feita por um modelo. Exemplos concretos: Gate 1 → `product-manager`; Gate 3 →
> `security-engineer`; Gate 6 → `software-engineer`; Gate 9 → `application-security-engineer`.

**FR-1b — Um papel-líder ausente do `RoleRegistryView` real recusa fail-closed, nomeando o papel.**
> Given `BUILTIN_GATE_ROLES[G][0]` nomeia um slug que, por algum motivo de scaffold incompleto do projeto, não
> resolve em `roleRegistry.get(slug)`,
> When `runAuto` tenta obter o papel-líder do gate G,
> Then o run para como `needs-human`, nomeando o gate e o slug ausente — nunca cai silenciosamente para um
> segundo papel candidato da lista, nunca segue sem papel.

### Grupo B — Resolução de `Model` por papel via o `ModelResolutionPort` já existente (G2, resolve achado 4 do Gate 1)

**FR-2 — `runAuto` resolve um `Model` concreto para o papel-líder chamando `purpose:"delegation"` no MESMO
`ModelResolutionPort` já construído para a pré-condição do gate.**
> Given `runAuto` já construiu `modelResolutionPort` (`createGateModelResolutionPort`, o mesmo que
> `runGateStart`'s `evaluateModelPrecondition` já consome internamente com `purpose:"gate-open"`, sem
> `persona`),
> When o gate G abre com sucesso (passo (b) do loop já existente) e o papel-líder é `role` (FR-1),
> Then `runAuto` chama `modelResolutionPort.resolveForGate({gate: G, purpose: "delegation", persona: {name:
> role.slug, modelRole: role.modelRole}})` — o MESMO método `resolveForGate` que `evaluateModelPrecondition`
> já chama, mas invocado DIRETAMENTE (nunca através do wrapper `evaluateModelPrecondition`, que descarta
> deliberadamente o campo `model` da `ModelResolution` ao traduzi-la para `ModelPreconditionVerdict`). O
> resultado, quando `resolved:true`, devolve `model: Model<Api>` — este objeto é o que se torna
> `SpawnChildSessionInput.model`/`CreateTaskToolDependencies.model` (GAP-5, ADR 0004) — nunca um segundo
> mecanismo de seleção de modelo, nunca o campo omitido (o que reabriria o hole de auto-discovery ambiental
> que o GAP-5 original já fechou para o caminho model-driven).
>
> **Nota de achado:** `purpose: "delegation"` já é um literal do union travado (`ResolveModelRequest.purpose`,
> ADR 0008 §16 apêndice) sem NENHUM call site no monorepo hoje (confirmado por grep) — esta FR é o primeiro
> caller real, fechando um gap idêntico em espírito ao N1 do próprio ADR 0009 (um primitivo construído e
> nunca ligado).

**FR-2b — Uma recusa na resolução do papel-líder para para o run graciosamente, na MESMA forma que a
pré-condição de abertura do gate já recusa.**
> Given `resolveForGate({gate, purpose:"delegation", persona})` devolve `{resolved:false, refusal, trace}`,
> When `runAuto` tenta obter o `Model` do papel-líder do gate G,
> Then o run para como `needs-human`, nomeando o gate e a razão da recusa — reusando a MESMA lógica de
> descrição de recusa que a pré-condição do gate já usa (`describeRefusal`-shaped), nunca uma segunda função
> de formatação. **Caso real, não hipotético:** como a pré-condição do gate (`purpose:"gate-open"`, sem
> `persona`) já passou ANTES desta chamada, é estruturalmente possível que ela passe (existe ALGUM modelo
> elegível para o `GateModelRole` do gate) mas a resolução por-persona — que soma o piso via `max(rank(gate),
> rank(persona))` (D1.5, ADR 0008) — recuse, porque o `ModelRole` do papel-líder (ex.: `strategic`) eleva o
> piso combinado acima do que o binding do gate sozinho exigiria. FR-2b garante que este caso também para
> graciosamente, nunca prossegue com um modelo abaixo do piso combinado.

### Grupo C — Construção do prompt de delegação e a superfície de injeção nomeada (G3, resolve achado 2 do Gate 1 — nomeação, não mitigação)

**FR-3 — O prompt de delegação é composto por um template FIXO por gate, mais REFERÊNCIAS — nunca a
concatenação direta de texto não confiável como instrução ao vivo.**
> Given `runAuto` está prestes a delegar o trabalho substantivo do gate G ao papel-líder,
> When o prompt (`SpawnChildSessionInput.prompt`) é montado,
> Then o prompt é: (1) um TEMPLATE fixo por gate, escrito nesta spec/no código, descrevendo o que aquele papel
> deve produzir para aquele gate (ex.: "Execute o Gate 3 (segurança) desta demanda: modele ameaças conforme
> `model-threats`, ..."); mais (2) REFERÊNCIAS neutras — o número/slug da demanda, o caminho da spec no
> repositório, o nome da branch — NUNCA o texto bruto da demand string original nem o conteúdo do diff
> interpolados diretamente na string do prompt como se fossem instruções do operador. O subagente lê a
> demanda/diff pelas MESMAS ferramentas (`read`/`grep`) que qualquer subagente de `/cdt` já usa para ler
> contexto do workspace — nunca por injeção direta no prompt.

**FR-3b — [GAP-C, Gate 3 T81/R62 — resolvido, não mais um residual nomeado sem postura] O prompt de
delegação continua sendo um sink de prompt-injection genuíno mesmo com o template fixo do FR-3, e o
template DEVE delimitar explicitamente dado de instrução como defesa em profundidade.**
> Given a distinção de FR-3 (template fixo vs. referência) já reduz a superfície,
> When o template é escrito (Gate 4/6),
> Then ele inclui delimitação EXPLÍCITA entre a instrução do template (confiável, autoral) e qualquer
> conteúdo que o subagente venha a ler do workspace via suas próprias ferramentas (`read`/`grep`) — o mesmo
> conteúdo pode incluir texto adversarial plantado por um clone hostil, um PR malicioso, ou a própria
> demanda — e o template deve instruir o subagente a tratar esse conteúdo lido como DADO, nunca como
> instrução do operador. Isto NÃO fecha o sink (`SpawnChildSessionInput.prompt` continua um sink de
> confused-deputy real, achado 2 do Gate 1/T81) — é defesa em profundidade; a defesa DECISIVA é o backstop
> herdado da Fase 8 (Gate 3/8/9 incolapsáveis sobre o diff real, nunca aterrissa sem humano) — R62.

### Grupo D — Spawn real via `createGovernedChildSessionSpawner`, nunca via `runTask`, nunca uma reimplementação (G4)

**FR-4 — `runAuto` chama `createGovernedChildSessionSpawner` DIRETAMENTE por gate aplicável — nunca a camada
de autorização role-a-role de `runTask`, nunca um terceiro call site de `createAgentSession`.**
> Given o gate G abriu com sucesso (passo b) e um `Model` foi resolvido para o papel-líder (FR-2),
> When `runAuto` executa o passo (c) do seu próprio loop (ADR 0009 §3.2),
> Then ele constrói `SpawnChildSessionInput` — `role` (FR-1, via `roleRegistry.get`), `prompt` (FR-3), `depth:
> 1`, `workspaceRoot: io.cwd`, `effectivePolicy` (via `resolveEffectivePolicy(io.cwd)`, reusado LITERALMENTE
> de `commands/chat/policy-resolution.ts` — a mesma função que `chat.ts`'s composition root já chama),
> `auditTrailWriter` (via `createAuditTrailWriter(...)`, reusado de `commands/audit-trail.ts`),
> `additionalProtectedPaths: []`, `yesFlagActive: false` (`runAuto` é headless por natureza, D3 camada 1 do
> ADR 0009 — nunca `--yes` implícito), `model` (FR-2), `sessionManager` (uma `SessionManager.create(...)` nova
> disc-backed) — e chama `createGovernedChildSessionSpawner(sharedBudget)(spawnInput)`, a MESMA função
> exportada que `session.ts`'s `createTaskTool` já injeta como colaborador `spawnChildSession`.
>
> **[GAP-D, Gate 3 T82/R63] `model`, `yesFlagActive:false`, `effectivePolicy` e `auditTrailWriter` são
> INVARIANTES DE SEGURANÇA deste FR, não detalhe de fiação que o Gate 4/6 possa deixar cair em silêncio.**
> `runAuto` é o ÚNICO populador de `SpawnChildSessionInput` (o bypass de `runTask` do FR-4 transfere essa
> responsabilidade inteira pra ele) — omitir `model` reabre a auto-descoberta ambiental de credencial
> (GAP-5 da Fase 3: `findInitialModel` do Pi cai pro "primeiro modelo com API key no ambiente", egress não
> consentido); `yesFlagActive:true` por engano faria o filho auto-aprovar tools destrutivos; um
> `effectivePolicy`/`auditTrailWriter` permissivo faria o gate do filho deixar de negar/auditar. Nenhum dos
> 4 campos tem valor default seguro por omissão — a implementação (Gate 6) deve tornar os 4 obrigatórios no
> tipo (nunca opcionais com fallback silencioso), e o Gate 8 deve verificar cada um explicitamente contra o
> código real, não só contra os testes.
>
> `runAuto` **NÃO** chama `runTask`: a autorização `canSpawn(callerRole, targetRole)`/o cap de profundidade que
> `runTask` impõe respondem à pergunta "um MODELO pode escolher delegar para este alvo?" — uma pergunta que
> não se aplica aqui, porque o alvo já é determinístico e tabelado (FR-1), nunca a escolha de um modelo sobre
> input hostil. `runAuto` **NÃO** chama `createAgentSession` diretamente — preserva o invariante de "sole
> constructor" que `task-sole-constructor.test.ts` já trava por scan estático (chamar uma função JÁ EXPORTADA
> como `createGovernedChildSessionSpawner` não introduz um terceiro call site literal de `createAgentSession(`
> — o scan continua vendo exatamente dois: `session.ts` e `tools/task.ts`).

**FR-4b — A reserva/liquidação de orçamento em torno do spawn segue a MESMA disciplina síncrona
reserve-antes/settle-depois que `runTask` já usa — inline em `commands/auto.ts`, nunca uma segunda
implementação de `SharedBudget`.**
> Given `runAuto` está prestes a chamar o spawner para o gate G,
> When a chamada acontece,
> Then `sharedBudget.reserve(<estimativa>)` é chamado ANTES do spawn; `null` recusa graciosamente (FR-7b)
> SEM spawnar; após o spawn concluir (sucesso OU falha), `sharedBudget.settle(reservation, tokenUsage)` é
> chamado exatamente uma vez — o valor exato da estimativa é uma decisão de Gate 4/6 (mesmo padrão já aplicado
> por toda esta série: números são default declarados, nunca fechados em spec).

### Grupo E — Evidência de delegação: um 5º `EvidenceRef` kind, genuinamente runtime-derived (G5, resolve achado 3 do Gate 1)

**FR-5 — `EvidenceRef` ganha um 5º kind, `"delegation"`, declarado no ÚNICO lugar onde `EvidenceRef` já é
declarado (`gate-evidence.ts`) — nunca reusando `{kind:"file"}`.**
> Given uma delegação real completou (FR-4) e devolveu um `SpawnChildSessionResult`/`DelegationEvidence`-shaped
> (`{transcript:{sessionId,filePath}, role, depth, tokenCost, filesTouched, budgetRemaining}` — a MESMA forma
> que `tools/task.ts` já define),
> When `runAuto` anexa evidência ao gate via `runGateEvidence` (reusado LITERALMENTE de `commands/gate.ts`,
> nunca uma segunda função de anexação),
> Then o `ref` anexado é `{kind:"delegation", sessionId: <transcript.sessionId>, role: <role>}` — um MEMBRO
> NOVO do union `EvidenceRef`, nunca `{kind:"file", path: transcript.filePath}`.
>
> **Por quê (decisão flagada, achado 3 do Gate 1):** o branch `"file"` de `resolveEvidenceRef` só prova
> "existe e está dentro do workspace" (`provenance: "author-declared"`) — exatamente a classe fraca que
> `hasSufficientEvidenceForMandatoryGate` já EXCLUI deliberadamente de sozinha fechar um gate obrigatório
> ("Any number of author-declared file-only items, alone, still never closes a mandatory gate"). Uma
> transcrição de sessão-filha disc-backed, cujo `sessionId`/`filePath`/`tokenCost`/`filesTouched` vêm do
> RUNTIME (nunca de uma alegação do chamador — a mesma garantia que `DelegationEvidence`'s próprio cabeçalho
> já documenta: "derived from the RUNTIME... never the child model's own prose") é exatamente a mesma classe
> de força que `test-run`/`journal-entry` já têm. Mapear para `file` subestimaria essa força; um kind novo é o
> único jeito honesto de representá-la.

**FR-5a — `resolveEvidenceRef`'s novo caso `"delegation"` segue o MESMO padrão de `test-run`/`journal-entry`:
um set que só o observador real popula.**
> Given `ResolveEvidenceRefContext` ganha um novo campo `runtimeRecordedDelegationSessionIds: ReadonlySet<string>`,
> When `resolveEvidenceRef` recebe um ref `{kind:"delegation", sessionId, role}`,
> Then ele resolve `ok:true, provenance:"runtime-derived"` SOMENTE se `ctx.runtimeRecordedDelegationSessionIds.has(sessionId)`
> — MESMO padrão que os dois casos já existentes (`test-run`/`journal-entry`). `runAuto`'s próprio
> `evidenceContext` (construído localmente por `runAuto`, na MESMA forma que `cli.ts:452` já constrói o seu
> para `gate evidence` manual) popula esse set com os `sessionId`s que ELE MESMO observou de
> `createGovernedChildSessionSpawner` NESTA MESMA invocação de processo — nunca um `--ref` digitado por um
> humano ou alegado por um modelo (edge case 7, §7).
>
> **[GAP-A, Gate 3 T83/R64 — a clarificação mais importante do loop-back] Em `--continue`, evidência de
> delegação de gates ANTERIORES nunca é reconstruída por disco.** `runtimeRecordedDelegationSessionIds` é
> populado SOMENTE pelo que a invocação de processo ATUAL observou de `createGovernedChildSessionSpawner` —
> um `--continue` que retoma um run interrompido NÃO varre `.conductor-agent/sessions/tasks/` (ou qualquer
> outro diretório disc-backed) pra "recuperar" `sessionId`s de spawns de uma invocação anterior, mesmo que
> pareça conveniente. Esse diretório é gravável por um clone hostil ANTES do resume — proibir a
> reconstrução fecha esse vetor por construção, não por disciplina de código lembrada depois. O `GateState`
> persistido continua o registro autoritativo do que já foi APROVADO; gates cuja evidência de delegação não
> sobreviveu ao fim do processo original simplesmente REFAZEM a delegação ao serem re-abertos (mesmo padrão
> "retomar refaz o que não foi persistido pela via correta" do resto do FR-7/ADR 0009 §4).

**FR-5b — `hasSufficientEvidenceForMandatoryGate` passa a reconhecer `ref.kind === "delegation"` no branch
runtime-derived — sem tocar o branch `git-commit` já existente (Gate-8-loop-back da Fase 8).**
> Given a implementação atual (`gate-evidence.ts:209`) checa literalmente `item.ref.kind === "test-run"`
> (uma assimetria pré-existente com `"journal-entry"`, notada mas fora do escopo desta demanda — §9),
> When um gate obrigatório recebe uma evidência `{kind:"delegation", ...}` com `provenance:"runtime-derived"`,
> Then o check passa a `item.ref.kind === "test-run" || item.ref.kind === "delegation"` — o MESMO padrão de
> extensão pontual que o Gate-8-loop-back já aplicou ao adicionar `git-commit` como fallback separado, nunca
> uma reescrita da função inteira.
>
> **[GAP-B, Gate 3 T83/R64] Em voz alta, não só implícito: `{kind:"delegation"}` satisfaz o PRÉ-REQUISITO de
> evidência, NUNCA a aprovação em si.** O invariante que `auto.ts:678-699` já garante (herdado da Fase 8,
> intocado por esta demanda) continua valendo sem exceção: um gate MANDATÓRIO permanece `needs-human` quando
> headless, independentemente de quanta evidência de delegação genuína esteja anexada — nenhuma fiação desta
> demanda pode ligar "evidência suficiente" a "aprovação automática" para `{3,5,7,8,9}`. `{kind:"delegation"}`
> só afeta se `hasSufficientEvidenceForMandatoryGate` retorna `true` (a PRÉ-CONDIÇÃO pra `approve()` tentar
> mintar); o MINT em si continua exigindo `confirmResult===true ∧ isInteractive()===true` (D3, ADR 0009) ou
> `approveAuto`/N1 pro ramo não-mandatório.

**FR-5c — Gates não-mandatórios recebem a MESMA evidência genuína — fechando o workaround do Gate-8-loop-back
(hollow-completion).**
> Given `approveAuto` (N1, ADR 0009) hoje recusa aprovar um gate não-mandatório com `evidence.length === 0` —
> atualmente a ÚNICA coisa que impede uma aprovação vazia, porque o passo (c) nunca existiu,
> When esta demanda liga o passo (c) (FR-4) e anexa evidência real (FR-5) para TODO gate aplicável, mandatório
> ou não,
> Then a guarda de evidência vazia de `approveAuto` passa a ser satisfeita por trabalho GENUÍNO — o
> comportamento OBSERVÁVEL de `evidence.length > 0` não muda (nenhuma mudança em `gate-store.ts`), mas o
> CONTEÚDO da evidência anexada deixa de ser um workaround estrutural e passa a ser a delegação real.

### Grupo F — `"context-limit"` torna-se alcançável, medindo a janela por-chamada (G6, fecha ADR 0009 §20)

**FR-6 — O sinal de contexto que `runAuto` compara contra ~90% vem da janela do modelo resolvido POR-CHAMADA,
nunca do orçamento acumulado do `SharedBudget`.**
> Given `createGovernedChildSessionSpawner` já chama `session.getSessionStats()` (`task.ts:616`) para computar
> `tokenUsage` (`{input, output, total}`) do turno da sessão-filha, e `Model<Api>` já expõe
> `contextWindow: number` (`pi-ai/dist/types.d.ts:670`, campo real, confirmado por leitura do SDK),
> When `runAuto` recebe o `SpawnChildSessionResult` de volta após delegar o gate G,
> Then ele compara `tokenUsage.total` contra `~90% × model.contextWindow` (o `Model` resolvido em FR-2 para
> aquele papel/gate) — NUNCA contra `sharedBudget.remaining()` (que mede um teto DIFERENTE, acumulado por todo
> o RUN, exatamente a confusão que o ADR 0009 §20 já nomeou e rejeitou: "um número que parece plausível mas
> mede a coisa errada"). Se o limiar é cruzado NA FRONTEIRA do gate corrente — depois que ele termina, nunca
> no meio (FR-13/edge-7 do ADR 0009, herdados sem mudança) — `RunStopReason: "context-limit"` é produzido pela
> primeira vez, fechando o Gate 8 loop-back §20 sem reabrir nenhuma decisão D1-D8 daquele ADR.

### Grupo G — Toda falha de delegação degrada para a máquina de parada graciosa já existente (G7)

**FR-7 — Uma sessão-filha que lança/rejeita durante o spawn nunca propaga como crash do processo `conductor
auto` — degrada para `needs-human`, na MESMA forma que uma recusa de `runGateStart`/`runGateApprove` já
degrada.**
> Given `createGovernedChildSessionSpawner(spawnInput)` rejeita (erro de credencial do provedor resolvido em
> FR-2, erro de rede, um `write`/`edit` negado pelo permission-gate que borbulha como exceção),
> When `runAuto`'s passo (c) captura o erro,
> Then o run escreve o checkpoint, registra `needs-human` (reusando `stopRun`, já existente em `auto.ts`),
> NUNCA deixa a exceção subir ao chamador de `runAuto` como crash não tratado — a MESMA disciplina try/catch
> que o Gate-8-loop-back já aplicou ao branch mandatório de `runGateApprove` (achado daquele loop-back: "esta
> branch não tinha try/catch nenhum, ao contrário da irmã não-mandatória").

**FR-7b — Um budget esgotado NO MOMENTO da delegação converte para `budget-exceeded`, nunca `needs-human` —
um segundo ponto de checagem, distinto do já existente no topo do loop.**
> Given `sharedBudget.reserve(<estimativa>)` (FR-4b) devolve `null` no momento de delegar o gate G,
> When isso acontece,
> Then o run para com `RunStopReason: "budget-exceeded"` (D6, ADR 0009, herdado sem mudança) — mesmo que o
> gate já tivesse passado seu check-antes-do-gate genérico (`budget.reserve(4_000)` no topo do `for` existente
> em `auto.ts`); a delegação real pode custar mais do que essa reserva grosseira, então este é um SEGUNDO
> ponto de checagem, não redundante com o primeiro.

**FR-7c — Um timeout de turno de subagente (se/quando um mecanismo existir) degrada pela MESMA rota do FR-7 —
nunca uma quinta condição de parada.**
> Given o SDK do Pi não expõe hoje nenhum timeout configurável para `session.prompt(...)` dentro de
> `createGovernedChildSessionSpawner` (confirmado por leitura de `task.ts`),
> When um turno de subagente nunca retorna,
> Then esta spec NÃO inventa um mecanismo de timeout novo (non-goal, §3) — mas registra, para quando uma fase
> futura adicionar um, que ele deve degradar pela MESMA rota de FR-7 (`needs-human`), nunca uma quinta
> categoria de `RunStopReason`.

---

## 6. Business rules

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | A seleção do papel-líder é 100% determinística e tabelada (`BUILTIN_GATE_ROLES[gate][0]`) — nunca um julgamento de modelo, nunca dependente do conteúdo da demanda. Mesma disciplina reject-only/fail-closed que D4 (ADR 0009) já aplicou à classificação de risco, estendida aqui à seleção de papel. | Achado 1 do Gate 1; ADR 0009 D4 (herdado) | FR-1, FR-1b |
| **BR-2** | O `Model` de um papel nunca é omitido na construção de `SpawnChildSessionInput` — reafirma GAP-5 (ADR 0004) para este NOVO caller, nunca reabre o hole de auto-discovery ambiental que o GAP-5 original fechou para o caminho model-driven. | `tools/task.ts` (GAP-5, herdado) | FR-2, FR-2b |
| **BR-3** | O prompt de delegação nunca interpola texto bruto de demand-string/diff como instrução — apenas um template fixo + referências neutras (FR-3). Isto LIMITA a superfície de injeção; não a FECHA — permanece nomeada para o Gate 3 (FR-3b), nunca escondida como resolvida. | Achado 2 do Gate 1; Prompt Engineering PPP §9.2 (§8) | FR-3, FR-3b |
| **BR-4** | `runAuto` nunca chama `createAgentSession` diretamente, nunca reimplementa a autorização role-a-role de `runTask`, e nunca constrói uma segunda `SharedBudget` — compõe exclusivamente sobre `createGovernedChildSessionSpawner`/`SharedBudget` já injetados. | ADR 0004 §2 (sole constructor); ADR 0009 §1.3 item 5 (herdado) | FR-4, FR-4b |
| **BR-5** | Evidência de delegação é sempre `runtime-derived` (kind `"delegation"`), nunca `author-declared` — o set que a autoriza (`runtimeRecordedDelegationSessionIds`) só é populado por `runAuto`, na MESMA invocação de processo em que ele mesmo observou o spawn concluir. | `gate-evidence.ts` (golden rule, herdado); Achado 3 do Gate 1 | FR-5, FR-5a, FR-5b |
| **BR-6** | `"context-limit"` mede a janela POR-CHAMADA do modelo resolvido (`Model.contextWindow`), nunca o orçamento acumulado do RUN (`SharedBudget`) — os dois nunca são conflados, mesma distinção que o ADR 0009 §20 já nomeou explicitamente ao rejeitar uma proxy via `SharedBudget`. | ADR 0009 §20 (herdado); Context Engineering §3.6/§13.7 (§8) | FR-6 |
| **BR-7** | Nenhuma falha de delegação (erro de spawn, budget esgotado no meio, um timeout futuro) propaga como exceção não capturada — toda falha degrada para uma das condições de parada já exaustivas de `RunStopReason` (`needs-human`/`budget-exceeded`), nunca uma quinta. | ADR 0009 D6/BR-9 (herdado); Gate-8-loop-back (precedente de try/catch) | FR-7, FR-7b, FR-7c |
| **BR-8** | Gates não-mandatórios não são mais auto-aprovados com evidência vazia ou placeholder — a guarda `evidence.length===0` de `approveAuto` (Gate-8-loop-back) passa a ser satisfeita só por trabalho real, nunca por um artefato fabricado só para passar a guarda. | Achado "hollow-completion" do Gate-8-loop-back (herdado) | FR-5c |

---

## 7. Edge cases

1. **Um gate cujo `BUILTIN_GATE_ROLES[gate]` tenha exatamente 1 candidato.** A regra ainda vale trivialmente
   (primeiro = único) — nenhum gate hoje tem 1 (todos têm ≥ 3), mas a regra não depende disso (FR-1).
2. **O papel-líder resolvido (FR-1) não existe no `roleRegistry` real** por um scaffold de projeto incompleto.
   Recusa fail-closed nomeando o papel — nunca cai silenciosamente para um segundo candidato da lista (FR-1b).
3. **A pré-condição de abertura do gate (`purpose:"gate-open"`) passa, mas a resolução por-persona
   (`purpose:"delegation"`) recusa** porque o piso do `ModelRole` do papel-líder é maior que o do gate sozinho.
   O `GateState` já foi mutado (o gate abriu) — o run para como `needs-human` SEM desfazer a abertura do gate;
   `GateState` nunca é revertido retroativamente (FR-2b).
4. **A sessão-filha spawna com sucesso mas `filesTouched: []`, para um papel cujo `roleCanChangeFiles` é
   `true`** (ex.: `software-engineer` no Gate 6). A MESMA regra FR-19 de `tools/task.ts` já cobre isso
   (`isError: true`) — `runAuto` trata esse `isError` exatamente como qualquer outra falha de delegação
   (FR-7), nunca como sucesso silencioso.
5. **Dois gates mandatórios consecutivos no mesmo run** (ex.: Gates 7→8→9, todos em `{3,5,7,8,9}`). Cada
   delegação usa seu PRÓPRIO papel-líder e seu PRÓPRIO `Model` resolvido — FR-1/FR-2 são recalculados por
   gate, nunca reusados de um gate anterior via cache.
6. **`SharedBudget` esgota EXATAMENTE durante a chamada de delegação do último gate aplicável** — `runAuto`
   trata isso como `budget-exceeded` (FR-7b), mesmo que só reste o passo final de `landOnDevelop`; o run não
   aterrissa em `develop` com o último gate incompleto.
7. **Um `sessionId` só entra em `runtimeRecordedDelegationSessionIds` DEPOIS que o spawn correspondente
   completou com sucesso.** Uma chamada que rejeitou (FR-7) nunca contribui um `sessionId` ao set — não há
   "evidência" de uma delegação que falhou, mesmo que uma sessão-filha parcial tenha sido criada em disco
   antes da rejeição.

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas via `cdt library "<pergunta>" --gate 2` a partir de `C:\development\source\projects\conductor`
(backend saudável). **Cobertura honesta:** uma citação forte, reconfirmando um achado já registrado no Gate 1
desta demanda com um hit mais alto nesta rodada; um cluster moderado bom para a distinção contexto-por-chamada
vs. orçamento-do-run; duas consultas desta sessão voltaram fracas/fora do alvo — reportadas como tais, apoiadas
em vez disso no precedente de código já estabelecido neste monorepo.

1. **Prompt injection como o "confused deputy" da janela de contexto — texto de dado vira instrução sem canal
   que distinga origem** → **Prompt Engineering — Principles, Patterns and Practice §9.2 "Prompt Injection: The
   Confused Deputy in the Context Window"** (top **0.706** nesta sessão — mais forte que o hit de 0.669 já
   registrado pelo Gate 1 para o mesmo achado) + **Context Engineering — Designing Information Environments
   for LLM Systems §9.6 "Prompt Injection as a Context-Design Problem"** (0.659). Base direta de G3/BR-3/
   FR-3/FR-3b — confirma e reforça, com uma consulta fresca do Gate 2, o mesmo achado que o Gate 1 já havia
   trazido com cobertura mais fraca.
2. **Um limite por-chamada e um orçamento acumulado ao longo de um pipeline multi-estágio medem coisas
   diferentes — um contrato de tamanho por estágio, não um teto global confundido com ele** → **Context
   Engineering — Designing Information Environments for LLM Systems §3.6 "Budget Contracts Between Pipeline
   Stages"** (0.611) e **§13.7 "Context Budget Contracts"** (0.613/0.608). Base direta de G6/BR-6/FR-6 — a
   distinção "janela por-chamada" vs. "orçamento do run inteiro" que o ADR 0009 §20 já havia nomeado em prosa
   ganha aqui uma citação fresca e diretamente no alvo.
3. **Falha de um estágio de um pipeline multi-estágio degrada de forma nomeada e previsível, nunca propaga
   como crash silencioso** → **Prompt Engineering PPP §8.6 "Orchestration Hygiene"** (0.603: "schema at every
   seam; validate in code; name the stage in every error") + **Security Engineering Principles §2.2 "secure by
   default and failing safely"** (0.610, herdado/reconfirmado) + **Stability Patterns for Production §3.12
   "When not to partition resources into bulkheads"** (0.602, moderado — informa por que um sub-budget por-
   subagente continua non-goal, R4 do ADR 0009, sem reabrir essa decisão). Base de G7/BR-7/Grupo G.
4. **Declarado FRACO/fora do alvo, não forçado (1): seleção determinística de um "primeiro/líder" entre
   candidatos já ordenados por uma fonte existente.** Melhor resultado desta rodada: **Architecture Styles and
   Trade-offs §3.5/§3.12** (top 0.591 — sobre ranquear atributos de qualidade, não sobre seleção de papel).
   Fundamentado, em vez disso, no precedente de CÓDIGO deste monorepo: `builtin-roles-data.ts`'s próprio
   cabeçalho já declara que `BUILTIN_GATE_ROLES` espelha "a flow's per-gate role table (`templates/flow.md`'s
   own `**Roles:**` line)" — a ordem já É a decisão de ranqueamento feita alhures (a prosa do flow doc), FR-1
   só a torna machine-consultable, não inventa uma nova.
5. **Declarado FRACO/fora do alvo, não forçado (2): reusar uma porta de resolução existente para um segundo
   propósito, em vez de uma segunda porta.** Melhor resultado desta rodada: **RESTful API Design §1.7/§2.12**
   (top 0.577 — sobre semântica de métodos HTTP, não sobre reuso de portas de resolução). Fundamentado no
   grounding JÁ REGISTRADO pelo ADR 0009 §1.3 item 5/§19.3 (Object-Oriented Design Patterns §1.12 "When not to
   reach for a pattern"; Object-Oriented Thinking §2.12 "When not to hide behind an interface", ambos 0.550) —
   herdado, não redecidido: a mesma razão de não construir um segundo mutador aplica-se a não construir uma
   segunda porta de resolução de modelo.
6. **Given/When/Then, exemplos concretos** → **Specification by Example — Complete Professional Guide
   §2.12/§2.13** (mesma base de todas as fases desta série).
7. **Herdadas do Gate 1 desta demanda, não re-consultadas nesta rodada** (a decisão de grounding já está no
   registro daquele gate): **Distributed Architecture Decisions §3.4** (0.58, regra determinística > julgamento
   pra seleção — base adicional de BR-1); **Specification by Example §3.3 + Prompt Engineering PPP §5.6**
   (0.55-0.62, "evidência exige execução real, raciocínio declarado do modelo não é transcript de computação"
   — base adicional de G5/BR-5, reforçando por que `{kind:"delegation"}` exige o set `runtimeRecordedDelegationSessionIds`
   populado pelo observador real, nunca uma alegação).

---

## 9. Questões abertas para o Gate 3 e Gate 4

1. **Mitigação da superfície de prompt-injection nomeada em FR-3b.** Esta spec limita (template fixo) mas não
   fecha — o Gate 3 precisa decidir se algum sandboxing/marcação adicional do conteúdo lido pelo subagente
   (ex.: delimitadores explícitos "isto é dado, não instrução" no template) é necessário, ou se o modelo de
   confiança já existente (mesmo processo confiado, sem sandbox — T17/R1 herdado) já cobre isso pela mesma
   razão que já cobre o resto do monorepo.
2. **A assimetria pré-existente entre `test-run` e `journal-entry` em `hasSufficientEvidenceForMandatoryGate`**
   (`gate-evidence.ts:209` só checa `ref.kind === "test-run"`, nunca `"journal-entry"`, apesar do comentário do
   arquivo tratá-los como equivalentes). Achado NOVO desta sessão de Gate 2, notado ao ler o código
   linha-a-linha para decidir FR-5b — não é desta demanda para resolver, mas o Gate 4 deve decidir se vale a
   pena corrigir junto (mesmo arquivo, mesma função) ou registrar como follow-up separado.
3. **O valor exato da estimativa de tokens reservada antes de cada delegação (FR-4b)** e **o valor exato do
   limiar "~90%" (FR-6)** — comportamento observável definido, números são Gate 4/6, mesmo padrão já aplicado
   por toda a série a cooldown/backoff/TTL/budget.
4. **Se/quando um mecanismo de timeout de turno de subagente for necessário** (FR-7c), qual o valor default e
   se ele deve ser configurável por `GateModelRole` (gates `slow` talvez precisem de mais tempo que `smol`) —
   não avaliado por esta spec, non-goal explícito (§3).
5. **Se a extensão de `EvidenceRef`/`ResolveEvidenceRefContext` (Grupo E) deve vir acompanhada de uma
   atualização do `resolveEvidenceRef`'s doc comment que hoje descreve "exatamente 4 kinds"** — mudança
   textual, não funcional, mas o Gate 4/6 deve garantir que a documentação do arquivo não fique desatualizada
   quando o 5º kind for adicionado.

---

## Registro no diário

`cdt journal add --gate 2 --kind decision` a partir de `C:\development\source\projects\conductor`, ao final
desta sessão, registrando:

1. **Gate 2 fechado** — 7 grupos de FR (A-G, ~14 itens incluindo sub-FRs), 8 business rules, 7 edge cases, 5
   questões abertas para os Gates 3/4. Os 4 achados que o Gate 1 devolveu explicitamente para este gate foram
   TODOS resolvidos como decisão de spec: (1) papel-líder = primeiro slug de `BUILTIN_GATE_ROLES[gate]`,
   determinístico, tabelado — nunca julgamento de modelo; (2) prompt de delegação é template fixo +
   referências, nunca concatenação de texto bruto — mas a superfície residual continua nomeada, não fechada,
   para o Gate 3 (FR-3b); (3) evidência de delegação é um 5º `EvidenceRef` kind (`"delegation"`), genuinamente
   `runtime-derived` — nunca subestimada como `{kind:"file"}`, mesmo padrão de extensão que o Gate-8-loop-back
   da Fase 8 já aplicou a `git-commit`; (4) `runAuto` resolve `Model` por papel/gate chamando
   `purpose:"delegation"` DIRETAMENTE no mesmo `ModelResolutionPort` já construído para a pré-condição do gate
   — um literal do contrato ADR 0008 §16 que já existia sem nenhum caller, agora ligado.
2. **`runAuto` spawna via `createGovernedChildSessionSpawner` diretamente — nunca via `runTask`'s autorização
   role-a-role, nunca um terceiro `createAgentSession`.** Decisão de design central desta spec (Grupo D):
   `runTask`'s `canSpawn`/depth-cap respondem a "um modelo pode escolher delegar para este alvo?" — pergunta
   que não se aplica a um chamador determinístico e tabelado.
3. **`"context-limit"` (`RunStopReason`) torna-se produzível de verdade** (Grupo F, fecha ADR 0009 §20) —
   medindo `session.getSessionStats().tokens.total` contra `Model.contextWindow` (campo real do SDK), nunca
   conflado com o orçamento acumulado do `SharedBudget`.
4. **2 achados novos desta sessão de Gate 2, não antecipados pelo Gate 1** — registrar como questões abertas,
   não decisões: (a) a assimetria pré-existente `test-run`/`journal-entry` em
   `hasSufficientEvidenceForMandatoryGate`, notada ao decidir FR-5b mas fora do escopo desta demanda; (b) o
   caso real (não hipotético) em que a pré-condição de abertura do gate passa mas a resolução por-persona
   recusa, por causa do piso `max(rank(gate), rank(persona))` do ADR 0008 D1.5 (FR-2b/edge 3).
5. **Grounding desta sessão**: 1 citação forte reconfirmada (0.706, Prompt Engineering PPP §9.2, prompt
   injection); 1 cluster moderado bom e diretamente no alvo (0.60-0.61, Context Engineering §3.6/§13.7,
   distinção contexto-por-chamada vs. orçamento-do-run); 1 cluster moderado para falha graciosa (0.60-0.61,
   Orchestration Hygiene + Security Engineering + Stability Patterns); 2 lacunas honestamente declaradas
   (seleção determinística de líder, e reuso de porta de resolução — ambas ~0.55-0.59, fora do alvo nesta
   rodada específica), apoiadas em vez disso no precedente de código já estabelecido neste monorepo e no
   grounding já registrado pelos ADRs 0004/0008/0009.
