# Gate 2 — Especificação (fonte da verdade): Fase 4 — Gates e evidências

**Demanda:** `Fase 4 — Gates e evidências` (`plano_desenvolvimento.md` linhas 1324-1349).
**Gates cobertos por este documento:** Gate 1 (descoberta de domínio) + Gate 2 (especificação), ambos
**leves** — calibração já registrada no diário (`cdt journal recall`, entrada `gate 0`): FULL nos gates
3,4,5,6,7,8,9 (mesmo padrão das Fases 2/3 — a feature toca governança/aprovação e o invariante 11
"sign-offs não podem ser fabricados" é diretamente de segurança); leve nos gates 1-2 (o domínio já vem
dado pelo plano e — caso particular notável desta fase — pelo **próprio protocolo do CLAUDE.md que está
sendo seguido agora mesmo para conduzir esta demanda**, o que a torna a fase com a especificação de
domínio mais auto-evidente de todo o projeto); 10-12 leve/dispensável; 13-14 skip (fase intermediária,
sem deploy de serviço — mesma razão das fases anteriores).
**Papel responsável:** `business-analyst` (skill `map-requirements`), Gate 2 do fluxo Conductor.
**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/fase4-gates-e-evidencias` (de
`develop`, já criada e limpa).

**Princípio orientador (dado pelo orquestrador — não é decisão desta BA, é herdado):** esta fase constrói
uma **máquina de estados de verdade** (`GateState` persistido e queryable) para o fluxo de 14 gates — mais
formal do que o `conductor-main` (Python) tem hoje. **Achado confirmado nesta sessão** (leitura integral de
`gate_land.py` + `cdt journal recall`): o `conductor-main` **não tem um `GateState` vivo para portar**. Lá
o fluxo de 14 gates é inteiramente **protocolo de prompt** (`CLAUDE.md`/`flow.md`, seguido por disciplina
do modelo dentro de uma sessão), sustentado por `journal.py` (registro append-only, sem noção de "gate
atual"), `gate.py` (só o hook `commit-msg` de grounding) e `gate_land.py` — um **landing guard
retrospectivo**: no momento do `git push`, lê o diário por branch e produz um veredito
`Allow`/`Deny`/`Override`/`CouldNotEvaluate` a partir de `MANDATORY_GATES` (`roles.py`), nunca uma máquina
de estados que sabe, a qualquer momento, "em que gate esta demanda está agora". Por isso este documento usa
`CLAUDE.md` deste próprio projeto como **especificação comportamental** (é literalmente o protocolo sendo
seguido para conduzir esta demanda) e `gate_land.py` como **referência parcial** — não de estado, mas do
**veredito de completude por conjunto de gates obrigatórios**, que a Fase 4 precisa do mesmo jeito, só que
aplicado *antes* de avançar, não *depois* no push.

**Consome (lido integralmente antes de escrever este documento):**
- `plano_desenvolvimento.md` linhas 484-528 (§4.7 — tabela dos 14 gates + interface `GateState`),
  530-543 (protocolo obrigatório de cada gate, 8 passos), 547-616 (§4.8 — modos de execução: interactive,
  one-shot, gate-specific, role-specific, autonomous, headless/CI, RPC, SDK), 1324-1349 (Fase 4 em si:
  objetivos, entregáveis, critério de saída), 1639-1662 (§10 — invariantes, especialmente 4, 10, 11).
- `CLAUDE.md` deste projeto (`conductor`) inteiro — os 4 non-negotiable rules, o "Gate protocol —
  MANDATORY em cada gate" (6 passos: recall/ground/delegate/record/halt-checkpoint/commit), a tabela
  "Model roles per gate", e a "Gate depth calibration" (como profundidade é calibrada por tamanho de
  demanda e quais gates nunca colapsam).
- `conductor-main/conductor/gate_land.py` — `Allow`/`Deny`/`Override`/`CouldNotEvaluate`/`Complete`/
  `Incomplete`, `_gate_completeness`, `_is_approval` (regex de allowlist positivo, não substring),
  `MANDATORY_GATES` (importado de `roles.py`: `frozenset({3, 5, 7, 8, 9})` — ver §9.1, discrepância com
  o `CLAUDE.md` deste projeto).
- Código já existente no pi-conductor (Fases 1-3, não reinventado aqui):
  `packages/conductor-config/src/builtin-roles-data.ts` (`BUILTIN_GATE_ROLES`, `gatesForBuiltinRole`);
  `packages/conductor-runtime/src/tools/task.ts` (`DelegationEvidence`, `assertValidTaskToolResult` — o
  contrato "evidência é referência conferível, não alegação"); `packages/conductor-runtime/src/
  permission-gate.ts` (o chokepoint de aprovação humana existente, `ctx.ui.confirm()` fail-closed);
  `packages/conductor-runtime/src/audit-trail.ts` (log append-only, escrita síncrona que **lança** em
  falha de I/O, "pre-write, not best-effort-after"); `packages/conductor-runtime/src/shared-budget.ts`
  (padrão de mutação atômica check-and-reserve, referência para o edge case de concorrência).

---

## 1. O que já existe vs. o que a Fase 4 constrói (evita reinventar)

| Capacidade | Já existe (Fases 0-3 ou conductor-main) | Fase 4 constrói/estende |
|---|---|---|
| Tabela de papéis e critérios por gate | **Sim, completo.** `BUILTIN_GATE_ROLES` + `gatesForBuiltinRole` (Fase 3) já respondem "quem serve o Gate N" para os 14 gates. | Reusa esta tabela como a fonte de "papéis responsáveis" de cada gate no `GateState` — não redefine papel-por-gate. |
| Fluxo de 14 gates como protocolo | **Sim, mas só como texto de prompt** (`CLAUDE.md`/`flow.md`): o modelo segue os 8 passos por disciplina dentro de UMA sessão. | Formaliza esse protocolo em um **estado persistido e queryable**: hoje "seguir o protocolo" é inteiramente confiança na sessão corrente; depois desta fase, `conductor gate status` responde objetivamente sem reabrir a conversa que produziu o estado. |
| Veredito de completude por conjunto de gates obrigatórios | **Sim, completo, mas retrospectivo.** `gate_land.py:_gate_completeness` — três valores (`Complete`/`Incomplete`/`CouldNotEvaluate`), avaliado no momento do `git push`, **fail-OPEN** na falha de leitura (nunca trava o git do usuário — é a postura deliberada de um hook). | O análogo **ao vivo**: `gate start N` recusa avançar SE um gate obrigatório anterior está incompleto — mesma pergunta ("está completo?"), aplicada **antes** de avançar, não depois no push. A postura de falha na corrupção é **deliberadamente diferente** (fail-**closed** aqui) — ver BR-9 e §9.1. |
| Chokepoint de aprovação humana | **Sim, completo, mas para chamadas de ferramenta.** `permission-gate.ts`: `ctx.ui.confirm()` com timeout fail-closed; `audit-trail.ts`: log append-only, síncrono, lança em falha de I/O ("pre-write, not best-effort-after"). | Aprovar um **gate** (`conductor gate approve`) não é uma chamada de ferramenta destrutiva no sentido do Permission Gate — mas o invariante 11 exige a **mesma disciplina**: uma aprovação sensível vem de um canal que um processo comum não forja por acidente, com rastro durável antes do efeito. Esta fase **reusa esse padrão**, não inventa um segundo mecanismo de confirmação paralelo (ver BR-8). O mecanismo concreto — literalmente `ctx.ui.confirm()` reaproveitado, ou um canal próprio com a mesma disciplina — é decisão de Gate 4. |
| Orçamento compartilhado com mutação atômica | **Sim, completo** (Fase 3). `shared-budget.ts:reserve()` debita **sincronamente**, sem `await` no meio, fechando a janela reserve→settle; nunca lança, retorna `null` em incerteza. | Referência de padrão para o edge case de concorrência (§7.4): "duas mutações concorrentes do mesmo estado" é a mesma classe de problema que o budget já resolveu no domínio de tokens. O mecanismo concreto (lock de arquivo, escrita atômica versionada/CAS) é decisão de Gate 4/6; o requisito observável — nenhuma mutação perdida — é herdado diretamente. |
| Evidência estruturada, não alegação livre | **Sim, completo, mas por delegação.** `task.ts`: `assertValidTaskToolResult` recusa um retorno sem referência de transcrição (`sessionId`+`filePath`), papel, profundidade e custo — evidência é um contrato validado, não uma promessa em texto. | Generaliza o **mesmo princípio** ("referência conferível, não alegação") de "uma delegação" para "um gate inteiro" — ver Grupo C/H. |
| Diário automático (captura total de eventos) | **Não existe no produto pi-conductor** — nomeado explicitamente Fase 6 ("Diary e captura automática", linha 1377). O que existe é `cdt journal` do Conductor-CLI enrolado neste repo-pai, uma ferramenta do **processo de gates**, não um recurso do produto sendo especificado. | **Não é construído aqui** (Non-goal, §3) — mas `GateState.evidence`/`decisions` precisa de ALGUM mecanismo de escrita durável análogo, já que "toda transição de gate possui evidência" (invariante 10) é desta fase, não da Fase 6. Ver §9.2. |

---

## 2. Goals

1. **G1 — `GateState` persistido e queryable por demanda.** Toda demanda (`demandId`) tem um registro
   durável de `currentGate`/`status`/`artifacts`/`evidence`/`decisions`/`risks`/`approvals` que sobrevive
   ao reinício do processo e é consultável sem reabrir a sessão que o produziu.
2. **G2 — Progressão ordenada com gates obrigatórios impostos ao vivo.** `gate start N` aplica, **no
   momento de iniciar**, a mesma pergunta que `gate_land.py` hoje só responde no `git push`: "um gate
   obrigatório anterior está incompleto?" — sem duplicar a lógica, generalizando-a para um ponto de
   controle anterior.
3. **G3 — Evidência é referência conferível, nunca promessa.** Todo item de evidência registrado é algo
   que um terceiro pode abrir e conferir de forma independente (arquivo, commit, execução de teste,
   entrada de diário) — nunca só uma alegação de sucesso em texto livre. Generaliza o contrato
   `DelegationEvidence` (Fase 3, "uma delegação") para "um gate inteiro".
4. **G4 — Sign-off não pode ser fabricado (invariante 11).** Uma transição para `approved` por sign-off
   humano é alcançável **apenas** por um caminho identificável como humano, estruturalmente distinto de
   uma transição `approved` automática de baixo risco — a mesma distinção que o próprio enum `status` do
   plano já expressa (`approved` vs `needs-human`) e que o `/cdt-auto` **já pratica operacionalmente
   agora mesmo**, nesta própria sessão.
5. **G5 — Fail-closed em estado corrompido ou ilegível.** Um `GateState` no disco que não pode ser lido
   ou que não corresponde ao schema versionado bloqueia avanço/aprovação — nunca é tratado como "tudo
   aprovado até aqui" por omissão. Esta é a direção de falha **oposta**, e deliberadamente, à do landing
   guard do `conductor-main` (fail-open no `git push`) — ver BR-9.
6. **Critério de saída (herdado literalmente do plano, linha 1347):** "Uma demanda deverá percorrer Gates
   1–8 com estado persistido, artefatos e aprovação" — restated de forma testável em §5/§6.

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Backend de RAG/biblioteca** (`conductor library search/ingest`, citações automáticas no produto) | Nomeado explicitamente Fase 5 — "Library e grounding" (plano linha 1351). O grounding **desta própria especificação** (via `cdt library` do Conductor-CLI enrolado) é processo de gate, não recurso do produto sendo especificado. | Fase 5 |
| **Execução autônoma completa "`conductor auto`"** com todos os detalhes de orçamento dedicado ao modo, paralelismo controlado, checkpoints de contexto e recuperação completa após interrupção (plano §4.8 lista 7 características) | Esta fase entrega só o que o **critério de saída** exige e o que os invariantes nomeiam: a distinção estrutural `approved`(auto) vs `needs-human` (G4/FR-10/FR-11) e o registro de uma decisão `needs-human` quando aplicável. Orçamento **dedicado ao modo autônomo** (distinto do budget de tokens já resolvido na Fase 3), paralelismo controlado e recuperação completa após interrupção são refinamentos operacionais do modo `auto` em si — nenhuma seção lida do plano nomeia uma fase específica para eles; ver §9.3. | Não nomeado explicitamente — pergunta aberta §9.3 |
| **RPC/SDK completos** (`conductor` controlável por outro processo; `createConductorSession`) | O plano (§4.8) nomeia RPC e SDK como **modos de acesso** à máquina de estados, não a máquina em si. O entregável literal desta fase (linhas 1337-1343) é a máquina acessível **via CLI** (`conductor gate status/start/evidence/approve/reject`). | Não nomeado explicitamente — modo de acesso adicional, cresce organicamente |
| **Diário automático / captura total de eventos** (Honcho firehose) | Nomeado explicitamente Fase 6 (linha 1377). | Fase 6 |
| **Estado persistido provado ponta-a-ponta para os Gates 9-14** | O critério de saída (linha 1347) nomeia literalmente Gates 1-8. A máquina (`GateState`, o enum `status`, `currentGate`) não tem limite estrutural de 8 — é genérica a 1-14 — mas esta fase só **prova** a jornada completa até o Gate 8, que depende de superfícies ainda não construídas (pentest de aplicação real, deploy). | Fases que constroem essas superfícies (9 em diante) |
| **Integridade criptográfica do rastro de evidência** (hash-chain, assinatura, `ConductorSessionStore` formal) | Os ADRs 0002 §6 / 0003 §6.3 **adiaram** isso "para a Fase 4" — mas os objetivos/entregáveis da Fase 4 lidos em `plano_desenvolvimento.md` (linhas 1326-1343) não nomeiam hash-chain nem assinatura, só "persistir evidências" e "implementar aprovação humana". Interpretação adotada aqui: os ADRs queriam dizer "a Fase 4 finalmente constrói o *armazenamento* de evidência" (isso É esta fase — G3) — não "a Fase 4 adiciona *integridade criptográfica* a esse armazenamento". Sinalizado como discrepância a confirmar, não resolvido silenciosamente — ver §9.4. | Nenhuma fase nomeada ainda — pergunta aberta §9.4 |
| **Redesenho de superfície de status na TUI** (papel ativo, gate atual, aprovações pendentes visualizados) | Mesmo padrão já registrado nos Gates 2 das Fases 2/3: depende de dados que só existem a partir desta fase; cresce organicamente. | Cresce organicamente, fase(s) de UI não nomeada(s) aqui |
| **Mecanismo exato de aprovação** (é literalmente `ctx.ui.confirm()` reaproveitado? um tool novo `gate_approve`? uma extensão?) | Comportamento observável (§5/§6), não arquitetura. | Gate 4 |
| **Verificação automática de qualidade da evidência** ("essa evidência prova mesmo que o Gate 5 passou?") | Mesmo Non-goal já registrado na Fase 3 (BR-10/11 lá): é disciplina de **processo** de quem aprova (o Gate 8/9 revisando o trabalho do Gate 6), não uma trava mecânica que a máquina de estados deva impor sozinha. Esta fase garante que a evidência **existe e é conferível** (G3); decidir se ela é boa o suficiente é do avaliador. | Gates 8/9 (processo) |

---

## 4. Glossário (linguagem ubíqua)

*Grounding:* **Domain-Driven Design — Complete Professional Guide §1.1** ("a ubiquitous language is a
single, shared vocabulary — used by domain experts, product, and engineers, and reflected literally in
the code") e **§1.12** ("pays for itself... the code will be edited by people who were not in the
conversation that settled it", top **0.661**) — o mesmo caso da Fase 3: quem implementar esta fase não
participou da escrita do plano nem desta spec.

| Termo | Definição | Fonte |
|---|---|---|
| **Gate** | Um dos 14 pontos de controle sequenciais do fluxo (Descoberta → Especificação → ... → Pentest cloud), cada um com papéis responsáveis (já portados, Fase 3) e um critério de saída. | `plano_desenvolvimento.md` §4.7; `CLAUDE.md` (tabela de 14 gates) |
| **Demanda** | Uma unidade de trabalho conduzida pelo fluxo de gates, identificada por `demandId`, com sua própria branch (`feature/<slug>`/`bugfix/<slug>`/`hotfix/<slug>`) e seu próprio `GateState`. | `plano_desenvolvimento.md` §4.7; `CLAUDE.md` (protocolo git) |
| **GateState** | O estado persistido de uma demanda: `demandId`, `currentGate`, `status`, `artifacts`, `evidence`, `decisions`, `risks`, `approvals`, `startedAt`, `completedAt` — a interface TypeScript definida literalmente no plano (linhas 509-528). | `plano_desenvolvimento.md` §4.7 |
| **Status (do gate corrente)** | Um de `not-started`/`in-progress`/`blocked`/`needs-human`/`approved`/`rejected` — o vocabulário fechado que descreve onde a demanda está dentro do gate corrente. | `plano_desenvolvimento.md` §4.7 (interface `GateState`) |
| **Gate obrigatório (mandatory gate)** | Um gate que nunca pode ser colapsado/pulado independente do tamanho da demanda — Gates 3 (segurança), 5 (test-first), 7 (CI) e 8 (validação) no `CLAUDE.md` deste projeto. Ver §9.1 para a discrepância com o conjunto usado por `gate_land.py`/`roles.py` do `conductor-main` (que inclui também o 9). | `CLAUDE.md` ("Never collapse these gates"); `conductor-main/roles.py:MANDATORY_GATES` |
| **Evidência (Evidence)** | Um item anexado a um gate que referencia algo conferível de forma independente por um terceiro — um arquivo, um commit, uma execução de teste, uma entrada de diário — nunca só uma alegação em texto livre sobre o próprio trabalho. Generaliza `DelegationEvidence` (Fase 3) de "uma delegação" para "um gate". | `plano_desenvolvimento.md` §10 item 10; `task.ts:DelegationEvidence` (Fase 3, precedente direto) |
| **Critério de saída (exit criterion)** | A condição, por gate, que precisa valer para considerá-lo aprovável — já enumerada por gate no `CLAUDE.md`/`flow.md` (ex.: Gate 5 — "test cases derivados dos critérios de aceite; testes escritos falhando antes da implementação"). Esta fase não redefine os 14 critérios; formaliza a **checagem** de que um gate os satisfez o suficiente para virar `approved`. | `CLAUDE.md` (seção de cada gate); plano §10 item 4 |
| **Checkpoint** | O momento, dentro do protocolo de um gate, em que a decisão + citações + evidências são apresentadas e a progressão **para** até uma aprovação (humana ou automática, ver abaixo). | `plano_desenvolvimento.md` §4.7 (passo 8 do protocolo); `CLAUDE.md` ("Halt at every gate") |
| **Sign-off** | Um checkpoint cuja aprovação **precisa** ser humana — nunca alcançável por decisão automática, independente do modo de execução (interactive ou autonomous). Todo gate obrigatório é, no mínimo, um checkpoint de sign-off. | `plano_desenvolvimento.md` §4.8 ("interrupção em decisões de sign-off"); §10 item 11 |
| **Aprovação automática (auto-approved)** [NOVO — nomeia algo que o plano descreve sem lhe dar um rótulo próprio] | Uma aprovação de um checkpoint **não-sign-off**, de baixo risco, concedida pelo próprio fluxo em modo autônomo, sem intervenção humana — estruturalmente distinguível de uma aprovação humana quando consultada depois. | `plano_desenvolvimento.md` §4.8 ("aprovação automática de decisões técnicas de baixo risco"); comportamento já em uso por `/cdt-auto` nesta sessão |
| **needs-human** | Um valor de `status` que sinaliza que a demanda parou porque o checkpoint corrente é um sign-off (ou foi classificado como alto risco pelo modo autônomo) e precisa de um humano para prosseguir — nunca resolvido automaticamente. | `plano_desenvolvimento.md` §4.7 (enum `GateState.status`), §4.8 ("registro `needs-human` quando necessário") |
| **Aprovação (Approval)** | Um registro, dentro de `GateState.approvals`, que marca um gate/checkpoint como concluído — carrega, no mínimo, uma referência à fonte da aprovação (identificável como humana ou automática) e o instante. | `plano_desenvolvimento.md` §4.7 (campo `approvals` da interface `GateState`) |
| **Decisão (Decision)** | Um registro dentro de `GateState.decisions` — o análogo, dentro do gate, ao que `cdt journal add --kind decision` já grava no diário do processo hoje. | `plano_desenvolvimento.md` §4.7 (campo `decisions`) |
| **Artefato (ArtifactReference)** | Uma referência a algo produzido pelo gate (um documento, um arquivo de código, um ADR) — distinto de Evidência: um artefato é o **produto**, evidência é a **prova de que o produto satisfaz o critério de saída**. | `plano_desenvolvimento.md` §4.7 (campo `artifacts`) |
| **Risco (Risk)** | Um registro dentro de `GateState.risks` — algo identificado e conscientemente aceito (ou mitigado) durante o gate, análogo aos "riscos abertos" que o `CLAUDE.md` exige apresentar em todo checkpoint. | `plano_desenvolvimento.md` §4.7 (campo `risks`); `CLAUDE.md` (passo 5 do gate protocol, "the open risks") |

---

## 5. Requisitos funcionais (FR)

*Grounding para o uso de Given/When/Then:* **Specification by Example — Complete Professional Guide
§2.12/§2.13** (top **0.670**) — "behaviour a non-programmer will actually read and dispute, stated in a
vocabulary that recurs across many scenarios, whose outcome is a value someone can name" — exatamente o
caso de "este gate pode avançar?": vocabulário que se repete por todo este grupo, resultado nomeável
(`approved`/`needs-human`/recusado).

### Grupo A — Iniciar um gate (`gate start N`) — G2

**FR-1 — `gate start N` abre o gate quando N é o próximo esperado.**
> Given uma demanda com `currentGate=4`, `status="approved"` (Gate 4 já aprovado),
> When o usuário roda `conductor gate start 5`,
> Then o `GateState` transiciona para `currentGate=5`, `status="in-progress"`, `startedAt` carimbado — e
> o registro do Gate 4 permanece no histórico como `approved` (nunca sobrescrito).

**FR-2 — `gate start N` recusa pular um gate obrigatório incompleto.**
> Given uma demanda cujo Gate 3 (obrigatório) está com `status` diferente de `approved`
> (`not-started` ou `rejected`),
> When o usuário roda `conductor gate start 5` (pulando o 3 e o 4),
> Then o comando recusa, nomeando o gate obrigatório faltante (Gate 3) — nunca inicia o Gate 5
> silenciosamente. *Referência de comportamento:* `gate_land.py:_gate_completeness` responde exatamente
> esta pergunta ("existe um gate obrigatório sem aprovação?"), só que hoje no `git push`; esta fase move a
> mesma pergunta para **antes** de avançar.

**FR-3 — `gate start N` permite um salto quando a calibração de profundidade colapsou os gates
intermediários, e essa calibração está ela mesma registrada.**
> Given uma demanda cuja calibração de profundidade (decisão registrada no `GateState`, ex.: como
> `Decision`) declara "small bug: Gates 1-4 e 9-14 colapsados",
> When o usuário roda `conductor gate start 5` sem ter aberto os Gates 1-4,
> Then o comando permite — **somente** porque a decisão de colapso está registrada como evidência/decisão
> anexada à demanda, nunca como um "pular" silencioso sem rastro. Sem essa declaração registrada, o
> comportamento recai em FR-2 (recusa). *Referência:* `CLAUDE.md` ("Gate depth calibration" — a tabela de
> colapso é uma decisão explícita do início da demanda, não uma omissão).

### Grupo B — Consultar estado (`gate status`) — G1

**FR-4 — `gate status` mostra o estado observável completo sem abrir sessão.**
> Given uma demanda com `GateState` existente,
> When o usuário roda `conductor gate status` (ou `--demand <id>`),
> Then a saída mostra, no mínimo: `currentGate`, `status`, quais dos gates obrigatórios já estão
> `approved` vs. pendentes, a contagem de `evidence`/`decisions`/`risks`/`approvals` por gate, e
> `startedAt`/`completedAt` quando presentes — o suficiente para responder "esta demanda pode avançar?"
> sem reabrir a conversa que produziu o estado.

### Grupo C — Anexar evidência (`gate evidence`) — G3

**FR-5 — `gate evidence` anexa evidência ao gate corrente (ou a um gate nomeado) sempre como referência,
nunca como alegação solta.**
> Given uma demanda no Gate 5 (`in-progress`),
> When o usuário/agente roda `conductor gate evidence --gate 5 --ref <caminho-de-arquivo|commit-sha|
> test-run-id> [--note "texto"]`,
> Then um item de `Evidence` é anexado ao Gate 5 com um `ref` **obrigatório** (algo que um terceiro pode
> abrir/conferir de forma independente — mesmo contrato de `DelegationEvidence.transcript`, Fase 3) e uma
> nota opcional em texto livre; uma chamada **sem** `--ref` (só `--note`) é recusada — texto livre sozinho
> não constitui evidência, mesma disciplina de `task.ts:assertValidTaskToolResult`.

**FR-6 — `gate evidence` recusa anexar evidência a um gate que não existe para esta demanda.**
> Given uma demanda cujo `GateState` só chegou até `currentGate=6` (Gates 7-14 nunca iniciados),
> When o usuário roda `conductor gate evidence --gate 11 --ref ...`,
> Then o comando recusa, nomeando que o Gate 11 nunca foi iniciado para esta demanda — nunca cria
> silenciosamente um registro para um gate nunca aberto.

### Grupo D — Aprovar / Rejeitar (`gate approve`/`reject`) — G4

**FR-7 — `gate approve` marca o gate corrente como aprovado, atribuído a uma fonte identificável.**
> Given uma demanda no Gate 5 (`in-progress`) com ao menos um item de `Evidence` anexado,
> When um humano roda `conductor gate approve` (ou, em modo interativo, o agente apresenta o gate e o
> humano confirma pelo mesmo canal de confirmação já usado pelo Permission Gate),
> Then o Gate 5 transiciona para `status="approved"`, `completedAt` carimbado, e um registro de `Approval`
> é criado contendo **quem** aprovou (o mecanismo concreto de identificação — usuário do SO, sessão, etc.
> — é decisão de Gate 4) — nunca um `approve` que não referencia nenhuma fonte.

**FR-8 — `gate approve` recusa aprovar um gate obrigatório sem nenhuma evidência anexada.**
> Given um gate obrigatório (3, 5, 7 ou 8 — ver §9.1 sobre o 9) sem nenhum item de `Evidence`,
> When alguém roda `conductor gate approve`,
> Then o comando recusa — um gate obrigatório não pode ser aprovado "vazio". (Gates não-obrigatórios podem
> ter uma política mais frouxa; esta spec só exige a distinção, não a resolve para eles.)

**FR-9 — `gate reject` marca o gate corrente como rejeitado e bloqueia avanço.**
> Given uma demanda no Gate 3 (`in-progress`),
> When alguém roda `conductor gate reject --reason "<motivo>"`,
> Then o Gate 3 transiciona para `status="rejected"` com o motivo registrado (`Decision`/`Risk`), e
> qualquer tentativa subsequente de `gate start 4` falha (mesmo mecanismo de FR-2, generalizado:
> `rejected` bloqueia tanto quanto `not-started`) até o Gate 3 ser reaberto e re-aprovado.

**FR-10 — Aprovação automática de baixo risco é distinguível de sign-off humano.**
> Given uma decisão técnica de baixo risco, dentro de um gate **não-obrigatório**, tomada em modo
> autônomo (`conductor auto`, ou o `/cdt-auto` em uso agora mesmo por este próprio fluxo),
> When essa decisão é registrada como aprovação daquele gate,
> Then o `Approval` registrado carrega um método distinguível de um sign-off humano (mesma distinção que
> `approvalMethod` já existe hoje em `audit-trail.ts` para chamadas de ferramenta: `"human"` vs. outro
> valor) — nunca indistinguível de uma aprovação humana quando consultado depois via `gate status`.

**FR-11 — Um checkpoint de sign-off nunca é auto-aprovado; o estado fica `needs-human`.**
> Given o modo autônomo chega a um gate obrigatório (ou a qualquer checkpoint que sua própria política
> classifique como alto risco),
> When ele avalia se pode prosseguir sozinho,
> Then o `GateState.status` fica `"needs-human"` (nunca `"approved"` por um processo automatizado) e a
> execução autônoma para ali, registrando o motivo — o **mesmo** comportamento que `/cdt-auto` já pratica
> operacionalmente nesta sessão, agora tornado uma transição de estado formal e persistida, não apenas uma
> convenção de prompt.

### Grupo E — Persistência versionada — G1

**FR-12 — O `GateState` é persistido em um formato JSON com versão de schema desde a primeira escrita.**
> Given uma demanda cujo `GateState` é gravado pela primeira vez,
> When o arquivo é escrito em disco,
> Then ele carrega um campo de versão de schema — mesmo padrão já em uso no projeto para
> `.cdt/config.json`/`.cdt/recipes.json`/o JSONL do diário ("retrofitting a version onto a format already
> in the wild is guesswork; stamp it from the first write") — nunca um formato sem versão que precise ser
> adivinhado depois por heurística de forma.

### Grupo F — Idempotência e concorrência — G1/G2

**FR-13 — Aprovar um gate já aprovado é determinístico e comunicado, nunca ambíguo.**
> Given um gate já com `status="approved"`,
> When alguém roda `conductor gate approve` de novo para o mesmo gate,
> Then o comando **não** cria um segundo `Approval` redundante nem falha de forma genérica — o
> comportamento observável exato (reafirmar o estado já aprovado sem efeito adicional, ou recusar
> explicitamente com "já aprovado, use `--reopen`") é decisão de Gate 4; esta spec só exige que seja **uma
> das duas, de forma determinística e nomeada** — nunca um terceiro comportamento não especificado. Ver
> §7.1.

**FR-14 — Duas mutações concorrentes do mesmo `GateState` nunca se perdem silenciosamente.**
> Given dois comandos disparados quase simultaneamente contra o **mesmo** `GateState` (ex.: um anexando
> evidência ao Gate 5, outro aprovando o Gate 5),
> When ambos gravam,
> Then o resultado final reflete **ambas** as mutações — nunca um "último a escrever vence" que descarta
> uma delas silenciosamente. Mesma garantia que `shared-budget.ts` já entrega no domínio de tokens
> (`reserve()` debita sincronamente, sem `await` no meio, antes que qualquer outra chamada possa observar
> um valor desatualizado). O **mecanismo** exato (lock de arquivo, escrita atômica versionada/CAS) é
> decisão de Gate 4/6; o requisito observável aqui é "nenhuma mutação perdida". Ver §7.4.

**FR-15 — Estado persistido corrompido ou de formato inválido bloqueia avanço (fail-closed).**
> Given um arquivo de `GateState` no disco que não pode ser lido (erro de I/O) ou cujo JSON é
> inválido/não corresponde ao schema versionado (FR-12),
> When qualquer comando que dependa desse estado roda (`gate start`, `gate approve`, `gate reject`,
> `gate evidence`),
> Then o comando recusa a operação, reportando que o estado não pôde ser verificado — **nunca** assume
> "tudo aprovado até aqui" nem aceita o gate que a linha de comando pediu por omissão. Esta é a direção de
> falha **oposta** à do landing guard do `conductor-main` (`gate_land.py`, fail-open no `git push`) —
> deliberadamente, não por inconsistência. Ver BR-9 e §7.5.

---

## 6. Business rules

Extraídas do `CLAUDE.md` deste projeto (os 4 non-negotiable rules, aplicados aqui como regras que a
**máquina** — não só o modelo — precisa impor) e do plano §10 (invariantes 4, 10, 11).

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | Os gates 3 (segurança), 5 (test-first), 7 (CI) e 8 (validação) nunca podem ser marcados `approved` a partir de `not-started`/`rejected` sem terem sido, eles mesmos, iniciados e aprovados — independente do tamanho da demanda ou da calibração de profundidade. | `CLAUDE.md` ("Never collapse these gates... regardless of how small the change looks") | FR-2, FR-8 |
| **BR-2** | Todo gate para (`status` não avança sozinho para `approved`) até que uma aprovação — humana ou, quando elegível, automática — seja registrada; a apresentação da decisão + citações + evidências + riscos abertos é uma pré-condição do checkpoint, não um passo opcional. | `CLAUDE.md` ("Halt at every gate... Do not begin the next gate until the user explicitly says to proceed") | FR-7, FR-9, FR-11 |
| **BR-3** | Uma demanda vive em sua própria branch (`feature/`/`bugfix/`/`hotfix/`); uma aprovação de gate é seguida por um commit **nessa branch**, nunca diretamente em `main`/`develop`. O `GateState` registra a aprovação; o efeito git (o commit) é uma consequência orquestrada pelo mesmo fluxo — se o `GateState` dispara o commit diretamente ou se é um passo separado do CLI é decisão de Gate 4. | `CLAUDE.md` ("Gitflow — never work on `main` or `develop`") | FR-7 (relacionado; mecanismo exato fora do escopo desta spec) |
| **BR-4** | Toda decisão registrada em um gate deveria ser rastreável a um grounding (citação de biblioteca) quando envolve uma afirmação técnica não trivial — o campo `Decision` do `GateState` é o lugar natural para essa referência, espelhando o que `cdt journal add --kind decision` já grava hoje no processo. | `CLAUDE.md` ("Ground every non-trivial claim... An assertion with no citation fails the gate") | Grupo C (evidência), Grupo D (decisões associadas a uma aprovação) |
| **BR-5** | Todo gate possui papéis responsáveis e um critério de saída conhecidos **antes** de a máquina de estados avaliar sua completude — reusa a tabela já portada na Fase 3 (`BUILTIN_GATE_ROLES`), nunca redefine papel-por-gate dentro desta fase. | Plano §10 item 4 | Todo o Grupo A/D (pressuposto, não um FR isolado) |
| **BR-6** | Toda transição para `approved` carrega ao menos um item de evidência associado, quando o gate é obrigatório (BR-1) — uma aprovação sem nenhuma referência conferível não satisfaz o invariante. | Plano §10 item 10 | FR-8, FR-5 |
| **BR-7** | Um `Approval` de sign-off (humano) precisa ser estruturalmente distinguível — nunca apenas uma flag booleana que qualquer processo poderia setar — de um `Approval` automático de baixo risco. O mecanismo concreto de não-fabricação (de onde exatamente vem a garantia de que só um caminho humano pode produzir `approvalMethod="human"`) é decisão de Gate 4, mas o **requisito observável** é testável hoje: consultar `gate status` depois de uma aprovação nunca deve deixar ambíguo se ela foi humana ou automática. | Plano §10 item 11 ("sign-offs não podem ser fabricados") | FR-10, FR-11 |
| **BR-8** | Uma aprovação sensível (sign-off) segue a mesma disciplina que o chokepoint de aprovação de ferramentas já estabelecido na Fase 2 — canal com timeout fail-closed, rastro escrito **antes** do efeito ("pre-write, not best-effort-after", `audit-trail.ts`) — nunca um segundo mecanismo de confirmação paralelo e mais fraco. | Padrão já estabelecido (`permission-gate.ts`/`audit-trail.ts`, Fase 2); mesmo princípio "nenhum caminho de aprovação paralelo" já registrado como G0 na Fase 3 | FR-7, FR-11 |
| **BR-9** | A leitura do `GateState` para decidir `start`/`approve`/`reject` é **fail-closed**: erro de I/O ou schema inválido nega a operação, nunca assume um estado por omissão. Esta regra é a direção de falha **oposta**, e conscientemente, à do landing guard do `conductor-main` (fail-open no `git push`) — os dois são pontos de controle diferentes com consequências de falha diferentes (negar um `gate approve` custa nada além de tentar de novo; travar o `git push` de um usuário no meio de outra coisa custa mais). | Instrução explícita do orquestrador para esta fase; padrão já estabelecido em `permission-engine.ts` ("no policy declared... fail closed", citado na Fase 3 FR-20) | FR-15 |
| **BR-10** | O conjunto de gates obrigatórios usado por FR-2/FR-8/BR-1 vem de **uma única fonte canônica**, nunca duplicado à mão em dois lugares do código — mesma disciplina "single source of truth" já aplicada em `builtin-roles-data.ts` (Fase 3, comentário próprio: "DRY: one home for each piece of knowledge"). **Achado desta sessão:** o `CLAUDE.md` deste projeto nomeia `{3, 5, 7, 8}`; `conductor-main/roles.py:MANDATORY_GATES` (usado por `gate_land.py`) nomeia `{3, 5, 7, 8, 9}` — uma discrepância real, não resolvida silenciosamente aqui. Ver §9.1. | Achado desta sessão; princípio DRY já aplicado na Fase 3 | FR-2, FR-8, BR-1 |

---

## 7. Edge cases

1. **Aprovar um gate já aprovado.** Coberto por FR-13 — determinístico (idempotente **ou** erro
   explícito), nunca um terceiro comportamento. Esta spec **não decide** qual dos dois — é uma escolha de
   Gate 4 que muda a experiência de `conductor auto` (idempotente é mais amigável a um loop que tenta
   reafirmar estado; erro explícito é mais amigável a detectar um bug de orquestração que aprova duas
   vezes por engano). Registrado como pergunta aberta, §9.5.
2. **Rejeitar um gate e tentar avançar mesmo assim.** Coberto por FR-9 (transição para `rejected`) + FR-2
   generalizado (`gate start N+1` recusa quando o gate anterior não está `approved` — `rejected` bloqueia
   exatamente como `not-started`, nunca é tratado como "concluído de alguma forma").
3. **Evidência anexada a um gate que nunca foi iniciado para esta demanda.** FR-6 — recusado, nomeando o
   gate inexistente; nunca cria um registro órfão.
4. **Dois processos (ou dois comandos quase simultâneos) mutando o mesmo `GateState`.** FR-14 — mesma
   classe de problema que `shared-budget.ts` já resolveu para o orçamento compartilhado (Fase 3): o
   requisito observável é "nenhuma mutação perdida"; o mecanismo (lock, CAS, escrita atômica versionada) é
   decisão de Gate 4/6 — o padrão de referência (debitar/mutar sincronamente, sem janela `await` entre
   checar e mutar) já está provado no domínio de tokens e é diretamente transferível ao domínio de estado
   de gate.
5. **Estado persistido corrompido ou de formato inválido.** FR-15 — fail-closed: nega avanço/aprovação,
   nunca assume "tudo aprovado" por omissão. Note a assimetria deliberada com `gate_land.py` (BR-9): o
   mesmo projeto tem, propositalmente, **duas** posturas de falha diferentes em dois pontos de controle
   diferentes — não é uma inconsistência a corrigir, é a mesma disciplina de "a direção de falha é forçada
   e as duas lentes discordam" aplicada a dois pontos de controle com consequências de bloqueio muito
   diferentes (ver grounding §8.6).
6. **Um gate obrigatório sem nenhuma evidência tentando ser aprovado.** FR-8 — recusado.
7. **`gate start N` chamado com N não sequencial** (ex.: `gate start 9` quando `currentGate=2` e nenhuma
   calibração de colapso foi registrada). Coberto por FR-2/FR-3: sem uma decisão de colapso registrada
   nomeando os gates pulados, o comando recusa — o mesmo mecanismo, não um caso à parte.
8. **Modo autônomo (`conductor auto`) chega a um gate obrigatório.** FR-11 — nunca auto-aprovado; o estado
   vira `needs-human` e a execução autônoma para, com o motivo registrado.

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 2` (backend
saudável).

1. **Uso de Given/When/Then testável** → **Specification by Example — Complete Professional Guide
   §2.12/§2.13** (top **0.670**): "behaviour a non-programmer will actually read and dispute... whose
   outcome is a value someone can name" — base de todo o §5.
2. **Linguagem ubíqua / glossário de domínio** → **Domain-Driven Design — Complete Professional Guide
   §1.1/§1.12** (top **0.661**): "a single, shared vocabulary... reflected literally in the code"; "pays
   for itself... the code will be edited by people who were not in the conversation" — base da §4.
3. **Quality gate / checagens mandatórias antes de avançar** → **Spec-Driven Development — The Complete
   Book §13.3** (top **0.578**, "a set of mandatory checks that must pass before a task is considered
   complete") — base de BR-1/BR-6/G2.
4. **Definition of Done verificável, não uma alegação em texto livre** → **Spec-Driven Development §11.4**
   (top **0.678** nesta sessão — "The Machine-Checkable Definition of Done": "❌ Bad DoD: 'Endpoint working
   well.' ✅ Good DoD: '...acceptance scenario tests C-01 and C-04 pass'") e **Prompt Engineering —
   Principles, Patterns and Practice §12.4** (top **0.650**, "Done is defined by *verifiable* criteria...
   do not report completion without running the verification") — base direta do Grupo C/G3 e de BR-6: a
   exigência de evidência estruturada, não uma declaração de sucesso em texto livre, é a mesma disciplina
   que estes dois livros descrevem para "done" em geral, aplicada aqui ao retorno de um gate — a mesma
   dupla citação que fundamentou G6 na Fase 3 (`task.ts:DelegationEvidence`), reaplicada um nível acima.
5. **Fail-closed por padrão em erro/incerteza** → **Security Engineering Principles — Complete
   Professional Guide §2.2/§2.9** (top **0.676**): "Errors/uncertainty deny access (fail closed)"; "❌
   ...treats a timeout as allow (fail open)... an outage becomes an access-control bypass. ✅ Fail closed:
   any error or uncertainty denies access" — base direta de BR-9/FR-15.
6. **Duas posturas de falha opostas no mesmo sistema, cada uma correta em seu próprio ponto de controle**
   → **Secure and Reliable Systems Design — Complete Professional Guide §1.12** (top **0.608**): "The
   failure direction is forced and the lenses disagree. An authorization check must fail closed; a CDN
   edge must fail open. One fleet-wide rule picked to satisfy both fails the wrong way in one of them" —
   a mesma seção que o próprio `gate_land.py` já cita internamente para justificar SUA postura fail-open;
   usada aqui para justificar a postura **oposta** do `GateState` (fail-closed) sem contradição — são duas
   lentes diferentes (avançar um gate vs. não travar o `git push` de um usuário), cada uma com sua própria
   direção forçada. Base de BR-9 e do edge case §7.5.
7. **Aciclicidade/ordem de gates como regra de negócio, concorrência em estado persistido versionado** →
   cobertura **fraca/fora do alvo** na biblioteca (nenhum resultado específico sobre "state machine de
   gates de aprovação" ou "concorrência em arquivo JSON versionado compartilhado"). **A biblioteca não
   cobre isso especificamente** — declarado, não forçado. FR-2/FR-14 são fundamentados diretamente no
   invariante já decidido do plano (§10 itens 4/10/11) e no comportamento de referência já testado e
   presente no próprio código deste repositório (`gate_land.py:_gate_completeness`,
   `shared-budget.ts:reserve`), não em citação de biblioteca.

---

## 9. Perguntas abertas para o Gate 3 (threat model) e Gate 4 (arquitetura)

Registradas aqui porque nasceram durante a especificação, mas **não são decisões desta BA** — são insumo,
não resposta.

1. **Discrepância no conjunto de gates obrigatórios.** `CLAUDE.md` deste projeto nomeia `{3, 5, 7, 8}`
   como "never collapse". `conductor-main/roles.py:MANDATORY_GATES` (usado por `gate_land.py` e citado
   pela própria orientação desta tarefa como referência de comportamento) é `frozenset({3, 5, 7, 8, 9})` —
   inclui também o Gate 9 (pentest de aplicação). Qual conjunto o `GateState` desta fase deve impor?
   Ambos os documentos são fontes legítimas — não é seguro escolher um silenciosamente. Registrado como
   BR-10, não resolvido. Gate 3/4.
2. **Onde a distinção `evidence`/`decisions` do `GateState` se apoia enquanto a Fase 6 (Diary) não
   existe.** Esta fase precisa de ALGUM mecanismo de escrita durável (append-only, síncrono, falha
   audível) para `evidence`/`decisions`/`approvals` — é um armazenamento **próprio** do `GateState`, um
   reuso adiantado do padrão de `audit-trail.ts`, ou uma dependência explícita nomeada sobre parte da Fase
   6 sendo trazida para frente? Afeta diretamente o formato de arquivo de FR-12. Gate 4.
3. **Escopo real de "`conductor auto`" nesta fase.** O plano (§4.8) lista 7 características do modo
   autônomo; esta spec cobriu só a distinção `needs-human`/auto-approved que o critério de saída exige.
   Orçamento dedicado ao modo, paralelismo controlado e recuperação completa após interrupção — são
   entregáveis de uma fase específica ainda não identificada nas seções lidas do plano, ou refinamento
   incremental do próprio modo `conductor auto` sem uma fase nomeada? Vale confirmar contra o plano
   completo antes do Gate 4. Gate 4 (e possivelmente Gate 1 de uma fase futura).
4. **Integridade criptográfica do rastro de evidência.** Os ADRs 0002/0003 adiaram isso "para a Fase 4",
   mas os objetivos lidos da Fase 4 no plano não nomeiam hash-chain/assinatura — só "persistir
   evidências". Confirmar se os autores dos ADRs queriam dizer "o armazenamento" (satisfeito por G3 desta
   spec) ou "a integridade criptográfica desse armazenamento" (ainda sem fase nomeada). Gate 3 (ameaça:
   um `GateState` em disco, sem esse controle, pode ser editado à mão por quem tem acesso ao disco — é o
   mesmo residual já aceito por escrito nas Fases 2/3 para o audit trail, ou o cálculo muda porque agora é
   uma **aprovação** que fica editável, não só um log?).
5. **Idempotência vs. erro explícito ao reaprovar um gate já `approved`** (FR-13/edge case §7.1) — decisão
   de UX que afeta diretamente como `conductor auto` se comporta ao retomar uma demanda interrompida (ver
   pergunta 3). Gate 4.
6. **Onde o `GateState` fisicamente vive em disco** (`.cdt/`? um novo diretório `.conductor/gates/`? um
   arquivo por demanda ou um arquivo único indexado por `demandId`?) — esta spec exige "JSON versionado,
   queryable" (FR-12), nunca um caminho específico. Gate 4.
7. **Mecanismo exato do chokepoint de aprovação de sign-off** (BR-8) — literalmente `ctx.ui.confirm()`
   (`permission-gate.ts`) reaproveitado para `gate approve`, ou um canal próprio que replica a mesma
   disciplina (timeout fail-closed, pre-write durável)? Afeta diretamente como FR-7/FR-11 são
   implementados. Gate 4.

---

## Registro no diário

`cdt journal add --gate 2 --kind decision` registrado a partir de
`C:\development\source\projects\conductor` ao final desta sessão, resumindo: 15 FRs em 6 grupos, 10
business rules, a descoberta de que o `conductor-main` não tem `GateState` vivo para portar, e a
discrepância do conjunto de gates obrigatórios (`{3,5,7,8}` vs. `{3,5,7,8,9}`) como achado não resolvido
silenciosamente.
