# Gate 3 — Adendo da Fase 4: Gates e evidências (STRIDE da máquina de estados de governança)

**Demanda:** reconstruir o Conductor Coding Agent sobre o runtime Pi
(earendil-works/pi) — **Fase 4, "Gates e evidências"**.
**Branch:** `feature/fase4-gates-e-evidencias` (de `develop`).
**Papel responsável:** `security-engineer` (skill `model-threats`), executado como
subagente, Gate 3 **FULL** (gate mandatório, nunca colapsado — CLAUDE.md
"never-collapse").
**Superfície modelada = a spec da Fase 4** (`gate2-spec-fase4.md`): 15 FRs (grupos
A–F), 10 BRs, 8 edge cases, 6 goals (G1–G6). Este é o Gate 3 que a própria spec §9
(perguntas 1, 4) declarou devido a este gate.

**Natureza deste documento:** é um **adendo** que modela a **fronteira de confiança
nova** da Fase 4: a **máquina de estados de governança** (`GateState` persistido e
queryable) e seus cinco pontos de mutação (`gate start/status/evidence/approve/
reject`). É o sistema que **decide se uma demanda passou por aprovação de verdade** —
logo o invariante #11 do plano ("sign-offs não podem ser fabricados") é **diretamente
seu**, não uma prosa herdada.

> **Numeração — resolvida pelo orquestrador (correção honesta do enunciado da tarefa).**
> A tarefa original pediu "comece em T1, numeração própria da Fase 4". O subagente que
> escreveu este gate achou, ao abrir os arquivos, que isso colidiria: os adendos
> anteriores **não** são de repos diferentes — são o **mesmo repo `pi`**, em branches
> diferentes (`feature/fase2-*`, `-fase3-*`, agora `-fase4-*`), e usam uma cadeia de
> ameaças **contínua** neste mesmo diretório: Fase 0 `T1–T10` (`gate3-threat-model.md`),
> Fase 1 `T11–T16`, Fase 2 `T17–T29`, Fase 3 `T30–T39`. Um `T1` "cru" colidiria com o
> `T1` da Fase 0 assim que ambas as branches pousarem em `develop`. O subagente entregou
> com um prefixo temporário (`F4-T…`/`R-F4-…`) e sinalizou a escolha ao orquestrador sem
> decidir sozinho. **Decisão do orquestrador:** continuar a cadeia contínua — renomeado
> para `T40…T46` (ameaças) e `R22…R28` (regras vinculantes), mantendo os
> **secure-defaults 31–37** (que já continuavam 1–30 corretamente). O DFD de 6
> travessias, as ameaças `T1–T39`, os secure defaults 1–30, as regras `R1–R21` e a
> **regra-mãe fail-closed** continuam válidos e **não são re-litigados**. A discrepância
> reportada ao Gate 2 como nota N-1 (§5) foi resolvida por esta mesma renumeração.

---

## 0. O fato dominante herdado — e a torção que a Fase 4 lhe dá

A Fase 0–3 assentou o **fato dominante**: um **único processo de SO, sem sandbox**,
com o privilégio do usuário; **não há servidor de auth**, não há segundo principal, não
há kernel de isolamento. Toda garantia é **política dentro de um processo confiado**.

**A torção da Fase 4 (o achado que molda todo este documento).** As fases anteriores
governavam **atos** (uma tool call, um spawn de subagente): o objeto protegido era uma
**ação com efeito colateral**, e o chokepoint (Permission Gate) decidia allow/deny
**no instante do ato**. A Fase 4 protege um objeto de natureza diferente: um **registro
de governança persistido** — a afirmação durável "esta demanda **passou** pelo Gate N,
**aprovada por** fulano". O ataque não é mais "rode algo perigoso agora"; é **"grave um
fato de aprovação que não aconteceu"**, ou **"leia um estado e conclua avançar quando o
estado não prova isso"**. Duas consequências estruturais:

> **(a) A aprovação é o novo ativo de alto valor.** Nas fases anteriores, o pior dano
> de forjar o audit trail era **repudiação** (reescrever a história de um ato que já
> ocorreu). Aqui, forjar um `Approval` **fabrica o próprio ato de governança** — é a
> diferença entre adulterar o log de quem entrou no prédio e **assinar você mesmo a
> autorização de entrada**. O invariante #11 existe exatamente para essa nova classe.

> **(b) "Não há servidor de auth" é o fato que aperta o invariante #11.** A pergunta
> central — *o que estruturalmente impede um processo automatizado de marcar um gate
> como aprovado-por-humano quando não foi?* — não pode ser respondida por um mecanismo
> de identidade que não existe neste ambiente (não há login, não há sessão, não há PKI).
> A resposta realista para um CLI local **já está construída** e é reusada, não
> inventada (ver T40).

Este gate decide **semântica de segurança** (o que é bloqueado / fail-closed /
não-forjável / auditável); o **mecanismo** (classes, lock, formato em disco) é Gate 4.

---

## 1. Delta de superfície — as 5 superfícies novas da Fase 4

| # | Superfície | NOVO / estende | Relação com o herdado |
|---|---|---|---|
| SF1 | **Store do `GateState`** (arquivo JSON versionado, queryable, por demanda — `evidence`/`decisions`/`approvals`/`risks`/`status`/`currentGate`) | **NOVO** | Um novo *data store durável* que é **lido-e-obedecido** para decidir avanço. Análogo de escrita ao `audit-trail.ts` (append-only, síncrono, lança em falha), mas agora **estado mutável**, não log append-only |
| SF2 | **Canal de aprovação de gate** (`gate approve`, o sign-off) | **NOVO / reusa** | O invariante #11 vive aqui. Reusa o chokepoint humano da Fase 2 (`confirm.ts`/`permission-gate.ts`), não um segundo canal (BR-8) |
| SF3 | **Anexação de evidência** (`gate evidence --ref …`) | **NOVO / estende** | Generaliza o contrato `DelegationEvidence` da Fase 3 (`task.ts`) de "uma delegação" para "um gate" — evidência é **referência conferível**, não alegação |
| SF4 | **Ponto de imposição dos gates obrigatórios ao vivo** (`gate start N` recusa pular; `gate approve` recusa vazio) | **NOVO** | O análogo **LIVE** do veredito **retrospectivo** de `gate_land.py:_gate_completeness`, aplicado **antes** de avançar, não no `git push` |
| SF5 | **Registro de calibração de profundidade** (a decisão "colapsar gates X–Y", FR-3) | **NOVO** | Um *dado de política* que **libera saltos** de gate — logo, uma superfície de **bypass** se não cercada (SF4 e SF5 são adversárias por design) |

**Observação de fronteira (a que mais importa).** SF2 e SF4 juntas **são** o invariante
#11: SF2 decide *quem pode dizer "aprovado-por-humano"* e SF4 decide *quais gates não
podem ser marcados aprovados sem terem rodado*. SF5 é o vetor que tenta contornar SF4
por dentro (calibração legítima → bypass disfarçado). A postura de falha de **todas** é
**fail-closed** (BR-9/G5) — a direção **oposta e deliberada** à do `gate_land.py`
(fail-open no `git push`), pelas duas lentes diferentes que a spec §8.6 já fundamentou.

---

## 2. Ameaças novas da Fase 4 (T40 … T46)

Escala idêntica às fases anteriores: Probabilidade {Baixa, Média, Alta} × Impacto
{Baixo, Médio, Alto, Crítico}; Prioridade P1…P4. Cada mitigação é amarrada a um
primitivo real e vira uma **regra vinculante** numerada no §4.

### Sumário priorizado

| ID | Ameaça | STRIDE | Prob | Impacto | Prio | Superfície | Eixo da tarefa |
|---|---|---|---|---|---|---|---|
| **T40** | **Sign-off fabricado** — um processo automatizado (ou um chamador direto) cunha um `Approval` com `approvalMethod="human"` sem humano no loop | **S**, E, R | **Alta** | **Crítico** | **P1** | SF2/SF1 | 1 |
| **T42** | **Bypass de gate obrigatório** — `gate start 6` sem 3/5 aprovados; ou aprovar o Gate 9 (obrigatório) sem ele ter rodado | **E**, T | **Alta** | **Crítico** | **P1** | SF4 | 3 |
| **T45** | **Downgrade de calibração como bypass disfarçado** — declarar um "colapso" (FR-3) que cobre um gate obrigatório {3,5,7,8,9} | **E**, T, R | Média | **Crítico** | **P1** | SF5/SF4 | 6 |
| **T41** | **Evidência forjável** — `--ref` aponta para algo que não prova o gate (commit sem relação; teste que não rodou); ref pendurado/inexistente | **S**, R | **Alta** | **Alto** | **P1** | SF3 | 2 |
| **T46** | **Downgrade silencioso de uma recusa genuína** — um caminho de erro do reader do `GateState` produz "pode avançar/aprovado" por omissão (o espelho fail-closed dos 5 fail-opens do `gate_land.py`) | **E** (via fail-open), R | Média | **Crítico** | **P2** | SF1/SF4 | 5 |
| **T43** | **Corrupção/concorrência de estado** — duas mutações concorrentes (dois `approve`, ou `approve` ∥ `evidence`) perdem uma silenciosamente; escrita parcial deixa estado torto | **T**, D | Média | **Alto** | **P2** | SF1 | 4 |
| **T44** | **Corrupção silenciosa vs. erro de parse** — um estado **válido-mas-adulterado** (edição à mão de `status: rejected → approved`) passa pelo fail-closed de BR-9 (que só pega parse/schema) | **T**, R | Baixa | **Alto** | **P2** | SF1 | 5 |

---

### T40 — Sign-off fabricado (P1 — o invariante #11 é literalmente esta ameaça)
**STRIDE:** Spoofing (de identidade/autoridade) + Elevation + Repudiation ·
**Elemento:** SF2/SF1. **(Responde à pergunta central da tarefa e à spec §9 #1.)**

A pergunta: *o que estruturalmente impede um processo automatizado de marcar um gate
como `approved` por um **humano** quando não foi?* Três sub-vetores, do mais óbvio ao
mais sutil:

- **(a) O laço autônomo cunhando "human".** O `/cdt-auto` (em uso **agora mesmo** nesta
  sessão) roda sem humano no loop. Se ele puder gravar um `Approval{approvalMethod:
  "human"}`, o invariante #11 é violado no caminho mais provável de todos (é o
  comportamento default de um modo que "só quer avançar").
- **(b) A fonte de identidade errada.** Um CLI local **não tem servidor de auth**. As
  fontes candidatas, em força crescente:
  - *variável de ambiente* (`CONDUCTOR_HUMAN=1`, `CI=false`…) — **REJEITADA como controle
    primário.** É **autoridade ambiente**: herdada por **todo processo filho**, inclusive
    o próprio laço automatizado que ela deveria excluir; o processo automatizado a
    seta trivialmente. É **exatamente** o vetor que o `gate_land.py` já rejeitou por
    escrito ("`[skip-landing-guard]` … **never an ambient env var** — TM-GOV-CA2 threat
    E"). Um env var **nunca** é a prova de sign-off.
  - *usuário do SO* (`whoami`) — **INSUFICIENTE como prova.** Identifica a **conta**, não
    que um **humano interativo agiu**: um cron/daemon rodando como o mesmo usuário tem o
    mesmo `whoami`. É **autoridade ambiente permanente** — precisamente o que
    *Secure and Reliable Systems Design §3.8* manda **não** existir ("No standing ambient
    authority … access is granted per task"). Serve para **atribuir** um sign-off que já
    passou pelo canal certo; **não** para **provar** que ele passou.
  - *presença no canal de confirmação interativo* — **A RESPOSTA REALISTA, e já
    construída.** Verificado no código: `approvalMethod: "human"` é cunhado **somente**
    dentro de `permission-gate.ts`, **nos ramos que rodam após `ctx.ui.confirm()`
    retornar `true`** (`confirm.ts`: rejeita/timeout → **deny**, nunca allow-on-timeout;
    é "the single sink every one of the gate's four approval call sites" atravessa). O
    laço autônomo **não fia** um `ctx.ui.confirm()` interativo (é a definição de
    autônomo), logo **não consegue estruturalmente cunhar "human"** — cai em
    `needs-human` (FR-11). "Human" prova o **canal** (interativo, não-automático), não a
    **pessoa** — e é o teto honesto de um CLL local.
- **(c) O chamador direto forjando o registro.** Mesmo com (b) resolvido, se o
  `Approval` for uma struct com um campo `approvalMethod: string` que **qualquer**
  código pode setar, um bug (ou um papel de repo hostil, T37) grava `"human"` sem passar
  pelo canal. O `approvalMethod="human"` tem que ser **cunhado pelo canal**, nunca um
  valor que um chamador escolhe — o mesmo padrão do **construction-token** de
  `gate_land.py` (`CouldNotEvaluate` só nasce da factory) aplicado à origem "human".

Prob **Alta** (o caminho automatizado quer avançar por default); Impacto **Crítico** (é
a definição do invariante #11 quebrado — um gate mandatório fecha sobre uma aprovação
que ninguém deu).

**Mitigação (semântica — mecanismo é Gate 4): R22.**
(i) **`approvalMethod="human"` é produzível SÓ pelo canal de confirmação interativo já
existente** (`confirm.ts`/`permission-gate.ts`, BR-8) — nunca por env var, nunca por
`whoami` sozinho, nunca por um campo que o chamador escreve. É o **mesmo** enum
`ApprovalMethod = "human" | "yes-flag" | "allowlist" | "none"` e a **mesma** regra
FR-21/BR-11 do `audit-trail.ts` ("must always be distinguishable — never collapse
yes-flag into human"), agora aplicada ao `Approval` de um **gate**.
(ii) **O modo autônomo, por não fiar o canal interativo, é estruturalmente incapaz de
cunhar "human"** → grava `needs-human` e **para** (FR-11). Isso não é convenção de
prompt; é a mesma incapacidade estrutural que o `--yes`/allowlist já têm de virar
"human" na Fase 2.
(iii) **Residual declarado, honesto:** num SO single-user sem auth, "human" autentica o
**canal** (passou pela confirmação interativa), **não a identidade da pessoa** ao
teclado. Não se **afirma** prova de pessoa — é o mesmo teto que `audit-trail.ts` já
aceita, agora reafirmado para uma **aprovação** (ver T44 sobre a mudança de cálculo).
*Grounding:* **Secure and Reliable Systems Design §3.8** ("No standing ambient
authority; access granted per task" — mata env var e whoami-como-prova; "**Sensitive
actions require multi-party authorization**" — o sign-off é a ação sensível que exige
uma segunda parte, o humano no canal), **§3.2** (ambient standing authority é o risco
que se está evitando). **Security Engineering Principles §2.2/§2.9** (secure-by-default;
"errors/uncertainty deny access" — na ausência do canal interativo, nega "human", cai em
needs-human). *Precedente de código (não-biblioteca):* `permission-gate.ts` cunha "human"
só pós-`confirm()`; `gate_land.py` threat E rejeita env var; construction-token de
`CouldNotEvaluate`. **Nota de cobertura honesta:** a biblioteca **não cobre
especificamente "distinguir decisão humana de automatizada num audit trail local sem
servidor de auth"** — consultas desta sessão top **0.63–0.64**, material genérico de
least-privilege/ambient-authority. A semântica é fundamentada no invariante #11 do plano
+ no precedente já testado no próprio código (`approvalMethod`), **não forçada**.
**Reportado como GAP-4A ao Gate 2** (FR-7/FR-10/FR-11 e BR-7 devem nomear que "human" é
cunhado pelo canal, nunca um campo settable, e o residual "canal ≠ pessoa").

### T42 — Bypass de gate obrigatório (P1)
**STRIDE:** Elevation (avançar por cima de um controle) + Tampering · **Elemento:** SF4.
**(Responde ao eixo 3 da tarefa e à spec §9 #1.)**

Dois sub-vetores nomeados pela tarefa:
- **(a) Salto pra frente** — `gate start 6` com Gate 3 e/ou 5 (obrigatórios) ainda
  `not-started`/`rejected`. Coberto por FR-2, mas a **direção de falha** é o que este
  gate fixa: recusar **fail-closed**, **nomeando** o gate obrigatório faltante.
- **(b) Aprovar um obrigatório que não rodou** — `gate approve` no Gate 9 (pentest,
  obrigatório) quando o Gate 9 está `not-started` ou tem **zero evidência**. É a forma
  mais perigosa: não pula o gate, **finge** que ele passou. Coberto por FR-8/BR-6 (um
  obrigatório não pode ser aprovado vazio) — mas depende de uma **noção não-forjável de
  "este `Approval` é deste gate, desta demanda"**.

**Conjunto obrigatório — decisão herdada, aqui aplicada.** A discrepância BR-10/§9.1
(`CLAUDE.md` `{3,5,7,8}` vs. `roles.py:MANDATORY_GATES` `{3,5,7,8,9}`) foi **resolvida
pelo orquestrador para `{3,5,7,8,9}`** (Gate 9/pentest é mandatório, registrado no
journal do Gate 2 desta demanda). Este gate **adota `{3,5,7,8,9}`** como o piso que SF4
impõe, de **uma única fonte canônica** (BR-10 — nunca duplicado à mão), a mesma que
`gate_land.py` já consome. O `{3,5,7,8}` do `CLAUDE.md` é a lista "never-collapse" de
prosa; o **piso enforçado do `GateState` é `{3,5,7,8,9}`**.

**A forma anti-spoofing herdada, obrigatória aqui.** `gate_land.py` já resolveu "quando
um registro conta como aprovação de um gate": `_is_approval` é um **allowlist positivo por
regex** (`^\s*(spec\s+)?approved\s*->`), **nunca** um substring ("approved" ou "gate 9"
soltos numa frase mais longa não contam), e a aprovação é **chaveada por `(repo, branch)`**
(finding F1: uma aprovação de outro repo/branch não satisfaz a deste). O `GateState` deve
portar a **mesma disciplina**: um `Approval` só satisfaz o Gate N obrigatório se for
**estruturalmente** uma aprovação **daquele gate**, **daquela demanda** — nunca um match
frouxo, nunca uma aprovação emprestada de outro gate/demanda/branch.

Prob **Alta** (o caminho de menor resistência de um agente apressado é "só marca
aprovado"); Impacto **Crítico** (um gate mandatório de segurança/CI/pentest declarado
passado sem ter rodado — o dano exato que a lista never-collapse existe para impedir).

**Mitigação (semântica): R23.**
(i) `gate start N` **recusa fail-closed** se qualquer gate de `{3,5,7,8,9}` com número
`< N` (e não coberto por uma calibração registrada — R24) não está `approved`,
**nomeando** o faltante.
(ii) `gate approve` de um gate obrigatório **recusa** se o gate está `not-started`/
`rejected` **ou** tem zero `Evidence` (FR-8/BR-6) — "aprovar Gate 9 sem rodar" é
exatamente "aprovar um obrigatório vazio".
(iii) O conjunto obrigatório é `{3,5,7,8,9}`, de **fonte única canônica** (BR-10);
`rejected` bloqueia **tanto quanto** `not-started` (FR-9 generalizado).
(iv) Um `Approval` só conta para o Gate N se for **allowlist-positivo, chaveado ao gate +
demanda + branch** — a forma de `_is_approval`/D7-D8 do `gate_land.py`, nunca substring
nem emprestado.
*Grounding:* **Security Engineering Principles §2.9/§2.2** ("errors/uncertainty deny
access"; a autorização é o caminho onde "an error must never read as permission", §2.12 —
top **0.729** nesta sessão), **§2.5** (o timeout-como-allow é o bypass canônico; "start N
sem verificar o obrigatório" é a mesma classe). **Secure and Reliable Systems Design
§3.1/§3.8** (least privilege / blast-radius: um gate obrigatório é o **piso** de
privilégio que nenhum caminho reduz). *Precedente de código:* `gate_land.py:_is_approval`
(allowlist positivo) + D7/D8 (chave `(repo, branch)`) — comportamento já testado, portado
de retrospectivo para live. **A direção (fail-closed) e a forma (allowlist + chaveamento)
são vinculantes, não escolha de Gate 4.**

### T45 — Downgrade de calibração como bypass disfarçado (P1)
**STRIDE:** Elevation + Tampering + Repudiation · **Elemento:** SF5/SF4.
**(Responde ao eixo 6 da tarefa — a mais sutil.)**

O próprio `CLAUDE.md` **permite** colapsar gates para demandas pequenas (FR-3: um salto é
lícito **se** a decisão de colapso está **registrada** como evidência/decisão). Isso é
**feature, não bug** — mas cria a superfície: um agente (ou um humano com pressa, ou o
laço autônomo) declara *"small bug: colapsar Gates 1–5 e 9–14"* e usa isso para **pular um
gate obrigatório** {3,5,7,8,9} **com aparência de calibração legítima**. A questão da
tarefa — *como o `GateState` distingue "colapsado deliberadamente, registrado" de "pulado
silenciosamente"?* — tem duas metades, e a segunda é a de segurança:

- **Metade 1 (rastro):** FR-3 já resolve "deliberado vs. silencioso" — um salto só é
  permitido se há um `Decision` de calibração **registrado e atribuído**; sem ele, recai
  em T42/FR-2 (recusa). Um colapso **é** um registro auditável, nunca uma omissão.
- **Metade 2 (o teto que a calibração NUNCA baixa — a de segurança):** um `Decision` de
  calibração pode colapsar **apenas o complemento** de `{3,5,7,8,9}`. Uma calibração que
  **nomeia um gate obrigatório** é **recusada no momento de registrar** — o conjunto
  obrigatório é um **piso rígido que a calibração não alcança**, "regardless of how small
  the change looks" (CLAUDE.md never-collapse / BR-1). Assim SF5 fica **estruturalmente
  incapaz** de virar um bypass de mandatório: calibração opera só sobre gates
  não-obrigatórios.

Sub-vetor adicional (quem autoriza o colapso): declarar uma calibração **é** um ato de
governança que **rebaixa** o processo. No modo autônomo, o laço não deveria poder
**auto-declarar** um colapso amplo sem que isso fique distinguível de uma decisão humana —
a decisão de calibração carrega o **mesmo `approvalMethod`** (human vs auto) que qualquer
aprovação (T40/R22), para um leitor posterior ver *"o laço autônomo decidiu colapsar
estes gates"* vs *"um humano decidiu"* — nunca indistinguível.

Prob **Média** (exige a intenção de pular, mas o caminho existe e parece legítimo);
Impacto **Crítico** (é T42 com uma capa de legitimidade — pior, porque **passa
despercebido numa revisão** que vê "calibração registrada" e não confere o teto).

**Mitigação (semântica): R24.**
(i) Um `Decision` de calibração só pode colapsar gates **fora** de `{3,5,7,8,9}`; um que
nomeie um obrigatório é **recusado ao registrar** (o piso é intocável por calibração —
BR-1). FR-3 permite o salto **somente** sobre o complemento; sobre um obrigatório, recai
em T42.
(ii) A calibração é sempre um `Decision` **registrado e atribuído**, com `approvalMethod`
(human/auto) como qualquer aprovação (R22) — "deliberado" é sempre auditável, e "quem
deliberou" nunca é ambíguo.
(iii) `gate status` mostra **quais** gates foram colapsados por calibração e **por qual
método** — um revisor vê o rastro sem reabrir a sessão (FR-4).
*Grounding:* **Secure and Reliable Systems Design §3.1/§3.8** (least privilege: o conjunto
obrigatório é o piso que **nenhuma** concessão local reduz — "no standing ambient
authority" aplicado a "nenhuma calibração concede o poder de pular um obrigatório").
**Security Engineering Principles §2.2/§2.12** (secure-by-default; §2.12 "the failure is
extending [defaults] to every setting" — o inverso vale: **não** estender a licença de
colapso ao piso obrigatório é onde o fail-closed **deve** ficar). **Reportado como GAP-4B
ao Gate 2** (FR-3 permite o salto por calibração registrada, mas é silente sobre (a) a
calibração nunca poder cobrir `{3,5,7,8,9}` e (b) quem/qual-método autoriza o colapso).

### T41 — Evidência forjável / `--ref` que não prova o gate (P1)
**STRIDE:** Spoofing (de evidência) + Repudiation · **Elemento:** SF3.
**(Responde ao eixo 2 da tarefa — o análogo direto de T34 da Fase 3.)**

`gate evidence --ref <caminho|sha|test-run-id>` anexa uma referência. O ataque: apontar
`--ref` para algo que **não prova o que afirma** — um commit **sem relação real** com o
gate, um **arquivo de teste que nunca rodou**, um `test-run-id` inventado, ou um `--ref`
**pendurado** (aponta para nada). A Fase 3 já resolveu a classe irmã para o `task` tool
(T34/R14: `DelegationEvidence` é **derivada-do-runtime, não a palavra do subagente**). O
**mesmo princípio** se aplica, com uma distinção crítica de honestidade sobre **o que é
mecanicamente verificável**:

- **Tier 1 — integridade referencial (mecanicamente imponível, fail-closed):** um `--ref`
  tem que **resolver para algo que existe e é abrível** — um SHA real **neste repo**, um
  arquivo real, uma entrada de diário/`test-run-id` que o **runtime de fato registrou**.
  Um ref **pendurado/inexistente é recusado** (não se anexa uma evidência que ninguém
  pode abrir). É a mesma disciplina de `task.ts:assertValidTaskToolResult` (recusa um
  retorno sem referência conferível) — FR-5 já exige `--ref` obrigatório; este gate
  **fixa que o ref tem que resolver**, não só existir como string.
- **Tier 2 — relevância / "o teste realmente passou" (NÃO mecanicamente decidível):**
  provar que o commit **implementa** o trabalho do gate, ou que o teste referenciado
  **rodou e passou de verdade**, é **julgamento do revisor** — a spec já o marcou
  Non-goal explícito (§3: "verificação automática de qualidade da evidência … é processo
  de quem aprova, Gate 8/9"). O `GateState` **não** afirma que a evidência é boa; afirma
  que ela **existe, é conferível e é não-forjável no que o runtime observou**.
- **A regra de ouro (R14 portado):** **onde o runtime PODE derivar a evidência, ele
  deriva, e isso vence um `--ref` digitado à mão.** Um `test-run-id` que o **próprio
  runtime** produziu (o runner rodou, o runtime gravou o id) é evidência que o autor da
  tarefa **não pode forjar**; um `--ref` de texto livre para um teste que "passou" mas o
  runtime **nunca viu rodar** é a superfície forjável. Para um **gate obrigatório**
  (BR-6), a evidência que satisfaz "não pode ser aprovado vazio" deve preferir a forma
  **derivada-do-runtime**; um ref de texto livre não-verificável **não** é tratado como
  suficiente para fechar um obrigatório sozinho.

Prob **Alta** (um agente declara sucesso por default — exatamente T34); Impacto **Alto**
(um gate mandatório fecha sobre uma evidência que não prova nada — Gate 5 "teste passa"
que nunca rodou, no laço `/cdt-triage` onde maker e checker são ambos subagentes).

**Mitigação (semântica): R25.**
(i) `--ref` é **obrigatório** (FR-5) **e tem que resolver** para um objeto real e abrível
deste repo/runtime; um ref pendurado/inexistente é **recusado** (fail-closed).
(ii) Onde o runtime pode observar a evidência (test-run-id que ele gravou, `git diff`
real, arquivo do registro de tool-calls `write`/`edit`), essa forma **derivada-do-runtime
é preferida** e um `--ref` auto-declarado **não** a substitui para satisfazer BR-6 num
obrigatório — o mesmo "trace ≠ claim" de R14.
(iii) O `GateState` garante que a evidência **existe, é referenciável e é não-forjável no
observado** (G3); **não** obriga verificar a **relevância** (Non-goal §3, disciplina de
Gate 8/9). A distinção Tier-1/Tier-2 é **explícita**, para que "ref anexado" nunca seja
confundido com "gate provado".
*Grounding:* **Secure Code Review §2.12** ("a completed trace is evidence about that
question and about nothing else … not a coverage claim" — top 0.605 nesta sessão; o
`--ref` prova **existência**, não **relevância**), **§1.2** (mindset adversarial: a
*assumção* a violar é "o autor do `--ref` fala a verdade sobre o que ele prova").
**Security Engineering Principles §2.9** (incerteza nega — um ref que não resolve é
recusado). *Precedente de código:* `task.ts:DelegationEvidence`/`assertValidTaskToolResult`
(evidência = contrato validado, não alegação), Fase 3 R14. **Nota de cobertura honesta:** a
biblioteca **não tem capítulo de anti-forja de evidência de aprovação** (mesma lacuna
declarada em T34); ancorada por trace≠coverage + mindset-adversarial + o DoD
machine-checkable (Spec-Driven §11.4, já usado no Gate 2). **Reportado como GAP-4C ao Gate
2** (FR-5 exige `--ref` mas é silente sobre "tem que resolver" e sobre a preferência
runtime-derived para fechar um obrigatório).

### T46 — Downgrade silencioso de uma recusa genuína (P2)
**STRIDE:** Elevation (via fail-open acidental) + Repudiation · **Elemento:** SF1/SF4.
**(O espelho fail-closed da lição de `gate_land.py` — a referência que a tarefa apontou.)**

`gate_land.py` embarcou **cinco fail-opens silenciosos ao longo de sete rodadas de
pentest** (F9/F10/F11/F12/F13), **cada um** a mesma classe: **um `deny` genuíno colapsando
num caminho de fail-open** (um arquivo ilegível, um campo malformado, uma exceção
inesperada → `("allow", [])` sem stderr, sem telemetria). A lição destilada no ADR-0014:
**a propriedade tem que ser terminal, não enumeração de causas** — nenhum `allow` pode
nascer de um caminho de erro, **inclusive de uma causa que ninguém antecipou**; e o
verdict é um **tipo de 3 valores** (`Complete`/`Incomplete`/`CouldNotEvaluate`), onde um
`Incomplete` genuíno **nunca** vira `CouldNotEvaluate` (o fail-open).

O `GateState` é **fail-closed** (BR-9), a direção **oposta** — então o espelho do bug
também inverte: aqui o perigo é um caminho de erro do reader/decisor produzir **"pode
avançar / aprovado"** por omissão (um `catch` que retorna um default permissivo; um
`status` ausente lido como "aprovado até aqui"; uma exceção na verificação do obrigatório
tratada como "obrigatório satisfeito"). É a **mesma classe** que a Fase 2 corrigiu 2× (T24
`--yes`, T27 nível) e que `gate_land.py` combateu 5×, agora no domínio de estado de gate.

Prob **Média** (é um bug de implementação, não um ataque — mas a evidência histórica diz
que esta classe **reaparece** em cada rodada); Impacto **Crítico** (o backstop inteiro do
invariante #11 vira decorativo se "não consegui verificar" vira "avança").

**Mitigação (semântica): R26.**
(i) O verdict "pode avançar / gate aprovado" é produzido **somente** por um **sucesso
positivo avaliado** — nunca como default, fallback, ou valor de `catch`. Qualquer
incerteza (I/O, schema, exceção) resolve para **negar** (BR-9/G5).
(ii) Distinguir **três** estados, não dois — espelhando a `Completeness` de 3 valores do
`gate_land.py`: **`approved`** (positivo), **`refused`** (genuinamente não-aprovado),
**`could-not-verify`** (estado ilegível/corrompido). Os dois últimos **ambos bloqueiam**
(o fail-closed alinha a direção), mas ficam **distinguíveis no sinal** — um `could-not-
verify` é **loud e registrado** (não silencioso), para que o operador saiba *por que* foi
negado, sem confundir "recusei porque o gate não passou" com "recusei porque não consegui
ler o estado".
(iii) A propriedade é **terminal** (como o `TestF10ArbitraryException` do `gate_land.py`):
uma exceção de uma causa nunca-antecipada **também** nega, não avança.
*Grounding:* **Security Engineering Principles §2.9/§2.2** ("errors/uncertainty deny
access"; §2.5 timeout-como-allow é o bypass canônico — top **0.729** nesta sessão),
**§2.12** ("the authorization path, where an error must never read as permission").
**Secure and Reliable Systems Design §1.12** ("the failure direction is forced and the
lenses disagree" — a mesma seção que `gate_land.py` cita para justificar seu fail-**open**,
usada aqui para o fail-**closed** oposto, sem contradição: são duas lentes, `git push` do
usuário vs. avançar um gate). *Precedente de código:* `gate_land.py` (verdict de 3 valores,
propriedade terminal, `_could_not_evaluate` loud) — a lição inteira portada, direção
invertida. **Vinculante.**

### T43 — Corrupção/concorrência de estado (P2)
**STRIDE:** Tampering (via lost-update) + DoS · **Elemento:** SF1.
**(Responde ao eixo 4 da tarefa — a mesma classe que `shared-budget.ts` resolveu.)**

Dois `conductor gate approve` quase simultâneos, ou um `approve` concorrente com um
`evidence`-attach, sobre o **mesmo** `GateState`. Um loop ingênuo **ler→parsear→mutar→
escrever** perde uma das mutações ("last-write-wins" silencioso). O ângulo de **segurança**
(além da correção): um lost-update pode **descartar silenciosamente** um `Approval`, um
`Risk`, ou uma `Evidence` — justamente os registros duráveis dos quais o invariante
depende (um `Risk` aceito que some vira um risco não-registrado; um segundo `Approval`
que sobrescreve um `reject` concorrente). Pior: uma **escrita parcial** (crash no meio)
deixa um JSON truncado que então dispara o fail-closed de T44 — seguro, mas tem que ser
**escrita atômica** (temp+rename), para que um crash **nunca** deixe um estado meio-escrito
indistinguível de adulteração.

É a **mesma classe** que `shared-budget.ts:reserve()` já resolveu na Fase 3: debitar/mutar
**sincronamente, sem `await` no meio**, fechando a janela entre checar e mutar. Prob
**Média**; Impacto **Alto**.

**Mitigação (semântica): R27.**
(i) Uma mutação do `GateState` é **check-and-write sem janela `await`** entre ler o estado
e persistir a mudança (o padrão `reserve()` de `shared-budget.ts`), sob **escritor único**
serializado (lock de arquivo, ou compare-and-swap sobre o campo de versão do schema —
FR-12) — **nenhuma mutação concorrente é perdida silenciosamente** (FR-14).
(ii) A escrita é **atômica** (temp+rename): um crash no meio nunca deixa um estado
torto/torn observável; ou o estado antigo inteiro, ou o novo inteiro.
(iii) O **mecanismo** (lock, CAS, serialização) é Gate 4/6; o **requisito observável** —
nenhuma mutação perdida, nenhum estado meio-escrito lido — é **herdado e vinculante**
(FR-14, invariante do plano). Idempotência de re-aprovar (FR-13) é escolha de Gate 4, mas
**determinística e nomeada**, nunca um terceiro comportamento.
*Grounding:* **Secure and Reliable Systems Design §3.3** (scope/duration/failure domains —
o `GateState` é o registro de autoridade compartilhado; a mutação atômica é o que impede
que dois escritores criem uma janela). **Nota de cobertura honesta:** a biblioteca **não
cobre concorrência em arquivo JSON versionado especificamente** (declarado no Gate 2 §8 #7
desta demanda; consultas fora do alvo) — fundamentado no invariante #14 do plano + no
comportamento já testado de `shared-budget.ts:reserve()`, **não** em citação de livro.

### T44 — Corrupção silenciosa vs. erro de parse: o fail-closed de BR-9 é suficiente? (P2)
**STRIDE:** Tampering + Repudiation · **Elemento:** SF1.
**(Responde ao eixo 5 da tarefa e à spec §9 #4 — a pergunta de integridade criptográfica.)**

BR-9/FR-15/G5 já decidem: I/O error ou JSON inválido/schema-incompatível → **nega**
(fail-closed). A pergunta da tarefa: *isso é suficiente, ou precisa de hash/checksum para
detectar corrupção silenciosa vs. erro de parse óbvio?* Análise honesta, em três camadas:

- **O que BR-9 pega:** corrupção **inparseável/schema-inválida** — um arquivo truncado
  (T43), bytes corrompidos, um campo faltando. Direção correta e **necessária**;
  confirmada.
- **O que BR-9 NÃO pega:** um estado **válido-mas-adulterado** — alguém com acesso ao
  disco edita à mão `status: "rejected"` → `"approved"`, ou insere um `Approval{method:
  "human"}`, e o JSON continua **válido e schema-conforme**. Passa. É **exatamente** o
  residual que `audit-trail.ts` já declarou por escrito: *"append-only and protected, not
  cryptographically tamper-evident; an attacker with direct disk access outside the
  agent's loop could still edit it. Crypto-integrity (hash-chain/signature) is explicitly
  a later phase."*
- **A mudança de cálculo que a Fase 4 força (resposta à spec §9 #4):** a **ameaça** é a
  mesma das fases anteriores (um ator local com acesso ao disco); o **impacto sobe**.
  Editar o **audit log** reescreve a **história** de um ato (repudiação). Editar o
  **`GateState`** **fabrica a decisão de governança** — é o invariante #11 quebrado **por
  outra porta** (não pelo caminho automatizado de T40, mas pelo disco). O residual que
  era aceitável para um **log** merece **re-exame** para uma **aprovação**.

**O ponto de economia do atacante (Anderson — segurança é incentivos e trade-offs), que
decide o quê vale a pena:** um **checksum/hash guardado no mesmo arquivo (ou mesmo dir,
mesmo domínio de confiança)** **não** defende contra o ator local com acesso ao disco —
ele **recomputa o hash** depois de editar. Um checksum só detecta corrupção
**acidental/silenciosa** (bit-rot, escrita parcial de T43, uma ferramenta que meio-edita),
**não** uma edição deliberada de quem também reescreve o checksum. **Tamper-evidence real**
contra um editor local exige um **segredo/chave que o editor não tem** (HMAC com chave fora
do arquivo de estado, hash-chain ancorada onde o atacante não reescreve, ou assinatura) —
precisamente a **"integridade criptográfica"** que os ADRs 0002/0003 **adiaram** e que os
objetivos lidos da Fase 4 no plano **não nomeiam** (spec Non-goal + §9 #4).

Conclusão desta ameaça (semântica):
- **BR-9 (fail-closed em parse/schema) é confirmado e necessário** — não é substituído.
- **Um checksum/hash-sobre-conteúdo agrega valor SÓ para corrupção silenciosa/acidental**
  (torn write, bit-rot) — um ganho **real e barato**, e torna a garantia de escrita
  atômica de T43 **verificável** (um torn write falha o checksum → fail-closed,
  distinguível de um parse limpo). **Vale fazer**, enquadrado **honestamente** como
  integridade-contra-acidente, **não** tamper-evidence-contra-adversário-local.
- **Tamper-evidence real contra um editor local** (a fabricação de aprovação via disco)
  exige crypto keyed fora do arquivo — **adiado**, e o **residual tem que ser
  RE-DECLARADO** aqui com o impacto elevado (uma **aprovação** forjável, não só um log),
  para os autores dos ADRs 0002/0003 decidirem conscientemente: o residual aceito para o
  audit trail **ainda** é aceitável agora que é uma aprovação, ou o invariante #11 exige
  ao menos um HMAC keyed fora do estado?

Prob **Baixa** (exige acesso local ao disco fora do loop — o mesmo modelo de ameaça das
fases anteriores, sem sandbox); Impacto **Alto** (aprovação fabricada, invariante #11 por
outra porta).

**Mitigação (semântica): R28.**
(i) BR-9/FR-15 fail-closed em parse/schema **mantido**.
(ii) **Opcional-recomendado:** um checksum de conteúdo por `GateState` para detectar
corrupção **silenciosa/acidental** (não adversarial) — um mismatch → fail-closed
(`could-not-verify`, T46), distinguível de um parse óbvio; enquadrado como
integridade-contra-acidente, sem **afirmar** tamper-evidence.
(iii) **Residual explicitamente re-declarado, não escondido:** o `GateState` em disco,
sem crypto keyed fora dele, é **editável à mão por quem tem acesso ao disco** — e agora é
uma **aprovação**, não só um log. **Sem afirmar** integridade criptográfica.
*Grounding:* **Security Engineering Principles §2.2/§2.9** (fail-closed em parse/schema —
top 0.729). *Precedente de código + residual herdado:* `audit-trail.ts` (o residual
"not cryptographically tamper-evident … later phase" declarado literalmente). **Nota de
cobertura honesta:** a biblioteca **não cobre hash-chain/tamper-evidence de registro de
aprovação** — consulta desta sessão top **0.616**, off-target (recon/taint). O argumento
de economia-do-atacante (checksum no mesmo domínio não defende contra editor local) é
fundamentado no modelo de ameaça sem-sandbox já estabelecido (Fase 0 §0) + no residual já
aceito de `audit-trail.ts`, **não** em citação. **Reportado como GAP-4D ao Gate 2 e aos
autores dos ADRs 0002/0003** (a pergunta §9 #4 é respondida: o cálculo **muda** — é uma
aprovação agora; decidir conscientemente se o residual segue aceito ou se #11 exige HMAC
keyed).

---

## 3. Cobertura explícita dos 6 eixos do critério deste gate

| Eixo da tarefa | Ameaça(s) | Regra | Status |
|---|---|---|---|
| **1.** Sign-off fabricado (invariante #11) — fonte de identidade num CLI local sem auth | **T40** | R22 | Fechado por semântica: "human" cunhado SÓ pelo canal interativo (`confirm.ts`), nunca env var/whoami/campo settable; autônomo → `needs-human`; residual "canal ≠ pessoa" declarado. **GAP-4A** |
| **2.** Evidência forjável (`--ref` que não prova) | **T41** | R25 | Fechado: Tier-1 integridade referencial (ref tem que resolver, fail-closed) vs. Tier-2 relevância (Non-goal, revisor); runtime-derived preferido (R14 portado). **GAP-4C** |
| **3.** Bypass de gate obrigatório (`start 6` sem 3/5; aprovar 9 sem rodar) | **T42** | R23 | Fechado: `{3,5,7,8,9}` de fonte única; recusa fail-closed nomeando o faltante; obrigatório não aprova vazio; `Approval` allowlist-positivo chaveado a gate+demanda+branch (forma de `_is_approval`) |
| **4.** Corrupção/concorrência de estado | **T43** | R27 | Fechado: check-and-write sem janela `await` (padrão `reserve()`), escritor único, escrita atômica temp+rename; nenhuma mutação perdida (FR-14) |
| **5.** Fail-closed em estado corrompido — suficiente? / silent vs. parse | **T44** + **T46** | R28, R26 | Fechado honestamente: BR-9 (parse/schema) confirmado; checksum SÓ p/ corrupção acidental (não adversarial — economia do atacante); tamper-evidence real = crypto keyed adiada, **residual re-declarado** (aprovação, não log). Verdict de 3 valores, terminal, loud. **GAP-4D** |
| **6.** Downgrade de calibração como bypass disfarçado | **T45** | R24 | Fechado: calibração colapsa SÓ o complemento de `{3,5,7,8,9}`; um colapso que nomeie obrigatório é recusado ao registrar; colapso sempre `Decision` atribuído c/ método (human/auto). **GAP-4B** |

---

## 4. Regras vinculantes para o Gate 4 (arquitetura DEVE respeitar)

Semânticas de segurança (o que deve ser bloqueado / fail-closed / não-forjável /
auditado), **não** arquitetura de classes. O Gate 4 escolhe o mecanismo; **não pode
violar estas**. Continuam R1–R21 (Fases 2–3), inalteradas.

- **R22 (sign-off não-fabricável).** `approvalMethod="human"` é cunhado **somente**
  pelo canal de confirmação interativo existente (`confirm.ts`/`permission-gate.ts`, BR-8)
  — nunca por env var, nunca por `whoami` sozinho, nunca por um campo que o chamador
  escreve. O modo autônomo, sem esse canal, é **estruturalmente incapaz** de cunhar
  "human" → grava `needs-human` e para (FR-11). Mesmo enum e mesma regra FR-21/BR-11 do
  `audit-trail.ts`. Residual "canal ≠ pessoa" declarado. (T40)
- **R23 (gate obrigatório imposto ao vivo, fail-closed).** `gate start N` recusa (fail-
  closed, nomeando o faltante) se um gate de `{3,5,7,8,9}` `< N` não coberto por calibração
  não está `approved`; `gate approve` de obrigatório recusa vazio (FR-8/BR-6) ou
  `not-started`/`rejected`. Conjunto `{3,5,7,8,9}` de **fonte única canônica** (BR-10). Um
  `Approval` só conta se **allowlist-positivo, chaveado a gate+demanda+branch** (forma
  `_is_approval`/D7-D8 de `gate_land.py`), nunca substring nem emprestado. (T42)
- **R24 (calibração nunca alcança o piso obrigatório).** Um `Decision` de calibração
  colapsa SÓ gates **fora** de `{3,5,7,8,9}`; um que nomeie um obrigatório é **recusado ao
  registrar** (BR-1). Calibração é sempre um `Decision` atribuído com `approvalMethod`
  (human/auto); `gate status` mostra o que foi colapsado e por qual método. (T45)
- **R25 (evidência: integridade referencial imponível, relevância é do revisor).**
  `--ref` obrigatório **e tem que resolver** para objeto real/abrível deste repo/runtime
  (ref pendurado → recusa, fail-closed); onde o runtime observa a evidência
  (test-run-id gravado, `git diff`, registro de tool-calls), essa forma **runtime-derived
  é preferida** e um `--ref` auto-declarado não a substitui para fechar um obrigatório
  (R14 portado). Relevância ("provou mesmo?") é Non-goal (Gate 8/9). (T41)
- **R26 (verdict positivo-ou-nega, terminal, 3 valores).** "Pode avançar/aprovado" só
  de um sucesso positivo avaliado — nunca default/fallback/`catch`. Três estados
  distinguíveis: `approved` / `refused` / `could-not-verify`; os dois últimos bloqueiam,
  mas `could-not-verify` é **loud e registrado** (não silencioso). Propriedade **terminal**
  (uma exceção não-antecipada também nega). Espelho fail-closed da lição de `gate_land.py`.
  (T46)
- **R27 (mutação atômica, sem mutação perdida).** Mutação do `GateState` é
  check-and-write **sem janela `await`** (padrão `shared-budget.ts:reserve()`), escritor
  único (lock/CAS sobre a versão de schema), escrita **atômica** (temp+rename); nenhuma
  mutação concorrente perdida (FR-14), nenhum estado torn observável. Re-aprovar é
  determinístico e nomeado (FR-13). (T43)
- **R28 (fail-closed em corrupção; checksum p/ acidente, residual crypto re-declarado).**
  BR-9/FR-15 fail-closed em parse/schema mantido. Um checksum de conteúdo detecta corrupção
  **silenciosa/acidental** (→ `could-not-verify`), enquadrado como integridade-contra-
  acidente, **sem afirmar** tamper-evidence. Residual **re-declarado**: sem crypto keyed
  fora do arquivo, o `GateState` é editável por acesso ao disco — e agora é uma
  **aprovação**, não só um log (§9 #4 respondida). (T44)

---

## 5. Lacunas reportadas de volta ao Gate 2 (a spec não cobriu)

O Gate 3 é iterativo com o Gate 2/4. Estas nasceram ao modelar as ameaças e **precisam
voltar à spec** (`gate2-spec-fase4.md`) antes do Gate 5:

- **GAP-4A (FR-7/FR-10/FR-11/BR-7 não nomeiam a origem de "human" — T40).** A spec exige
  que o `Approval` seja "distinguível" (BR-7) mas é silente sobre **de onde** vem a garantia
  de não-fabricação. Adicionar: `approvalMethod="human"` é **cunhado pelo canal interativo**
  (`confirm.ts`), nunca um campo settable, nunca env var/whoami; o autônomo é
  estruturalmente incapaz de cunhá-lo (→ needs-human); residual "canal autentica, não a
  pessoa" declarado.
- **GAP-4B (FR-3 permite salto por calibração, silente sobre o piso — T45).** FR-3
  autoriza colapsar gates se registrado, mas não diz que a calibração **nunca** pode cobrir
  `{3,5,7,8,9}`, nem quem/qual-método autoriza um colapso. Adicionar: calibração opera só
  sobre o complemento do obrigatório (recusa ao registrar um que nomeie obrigatório); o
  colapso carrega `approvalMethod` (human/auto).
- **GAP-4C (FR-5 exige `--ref` mas não que ele resolva — T41).** FR-5 recusa `--note`
  sem `--ref`, mas é silente sobre o `--ref` ter que **resolver** para algo real/abrível e
  sobre a preferência **runtime-derived** para fechar um obrigatório. Adicionar Tier-1
  (referencial, imponível) vs. Tier-2 (relevância, Non-goal/revisor).
- **GAP-4D (spec §9 #4 respondida — a integridade criptográfica muda de cálculo — T44).**
  A pergunta aberta da própria spec (os ADRs 0002/0003 adiaram crypto "para a Fase 4"; os
  objetivos da Fase 4 não a nomeiam). **Resposta deste gate:** o cálculo **muda** porque
  agora o objeto editável é uma **aprovação**, não só um log — o residual aceito para o
  audit trail merece decisão consciente. Um checksum defende contra **acidente**, não
  contra o **editor local** (que recomputa o hash); tamper-evidence real = crypto keyed,
  ainda adiada. Levar aos autores dos ADRs 0002/0003 para decidir explicitamente, não por
  omissão.
- **Nota N-1 (numeração / premissa do enunciado) — RESOLVIDA.** Os adendos de Gate 3
  das Fases 0–3 vivem **no mesmo repo `pi`** (branches diferentes) e usam uma cadeia
  **contínua** `T1–T39`; não são "repos diferentes". O subagente entregou com o prefixo
  temporário `F4-T…`/`R-F4-…` e sinalizou ao orquestrador sem decidir sozinho. O
  orquestrador renomeou pra cadeia contínua: esta Fase é `T40–T46` / `R22–R28`, já
  aplicado neste documento.

---

## 5b. T47 — Achado durante a implementação do Gate 6 (não modelado no Gate 3 original): `isTTY` é um sinal local, não uma prova

**Contexto.** O loop-back Gate 8→6 implementou o canal positivo de `mintHumanApproval`
(R22/T40): `resolveConfirmChannel` decide entre o prompt TTY real e o canal headless
checando `stdin.isTTY && stdout.isTTY`. Ao demonstrar a fiação de ponta a ponta contra o
binário real (não o teste, que usa dupla de streams em memória — prática padrão, sem
ameaça), o próprio subagente precisou de um wrapper que força `isTTY` pra rodar a
demonstração sem teclado físico disponível — e isso **prova por construção** que o sinal
é falsificável.

**A ameaça (STRIDE: Spoofing).** `process.stdin.isTTY` não é uma propriedade
criptograficamente ancorada — é um booleano que reflete `isatty()` no processo real, mas
**qualquer código JS no mesmo processo pode reatribuí-lo antes de chamar `resolveConfirmChannel`**
(ex.: um script que importa `runCli`/`tty-confirm.ts` diretamente e injeta um par
`TtyStreams` fabricado com `isTTY:true` e um "y" pré-escrito). Um vetor irmão, sem
precisar de acesso ao módulo interno: **emulação real de pty** via `script`/`unbuffer`/
`expect`/`node-pty` — aí `isatty()` retorna verdadeiro de forma genuína (é um pty real,
só que dirigido por script, não por um humano), então nem é "falsificação" no sentido
estrito, é automação disfarçada de interatividade.

**Por que não bloqueia o landing desta fase (mitigação por camada, não por este mecanismo
sozinho).** Ambos os vetores exigem que o chamador já tenha capacidade de rodar código
arbitrário (`node -e`/escrever e rodar um script, ou invocar `script`/`expect`) — e
`bash`/execução de comando já é uma superfície **separadamente** gated pelo command
classifier da Fase 2 (T17/R1: comando não reconhecido nunca fica abaixo de `high`, exige
aprovação humana). Um agente autônomo que ainda não tem uma aprovação de bash já
concedida não alcança este vetor de graça; um que já tem (via `--yes` amplo ou aprovação
prévia) já teria meios mais diretos de causar dano (escrever/apagar arquivos), então
falsificar especificamente um `Approval` de gate não é uma escalação de privilégio nova
nesse cenário — é a mesma superfície de "usuário único, sem sandbox" aceita desde a
Fase 0 (§0 deste documento).

**O que muda de verdade:** isso é **mais forte** que o residual já declarado em T40/R22
("canal ≠ pessoa" — prova que o canal foi usado, não a identidade). Aqui o achado é que
**o próprio canal pode ser inteiramente simulado** por automação com privilégio de
execução de código já equivalente. Reportado honestamente, não escondido atrás do
disclaimer mais fraco de T40.

**Mitigação (residual aceito, não mecanismo novo nesta fase):**
- Nenhum hardware/segundo-fator está no escopo de um CLI local single-user (desproporcional
  ao estágio do produto — mesmo julgamento já aplicado a outros residuais desta demanda).
- **Backstop real:** a superfície de execução que habilita este vetor (`bash`) já é gated
  pela Fase 2; a defesa em profundidade certa é manter esse gate rígido, não tentar
  endurecer `isTTY` além do que ele pode structurally garantir.
- **Vinculante pro Gate 9 desta fase:** tentar de verdade os dois vetores (wrapper
  in-process forçando `isTTY`; emulação de pty via ferramenta disponível no ambiente)
  contra o binário real `bin/conductor.js`, não só documentar — confirmar se o command
  classifier da Fase 2 de fato intercepta o caminho de execução necessário, ou se há uma
  lacuna real de camada.
- **Não é um novo item da lista 31-37** (não é um secure default novo desta fase — é a
  documentação honesta do limite do secure default 31 já declarado).

---

## 6. Secure defaults acrescentados na Fase 4 (append aos itens 1–30 das fases anteriores)

Os itens 1–30 (Fases 0–3) permanecem. A Fase 4 acrescenta:

31. **Sign-off "human" cunhado só pelo canal interativo** — nunca env var/whoami/campo
    settable; autônomo → `needs-human` por incapacidade estrutural (R22/T40).
32. **Gate obrigatório `{3,5,7,8,9}` imposto ao vivo, fail-closed, de fonte única**;
    `Approval` allowlist-positivo chaveado a gate+demanda+branch (R23/T42).
33. **Calibração nunca alcança o piso obrigatório** — colapsa só o complemento; um colapso
    que nomeie obrigatório é recusado ao registrar; colapso é `Decision` atribuído c/ método
    (R24/T45).
34. **Evidência: `--ref` tem que resolver (fail-closed) + runtime-derived preferido**;
    relevância é do revisor, não da máquina (R25/T41).
35. **Verdict positivo-ou-nega, terminal, 3 valores** (`approved`/`refused`/`could-not-
    verify`), `could-not-verify` loud — espelho fail-closed de `gate_land.py` (R26/T46).
36. **Mutação atômica sem janela `await` + escrita temp+rename** — nenhuma mutação perdida,
    nenhum estado torn (R27/T43).
37. **Fail-closed em parse/schema + checksum contra acidente; residual crypto (aprovação
    editável no disco) re-declarado, não afirmado tamper-evident** (R28/T44).

**Aplicação (Pi/Conductor):** todos realizáveis sobre primitivos existentes — o canal
`confirm.ts`/`permission-gate.ts` (sign-off humano), o enum `ApprovalMethod` e a regra
"never collapse into human" (`audit-trail.ts`), o padrão `reserve()` de
`shared-budget.ts` (mutação atômica), o contrato `DelegationEvidence`/
`assertValidTaskToolResult` de `task.ts` (evidência conferível), e a lição do verdict de
3 valores + propriedade terminal de `gate_land.py` (fail-closed, direção invertida).
Nenhum mecanismo novo de confirmação é inventado (BR-8).

---

## 7. Critérios de saída deste gate (Shostack: "fizemos um bom trabalho?")

- **Cobertura:** os **6 eixos** nomeados pela tarefa têm ameaça + regra (§3); +1 bônus
  (T46, a lição de `gate_land.py`).
- **Priorização por prob × impacto:** 4× P1 (T40/T2/T3/T6 — as que quebram o invariante
  #11 ou pulam um obrigatório), 3× P2 (T43/T5/T7). Nenhuma P1 sem mitigação vinculante.
- **Secure defaults:** 7 novos (31–37), todos sobre primitivos existentes.
- **Grounding honesto:** forte em fail-closed (Security Engineering Principles §2.2/§2.9/
  §2.12/§2.5, top **0.729**) e least-privilege/ambient-authority (Secure and Reliable
  Systems Design §3.1/§3.2/§3.8, top **0.643**, inclui "multi-party authorization for
  sensitive actions"). **Declarado fraco/ausente** (não forçado): distinção humano-vs-
  automatizado em audit trail local (top 0.63–0.64), tamper-evidence de registro de
  aprovação (top 0.616), concorrência em JSON versionado (fora do alvo) — ancorados nos
  invariantes do plano (#11/#14) + precedentes de código já testados (`approvalMethod`,
  `shared-budget.ts:reserve`, `gate_land.py`, `audit-trail.ts` residual).
- **Lacunas reportadas:** 4 GAPs (4A–4D) + 1 nota de numeração de volta ao Gate 2 — o gate
  é iterativo, não terminal.
- **Iteração Gate 3↔4 (CLAUDE.md):** T40/T5 tocam decisões de arquitetura (canal de
  sign-off, formato em disco com/sem checksum) que o Gate 4 deve materializar sem violar
  R22..7; se o Gate 4 expuser uma superfície nova (ex.: um RPC/SDK que exponha `approve`
  fora do canal interativo — spec Non-goal, mas nomeado), **retornar a este gate**.
