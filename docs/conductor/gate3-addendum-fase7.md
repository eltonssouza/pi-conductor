# Gate 3 — Adendo da Fase 7: Model routing e provedores (STRIDE do canal de credencial + resolução + egress)

**Demanda:** reconstruir o Conductor Coding Agent sobre o runtime Pi
(earendil-works/pi) — **Fase 7, "Model routing e provedores"**.
**Branch:** `feature/fase7-model-routing-e-provedores` (de `develop`).
**Papel responsável:** `security-engineer` (skill `model-threats`), executado como
subagente, Gate 3 **FULL** (gate mandatório, nunca colapsado — CLAUDE.md
"never-collapse"; a Fase 7 toca **autenticação, credenciais, tokens e chamadas a APIs
externas** — a pergunta do never-collapse "isto toca auth, PII, tokens ou APIs externas?"
é **sim por todas as quatro portas**, o que torna o Gate 3 completo obrigatório por
definição própria do `CLAUDE.md`).
**Superfície modelada = a spec da Fase 7** (`gate2-spec-fase7.md`): 23 FRs (grupos A–H),
10 BRs, 9 edge cases, 8 goals (G1–G8), 8 questões abertas. Este Gate 3 é o que a própria
spec §9 (questões 2 e 3, explicitamente diferidas a este gate para uma resposta
informada-por-ameaça) e o `CLAUDE.md` (Gate 3 nunca colapsado + a pergunta padrão de
egress-consent a cada rodada) declararam devido.

**Natureza deste documento:** é um **adendo** que modela as **fronteiras de confiança
novas** da Fase 7 — três, não uma: (1) o **canal de credencial** (`conductor
login/logout/auth` → `AuthStorage` local → endpoint OAuth/API do provedor); (2) o
**pipeline de resolução** (`Gate → model role → política do projeto → modelos configurados
→ disponibilidade → Model selecionado | RECUSA`), que é uma **decisão de autorização**
(qual modelo, de qual provedor, é autorizado a executar um gate); e (3) o **egress de
fallback/health-check**, onde conteúdo local sai para um provedor — possivelmente
**diferente** do que o usuário escolheu ativamente. É o gate onde a **causa raiz** do
incidente `DEEPSEEK_API_KEY` (contida por sintoma na Fase 3, `task.ts:511-535`) precisa ser
fechada na **origem** — a resolução primária que esta fase introduz — e não apenas no
caminho de delegação que a Fase 3 já blindou.

> **Numeração — confirmada lendo o fim da cadeia (mesma disciplina das fases anteriores).**
> Enumerei (`git log --grep "gate 3"`) e li os dois adendos mais recentes
> (`gate3-addendum-fase5.md`, `gate3-addendum-fase6.md`). **Máximo atribuído em qualquer
> lugar:** `T64` / `R45` / secure-default `54` (Fase 6, commit `fd8bea27e`). A **Fase 7
> começa em `T65` / `R46` / secure-default `55`** — estritamente acima de qualquer número
> já usado, sem colisão nova. A colisão pré-existente `T40–T42`/`R22` (nota N-2 do adendo
> da Fase 5, dívida de documentação em `develop`) **não é re-litigada aqui**. **Máximo
> atribuído agora:** `T73` / `R54` / secure-default `63`.

---

## 0. O achado central — a resolução é uma decisão de AUTORIZAÇÃO, e a Fase 7 reabre o incidente `DEEPSEEK_API_KEY` na fonte

O fato dominante herdado permanece: um **único processo de SO, sem sandbox**, com o
privilégio do usuário; toda garantia é **política dentro de um processo confiado** (Fase 0
§0, inalterado). A Fase 7 acrescenta a esse processo o poder de, sozinho, **escolher qual
modelo de qual provedor executa cada gate** e **encaminhar conteúdo local para esse
provedor**. Duas consequências reorganizam este gate:

> **(a) `findInitialModel`'s passo 4 é a causa raiz, e a Fase 3 só fechou a porta da
> delegação.** Lido verbatim (`model-resolver.ts:681-696`): quando nenhum modelo explícito
> é escolhido, o resolvedor genérico do vendor itera `getAvailableSnapshot()` e retorna **o
> primeiro modelo cujo provedor tem *qualquer* credencial configurada — inclusive por
> env-var**. Foi exatamente esse laço que, com um `DEEPSEEK_API_KEY` ambiente não
> intencional, fez uma sessão-filha colocar uma chamada de rede real a um modelo pago, com
> `allowModelNetwork:false` e **sem consentimento nem registro** (`task.ts:517-521`). O fix
> da Fase 3 (`GAP-5`, `task.ts:511-535`) **herda o modelo do pai por referência** — o que
> torna `findInitialModel` **inalcançável para a filha de delegação** (`sdk.ts`'s
> `let model = options.model;` faz curto-circuito). Mas o próprio comentário do fix declara
> que é *"closing the hole until a real `modelRole` → `Model` registry exists"*. **A Fase 7
> constrói exatamente esse registry (G2/FR-6..8) — e com ele nasce um caminho de resolução
> PRIMÁRIO, novo, que a herança-por-referência da Fase 3 não cobre.** Se o ramo
> "`modelRole` sem mapeamento explícito" desse novo resolvedor cair em `findInitialModel`
> passo 4 (o caminho de menor esforço de implementação), o incidente `DEEPSEEK_API_KEY`
> **reabre no site primário**. Isto é `T65`, e é a razão de a spec ter cravado FR-7 como
> uma FR de segurança, não uma conveniência.

> **(b) A resolução é um caminho de autorização — logo o modo de falha é forçado a
> fail-closed.** *"An authorization check must fail closed… an error must never read as
> permission"* (Security Engineering Principles §2.12/§2.2). Um gate obrigatório resolvido
> para o **modelo errado** (downgrade silencioso, T67), ou executado **apesar de nenhum
> modelo compatível** (fail-open, T68), é a mesma classe de falha que a Fase 2 corrigiu
> **duas vezes** (o budget fail-open T33a) — a decisão de "quem/o quê pode executar" caindo
> aberta em vez de fechada. O critério de saída literal do plano ("Gate 9 requer security…
> execução recusada") **é** a regra fail-closed desta superfície; invertê-la é o ataque.

> **(c) Todo candidato de fallback/health-check que cruza um provedor é egress — e egress é
> a pergunta padrão deste gate.** O `CLAUDE.md` (BR6) obriga, a cada Gate 3: *"este recurso
> encaminha conteúdo para um provedor diferente do que o usuário está ativamente usando?"* A
> Fase 7 responde **sim, por construção** — o fallback (Grupo F) e o health-check (Grupo G)
> existem para tocar **outros** provedores. A tensão que a spec §9.3 deixou explicitamente
> em aberto — "tier mínimo" (plano) vs. "piso do mesmo provedor" (BR6) — é resolvida aqui
> (§ resolução OQ#3), não deixada para o Gate 4 descobrir.

Este gate decide **semântica de segurança** (o que é tratado como não-forjável /
autorização-fail-closed / egress-consentido / minimizado / redigido); o **mecanismo** (onde
vive o pacote — spec §9.4; o formato da política de projeto — §9.7; o mecanismo exato de
health-check e o valor de cooldown — §9.5; o pacote físico do ledger — §9.6) é do Gate 4, e
**estas regras (R46–R54) vinculam qualquer uma das opções**.

### Diagrama de fronteiras de confiança (DFD, Shostack §2.5/§2.3)

```
CONFIÁVEL — o processo Conductor (um único processo de SO, sem sandbox, privilégio do usuário)
════════════════════════════════════════════════════════════════════════════════════════════
  Usuário CLI
     │  conductor login / logout / auth
     ▼
  ┌──────────────────────────┐   escreve/lê (lock proper-lockfile + 0600/0700)  ┌──────────────┐
  │ comandos de auth (SF-P1) │ ───────────────────────────────────────────────► │ AuthStorage  │ (SF-P2)
  └──────────────────────────┘                                                   │ auth.json    │ ← segredo em repouso
     │  OAuth device/URL ┆ prompt de API key                    prioridade ─────►│              │
     ▼                   ┆══[FRONTEIRA: rede, TLS]══                runtime>stored└──────────────┘
   ╔═══════════════════════════════════════════╗                    >environment        ▲
   ║ Provedor OAuth / API (EXTERNO, não conf.) ║                                         │
   ╚═══════════════════════════════════════════╝                                 ┌──────────────┐
                                                                                  │ env-api-keys │ (SF-P3)
  Execução de gate                                                                │ ANTHROPIC_…  │ ← credencial
     │ "resolva um Model para o gate N / papel P"                                 │ DEEPSEEK_…   │   AMBIENTE
     ▼                                                                            └──────────────┘   (fonte T65)
  ┌────────────────────────────────────────────────────────┐                            │
  │ Resolvedor modelRole→Model (SF-P4) — DECISÃO DE AUTORIZAÇÃO │◄──────────────────────┘
  │   Gate → model role → POLÍTICA DO PROJETO ─────────────────┼── config repo-supplied (NÃO CONFIÁVEL, T73)
  │        → modelos configurados → DISPONIBILIDADE            │      pode apontar a base-URL hostil (exfil)
  │        → Model selecionado | RECUSA fail-closed (T67/T68)  │
  └────────────────────────────────────────────────────────┘
     │ primário indisponível              │ probe de disponibilidade
     ▼                                     ▼
  ┌──────────────────────────┐  ══[cruza  ┌──────────────────────────┐  ══[FRONTEIRA: rede]══►  provedor
  │ Fallback (SF-P5)         │  provedor= │ Health check (SF-P6)     │      (remoto ou self-hosted)
  │  tier-mín ∧ consentimento│  EGRESS]══►│  rede simples; bounded,  │
  │  (T66/T67)               │   provedor │  backoff, cooldown (T70)  │
  └──────────────────────────┘   EXTERNO  └──────────────────────────┘
     │ toda invocação → uso de tokens / custo em $
     ▼
  ┌──────────────────────────────────────────────┐
  │ Ledger de custo (SF-P7) — novo sink de        │ ← redação pré-escrita; append-only;
  │  persistência + observabilidade (T71)         │   uso derivado-do-runtime, nunca auto-declarado
  └──────────────────────────────────────────────┘
```

Regras de rótulo STRIDE-per-element (Threat Modeling §3.3): **entidade externa** (provedor,
usuário) → S,R; **processo** (resolvedor, comandos de auth) → todos os seis; **data store**
(`auth.json`, ledger) → T,R,I,D; **data flow** (egress de fallback/health-check) → T,I,D.
As fronteiras que importam são as três linhas duplas `══`: (1) auth ↔ provedor OAuth/API;
(2) política do projeto → resolvedor (config repo-supplied cruzando para uma decisão de
autorização); (3) fallback/health-check → provedor externo (egress).

---

## 1. Delta de superfície — as 7 superfícies novas da Fase 7

| # | Superfície | NOVO / estende | Relação com o herdado |
|---|---|---|---|
| SF-P1 | **`conductor login`/`logout`/`auth`** (headless) — cunha/remove/reporta credencial, compondo sobre `ModelRuntime`/`AuthStorage` | **NOVO** | Camada de comando fina; nunca reimplementa OAuth/storage. O anti-padrão a NÃO copiar é `pi-ai/src/cli.ts` (grava `auth.json` em texto plano no CWD, sem lock, sem `chmod`) — T69 |
| SF-P2 | **`AuthStorage` / `auth.json`** — o segredo em repouso (lock `proper-lockfile`, `chmodSync(0o600)`, dir `0700`, escrita atômica por provedor) | **REUSADO (substrato maduro do vendor)** | O store endurecido de produção do `pi`. A Fase 7 **compõe** sobre ele; T69/T72 vinculam a composição a nunca degradá-lo |
| SF-P3 | **Detecção de credencial por env-var** (`env-api-keys.ts`) — `ANTHROPIC_API_KEY`/`DEEPSEEK_API_KEY`/… ambientes no processo | **REUSADO / é a FONTE do incidente** | A credencial **ambiente** que `findInitialModel` passo 4 auto-descobre. `conductor auth` deve **reportá-la** com `source:"environment"`, e a resolução **nunca** deve autorizá-la por default (T65) |
| SF-P4 | **Resolvedor `modelRole→Model` + mapa gate→role + política do projeto + pool/disponibilidade** — a DECISÃO DE AUTORIZAÇÃO | **NOVO / fecha o SEAM da Fase 3** | O ponto onde a causa raiz do `DEEPSEEK_API_KEY` reabre (T65), onde o tier pode ser rebaixado (T67), onde a resolução pode falhar-aberto (T68), e onde a **política repo-supplied** é input não-confiável (T73) |
| SF-P5 | **Caminho de fallback cross-provider** — egress a um provedor diferente do escolhido | **NOVO** | A fronteira de egress do Grupo F. Cruzar provedor sem consentimento é T66; derivar para tier inferior é T67; toda troca gera evento (BR-5/FR-19) |
| SF-P6 | **Health-check de disponibilidade** — probe de rede a endpoints de provedor | **NOVO** | Egress (BR-5): revela "este projeto usa o provedor X" e é um vetor de amplificação de custo/DoS se sem bounds (T70); nunca um serviço Docker que esta fase provisiona (G7) |
| SF-P7 | **Ledger de custo/tokens** — atribuição de uso por gate/papel/invocação, novo sink de persistência | **NOVO / distinto de `SharedBudget`** | Contabilidade derivada-do-runtime; sua integridade (não-forja, não-repúdio) é T71; é um novo sink de redação (segredos podem aparecer em prompts contabilizados) |

**Observação de fronteira (a que mais importa).** SF-P4 é uma **decisão de autorização**, não
uma escolha de conveniência — e três das suas cinco etapas do pipeline consomem input que
**não é totalmente confiável**: a "política do projeto" (repo-supplied, T73), a
"disponibilidade" (resposta de um provedor externo, potencialmente hostil, T70), e o "pool de
modelos configurados" (que pode incluir uma credencial **ambiente** que o usuário nunca
pretendeu autorizar, T65). Um `Model` só é digno de executar um gate se **(i)** foi
**explicitamente autorizado** pela política do projeto ou pela configuração deliberada do
usuário — nunca auto-descoberto por presença de env-var (R46/T65) — **e (ii)** satisfaz o
**tier mínimo** do gate (R48/T67) **e (iii)** — quando cruza provedor — carrega
**consentimento de egress explícito** (R47/T66). As três metades são **ANDadas**, não
ranqueadas; é isso que resolve a tensão OQ#3 abaixo.

---

## 2. Ameaças novas da Fase 7 (T65 … T73)

Escala idêntica às fases anteriores: Probabilidade {Baixa, Média, Alta} × Impacto {Baixo,
Médio, Alto, Crítico}; Prioridade P1…P4. Cada mitigação é amarrada a um primitivo real e
vira uma **regra vinculante** numerada no §4.

### Sumário priorizado

| ID | Ameaça | STRIDE | Prob | Impacto | Prio | Superfície | Eixo da tarefa |
|---|---|---|---|---|---|---|---|
| **T65** | **Egress cross-provider não-consentido via credencial AMBIENTE** — a resolução primária cai em `findInitialModel` passo 4 e autoriza silenciosamente **qualquer** provedor com API key no ambiente (a classe `DEEPSEEK_API_KEY`, agora na fonte, não só na delegação) | **I** (conteúdo forwarded a provedor não-consentido), **S**, **E** | **Alta** | **Crítico** | **P1** | SF-P3/SF-P4 | credencial (env) + egress DEEPSEEK |
| **T66** | **Fallback cruza provedor sem consentimento de egress** — primário indisponível, um candidato do mesmo tier existe em OUTRO provedor, e o fallback o toma automaticamente, encaminhando conteúdo local a um provedor que o usuário não escolheu | **I**, **S** (de destino), **E** | Média | **Crítico** | **P1** | SF-P5 | egress (fallback cross-provider) |
| **T67** | **Downgrade silencioso de tier em gate obrigatório** — o tier mapeado indisponível, um modelo **mais fraco** disponível, e a resolução/fallback o substitui sem sinalizar; um `security`/`review` gate "passa" por um modelo que não faz o trabalho — esvazia o never-collapse | **S** (de capacidade/tier), **T** (da decisão de rota), **E** | Média | **Alto** | **P1** | SF-P4/SF-P5 | tier rebaixado/spoofed |
| **T73** | **Política/catálogo repo-supplied aponta a modelo inexistente OU a base-URL hostil** — uma config de projeto num clone declara um provedor `openai-compatible` com `baseUrl` do atacante; a resolução o aceita e **exfiltra o prompt/código** para o endpoint hostil (ou aponta a um modelo que "nunca resolve", DoS silencioso) | **S** (de identidade de modelo), **T** (do catálogo), **I** (exfil), **E** | Média | **Crítico** | **P1** | SF-P4 | catálogo/override malicioso (edge 9) |
| **T68** | **Resolução falha-aberta** — um erro de resolução ou resultado vazio lido como "prossiga com um default" em vez de RECUSAR; o critério de saída literal do plano invertido (a classe do budget fail-open T33a, corrigida 2× na Fase 2) | **E** (bypass), **S** | Média | **Alto** | **P2** | SF-P4 | fail-closed bypass (exit-criterion invertido) |
| **T69** | **Roubo/vazamento de credencial** — do arquivo local (um segundo arquivo paralelo em texto plano à la `pi-ai/cli.ts`; permissão frouxa), do env (impresso em erro/log/transcript), ou passado a um subprocesso via argv (visível em `ps`) | **I** | Média | **Alto** | **P2** | SF-P1/SF-P2/SF-P3 | roubo de credencial (arquivo/env/subprocesso) |
| **T70** | **Health-check como vetor de DoS/custo** — um provedor lento/hostil (ou um endpoint self-hosted sob controle do atacante) faz o health-check/retry entrar em tempestade sem backoff/cooldown/cap → exaustão de custo (chamada paga) ou de tempo | **D**, **E** (financeiro) | Média | **Alto** | **P2** | SF-P6 | health-check DoS/custo |
| **T71** | **Adulteração/spoof do ledger de custo/tokens** — um laço comprometido sub-reporta gasto para evadir budget, ou a resposta de um provedor spoofa a contagem de tokens; ou o ledger é apagado (anti-forense de custo) | **T**, **R**, **S** | Média | **Médio** | **P2** | SF-P7 | ledger tampering/spoof |
| **T72** | **Corrida em login/logout concorrente** — duas sessões escrevem `auth.json` ao mesmo tempo → arquivo corrompido, credencial-fantasma (logout "esqueceu" da sessão mas o disco mantém), ou lockout | **T**, **D** | Baixa | Médio | **P3** | SF-P2 | corrida login/logout (edge 7) |

---

### T65 — Egress cross-provider não-consentido via credencial ambiente (P1 — o achado central; a causa raiz do `DEEPSEEK_API_KEY` reaberta na fonte)
**STRIDE:** Information Disclosure (conteúdo local encaminhado a um provedor não-consentido) +
Spoofing (do provedor autorizado) + Elevation (uma env-var ambiente autoriza uma chamada paga)
· **Elemento:** SF-P3 → SF-P4. **(Responde ao eixo "credencial env + egress DEEPSEEK".)**

A Fase 7 constrói o registry `modelRole → Model` que o fix da Fase 3 (`task.ts:524`)
literalmente nomeia como a condição para fechar o buraco de verdade. No momento em que esse
resolvedor existe, ele tem um ramo "**este `modelRole` não tem um modelo explicitamente
mapeado pela política do projeto**" — e o caminho de menor esforço para preenchê-lo é reusar
o que já existe: `findInitialModel` (`model-resolver.ts:681-696`), cujo passo 4 itera
`getAvailableSnapshot()` e retorna **o primeiro modelo cujo provedor tenha *qualquer*
credencial** — inclusive uma env-var que o usuário exportou para outra finalidade (um
`DEEPSEEK_API_KEY` de um experimento, um `OPENAI_API_KEY` de um script vizinho). O resultado
é **idêntico ao incidente já ocorrido**: uma chamada de rede real, a um provedor pago, **que
o usuário não escolheu**, com o conteúdo do turno (possivelmente o código sob revisão de
segurança) encaminhado a ele, **sem consentimento e sem registro** — violando
`plano_desenvolvimento.md` §4.3 ("Network: requer consentimento e registro").

**Por que isto NÃO é duplicata de T30-T39 (Fase 3).** O fix da Fase 3 fecha o caminho da
**delegação** (a filha herda o modelo do pai por referência, tornando `findInitialModel`
inalcançável **para a filha**). Ele **não** toca a resolução **primária** — porque a
resolução primária por-gate **não existia** na Fase 3. A Fase 7 a cria. T65 é a **mesma
classe de ameaça numa superfície nova** (SF-P4, o resolvedor primário), exatamente como T60
(Fase 6) foi T48 (Fase 5) numa porta nova. O sintoma foi contido; a **causa raiz** — "um
tier sem modelo mapeado cai em 'use qualquer coisa com uma chave'" — é o que a Fase 7 tem
que fechar (BR-2 da spec o cravou como regra de negócio).

**Mitigação (semântica — mecanismo é Gate 4): R46.**
(i) A resolução **nunca** deriva para "primeiro modelo disponível com qualquer API key
presente no ambiente" (FR-7). Um modelo só é autorizado a executar um gate se foi
**explicitamente** mapeado pela política do projeto ou pela configuração deliberada do
usuário — a presença de uma credencial (especialmente `source:"environment"`) **habilita**,
mas **nunca autoriza sozinha**.
(ii) `conductor auth` **reporta** a credencial ambiente com sua origem exata
(`source:"environment"`, reusando `ModelRuntime.getProviderAuthStatus`) — visibilidade é
parte da defesa: o usuário vê que um `DEEPSEEK_API_KEY` está presente, mesmo que a resolução
não o autorize.
(iii) **Fail-closed:** um `modelRole` sem modelo explicitamente autorizado resolve para
**ausência explícita** (T68/R49), nunca para uma auto-descoberta silenciosa.
(iv) **Residual declarado, honesto (o teto herdado):** num SO single-user sem sandbox, um
`ModelRuntime` do próprio processo confiado com uma credencial ambiente **pode** ser
instruído a usá-la se o usuário/laço explicitamente a mapear — R46 fecha a autorização
**automática/silenciosa** (o incidente), não a autorização **deliberada** (que é o uso
legítimo). O teto de execução (a Fase 2 T17/R1) continua sendo o limite último.

Prob **Alta** (env-vars são ambientes por natureza; o laço autônomo `/cdt-auto` quer avançar;
o ramo "sem mapeamento" é o caminho de menor resistência de implementação, e reusar
`findInitialModel` é a tentação exata que já causou o incidente uma vez); Impacto **Crítico**
(conteúdo local — possivelmente sob revisão de segurança — exfiltrado a um provedor pago
não-consentido, sem registro; já ocorreu, não é hipotético).

*Grounding:* **forte** — **Security Engineering Principles §2.2/§2.5/§2.12** (top **0.634**:
"secure by default and failing safely"; "any error or uncertainty denies access"; "an error
must never read as permission" — a ausência de mapeamento **nega**, não auto-descobre);
**Secure and Reliable Systems Design §3.5/§3.2/§3.3** (top **0.650**: least-privilege e
blast-radius — "a stolen/ambient credential is contained"; "zero-trust networking: network
location grants no authority" — uma env-var alcançável não concede autoridade); **Data
Protection & GDPR §1.1** (0.584: purpose limitation — a chave exportada para outro fim não
autoriza este). *Precedente de código:* `task.ts:511-535` (o incidente documentado
verbatim), `model-resolver.ts:681-696` (o mecanismo). **Reportado como GAP-7 (root-cause)**:
FR-7 já existe — este gate confirma que ela é **a** mitigação e que a resolução primária é o
site que a exige. **Vinculante pro Gate 4 e pro Gate 9** (verificação empírica — §7b).

### T66 — Fallback cruza provedor sem consentimento de egress (P1 — a tensão BR6 desta fase)
**STRIDE:** Information Disclosure + Spoofing (do destino de egress) + Elevation ·
**Elemento:** SF-P5. **(Responde ao eixo "egress fallback cross-provider" + resolve OQ#3.)**

O primário resolvido está indisponível (falha de auth, health-check negativo, erro do
provedor). O Grupo F procura um candidato de fallback. O vetor: existe um modelo do **mesmo
tier** mas de um **provedor diferente** do que o usuário está ativamente usando, e o fallback
o toma **automaticamente**. Isso encaminha o conteúdo do turno a um provedor que o usuário
**não escolheu** — a definição exata da pergunta padrão de egress-consent do `CLAUDE.md`
(BR6), respondida "sim" e depois ignorada. Pior no laço autônomo (`/cdt-auto`/`/cdt-triage`),
que roda **sem** um humano para ver o destino mudar (BR5: a regra vale em modo atendido e
não-atendido igualmente).

**Mitigação (semântica): R47.**
(i) Um fallback que **cruza provedor** só prossegue com **consentimento de egress explícito**
(FR-18/BR-4): divulgar o destino real (BR1), piso do mesmo provedor como default (BR2),
falhar fechado se o piso do mesmo provedor for inalcançável (BR3), opt-in explícito antes de
cruzar (BR4). Nunca automático.
(ii) Todo fallback — dentro ou fora do provedor — gera um **evento de egress registrado**
(FR-19/BR-5/invariante 17). Uma troca silenciosa sem rastro é inaceitável.
(iii) No modo não-atendido, "consentimento explícito" **não** pode ser sintetizado pelo
próprio laço (senão o consentimento é vácuo): a ausência de um humano para consentir **é** a
condição de fail-closed — o cross-provider fica **bloqueado por default** no laço autônomo, e
o gate recusa em vez de cruzar (a mesma leitura de BR3).

Prob **Média** (exige o primário indisponível **e** um candidato cross-provider presente —
plausível num projeto multi-provedor, mas não o caso comum); Impacto **Crítico** (conteúdo
local encaminhado a um provedor não-escolhido, sem o usuário ver; no laço autônomo,
repetidamente e sem testemunha).

*Grounding:* **Security Engineering Principles §2.12** (0.634: "when not to make a default
stricter" — o egress cross-provider é precisamente onde o default estrito pertence, o
caminho de autorização); **Secure and Reliable Systems Design §3.3** (0.592: zero-trust
networking — um provedor alcançável não é implicitamente confiável); **Data Protection &
GDPR §1.1** (0.584: purpose limitation — o conteúdo foi produzido para o provedor escolhido,
não para o de fallback). *Precedente:* `CLAUDE.md` BR6 (a regra padrão deste gate), spec
FR-18/BR-4 (a tensão nomeada). **Resolve OQ#3 (§ abaixo). Vinculante pro Gate 9.**

### T67 — Downgrade silencioso de tier em gate obrigatório (P1 — o never-collapse esvaziado por baixo)
**STRIDE:** Spoofing (de capacidade — um modelo fraco se passa por um que satisfaz o tier) +
Tampering (da decisão de rota) + Elevation (um modelo abaixo do exigido fecha um gate
obrigatório) · **Elemento:** SF-P4/SF-P5. **(Responde ao eixo "tier rebaixado/spoofed" +
resolve OQ#2.)**

O tier mapeado para um gate (ex.: `security` para o Gate 9) não tem modelo compatível
disponível, mas um modelo de **tier inferior** tem. A resolução — ou o fallback — o
substitui **silenciosamente**, e o gate executa "mesmo assim". Isto é o **downgrade
silencioso** que o plano §4.15 proíbe em texto ("um gate crítico não pode sofrer downgrade
silencioso"), realizado como ataque. A consequência de segurança é direta: os cinco gates
never-collapse `{3,5,7,8,9}` (`CLAUDE.md` não-negociável #2) têm sua garantia esvaziada **por
baixo** — uma revisão de segurança (Gate 9) conduzida por um modelo que não raciocina sobre
segurança "passa", mas não fez o trabalho; é o análogo, no eixo de modelo, do que T59 (Fase
6) foi no eixo de evidência (o obrigatório fechado sem o trabalho).

**Mitigação (semântica): R48.**
(i) **Tier mínimo é um piso duro (FR-17/invariante 16):** um candidato de tier **inferior**
ao mapeado é **rejeitado**, tanto na resolução primária quanto no fallback — nunca aceito
silenciosamente. Isto vale para **todos os 14 gates** (é a regra fail-closed universal), e é
**absoluto e não relaxável mesmo com consentimento** nos 5 obrigatórios (um humano não pode
"consentir" que o Gate 9 rode com um modelo abaixo de `security` — seria consentir em anular
o never-collapse).
(ii) Se o tier exigido não tem modelo, o resultado é **recusa fail-closed nomeando o tier que
faltou** (T68/R49/FR-14), **nunca** uma substituição por tier inferior.
(iii) **Resolve OQ#2 (§ abaixo):** a recusa fail-closed é **universal** (todos os 14); o veto
a fallback automático é **absoluto** nos 5 obrigatórios e **opt-in-only** nos demais 9 — e
mesmo nos 9, o piso de tier (i) e o consentimento cross-provider (R47) continuam valendo.

Prob **Média** (exige o tier exigido indisponível **e** um inferior disponível — comum quando
um projeto tem só um provedor forte configurado e vários fracos); Impacto **Alto** (um gate
obrigatório "passa" sem a capacidade que o define; é visível a um revisor humano no Gate 8,
por isso Alto e não Crítico — o freio residual é o revisor, exatamente como em T59).

*Grounding:* **forte** — **Security Engineering Principles §2.2/§2.12** (0.634: fail-closed no
caminho de autorização; o tier exigido é um requisito de autorização, não uma preferência);
**Secure and Reliable Systems Design §1.12** (0.603: "the failure direction is forced… the
auth path admitting requests it could not verify" — um gate admitindo um modelo que não pode
verificar a capacidade exigida). *Precedente:* plano §4.15 (a regra literal), spec
FR-14/FR-15/FR-17, `CLAUDE.md` não-negociável #2 (never-collapse). **Resolve OQ#2 (§ abaixo).
Vinculante pro Gate 9.**

### T73 — Política/catálogo repo-supplied aponta a modelo inexistente ou a base-URL hostil (P1 — o T37 do canal de provedores)
**STRIDE:** Spoofing (de identidade de modelo) + Tampering (do catálogo) + Information
Disclosure (exfiltração do prompt) + Elevation · **Elemento:** SF-P4. **(Responde ao eixo
"catálogo/override malicioso", edge case 9.)**

FR-11 torna o mapeamento gate→model role **sobreponível por política do projeto**. Uma
política de projeto é **input repo-supplied** — exatamente a classe de confiança que a Fase 3
modelou para o Role Registry (T37: "definição de papel hostil vinda de repo clonado", P1
Crítico, fechada por `RoleTrustStore`/TOFU). Duas realizações:

- **(a) Modelo inexistente (o benigno, edge case 9).** A política aponta a um modelo que não
  existe em nenhum provedor conhecido. Se aceito silenciosamente como "válido, mas nunca
  resolve", vira um DoS silencioso — o gate nunca resolve e ninguém sabe por quê.
- **(b) Base-URL hostil (o crítico — os dentes).** O catálogo de ~40 provedores inclui
  `openai-compatible` (e Azure/vLLM/llama.cpp), cujo endpoint é uma **`baseUrl`
  configurável**. Uma política de projeto num clone pode declarar um "provedor" cujo
  `baseUrl` aponta para um **endpoint controlado pelo atacante**, do tipo que fala o
  protocolo OpenAI. A resolução o aceita, e cada turno **exfiltra o prompt/código
  completo** (incluindo o código sob revisão, segredos no contexto) para o servidor do
  atacante — um SSRF/exfil pela porta da configuração de modelo, com a autoridade de "o
  projeto configurou este provedor". Pior no laço autônomo, sem um humano para estranhar o
  destino.

**Mitigação (semântica): R54.**
(i) Um `Model`/provedor declarado por política **é resolvido contra o catálogo de provedores
conhecidos** (`builtinProviders()`); um que não resolve a um provedor/modelo conhecido é
**recusado explicitamente no momento da resolução, nomeando o modelo inválido** (edge case 9),
nunca aceito como "válido mas nunca resolve".
(ii) Um provedor com **`baseUrl` customizado** (endpoint não-oficial) é tratado como
**egress a um destino não-confiável** — herda o consentimento de egress de R47 (divulgar o
destino real, opt-in explícito), **nunca** silenciosamente confiado só porque a config o
declarou. A política de projeto é **input não-confiável**, na disciplina TOFU de
`PolicyTrustStore`/`RoleTrustStore` (T28/T37): uma mudança de `baseUrl`/provedor num clone é
um **indicador de ataque**, não uma configuração de rotina.
(iii) **Decisão de path, vinculante pro Gate 4 (cruza spec §9.4/§9.7):** **onde** a política
de projeto vive decide a superfície — uma config in-workspace sob um clone herda a disciplina
T56/T37 (artefato repo-supplied = não-confiável até prova); uma config por-máquina herda o
protected-path. O Gate 4 tem que fazer essa escolha **sob esta regra**, não como convenção.

Prob **Média** (exige uma config hostil num clone/repo — mas o laço autônomo processa repos
não-auditados por design, e uma `baseUrl` é uma linha de config trivial de plantar); Impacto
**Crítico** (exfiltração silenciosa e durável de todo o contexto — código, segredos — a um
endpoint do atacante).

*Grounding:* **Secure Code Review §2.2** (0.571: taint source→sink — a config repo-supplied é
uma source, a chamada de rede ao provedor é o sink; SSRF é a família nomeada); **Secure and
Reliable Systems Design §3.3** (0.592: zero-trust networking — um `baseUrl` alcançável não é
confiável); **Threat Modeling §3.3** (0.728: data-flow cruzando fronteira de confiança).
*Precedente:* Fase 3 **T37/R15** (`RoleTrustStore`, definição repo-supplied não-confiável — o
paralelo direto), Fase 2 **T28** (`PolicyTrustStore`, TOFU). **Reportado como GAP-7C ao Gate
2** (FR-11/edge-case-9 devem nomear a política de projeto como input não-confiável e a
`baseUrl` customizada como egress-consentido). **Vinculante pro Gate 4 (path) e pro Gate 9.**

### T68 — Resolução falha-aberta (P2 — o critério de saída literal do plano invertido)
**STRIDE:** Elevation (bypass da recusa) + Spoofing · **Elemento:** SF-P4. **(Responde ao
eixo "fail-closed bypass".)**

O critério de saída literal do plano — "Gate 9 requer security. Nenhum modelo security está
configurado. Resultado: **execução recusada**" — é uma regra fail-closed. O ataque é
invertê-la: um erro na cadeia de resolução (uma exceção lançada, um resultado `undefined`, um
health-check que falhou) é tratado como "**prossiga com um default**" em vez de "**recuse**".
Esta é **exatamente** a classe de bug que a Fase 2 corrigiu **duas vezes** (o budget
fail-open T33a: "exaustão/estado ilegível tratado como allow em vez de deny") — bem entendida,
mas justamente por isso o erro natural de quem implementa a cascata `Gate → role → política →
modelos → disponibilidade` sob pressão de "fazer o laço avançar".

**Mitigação (semântica): R49.**
(i) A resolução que não produz um modelo compatível retorna um **valor explícito de ausência**
(`{resolved: false, missingRole, gate}`), **nunca** uma exceção genérica engolida como
"prossiga", e **nunca** um default silencioso (FR-8/FR-14). O runtime que consome esse valor
**recusa a execução do gate** nomeando o gate e o tier que faltou.
(ii) **Universal por gate (FR-15, primeira metade):** todos os 14 recusam sem modelo
compatível — não só os obrigatórios. (A segunda metade — o veto a fallback automático — é o
que difere entre obrigatórios e os demais; ver OQ#2.)
(iii) Um erro de I/O/rede em **qualquer** etapa (health-check, leitura de config) **degrada
para "indisponível/ausente"** — o modo de falha seguro — nunca para "disponível" (a mesma
disciplina de `grounding-ledger.ts`/`policy-trust-store.ts` fail-closed, R11a/R36 herdadas).

Prob **Média** (a cascata tem muitas etapas com I/O; o fail-open é o bug natural sob pressão
de avançar — precedente de 2 regressões na Fase 2); Impacto **Alto** (um gate executa com um
modelo não-intencionado; nos obrigatórios, esvazia a garantia — mas a mitigação é a disciplina
fail-closed madura, por isso P2 e não P1).

*Grounding:* **forte** — **Security Engineering Principles §2.5/§2.12** (0.634: "if the code
treats a timeout as allow (fail open), an outage becomes an access-control bypass. Fail
closed: any error or uncertainty denies access"); **Secure and Reliable Systems Design §1.12**
(0.603: "the failure direction is forced… fail closed"). *Precedente de código:* Fase 2
**T33a** (budget fail-open, corrigido 2×), `grounding-ledger.ts`/`policy-trust-store.ts`
(reader fail-closed). **Vinculante pro Gate 9.**

### T69 — Roubo/vazamento de credencial (arquivo, env, subprocesso) (P2)
**STRIDE:** Information Disclosure · **Elemento:** SF-P1/SF-P2/SF-P3. **(Responde ao eixo
"roubo de credencial".)**

Três portas de vazamento de uma credencial (API key ou token OAuth):
- **(a) Arquivo paralelo em texto plano.** O anti-padrão concreto a NÃO copiar é
  `pi-ai/src/cli.ts`, que grava `auth.json` no CWD via `writeFileSync` simples — **sem lock,
  sem `chmod`**. Se `conductor login` escrevesse seu próprio arquivo em vez de compor sobre
  `AuthStorage`, reintroduziria essa exposição (permissão default frouxa, legível por outro
  usuário/processo).
- **(b) Env/erro/log/transcript.** Uma credencial ambiente (SF-P3) impressa num erro de
  resolução, num log de debug, ou num transcript de sessão — o mesmo padrão que a redação já
  fecha para os 8 sinks existentes (`REDACTION_SINKS`, T62/Fase 6).
- **(c) Subprocesso via argv.** Se o fluxo OAuth ou uma chamada de provedor passasse a
  credencial a um subprocesso via **argumento de linha de comando**, ela ficaria visível em
  `ps`/`/proc` para qualquer processo do mesmo usuário.

**Mitigação (semântica): R50.**
(i) `conductor login`/`logout` **compõem exclusivamente sobre `AuthStorage`/`ModelRuntime`**
(lock `proper-lockfile`, `chmodSync(0o600)`, dir `0700`, escrita atômica) — **nunca** um
arquivo paralelo (BR-1). O acabamento de segurança do substrato do vendor é reusado, não
reimplementado.
(ii) Nenhuma credencial é impressa em erro/log/transcript — o **ledger de custo (SF-P7) e
qualquer novo sink desta fase entram na disciplina de redação** pré-escrita (o padrão dos 8
sinks); erros de resolução nomeiam o **provedor**, nunca a **chave**.
(iii) Credencial nunca trafega a um subprocesso via argv — via env do processo-filho ou
handle, nunca linha de comando (herda a disciplina da Fase 3 sobre o `ModelRuntime` de escopo
próprio da filha).

Prob **Média** (o anti-padrão do arquivo paralelo é um erro de composição natural; o vazamento
por erro/log é comum); Impacto **Alto** (credencial exposta = comprometimento do provedor, com
o custo/acesso associado).

*Grounding:* **forte** — **Secure and Reliable Systems Design §3.5/§3.2** (0.650: least
privilege e blast-radius — conter uma credencial roubada; permissão restrita); **Security
Engineering Principles §2.2** (0.630: secure defaults — o out-of-the-box seguro é o storage
endurecido, não o arquivo solto); **Penetration Testing §14.9** (herdado: "no secrets in any
bundle/log"). *Precedente de código:* `auth-storage.ts:23/51/57-58/99-100/176-177`
(`0o600`/`0o700`/lock — o substrato correto), `pi-ai/src/cli.ts` (o anti-padrão a evitar),
`REDACTION_SINKS` (a enumeração de sinks). **Vinculante pro Gate 9.**

### T70 — Health-check como vetor de DoS/custo (P2)
**STRIDE:** Denial of Service + Elevation (financeiro) · **Elemento:** SF-P6. **(Responde ao
eixo "health-check DoS/custo".)**

O health-check (Grupo G) e o retry de fallback tocam endpoints de provedor. Um provedor
**lento, hostil, ou sob controle do atacante** (um endpoint self-hosted `openai-compatible`
apontado por T73, ou simplesmente um provedor com timeout alto) transforma o health-check numa
**tempestade de retries** se não houver backoff/cooldown/cap: cada resolução re-verifica, cada
fallback re-tenta, e — se o "health-check" for implementado ingenuamente como uma **chamada de
modelo real** em vez de um probe barato — cada verificação **custa dinheiro**. Edge case 6 da
spec já nomeia o looping caro sem cooldown; este gate o classifica como o vetor de
**amplificação** de custo/DoS.

**Mitigação (semântica): R51.**
(i) O health-check é um **probe barato de reachability** (HTTP/HTTPS leve), **nunca** uma
chamada de modelo paga — a verificação de disponibilidade não consome tokens.
(ii) **Attempts limitadas + backoff exponencial com jitter + cooldown por-provedor + cap** —
um provedor que falhou entra em cooldown e não é re-verificado a cada turno (edge case 6);
retries são bounded, não uma tempestade.
(iii) **Não-bloqueante (BR-8):** o health-check nunca é uma dependência de latência perceptível
no turno em andamento (herda a disciplina da Fase 6 BR-6 para captura); uma falha de
health-check **nunca derruba o comando inteiro** (FR-21) — o provedor indisponível é reportado,
os demais seguem.
(iv) O health-check **é egress (BR-5)** — gera evento; revela ao provedor "este projeto está
configurado para mim", o que é aceitável para provedores oficiais mas é parte do porquê um
`baseUrl` customizado (T73) precisa de consentimento.

Prob **Média** (um provedor lento/indisponível é comum; um hostil exige o cenário T73);
Impacto **Alto** (amplificação de custo real se o probe for uma chamada paga, ou DoS de tempo
se bloqueante — financeiro e de disponibilidade).

*Grounding:* **forte** — **Secure and Reliable Systems Design §1.5/§1.3** (0.605: "retry policy
designed for reliability AND security: bounded attempts + exponential backoff with jitter
(avoid herds); per-client rate limiting (prevent amplification)"); **§1.12** (0.560:
"mechanisms that behave differently under adverse conditions — retries, failover, rate limits —
where one team's fix is the other's incident"). *Precedente:* spec FR-20/FR-21/BR-8, edge case
6 (cooldown), Fase 6 BR-6 (não-bloqueante). **Vinculante pro Gate 9.**

### T71 — Adulteração/spoof do ledger de custo/tokens (P2)
**STRIDE:** Tampering + Repudiation + Spoofing · **Elemento:** SF-P7. **(Responde ao eixo
"ledger tampering/spoof".)**

O ledger de custo/tokens (Grupo H) é uma nova contabilidade de segurança — um teto de gasto
depende dele. Três vetores:
- **(a) Sub-reporte para evadir budget.** Um laço comprometido (ou um bug) que **sub-reporta**
  o gasto contorna o teto — a mesma classe do budget race T33b da Fase 3, agora no ledger de
  $ em vez de tokens.
- **(b) Spoof da contagem pelo provedor.** A contagem de tokens vem da **resposta do
  provedor** (não-confiável, T70). Um provedor hostil pode reportar contagens falsas para
  inflar/deflacionar o custo atribuído.
- **(c) Anti-forense de custo.** Apagar/truncar o ledger destrói o registro de quanto foi
  gasto e onde.

**Mitigação (semântica): R52.**
(i) O uso é **derivado-do-runtime** — o Conductor conta a partir do que **observou** (a
invocação que fez), não confia cegamente numa contagem auto-declarada pelo provedor para
**decisões de governança** (a distinção `runtime-derived` vs. `author-declared` de
`gate-evidence.ts`, R14/T34 herdada); a contagem do provedor é um dado de observabilidade
reportado, não a verdade de autorização do budget.
(ii) O ledger é **append-only** (a disciplina de R44/Fase 6): correção é novo registro, nunca
mutação in-place; o **reader é fail-closed** — um ledger ausente/ilegível colapsa para "custo
desconhecido" (BR-10), **nunca** para "custo zero" (que subestimaria o gasto e afrouxaria o
teto — o modo de falha inseguro).
(iii) **`SharedBudget` (teto de tokens, governança) permanece a fonte de autorização de
gasto** (BR-6): o ledger de $ é **observabilidade derivada**, nunca sobrecarrega o teto de
governança nem o substitui — bounded-context separado (o precedente Library/Diary das Fases
5/6).
(iv) Preço ausente é **reportado, nunca inventado** (BR-10/FR-23): um modelo sem preço mapeado
tem custo "desconhecido", nunca estimado como zero ou média.

Prob **Média** (sub-reporte é um bug plausível; spoof de provedor exige um provedor hostil);
Impacto **Médio** (afrouxamento de um teto de custo / contabilidade errada — financeiro, mas
não exfiltração nem bypass de gate; o teto de governança real é `SharedBudget`, que não
depende do ledger de $).

*Grounding:* **fraco/declarado (honesto) — a biblioteca não cobre "integridade de
metering/contabilidade de uso" especificamente** (melhor resultado desta rodada: **Penetration
Testing §15.2 "business-logic flaws"**, top **0.588** — "bypassing limits" é o análogo mais
próximo, mas é sobre lógica de negócio web, não telemetria de custo). Ancorado em **precedente
de código já testado** deste monorepo (a distinção `runtime-derived`/`author-declared` de
`gate-evidence.ts` R14/T34; a atomicidade sync-reserve de `SharedBudget` ADR 0004 §5.3; a
disciplina append-only + fail-closed de R44) + o princípio fail-closed geral (Security
Engineering Principles §2.2, 0.630), **não forçado**. A não-cobertura é a mesma classe já
declarada pela spec §8.5 ("medição de custo de LLM não coberta"). **Vinculante pro Gate 9.**

### T72 — Corrida em login/logout concorrente (P3 — mitigado por construção, regra é "não degradar")
**STRIDE:** Tampering + Denial of Service · **Elemento:** SF-P2. **(Responde ao eixo "corrida
login/logout", edge case 7.)**

Duas sessões (ou o laço autônomo + um comando manual) rodam `conductor login`/`logout` para o
mesmo provedor ao mesmo tempo. O risco: `auth.json` corrompido por escrita interleaved,
credencial-fantasma (logout removeu da memória mas o disco manteve o segredo — a preocupação
de FR-3/BR-9), ou lockout.

**Mitigação (semântica): R53.**
(i) **Já mitigado por construção** — `AuthStorage` usa `proper-lockfile` (`lockSync`/`lock`) e
escrita atômica por provedor (`auth-storage.ts:69/119/99-100/176-177`). A regra é **não
degradar isso**: `conductor login/logout` **nunca** escrevem por um caminho que contorne o
lock (o mesmo motivo de R50/BR-1 — compor sobre `AuthStorage`, nunca um segundo escritor).
(ii) `logout` **remove do armazenamento persistente**, não só "esquece" da sessão (FR-3) — e
**reporta explicitamente** quando não havia nada a remover (FR-4/BR-9), nunca finge sucesso.
(iii) Uma escrita que perde a corrida do lock **falha fechada** (não escreve um arquivo
parcial), na atomicidade que `AuthStorage` já garante — o mesmo tipo de garantia de
`gate-state-store.ts`/`grounding-ledger.ts` em domínios irmãos.

Prob **Baixa** (exige concorrência real no mesmo provedor; o lock já existe); Impacto **Médio**
(corromper `auth.json` causaria lockout até o usuário re-logar — recuperável, não catastrófico).

*Grounding:* **fraco/declarado (honesto) — a biblioteca não cobre TOCTOU/escrita-concorrente
como tópico de segurança** (melhor resultado desta rodada top **0.561**, texto genérico de
trust-boundary de Secure Code Review, fora do alvo). Ancorado em **precedente de código já
testado** (`auth-storage.ts` `proper-lockfile` + escrita atômica; ADR 0004 §5.3 "atomicidade
por construção, não por disciplina" — o mesmo raciocínio que fechou T33b), **não forçado**.
**Vinculante pro Gate 9** (rodar login/logout concorrentes e confirmar não-corrupção).

---

## 3. Cobertura explícita dos eixos do critério deste gate

Os eixos que a tarefa nomeou como **piso** têm, cada um, ameaça + regra. Avaliei se havia um
vetor material adicional (spoof da resposta do provedor **de conteúdo**, não de contagem — é a
mesma família de T60/injection via conteúdo recuperado, já modelada, não re-litigada aqui;
confused-deputy entre gates via política de override — subsumido por T73/R54 + o piso de tier
R48) e **concluí que os 9 cobrem o conjunto material** desta superfície — sem padding.

| Eixo da tarefa | Ameaça | Regra | Status |
|---|---|---|---|
| **Roubo de credencial** (arquivo/env/subprocesso) | **T69** (+ T65 para env como gatilho de egress) | R50 (+R46) | Fechado: compõe sobre `AuthStorage` (lock/0600), nunca arquivo paralelo; redação nos sinks; nunca argv. Residual: teto de execução do processo confiado |
| **Tier rebaixado/spoofed** (fallback silencioso a modelo fraco) | **T67** | R48 | Fechado: tier mínimo é piso duro, absoluto nos 5 obrigatórios; downgrade → recusa fail-closed. **Resolve OQ#2** |
| **Egress cross-provider não-consentido** (classe DEEPSEEK + fallback) | **T65** (fonte/env) + **T66** (fallback) | R46 + R47 | Fechado: resolução nunca auto-descobre por env-var; cross-provider exige consentimento explícito, bloqueado por default no laço. **Resolve OQ#3** |
| **Fail-closed bypass** (gate prossegue sem modelo compatível) | **T68** | R49 | Fechado: ausência explícita, nunca exceção engolida nem default; recusa universal por gate; erro degrada para "indisponível". Disciplina madura (T33a 2×) |
| **Health-check DoS/custo** (retries/custo por provedor hostil/misbehaving) | **T70** | R51 | Fechado: probe barato (nunca chamada paga); bounded+backoff+jitter+cooldown+cap; não-bloqueante; é egress |
| **Ledger tampering/spoof** (custo/tokens) | **T71** | R52 | Fechado na direção: uso derivado-do-runtime (não auto-declarado); append-only + fail-closed (preço ausente ≠ zero); `SharedBudget` continua a autorização. Cobertura de biblioteca declarada fraca |
| **Corrida login/logout** (edge 7) | **T72** | R53 | Fechado por construção: `proper-lockfile`/escrita atômica de `AuthStorage`, regra é não degradar; logout remove do disco e reporta honestamente |
| **Catálogo/override malicioso** (modelo inexistente/hostil, edge 9) | **T73** | R54 | Fechado: modelo declarado resolvido contra catálogo conhecido, inválido recusado nomeando-o; `baseUrl` customizado = egress-consentido; política = input não-confiável (TOFU, T37). Path é decisão de Gate 4 |

---

## Resolução das duas questões abertas diferidas a este gate (as decisões concretas para o Gate 4 ratificar)

A spec §9 diferiu explicitamente **duas** decisões a este Gate 3, por serem
informadas-por-ameaça. Resolvo-as aqui como **recomendações de segurança** — o Gate 4 as
ratifica no ADR ou as sobrepõe com justificativa; não são arquitetura final, são a direção que
o threat model exige.

### OQ#2 — Escopo do "gate crítico" na regra fail-closed (universal vs. só os 5 mandatórios)

**Recomendação (informada por T67/T68):** **separar duas garantias que a spec FR-15 já
começou a distinguir, e cravar cada uma:**

1. **A recusa fail-closed (FR-14 — "nenhum modelo compatível → execução recusada") é
   UNIVERSAL, todos os 14 gates.** Razão de segurança: a resolução é um caminho de
   autorização, e "um erro nunca lê como permissão" (Security Engineering Principles §2.12)
   não tem exceção por criticidade do gate — não existe gate para o qual "prossiga com um
   modelo errado/não-consentido porque a resolução falhou" seja o modo de falha seguro. Um
   fail-open no Gate 11 ainda gasta em um provedor não-consentido (T65/T66) e ainda substitui
   capacidade sem sinal. Fail-closed na resolução é o default barato e sempre-correto.

2. **O veto a fallback AUTOMÁTICO (sem confirmação) é ABSOLUTO nos 5 obrigatórios `{3,5,7,8,9}`
   e OPT-IN-ONLY (default-deny) nos outros 9.** Razão: os obrigatórios são precisamente o
   caminho de autorização cuja integridade é a razão de existir do produto (o não-negociável
   #2 do `CLAUDE.md`: "every code change ships with a test / a security review"). Para eles, o
   tier é um piso não-relaxável **mesmo com consentimento** (um humano não pode consentir em
   anular o never-collapse), e cross-provider nunca é automático. Para os outros 9, um projeto
   **pode** configurar um fallback automático — mas **default-deny**: só com opt-in explícito
   e documentado, e **mesmo assim** limitado por (a) nunca abaixo do tier (R48) e (b) nunca
   cross-provider sem consentimento (R47). Razão de o default não ser "estrito para todos os
   14": **Security Engineering Principles §2.12 ("when not to make a default stricter")** —
   estender o veto **absoluto** a todos os 14 por fiat é a super-aplicação que §2.12 alerta;
   o custo de um falso-recusa (bloquear o laço num gate não-crítico) pode legitimamente
   superar o risco de integridade **ali**, e essa é uma decisão que o projeto assume
   explicitamente (least-privilege: conceder a política mais frouxa por opt-in, nunca por
   default).

**Em uma frase:** recusa fail-closed universal (14/14); veto a fallback automático absoluto
nos 5 obrigatórios, opt-in-only e ainda tier-floored + egress-consentido nos outros 9.
**Reportado como GAP-7A ao Gate 2** (FR-15 deve adotar esta distinção como cravada, não como
hipótese de trabalho).

### OQ#3 — BR6 (piso do mesmo provedor) vs. "tier mínimo" (plano) quando apontam a candidatos diferentes

O cenário: primário indisponível; dois candidatos de fallback — **(A)** mesmo provedor, tier
**mais fraco**; **(B)** tier **correto**, provedor **diferente** (cross-provider). Qual vence?

**Recomendação (informada por T66/T67):** **nenhum "vence" — os dois critérios são pisos
INDEPENDENTES, ANDados, não ranqueados. Quando divergem, o resultado é RECUSA fail-closed com
divulgação explícita, nunca uma escolha automática de nenhum dos dois.**

- **Candidato (A) — mesmo provedor, tier inferior — é REJEITADO de saída (R48/T67):** o tier
  mínimo é um piso duro; um modelo abaixo do exigido nunca fecha o gate, mesmo sem cruzar
  provedor. (Nos 5 obrigatórios, não-relaxável nem com consentimento.)
- **Candidato (B) — tier correto, cross-provider — NÃO é tomado automaticamente (R47/T66):**
  cruza a fronteira de egress que BR6 governa; só prossegue com **consentimento explícito**
  (divulgar o destino, opt-in). No laço autônomo sem humano, fica **bloqueado por default**
  (BR3: piso do mesmo provedor inalcançável → fail-closed).
- **Portanto, a ordem precisa é:** o resolvedor primeiro busca **mesmo provedor, tier ≥
  exigido** (satisfaz BR6 **e** tier-mín simultaneamente — zero conflito, zero consentimento
  necessário, prossegue). **Só se esse conjunto for vazio** os dois pisos divergem — e então
  (A) é rejeitado (tier) e (B) é consent-gated (egress); se o consentimento não vier (ou não
  puder vir, no laço), o **gate recusa e divulga as duas opções e seus custos** ("(A) é do seu
  provedor mas abaixo do tier — bloqueado; (B) é do tier certo mas encaminha seu conteúdo ao
  provedor X — precisa do seu opt-in"). A máquina **nunca resolve o conflito silenciosamente**;
  ela o **expõe**.

**Em uma frase:** "piso do mesmo provedor" e "tier mínimo" não colidem quando vistos como
**dois pisos independentes que ambos devem valer** — o candidato automático tem que satisfazer
os dois; falhar o tier o **rejeita**, falhar o mesmo-provedor o rebaixa a **consent-required**;
quando nenhum candidato satisfaz ambos, **fail-closed-e-pergunta**, nunca auto-escolhe.
**Reportado como GAP-7B ao Gate 2** (BR-4/FR-18 devem adotar a formulação "dois pisos ANDados
→ fail-closed-e-divulga na divergência").

*Grounding das duas resoluções:* **Security Engineering Principles §2.12/§2.2** (0.634:
fail-closed no caminho de autorização; "when not to make a default stricter"); **Secure and
Reliable Systems Design §1.12** (0.603: "the failure direction is forced"); **§3.3** (0.592:
zero-trust networking — o provedor de fallback alcançável não é implicitamente confiável);
**Data Protection & GDPR §1.1** (0.584: purpose limitation). `CLAUDE.md` BR6 (a regra padrão),
plano §4.15 (tier mínimo como 1ª restrição de fallback).

---

## 4. Regras vinculantes para o Gate 4 (arquitetura DEVE respeitar)

Semânticas de segurança (o que deve ser tratado como não-forjável / autorização-fail-closed /
egress-consentido / redigido), **não** arquitetura de classes. O Gate 4 escolhe o mecanismo
(onde vive o pacote — §9.4; o formato da política de projeto — §9.7; o mecanismo/cooldown de
health-check — §9.5; o pacote do ledger — §9.6); **não pode violar estas**. Continuam
**R1–R45** (Fases 2–6), inalteradas.

- **R46 (a resolução nunca autoriza um modelo por presença de credencial ambiente).** Um
  `Model` só executa um gate se **explicitamente autorizado** pela política do projeto ou
  configuração deliberada — nunca auto-descoberto por env-var (`findInitialModel` passo 4
  proibido como caminho de resolução por-gate). `conductor auth` reporta a credencial ambiente
  (`source:"environment"`) mas a resolução não a autoriza sozinha. Fecha a **causa raiz** do
  `DEEPSEEK_API_KEY` na fonte primária (não só na delegação, que a Fase 3 já fechou). Residual:
  autorização deliberada é uso legítimo; o teto é a execução do processo (Fase 2 T17/R1). (T65)
- **R47 (fallback cross-provider exige consentimento de egress explícito).** Cruzar provedor
  só prossegue com o protocolo BR6 (divulgar destino, piso do mesmo provedor default,
  fail-closed se inalcançável, opt-in explícito para cruzar); no laço não-atendido, cross-provider
  é **bloqueado por default** (a ausência de humano para consentir É a condição fail-closed).
  Todo fallback gera evento de egress (BR-5). (T66)
- **R48 (tier mínimo é um piso duro, absoluto nos 5 obrigatórios).** Um candidato de tier
  inferior ao mapeado é rejeitado na resolução e no fallback — nunca substituição silenciosa.
  Nos 5 obrigatórios `{3,5,7,8,9}`, não-relaxável nem com consentimento (relaxá-lo anula o
  never-collapse). Downgrade → recusa fail-closed nomeando o tier. (T67 — **resolve OQ#2**)
- **R49 (a resolução falha-fechada, universal por gate).** Nenhum modelo compatível → valor
  explícito de ausência (`{resolved:false, missingRole, gate}`), nunca exceção engolida nem
  default silencioso; o runtime recusa a execução nomeando gate + tier. Erro em qualquer etapa
  (health-check/config) degrada para "indisponível/ausente", nunca "disponível". Universal aos
  14 (o veto a fallback automático é o que difere entre obrigatórios e os demais — OQ#2). (T68)
- **R50 (credencial só via o storage endurecido; nunca arquivo paralelo, log ou argv).**
  `login`/`logout` compõem sobre `AuthStorage`/`ModelRuntime` (lock + `0600`/`0700` + atômico),
  nunca um segundo arquivo à la `pi-ai/cli.ts` (BR-1); nenhuma credencial em erro/log/transcript
  (redação; erros nomeiam o provedor, não a chave); nunca a subprocesso via argv. (T69)
- **R51 (health-check é probe barato, bounded, não-bloqueante, e é egress).** Nunca uma chamada
  de modelo paga; attempts limitadas + backoff+jitter + cooldown por-provedor + cap (edge 6);
  não-bloqueante no turno (BR-8); uma falha nunca derruba o comando (FR-21); gera evento de
  egress (BR-5). (T70)
- **R52 (o ledger é derivado-do-runtime, append-only e fail-closed; não sobrecarrega
  `SharedBudget`).** Uso contado do que o runtime observou, não auto-declarado pelo provedor
  para decisões de governança (R14/`gate-evidence.ts`); append-only (correção = novo registro);
  reader fail-closed (ledger ausente → "custo desconhecido", nunca zero); `SharedBudget`
  (tokens/governança) continua a autorização de gasto (BR-6); preço ausente reportado, nunca
  inventado (BR-10). (T71)
- **R53 (login/logout não degradam o lock do storage; logout remove do disco e reporta
  honestamente).** Escrita sempre via `AuthStorage` (`proper-lockfile` + atômico), nunca um
  caminho que contorne o lock; escrita que perde a corrida falha fechada (sem arquivo parcial);
  logout remove do persistente (FR-3) e reporta quando não havia nada (FR-4/BR-9). (T72)
- **R54 (política/catálogo de projeto é input não-confiável; modelo declarado é validado
  contra o catálogo conhecido; `baseUrl` customizado é egress-consentido).** Um modelo/provedor
  de política que não resolve a um provedor/modelo conhecido é recusado nomeando-o (edge 9),
  nunca "válido mas nunca resolve"; um `baseUrl` customizado herda o consentimento de egress
  (R47) e a disciplina TOFU (T28/T37 — mudança num clone = indicador de ataque). **Onde a
  política vive é decisão de segurança do Gate 4** (in-workspace → T56/T37; por-máquina →
  protected-path). Residual: exfil por config deliberada do próprio usuário é uso, não ataque —
  o teto é a execução do processo. (T73)

---

## 5. Lacunas reportadas de volta ao Gate 2 (a spec não cobriu / deve cravar)

O Gate 3 é iterativo com o Gate 2/4. Estas nasceram ao modelar as ameaças e **devem voltar à
spec** (`gate2-spec-fase7.md`) antes do Gate 5:

- **GAP-7A (resolução de OQ#2 — FR-15 deve cravar a distinção).** FR-15 registra o veto como
  "hipótese de trabalho"; o threat model o resolve: recusa fail-closed universal (14/14); veto
  a fallback automático absoluto nos 5 obrigatórios, opt-in-only e tier-floored + egress-consentido
  nos outros 9. Adotar como cravado (R48/R49). Responde à spec §9 questão 2.
- **GAP-7B (resolução de OQ#3 — BR-4/FR-18 devem cravar a formulação).** BR-4 deixa a ordem
  tier-mín-vs-mesmo-provedor em aberto; o threat model a resolve: **dois pisos independentes
  ANDados**; o candidato automático satisfaz ambos ou é rejeitado (tier) / rebaixado a
  consent-required (egress); na divergência sem candidato que satisfaça ambos, fail-closed-e-divulga.
  Adotar em BR-4/FR-18 (R47/R48). Responde à spec §9 questão 3.
- **GAP-7C (a política de projeto de FR-11 / edge case 9 é input NÃO-CONFIÁVEL — T73).** A spec
  trata o override de política (FR-11) como config de projeto confiável e o edge 9 como só
  "modelo inexistente"; o threat model acrescenta a metade crítica: uma `baseUrl` customizada
  repo-supplied é um vetor de **exfiltração** (SSRF-flavored), e a política é input não-confiável
  na disciplina TOFU (T28/T37). FR-11/edge-9 devem nomear ambos. **Insumo direto à §9.4/§9.7.**
- **GAP-7D (o health-check de FR-20 é egress, não um probe neutro — T70).** FR-20 enquadra o
  health-check como "reachability de rede simples"; o threat model acrescenta que **é egress
  (BR-5)** — revela ao provedor a configuração do projeto — e é um **vetor de amplificação de
  custo/DoS** sem bounds. FR-20/FR-21/BR-8 devem nomear o probe-barato-nunca-chamada-paga + os
  bounds (backoff/cooldown/cap). **Insumo à §9.5.**

**Nota de numeração.** A Fase 7 começa em `T65`/`R46`/secure-default `55`, estritamente acima
do máximo já atribuído (`T64`/`R45`/`54`), sem colisão nova. A colisão pré-existente
`T40–T42`/`R22` (Fase 5, nota N-2) **não é re-litigada aqui**.

---

## 6. Secure defaults acrescentados na Fase 7 (append aos itens 1–54 das fases anteriores)

Os itens 1–54 (Fases 0–6) permanecem. A Fase 7 acrescenta:

55. **A resolução nunca autoriza por credencial ambiente** — um `modelRole` sem modelo
    explicitamente mapeado resolve para ausência explícita, nunca "primeiro modelo com qualquer
    API key"; `findInitialModel` passo 4 proibido como caminho de resolução por-gate (R46/T65).
56. **Egress cross-provider é opt-in explícito, bloqueado por default no laço** — fallback que
    cruza provedor exige consentimento; sem humano para consentir, recusa (R47/T66).
57. **Tier mínimo é um piso duro, absoluto nos 5 obrigatórios** — nunca downgrade silencioso;
    nos obrigatórios, não-relaxável nem com consentimento (R48/T67).
58. **A resolução falha-fechada, universal aos 14 gates** — ausência explícita, nunca exceção
    engolida nem default; erro degrada para "indisponível", nunca "disponível" (R49/T68).
59. **Credencial só via o storage endurecido do vendor** — `AuthStorage` (lock/0600/atômico),
    nunca arquivo paralelo em texto plano, nunca em log/argv (R50/T69).
60. **Health-check é probe barato, bounded e não-bloqueante** — nunca chamada paga;
    backoff+jitter+cooldown+cap; falha de um provedor não derruba os demais (R51/T70).
61. **O ledger é derivado-do-runtime, append-only e fail-closed** — uso observado (não
    auto-declarado); preço ausente = "desconhecido", nunca zero; `SharedBudget` continua a
    autorização de gasto (R52/T71).
62. **login/logout compõem sobre o lock do storage; logout remove do disco e reporta honestamente**
    — nunca um segundo escritor; nunca finge remoção que não ocorreu (R53/T72).
63. **A política/catálogo de projeto é input não-confiável** — modelo declarado validado contra
    o catálogo conhecido, inválido recusado nomeando-o; `baseUrl` customizado = egress-consentido +
    TOFU (R54/T73).

**Aplicação (Pi/Conductor):** todos realizáveis sobre primitivos existentes — a distinção
`hasConfiguredAuth`/`getProviderAuthStatus`/`source` de `ModelRuntime` (R46/R50), o
`AuthStorage` endurecido (R50/R53), o contrato `runtime-derived`/`author-declared` de
`gate-evidence.ts` (R52), a disciplina fail-closed de `grounding-ledger.ts`/`policy-trust-store.ts`
(R49/R52), a enumeração `REDACTION_SINKS` (R50), a disciplina TOFU de `PolicyTrustStore`/`RoleTrustStore`
(R54), e o `builtinProviders()`/`resolveCliModel` do catálogo do vendor (R54). Nenhum mecanismo
novo é inventado; o Gate 4 os materializa em TS sem violar R46–R54.

---

## 7. Critérios de saída deste gate (Shostack: "fizemos um bom trabalho?")

- **Cobertura:** as 3 fronteiras novas (canal de credencial, pipeline de resolução como
  autorização, egress de fallback/health-check) e as 7 superfícies (SF-P1..SF-P7) são modeladas;
  os 8 eixos nomeados pela tarefa têm, cada um, ameaça + regra (§3); avaliei e descartei vetores
  adicionais com justificativa.
- **Priorização por prob × impacto:** 4× P1 (T65 egress via env — o achado central; T66 fallback
  cross-provider; T67 downgrade de tier; T73 config hostil/exfil), 4× P2 (T68 fail-open, T69 roubo
  de credencial, T70 health-check DoS, T71 ledger), 1× P3 (T72 corrida, mitigada por construção).
  Nenhuma sem mitigação vinculante.
- **Duas questões diferidas resolvidas:** OQ#2 (escopo fail-closed) e OQ#3 (BR6 vs. tier-mín) —
  ambas com recomendação concreta informada-por-ameaça para o Gate 4 ratificar (GAP-7A/7B).
- **Secure defaults:** 9 novos (55–63), todos sobre primitivos existentes.
- **Grounding honesto:** **forte** em STRIDE-per-element (Threat Modeling §3.3/§2.5/§2.3/§3.2,
  top **0.728**), fail-closed/secure-by-default (Security Engineering Principles §2.12/§2.2/§2.5,
  top **0.634**; Secure and Reliable Systems Design §1.12, 0.603), least-privilege/blast-radius
  (Secure and Reliable Systems Design §3.5/§3.2/§3.3, top **0.650**), e retry-amplification/bounded-backoff
  (Secure and Reliable Systems Design §1.5/§1.3/§1.12, top **0.605**). **Moderado** em egress/purpose-limitation
  (Data Protection & GDPR §1.1 + zero-trust networking §3.3, top **0.592**). **Declarado fraco/ausente**
  (não forçado): **integridade de metering/contabilidade de uso** (top **0.588**, Penetration Testing
  §15.2 business-logic, off-target — T71) e **TOCTOU/escrita-concorrente como tópico de segurança**
  (top **0.561**, off-target — T72), ambos ancorados em precedente de código já testado
  (`gate-evidence.ts` R14, `SharedBudget`/ADR 0004 §5.3, `auth-storage.ts` lock) + fail-closed geral,
  não em citação forçada — a mesma disciplina de gap-declarado das Fases 5/6.
- **Lacunas reportadas:** 4 GAPs (7A–7D) de volta ao Gate 2, + nota de numeração.
- **Iteração Gate 3↔4 (CLAUDE.md):** T65 (o ramo "sem mapeamento" do resolvedor), T73 (onde a
  política de projeto vive) e T71 (o pacote do ledger) tocam decisões de arquitetura que o Gate 4
  deve materializar sem violar R46–R54; se o Gate 4 expuser uma superfície nova (ex.: um cache de
  disponibilidade que persista o pool de modelos, reabrindo uma fronteira de dados; um formato de
  política que reuse um loader não-confiável), **retornar a este gate**.

### 7b. Vinculante pro Gate 9 (verificação empírica de pentest — padrão §7b das Fases 4/5/6)

Estas exigem **exploração real** contra o binário/pipeline, não só documentação — na disciplina
de "tentar de verdade, não só afirmar", e no **scratch-dir isolado** que a memória de sessão
registrou como obrigatório para qualquer execução real de comando (achado da Fase 2):

1. **T65 — egress via credencial ambiente.** Exportar um `DEEPSEEK_API_KEY` (ou similar) falso,
   configurar um projeto SEM mapear esse provedor a nenhum gate, e confirmar que a resolução de um
   gate **recusa/não autoriza** esse provedor (não cai em `findInitialModel` passo 4). Confirmar
   que `conductor auth` **reporta** a credencial como `source:"environment"` mas a resolução não a
   usa. Reproduzir o incidente original e provar que R46 o fecha na resolução primária.
2. **T66/OQ#3 — fallback cross-provider.** Tornar o primário indisponível, oferecer só um candidato
   do mesmo tier em OUTRO provedor, e confirmar que o fallback **não cruza automaticamente** — que
   pede consentimento (modo atendido) ou recusa (modo laço). Confirmar o evento de egress.
3. **T67/OQ#2 — downgrade de tier.** Mapear o Gate 9 a um tier forte, deixar só um modelo mais fraco
   disponível, e confirmar que a execução **recusa** (nunca roda com o modelo fraco), nomeando o
   tier que faltou. Confirmar que nem consentimento relaxa o piso num obrigatório.
4. **T68 — fail-open.** Injetar um erro em cada etapa da cascata de resolução (config ilegível,
   health-check que lança) e confirmar que cada um **degrada para recusa**, nunca para "prossiga
   com um default".
5. **T69 — vazamento de credencial.** Confirmar que `login` grava **apenas** via `AuthStorage`
   (permissão `0600`, lock — nenhum arquivo paralelo em texto plano no CWD), e que um erro de
   resolução/log **nunca** imprime a chave (só o nome do provedor).
6. **T70 — health-check DoS/custo.** Apontar um provedor a um endpoint lento/que-não-responde e
   confirmar que o health-check/retry **não** entra em tempestade (backoff/cooldown observáveis),
   **não** bloqueia o turno, e **não** é uma chamada paga.
7. **T71 — ledger.** Apagar/truncar o ledger e confirmar que o custo colapsa para "desconhecido"
   (não zero); confirmar que `SharedBudget` (o teto de governança) **não** depende do ledger de $.
8. **T72 — corrida login/logout.** Rodar `login`/`logout` concorrentes no mesmo provedor e
   confirmar não-corrupção de `auth.json` (o lock segura); confirmar que `logout` remove do disco.
9. **T73 — config hostil.** Plantar uma política de projeto (num clone/scratch) declarando um
   provedor `openai-compatible` com `baseUrl` para um endpoint local de captura, e confirmar que a
   resolução **recusa/pede-consentimento** para o `baseUrl` customizado — que o prompt **não** é
   exfiltrado silenciosamente. Confirmar que um modelo inexistente é recusado nomeando-o.

**Nenhum finding crítico/alto não-mitigado em aberto no nível de design.** As nove ameaças têm
regra vinculante; três (T65 egress-na-fonte, T73 exfil por config, T66 fallback cross-provider)
carregam residuais declarados — o teto de execução do processo confiado (T17/R1), a exfil por
config deliberada do próprio usuário, e a ausência de sandbox — que **só o Gate 9 confirma como
fechados na prática**. O design reduz o risco a um nível aceitável e **detectável**, não a zero.
