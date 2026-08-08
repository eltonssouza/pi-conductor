# Gate 3 — Adendo da Fase 8: Autonomous mode (STRIDE do orquestrador não-atendido, do canal de sign-off e da classificação de risco)

**Demanda:** reconstruir o Conductor Coding Agent sobre o runtime Pi — **Fase 8, "Autonomous mode"**
(`conductor auto` / `--continue` / `--budget`).
**Branch:** `feature/fase8-autonomous-mode` (de `develop`).
**Papel responsável:** `security-engineer` (skill `model-threats`), executado como subagente, Gate 3
**FULL** — gate mandatório, nunca colapsado. A pergunta do never-collapse ("isto toca auth, PII, tokens
ou APIs externas?") é **sim por indireção** (a Fase 8 herda o pipeline de resolução/credencial da Fase 7)
**e**, mais grave, é a fase que **decide quando um sign-off humano pode ser pulado** e que ganha **poder de
push/PR/merge não-atendido** — três superfícies que o `CLAUDE.md` classifica como gatilho de Gate 3
completo por definição própria. A própria spec (§16-19 do cabeçalho, §9 questões 1-8) declarou este gate
devido e diferiu §9.1 (protected-path do checkpoint) explicitamente a ele.

**Superfície modelada = a spec da Fase 8** (`gate2-spec-fase8.md`): 23 FRs (grupos A-H), 10 BRs, 9 edge
cases, 8 goals (G1-G8), 8 questões abertas. Confirmei **ao vivo** (não por memória) contra o código:
`packages/conductor-cli/src/commands/gate.ts` (`ConfirmChannel`, `runGateApprove`, `GateStateStoreView`),
`packages/conductor-runtime/src/shared-budget.ts` (`createSharedBudget`, `reserve` síncrono),
`packages/conductor-runtime/src/workspace-policy.ts` (`defaultProtectedPaths()` — **confirmado: `.cdt/auto/`
NÃO está protegido hoje**, a premissa da §9.1 procede), e o teste
`packages/conductor-runtime/test/tools/task-child-gate-canary.test.ts` (**`confirmOrDeny` nega
incondicionalmente quando `!ctx.hasUI`** — a base estrutural do sink de sign-off).

**Natureza deste documento:** é um **adendo** que modela as **fronteiras de confiança novas** da Fase 8 —
três, não uma: (1) o **processo orquestrador** (`conductor auto`), que roda **não-atendido**, com
autoridade permanente sobre a branch da demanda, poder de `push`/PR/`gate approve`, dirigido por uma
**string de demanda influenciável pelo atacante**; (2) o **arquivo de run checkpoint**
(`.cdt/auto/<slug>.continue.json`), um novo store de estado de orquestração **fora do subtree protegido
hoje**; (3) a **fronteira de classificação de risco** (`--risk`/veto estático/auto-avaliação), que decide
se um run **pode começar sem supervisão** — uma **decisão de autorização** cuja entrada é texto livre
não-confiável. O princípio dominante herdado permanece (Fase 0 §0, inalterado): **um único processo de SO,
sem sandbox, com o privilégio do usuário; toda garantia é política dentro de um processo confiado.** A
Fase 8 acrescenta a esse processo o poder de **avançar gates e mutar o repositório sem um humano no laço** —
e é isso que reorganiza este gate.

> **Numeração — confirmada lendo o fim da cadeia (mesma disciplina das fases anteriores).** Enumerei
> (`Glob gate3-addendum-*.md`) e li o adendo mais recente (`gate3-addendum-fase7.md`, `git grep`). **Máximo
> atribuído em qualquer lugar:** `T73`/`R54` (Fase 7, §header), com secure-defaults estendidos a **64/65**
> pelo trabalho de Gate 9 da Fase 7 (ADR 0008 D10, confirmado em `workspace-policy.ts`). A **Fase 8 começa
> em `T74`/`R55`/secure-default `66`** — estritamente acima de qualquer número já usado, sem colisão nova.
> **Máximo atribuído agora:** `T80`/`R61`/secure-default `72`.

---

## 0. O achado central — o orquestrador é uma AUTORIDADE PERMANENTE não-atendida, e a hipótese H-Fase8 é uma trava de segurança

O fato que reorganiza tudo: `/cdt` (atendido) tinha um humano em **cada** gate — o checkpoint por gate
**era** o controle. `conductor auto` **remove esse humano** e o substitui por (a) uma classificação de
risco na entrada, (b) auto-aprovação de decisões técnicas, e (c) uma parada estrutural em sign-offs. A
segurança da fase inteira reduz-se a **três perguntas**, e cada uma é uma fronteira de confiança:

> **(a) A classificação de risco é uma decisão de AUTORIZAÇÃO sobre entrada não-confiável.** A string de
> demanda é texto livre que quem dispara o run controla (e no laço `/cdt-triage`, pode derivar de um issue/
> commit de um repo não-auditado). "Baixo risco" **autoriza o run a operar sem supervisão** — logo o veto
> estático (FR-3) é um **filtro de autorização sobre uma source tainted**, e um veto de keyword/pattern
> sobre linguagem natural é a **blocklist sobre input hostil** que Dowd/Secure Code Review §1.2 nomeia como
> o anti-padrão clássico: um blocklist decide bem o lado **rejeitar**, nunca o lado **aceitar**. Isto é
> `T74`, e é a superfície de maior valor da fase.

> **(b) O sink de sign-off tem que ser ESTRUTURALMENTE não-forjável, não convencionalmente.** Li
> `gate.ts:182` verbatim: `ConfirmChannel = (title, message) => Promise<boolean>` — um tipo de função nu.
> `runGateApprove` (`gate.ts:184-198`) aceita **qualquer** `ConfirmChannel` e entrega seu booleano direto a
> `store.approve`, que cunha via `mintHumanApproval`. A garantia de que `conductor auto` não pode fabricar
> um `true` **hoje repousa inteiramente em qual canal a fiação injeta** — o comentário diz "production
> wiring is **expected** to be `confirmOrDeny`". Nada no tipo impede `const evil: ConfirmChannel = async ()
> => true`. Isto é `T75`, o alvo nomeado do Gate 9 (FR-23) — e este gate tem que converter "expected" em
> "impossível por construção".

> **(c) O orquestrador tem autoridade PERMANENTE e AMBIENTE — o oposto de least-privilege.** Ele roda
> não-atendido com poder de `git push`, abrir PR, `gate approve` e mutar a branch da demanda por um run
> inteiro. *"No standing ambient authority; access is granted per task, scoped and time-bound"* (Secure and
> Reliable Systems Design §3.8, top **0.720** nesta rodada). Um orquestrador comprometido, com bug, ou
> alimentado por uma demanda maliciosa é um **failure domain plano**: seu blast radius é tudo que o processo
> confiado alcança. Isto ancora `T76` (privilégio do orquestrador) e `T77` (exfil de segredo por auto-push).

Este gate decide **semântica de segurança** (o que é não-forjável / fail-closed / não-confiável / com
blast-radius contido); o **mecanismo** (onde `conductor auto` vive fisicamente — spec §9.5; o mecanismo
exato da auto-avaliação — §9.4; o valor default de `--budget` — §9.7; o sequenciamento do veto — §9.8) é do
Gate 4, e **estas regras (R55-R61) vinculam qualquer uma das opções**.

### Diagrama de fronteiras de confiança (DFD, Shostack §2.5/§2.3)

```
                       ╔════════════════════════════╗
   string de demanda   ║ Disparador (humano OU um    ║  ← NÃO CONFIÁVEL: texto livre; no laço /cdt-triage
   (auth? PII? tokens?) ║ issue/commit de repo não-   ║    deriva de repo não-auditado (T74)
        │               ║ auditado no /cdt-triage)    ║
        ▼               ╚════════════════════════════╝
  ══[FRONTEIRA: classificação = decisão de AUTORIZAÇÃO sobre input tainted]══════════════════ (T74/R55)
        │
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ CONFIÁVEL — o processo orquestrador `conductor auto` (SO single-user, sem sandbox)    │
  │                                                                                       │
  │  ┌───────────────────────┐  veto estático (reject-only) + auto-avaliação fail-closed  │
  │  │ Classificador de risco│ ──► baixo risco? ── não ──► needs-human, para ANTES do G1  │
  │  └───────────────────────┘         │ sim                                              │
  │           │                        ▼                                                  │
  │           │              ┌──────────────────┐  delega trabalho substantivo (Task)     │
  │           │              │ Loop de gates     │ ───────────► subagentes de papel        │
  │           │              │ (o MESMO gate     │              (mesmos de /cdt) ── budget ─┼─► SharedBudget
  │           │              │  start/evidence/  │                                         │   (1 instância,
  │           │              │  approve/calibrate)│  passo de aprovação de gate obrigatório│    por referência,
  │           │              └──────────────────┘         │                                │    T79/R60)
  │           │                        │                  ▼                                │
  │           │                        │      ┌────────────────────────┐                  │
  │           │  escreve/relê          │      │ ConfirmChannel          │  headless        │
  │           ▼  (hint-only, BR-5)     │      │ = confirmOrDeny (!hasUI │  → false         │
  │  ┌──────────────────────┐          │      │   → false) | mint só via│  SEMPRE          │
  │  │ Run checkpoint        │◄─────────┘      │   mintHumanApproval     │  (T75/R56)       │
  │  │ .cdt/auto/<slug>.json │ demand_branch / │└────────────────────────┘                 │
  │  │ (FORA do protected-   │ depth_calibration/ deferred_human_decisions                 │
  │  │  path hoje — T78)     │  = campos NÃO derivados de GateState                        │
  │  └──────────────────────┘                                                             │
  │           │ push / PR / merge (autoridade permanente, não-atendida — T76/R57)         │
  └───────────┼───────────────────────────────────────────────────────────────────────────┘
              ▼  ══[FRONTEIRA: rede + git remote]══►  origin (branch da demanda, develop, PR)
                  auto-commit/push pode vazar segredo / diff over-broad / branch errada (T77/R58)
```

Regras de rótulo STRIDE-per-element (Threat Modeling §3.3): **entidade externa** (disparador, git remote) →
S,R; **processo** (orquestrador, classificador) → todos os seis; **data store** (run checkpoint) → T,R,I,D;
**data flow** (auto-push, egress de resolução herdado) → T,I,D. As fronteiras que importam são as três
linhas duplas `══`: (1) classificação sobre input tainted; (2) sink de sign-off headless; (3) auto-push ao
remote.

---

## 1. Delta de superfície — as 3 superfícies novas da Fase 8

| # | Superfície | NOVO / estende | Relação com o herdado |
|---|---|---|---|
| SF-A1 | **Classificador de risco** (`--risk` / veto estático / auto-avaliação) — decide se o run começa sem supervisão | **NOVO** | Filtro de autorização sobre a string de demanda (source tainted). O piso é o mesmo do Gate 3 do `CLAUDE.md` (auth/PII/tokens/APIs externas); a evasão é T74 |
| SF-A2 | **Processo orquestrador** — loop de gates não-atendido com push/PR/merge/`gate approve` | **NOVO / compõe sobre `GateStateStoreView`** | Nunca um segundo mutador de `GateState` nem um segundo caminho de aprovação (a trava H-Fase8). Autoridade permanente = T76; o sink de sign-off é T75 |
| SF-A3 | **Run checkpoint** (`.cdt/auto/<slug>.continue.json`) — novo store de estado de orquestração | **NOVO / fora do protected-path** | Hint-only, sempre reverificado contra `GateState` (BR-5). Fecha o vetor de avanço de gate; os campos não-derivados-de-`GateState` (`demand_branch`, `depth_calibration`, `deferred_human_decisions`) são T78 e a matéria da §9.1 |

**Observação de fronteira (a que mais importa).** A Fase 8 **não** introduz nenhum provedor, processo ou
sink de rede novo: a resolução de modelo, o egress de fallback/health-check e o ledger são **literalmente**
os da Fase 7, reusados sem segunda lógica (spec Grupo G, FR-20/21; §7 deste doc responde à pergunta padrão
de egress). O delta de segurança é inteiramente sobre **quem decide e quem aprova quando não há humano no
laço** — as três superfícies acima. Um `Model` só executa um gate sob as MESMAS três metades ANDadas da
Fase 7 (autorizado explicitamente ∧ tier mínimo ∧ egress-consentido, R46-R48); a Fase 8 apenas remove o
humano que, no `/cdt`, era a testemunha default dessas decisões — e é por isso que a cláusula "sem humano
para consentir → bloqueado por default" de R47 deixa de ser um caso de borda e vira **load-bearing** (T80).

---

## 2. Ameaças novas da Fase 8 (T74 … T80)

Escala idêntica às fases anteriores: Probabilidade {Baixa, Média, Alta} × Impacto {Baixo, Médio, Alto,
Crítico}; Prioridade P1…P4. Cada mitigação vira uma **regra vinculante** numerada no §4.

### Sumário priorizado (top 5 = T74, T75, T76, T77, T78)

| ID | Ameaça | STRIDE | Prob | Impacto | Prio | Superfície |
|---|---|---|---|---|---|---|
| **T74** | **Evasão da classificação de risco** — uma demanda auth/PII/tokens descrita com palavras que não casam o veto estático (ou cujo dano vive no diff, não na descrição) é classificada "baixo risco" e roda **não-atendida** | **E** (run sem supervisão autorizado), **S** (demanda de alto risco se passa por baixo), **T** (da decisão de classificação) | **Alta** | **Alto** | **P1** | SF-A1 |
| **T75** | **`ConfirmChannel` sintético resolve `true`** — a fiação de `conductor auto` constrói (por bug ou malícia) um canal `async () => true` em vez de vincular a `confirmOrDeny`, e um gate obrigatório é "aprovado" sem humano; a invariante 11 ("sign-offs não podem ser fabricados") cai | **S** (de um aprovador humano), **E** (bypass do sign-off), **R** (aprovação atribuída a "human" sem human) | Média | **Crítico** | **P1** | SF-A2 |
| **T76** | **Orquestrador com autoridade permanente e ambiente** — um orquestrador comprometido/bugado/alimentado por demanda maliciosa usa seu poder não-atendido de push/PR/merge/`gate approve` sobre o blast radius inteiro do processo confiado | **E**, **T** (do repo/estado), **I** | Média | **Crítico** | **P1** | SF-A2 |
| **T77** | **Auto-commit/push vaza segredo, diff over-broad, ou branch errada** — o auto-push (FR-18) commita um `.env`/chave que um subagente escreveu, ou um diff além do escopo do gate, e o **empurra ao remote** sem um humano revisando o `git diff` | **I** (exfil de segredo ao remote), **T** (histórico), **E** | Média | **Alto** | **P2** | SF-A2 |
| **T78** | **Tamper do run checkpoint nos campos NÃO-derivados-de-`GateState`** — BR-5 fecha o avanço de gate, mas `demand_branch` (push/land na branch errada), `depth_calibration` (colapsar um gate não-mandatório) e `deferred_human_decisions` (suprimir a VISIBILIDADE de um sign-off pendente) não são reverificados por FR-7 se a fiação confiar neles | **T**, **E** (branch), **R**/**D** (suprimir detecção do pendente) | Média | **Médio** | **P2** | SF-A3 |
| **T79** | **Exaustão de budget como DoS intra-run / evasão do teto** — um subagente malicioso/bugado do run queima o `SharedBudget` compartilhado para forçar um halt prematuro do trabalho legítimo; ou tenta um segundo contador para evadir o teto | **D**, **E** (financeiro, evadir) | Baixa | Médio | **P3** | SF-A2 |
| **T80** | **Fallback cross-provider no laço sem humano para consentir** (re-bind de T66/R47) — o egress herdado da Fase 7, agora operado num loop que **removeu** a testemunha default; a cláusula "sem humano → bloqueado" de R47 passa a ser a única defesa | **I**, **S** (de destino) | Baixa | **Alto** | **P3** | SF-A2 (herdada) |

---

### T74 — Evasão da classificação de risco (P1 — a superfície de maior valor da fase)
**STRIDE:** Elevation (um run que precisava de humano é autorizado a rodar sem supervisão) + Spoofing (uma
demanda de alto risco se passa por baixo risco) + Tampering (da decisão de classificação) · **Elemento:**
SF-A1.

FR-3 define um **veto estático de keyword/pattern** sobre a descrição/diff da demanda; FR-4 default
fail-closed sob incerteza. O ataque tem duas formas, e a primeira é estrutural, não um bug:

- **(a) Evasão semântica do veto (o inerente).** O veto opera sobre **linguagem natural que o disparador
  controla**. Nenhuma lista finita de keywords cobre todas as formas de expressar intenção auth-touching:
  "melhorar como o sistema lembra de quem é a pessoa entre visitas" **é** sessão/autenticação sem conter
  "auth/login/token/senha/credencial/PII". Descrições em outro idioma, homóglifos, perífrase, ou
  simplesmente escopo enxuto ("arrumar a página de perfil") que **esconde** que o diff toca `auth.ts`. Um
  blocklist sobre input hostil decide bem o lado **rejeitar** e **nunca** o lado **aceitar** — tratar
  "não-casou" como "logo, baixo risco" é a inversão fail-open (a mesma classe de T68 da Fase 7, e do budget
  fail-open T33a da Fase 2, agora na porta da classificação).
- **(b) Descrição benigna, diff hostil.** A descrição passa o veto porque o dano real vive no **código que o
  run vai escrever**, não na frase. *"O risco real senta numa configuração que ninguém colocou no escopo"*
  (Secure Code Review §1.12).

**Por que o impacto é Alto e não Crítico — o backstop estrutural.** A mis-classificação compra ao atacante
um **run autônomo**, nunca um **merge não-revisado**: (i) a classificação **jamais colapsa um gate
mandatório** — `runGateCalibrate` (`gate.ts:205-218`) só aceita `--collapse` de gates não-mandatórios, e o
store recusa qualquer colapso de `{3,5,7,8,9}` (R24). Logo o **Gate 3 (security) sempre dispara sobre o
diff REAL**, não sobre a descrição; (ii) Gate 3/8/9 são obrigatórios e headless → `confirmOrDeny` → false →
`needs-human` (T75/R56 abaixo), então o run **para** ao alcançar a revisão de segurança, antes de qualquer
merge. A janela de dano da evasão é: **trabalho autônomo desperdiçado até o primeiro gate mandatório** +
uma promessa de shift-left enfraquecida + budget queimado — não código de auth aterrissado sem revisão.

**Mitigação (semântica — mecanismo é Gate 4): R55.**
(i) **O veto estático é REJECT-ONLY e nunca um caminho de ACEITE.** Um casamento → recusa (alta recall no
lado rejeitar é o objetivo — errar para "casou" é seguro); um não-casamento **nunca** é lido como "baixo
risco" (FR-4 já: a auto-avaliação fail-closed sob incerteza é o que decide o aceite, não a ausência de
veto).
(ii) **A classificação nunca colapsa um gate mandatório e nunca é a defesa final** — é a **primeira** de
várias camadas independentes (Security Engineering §1.5, defesa em profundidade): a camada decisiva é o
**Gate 3/9 sobre o diff real**, que a classificação é estruturalmente incapaz de pular (R24/MANDATORY_GATES).
(iii) **Preferir o sinal do DIFF/caminho-de-arquivo sobre a descrição, e re-avaliar o veto a cada fronteira
de gate conforme o diff materializa** — o atacante controla a descrição, mas um arquivo escrito em
`auth`/`credentials`/`*.pem`/`.env` é observável e re-dispara o veto (taint source→sink, Secure Code Review
§2.2: a descrição é uma source, o run autônomo sobre superfície sensível é o sink).
(iv) **`--risk=low` é registrado como `method:"human"` (afirmado), distinto de uma auto-avaliação
`method:"auto"`** (FR-5) — nunca colapsa os dois, e **nunca** sobrepõe o veto (BR-2). O override tentado
contra o veto é registrado como "recusado", nem aceito nem ignorado em silêncio (edge 1/8).

Prob **Alta** (uma descrição evasiva é trivial de escrever; no `/cdt-triage` a demanda vem de repo
não-auditado por design); Impacto **Alto** (erode o shift-left e desperdiça budget autônomo sobre superfície
sensível — mas o piso mandatório impede o merge não-revisado, por isso Alto e não Crítico; um único bug
futuro que deixe a classificação colapsar o Gate 3, ou ler o veto como aceite, o eleva a Crítico — daí P1).

*Grounding:* **forte** — **Secure Code Review §1.2/§1.12/§2.2** (top **0.635**: "assume inputs are hostile,
look for what the code *fails* to defend against"; "manual adversarial review is irreplaceable exactly
where authorization and business logic sit — the classes no rule decides every time"; taint source→sink);
**Security Engineering Principles §2.2** (0.603: secure defaults / failing safely — "não-casou" tem que
falhar para o lado seguro); **Prompt Engineering PPP §13.5** (Router with Unclear Lane, herdado da spec
§8.1: rota unclear cabeada para humano). **Vinculante pro Gate 4 (mecanismo da auto-avaliação, §9.4) e pro
Gate 9 (verificação empírica — §7b).**

### T75 — `ConfirmChannel` sintético resolve `true` (P1 — o alvo nomeado do Gate 9; a invariante 11 em risco)
**STRIDE:** Spoofing (de um aprovador humano) + Elevation (bypass do sign-off obrigatório) + Repudiation
(uma `Approval{method:"human"}` sem human, não-atribuível a ninguém) · **Elemento:** SF-A2.

Este é o falsificador explícito da hipótese H-Fase8 e o alvo nomeado do Gate 9 (FR-22/FR-23/BR-8). O que li
no código torna a ameaça **concreta, não hipotética**:
- `ConfirmChannel = (title, message) => Promise<boolean>` é um **tipo de função nu** (`gate.ts:182`).
- `runGateApprove` (`gate.ts:184-198`) aceita **qualquer** valor desse tipo e entrega seu booleano direto a
  `store.approve`, que cunha via `mintHumanApproval`.
- A defesa real existe e é boa **onde é exercida**: `confirmOrDeny` **nega incondicionalmente quando
  `!ctx.hasUI`** (provado por `task-child-gate-canary.test.ts:31/114`), e `mintHumanApproval` é o **único**
  ponto que cunha `method:"human"`, só a partir de um `confirmResult` que já veio do canal.
- **Mas** nada no tipo ou na assinatura impede a fiação de `conductor auto` de injetar `const c:
  ConfirmChannel = async () => true`. A garantia de hoje é **convencional** ("production wiring is
  *expected* to be `confirmOrDeny`"), não **estrutural**. `conductor auto` é precisamente o novo chamador
  headless de alto risco onde essa convenção é a única coisa entre o loop e um sign-off fabricado.

**Mitigação (semântica): R56.**
(i) **`conductor auto` NUNCA constrói um `ConfirmChannel` próprio.** Ele **recebe por injeção** o MESMO
canal fail-closed que todo chamador headless usa — `confirmOrDeny` (Pi) ou `createTtyConfirmChannel` (CLI,
`tty-confirm.ts`) — de um composition root único; um literal `async () => true` no código do orquestrador é
proibido por revisão E, idealmente, tornado inexpressável (o orquestrador recebe um `ConfirmChannel` já
construído, nunca a liberdade de fabricá-lo). Reuso sobre reimplementação, exatamente como a Fase 7 exigiu
para o storage de credencial (R50).
(ii) **Defesa em profundidade — o mint cruza o ambiente, não só o booleano.** Como `conductor auto` é
headless **por definição** (FR-22), a garantia não deve depender de "o canal certo foi injetado": o caminho
de mint (`mintHumanApproval`/`store.approve`) deve **cruzar o `hasUI`/TTY real** de modo que um processo sem
UI seja **estruturalmente incapaz** de produzir uma `Approval{method:"human"}`, mesmo que um `true`
sintético chegue. Assim, fabricar um sign-off exige **duas** falhas independentes (um canal comprometido
**E** um `hasUI` spoofado), nunca uma linha de fiação errada.
(iii) **Gate obrigatório headless resolve `needs-human` e o run PARA** (FR-14) — nunca re-tenta o confirm,
nunca cai para um segundo canal. `needs-human` é um `GateStatus` já existente; nenhum valor novo no enum
(precedente ADR 0008 D4).

Prob **Média** (no modelo de processo confiado, a ameaça é um **bug de fiação** ou um **contribuidor
malicioso** no próprio `conductor auto`, não um atacante externo — mas a fiação headless auto-aprovadora é
exatamente onde esse bug é natural, e o custo de nunca o cometer é uma decisão de arquitetura, não de
disciplina); Impacto **Crítico** (um gate obrigatório — incluindo o Gate 9 pentest — "passa" sem o humano
que o define; a invariante 11 do plano cai; é o pior resultado possível da fase).

*Grounding:* **herdado e re-confirmado** — a base é o grounding já registrado pelo ADR 0005 §6 da
demanda-mãe (**Building Secure and Reliable Systems §3.3/§3.8** — "sensitive actions require multi-party
authorization"; **Security Engineering Principles §2.9/§2.12** — "uncertainty deny; an error must never read
as permission"), re-confirmado nesta rodada por **Security Engineering §2.2** (0.603, secure-by-default /
fail-safe) e **Secure and Reliable Systems Design §3.3** (0.639, zero-trust: um canal alcançável não é
implicitamente confiável). *Precedente de código:* `gate.ts:103-107/182/188-197`,
`task-child-gate-canary.test.ts` (`!hasUI → deny`), `gate-store.ts:318` (`mintHumanApproval`). **Vinculante
pro Gate 4 (a decisão de onde o composition root injeta o canal) e pro Gate 9 (verificação empírica —
§7b).**

### T76 — Orquestrador com autoridade permanente e ambiente (P1 — o failure domain plano)
**STRIDE:** Elevation + Tampering (do repo/estado) + Information Disclosure · **Elemento:** SF-A2.

`conductor auto` roda **não-atendido** com poder de `git push`, abrir PR, `gate approve` (via T75) e mutar a
branch da demanda por um run inteiro — **autoridade permanente, ambiente, não escopada por gate**. É o
oposto exato de least-privilege: *"a flat blast radius where any compromise reaches the whole system"*
(Secure and Reliable Systems §3.11). Um orquestrador comprometido (dependência maliciosa), com bug (um loop
que não para onde devia), ou alimentado por uma demanda hostil, exerce todo o alcance do processo confiado.

**Mitigação (semântica): R57.**
(i) **A autoridade do orquestrador é a MESMA superfície já existente, nunca uma nova.** `conductor auto`
compõe sobre `GateStateStoreView`/`gate *` (nunca um segundo mutador de `GateState`) e sobre o mesmo
protocolo de git do `/cdt` — a trava H-Fase8. Isso **contém o blast radius ao que essas superfícies já
autorizam**: os protected-paths (`.conductor/gates/`, `audit.jsonl`, credenciais — `workspace-policy.ts`)
continuam negando as escritas sensíveis aos subagentes; o orquestrador não ganha uma porta lateral.
(ii) **Escopo por-run, não ambiente:** o orquestrador opera **na branch da demanda** e **nunca** em
`main`/`develop` diretamente (gitflow, `CLAUDE.md` regra 4); o landing em `develop` é a única saída, via
merge/PR (FR-15) — e um PR num remote que exige review reintroduz o humano por construção. `SharedBudget`
(R60) **é** o limite de tempo/recurso do run (o análogo do "time-bound" de §3.8).
(iii) **Detectabilidade é parte da defesa (o teto herdado é aceito, não negado):** num SO single-user sem
sandbox, um processo confiado com o privilégio do usuário **pode**, em última instância, fazer o que o
usuário pode — R57 fecha a **autoridade automática/silenciosa** (o incidente), não a **autoridade deliberada
do usuário** (uso legítimo). O freio residual é o **audit trail** append-only (`audit.jsonl`, protegido) +
o registro por-gate no diário: toda auto-decisão e toda parada é uma `Decision` consultável sem reabrir o
transcript (FR-6/BR-1) — o risco é reduzido a um nível **detectável**, não a zero.

Prob **Média** (é a capacidade nova e poderosa da fase; a superfície de comprometimento é a cadeia de deps +
a própria lógica do loop); Impacto **Crítico** (blast radius do processo confiado inteiro). 

*Grounding:* **forte** — **Secure and Reliable Systems Design §3.1/§3.8/§3.2/§3.11/§3.5** (top **0.720**:
"no standing ambient authority; access granted per task; scoped and time-bound; a stolen credential is
contained"), **§3.12** (0.645: "the reachable authority must be enumerated first" — o blast radius do
orquestrador tem que ser conhecido, que é o que a composição-sobre-superfície-existente garante). *Precedente
de código:* `workspace-policy.ts` (`defaultProtectedPaths`), `gate.ts` (`GateStateStoreView`), a trava
H-Fase8 (spec cabeçalho). **Vinculante pro Gate 4 e pro Gate 9.**

### T77 — Auto-commit/push vaza segredo, diff over-broad, ou branch errada (P2)
**STRIDE:** Information Disclosure (exfil de segredo ao remote) + Tampering (do histórico) + Elevation ·
**Elemento:** SF-A2.

FR-18 torna **automático** o que no `/cdt` era um `git commit`+`push` sob olho humano. Três realizações:
- **(a) Segredo commitado.** Um subagente escreve um `.env`/chave/token no workspace (legítimo ou por
  prompt-injection), o auto-commit o inclui, e o push o **exfiltra ao remote** — irreversível numa branch
  pública/PR. *"No secrets are present in any bundle"* (Penetration Testing §14.9).
- **(b) Diff over-broad.** O commit do gate arrasta mudanças além do escopo daquele gate (arquivos não
  relacionados, artefatos de build), poluindo o rastro por-gate que G6/BR-10 existe para manter limpo.
- **(c) Branch errada.** Push/land na branch errada (ligado a T78 via `demand_branch`).

**A pergunta explícita da tarefa: precisa de um secret-scan próprio antes do push, ou herda as garantias
existentes? Resposta: precisa de um gate de secret-scan pré-push próprio — a redação de sinks da Fase 6 NÃO
o cobre.** A disciplina de redação (`REDACTION_SINKS`, T62/Fase 6) protege os **sinks de log/transcript/
ledger/diário** contra imprimir segredos — ela **não** varre o **working tree** antes de um `git add`. Um
`.env` no disco nunca passa por um sink de redação; ele passa por `git`. Logo:

**Mitigação (semântica): R58.**
(i) **Um secret-scan do diff staged é pré-condição fail-closed do auto-push** (o Gate 7 já manda gitleaks/
trivy no pipeline — `CLAUDE.md` Gate 7; aqui ele tem que rodar **antes** de o orquestrador empurrar, não só
no CI depois): um segredo detectado **bloqueia o push** e converte o run em `needs-human`, nunca "empurra e
conserta depois". Defesa em profundidade com o secret-scan do CI (Security Engineering §1.5), não em vez
dele.
(ii) **O commit por gate é escopado ao diff daquele gate** (FR-18/FR-19: um gate sem mudança não commita) —
o auto-commit nunca é um `git add -A` cego sobre tudo que o working tree acumulou.
(iii) **A branch de push/land é a `GateState.branch` autoritativa, cruzada contra `demand_branch`** (T78/
R59) — nunca a branch que o checkpoint afirma sozinho.

Prob **Média** (segredos no working tree são comuns; auto-push remove a revisão humana que os pegaria);
Impacto **Alto** (exfil irreversível de segredo ao remote; comprometimento do provedor/serviço associado).

*Grounding:* **forte** — **Penetration Testing §14.9/§14.2** (top **0.647**: "No secrets in any bundle;
supply-chain/secrets como vetor de breach líder"), **§14.5** ("no secret ships"); **Security Engineering
Principles §1.5** (0.639: defesa em profundidade em camadas independentes — o scan pré-push **e** o do CI).
*Precedente:* `CLAUDE.md` Gate 7 (gitleaks/trivy), `REDACTION_SINKS` (a disciplina de redação de sinks, que
este achado mostra **não** cobrir o working tree). **Vinculante pro Gate 4/6 (o secret-scan pré-push é um
passo real do orquestrador) e pro Gate 9.**

### T78 — Tamper do run checkpoint nos campos não-derivados-de-`GateState` (P2 — a matéria da §9.1)
**STRIDE:** Tampering + Elevation (via `demand_branch`) + Repudiation/DoS-de-detecção (via
`deferred_human_decisions`) · **Elemento:** SF-A3.

BR-5/FR-7 fecham **completamente** o vetor de **avanço de gate**: `last_gate`/`next_gate` são hint-only,
sempre reverificados contra o `GateState` real (`gate status` — que carrega `.currentGate` e o array de
`GateRecordSnapshot`, `gate.ts:78-87`); um checkpoint forjado nunca avança um gate porque a autoridade é o
`GateState` protegido em `.conductor/gates/`. **Confirmo que este vetor está fechado.** Mas o schema do
checkpoint (FR-9) tem **três campos que NÃO são derivados de `GateState`** e que uma fiação de `--continue`
ingênua poderia confiar:

- **`demand_branch`** → decide qual branch o orquestrador faz push/land. Se confiado cegamente, um
  checkpoint adulterado aponta o push a uma branch errada (edge 9 já nomeia o mismatch, mas resolve por uma
  **disciplina de código** — "conteúdo, não nome" — que um edit futuro pode esquecer). **`GateStatusSnapshot`
  carrega `.branch` autoritativo** (`gate.ts:80`): o cruzamento é possível e barato.
- **`depth_calibration`** → decide quais gates colapsar na retomada. O piso `{3,5,7,8,9}` é estruturalmente
  incolapsável (R24), então o pior caso é colapsar um gate **não-mandatório** — dano **limitado**, mas real.
  **`GateStatusSnapshot.calibration`** é a calibração autoritativa (`gate.ts:71-86`, registrada por
  `calibrate()`): a retomada deve **re-derivá-la de lá**, nunca lê-la do checkpoint.
- **`deferred_human_decisions`** → lista o que está pendente de sign-off. Suprimir uma entrada **não**
  bypassa o sign-off (a aprovação real é `confirmOrDeny`, T75 — o gate obrigatório ainda para em
  `needs-human`), mas **degrada a DETECTABILIDADE**: um operador lendo o checkpoint veria "nada pendente"
  quando há. Detectabilidade é uma propriedade de segurança.

**Mitigação (semântica): R59.** **Estender BR-5 de "last_gate/next_gate" para TODOS os campos:** em
`--continue`, o orquestrador **re-deriva `demand_branch`, `depth_calibration` e o conjunto de sign-offs
pendentes do `GateState` autoritativo** (`GateStatusSnapshot.branch`/`.calibration`/`.gates[].status ==
needs-human`), tratando as cópias do checkpoint como **hint puro**; um descompasso é **reportado e falha
fechada** (nunca avança cegamente), na disciplina "conteúdo, não nome, é a verdade" que o envelope de
`GateState` já aplica (ADR 0005 §3.1). O checkpoint ausente/corrompido nunca bloqueia (FR-8).

Prob **Média** (o checkpoint está **fora do protected-path hoje** — confirmado em `workspace-policy.ts` —,
logo gravável pelos próprios subagentes sob prompt-injection); Impacto **Médio** (o pior caso é
push-em-branch-errada ou colapso de gate não-mandatório ou cegueira de detecção — nenhum bypassa um gate
mandatório, que continua ancorado no `GateState` protegido; por isso Médio, não Alto).

*Grounding:* **herdado** — **Secure and Reliable Systems Design §2.12** (spec §8.3, "when not to rely on
recovery as the control" — o checkpoint só é seguro como PONTEIRO para onde reverificar, nunca como o estado
confiável), re-confirmado por **Secure and Reliable Systems §3.3** (0.639, zero-trust: um dado alcançável/
gravável não é implicitamente confiável). *Precedente de código:* `gate.ts:78-87` (`GateStatusSnapshot`
carrega branch+calibration+status — a fonte autoritativa para re-derivar), `workspace-policy.ts`
(`defaultProtectedPaths` sem `.cdt/auto/`). **Resolve a §9.1 (abaixo). Vinculante pro Gate 4 e pro Gate 9.**

### T79 — Exaustão de budget como DoS intra-run / evasão do teto (P3)
**STRIDE:** Denial of Service + Elevation (financeiro) · **Elemento:** SF-A2.

Dois vetores, ambos amplamente fechados por construção:
- **(a) Evadir o teto** — impossível por construção: `createSharedBudget` é chamado **uma vez** no
  composition root e passado **por referência** (`shared-budget.ts:59-68`); `reserve()` debita
  **sincronamente** antes de retornar (`:74-86`), fechando a corrida reserve→settle; e o parâmetro
  `sharedBudget` do `task` tool é **não-opcional** — "no code path can construct a child's own budget
  instead of reusing this one" (erro de compilação TS, não convenção — R16b). Um subagente **não pode**
  criar um segundo contador.
- **(b) DoS intra-run** — um subagente que queima o budget compartilhado força um halt do trabalho legítimo.
  Mas o halt é **gracioso** (FR-11/FR-16: `budget-exceeded` → checkpoint, diário, push, para — nunca um
  `BudgetExhaustedError` não-capturado como crash), e o teto compartilhado é **o mesmo failure domain do
  run** — não há contaminação cross-run. O residual (um subagente comprometido faminto de recursos dos
  irmãos **dentro** do mesmo run) é o **trade-off aceito** de um teto compartilhado (blast radius contido a
  um run); sub-budgets por-subagente seriam outro mecanismo (non-goal, spec §3/§9.6).

**Mitigação (semântica): R60.** `--budget N` constrói/vincula a **MESMA** instância de `SharedBudget` do run
(FR-10, nunca um segundo contador); omitir `--budget` aplica um **default do produto**, nunca "sem teto"
(FR-12); esgotamento **para graciosamente** (FR-11), distinto de `needs-human` (FR-16, causas diferentes:
operacional vs. autoridade humana). O teto é de **tokens**, não de dólares (BR-6 herdada: `costUsd` colapsa
para `null` legitimamente, F1/ADR 0008 — um teto em $ não pode ser fail-closed contra um `null` legítimo).

Prob **Baixa** (exige um subagente comprometido/bugado no mesmo run; a evasão do teto é impossível por
construção); Impacto **Médio** (halt prematuro do trabalho legítimo — recuperável via `--continue`, não
catastrófico).

*Grounding:* **forte** — **Secure and Reliable Systems Design §1.5/§1.3** (herdado de T70/Fase 7: bounded
attempts, prevenir amplificação); **Pragmatic Programming Practices §1.4** (spec §8.2, single source of
truth — o budget tem UM lar). *Precedente de código:* `shared-budget.ts` (`createSharedBudget`/`reserve`
síncrono/R16a/R16b, verificado ao vivo). **Vinculante pro Gate 9.**

### T80 — Fallback cross-provider no laço sem humano para consentir (P3 — re-bind de T66/R47)
**STRIDE:** Information Disclosure + Spoofing (de destino de egress) · **Elemento:** SF-A2 (herdada de SF-P5
da Fase 7).

A Fase 8 **não** cria egress novo. Mas ela é a fase que opera o egress herdado (fallback cross-provider,
health-check) num loop que **removeu a testemunha humana default** do `/cdt`. R47 (Fase 7) já prevê isto —
"no laço não-atendido, cross-provider é **bloqueado por default** (a ausência de humano para consentir É a
condição fail-closed)" — mas no `/cdt` essa cláusula era um caso de borda; na Fase 8 ela é a **única**
defesa e portanto **load-bearing**.

**Mitigação (semântica): R61.** `conductor auto` **herda R46/R47/R48 sem relaxamento**: nenhuma resolução
auto-descobre por credencial ambiente (R46/T65), nenhum fallback cruza provedor sem consentimento explícito
(R47/T66) — e como o loop não pode sintetizar seu próprio consentimento (senão o consentimento é vácuo,
mesma leitura de BR-8/T75), **cross-provider fica bloqueado por default no run**; um gate cuja resolução
exige cruzar provedor **para** como `needs-human`, nunca cruza sozinho. O piso de tier (R48) e o fail-closed
da resolução (R49) continuam valendo integralmente.

Prob **Baixa** (exige o primário indisponível **E** um candidato cross-provider **E** o loop rodando);
Impacto **Alto** (conteúdo local — possivelmente sob revisão de segurança — encaminhado a um provedor
não-escolhido, repetidamente e sem testemunha). Baixa×Alto = P3, mas nomeado para que o Gate 9 não redescubra
a superfície.

*Grounding:* **herdado integralmente de T66/R47 (Fase 7)** — Security Engineering §2.12; Secure and Reliable
Systems §3.3 (zero-trust); Data Protection & GDPR §1.1 (purpose limitation). **Vinculante pro Gate 9.**

---

## 3. Cobertura explícita dos eixos do critério deste gate

Os 7 eixos que a tarefa nomeou têm, cada um, ameaça + regra. Avaliei vetores adicionais (confused-deputy do
orquestrador reescrevendo sua própria política — subsumido por T76/R57 + os protected-paths existentes;
injection via a descrição da demanda chegando a um subagente — a mesma família de conteúdo-recuperado-hostil
já modelada, e o backstop mandatório de T74 a contém) e **concluí que os 7 cobrem o conjunto material** —
sem padding.

| Eixo da tarefa | Ameaça | Regra | Status |
|---|---|---|---|
| **1. Orquestrador não-atendido comprometido/bugado/malicioso** | **T76** (+T75 para o sign-off) | R57 (+R56) | Fechado na direção: compõe sobre superfície existente (blast radius contido), escopo por-run, gitflow, audit trail. Residual: teto do processo confiado (T17/R1), detectável não zero |
| **2. Run checkpoint forjado** | **T78** | R59 | **Avanço de gate: fechado por BR-5 (confirmo).** Campos não-derivados-de-`GateState` (branch/calibration/deferred): fechados estendendo BR-5 a re-derivar TODOS do `GateState` autoritativo. **Resolve §9.1** |
| **3. Evasão do veto / mis-classificação low-risk** | **T74** | R55 | Fechado em profundidade: veto reject-only (nunca aceite), auto-avaliação fail-closed, sinal de diff > descrição, e o backstop estrutural (Gate 3/9 sobre o diff real, incolapsáveis). A superfície de maior valor |
| **4. `ConfirmChannel`/`confirmOrDeny` binding** | **T75** | R56 | Fechado por design: `conductor auto` nunca constrói o canal (injeção do sink único) + o mint cruza `hasUI` (duas falhas independentes). **Alvo nomeado do Gate 9 (FR-23)** |
| **5. Budget/`SharedBudget` sharing** | **T79** | R60 | Evasão do teto: impossível por construção (instância única por referência, `reserve` síncrono, param não-opcional). DoS intra-run: halt gracioso, blast radius = 1 run. Residual aceito (sub-budgets = non-goal) |
| **6. Auto-commit/push/PR** | **T77** | R58 | Fechado: **secret-scan pré-push próprio** (a redação de sinks NÃO cobre o working tree — achado), commit escopado ao gate, branch = `GateState` autoritativo. Defesa em profundidade com o scan do CI |
| **7. Egress-consent (BR6)** | **T80** | R61 | **Resposta explícita abaixo (§7). Sem egress NOVO**; re-bind da cláusula "sem humano → bloqueado" de R47 ao contexto não-atendido, agora load-bearing |

---

## 4. Regras vinculantes para o Gate 4 (arquitetura DEVE respeitar)

Semânticas de segurança (não arquitetura de classes). O Gate 4 escolhe o mecanismo (onde `conductor auto`
vive — §9.5; o mecanismo da auto-avaliação — §9.4; o default de `--budget` — §9.7; o sequenciamento do veto
— §9.8); **não pode violar estas.** Continuam **R1-R54** (Fases 2-7), inalteradas.

- **R55 (a classificação de risco é reject-only + fail-closed + backstopped, nunca a defesa final).** O veto
  estático casa → recusa (alta recall no rejeitar); não-casar **nunca** é lido como baixo risco (a
  auto-avaliação fail-closed decide o aceite, FR-4). Preferir o sinal de diff/caminho-de-arquivo sobre a
  descrição; re-avaliar o veto a cada fronteira de gate. A classificação **nunca** colapsa um gate
  mandatório (R24) — a camada decisiva é o Gate 3/9 sobre o diff real. `--risk=low` é `method:"human"`,
  nunca sobrepõe o veto (BR-2). (T74)
- **R56 (o sink de sign-off é estruturalmente não-forjável, não convencionalmente).** `conductor auto`
  **nunca** constrói um `ConfirmChannel` próprio — recebe por injeção o mesmo canal fail-closed de todo
  chamador headless (`confirmOrDeny`/`createTtyConfirmChannel`); um `async () => true` é inexpressável no
  orquestrador. Defesa em profundidade: o mint (`mintHumanApproval`/`store.approve`) **cruza o `hasUI`/TTY
  real** — um processo sem UI é estruturalmente incapaz de cunhar `method:"human"`. Gate obrigatório
  headless → `needs-human` e para (FR-14). (T75 — alvo do Gate 9)
- **R57 (a autoridade do orquestrador é a superfície existente, escopada por-run, não ambiente).** Compõe
  sobre `GateStateStoreView`/`gate *` (nunca 2º mutador) e o protocolo git do `/cdt` (nunca em `main`/
  `develop` direto; land via merge/PR); os protected-paths existentes contêm o blast radius; `SharedBudget`
  é o limite temporal; toda auto-decisão/parada é uma `Decision` no audit trail + diário (detectável).
  Residual declarado: teto do processo confiado (T17/R1). (T76)
- **R58 (auto-push tem um secret-scan pré-push fail-closed próprio; commit escopado; branch autoritativa).**
  Um scan de segredos do diff staged **bloqueia o push** e vira `needs-human` na detecção — defesa em
  profundidade com o scan do CI (Gate 7), **não** em vez dele (a redação de sinks da Fase 6 NÃO cobre o
  working tree). Commit escopado ao gate (FR-18/19), nunca `git add -A` cego. Branch = `GateState.branch`,
  cruzada contra `demand_branch`. (T77)
- **R59 (BR-5 estende-se a TODOS os campos do checkpoint, não só last_gate/next_gate).** Em `--continue`,
  `demand_branch`, `depth_calibration` e o conjunto de sign-offs pendentes são **re-derivados do `GateState`
  autoritativo** (`GateStatusSnapshot.branch`/`.calibration`/`.gates[].status`), com o checkpoint como hint
  puro; descompasso → reportado e fail-closed (ADR 0005 §3.1). Ausente/corrompido nunca bloqueia (FR-8).
  (T78 — resolve §9.1)
- **R60 (`--budget` é a instância única de `SharedBudget` do run; esgotamento para graciosamente).** Nunca
  um 2º contador (R16b, por construção TS); default aplicado quando omitido, nunca "sem teto" (FR-12);
  `budget-exceeded` é parada graciosa distinta de `needs-human` (FR-11/16); teto de tokens, não de dólares
  (BR-6/F1). (T79)
- **R61 (`conductor auto` herda R46/R47/R48/R49 sem relaxamento; cross-provider bloqueado por default no
  run).** Nenhuma auto-descoberta por credencial ambiente (R46); nenhum fallback cross-provider sem
  consentimento — e como o loop não pode sintetizar consentimento, cross-provider é bloqueado por default,
  o gate para como `needs-human` (R47); piso de tier (R48) e fail-closed da resolução (R49) integrais. (T80)

---

## 5. Lacunas reportadas de volta ao Gate 2 (a spec não cobriu / deve cravar)

O Gate 3 é iterativo com o Gate 2/4. Estas nasceram ao modelar as ameaças e **devem voltar à spec**
(`gate2-spec-fase8.md`) antes do Gate 5:

- **GAP-8A (T74 — o veto estático é reject-only; a spec deve cravar que não-casar ≠ baixo risco).** FR-3
  descreve o veto como filtro; o threat model acrescenta a metade crítica: um blocklist sobre input hostil
  **nunca** autoriza pelo lado do não-casamento, e o sinal de **diff/caminho** deve pesar sobre a descrição.
  FR-3/FR-4 devem nomear ambos, e nomear o **backstop estrutural** (Gate 3/9 incolapsáveis sobre o diff
  real) como a camada decisiva, não a classificação.
- **GAP-8B (T77 — a spec não tem secret-scan pré-push; a redação de sinks não cobre o working tree).** FR-18
  descreve o auto-commit/push; o threat model acrescenta que ele precisa de um **gate de secret-scan
  fail-closed antes do push**, distinto do scan do CI (Gate 7) e distinto da redação de sinks da Fase 6 (que
  protege logs, não `git add`). FR-18 deve nomeá-lo. **Insumo direto ao Gate 4/6.**
- **GAP-8C (T78 — BR-5 deve cobrir explicitamente `demand_branch`/`depth_calibration`/`deferred_human_decisions`).**
  BR-5/FR-7 falam de "reverificar contra o `GateState`" mas o exemplo é `next_gate`; o threat model mostra
  que os três campos não-derivados-de-`GateState` precisam do MESMO tratamento (re-derivar do autoritativo),
  senão a fiação pode confiá-los. BR-5 deve cravar "TODOS os campos são hint; nenhum é autoritativo".
- **GAP-8D (T75 — a spec deve nomear a defesa em profundidade `hasUI` além da injeção do canal).** FR-22/BR-8
  garantem o binding a `confirmOrDeny`; o threat model acrescenta que o binding sozinho é **convencional**
  (o tipo não o força) e recomenda a 2ª camada: o mint cruza `hasUI`, de modo que fabricar um sign-off exija
  duas falhas independentes. FR-22 deve adotar a formulação estrutural.

**Nota de numeração.** A Fase 8 começa em `T74`/`R55`/secure-default `66`, estritamente acima do máximo já
atribuído (`T73`/`R54`/`65`), sem colisão nova.

---

## 6. Secure defaults acrescentados na Fase 8 (append aos itens 1-65 das fases anteriores)

Os itens 1-65 (Fases 0-7) permanecem. A Fase 8 acrescenta:

66. **A classificação de risco é reject-only e nunca a defesa final** — o veto casa → recusa; não-casar
    nunca autoriza baixo risco; a camada decisiva é o Gate 3/9 sobre o diff real, incolapsável (R55/T74).
67. **`conductor auto` nunca constrói seu próprio `ConfirmChannel`** — injeta o sink fail-closed único; o
    mint cruza `hasUI`, tornando um sign-off fabricado dependente de duas falhas independentes (R56/T75).
68. **A autoridade do orquestrador é a superfície existente, escopada por-run** — nunca um 2º mutador nem
    porta lateral; nunca `main`/`develop` direto; blast radius contido pelos protected-paths + audit trail
    (R57/T76).
69. **O auto-push tem um secret-scan pré-push fail-closed próprio** — bloqueia o push na detecção; defesa em
    profundidade com o CI, não em vez dele; a redação de sinks não cobre o working tree (R58/T77).
70. **Todos os campos do run checkpoint são hint-only** — em `--continue`, branch/calibration/pendentes são
    re-derivados do `GateState` autoritativo; descompasso → fail-closed (R59/T78).
71. **`--budget` é a instância única de `SharedBudget`; esgotamento para graciosamente** — nunca 2º
    contador; nunca "sem teto"; `budget-exceeded` distinto de `needs-human` (R60/T79).
72. **O `.cdt/auto/` (run checkpoint) entra em `defaultProtectedPaths()`** — defesa em profundidade sobre
    BR-5; o subtree de estado de orquestração fica tão inescrevível pelos tools de write/edit/bash quanto
    `.conductor/gates/` já é (R59/§9.1).

**Aplicação (Pi/Conductor):** todos realizáveis sobre primitivos existentes — o `GateStateStoreView`/
`gate *` (R57), `confirmOrDeny`/`mintHumanApproval`/`createTtyConfirmChannel` + o `!hasUI` já testado (R56),
`createSharedBudget` por-referência (R60), `defaultProtectedPaths()`/`isWithinRoot` (§9.1/R59), o
gitleaks/trivy que o Gate 7 já invoca (R58), e a distinção `method:"human"|"auto"` de `GateApprovalMethod`
(R55). Nenhum mecanismo novo é inventado; o Gate 4 os materializa em TS sem violar R55-R61.

---

## §9.1 — RESOLUÇÃO: adicionar `.cdt/auto/` a `defaultProtectedPaths()` (SIM — defesa em profundidade que vale)

A spec §9.1 me pediu para decidir: dado que BR-5 já neutraliza o checkpoint forjado (nunca confiado para
avançar um gate), proteger o caminho ainda vale como defesa-em-profundidade, ou é cerimônia sem efeito?

**Decisão: SIM, adicionar. Não porque BR-5 seja insuficiente para o que ela cobre, mas porque a proteção
fecha um vetor real que BR-5 sozinha não toca, e remove uma inconsistência na deny-list.** O raciocínio, na
disciplina "duas camadas, nenhuma sozinha basta" que o ADR 0005 §9.1 já aplicou a `.conductor/gates/`:

1. **BR-5 fecha o AVANÇO DE GATE completamente (confirmo ao vivo).** `last_gate`/`next_gate` são reverificados
   contra o `GateState` protegido; um checkpoint forjado nunca avança um gate. Pelo teste do confused-deputy,
   ESSES campos passam sem precisar de protected-path.
2. **Mas três campos NÃO são derivados de `GateState` (T78) e influenciam comportamento se confiados:**
   `demand_branch` (push/land na branch errada), `depth_calibration` (colapsar um gate não-mandatório),
   `deferred_human_decisions` (cegar a detecção de um pendente). R59 fecha isso re-derivando do `GateState` —
   **mas R59 é uma disciplina de código que um edit futuro pode esquecer.** O protected-path é a **segunda
   camada** que sobrevive a esse esquecimento: mesmo que a fiação de `--continue` volte a confiar num campo,
   o checkpoint **não pôde ser adulterado por um subagente sob prompt-injection** em primeiro lugar.
3. **A doutrina do confused-deputy em `defaultProtectedPaths()` já protege TODO outro estado de governança do
   Conductor** — `config.json`, `policy.json`, `policy-trust.json`, `audit.jsonl`, `gates/`, `.conductor-agent`
   — precisamente para que os tools de write/edit/bash de um subagente não mutem os arquivos que governam o
   loop. O run checkpoint é estado de governança de orquestração da **mesma família**; deixá-lo gravável é uma
   **inconsistência na deny-list**, e o custo de fechá-la é **uma linha** (`join(workspaceRoot, ".cdt",
   "auto")` no ramo `workspaceRoot` de `defaultProtectedPaths()`).
4. **A proteção NÃO atrapalha o orquestrador.** Como o `gate *` escreve `.conductor/gates/` (que é protegido)
   por um caminho dedicado que **não** passa por `pi.on("tool_call")`, o escritor do checkpoint é igualmente
   um caminho dedicado do orquestrador — ele escreve livremente; apenas os **tools dos subagentes** são
   negados, que é exatamente o correto (um subagente não tem razão legítima para escrever o run checkpoint).

**Portanto:** o controle primário permanece BR-5 (conteúdo-não-nome, re-derivar do `GateState` — R59); o
protected-path é a **segunda camada independente** (Security Engineering §1.5, defesa em profundidade),
convertendo os três campos não-derivados de "protegidos só por uma disciplina que a fiação deve lembrar" em
"inescrevíveis pelo agente por construção". **Vale — baixo custo, fecha um vetor de tamper real (ainda que
limitado), e alinha a deny-list.**

**Caveat de path para o Gate 4 (mesmo padrão "onde vive decide a superfície" de T73/R54(iii)):** a spec diz
`.cdt/auto/`, mas TODO o resto do estado de governança do runtime vive sob `.conductor/` (gates/, audit.jsonl,
config.json). **Recomendo que o run checkpoint viva sob `.conductor/auto/`** (consistente, herda o subtree
protegido pela mesma linha que já protege `gates/`) — ou, se `.cdt/auto/` for deliberado, adicionar
`.cdt/auto/` explicitamente. O Gate 4 crava o path; R59/secure-default 72 vinculam qualquer escolha.

**Nota lateral, §9.2 (tensão "Gates 1-8" vs. `{3,5,7,8,9}`) — dimensão de segurança:** embora a §9.2 seja
formalmente do Gate 3/4, ela tem consequência de segurança direta e resolvo-a na mesma direção que o ADR 0005
§4 e o OQ#2 da Fase 7 já resolveram: **o piso mandatório vence a prosa antiga** (código/regra vigente pesa
mais que a frase "Gates 1-8" anterior à formalização do never-collapse). `conductor auto` **nunca** auto-avança
além de um gate mandatório não-aprovado; o Gate 9 (pentest de aplicação) é estruturalmente inatingível sem
`needs-human` no headless (T75/R56), independentemente de a demanda ser "baixo risco". A leitura de FR-15 é
"no mínimo até o Gate 8, continuando por qualquer gate que a calibração exija, **nunca pulando `{3,5,7,8,9}`**".

---

## 7. Pergunta padrão de egress-consent (BR6) — RESPOSTA EXPLÍCITA

> *"Este recurso encaminha conteúdo revisado/do usuário para um modelo, provedor ou processo diferente do
> que o usuário está ativamente usando?"*

**Resposta: NÃO introduz nenhuma superfície de egress NOVA.** Verifiquei contra os mecanismos do ADR 0008
(não por suposição): `conductor auto` **reusa literalmente** a resolução de modelo por-gate da Fase 7
(`resolveModelForGate`/`evaluateModelPrecondition`, spec Grupo G/FR-20/21) — nenhum provedor novo, nenhum
sink de rede novo, nenhum processo novo. O único egress que um run pode disparar é o **mesmo** fallback
cross-provider / health-check que a Fase 7 já modelou (T66/T70) e já governou (R47/R51: divulgar destino,
piso do mesmo provedor default, fail-closed se inalcançável, opt-in explícito para cruzar).

**A ÚNICA mudança de segurança que a Fase 8 traz ao egress é indireta e a nomeio como T80/R61:** o loop
**remove a testemunha humana default** do `/cdt`. R47 já previa o modo não-atendido ("sem humano para
consentir → bloqueado por default") — mas o que era caso de borda no `/cdt` torna-se **a única defesa** na
Fase 8. Logo `conductor auto` herda R46/R47/R48/R49 **sem relaxamento**, e cross-provider fica **bloqueado
por default no run** (o gate para como `needs-human`, nunca cruza sozinho). Nenhuma nova disclosure de
destino é necessária além da que R47 já exige; nenhum novo opt-in é criado; a política de egress da Fase 7 é
a política da Fase 8, com a cláusula não-atendida promovida de borda a load-bearing. **BR6 satisfeita: sem
egress novo; a defesa herdada é confirmada como suficiente e reforçada por T80/R61.**

---

## 8. Critérios de saída deste gate (Shostack: "fizemos um bom trabalho?")

- **Cobertura:** as 3 fronteiras novas (classificação sobre input tainted, sink de sign-off headless,
  orquestrador com autoridade permanente) e as 3 superfícies (SF-A1/A2/A3) são modeladas; os 7 eixos
  nomeados pela tarefa têm, cada um, ameaça + regra (§3); avaliei e descartei vetores adicionais com
  justificativa.
- **Priorização por prob × impacto:** 3× P1 (T74 evasão da classificação — a superfície de maior valor; T75
  sign-off sintético — o alvo do Gate 9; T76 orquestrador over-privileged), 2× P2 (T77 exfil por auto-push,
  T78 tamper do checkpoint), 2× P3 (T79 budget DoS/evasão — fechado por construção, T80 egress re-bind).
  Nenhuma sem mitigação vinculante; nenhum finding crítico/alto não-mitigado em aberto no nível de design.
- **§9.1 resolvida:** SIM, adicionar `.cdt/auto/` (idealmente `.conductor/auto/`) a `defaultProtectedPaths()`
  — defesa em profundidade que fecha o vetor de tamper dos campos não-derivados-de-`GateState`, com o path
  final decidido pelo Gate 4.
- **§9.2 (dimensão de segurança) resolvida:** o piso mandatório `{3,5,7,8,9}` vence a prosa "Gates 1-8"; o
  Gate 9 é estruturalmente inatingível sem `needs-human`.
- **BR6 (egress) respondida:** sem egress novo; herança de R46/R47 sem relaxamento, cláusula não-atendida
  promovida a load-bearing (T80/R61).
- **Secure defaults:** 7 novos (66-72), todos sobre primitivos existentes.
- **Grounding honesto:** **forte** em least-privilege/blast-radius (Secure and Reliable Systems Design
  §3.1/§3.8/§3.2/§3.11/§3.5/§3.12, top **0.720**), taint/adversarial-input (Secure Code Review §1.2/§1.12/
  §2.2, top **0.635**), secret-scanning/supply-chain (Penetration Testing §14.9/§14.2/§14.5, top **0.647**),
  defesa em profundidade + secure-by-default (Security Engineering Principles §1.5/§2.2/§2.12, top **0.639**).
  **Herdado** (não re-forçado) para o sink de sign-off não-forjável: ADR 0005 §6 da demanda-mãe (Building
  Secure and Reliable Systems §3.3/§3.8 multi-party authorization; Security Engineering §2.9/§2.12
  uncertainty-deny) — a mesma disciplina de "não re-forçar citação já estabelecida" das fases anteriores.
- **Lacunas reportadas:** 4 GAPs (8A-8D) de volta ao Gate 2, + nota de numeração.
- **Iteração Gate 3↔4 (CLAUDE.md):** T74 (o mecanismo da auto-avaliação), T75 (onde o composition root
  injeta o canal), T77 (o passo de secret-scan pré-push), T78/§9.1 (o path do checkpoint) tocam decisões de
  arquitetura que o Gate 4 deve materializar sem violar R55-R61; se o Gate 4 expuser uma superfície nova
  (ex.: um daemon/serviço de background para o orquestrador — hoje non-goal §3; um cache que persista a
  classificação de risco reabrindo uma fronteira de dados), **retornar a este gate**.

### 8b. Vinculante pro Gate 9 (verificação empírica de pentest — padrão §7b das Fases 4-7)

Exploração real contra o binário/pipeline, no **scratch-dir isolado** obrigatório para qualquer execução de
comando (achado da Fase 2), não só documentação:

1. **T74 — evasão da classificação.** Disparar `conductor auto` com uma descrição auth-touching redigida sem
   nenhuma keyword do veto (ex.: "melhorar a continuidade de sessão entre visitas") e confirmar que **ou** o
   veto de diff/caminho a pega ao materializar, **ou** — se passar o intake — o Gate 3 mandatório sobre o
   diff real **para** o run como `needs-human` antes de qualquer merge. Confirmar que a classificação nunca
   colapsou `{3,5,7,8,9}`.
2. **T75 — sign-off sintético (o alvo nomeado, FR-23).** Tentar forçar `conductor auto` a aprovar um gate
   obrigatório injetando um `ConfirmChannel` que resolve `true`; confirmar que (a) o composition root não
   permite o orquestrador construir seu próprio canal, e (b) mesmo um `true` sintético não cunha
   `method:"human"` porque o mint cruza `hasUI:false`. A `Approval` resultante nunca é "human" sem human.
3. **T76 — orquestrador over-privileged.** Confirmar que `conductor auto` não muta `GateState` por nenhum
   caminho fora de `gate *`, não escreve nenhum protected-path via tool de subagente, e nunca commita em
   `main`/`develop` direto.
4. **T77 — exfil por auto-push.** Plantar um `.env`/chave no working tree de um gate e confirmar que o
   secret-scan pré-push **bloqueia o push** (vira `needs-human`), não empurra ao remote. Confirmar que o
   commit é escopado ao diff do gate, não `git add -A`.
5. **T78 — tamper do checkpoint.** Adulterar `demand_branch`/`depth_calibration`/`deferred_human_decisions`
   num `.cdt/auto/<slug>.continue.json` e confirmar que `--continue` re-deriva do `GateState` (push na branch
   certa, calibração autoritativa, pendente ainda visível/bloqueante). Confirmar que o arquivo é
   inescrevível por um tool de subagente (§9.1/secure-default 72).
6. **T79 — budget.** Confirmar que um subagente não pode construir um 2º `SharedBudget` (erro de compilação/
   runtime), e que esgotamento para graciosamente (`budget-exceeded`, checkpoint+push), nunca crash.
7. **T80 — egress no laço.** Tornar o primário indisponível, oferecer só um candidato cross-provider, e
   confirmar que `conductor auto` **para como `needs-human`** (nunca cruza provedor sozinho no loop).

**Nenhum finding crítico/alto não-mitigado em aberto no nível de design.** As 7 ameaças têm regra vinculante;
os residuais declarados (o teto do processo confiado sem sandbox — T17/R1; a exfil por config deliberada do
próprio usuário; a evasão da classificação limitada pelo backstop mandatório) **só o Gate 9 confirma como
fechados na prática**. O design reduz o risco a um nível aceitável e **detectável**, não a zero.
