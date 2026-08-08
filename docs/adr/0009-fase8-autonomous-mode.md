# ADR 0009 — Fase 8 (Autonomous mode): `conductor auto` é um **orquestrador fino** que compõe a superfície `gate *` já travada e **nunca** um segundo mutador de estado nem um segundo caminho de sign-off — a classificação de risco é uma decisão de autorização **determinística e reject-only** cuja aceitação nunca é a defesa final, o sink de sign-off é endurecido em **duas camadas independentes** (injeção do canal único + testemunha de TTY cruzada no mint), o secret-scan pré-push **reusa o matcher único da Fase 6** contra o diff staged, e todo estado de nível-de-run (qual condição de parada disparou, o ponteiro de retomada) vive **fora do enum travado** de `GateStatus`, num checkpoint por-máquina protected-path que é **dica, nunca evidência**

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-08
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 8 — Autonomous mode` (`plano_desenvolvimento.md` linhas 1431-1454, lidas junto com §4.8
  "Modos de execução", linhas 577-592, e §4.7 "Estado persistido", linhas 507-528), branch
  `feature/fase8-autonomous-mode` (de `develop`)
- **Autor (papel):** `software-architect`
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças criam um ADR sucessor, não editam este. **Este ADR NÃO
  supersede nenhum ADR anterior.** Da Fase 4 (ADR 0005) nada é reaberto: `GateState`, `GateRecord`,
  `GateStatus`, `Approval`, `ApprovalMeta`, `evaluateAdvance`, `evaluateCalibration`, `isMandatorySatisfied`,
  `mintHumanApproval`, `mintAutoApproval` e `MANDATORY_GATES` permanecem **literalmente** como estão. Da
  Fase 3 (ADR 0004) `SharedBudget`/`createSharedBudget` permanecem intocados. Da Fase 7 (ADR 0008)
  `resolveModelForGate`/`evaluateModelPrecondition`/`GateModelRole` são **reusados sem segunda lógica**. A
  Fase 8 **compõe ao lado** desses contratos, no adaptador de CLI (`@conductor/cli`) que a própria Fase 4
  estabeleceu como ponto de composição — e as **duas** adições a código herdado que declara (uma linha em
  `defaultProtectedPaths()`; uma extensão guardada ao seam CLI-local `GateStateStoreView`, **nunca** a um
  tipo travado do runtime) são declaradas explicitamente em §14.

- **Hipótese sob teste (H-Fase8, do cabeçalho da spec do Gate 2):** *`conductor auto` deve ser um
  orquestrador **fino** que só chama a superfície já existente (`gate start/evidence/approve/reject/calibrate`
  + `resolveModelForGate`/`SharedBudget`) — nunca uma segunda camada de decisão paralela.* **Falsificador
  explícito:** se a implementação precisar de um **segundo caminho de aprovação fora de `confirmOrDeny`** ou
  de um **segundo mutador de `GateState` fora dos comandos `gate *`**, a hipótese cai e a demanda reabre o
  Gate 4/ADR 0005. **Este ADR RATIFICA H-Fase8** (D1) — e §1.1 declara em voz alta o único ponto onde a
  ratificação exigiu ler o código com cuidado para não a falsificar por acidente (o achado N1).

- **Insumo herdado (código aberto e lido nesta sessão, não presumido):**
  - **ADR 0005 §6/§18** (Fase 4) — a máquina de gates travada; o mint de `Approval{method:"human"}` **só** via
    `mintHumanApproval` a partir de um `confirmResult` que veio do canal único (R22); `mintAutoApproval`
    (`method:"auto"`) já existe e sua própria doc diz que é *"used exclusively to record an autonomous,
    low-risk approval of a **non-mandatory** gate ... A mandatory gate reached by the autonomous loop MUST
    NEVER call this function: FR-11 requires recording `status:"needs-human"` instead"* — a Fase 4
    **antecipou** o chamador desta fase.
  - **ADR 0008 D4/D11** (Fase 7) — `evaluateModelPrecondition` imposto na abertura de gate, **incondicional**
    a partir do composition root (nunca atrás de um campo opcional), com `MANDATORY_GATES` injetado, nunca um
    literal; o precedente direto de "todo evento novo de orquestração fica **fora** do enum travado".
  - **Substrato lido verbatim:** `packages/conductor-cli/src/commands/gate.ts` (`GateStateStoreView`,
    `ConfirmChannel`, `runGateApprove`, `runGateCalibrate`, `resolveTargetGate` — a superfície inteira que
    `conductor auto` compõe); `gate-store.ts` (`createPersistedGateStateStore`, os cinco métodos mutantes por
    `store.mutate`, `approve()` chamando **só** `mintHumanApproval`, a pré-condição de modelo já ligada);
    `packages/conductor-runtime/src/gate-approval.ts` (`mintHumanApproval`/`mintAutoApproval`/
    `isGenuineHumanApproval`, o brand `HUMAN_MINT`); `confirm.ts` (`confirmOrDeny`, `!hasUI → false`);
    `tty-confirm.ts` (`resolveConfirmChannel`/`createTtyConfirmChannel`/`headlessConfirmChannel` — TTY em
    ambos stdin+stdout → canal real, senão headless); `shared-budget.ts` (`createSharedBudget`, `reserve`
    síncrono, `BudgetExhaustedError`); `workspace-policy.ts` (`defaultProtectedPaths`, `isWithinRoot`);
    `cli.ts:393-680/730-790` (o composition root de `runGateCommand`, a injeção de `resolveConfirmChannel(io.tty)`
    e de `createGateModelResolutionPort`, e o `switch` de `runCli`); `commands/model-context.ts`
    (`createGateModelResolutionPort`); `packages/conductor-secrets/src/index.ts` (`findSecretSpans`,
    `SecretSpan`, `redactSecrets` — a fonte única de "o que parece um segredo", Fase 6).
  - **Gate 2 spec Fase 8** (`docs/conductor/gate2-spec-fase8.md`, versão corrente, já emendada com FR-3b/4b,
    FR-18b, BR-5 estendida, FR-22 estrutural) — 25 FR (grupos A-H), 10 BR, 9 edge cases, 8 goals, 8 questões
    abertas (§9) roteadas para este gate.
  - **Gate 3 addendum Fase 8** (`docs/conductor/gate3-addendum-fase8.md`) — 7 ameaças (T74-T80), as **7 regras
    vinculantes R55-R61** (§4), os secure-defaults 66-72, a resolução da §9.1 (protected-path do checkpoint)
    e a dimensão de segurança da §9.2 (piso mandatório vence). **É o insumo vinculante desta fase** — este ADR
    **materializa** R55-R61 em TypeScript, **nunca as viola**.

- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, `CLAUDE.md` Gate 4):** §12 reconcilia ponto a ponto com
  R55-R61; §13 fecha as 8 questões abertas da spec; §15 avalia cada decisão contra a exigência de retorno ao
  Gate 3 e conclui — como o Gate 3 §8 previu — que **nenhuma superfície nova de confiança é aberta** (a Fase 8
  não cria provedor, processo, daemon ou sink de rede novo; ela remove o humano do laço sobre superfícies que
  já existem). O único achado deste gate (N1, §1.1) é uma **omissão de fiação** num primitivo que a Fase 4 já
  construiu, não uma fronteira nova.

---

## 1. Contexto

### 1.1 O achado que a ratificação de H-Fase8 exigiu ler o código para não falsificar por acidente

Antes de qualquer decisão: ratificar "orquestrador fino que só compõe `gate *`" pressupõe que **toda** ação
que `conductor auto` precisa realizar já tem um caminho na superfície existente. A leitura do código encontra
**um** ponto onde isso é quase — mas não exatamente — verdade, e nomeá-lo é parte do trabalho deste gate.

| # | A suposição | O que o código diz | Consequência de desenho |
|---|---|---|---|
| **N1** | `conductor auto` aprova gates técnicos de baixo risco com `method:"auto"` "pela superfície `gate *` já existente" (spec Grupo A, glossário "Decisão auto-aprovada"). | `GateStateStoreView.approve` (`gate-store.ts:287-343`) chama **só** `mintHumanApproval` — produz `method:"human"` ou `needs-human`, **nunca** `method:"auto"`. `mintAutoApproval` (`gate-approval.ts:141`) **existe e é testado**, mas **não tem nenhum call-site** — `gate-store.ts` sequer o importa. O caminho de auto-aprovação de gate está **construído no runtime e desfiado na CLI**. | `conductor auto` precisa **ligar** `mintAutoApproval` no adaptador CLI-local — compondo `store.mutate` (o mesmo mutador) + o primitivo `mintAutoApproval` (o mesmo que a Fase 4 criou **para este chamador**), **guardado por `MANDATORY_GATES`** para que um gate obrigatório **nunca** seja auto-cunhado. **É extensão do seam CLI-local, não um segundo mutador nem um caminho de `method:"human"` — H-Fase8 se mantém (D1/§3.3). Mas é fiação nova, e é declarada (§14).** |

**Por que N1 não falsifica H-Fase8.** O falsificador tem duas metades, e N1 não toca nenhuma: (i) *"segundo
caminho de aprovação fora de `confirmOrDeny`"* — o falsificador protege o mint de **`method:"human"`**;
`mintAutoApproval` produz `method:"auto"`, que **por invariante** (`BR-7`/`isGenuineHumanApproval`, o brand
`HUMAN_MINT`) é estruturalmente distinguível de um sign-off humano e **nunca** conta como um. Ligá-lo não cria
um segundo caminho de sign-off; cria o **primeiro** call-site do caminho de auto-decisão que a Fase 4 já
declarou pertencer "exclusivamente ao laço autônomo". (ii) *"segundo mutador de `GateState` fora dos comandos
`gate *`"* — a auto-aprovação passa por `store.mutate` (o **mesmo** `GateStateStore`, o mesmo envelope,
checksum e lock) e é exposta como uma extensão do **mesmo** `GateStateStoreView` (o seam CLI-local do
`gate approve`), guardada por `MANDATORY_GATES`. Não há segundo mutador. **N1 é o achado, não a falsificação.**

### 1.2 O fato dominante herdado, e a torção da Fase 8

O fato dominante das Fases 0-7 continua: **um único processo de SO, sem sandbox, com o privilégio do usuário;
toda garantia é política dentro de um processo confiado.**

A torção que o Gate 3 nomeou (§0 do addendum) e que organiza este ADR: **`/cdt` tinha um humano em cada gate —
o checkpoint por gate *era* o controle. `conductor auto` remove esse humano** e o substitui por (a) uma
classificação de risco na entrada, (b) auto-aprovação de decisões técnicas de baixo risco, e (c) uma parada
estrutural em sign-offs. A segurança da fase reduz-se a **três perguntas**, e as três já foram respondidas
**em semântica** pelo Gate 3 — este gate escolhe o **mecanismo** sem reabrir a semântica:

1. **A classificação de risco é uma decisão de autorização sobre input não-confiável** (a string de demanda; no
   `/cdt-triage`, derivada de repo não-auditado). O mecanismo tem que ser **reject-only e fail-closed**, e a
   aceitação **nunca** a defesa final (D4/R55).
2. **O sink de sign-off tem que ser estruturalmente não-forjável, não convencionalmente** (D3/R56).
3. **O orquestrador tem autoridade permanente, ambiente, não-atendida** — o oposto de least-privilege. Contê-la
   é **compor sobre a superfície existente** (não ganhar porta lateral), escopar por-run, e tornar toda
   auto-decisão detectável no audit trail + diário (D1/R57).

### 1.3 Atributos de qualidade priorizados para esta decisão

Ordenados. A ordem **é** a decisão; resolve os empates abaixo.

1. **Não-fabricação de sign-off.** Nenhum `Approval{method:"human"}` existe sem um confirm humano real. Vence
   conveniência, vence "fazer o laço avançar", vence "o canal certo foi injetado" (por isso duas camadas, D3).
2. **A classificação nunca autoriza um merge.** "Baixo risco" compra um **run autônomo até o primeiro gate
   mandatório**, nunca um merge não-revisado. O piso `{3,5,7,8,9}` sobre o diff real é a camada decisiva; a
   classificação é a primeira de várias, nunca a última (D4).
3. **Contenção do blast radius não-atendido.** O orquestrador só alcança o que `gate *` + o protocolo git do
   `/cdt` já autorizam; nenhum segundo mutador, nenhum protected-path novo alcançável, escopo por-run (D1/D8).
4. **Fail-closed em toda condição de parada e de retomada.** Contexto, orçamento, sign-off, checkpoint
   ausente/corrompido/adulterado, descompasso com o `GateState` — todos colapsam para "para com segurança" ou
   "re-deriva do autoritativo", nunca para "prossiga cegamente" (D2/D6/D7).
5. **Baixa complexidade acidental (Ousterhout).** Nenhum daemon, nenhum backend Docker, nenhum poller, nenhum
   segundo canal de confirmação, nenhum segundo contador de orçamento, nenhum segundo motor de detecção de
   segredo, nenhum valor novo no enum travado. Reuso do que já existe — inclusive do primitivo que a Fase 4
   deixou pronto e desfiado (N1).

*Grounding:* **The Practice of Architecting §2.2/§2.8/§2.12** (0.734/0.730/0.716 nesta sessão — a forma e o
critério de o que é decisão arquitetural registrável) para a disciplina do documento; **Object-Oriented Design
Patterns §1.12 "When not to reach for a pattern"** (0.550: *"a pattern buys the freedom to absorb a change...
where the change never comes, the indirection is pure cost"*) e **Object-Oriented Thinking §2.12 "When not to
hide behind an interface"** (0.550: *"one implementation and no second in sight... an interface that is a
transcript of it"*) para o item 5 — a razão de **não** construir um segundo mutador/abstração onde o único
mutador (`store.mutate`) já existe; **Security Engineering Principles §1.5/§2.2** (herdado do Gate 3, 0.639:
defesa em profundidade e secure-by-default) para os itens 1-4.

---

## 2. Decisão central, e o mapa D1-D8

**`conductor auto` é uma máquina de estados de processo CLI que compõe a superfície `gate *` já travada — um
orquestrador central que dirige os passos sem nunca virar um segundo mutador nem um segundo caminho de
sign-off. A classificação de risco decide apenas se o run pode COMEÇAR sem supervisão; a máquina de sign-off
por-gate, endurecida em duas camadas, decide se cada gate pode AVANÇAR; e o piso mandatório `{3,5,7,8,9}` sobre
o diff real é a garantia de que nada aterrissa sem um humano — independentemente de quão "baixo risco" a entrada
pareceu.**

Tudo o mais decorre disso. As oito decisões, uma por questão aberta que o Gate 3/spec devolveu:

| # | Decisão | Fecha / responde |
|---|---|---|
| **D1** | **`conductor auto` vive como adição fina a `@conductor/cli`** (`commands/auto.ts` + um `case "auto"` no `runCli`), compondo `runGateStart`/`runGateApprove`/`runGateReject`/`runGateCalibrate` sobre a **mesma** `GateStateStoreView` persistida. H-Fase8 **ratificada**; o único fio novo é ligar `mintAutoApproval` (N1), guardado por `MANDATORY_GATES` | spec §9.5, H-Fase8, **N1** |
| **D2** | **O run checkpoint vive em `.conductor/auto/<slug>.continue.json`** (não `.cdt/auto/` — corrige um literal da spec herdado do `cdt-auto.md` do conductor-**py**; neste rewrite todo estado de governança vive sob `.conductor/`) e **entra em `defaultProtectedPaths()`** (uma linha) | spec §9.1, Gate 3 §9.1/secure-default 72, **R59** |
| **D3** | **Sink de sign-off em duas camadas independentes:** (1) `conductor auto` **recebe por injeção** o canal de `resolveConfirmChannel(io.tty)` do composition root único e chama o **mesmo** `runGateApprove` — nunca constrói um `ConfirmChannel`; (2) o mint cruza uma **testemunha de interatividade** independente, de modo que `confirmResult === true ∧ ¬interactive ⇒ needs-human` — fabricar um sign-off exige **duas** falhas independentes | spec §9 (Grupo H), Gate 3 **T75/R56** |
| **D4** | **Classificação = veto estático determinístico (reject-only) + autorização por asserção explícita (fail-closed), NUNCA um model call sobre input hostil.** O veto casa demanda-string (no intake) **E** diff/caminho (a cada fronteira de gate); a aceitação exige `--risk=low` explícito (`method:"human"`) ou uma regra estreita, jamais o palpite de um classificador probabilístico | spec §9.4, Gate 3 **T74/R55**, FR-3/3b/4/4b/5 |
| **D5** | **Secret-scan pré-push reusa `findSecretSpans` (`@conductor/secrets`)** — o matcher único da Fase 6 — sobre o texto do diff staged; span detectado ⇒ **bloqueia o push**, vira `needs-human`. Nenhum `gitleaks`/`trivy` externo é assumido (não está fiado no repo); defesa em profundidade com o scan do CI (Gate 7), não em vez dele | spec §9 (FR-18b), Gate 3 **T77/R58** |
| **D6** | **`budget-exceeded` é a 4ª condição de parada, estruturalmente distinta de `needs-human`.** `GateState`/`GateStatus` **não mudam** (precedente ADR 0008 D4); o motivo da parada é um `RunStopReason` **em `@conductor/cli`**, registrado no run checkpoint + como `Decision` no diário — nunca um valor novo no enum travado | spec §9.3, Gate 3 **R60**, FR-16 |
| **D7** | **Reconciliação piso-mandatório × "Gates 1-8":** o loop avança pelos gates **aplicáveis** (mesma calibração de `/cdt`, `evaluateCalibration`/`MANDATORY_GATES`) enquanto cada aprovação tiver sucesso; um gate obrigatório headless resolve `needs-human` e **para**. Comporta-se identicamente diga o plano "Gates 1-8" ou não, porque aplicabilidade é **computada**, não hardcoded | spec §9.2, Gate 3 §9.2, **R24/R55** |
| **D8** | **`--budget` default = `2_000_000` tokens** (env-overridable `CONDUCTOR_AUTO_TOKEN_BUDGET`, sintonizável no Gate 11 — nunca "sem teto"); **veto sequencing: a demanda vetada recusa ANTES de criar branch ou `GateState`** — o único artefato é a `Decision` de classificação no diário | spec §9.7/§9.8, **R60** |

---

## 3. D1 — Onde `conductor auto` vive: adição fina a `@conductor/cli`, H-Fase8 ratificada

### 3.1 A decisão

`conductor auto` é uma **máquina de estados de processo CLI**, não um serviço nem um pacote novo. Vive em:

| Peça | Onde | Por quê |
|---|---|---|
| O verbo | um `case "auto":` novo no `switch` de `runCli` (`cli.ts:734`), ao lado de `gate`/`chat`/`login` | Mesmo composition root que já constrói a `GateStateStoreView` persistida, a porta de modelo e `resolveConfirmChannel(io.tty)` |
| O loop | `commands/auto.ts` novo — `runAuto(options)`, uma função que sequencia os gates aplicáveis | Módulo profundo, interface estreita: recebe colaboradores **já construídos** (store, confirm, budget, classificador, secret-scan), **nunca** os constrói |
| O motor de trabalho por gate | **os mesmos subagentes de papel que `/cdt` invoca** (Task tool), inalterados | A delegação de trabalho substantivo continua **agentic**; a Fase 8 move só o **sequenciamento** de prosa (`cdt-auto.md`) para código determinístico |

**Nenhum pacote novo.** A feature matrix da Fase 0 pode ter imaginado `extensions/orchestrator`; a convenção
real é `conductor-*`, e um `@conductor/auto` esconderia **zero** profundidade nova atrás de uma interface —
seria mover arquivos, não ocultar informação. O orquestrador é código do **mesmo processo confiado**, sem
estado durável próprio além do run checkpoint (cujo path já herda o protected-path de `.conductor/`, D2).

*Grounding:* **Distributed Architecture Decisions §3.4 "orchestration vs. choreography"** (0.548: *"a
coordinator service drives the steps; orchestration = central control, easy to see the flow"*) — a escolha
deliberada de **orquestração** (um coordenador central que dirige `gate *`) sobre coreografia (gates reagindo a
eventos), porque a auditabilidade "easy to see the flow" **é** o atributo #3; **Object-Oriented Design Patterns
§1.12** e **Object-Oriented Thinking §2.12** (ambos 0.550, §1.3) — a razão de não introduzir um pacote/mutador
novo onde `store.mutate` já é o único. Precedente interno mais forte que a citação: ADR 0006/0007/0008 só
criaram pacote novo (`@conductor/library`, `@conductor/providers`) quando havia profundidade real (motor de
RAG, motor de resolução) a esconder — o orquestrador não tem.

### 3.2 O loop, precisamente (compõe, nunca reimplementa)

```
runAuto(demanda, flags, io):
  1. classificar risco (D4) — veto estático + asserção explícita
       vetado OU incerto → registrar Decision, SAIR (sem branch, sem GateState — D8)
  2. abrir branch feature/<slug> de develop; construir SharedBudget(budget) UMA vez (D8)
  3. calibração de profundidade → gate calibrate (method:"auto") — a MESMA superfície (FR-2)
  4. para cada gate G aplicável, em ordem (D7):
       a. re-avaliar o veto sobre o diff materializado (D4/FR-3b) → match → needs-human, parar
       b. runGateStart(G)  — evaluateModelPrecondition já embutido (ADR 0008 D4); recusa → parar (FR-21)
       c. delegar trabalho aos subagentes de papel (Task); anexar evidência via runGateEvidence
       d. secret-scan pré-push do diff do gate (D5) → span → needs-human, parar
       e. commit "gate <G>: <resumo>" escopado ao diff (FR-18/19)
       f. APROVAR:
            G ∈ MANDATORY_GATES  → runGateApprove(confirm injetado) → headless resolve false → needs-human, PARAR
            G ∉ MANDATORY_GATES  → approveAuto(G) [N1: mintAutoApproval, guardado por MANDATORY_GATES]
       g. push da branch (após o secret-scan de (d) passar)
       h. checar condições de parada (D6): contexto ~90% | budget-exceeded → checkpoint + parar
  5. todos os aplicáveis aprovados → land em develop (merge/PR) → status "landed"
```

Cada passo com nome de comando é **literalmente** a função de `commands/gate.ts` que o `gate *` manual já
chama. O único passo que não tinha função pronta é (f) no ramo não-mandatório — o achado N1.

---

## 4. D2 — O path do run checkpoint: `.conductor/auto/`, protected

### 4.1 A decisão de path

**`.conductor/auto/<slug>.continue.json`**, **não** `.cdt/auto/`. A spec (FR-9/glossário) e o Gate 3 herdaram
`.cdt/auto/` do `cdt-auto.md`, que é um arquivo de **prompt do Conductor-py** (onde `.cdt/` é a convenção do
CLI Python). **Neste rewrite TypeScript, `.cdt/` não existe** — todo estado de governança do runtime vive sob
`.conductor/` (`config.json`, `gates/`, `audit.jsonl`, `providers/`, `policy.json`). Pôr o checkpoint sob
`.conductor/auto/` é o path **consistente**, e o Gate 3 §9.1 já o recomendou explicitamente ("todo o resto do
estado de governança vive sob `.conductor/`"). **Isto é uma correção declarada de um literal da spec (FR-9),
um loop-back menor ao Gate 2, sem consequência de comportamento** — o schema e o modelo de confiança (BR-5)
ficam idênticos; só o diretório muda.

### 4.2 A decisão de proteção (fecha spec §9.1)

**`.conductor/auto/` entra em `defaultProtectedPaths()`** — no ramo `workspaceRoot`, uma linha
(`join(workspaceRoot, ".conductor", "auto")`), ao lado de `.conductor/gates`. Ratifica o Gate 3 §9.1
integralmente: o controle **primário** é BR-5/R59 (o checkpoint é dica, sempre re-derivado do `GateState`
autoritativo — a reverificação de §8.2/FR-7); o protected-path é a **segunda camada independente** que
sobrevive a um esquecimento futuro de R59: mesmo que uma fiação de `--continue` volte a confiar num campo, o
arquivo **não pôde ser adulterado por um subagente sob prompt-injection** em primeiro lugar. O run checkpoint é
estado de governança de orquestração da **mesma família** que `gates/`/`audit.jsonl`; deixá-lo gravável seria
uma **inconsistência na deny-list**, e fechá-la custa uma linha.

**A proteção não atrapalha o orquestrador.** Como o `gate *` escreve `.conductor/gates/` (protegido) por um
caminho dedicado que **não** passa por `pi.on("tool_call")`, o escritor do checkpoint é igualmente um caminho
dedicado do orquestrador — ele escreve livremente; só os **tools dos subagentes** são negados, que é
exatamente o correto (um subagente não tem razão legítima para escrever o run checkpoint).

*Grounding:* **Security Engineering Principles §1.5** (herdado do Gate 3, 0.639: defesa em profundidade em
camadas independentes). Precedente de código: a própria doc de `defaultProtectedPaths()` (`workspace-policy.ts:94-147`)
já articula o raciocínio confused-deputy para os seis irmãos deste caminho.

---

## 5. D3 — O sink de sign-off: duas camadas independentes (fecha Grupo H / T75 / R56)

### 5.1 A ameaça, reafirmada com o código na mão

`ConfirmChannel = (title, message) => Promise<boolean>` é um **tipo de função nu** (`gate.ts:182`).
`runGateApprove` (`gate.ts:184-198`) aceita **qualquer** canal e entrega o booleano a `store.approve`, que
cunha via `mintHumanApproval`. A garantia de hoje é **convencional**: nada no tipo impede
`const evil: ConfirmChannel = async () => true`. `conductor auto` é precisamente o novo chamador headless de
alto risco onde essa convenção seria a única coisa entre o laço e um sign-off fabricado. R56 exige converter
"expected" em "impossível por construção" — e o faz em **duas** camadas.

### 5.2 Camada 1 — o orquestrador nunca constrói o canal; recebe-o por injeção

O composition root (`runAuto` chamado por `cli.ts`, o **mesmo** ponto que constrói o canal para `gate approve`)
constrói `resolveConfirmChannel(io.tty)` **uma vez** e o passa a `runAuto`. `runAuto` chama o **mesmo**
`runGateApprove({ ..., confirm: <injetado> })` que o `case "gate"` já chama (`cli.ts:566`). Consequências:

- **`conductor auto` é headless por natureza:** num run não-atendido, `io.tty` é ausente ou não-TTY, então
  `resolveConfirmChannel` devolve `headlessConfirmChannel` (sempre `false`, `tty-confirm.ts:100/110-115`). Um
  gate obrigatório → `confirmResult === false` → `mintHumanApproval` devolve `null` → `needs-human` → o run
  para (FR-14). **Estruturalmente incapaz de cunhar `method:"human"`.**
- **Um literal `async () => true` no código do orquestrador é proibido por construção:** `runAuto` **não
  recebe** a liberdade de fabricar um canal — sua assinatura recebe um `ConfirmChannel` **já construído**
  (injeção), exatamente o padrão de `resolveConfirmChannel(io.tty)` que `gate approve`/`calibrate` já usam.
  Nenhum caminho de código em `commands/auto.ts` chama `resolveConfirmChannel` nem constrói um canal.

Isto **é** a ratificação de que não há "segundo caminho de aprovação" (o falsificador de H-Fase8): é o
**mesmo** `runGateApprove` → `store.approve` → `mintHumanApproval`, o mesmo sole-mint que
`gate-approval-sole-mint.test.ts` já trava por scan estático.

### 5.3 Camada 2 — o mint cruza uma testemunha de interatividade independente

Camada 1 depende de "o canal certo foi injetado". Camada 2 remove essa dependência: **mesmo que um `true`
sintético chegue ao ponto de mint por algum bug de fiação, o mint não cunha `method:"human"` num processo sem
interatividade.**

O ponto exato, **sem tocar nenhum tipo travado do ADR 0005:** `mintHumanApproval(confirmResult, meta)` e
`ApprovalMeta` permanecem literais. A testemunha entra no **caminho de mint CLI-local** — o método `approve()`
de `GateStateStoreView` (`gate.ts`/`gate-store.ts`, um seam de `@conductor/cli`, descrito no próprio código
como "CLI-LOCAL placeholder", **não** um contrato do runtime). `approve()` passa a receber um
`isInteractive: () => boolean` injetado (default de produção `() => Boolean(process.stdin.isTTY &&
process.stdout.isTTY)`; seam de teste sobreponível — a **mesma** disciplina de injeção que
`createGateModelResolutionPort`/`resolveConfirmChannel(io.tty)` já usam) e computa:

```
confirmResult === true  ∧  isInteractive() === false   ⇒   NÃO cunha; registra needs-human
                                                            (o mesmo ramo que mintHumanApproval === null já tem)
```

- **Independência real:** a testemunha lê o TTY do **processo** (`process.std*.isTTY`, o runtime do Node),
  por um caminho de código **distinto** do canal injetado (`io.tty`, o seam de teste). Para forjar um
  sign-off, um atacante precisa de **duas** falhas separadas: (a) injetar um canal sintético `true`
  (burlar a disciplina da Camada 1) **E** (b) spoofar a testemunha de TTY no ponto de mint. Uma única linha
  de fiação errada (`confirm: async () => true`) **não** também spoofa `isTTY` — o mint recusa, e o gate cai
  para `needs-human`. *(Honestidade, no molde do ADR 0008: em produção ambos derivam, em última instância,
  dos mesmos file descriptors; a independência é entre os **atos de forjar** — burlar a injeção vs. spoofar a
  testemunha — não entre duas fontes de entropia. É defesa em profundidade genuína, não uma prova de
  impossibilidade absoluta, exatamente como o brand `HUMAN_MINT` já se declara honestamente contornável por um
  `as unknown as Approval` deliberado e grepável.)*
- **Zero regressão no `gate approve` interativo:** TTY real → canal real → humano responde `y` →
  `confirmResult === true ∧ isInteractive() === true` → cunha, como hoje. Headless piped → canal `false` →
  Camada 2 é no-op (o `confirmResult` já é `false`). Camada 2 **só** adiciona a recusa nova para o caso
  patológico "true sem interatividade", que hoje só um bug/injeção produz.

*Grounding:* **herdado e re-confirmado** — a base é o grounding já registrado pelo ADR 0005 §6 (Building Secure
and Reliable Systems §3.3/§3.8, "sensitive actions require multi-party authorization"; Security Engineering
Principles §2.9/§2.12, "uncertainty deny; an error must never read as permission"), re-confirmado nesta rodada
por **Security Engineering §2.2** (0.603, secure-by-default / fail-safe). Precedente de código:
`gate-approval.ts` (`mintHumanApproval`/`HUMAN_MINT`/`isGenuineHumanApproval`), `confirm.ts` (`!hasUI → false`),
`task-child-gate-canary.test.ts`. **Alvo nomeado do Gate 9 desta demanda (FR-23):** este ADR entrega a
superfície que o Gate 9 vai atacar (T75).

---

## 6. D4 — A classificação de risco: determinística, reject-only, e nunca a defesa final (fecha T74 / R55)

### 6.1 O achado que fixa o mecanismo

`conductor auto "melhorar como o sistema lembra de quem é a pessoa entre visitas"` **é** autenticação sem
conter nenhuma keyword do veto. Um veto de keyword/pattern sobre linguagem natural é uma **blocklist sobre
input hostil** — o anti-padrão de Dowd/Secure Code Review §1.2: **decide bem o lado rejeitar, nunca o lado
aceitar.** Toda a mecânica de D4 existe para que "não-casou" **jamais** vire "logo, baixo risco".

### 6.2 A decisão: duas peças, nenhuma delas um model call sobre a demanda

**Peça 1 — o veto estático (REJECT-ONLY, determinístico, testável).** Uma função pura sobre dois insumos:

| Momento | Insumo | O que checa |
|---|---|---|
| **Intake** (antes do Gate 1) | a **demanda-string** | keyword-set `{auth, login, senha, credential, token, secret, oauth, PII, personal data, external API, ...}` — o mesmo piso mínimo do Gate 3 do `CLAUDE.md` |
| **A cada fronteira de gate** (FR-3b/4b) | o **diff materializado** — **peso maior que a descrição** | path-patterns `{**/auth*, **/*credential*, **/*.pem, **/.env*, **/secret*, ...}` **e** o conteúdo do diff. Um arquivo escrito em superfície sensível **re-dispara** o veto mesmo que a descrição tenha passado |

Um match ⇒ `needs-human`, nomeando o padrão casado. **Um não-match NUNCA produz "baixo risco"** — só remove
o veto. A recall alta no lado rejeitar é o objetivo (errar para "casou" é seguro).

**Peça 2 — a autorização para começar sem supervisão (fail-closed, POR ASSERÇÃO EXPLÍCITA — não por um
classificador probabilístico).** Um run só auto-começa se, **além** de passar o veto, houver uma **asserção
explícita e registrável** de baixo risco:

- `--risk=low` explícito → registrado como `method:"human"` (afirmado pelo operador, FR-5), **distinto** de
  qualquer auto-avaliação, e **nunca** sobrepõe o veto (BR-2); **ou**
- uma **regra estreita e determinística** de aplicabilidade (a mesma família do `/cdt-intake`: casa os sinais
  de "typo/config" ou "small bug < 50 LOC" com diff limitado) — uma decisão de código, testável.

Na **ausência** de asserção explícita, ou sob **qualquer** ambiguidade (escopo pouco claro, raio de impacto
incerto, descrição subespecificada) → `needs-human` **antes de abrir o Gate 1** (FR-4).

### 6.3 Por que NÃO um model call para a decisão de aceite

A tarefa pediu para decidir explicitamente: heurística determinística **ou** delegação a um subagente/role
para julgamento? **Decisão: heurística determinística. Um model call para a decisão que AUTORIZA o run é
rejeitado**, por três razões ANDadas:

1. **É um classificador sobre input hostil na porta da autorização.** Pedir a um modelo "isto é baixo risco?"
   sobre a string de demanda é dar a um classificador probabilístico o poder de autorizar — e a demanda pode
   conter prompt-injection dirigido a "baixo risco". É exatamente o anti-padrão T74/Secure Code Review §1.2 na
   sua forma mais aguda.
2. **R55 torna a classificação não-decisiva.** A camada que de fato impede o dano é o Gate 3/9 sobre o diff
   real (incolapsável, R24). Gastar um model call — e abrir a superfície de injeção — para uma decisão que
   **não é a defesa final** é custo sem benefício de segurança.
3. **Testabilidade (Gate 5).** Uma heurística determinística é testável RED/GREEN com fixtures; um julgamento
   de modelo é não-determinístico e não dá para travar em teste. FR-3/4/5 pedem comportamento observável, e
   observável exige determinismo aqui.

**Se** uma versão futura quiser assistência de modelo, ela deve ser **advisory-only** (nunca autorizante) e,
pelo precedente do ADR 0008, **reusar `resolveModelForGate`** no tier do Gate 1 (`@plan`) — **nunca** uma
seleção paralela. Mas isso é explicitamente **deferido** (non-goal); este ADR crava o piso seguro:
determinístico, explícito, default-deny.

*Grounding:* **forte, herdado do Gate 3** — Secure Code Review §1.2/§1.12/§2.2 (top 0.635, "assume inputs are
hostile"; "a blocklist decide bem o rejeitar, nunca o aceitar"; taint source→sink); **Prompt Engineering PPP
§13.5 "Router with Unclear Lane"** (herdado, "mandatory unclear route wired to a conservative handler or
human"). **Complemento fresco desta sessão** (cobertura moderada, reportada como tal): **Writing Maintainable
Code §4.12** (0.606: *"Not found / invalid input... a Result type / explicit variant"* — a classificação
devolve um **resultado tipado** com aceite/veto/incerto, nunca uma exceção que um chamador esquece de tratar);
**Messaging and Integration Patterns §2.12** (0.586: não decompor onde há uma decisão só — a razão de a
heurística ser uma função pura, não um subsistema). A metade "determinístico > model call para a autorização"
não tem citação forte no corpus (agent-native, fora do alvo do corpus de arquitetura); é fundamentada no
**precedente de código deste monorepo** (a disciplina fail-closed de `confirmOrDeny`/`SharedBudget.reserve`) e
no achado T74 lido no código — não numa citação fabricada.

---

## 7. D5 — Secret-scan pré-push: reusar o matcher único da Fase 6 (fecha T77 / R58 / FR-18b)

### 7.1 O achado que fixa o mecanismo

**Este repo NÃO tem `gitleaks`/`trivy` fiado em nenhum workflow de CI hoje** — é política aspiracional do
`CLAUDE.md` Gate 7, não implementação (confirmado: `grep -rli gitleaks|trivy` só acerta
`packages/conductor-secrets/src/matchers.ts`). Logo o secret-scan pré-push **não pode** assumir um binário
externo disponível. E a **redação de sinks da Fase 6** (`REDACTION_SINKS`) protege logs/transcript/diário —
**não** o working tree: um `.env` em disco nunca passa por um sink de redação; passa por `git add`. O passo é
**necessário e distinto**, e o mecanismo tem que ser **in-process**.

### 7.2 A decisão

`@conductor/secrets` **já é** a fonte única deste monorepo para "o que parece um segredo" (usado pela pipeline
de redação da Fase 6). O secret-scan pré-push **reusa `findSecretSpans`** (`matchers.ts:39`, exportado por
`index.ts`) — o **primitivo de detecção** (devolve `SecretSpan[]`, não redige) — sobre o **texto do diff
staged** do gate:

```
antes de qualquer push automático:
  const diffText = git diff --staged (o diff ESCOPADO ao gate — FR-18, nunca git add -A cego)
  const spans = findSecretSpans(diffText)
  spans.length > 0  ⇒  BLOQUEAR o push, run vira needs-human, nomear (arquivo:linha), NUNCA "empurra e conserta"
```

- **Fonte única, zero segundo motor.** Reusar `findSecretSpans` — não inventar um segundo detector nem shell
  para um `gitleaks` que pode não existir. É o mesmo matcher que a Fase 6 já usa; um segredo que a redação
  reconhece é um segredo que o pre-push reconhece — sem drift.
- **Fail-closed.** Se o `git diff` falhar ou o scan não puder rodar → tratar como **detectado** (bloquear,
  `needs-human`), nunca como "limpo". Incerteza nega.
- **Defesa em profundidade com o CI (Gate 7), não em vez dele.** Quando `gitleaks`/`trivy` forem fiados no
  pipeline, o pre-push in-process continua sendo a camada que roda **antes** de o segredo tocar o remote — o
  CI pega depois; o pre-push impede o egress irreversível.

*Grounding:* **forte, herdado do Gate 3** — Penetration Testing §14.9/§14.2/§14.5 (top 0.647, "no secrets in
any bundle"); Security Engineering Principles §1.5 (0.639, camadas independentes). **Fonte única:** Pragmatic
Programming Practices §1.4 (herdado da spec §8.2, "give each fact one home") — a razão de reusar o matcher, não
duplicá-lo. Cobertura fresca desta sessão para "reusar o matcher único vs. binário externo": **moderada-fraca**
(top 0.550, Object-Oriented Thinking §2.12, "uma implementação, sem segunda à vista"), reportada como tal e
apoiada no precedente de código (o matcher da Fase 6 é a fonte única já estabelecida).

---

## 8. D6 — `budget-exceeded` como 4ª condição de parada, fora do enum travado (fecha spec §9.3 / R60)

### 8.1 A decisão

As condições de parada de um run são **exaustivas e distintas**, e são **quatro**:

| `RunStopReason` | Gatilho | Registro |
|---|---|---|
| `context-limit` | uso de contexto cruza ~90% da janela, na fronteira de um gate concluído (FR-13, edge 7) | checkpoint + `Decision` + push |
| `needs-human` | gate obrigatório headless → `confirmOrDeny` false; ou classificação recusa; ou sign-off (FR-14) | checkpoint + `Decision` + push |
| `budget-exceeded` | `SharedBudget.reserve()` devolve `null` (FR-11/16) | checkpoint + `Decision` + push |
| `landed` | todos os gates aplicáveis aprovados; branch aterrissada em `develop` (FR-15) | nenhum checkpoint adicional |

**`budget-exceeded` NUNCA colapsa em `needs-human`** (FR-16): uma é **operacional** (recuperável via
`--continue` com mais orçamento), a outra é **autoridade humana** (exige um humano decidir). Um leitor do
diário precisa distingui-las sem reabrir o transcript. **"Terminar um gate" não é uma condição de parada**
(FR-17/BR-9): o run continua para o próximo gate aplicável na mesma invocação.

### 8.2 Onde o estado de run vive — fora do enum travado

`GateState`/`GateStatus` **não mudam** — precedente literal do ADR 0008 D4 ("todo evento novo de orquestração
fica fora do enum travado"). `RunStopReason` é um tipo **de `@conductor/cli`**, o pacote do orquestrador. O
estado de nível-de-run (qual condição parou, para qual run, o ponteiro de retomada) é registrado em **dois**
lugares, ambos já existentes por convenção:

1. **O run checkpoint** (`.conductor/auto/<slug>.continue.json`, D2) — o campo `stop_reason` além do schema já
   documentado (`last_gate`/`next_gate`/`demand_branch`/`depth_calibration`/`deferred_human_decisions`). É
   **dica** (BR-5), nunca autoritativo.
2. **O diário** (`cdt journal add --kind decision`, FR-6/FR-16) — a `Decision` auditável de que o run parou por
   `<reason>`, consultável sem reabrir o transcript.

O `GateState` continua sendo a **única** verdade sobre gates; o run-state é **derivado e observacional**,
exatamente a separação que o ADR 0008 D9 aplicou ao ledger de uso vs. `SharedBudget`.

*Grounding:* **Domain-Driven Design §4.2 "domain events and the model boundary"** (0.597 nesta sessão: *"wiring
those directly couples the aggregate to everything downstream"* — a razão de o evento de orquestração **não**
entrar no agregado `GateState`); **Prompt Engineering PPP §6.5 "Stop Conditions and Knowing When to Halt"**
(herdado da spec §8.4, "loops need unambiguous exit conditions, not implicit ones"). Precedente direto: ADR
0008 D4.

---

## 9. D7 — Piso mandatório × "Gates 1-8": a lógica de sequenciamento (fecha spec §9.2 / R24)

### 9.1 A reconciliação, já resolvida em princípio, agora formalizada

O critério de saída do plano diz literalmente "Gates 1-8" para baixo risco; o `CLAUDE.md` proíbe colapsar
`{3,5,7,8,9}` (que **inclui** o Gate 9). O Gate 3 §9.2 já resolveu a dimensão de segurança: **o piso mandatório
vence a prosa antiga** (código/regra vigente pesa mais que a frase anterior à formalização do never-collapse —
o mesmo padrão do ADR 0005 §4 para `{3,5,7,8}` vs. `{3,5,7,8,9}`). Este gate formaliza a **lógica de
sequenciamento** que o materializa:

- **Aplicabilidade é computada, não hardcoded.** Os gates que um run percorre vêm da **mesma** calibração que
  `/cdt` usa — `evaluateCalibration`/`MANDATORY_GATES` (`gate-store.ts:376-400`, `gate.ts` calibrate) — que
  **nunca** colapsa um obrigatório (R24, recusado no registro). `conductor auto` chama `gate calibrate` com
  `method:"auto"` (FR-2); a calibração resultante é a **mesma** que um humano veria.
- **O loop avança enquanto cada aprovação tiver sucesso.** Para um gate não-mandatório: `approveAuto` cunha
  `method:"auto"` (N1) e o loop segue. Para um gate obrigatório: `runGateApprove` headless → `confirmOrDeny`
  false → `needs-human` → **para** (a aprovação não "teve sucesso"). Logo:
  - o run **auto-avança** pelos não-mandatórios até o primeiro mandatório aplicável;
  - o Gate 9 (e todo obrigatório) é **estruturalmente inatingível sem `needs-human`** no headless (T75/R56);
  - o comportamento é **idêntico** diga o plano "Gates 1-8" ou não — porque a máquina nunca leu "8" nem "9";
    ela lê a calibração e o piso mandatório.
- **A leitura canônica de FR-15:** "no mínimo até o Gate 8, continuando por qualquer gate que a calibração
  exija, **nunca pulando `{3,5,7,8,9}`**".

Consequência prática (declarada, não escondida): para uma **Feature**, o run auto-conclui os não-mandatórios
iniciais e **para no primeiro mandatório** (tipicamente o Gate 3) como `needs-human` — que é exatamente o
backstop de T74 (a classificação compra "run autônomo até o primeiro mandatório", nunca "merge"). O humano
aprova o mandatório interativamente (`conductor gate approve`, TTY), e `--continue` retoma. Isto **é** o
desenho, não uma limitação acidental.

*Grounding:* precedente de regra vigente > prosa (ADR 0005 §4, herdado); **Measuring Software Delivery
Performance §2.3/§2.5** (herdado da spec §8.6: "small batches are safer" — substituir o checkpoint humano
por-gate por evidência mecânica + lotes pequenos melhora estabilidade **e** throughput, para os não-mandatórios).

---

## 10. D8 — `--budget` default e sequenciamento do veto (fecha spec §9.7 / §9.8)

### 10.1 O default de `--budget` (FR-12)

**Default = `2_000_000` tokens**, na constante `DEFAULT_AUTO_RUN_TOKEN_BUDGET`, **sobreponível** por
`CONDUCTOR_AUTO_TOKEN_BUDGET` (env) e pela flag `--budget`. Racional: um run de Feature multi-gate consome da
ordem de 10⁵-10⁶ tokens (cada chamada de modelo estima ~4 000, `DEFAULT_MODEL_CALL_TOKEN_ESTIMATE`, e um gate
tem dezenas de turnos de subagente); 2M é grande o bastante para um run substancial e **bounded** o bastante
para pegar um laço em fuga. **Omitir `--budget` NUNCA significa "sem teto"** (FR-12) — a mesma classe de risco
que o teto existe para evitar. O número é um **default declarado, não uma verdade descoberta**: candidato a
sintonia no Gate 11, exatamente como o ADR 0008 tratou cooldown/backoff/TTL.

*Grounding:* **Solution Architecture §2.12 "When not to gather requirements up front"** (herdado, 0.593 —
números "invented under pressure, then treated as constraints for the life of the system"; um número inventado
que não se pode corrigir é pior que nenhum, por isso env-overridable).

### 10.2 Sequenciamento do veto (spec §9.8): recusa ANTES de branch e `GateState`

**Uma demanda vetada recusa antes de criar qualquer branch OU `GateState`.** A classificação (D4) é o
**primeiro** passo de `runAuto`, antes de `git checkout -b`, antes de `gate start 1`. Uma demanda vetada
produz **exatamente um** artefato: a `Decision` de classificação de risco no diário (FR-6), nomeando o padrão
casado, e sai. Racional (a spec §9.8 confirma: sem consequência de segurança, ambas direções são fail-closed —
a escolha é de UX/auditabilidade):

- **Menor superfície e zero resíduo:** nada a limpar — nem branch órfã, nem envelope `GateState` vazio, nem
  checkpoint.
- **Auditabilidade limpa:** o registro é a `Decision`; uma branch/`GateState` pendente seria ruído que um
  leitor teria que reconciliar com "por que este run nunca começou?".
- **Simetria com FR-1:** a branch é criada **só** depois de a classificação passar, imediatamente antes de
  `gate start 1`.

---

## 11. SLIs / SLOs por componente (objetivo explícito do Gate 4)

Medidos/instrumentados no Gate 11; **definidos aqui**. Mesma distinção honesta do ADR 0007 §11/ADR 0008 §12:
um CLI single-user não tem um "continuously served request path", então só latências realmente observadas ao
longo do uso são SLOs; o resto são **invariantes com error-budget zero**, asseverados por teste no Gate 5/7 —
não estimados por amostragem.

| # | Componente | SLI | Alvo (candidato) | Tipo |
|---|---|---|---|---|
| 1 | Classificação | Latência do veto estático + heurística de aceite (pura, sem I/O) | p95 < **50 ms** | SLO |
| 2 | Secret-scan | Latência de `findSecretSpans` sobre o diff staged de um gate | p95 < **500 ms** | SLO |
| 3 | Retomada | Latência de `--continue` re-derivando `demand_branch`/`calibration`/pendentes do `GateState` | p95 < **300 ms** | SLO |
| 4 | Checkpoint | Latência de escrita do run checkpoint (fs local) | p95 < **50 ms** | SLO |
| 5 | Sign-off | `Approval{method:"human"}` que alcança um land/merge sem `isGenuineHumanApproval === true` | **0** | Invariante, error-budget 0 (T74/T75, o backstop) |
| 6 | Sign-off | `method:"human"` cunhado num processo sem testemunha de interatividade (`¬isInteractive`) | **0** | Invariante, error-budget 0 (R56/D3 camada 2) |
| 7 | Orquestrador | Mutação de `GateState` por qualquer caminho que não seja `store.mutate` (a superfície `gate *`) | **0** | Invariante, error-budget 0 (H-Fase8/R57) |
| 8 | Auto-aprovação | `mintAutoApproval` cunhado para um gate ∈ `MANDATORY_GATES` | **0** | Invariante, error-budget 0 (N1/R55) |
| 9 | Secret-scan | `git push` executado com ≥1 `SecretSpan` presente no diff staged | **0** | Invariante, error-budget 0 (R58/FR-18b) |
| 10 | Checkpoint | Escrita de estado de run (checkpoint) que bloqueia numa operação de rede | **0** | Invariante, error-budget 0 (o checkpoint é fs local puro) |
| 11 | Orçamento | Um segundo `SharedBudget` construído dentro de um run (evasão do teto) | **0** | Invariante, error-budget 0 (R60, erro de compilação por construção) |
| 12 | Parada | `budget-exceeded` colapsado em `needs-human` no motivo registrado | **0** | Invariante, error-budget 0 (FR-16) |
| 13 | Retomada | `--continue` avançar um gate pela palavra do checkpoint, sem re-derivar do `GateState` | **0** | Invariante, error-budget 0 (BR-5/R59/FR-7) |
| 14 | Checkpoint | Campo do run checkpoint escrito por um tool de subagente (protected-path) | **0** | Invariante, error-budget 0 (secure-default 72/§14) |
| 15 | Classificação | Um gate obrigatório colapsado pela classificação de risco | **0** | Invariante, error-budget 0 (R24/R55) |
| 16 | Egress | Fallback cross-provider automático no laço não-atendido sem consentimento registrado | **0** | Invariante, error-budget 0 (R61/T80, herdado da Fase 7) |
| 17 | Robustez | `budget-exceeded`/contexto/`needs-human` parando **graciosamente** (checkpoint+push), nunca um `BudgetExhaustedError` não-capturado como crash | **100 %** | Invariante (FR-11/BR-4) |

**Honestidade sobre a natureza destes números.** *Grounding:* **Site Reliability Engineering §1.12** (herdado,
ADR 0006/0007/0008, 0.661: SLOs pressupõem um request path servido continuamente com tráfego — um CLI
single-user não é isso) e **Software Architecture and Quality Attributes §2.12** (herdado, 0.563: *"no user can
perceive the target... the number becomes an acceptance test"* — a razão de 4 SLOs e 13 invariantes, não 17
SLOs). Só 1-4 são SLOs de verdade; 5-17 são invariantes asseverados por teste. O invariante #5 é o **backstop
inteiro da fase** — o que T74/T75 existem para garantir.

---

## 12. Reconciliação R55-R61 (o mandato do Gate 3 §4)

| Regra | Onde satisfeita | Status |
|---|---|---|
| **R55** (classificação reject-only + fail-closed + backstopped, nunca a defesa final) | §6 — veto estático reject-only (demanda + diff, diff pesa mais); aceite por asserção explícita, **não** por model call; a classificação nunca colapsa mandatório (§9); `--risk=low` = `method:"human"`, nunca sobrepõe o veto | **Confirmada** |
| **R56** (sink de sign-off estruturalmente não-forjável, duas camadas) | §5 — Camada 1: injeção do canal único, nunca construído pelo orquestrador; Camada 2: mint cruza a testemunha de interatividade independente; `mintHumanApproval`/`ApprovalMeta` **intocados** | **Confirmada** (via extensão do seam CLI-local, não de tipo travado) |
| **R57** (autoridade do orquestrador = superfície existente, escopada por-run, não ambiente) | §3 — compõe `gate *` (nunca 2º mutador; N1 é extensão guardada do mesmo seam), protocolo git do `/cdt` (nunca `main`/`develop` direto); protected-paths existentes contêm o blast radius; `SharedBudget` é o limite; toda parada/auto-decisão é `Decision` no diário + audit trail | **Confirmada**, com o residual herdado declarado (teto do processo confiado, T17/R1) |
| **R58** (secret-scan pré-push fail-closed próprio; commit escopado; branch autoritativa) | §7 — `findSecretSpans` sobre o diff staged, span ⇒ bloqueia push + `needs-human`; commit escopado ao gate (FR-18/19); branch de push = `GateState.branch` autoritativa (§9/R59) | **Confirmada**, e o achado "sem gitleaks fiado" é a razão de o mecanismo ser in-process |
| **R59** (BR-5 estende a TODOS os campos do checkpoint) | §4/§8.2 — `demand_branch`/`depth_calibration`/pendentes re-derivados de `GateStatusSnapshot.branch`/`.calibration`/`.gates[].status`; descompasso → reportado e fail-closed; checkpoint ausente/corrompido nunca bloqueia (FR-8); **+ protected-path** (D2) como 2ª camada | **Confirmada** (as duas camadas: re-derivação + protected-path) |
| **R60** (`--budget` = instância única de `SharedBudget`; esgotamento gracioso) | §10/§8 — `createSharedBudget(budget)` uma vez no composition root, por referência (R16b, erro de compilação na omissão); default 2M, nunca "sem teto"; `budget-exceeded` distinto de `needs-human` | **Confirmada** |
| **R61** (herda R46-R49 sem relaxamento; cross-provider bloqueado por default no run) | §3.2 passo (b) — reuso literal da Fase 7 (spec Grupo G/FR-20/21); sem egress novo; o laço não sintetiza consentimento → cross-provider bloqueado, gate para como `needs-human` | **Confirmada** (SLI #16), herdada integralmente |

---

## 13. Resolução das 8 questões abertas da spec (§9)

| # | Questão | Resolução neste ADR |
|---|---|---|
| **§9.1** | `defaultProtectedPaths()` para o checkpoint | **§4/D2** — SIM, adicionar; path `.conductor/auto/` (não `.cdt/auto/`), uma linha; 2ª camada sobre BR-5/R59 |
| **§9.2** | "Gates 1-8" vs. `{3,5,7,8,9}` | **§9/D7** — piso mandatório vence; aplicabilidade computada; Gate 9 inatingível sem `needs-human` |
| **§9.3** | `budget-exceeded` como 4ª condição de parada | **§8/D6** — ratificada; `RunStopReason` em `@conductor/cli`, fora do enum travado; distinta de `needs-human` |
| **§9.4** | Mecanismo exato da auto-avaliação de risco | **§6/D4** — veto determinístico reject-only + aceite por asserção explícita; **não** um model call sobre a demanda |
| **§9.5** | Onde `conductor auto` vive fisicamente | **§3/D1** — adição fina a `@conductor/cli` (`commands/auto.ts` + `case "auto"`); H-Fase8 ratificada; achado N1 declarado |
| **§9.6** | Paralelismo controlado | **Non-goal** (spec §3) — não avaliado; o padrão manual (worktree+subagentes) permanece ad hoc; fase futura |
| **§9.7** | Default de `--budget` | **§10/D8** — `2_000_000` tokens, env-overridable, sintonizável no Gate 11 |
| **§9.8** | Veto: cria branch/`GateState` ou recusa antes? | **§10/D8** — recusa **antes** de branch e `GateState`; único artefato = a `Decision` de classificação |

---

## 14. A extensão declarada — o que exatamente muda em código já existente

Duas mudanças, e só duas (mais o novo `commands/auto.ts` e o `case "auto"`, que são **adições** de código
novo, não mudanças de código herdado):

| Antes | Depois | Onde | Por quê |
|---|---|---|---|
| `defaultProtectedPaths(workspaceRoot)` — sem `.conductor/auto` | `+ join(workspaceRoot, ".conductor", "auto")` no ramo `workspaceRoot` | `workspace-policy.ts:179-202` | **D2/§9.1/secure-default 72**: o run checkpoint é estado de governança da mesma família que `gates/`; inescrevível por tool de subagente |
| `GateStateStoreView.approve` chama só `mintHumanApproval`; `mintAutoApproval` sem call-site | `+ approveAuto(demandId, gate)` no seam CLI-local, compondo `store.mutate` + `mintAutoApproval`, **guardado por `MANDATORY_GATES.has(gate)` → recusa** (auto nunca cunha um obrigatório); `+ isInteractive` injetado no caminho de `approve` (D3 camada 2) | `gate.ts` (interface `GateStateStoreView`), `gate-store.ts` (`createPersistedGateStateStore`) | **N1** (o primitivo existe, faltava o fio) **+ D3 camada 2** — ambos no seam **CLI-local**, nunca num tipo travado do ADR 0005 |

`GateState`, `GateRecord`, `GateStatus`, `Approval`, `ApprovalMeta`, `evaluateAdvance`, `evaluateCalibration`,
`isMandatorySatisfied`, `mintHumanApproval`, `mintAutoApproval`, `MANDATORY_GATES`, `SharedBudget`,
`resolveModelForGate`, `evaluateModelPrecondition`, `ConfirmChannel`, `confirmOrDeny`, `resolveConfirmChannel`
e `findSecretSpans` permanecem **literalmente** como estão — a Fase 8 **compõe** sobre todos.

---

## 15. Reconciliação com o Gate 3 addendum (protocolo iterativo) — nenhuma superfície nova retorna

O mandato (Gate 3 §8): *"se o Gate 4 expuser uma superfície nova, retornar a este gate"*. Avaliei cada decisão.
**Nenhuma abre uma fronteira de confiança nova** — exatamente o que o Gate 3 §8 previu ("a Fase 8 não introduz
provedor, processo ou sink de rede novo; o delta é sobre quem decide e quem aprova sem humano no laço").

| Decisão | Superfície nova? | Avaliação |
|---|---|---|
| **D1** (orquestrador em `@conductor/cli`) | **Não** | Código do mesmo processo confiado; compõe `gate *`; sem estado durável além do checkpoint (já protected, D2). O Gate 3 §8 nomeou "um daemon/serviço de background" como gatilho de retorno — **D1 não é isso** (máquina de estados de processo CLI, non-goal explícito o daemon) |
| **D2** (checkpoint protected) | **Não** | *Fecha* uma superfície (T78), não abre; muda o path de `.cdt/` para `.conductor/`, herdando o protected-path existente |
| **D3** (mint em 2 camadas) | **Não** | Endurece uma superfície existente (o mint); a testemunha de TTY é um seam de injeção, sem estado novo |
| **D4** (classificação determinística) | **Não, e evita uma** | Recusar o model call para o aceite **evita** abrir a superfície de injeção-na-classificação que um classificador de modelo criaria — a fronteira é evitada por construção, como o ADR 0008 D7 evitou o cache de disponibilidade em disco |
| **D5** (secret-scan in-process) | **Não** | Reusa o matcher da Fase 6; nenhum binário externo, nenhum processo novo |
| **N1** (ligar `mintAutoApproval`) | **Não** | Primeiro call-site de um primitivo já construído e testado pela Fase 4; guardado por `MANDATORY_GATES`; mesmo `store.mutate` |

**Residuais herdados, declarados e não fechados** (idênticos às Fases 7/8): o teto de execução do processo
confiado sem sandbox (T17/R1); a exfiltração por config **deliberada do próprio usuário** (uso, não ataque); a
evasão da classificação **limitada pelo backstop mandatório** (T74 — desperdiça um run autônomo, nunca alcança
um merge). O design reduz o risco a um nível aceitável e **detectável**, não a zero — só o Gate 9 confirma cada
um como fechado na prática (o addendum §8b já enumerou os 7 ataques).

---

## 16. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. Os nomes de tipo e a forma dos retornos
> **são** a decisão; corpos e detalhes de I/O são Gate 6.

```ts
// ================= @conductor/cli — o orquestrador (composição, nunca reimplementação) =============

/** As 4 condições de parada exaustivas (D6). NUNCA um valor em GateStatus (enum travado, ADR 0005). */
export type RunStopReason = "context-limit" | "needs-human" | "budget-exceeded" | "landed";

/** Classificação de risco (D4) — um RESULTADO tipado, nunca uma exceção; reject-only + fail-closed. */
export type RiskClassification =
  | { outcome: "vetoed"; matched: { where: "demand-string" | "diff-path" | "diff-content"; pattern: string } }
  | { outcome: "authorized-low-risk"; basis: "explicit-flag" | "narrow-rule"; method: "human" | "auto" }
  | { outcome: "needs-human"; reason: "uncertain" | "underspecified" };

/** Veto estático PURO (reject-only). Chamado no intake (demanda) E a cada fronteira de gate (diff). */
export function evaluateStaticVeto(input: {
  demandString?: string;
  diffPaths?: readonly string[];
  diffText?: string;
}): { vetoed: false } | { vetoed: true; where: "demand-string" | "diff-path" | "diff-content"; pattern: string };

/** A autorização de aceite: fail-closed, POR ASSERÇÃO EXPLÍCITA — nunca um model call sobre a demanda (D4). */
export function classifyRisk(input: {
  demandString: string;
  explicitRiskLow: boolean;                 // --risk=low (FR-5) -> method:"human"
  narrowRuleMatch: boolean;                 // /cdt-intake-like: typo/config/small-bug determinístico
}): RiskClassification;

/** Schema do run checkpoint (D2/BR-5). Path: <workspaceRoot>/.conductor/auto/<slug>.continue.json, PROTECTED.
 *  TODOS os campos são DICA (R59): re-derivados do GateState em --continue, nunca autoritativos. */
export interface RunCheckpoint {
  last_gate: number;
  next_gate: number;
  demand_branch: string;                    // re-derivado de GateStatusSnapshot.branch
  depth_calibration: number[];              // re-derivado de GateStatusSnapshot.calibration
  deferred_human_decisions: readonly string[];
  stop_reason: RunStopReason;               // D6 — fora do enum travado
}

/** Secret-scan pré-push (D5): reusa findSecretSpans (@conductor/secrets), NUNCA um binário externo. */
export function scanStagedDiffForSecrets(diffText: string):
  | { clean: true }
  | { clean: false; spans: readonly SecretSpan[] };   // SecretSpan de @conductor/secrets (Fase 6)

/** O composition root do orquestrador — recebe TODOS os colaboradores já construídos (nunca os constrói). */
export interface RunAutoOptions {
  demand: string;
  budgetTokens?: number;                    // default DEFAULT_AUTO_RUN_TOKEN_BUDGET (D8), env CONDUCTOR_AUTO_TOKEN_BUDGET
  riskLow?: boolean;                        // --risk=low (FR-5)
  continueSlug?: string;                    // --continue (D2/G3)
  io: CliIO;                                // carrega io.tty; resolveConfirmChannel(io.tty) é injetado, D3 camada 1
}
export function runAuto(options: RunAutoOptions): Promise<number>;

export const DEFAULT_AUTO_RUN_TOKEN_BUDGET = 2_000_000;   // D8 — default declarado, sobreponível, Gate-11-tunable

// ---- Extensão do seam CLI-local GateStateStoreView (N1 + D3 camada 2) — NUNCA um tipo travado do runtime ----

export interface GateStateStoreView {
  // ... status/start/attachEvidence/approve/reject/calibrate inalterados ...

  /** N1: o PRIMEIRO call-site de mintAutoApproval (method:"auto"). Guardado por MANDATORY_GATES:
   *  um gate obrigatório NUNCA é auto-cunhado (recusa -> o chamador registra needs-human). Mesmo store.mutate. */
  approveAuto(demandId: string, gate: number): GateStatusSnapshot;
}

/** D3 camada 2: a testemunha de interatividade INDEPENDENTE, injetada no caminho de approve().
 *  Produção: () => Boolean(process.stdin.isTTY && process.stdout.isTTY). Seam de teste sobreponível.
 *  approve() cunha method:"human" só se confirmResult === true AND isInteractive() === true. */
export type InteractivityWitness = () => boolean;
```

---

## 17. Consequências

### 17.1 Positivas

1. **H-Fase8 sobrevive ao contato com o código.** O orquestrador é `gate *` composto; o único fio novo (N1) é o
   **primeiro** call-site de um primitivo que a Fase 4 construiu explicitamente para este chamador — não um
   segundo mutador, não um segundo sign-off.
2. **Um achado real antes de escrever código** (N1): o caminho de auto-aprovação estava construído no runtime e
   desfiado na CLI — a implementação "óbvia" (reusar `approve()`) teria produzido `method:"human"` para um gate
   que nenhum humano aprovou, ou teria falhado. Nomeá-lo agora evita o defeito.
3. **O sink de sign-off passa de convencional a estrutural em duas camadas**, sem tocar um único tipo travado do
   ADR 0005 — a garantia mora no seam CLI-local, onde ela pode crescer sem reabrir o runtime.
4. **A classificação de risco não abre uma superfície de injeção nova** — recusar o model call para a
   autorização é a decisão que *evita* uma fronteira, e é testável RED/GREEN.
5. **Zero infraestrutura nova.** Nenhum daemon, Docker, poller, segundo canal, segundo contador, segundo motor
   de segredo, nenhum valor novo em enum travado. O inventário do Gate 7 não cresce.
6. **Funções puras** (`evaluateStaticVeto`, `classifyRisk`, `scanStagedDiffForSecrets`) permitem ao Gate 5
   escrever testes RED reais antes de qualquer git, rede ou subagente existir.

### 17.2 Riscos aceitos (com mitigação)

| # | Risco | Sev. | Mitigação | Residual |
|---|---|---|---|---|
| R1 | Execução no processo confiado forja um sign-off (bug + spoof de TTY) | Alto | D3 duas camadas (injeção + testemunha); `isGenuineHumanApproval`/`HUMAN_MINT`; Gate 9 (FR-23) | **Declarado** — brand contornável por `as unknown` deliberado (honesto, ADR 0005) |
| R2 | Evasão da classificação (descrição benigna, diff hostil) | Médio | Veto re-avaliado sobre o diff a cada fronteira (D4/FR-3b); backstop mandatório `{3,5,7,8,9}` sobre o diff real | **Declarado** — limita o pior caso a "run autônomo desperdiçado", nunca merge (T74) |
| R3 | O default de `--budget` (2M) está errado para algum run real | Baixo | Env-overridable + `--budget`; Gate 11 sintoniza | **Declarado** — inventado sob incerteza, dito como tal |
| R4 | Um subagente comprometido queima o `SharedBudget` (DoS intra-run) | Baixo | Halt gracioso (`budget-exceeded` → checkpoint + push); teto = failure domain do run | **Aceito** — sub-budgets por-subagente = non-goal (T79) |
| R5 | O secret-scan in-process erra um segredo que um `gitleaks` pegaria | Baixo | Reusa o matcher da Fase 6 (fonte única); defesa em profundidade com o CI quando fiado | **Declarado** — o matcher da Fase 6 é o teto atual de detecção do monorepo |

### 17.3 Negativas / custos assumidos

1. **Uma extensão ao seam CLI-local `GateStateStoreView`** (`approveAuto` + `isInteractive`) — pequena, guardada
   por `MANDATORY_GATES`, mas é código herdado tocado. Aceita por ser estritamente menor que a alternativa (um
   segundo adaptador de estado, que falsificaria H-Fase8).
2. **Uma correção de literal na spec** (`.cdt/auto/` → `.conductor/auto/`) — um loop-back menor ao Gate 2, sem
   consequência de comportamento.
3. **`conductor auto` para no primeiro gate mandatório** para uma Feature — é o desenho (o backstop), mas
   significa que o valor autônomo pleno aparece em demandas cuja calibração tem poucos mandatórios no caminho
   (typo/config/small-bug), não em Features grandes. Declarado, não escondido.
4. **A retomada depende de `--continue` + aprovação interativa out-of-band** dos mandatórios — dois passos de
   operador, não um. Custo aceito em troca de nunca fabricar um sign-off.

---

## 18. Rastreabilidade

| Origem | Item | Onde neste ADR |
|---|---|---|
| plano §4.8 (características de `conductor auto`) | auto-aprovação técnica, commit por gate, checkpoint, budget, para em sign-off, `needs-human` | §3.2 (o loop), D6, D4, N1 |
| plano §4.8 (critério de saída "Gates 1-8") | reconciliação com o piso mandatório | §9/D7 |
| spec G1-G8 | os 8 goals | D1, D4, §8.2/D2 (retomada), D8, D6, §3.2, R61, D3 |
| spec FR-1..6 (Grupos A/B) | run novo + classificação | §3.2, §6/D4, §10.2 |
| spec FR-7..9 (Grupo C) | `--continue` + checkpoint | §4/D2, §8.2/R59 |
| spec FR-10..12 (Grupo D) | `--budget` | §10/D8, R60 |
| spec FR-13..17 (Grupo E) | condições de parada | §8/D6, §9/D7 |
| spec FR-18/18b/19 (Grupo F) | commit por gate + secret-scan | §3.2, §7/D5 |
| spec FR-20/21 (Grupo G) | resolução de modelo por gate | §3.2 (passo b), R61 |
| spec FR-22/23 (Grupo H) | canal de sign-off + alvo do Gate 9 | §5/D3 |
| spec BR-1..10 | as 10 regras | §6 (BR-1/2), §10/D8 (BR-3/4), §4/§8.2 (BR-5), D2 (BR-6), §3.2 (BR-7), §5 (BR-8), §8 (BR-9), §3.2 (BR-10) |
| spec edge 1..9 | os 9 casos | §10.2 (1/8), §8.2 (2/9), §8.2 (3), §8 (4), §9 (6), §8 (7), §5 (5-headless) |
| Gate 3 T74..T80 / R55..R61 | as 7 ameaças e regras | §12 |
| Gate 3 §9.1 / §9.2 | protected-path + piso mandatório | §4/D2, §9/D7 |
| spec §9.1..§9.8 | as 8 questões abertas | §13 |

---

## 19. Grounding (biblioteca) — consultas desta sessão

Rodadas via `cdt library "<pergunta>" --gate 4` a partir de `C:\development\source\projects\conductor` (backend
saudável). **Cobertura honesta:** uma citação **forte** para a forma do ADR; o resto **moderado (0.55-0.61)**,
reportado como tal — o padrão já estabelecido nas Fases 5-8 para tópicos de orquestração agent-native que o
corpus (majoritariamente arquitetura/engenharia geral) não cobre em profundidade. Nada foi forçado.

1. **ADR como artefato: contexto, decisão, alternativas, consequências, imutável, revisitável** → **The Practice
   of Architecting §2.8 "Checklist: ADRs"** (**0.734**, o hit mais forte), **§2.2** (0.730), **§2.12 "When not
   to write an ADR"** (0.716) e **Documenting Software Architecture §3.1** (0.709). Base da **forma** deste
   documento e do critério de o que virou D-item e o que ficou detalhe de Gate 6.
2. **Orquestração (um coordenador central dirige os passos) vs. coreografia** → **Distributed Architecture
   Decisions §3.4 "orchestration vs. choreography"** (0.548: *"a coordinator service drives the steps;
   orchestration = central control, easy to see the flow"*). Base de **D1** — a escolha deliberada de
   orquestração pela auditabilidade.
3. **Não introduzir um pattern/interface/mutador onde há uma só implementação** → **Object-Oriented Design
   Patterns §1.12 "When not to reach for a pattern"** (0.550) e **Object-Oriented Thinking §2.12 "When not to
   hide behind an interface"** (0.550: *"one implementation and no second in sight... an interface that is a
   transcript of it"*). Base de **D1/§1.3 item 5** (nenhum segundo mutador; nenhum pacote novo).
4. **Classificação/erro como RESULTADO tipado com default seguro, não exceção** → **Writing Maintainable Code
   §4.12 "When not to apply the three habits"** (0.606: *"Not found / invalid input... a Result type / explicit
   variant"*) e **Messaging and Integration Patterns §2.12** (0.586: não decompor onde há uma decisão só). Base
   de **D4** (a classificação devolve um resultado tipado; a heurística é uma função pura, não um subsistema).
5. **Evento de orquestração fora do agregado de domínio** → **Domain-Driven Design §4.2 "domain events and the
   model boundary"** (0.597: *"wiring those directly couples the aggregate to everything downstream"*). Base de
   **D6** (`RunStopReason` fora de `GateStatus`).
6. **Herdadas do Gate 3, não re-consultadas** (a decisão de grounding já está no registro daquele gate):
   **Secure Code Review §1.2/§1.12/§2.2** (0.635, blocklist decide o rejeitar não o aceitar; taint source→sink
   — §6/D4); **Building Secure and Reliable Systems §3.3/§3.8** + **Security Engineering §2.2/§2.9/§2.12**
   (multi-party authorization; uncertainty deny — §5/D3, via ADR 0005 §6); **Penetration Testing §14.9/§14.2**
   (0.647, no secret ships — §7/D5); **Security Engineering §1.5** (0.639, defesa em profundidade — §4/D2, §7);
   **Prompt Engineering PPP §13.5/§6.5** (Router with Unclear Lane; stop conditions — §6, §8);
   **Solution Architecture §2.12** (números inventados sob incerteza, overridable — §10/D8); **Pragmatic
   Programming Practices §1.4** (single source of truth — §7); **Measuring Software Delivery Performance
   §2.3/§2.5** (small batches — §9); **SRE §1.12** + **Software Architecture and Quality Attributes §2.12**
   (a natureza SLO×invariante — §11).
7. **Declarado NÃO coberto (não forçado):** a metade "orquestrador autônomo agent-native / heurística
   determinística de classificação > model call na autorização" não tem citação forte no corpus (top ~0.55,
   fora do alvo). É fundamentada no **precedente de código deste monorepo** (a disciplina fail-closed de
   `confirmOrDeny`/`SharedBudget.reserve`/`mintHumanApproval`, o matcher único de `@conductor/secrets`) e nos
   achados lidos no código (N1, o secret-scan não-fiado) — não numa citação fabricada.

---

## 20. Loop-back do Gate 8 — FR-13 (contexto ~90%) é estruturalmente inatingível hoje, honestamente declarado

Mesmo padrão de emenda que o ADR 0008 §21 já usou para seu próprio loop-back: este ADR não é reaberto nem
reescrito (§0, "ADRs são imutáveis"); esta seção **acrescenta** o que o Gate 8 (validação FR-a-FR) encontrou
depois da implementação, sem tocar nenhuma decisão D1-D8 acima.

**O achado.** `RunStopReason` (§8/D6, §16) declara `"context-limit"` como uma das 4 condições de parada
exaustivas (FR-13/BR-9). A implementação real de `runAuto` (Gate 6) **nunca produz esse valor** — nenhum
código-caminho neste arquivo o atribui. Isto não foi um esquecimento silencioso do Gate 6 original nem deste
loop-back: é a **mesma causa-raiz** já declarada em voz alta pelo próprio cabeçalho de `runAuto` para o passo
(c) do loop (§3.2) — "delegar trabalho aos subagentes de papel (Task)" não tem call site alcançável a partir
da assinatura atual de `RunAutoOptions`/`CliIO` (§16, reproduzida verbatim, sem campos novos). FR-13 pede que
o run detecte "uso de contexto cruzando ~90% da janela do modelo" — mas não existe, hoje, nenhum handle de
sessão/contexto de subagente vivo que este orquestrador possa ler; `SharedBudget` mede um **orçamento de
tokens do RUN inteiro** (um teto acumulado ao longo de todos os gates e chamadas, FR-11/12), uma medida
fundamentalmente diferente da **janela de contexto de UMA sessão de subagente** (um limite por-chamada, ex.
200k tokens de UM turno) que FR-13 realmente pede. Uma proxy ingênua (ex.: "orçamento restante < 10%") foi
considerada e rejeitada: substituiria uma lacuna honesta por um número que parece plausível mas mede a coisa
errada — trocaria "não implementado, declarado" por "implementado incorretamente, não declarado", uma troca
pior, não melhor (o mesmo raciocínio que já rejeitou, em §6.3, um model call para a classificação de risco: um
número/sinal que parece a coisa certa mas não é vale menos que a ausência honesta dele).

**Por que isto não falsifica H-Fase8 nem regride nenhum invariante.** O SLI/SLO §11 item 17 ("`budget-exceeded`/
contexto/`needs-human` parando graciosamente, nunca crash") permanece verdadeiro — vacuamente, para o ramo de
contexto, já que esse ramo nunca executa; não é uma violação, é uma cláusula que ainda não tem chamador. As
outras 3 condições de parada (`needs-human`, `budget-exceeded`, `landed`) são REAIS e testadas de ponta a
ponta (`test/commands/auto-run.test.ts`). O falsificador de H-Fase8 (cabeçalho) não é tocado: isto não é um
segundo mutador nem um segundo caminho de aprovação — é, simplesmente, uma cláusula do contrato ainda sem
implementação, agora nomeada em vez de silenciosa.

**Resolução.** `RunStopReason` mantém as 4 variantes (o contrato do §16 não muda — BR-9 continua "exaustivo"
sobre o CONJUNTO de motivos possíveis, não sobre quais já têm implementação hoje). O código
(`src/commands/auto.ts`, doc comment de `RunStopReason` e do cabeçalho de `runAuto`) declara explicitamente
esta lacuna, nomeando-a como bloqueada pela MESMA fiação de subagente/sessão que o passo (c) do loop já
espera de uma fase futura — não uma lacuna nova, a MESMA lacuna raiz vista de um segundo ângulo. Nenhuma spec
nem código finge que FR-13 está ao vivo hoje; `docs/conductor/gate2-spec-fase8.md` recebe uma nota equivalente
junto de FR-13 (não uma reescrita da FR, um acréscimo datado, mesmo padrão desta seção).

**Fecha:** Gate 8 loop-back, finding 3 (validação FR-a-FR pós-Gate-6). **Segue aberto para:** a mesma fase
futura que preenche o passo (c) do loop (threading de um handle de sessão/Task através de `CliIO`) — nenhuma
nova fase é criada só para isto; é o MESMO follow-up já nomeado pelo cabeçalho de `runAuto`.
