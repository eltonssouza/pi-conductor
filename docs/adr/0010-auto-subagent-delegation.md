# ADR 0010 — Wiring de delegação real de subagentes em `runAuto`: o passo (c) vira uma função interna `runGateDelegation` que **compõe** `createGovernedChildSessionSpawner` (nunca `runTask`, nunca um terceiro `createAgentSession`), resolve o `Model` do papel-líder **direto** por `purpose:"delegation"`, constrói `SpawnChildSessionInput` por um **builder de campos obrigatórios** que torna os 4 invariantes de segurança impossíveis de omitir *ou* afrouxar, anexa um **5º `EvidenceRef` kind** `"delegation"` genuinamente *runtime-derived* de um set **só-in-process**, produz **pela primeira vez** o `"context-limit"` medindo a janela **por-chamada** do modelo resolvido (fecha o §20 do ADR 0009), e **degrada toda falha** pela máquina de parada graciosa já existente — com o achado central de que, enquanto o **GAP-2 da Fase 3** (tetos de tools por-papel) estiver aberto, o papel-líder resolve com `tools:[]`, então a delegação **recusa fail-closed** em vez de gravar um monólogo sem ferramentas como evidência

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-08
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `feature/auto-subagent-delegation` (de `develop`) — follow-up disclosed pela própria Fase 8
  (ADR 0009 §20 "Loop-back do Gate 8"): ligar o passo (c) hoje vazio de `runAuto`
  (`packages/conductor-cli/src/commands/auto.ts:658-659`) à infraestrutura de delegação real que a Fase 3
  já construiu e testou (`packages/conductor-runtime/src/tools/task.ts`)
- **Autor (papel):** `software-architect`
- **Decisores:** usuário (sign-off do Gate 4)
- **Numeração das decisões:** este ADR **começa fresco em D1** (não continua D1-D8 do ADR 0009). Cada ADR
  desta série é dono do seu próprio espaço de decisões; o ADR 0009 também começou em D1. Onde este ADR
  precisa citar uma decisão do 0009, usa o prefixo explícito "ADR 0009 D<n>".
- **Supersessão:** ADRs são imutáveis; mudanças criam um sucessor, não editam este. **Este ADR NÃO
  supersede nenhum anterior.** Ele **estende e fecha** o gap disclosed no **ADR 0009 §20** (o `"context-limit"`
  estruturalmente inatingível) e materializa o passo (c) que o ADR 0009 §3.2 tratou como uma seta abstrata —
  sem reabrir nenhuma decisão D1-D8 do ADR 0009. Da Fase 3 (ADR 0004) `createGovernedChildSessionSpawner`/
  `SpawnChildSessionInput`/`SharedBudget` permanecem **intocados** — esta demanda é uma nova **chamadora**,
  nunca uma reimplementação. Da Fase 4 (ADR 0005) `EvidenceRef` ganha um **5º membro aditivo**; os 4 já
  existentes ficam literais. Da Fase 7 (ADR 0008) `resolveModelForGate`/`ModelResolutionPort`/`ResolveModelRequest`
  são reusados sem segunda lógica — `purpose:"delegation"` já era um literal do union travado, ganha aqui seu
  primeiro caller.

- **Hipótese sob teste (H-Fase8, herdada e estendida a esta demanda):** *`conductor auto` é um orquestrador
  **fino** que só chama a superfície já existente — nunca uma segunda camada de decisão paralela.* **Falsificador
  explícito estendido:** se esta demanda precisar de um **segundo call site literal de `createAgentSession(`**,
  de uma **segunda `SharedBudget`**, ou de uma **segunda lógica de autorização role-a-role**, a hipótese cai e a
  demanda reabre o ADR 0004/0009. **Este ADR RATIFICA H-Fase8** — §2 mostra que cada peça nova é uma composição
  sobre um primitivo já exportado, e §11 confirma que nenhuma superfície de confiança nova é aberta.

- **Insumo vinculante (lido verbatim nesta sessão, não presumido):**
  - **`docs/conductor/gate2-spec-auto-subagent-delegation.md`** (versão corrente em disco, emendada pós-Gate 3
    com FR-3b/GAP-C, FR-4/GAP-D, FR-5a/GAP-A, FR-5b/GAP-B) — 7 grupos de FR (A-G), 8 BR, 7 edge cases, 5 questões
    abertas para os Gates 3/4.
  - **`docs/conductor/gate3-addendum-auto-subagent-delegation.md`** (T81-T85 / **R62-R66** / secure-defaults
    73-78) — **é o insumo de segurança vinculante**; este ADR **materializa R62-R66 em TypeScript, nunca as viola**
    (§10 reconcilia ponto a ponto).
  - **ADR 0009 §3.2** (o loop, com o passo (c) vazio), **§16** (o apêndice de contratos), **§20** (o gap do
    `"context-limit"` que esta demanda fecha).
  - **`packages/conductor-cli/src/commands/auto.ts`** (integral) — `runAuto`, o `for` por-gate (629-712), o
    comentário vazio `// (c)` em 658-659, `stopRun`/`RunStopReason`/`EXIT_*`, o `budget.reserve(4_000)` do topo
    do loop (631).
  - **`packages/conductor-runtime/src/tools/task.ts`** (integral) — `SpawnChildSessionInput` (os campos
    NÃO-opcionais `model`/`yesFlagActive`/`effectivePolicy`/`auditTrailWriter`, GAP-5), `SpawnChildSessionResult`
    (`{sessionId, sessionFilePath, tokenUsage, filesTouched}`), `createGovernedChildSessionSpawner`, `runTask`
    (a autorização role-a-role que esta demanda **bypassa** por design), `DEFAULT_TASK_TOKEN_ESTIMATE`, o
    `task-sole-constructor.test.ts` (o scan estático que trava os dois únicos call sites de `createAgentSession(`).
  - **`packages/conductor-cli/src/commands/chat/policy-resolution.ts`** (`resolveEffectivePolicy`) e
    **`packages/conductor-runtime/src/audit-trail.ts`** (`createAuditTrailWriter`) — os colaboradores reusados
    (FR-4), com a nota de que `audit-trail.ts` vive em `@conductor/runtime`, não em `commands/`.
  - **`packages/conductor-runtime/src/gate-evidence.ts`** (integral) — `EvidenceRef`/`EvidenceProvenance`/
    `ResolveEvidenceRefContext`/`resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate` (o "golden rule",
    a assimetria `test-run`-só na linha 209).
  - **`packages/conductor-runtime/src/model-precondition.ts`** — `ModelResolutionPort.resolveForGate` devolve
    `ModelResolution` inteiro (com `.model`), mas `evaluateModelPrecondition` **descarta** `.model` (só guarda
    `ref.provider`/`modelId`); `describeRefusal` é **privado** (o achado de fiação de D3).
  - **`packages/conductor-cli/src/commands/model-context.ts`** (`createGateModelResolutionPort`) e
    **`packages/conductor-providers/src/types.ts`** (`ResolveModelRequest{gate,persona?,activeProvider?,purpose}`,
    `ModelResolution{resolved:true; model:Model<Api>; ...}`).
  - **`packages/conductor-config/src/builtin-roles-data.ts`** (`BUILTIN_GATE_ROLES`, `MANDATORY_GATES`) e
    **`packages/conductor-cli/src/commands/chat/role-resolution.ts`** (`toTaskRoleRegistryView` — a prova de que
    **todo papel real hoje resolve com `tools:[]`**, GAP-2 da Fase 3, e de que `chat.ts` **recusa** uma sessão
    de tools-vazias) e **`cli.ts:452`** (o `evidenceContext` que `runAuto` replica com o 5º campo).

---

## 1. Contexto

### 1.1 O fato dominante herdado, e a torção desta demanda

O fato dominante das Fases 0-9 continua: **um único processo de SO, sem sandbox, com o privilégio do usuário;
toda garantia é política dentro de um processo confiado.** O ADR 0009 endureceu um orquestrador que **ainda não
fazia trabalho substantivo nenhum** — o passo (c) do seu loop era um comentário vazio. Esta demanda liga o
trabalho, e com ele três fronteiras que o Gate 3 desta demanda modelou (CB-1 conteúdo do prompt / CB-2
construção do filho / CB-3 5º kind de evidência) e endureceu com R62-R66. Este gate escolhe o **mecanismo** que
materializa essas regras sem violá-las.

### 1.2 Os dois achados que a leitura do código produziu — declarados antes de qualquer decisão

Ratificar "compõe, nunca reimplementa" pressupõe que toda peça nova é uma composição sobre um primitivo já
existente. A leitura do código encontra **dois** pontos onde isso é quase — mas não exatamente — trivial, e
nomeá-los é parte do trabalho deste gate.

| # | A suposição | O que o código diz | Consequência de desenho |
|---|---|---|---|
| **N1 — GAP-2 torna o papel-líder uma sessão-folha SEM ferramentas** | FR-4/glossário: `runAuto` spawna uma sessão-filha "real" que faz o trabalho do gate; o glossário define "delegação real" como uma que produz "sessão-filha disc-backed, tokens gastos, **arquivos tocados**". | `toTaskRoleRegistryView` (`role-resolution.ts:178`) devolve `tools: role.tools`, e **nenhum dos 37 papéis built-in declara `tools`** (GAP-2 da Fase 3, `builtin-roles-data.ts` não tem campo `tools`; `role-catalog.ts`/`role-resolution.ts` confirmam em voz alta). `createGovernedChildSessionSpawner` passa `tools: input.role.tools` → o filho nasce com `[]` (nem `read`). `chat.ts` já **recusa** `--role <slug>` quando `tools` é vazio ("silently opening a session with zero usable tools (not even `read`)"). Um filho sem tools produz **prosa**, nunca lê a spec, nunca toca arquivo. | Um filho tools-vazias **não pode** satisfazer a definição de "delegação real" da própria spec (**arquivos tocados** é estruturalmente impossível). Gravar seu monólogo como `{kind:"delegation"}` seria um hollow-completion mais sutil que o do Gate 8 loop-back da Fase 8 (uma sessão "real" que não observou nada). **Decisão D2: recusar fail-closed quando `tools` é vazio** — o mesmo precedente de `chat.ts`, a mesma disciplina de honestidade que o ADR 0009 §20 usou para o `context-limit`. Consequência: enquanto GAP-2 estiver aberto, a delegação é fiada, correta e testada, porém **inerte** (recusa → `needs-human` no Gate 1). |
| **N2 — `describeRefusal` é privado, mas FR-2b exige reusar UMA formatação de recusa** | FR-2b: uma recusa da resolução por-persona para o run "reusando a MESMA lógica de descrição de recusa que a pré-condição do gate já usa (`describeRefusal`-shaped), nunca uma segunda função de formatação". | `describeRefusal` (`model-precondition.ts:66`) **não é exportado** — é interno a `evaluateModelPrecondition`, que por sua vez só roda com `purpose:"gate-open"` e **descarta** `resolution.model`. `runAuto` precisa de `.model` (só disponível chamando `resolveForGate` **direto**, D3) **e** de `describeRefusal` para a recusa. | **Decisão D3: exportar `describeRefusal` de `@conductor/runtime`** (uma exportação aditiva, zero mudança de comportamento) para que `runAuto` reuse a ÚNICA formatação. Sem isto, FR-2b só seria satisfeita duplicando a formatação — o que a própria FR-2b proíbe. É o análogo do achado N1 do ADR 0009 (um primitivo pronto, faltando o fio). |

Nenhum dos dois falsifica H-Fase8: N1 é uma **recusa fail-closed** (nenhum mutador, nenhum sign-off novo); N2 é
uma **exportação aditiva** de uma função pura já existente (nenhuma segunda lógica).

### 1.3 Atributos de qualidade priorizados (a ordem É a decisão)

1. **Integridade da evidência de delegação.** `{kind:"delegation"}` só resolve `runtime-derived` de um spawn que
   ESTE processo observou; nunca de disco, nunca de um `--ref`, nunca de um monólogo sem ferramentas (N1). Vence
   conveniência, vence "fazer o gate fechar".
2. **Não-reabertura dos holes fechados pela Fase 3.** Os 4 campos de segurança de `SpawnChildSessionInput`
   (`model`/`yesFlagActive`/`effectivePolicy`/`auditTrailWriter`) nunca são omitidos NEM afrouxados — o TIPO já
   força presença; o **builder** (D5) força o valor certo.
3. **Fail-closed em toda fronteira de delegação.** Recusa de modelo, budget esgotado, exceção de spawn, tools
   vazias — todos degradam para uma condição de parada já exaustiva (`needs-human`/`budget-exceeded`), nunca uma
   quinta, nunca um crash.
4. **Composição, nunca reimplementação (Ousterhout / dependency rule).** `runAuto` chama
   `createGovernedChildSessionSpawner` (função já exportada), nunca `createAgentSession(` (preserva o
   sole-constructor), nunca `runTask` (cuja autorização role-a-role responde a uma pergunta que não se aplica a
   um alvo tabelado), nunca uma segunda `SharedBudget`.
5. **Medida certa, não a plausível.** `"context-limit"` mede a janela **por-chamada** do modelo resolvido, nunca
   o orçamento acumulado do run — a distinção que o ADR 0009 §20 nomeou e rejeitou.

*Grounding:* **Architecture Boundaries and the Dependency Rule — Complete Professional Guide §2.12 "When not to
use ports and adapters"** (0.609 nesta sessão: *"each port will have exactly one adapter, forever... adding a
field touches the port, the adapter, and the whole chain"*) — a razão de compor sobre `createGovernedChildSessionSpawner`
em vez de introduzir uma segunda abstração (item 4); **Managing Software Complexity — Complete Professional Guide
§3.1/§3.10** (0.555/0.558: information hiding — o builder é o módulo profundo que esconde as 4 decisões de
segurança para que um chamador não possa vazar um valor errado, item 2); **Object-Oriented Thinking — Complete
Professional Guide §3.12 "When not to reach for polymorphism or composition"** (0.596: *"the variants are closed
by something outside you... a file format's fields"*) — a razão de o 5º `EvidenceRef` kind ser um membro aditivo
de um union fechado pela taxonomia de evidência do próprio fluxo (D7); **Security Engineering Principles §2.2**
(herdado do Gate 3, secure-by-default / fail-safe) para os itens 1 e 3.

---

## 2. Decisão central, e o mapa D1-D9

**O passo (c) de `runAuto` vira uma única função interna `runGateDelegation`, chamada entre `runGateStart`
(passo b) e o secret-scan (passo d), que COMPÕE a infraestrutura de delegação da Fase 3 sem reimplementar
nenhuma peça dela: seleção determinística do papel-líder (fail-closed quando o papel resolve sem ferramentas),
resolução do `Model` direto por `purpose:"delegation"`, construção de `SpawnChildSessionInput` por um builder de
campos obrigatórios, spawn via `createGovernedChildSessionSpawner`, e — só de um spawn que ESTE processo
observou — a anexação de um 5º `EvidenceRef` kind `"delegation"` runtime-derived. Toda falha degrada pela mesma
máquina `stopRun` já existente; o `"context-limit"` passa a ser produzido medindo a janela por-chamada do modelo
resolvido, fechando o §20 do ADR 0009.**

| # | Decisão | Fecha / responde | Regra Gate 3 |
|---|---|---|---|
| **D1** | **`runGateDelegation` — a função interna do passo (c).** Nova função `async` privada em `commands/auto.ts`, chamada em `auto.ts:658` (entre b e d); assinatura e forma de retorno em §3. | Tarefa #1; ADR 0009 §3.2 passo (c) | — |
| **D2** | **Seleção do papel-líder = `BUILTIN_GATE_ROLES[gate][0]` via `roleRegistry.get`; recusa fail-closed quando o papel não resolve OU resolve com `tools:[]` (N1/GAP-2).** | FR-1/1b; achado N1 | R62/R66 |
| **D3** | **Resolução do `Model` DIRETO por `port.resolveForGate({gate,purpose:"delegation",persona})` (nunca via `evaluateModelPrecondition`, que descarta `.model`); `describeRefusal` exportado (N2) para reusar a única formatação de recusa.** | FR-2/2b; achado N2 | R65 |
| **D4** | **Templates de prompt por-gate num módulo `auto-delegation-templates.ts`; delimitação explícita dado/instrução (GAP-C).** | FR-3/3b | **R62** |
| **D5** | **`SpawnChildSessionInput` construído por um builder `buildDelegationSpawnInput` que hardcoda `yesFlagActive:false` e DERIVA `effectivePolicy`/`auditTrailWriter` internamente — os 4 invariantes de segurança viram impossíveis de omitir *ou* afrouxar (GAP-D).** | FR-4 | **R63** |
| **D6** | **Spawn direto via `createGovernedChildSessionSpawner(sharedBudget)`; reserve/settle por-delegação espelhando `runTask`, direção fail-safe na contabilidade (nunca `runTask`, nunca 2ª `SharedBudget`, nunca 3º `createAgentSession`).** | FR-4/4b | R66 |
| **D7** | **5º `EvidenceRef` kind `{kind:"delegation",sessionId,role}`; `runtimeRecordedDelegationSessionIds` = `Set` mutável só-in-process de `runAuto`; `resolveEvidenceRef` novo case; `hasSufficientEvidenceForMandatoryGate` estendido a `test-run\|\|journal-entry\|\|delegation` (fechando junto a assimetria pré-existente de `journal-entry`).** | FR-5/5a/5b/5c | **R64** |
| **D8** | **`"context-limit"` produzido pela 1ª vez: `result.tokenUsage.total ≥ 0.9 × model.contextWindow`, por-chamada, na fronteira do gate — nunca `sharedBudget.remaining()`.** | FR-6; **fecha ADR 0009 §20** | R66 |
| **D9** | **Degradação: `runGateDelegation` é envolvida de modo que toda falha (recusa, tools-vazias, exceção de spawn, budget null) roteia pelo `stopRun` já existente → `needs-human`/`budget-exceeded`, nunca um caminho de parada novo, nunca um crash.** | FR-7/7b/7c | R66 |

---

## 3. D1 — `runGateDelegation`: o ponto de inserção e a forma do passo (c)

### 3.1 Onde é chamada

Exatamente no lugar do comentário vazio de hoje (`auto.ts:658-659`), **dentro do `for` de gates**, **entre** o
passo (b) `runGateStart` e o passo (d) secret-scan:

```
for (gate = startGate .. TOTAL_FLOW_GATES):
  reserve(4_000) ao topo → null ⇒ budget-exceeded          (existente, auto.ts:631)
  (a) re-veto sobre o diff materializado                    (existente, 638-646)
  (b) snapshot = runGateStart(gate)                         (existente, 651)
  (c) const outcome = await runGateDelegation({...})   ◄──── NOVO (o passo (c))
        outcome.kind === "stop"  ⇒ stopRun(...); return outcome.exitCode
  (d) secret-scan do diff staged                            (existente, 663-672)
  (e) commitGateScoped(gate)                                (existente, 675)
  (f) approve (mandatório: runGateApprove | não: approveAuto)
  (g) pushBranch
  (h) outcome.contextExceeded ⇒ stopRun(context-limit); return  ◄── D8, na fronteira do gate
```

A ordem importa: a delegação (c) é o que **produz o diff** que (d) escaneia, (e) commita e a re-avaliação de
veto de (a) do próximo gate re-examina. Por isso (c) roda depois de (b) abrir o gate e antes de (d/e). O sinal
de `context-limit` (D8) é retornado por (c) e checado na fronteira do gate (h), "depois que ele termina, nunca
no meio" (ADR 0009 FR-13, herdado).

### 3.2 A assinatura e o retorno

`runGateDelegation` recebe **colaboradores já construídos** (nunca os constrói — módulo profundo, interface
estreita, o mesmo padrão que `runAuto` já é para `store`/`confirm`/`budget`) e devolve um **resultado tipado**,
nunca uma exceção que o loop possa esquecer de tratar (o mesmo molde de `RiskClassification`):

```ts
interface GateDelegationOptions {
  gate: number;
  io: CliIO;
  roleRegistry: RoleRegistryView;               // toTaskRoleRegistryView(loadRealRoleRegistryAndSkills(...))
  modelResolutionPort: ModelResolutionPort;     // o MESMO já construído para a pré-condição do gate (auto.ts:588)
  sharedBudget: SharedBudget;                    // a instância ÚNICA (auto.ts:581) — nunca uma segunda
  effectivePolicyInput: EffectivePolicyInput;    // resolveEffectivePolicy(io.cwd), construído 1x fora do loop
  auditTrailWriter: AuditTrailWriter;            // createAuditTrailWriter(auditPath(io.cwd)), 1x fora do loop
  recordDelegationSessionId: (sessionId: string) => void;  // adiciona ao Set só-in-process (D7)
  attachDelegationEvidence:                        // runGateEvidence-bound, com o evidenceContext de runAuto (D7)
    (gate: number, ref: DelegationEvidenceRef) => void;
}

type GateDelegationOutcome =
  | { kind: "delegated"; contextExceeded: boolean }        // (h) checa contextExceeded na fronteira
  | { kind: "stop"; reason: RunStopReason; exitCode: number; detail: string };  // D9 — needs-human | budget-exceeded
```

*Grounding:* **Managing Software Complexity §3.1** (information hiding: `runGateDelegation` é um módulo profundo
— uma interface estreita esconde toda a orquestração de resolução/construção/spawn/evidência); **Writing
Maintainable Code — Complete Professional Guide §4.12** (0.604: *"a result type / an explicit variant"* para
falha rotineira — `GateDelegationOutcome` é esse resultado tipado, o loop nunca desembrulha um throw).

---

## 4. D2 — Seleção do papel-líder e a recusa fail-closed por GAP-2 (fecha FR-1/1b, achado N1)

O papel-líder é **`BUILTIN_GATE_ROLES[gate][0]`** — o primeiro slug, indexado pelo **inteiro** do gate (nunca
por texto de documento, T85/secure-default 78 confirmado). Exemplos: Gate 3 → `security-engineer`; Gate 6 →
`software-engineer`; Gate 9 → `application-security-engineer`. `runGateDelegation` resolve
`role = roleRegistry.get(slug)`; **duas** recusas fail-closed, ambas nomeando gate + slug e degradando por D9:

1. **`role === undefined`** (scaffold incompleto do projeto) → `needs-human` (FR-1b).
2. **`role.tools.length === 0`** (GAP-2, achado N1) → `needs-human`, nomeando o gate, o papel e a causa
   ("o papel-líder resolve sem ferramentas — GAP-2 da Fase 3 ainda não fiou os tetos de tools por-papel; a
   delegação recusa em vez de gravar um monólogo sem ferramentas como evidência").

**Por que recusar, e não spawnar mesmo assim.** A alternativa rejeitada — spawnar um filho `tools:[]`, deixá-lo
produzir prosa, e gravar seu `sessionId` como `{kind:"delegation"}` — reintroduz o hollow-completion que o Gate
8 loop-back da Fase 8 fechou, agora com o disfarce de uma "sessão real": o filho gasta tokens e tem transcript
em disco, mas **não leu nada e não tocou nada**. Como o glossário da própria spec define "delegação real" como
uma que produz "arquivos tocados", e como GAP-2 torna isso estruturalmente impossível, a delegação **não é
real** — recusar é a única leitura honesta, exatamente o precedente que `chat.ts` já aplica a uma sessão de
tools-vazias. Isto **fortalece** R64 (integridade de evidência): um monólogo nunca vira prova.

**Consequência declarada, não escondida:** enquanto GAP-2 estiver aberto (fora do escopo desta demanda, deferido
pelo Gate 3 addendum T85), toda delegação recusa → o run para no Gate 1 como `needs-human`. A máquina inteira
está fiada, correta e testada; ativa **sem nenhuma mudança neste ADR** no instante em que os tetos de tools
por-papel forem fiados. É a mesma honestidade "fiado mas estruturalmente inerte até uma fase futura" que o ADR
0009 §20 usou para o `"context-limit"` — só que aqui a fase futura é GAP-2, não o handle de sessão.

*Grounding:* **Object-Oriented Thinking §3.12** (0.596: uma seleção determinística sobre um conjunto fechado por
uma fonte externa — a tabela `BUILTIN_GATE_ROLES` — não é lugar de heurística); precedente de código:
`chat.ts`'s recusa de tools-vazias, `role-resolution.ts`'s GAP-2. **Declarado FRACO no corpus para "seleção do
primeiro/líder entre candidatos já ordenados"** (herdado do Gate 2, top ~0.59) — fundamentado no precedente de
código (a ordem de `BUILTIN_GATE_ROLES` já É a decisão de ranqueamento do `flow.md`).

---

## 5. D3 — Resolução do `Model` direto por `purpose:"delegation"`, e a exportação de `describeRefusal` (FR-2/2b, N2)

`runGateStart` (passo b) já impôs a pré-condição do gate chamando `port.resolveForGate({gate,purpose:"gate-open"})`
por dentro de `evaluateModelPrecondition` — mas `evaluateModelPrecondition` **descarta `.model`** (só guarda
`ref.provider`/`modelId`, `model-precondition.ts:132`). Logo `runGateDelegation` chama o **MESMO**
`modelResolutionPort` **direto**, com `purpose:"delegation"` e a persona do papel-líder:

```ts
const resolution = modelResolutionPort.resolveForGate({
  gate,
  purpose: "delegation",                                   // 1º caller real de um literal travado do ADR 0008 §16
  persona: { name: role.name, modelRole: role.modelRole }, // eleva o piso via max(rank(gate), rank(persona)), D1.5
});
if (!resolution.resolved) return stopOutcome("needs-human", describeRefusal(resolution.refusal, MANDATORY_GATES));
const model: Model<Api> = resolution.model;                // vira SpawnChildSessionInput.model (D5) — nunca omitido
```

- **Nunca uma segunda seleção.** É o mesmíssimo `ModelResolutionPort` (`auto.ts:588`), a mesma âncora de
  provedor ativo (BR6/R47/R65). `model` sempre populado ⇒ o `findInitialModel` ambiental do Pi (GAP-5/T84)
  fica **estruturalmente inalcançável** para o filho.
- **Caso real de recusa (FR-2b/edge 3):** a pré-condição `gate-open` (sem persona) pode passar enquanto a
  resolução por-persona recusa, porque `max(rank(gate), rank(persona))` eleva o piso acima do que o binding do
  gate sozinho exigia. Este caso **para graciosamente** (`needs-human`), nunca prossegue abaixo do piso; o
  `GateState` já aberto **não** é revertido (edge 3).
- **N2 / a exportação declarada:** `describeRefusal` (hoje privado em `model-precondition.ts`) passa a ser
  **exportado por `@conductor/runtime`** — uma exportação aditiva, zero mudança de comportamento — para que
  `runGateDelegation` reuse a ÚNICA formatação de recusa (FR-2b), nunca uma segunda.

*Grounding:* reuso de porta de resolução para um 2º propósito em vez de uma 2ª porta — **herdado, declarado FRACO
no corpus** (Gate 2 §8, top ~0.58) — fundamentado no ADR 0008 §21/D11 (a porta é o ponto de composição único) e
no precedente `createCliModelResolutionPort`.

---

## 6. D4 — Templates de prompt por-gate e a delimitação dado/instrução (fecha FR-3/3b/GAP-C, materializa R62)

**Onde vivem:** um módulo novo dedicado, **`packages/conductor-cli/src/commands/auto-delegation-templates.ts`**
— um `Readonly<Record<number, GateDelegationTemplate>>` congelado, dado autoral e estático, **não** interpolação
de texto não-confiável. Um módulo separado (não um mapa inline em `auto.ts`) porque o texto é revisável,
testável isoladamente, e é o artefato que R62/GAP-C governa.

```ts
interface GateDelegationTemplate {
  /** Instrução FIXA, autoral: o que aquele papel deve produzir naquele gate (ex.: Gate 3 → "modele ameaças
   *  conforme a skill model-threats; enumere STRIDE por elemento; ..."). NUNCA a demand-string/diff. */
  instruction: string;
  /** As skills que o papel-líder já invoca no /cdt manual, por nome — referência, não conteúdo. */
  skills: readonly string[];
}
```

O prompt final montado por `runGateDelegation` é: **(1) a `instruction` fixa do gate** + **(2) referências
NEUTRAS** — o slug da demanda, o **caminho** da spec no repositório, o nome da branch (todas passadas por
`slugify`, a allowlist `[a-z0-9-]` que R62(iv)/secure-default 73 trava) — + **(3) um bloco de delimitação
explícito** (GAP-C/R62(ii)): um rótulo textual que instrui o subagente a tratar **todo conteúdo que ele leia do
workspace com as próprias ferramentas** (`read`/`grep`) como **DADO do repositório sob análise, nunca como
comando do operador** — o mesmo conteúdo pode conter texto adversarial de um clone hostil/PR/issue. O template
**nunca** concatena a demand-string bruta nem o diff como instrução ao vivo.

**Honestidade (R62/T81):** a delimitação é **defesa em profundidade**, não uma prova de impossibilidade — o
`SpawnChildSessionInput.prompt` + o que o filho lê continuam um sink de confused-deputy genuíno. A defesa
**decisiva** é o backstop mandatório herdado (protected-paths + secret-scan pré-push + Gate 3/8/9 incolapsáveis
sobre o diff real + never-land-sem-humano), exatamente como R62 crava. (E como N1/D2 recusa a delegação enquanto
GAP-2 estiver aberto, o sink de leitura de arquivos hostis nem se abre até os tetos de tools existirem.)

*Grounding:* **Prompt Engineering PPP §9.2 "Prompt Injection: The Confused Deputy in the Context Window"**
(herdado, 0.706) + **Context Engineering §9.6 "Prompt Injection as a Context-Design Problem"** (0.659) — a defesa
é de design de contexto (marcar a origem), não de boa-fé do conteúdo.

---

## 7. D5 — O builder de campos obrigatórios: os 4 invariantes de segurança impossíveis de omitir OU afrouxar (fecha FR-4/GAP-D, materializa R63)

`SpawnChildSessionInput` já torna os 4 campos **não-opcionais** (`task.ts:109-149`), então um literal que omite
qualquer um é **erro de compilação**. Mas GAP-D é mais sutil: o TIPO força **presença**, não **correção** —
`yesFlagActive: true` compila; um `effectivePolicy`/`auditTrailWriter` permissivo compila. A decisão vai além do
tipo: **um builder dedicado cujos parâmetros tornam o valor errado inexprimível.**

```ts
/** O ÚNICO construtor de SpawnChildSessionInput em runAuto. Não recebe yesFlagActive (hardcoded false); não
 *  recebe effectivePolicy/auditTrailWriter como objetos (deriva-os da fonte canônica), então um chamador NÃO
 *  PODE passar um stand-in permissivo. `model`/`role`/`prompt` são obrigatórios e não-defaultados. (GAP-D/R63) */
function buildDelegationSpawnInput(args: {
  role: ConductorRoleView;                 // FR-1, já validado tools.length > 0 (D2)
  prompt: string;                          // D4
  model: Model<Api>;                       // D3 — obrigatório, nunca omitido (GAP-5/T84 fechado por construção)
  workspaceRoot: string;                   // io.cwd
  effectivePolicyInput: EffectivePolicyInput;  // resolveEffectivePolicy(io.cwd), o MESMO de chat.ts
  auditTrailWriter: AuditTrailWriter;      // createAuditTrailWriter(...), o MESMO de chat.ts
  sessionManager: SessionManager;          // SessionManager.create(cwd, .conductor-agent/sessions/tasks) — disc-backed
}): SpawnChildSessionInput {
  return {
    role: args.role, prompt: args.prompt, model: args.model,
    workspaceRoot: args.workspaceRoot,
    effectivePolicy: args.effectivePolicyInput,
    auditTrailWriter: args.auditTrailWriter,
    sessionManager: args.sessionManager,
    depth: 1,                              // hardcoded — runAuto só bypassa o hop raiz→depth-1 (R66/T85)
    additionalProtectedPaths: [],          // hardcoded
    yesFlagActive: false,                  // HARDCODED — runAuto é headless por natureza (D3 layer 1, ADR 0009)
  };
}
```

O que torna os 4 invariantes **estruturais**, não convenção: `yesFlagActive` **não é parâmetro** (sempre
`false`); `effectivePolicy`/`auditTrailWriter` chegam pelos MESMOS colaboradores de `chat.ts` (construídos **uma
vez fora do loop**, nunca um stand-in); `model` é obrigatório e tipado `Model<Api>` (nunca omitido). O invariante
sole-constructor de `createAgentSession` é preservado: o builder monta um objeto, **não** chama `createAgentSession(`.

*Grounding:* **Managing Software Complexity §3.10/§3.1** (0.558/0.555, information hiding — as 4 decisões de
segurança escondidas num módulo profundo, o chamador não pode vazar um valor errado); precedente de código: o
próprio doc comment de 39 linhas de `SpawnChildSessionInput.model` (GAP-5). **Declarado moderado** — o corpus
cobre information-hiding, não "builder de campos obrigatórios" nominalmente; apoiado no precedente GAP-5/GAP-D.

---

## 8. D6 — Spawn e contabilidade de budget (FR-4/4b, R66)

`runGateDelegation` chama **`createGovernedChildSessionSpawner(sharedBudget)(spawnInput)`** — a função **já
exportada** que `session.ts`'s `createTaskTool` já injeta. Consequências travadas:

- **Nunca `runTask`.** A autorização `canSpawn(caller,target)` + depth-cap de `runTask` responde a "um MODELO,
  sobre input hostil, pode delegar a este alvo?" — pergunta que **não se aplica**: o alvo é determinístico e
  tabelado (D2), o "caller" é o processo CLI (raiz, depth 0). Bypassar `canSpawn` no hop raiz→depth-1 é
  equivalente à sessão-raiz humana do `/cdt` escolher `task` — autoridade inerente da raiz, não escalada (R66/T85).
- **Nunca um 3º `createAgentSession(`.** O scan de `task-sole-constructor.test.ts` continua vendo exatamente dois
  (`session.ts`, `tools/task.ts`); chamar `createGovernedChildSessionSpawner` não adiciona um call site literal.
- **Nunca uma 2ª `SharedBudget`.** A instância única de `auto.ts:581` é passada por referência (R60/BR-4).
- **Reserve/settle (FR-4b), direção fail-safe (R66/T85).** Espelha `runTask` exatamente:
  `reservation = sharedBudget.reserve(DEFAULT_TASK_TOKEN_ESTIMATE)`; `null` ⇒ `budget-exceeded` (FR-7b, um
  **segundo** ponto de checagem distinto do `reserve(4_000)` do topo do loop); `sharedBudget.settle(reservation,
  result.tokenUsage)` exatamente uma vez (na falha, `settle(reservation, ZERO_USAGE)` como `runTask` faz). O
  guard por-turno interno do spawner (`createBudgetGuardedModelRuntime`) fica intocado. A contabilidade
  (reserve do topo + reserve por-delegação + guard por-turno) pode **super-contar** — direção **fail-safe**
  (super-conta ⇒ para cedo com `budget-exceeded`, nunca overspend), mantendo `budget-exceeded` e `context-limit`
  (D8) **distintos e honestos**.

---

## 9. D7 — O 5º `EvidenceRef` kind, runtime-derived só-in-process (fecha FR-5/5a/5b/5c, materializa R64)

**Forma do 5º kind** (aditivo — os 4 existentes ficam literais), declarado no ÚNICO lugar onde `EvidenceRef` é
declarado (`gate-evidence.ts`):

```ts
export type EvidenceRef =
  | { kind: "git-commit"; sha: string }
  | { kind: "file"; path: string }
  | { kind: "journal-entry"; id: string }
  | { kind: "test-run"; id: string }
  | { kind: "delegation"; sessionId: string; role: string };   // ◄── 5º, NOVO (FR-5)
```

**`runtimeRecordedDelegationSessionIds` — onde vive e como é threaded.** É um **`Set<string>` mutável** criado
por `runAuto` **no início de cada invocação de processo** (`const delegationSessionIds = new Set<string>()`),
**sem nenhum leitor de disco**. `runAuto` constrói seu `evidenceContext: ResolveEvidenceRefContext` **uma vez**,
espelhando `cli.ts:452` (repoRoot/workspaceRoot = io.cwd; `gitCommitExists` real; `runtimeRecordedTestRunIds`
vazio; `runtimeRecordedJournalEntryIds` de `readRecordedJournalEntryIds`), **mais** o 5º campo apontando para
esse Set (um `Set` mutável é atribuível a `ReadonlySet`). Ordem por delegação bem-sucedida: `spawn` retorna →
`delegationSessionIds.add(result.sessionId)` → `attachDelegationEvidence(gate, {kind:"delegation", sessionId,
role})` → `runGateEvidence` chama `resolveEvidenceRef`, que agora tem:

```ts
case "delegation":
  return ctx.runtimeRecordedDelegationSessionIds.has(ref.sessionId)
    ? { ok: true, provenance: "runtime-derived" }
    : { ok: false, reason: `delegation evidence ref was never recorded by the runtime: "${ref.sessionId}"` };
```

`ResolveEvidenceRefContext` ganha `runtimeRecordedDelegationSessionIds: ReadonlySet<string>` (mesma forma dos
outros dois sets runtime-derived). O doc comment de `resolveEvidenceRef` ("exatamente 4 kinds") é atualizado para
5 (§9 questão 5 do Gate 2 — mudança textual).

**GAP-A estruturalmente enforced (não documentado):** o Set **não tem leitor de disco, por construção**. Num
`--continue`, ele nasce **vazio** num processo novo e só é populado pelos spawns que ESTE processo observa —
`.conductor-agent/sessions/tasks/` **nunca** é varrido para "recuperar" `sessionId`s (plantáveis por clone
hostil). O registro autoritativo do que já foi APROVADO é o `GateState` persistido; gates cuja evidência de
delegação não sobreviveu ao processo original simplesmente **refazem** a delegação ao reabrir (R64(ii)/T83).

**FR-5b + a assimetria pré-existente (§9 Q2 / R64).** A linha 209 hoje é `provenance==="runtime-derived" &&
ref.kind==="test-run"` — omite `journal-entry` apesar de o próprio arquivo tratá-los como equivalentes. O Gate 3
addendum §5 avisou explicitamente: "não introduzir uma **terceira** assimetria ao adicionar `delegation`". Logo
a **decisão** é estender a **todos os três** runtime-derived, fechando a assimetria de `journal-entry` na mesma
linha:

```ts
export function hasSufficientEvidenceForMandatoryGate(evidence: readonly EvidenceProvenanceInfo[]): boolean {
  if (evidence.some((i) => i.provenance === "runtime-derived" &&
      (i.ref.kind === "test-run" || i.ref.kind === "journal-entry" || i.ref.kind === "delegation"))) return true;
  return evidence.some((i) => i.provenance === "author-declared" && i.ref.kind === "git-commit");  // fallback intocado
}
```

**GAP-B estruturalmente enforced (não documentado):** `{kind:"delegation"}` só afeta se
`hasSufficientEvidenceForMandatoryGate` retorna `true` — a **pré-condição** que `gate-store.ts:352` consulta.
O **mint** de um gate mandatório continua exigindo `mintHumanApproval(confirmResult===true &&
isInteractive()===true)` (ADR 0009 D3, duas camadas, **intocado**). Em `runAuto`, gate mandatório → `runGateApprove`
headless → confirm resolve `false` → `needs-human`, **independentemente de quanta evidência de delegação esteja
anexada**. Nenhuma fiação desta demanda liga "evidência suficiente" a "aprovação". FR-5c: a guarda
`evidence.length===0` de `approveAuto` (gate-store.ts:488) passa a ser satisfeita por trabalho genuíno (para
gates não-mandatórios, quando GAP-2 fechar) — comportamento observável de `evidence.length>0` inalterado.

*Grounding:* **Object-Oriented Thinking §3.12** (0.596: variante aditiva a um union fechado, guarda de
exaustividade); precedente direto: o Gate-8-loop-back da Fase 4 que já adicionou `git-commit` à mesma função.
**Herdado do Gate 2/3**: Specification by Example §3.3 + Prompt Engineering PPP §5.6 ("evidência exige execução
real; raciocínio declarado não é transcript de computação") — a base de por que o Set exige o observador real.

---

## 10. D8 — `"context-limit"` produzido pela 1ª vez: janela por-chamada, não orçamento do run (FR-6, fecha ADR 0009 §20)

`SpawnChildSessionResult.tokenUsage: BudgetUsage = {input, output, total}` vem de `session.getSessionStats()`
dentro do spawner (`task.ts:616-623`); `Model<Api>.contextWindow: number` é campo real do SDK (confirmado,
`pi-ai/dist/types.d.ts:670`). Após cada spawn bem-sucedido do gate G:

```ts
const CONTEXT_LIMIT_FRACTION = 0.9;   // default declarado, override Gate 6/11 (nunca uma verdade descoberta)
const contextExceeded = result.tokenUsage.total >= CONTEXT_LIMIT_FRACTION * model.contextWindow;
```

- **Por-chamada, nunca acumulado.** `result.tokenUsage.total` é o uso de UMA sessão-filha; `model.contextWindow`
  é a janela do modelo **resolvido em D3 para aquele papel/gate**. **NUNCA** `sharedBudget.remaining()` — que
  mede um teto DIFERENTE, acumulado por todo o run (a confusão que o ADR 0009 §20 nomeou e rejeitou: "um número
  que parece plausível mas mede a coisa errada"). Ambos os lados são runtime-derived (`getSessionStats` + campo
  do SDK) — o modelo-filho não pode mentir seu uso (T85).
- **Na fronteira do gate (passo h), nunca no meio.** `runGateDelegation` devolve `contextExceeded` em
  `{kind:"delegated"}`; o loop, após o push (g), checa e — se cruzado — `stopRun(context-limit)` e retorna. É a
  **primeira** vez que `runAuto` produz esse valor, fechando o §20 do ADR 0009 **sem** reabrir nenhuma decisão
  D1-D8 daquele ADR (o tipo `RunStopReason` não muda; ganha seu primeiro caminho-produtor).

*Grounding:* **Context Engineering §3.6/§13.7 "Budget Contracts Between Pipeline Stages"** (herdado, 0.61: um
limite por-estágio e um orçamento acumulado medem coisas diferentes) — a base direta da distinção.

---

## 11. D9 — Degradação: toda falha pela máquina `stopRun` já existente (FR-7/7b/7c, R66)

`runGateDelegation` **nunca** deixa uma exceção subir ao loop. Seu corpo inteiro (resolução, construção, spawn,
evidência) é envolvido de modo que **cada** falha devolve um `{kind:"stop"; reason; exitCode; detail}` que o
loop mapeia para o **mesmo** `stopRun` + `return` já existente — nunca um caminho de parada novo:

| Falha | `reason` | exitCode | Regra |
|---|---|---|---|
| `role===undefined` ou `role.tools===[]` (D2/N1) | `needs-human` | `EXIT_STOPPED` | FR-1b |
| `resolveForGate` recusa (D3, inclui piso por-persona) | `needs-human` | `EXIT_STOPPED` | FR-2b/R65 |
| `sharedBudget.reserve(...) === null` (D6) | `budget-exceeded` | `EXIT_BUDGET_EXCEEDED` | FR-7b |
| `createGovernedChildSessionSpawner(...)` lança (credencial/rede/tool negado) | `needs-human` | `EXIT_STOPPED` | FR-7 |
| `runGateEvidence` lança (ref não resolve) | `needs-human` | `EXIT_STOPPED` | FR-7 |

É a **MESMA** disciplina try/catch que o Gate-8-loop-back da Fase 8 aplicou ao branch mandatório de
`runGateApprove`, estendida ao passo (c). Nenhuma quinta condição de parada é criada: um timeout futuro de turno
de subagente (FR-7c — o SDK do Pi não expõe um hoje) degradaria pela **mesma** rota `needs-human`. Edge case 4
(filho com sucesso mas `filesTouched:[]` para um papel que muda arquivos) é herdado de `task.ts` FR-19 —
`runGateDelegation` trata esse `isError`/resultado vazio como qualquer outra falha de delegação; note que, sob
GAP-2 (D2), esse caso nem se alcança porque a delegação recusou antes.

*Grounding:* **Writing Maintainable Code §4.12** (0.604: falha rotineira → variante tipada, não throw) +
**Managing Software Complexity §3.12** (0.595: *"some callers act differently on the error"* — a razão de
`budget-exceeded` e `needs-human` permanecerem distintos, nunca colapsados). Precedente: ADR 0009 D6 (as 4
condições exaustivas) + o try/catch do Gate-8-loop-back.

---

## 12. SLIs / SLOs por componente (objetivo explícito do Gate 4)

Mesma distinção honesta do ADR 0009 §11: um CLI single-user não tem um request path servido continuamente, então
só latências realmente observadas são SLOs; o resto são **invariantes com error-budget zero**, asseverados por
teste no Gate 5/7 — não estimados por amostragem.

| # | Componente | SLI | Alvo | Tipo |
|---|---|---|---|---|
| 1 | Resolução de modelo (delegação) | Latência de `resolveForGate({purpose:"delegation"})` sobre o `ctx` já construído (puro) | p95 < **50 ms** | SLO |
| 2 | Seleção do papel-líder | Latência de `roleRegistry.get(BUILTIN_GATE_ROLES[gate][0])` + check `tools.length` | p95 < **20 ms** | SLO |
| 3 | Evidência de delegação | Latência de `resolveEvidenceRef({kind:"delegation"})` (membership num `Set` in-memory) | p95 < **10 ms** | SLO |
| 4 | Construção do filho | Latência de `buildDelegationSpawnInput` + `SessionManager.create` (fs local, sem rede) | p95 < **100 ms** | SLO |
| 5 | Evidência | Gate MANDATÓRIO aprovado via evidência de delegação forjada/reconstruída-por-disco | **0** | Invariante, budget 0 (GAP-A/B, R64) |
| 6 | Construção do filho | `SpawnChildSessionInput` com qualquer dos 4 campos de segurança omitido OU afrouxado | **0** | Invariante, budget 0 (GAP-D/R63 — erro de compilação + builder) |
| 7 | Evidência | `runtimeRecordedDelegationSessionIds` populado de disco/checkpoint/`--ref` | **0** | Invariante, budget 0 (GAP-A/R64 — sem leitor de disco por construção) |
| 8 | Construção do filho | Delegação spawnada com `yesFlagActive:true` | **0** | Invariante, budget 0 (R63 — não é parâmetro do builder) |
| 9 | Egress | Delegação spawnada com `model` omitido (`findInitialModel` ambiental alcançável) | **0** | Invariante, budget 0 (R63/R65/T84) |
| 10 | Parada | `"context-limit"` medido contra `sharedBudget.remaining()` em vez de `model.contextWindow` | **0** | Invariante, budget 0 (FR-6/BR-6/ADR 0009 §20) |
| 11 | Evidência | Gate MANDATÓRIO fechado por `{kind:"delegation"}` sem `needs-human` headless | **0** | Invariante, budget 0 (GAP-B — mint de mandatório intocado) |
| 12 | Autoridade | 2º `createAgentSession(` OU 2ª `SharedBudget` OU chamada a `runTask` em `commands/auto.ts` | **0** | Invariante, budget 0 (H-Fase8/R66, scan estático) |
| 13 | Robustez | Falha de delegação parando **graciosamente** (`stopRun`+checkpoint), nunca um crash não-capturado | **100 %** | Invariante (FR-7/BR-7) |
| 14 | Integridade de evidência | Delegação spawnada para um papel-líder com `tools:[]` (monólogo sem ferramentas gravado como evidência) | **0** | Invariante, budget 0 (D2/N1 — recusa fail-closed) |

Só 1-4 são SLOs de verdade; 5-14 são invariantes asseverados por teste. O invariante #5 (mais o #11) é o
backstop desta demanda — o que GAP-A/GAP-B existem para garantir.

*Grounding:* herdado — **Site Reliability Engineering §1.12** + **Software Architecture and Quality Attributes
§2.12** (a natureza SLO×invariante num CLI single-user, ADR 0007/0008/0009 §11).

---

## 13. Reconciliação R62-R66 (o mandato do Gate 3 §4)

| Regra | Onde satisfeita | Status |
|---|---|---|
| **R62** (prompt = template fixo + referências neutras; conteúdo lido é dado; backstop mandatório decisivo) | §6/D4 — módulo `auto-delegation-templates.ts`; delimitação dado/instrução explícita; `slugify` a única produtora de slug; residual aceito, limitado pelo backstop (e nem se abre sob GAP-2/D2) | **Confirmada** |
| **R63** (`runAuto` único populador; reusa colaboradores, nunca omite/afrouxa um campo) | §7/D5 — builder hardcoda `yesFlagActive:false`/`depth:1`, deriva policy/audit dos MESMOS de `chat.ts`, `model` obrigatório do D3; sole-constructor preservado | **Confirmada** |
| **R64** (evidência runtime-derived só-in-process; `--continue` não reconstrói; evidência ≠ aprovação) | §9/D7 — Set sem leitor de disco (GAP-A estrutural); `GateState` autoritativo; mint de mandatório intocado (GAP-B estrutural); assimetria `journal-entry` fechada para não criar uma terceira | **Confirmada** |
| **R65** (resolução de delegação herda R46-R49/R61 sem relaxamento; cross-provider bloqueado no loop) | §5/D3 — mesmo `ModelResolutionPort`/âncora de provedor; `model` sempre populado; recusa → `needs-human` (fail-closed); cross-provider para o run, nunca cruza sozinho | **Confirmada** |
| **R66** (seleção indexada por inteiro; bypass de `canSpawn` só no hop raiz→depth-1 tabelado; `SharedBudget` único; contabilidade reconciliada) | §4/§8/D2/D6 — `BUILTIN_GATE_ROLES[gate][0]` por inteiro; `depth:1`; instância única por referência; reserve/settle fail-safe; `context-limit` contra o `contextWindow` resolvido | **Confirmada** |

**Nenhuma superfície de confiança nova retorna ao Gate 3** (o mandato iterativo, CLAUDE.md Gate 4). Os dois
achados deste gate **fecham** superfícies em vez de abrir: N1/D2 impede um monólogo sem ferramentas de virar
evidência (fortalece R64); N2/D3 é uma exportação aditiva de função pura. Nenhum 2º `createAgentSession`, nenhuma
2ª `SharedBudget`, nenhum mecanismo de timeout que crie uma 5ª condição de parada — os falsificadores explícitos
herdados de H-Fase8 não são tocados.

---

## 14. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato. Os nomes de tipo e a forma dos retornos **são** a decisão; corpos e detalhes de I/O
> são Gate 6.

```ts
// ===== @conductor/runtime — gate-evidence.ts (5º kind aditivo; os 4 existentes literais) ==============
export type EvidenceRef =
  | { kind: "git-commit"; sha: string } | { kind: "file"; path: string }
  | { kind: "journal-entry"; id: string } | { kind: "test-run"; id: string }
  | { kind: "delegation"; sessionId: string; role: string };            // FR-5

export interface ResolveEvidenceRefContext {
  repoRoot: string; workspaceRoot: string;
  gitCommitExists: (repoRoot: string, sha: string) => boolean;
  runtimeRecordedTestRunIds: ReadonlySet<string>;
  runtimeRecordedJournalEntryIds: ReadonlySet<string>;
  runtimeRecordedDelegationSessionIds: ReadonlySet<string>;             // FR-5a — só-in-process (GAP-A)
}
// resolveEvidenceRef: + case "delegation" → runtime-derived sse ∈ set, senão ok:false
// hasSufficientEvidenceForMandatoryGate: runtime-derived branch = test-run || journal-entry || delegation (FR-5b)

// ===== @conductor/runtime — model-precondition.ts (N2: exportação aditiva) ============================
export function describeRefusal(refusal: ResolutionRefusal, mandatoryGates: ReadonlySet<number>): string;  // era privado

// ===== @conductor/cli — commands/auto-delegation-templates.ts (D4, módulo novo) ======================
export interface GateDelegationTemplate { instruction: string; skills: readonly string[]; }
export const GATE_DELEGATION_TEMPLATES: Readonly<Record<number, GateDelegationTemplate>>;

// ===== @conductor/cli — commands/auto.ts (D1/D5/D6/D8/D9 — internos ao passo (c)) =====================
type GateDelegationOutcome =
  | { kind: "delegated"; contextExceeded: boolean }
  | { kind: "stop"; reason: RunStopReason; exitCode: number; detail: string };

function buildDelegationSpawnInput(args: {
  role: ConductorRoleView; prompt: string; model: Model<Api>; workspaceRoot: string;
  effectivePolicyInput: EffectivePolicyInput; auditTrailWriter: AuditTrailWriter; sessionManager: SessionManager;
}): SpawnChildSessionInput;    // yesFlagActive:false / depth:1 / additionalProtectedPaths:[] hardcoded (GAP-D)

async function runGateDelegation(options: GateDelegationOptions): Promise<GateDelegationOutcome>;

export const CONTEXT_LIMIT_FRACTION = 0.9;   // D8 — default declarado, override Gate 6/11
```

---

## 15. Rastreabilidade

| Origem | Item | Onde neste ADR |
|---|---|---|
| ADR 0009 §20 (gap do `context-limit`) | 1º código-caminho que produz `"context-limit"` | §10/D8 |
| ADR 0009 §3.2 passo (c) (seta abstrata) | `runGateDelegation`, ponto de inserção | §3/D1 |
| spec FR-1/1b (Grupo A) | papel-líder + fail-closed | §4/D2 |
| spec FR-2/2b (Grupo B) | `Model` por `purpose:"delegation"` | §5/D3 |
| spec FR-3/3b + GAP-C (Grupo C) | template + delimitação dado/instrução | §6/D4 |
| spec FR-4 + GAP-D (Grupo D) | builder de campos obrigatórios | §7/D5 |
| spec FR-4b (Grupo D) | reserve/settle | §8/D6 |
| spec FR-5/5a/5b/5c + GAP-A/B (Grupo E) | 5º kind, set in-process, evidência≠aprovação | §9/D7 |
| spec FR-6 (Grupo F) | `context-limit` por-chamada | §10/D8 |
| spec FR-7/7b/7c (Grupo G) | degradação graciosa | §11/D9 |
| Gate 3 T81-T85 / R62-R66 | as 5 regras vinculantes | §13 |
| spec §9 Q2 (assimetria `journal-entry`) | fechada junto ao 5º kind | §9/D7 |
| spec §9 Q5 (doc "4 kinds") | atualizado para 5 | §9/D7 |
| **Achados novos deste gate** | N1 (GAP-2 tools-vazias → recusa), N2 (`describeRefusal` privado → export) | §1.2, §4/D2, §5/D3 |

---

## 16. Grounding (biblioteca) — consultas desta sessão

Rodadas via `cdt library "<pergunta>" --gate 4` a partir de `C:\development\source\projects\conductor` (backend
saudável, 2291 chunks). **Cobertura honesta:** duas citações **moderadas e diretamente no alvo** (dependency
rule; falha rotineira como variante tipada); o resto **moderado (0.55-0.61)**, reportado como tal — o padrão já
estabelecido nas Fases 5-9 para tópicos de orquestração agent-native que o corpus (majoritariamente
arquitetura/engenharia geral) não cobre em profundidade. Nada foi forçado.

1. **Compor sobre um adapter existente vs. introduzir uma segunda porta/abstração** → **Architecture Boundaries
   and the Dependency Rule §2.12 "When not to use ports and adapters"** (0.609) + **Object-Oriented Thinking
   §3.12** (0.577/0.596: variantes fechadas por uma fonte externa). Base de §1.3 item 4, D6 (compor sobre
   `createGovernedChildSessionSpawner`) e D7 (5º kind aditivo).
2. **Campo de segurança impossível de omitir/afrouxar; esconder a decisão num módulo profundo** → **Managing
   Software Complexity §3.1/§3.10/§3.12** (0.555/0.558/0.595: information hiding; "defining errors out of
   existence" como anti-padrão; "some callers act differently on the error"). Base de D5 (builder) e D9
   (`budget-exceeded` distinto de `needs-human`).
3. **Falha rotineira degrada para uma variante tipada, não um throw** → **Writing Maintainable Code §4.12 "When
   not to apply the three habits"** (0.604: *"a Result type / an explicit variant"*). Base de D1
   (`GateDelegationOutcome`) e D9.
4. **Herdadas do Gate 2/3 desta demanda, não re-consultadas** (a decisão de grounding já está no registro
   daqueles gates): **Prompt Engineering PPP §9.2** (0.706, prompt-injection/confused-deputy — D4/R62); **Context
   Engineering §3.6/§13.7** (0.61, janela por-chamada vs. orçamento do run — D8/BR-6); **Specification by Example
   §3.3 + PPP §5.6** (evidência exige execução real — D7/R64); **Security Engineering §2.2** (secure-by-default /
   fail-safe — §1.3 itens 1/3).
5. **Declarado FRACO/fora do alvo, não forçado:** "seleção determinística de um líder entre candidatos já
   ordenados" (herdado do Gate 2, top ~0.59) e "reuso de porta para um 2º propósito" (top ~0.58) — fundamentados
   no precedente de código deste monorepo (`BUILTIN_GATE_ROLES` como a ordem já decidida pelo `flow.md`; a porta
   única de `createCliModelResolutionPort`), não em citação fabricada.

---

## Registro no diário

`cdt journal add --gate 4 --kind decision` a partir de `C:\development\source\projects\conductor`, ao final desta
sessão: ADR 0010 fechado (proposto), 9 decisões (D1-D9), 2 achados novos de leitura de código (N1: GAP-2 torna o
papel-líder tools-vazias → delegação recusa fail-closed, "fiada mas inerte até GAP-2", paralelo honesto ao ADR
0009 §20; N2: `describeRefusal` privado → exportação aditiva para satisfizer FR-2b), reconciliação R62-R66
confirmada sem retorno ao Gate 3, 4 SLOs + 10 invariantes de error-budget zero. Fecha o §20 do ADR 0009
(`context-limit` produzido por-chamada). Assimetria pré-existente `journal-entry` (§9 Q2) fechada junto ao 5º
kind para não criar uma terceira.
