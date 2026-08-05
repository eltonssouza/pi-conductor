# ADR 0001 — Adotar o Pi como runtime do Conductor Coding Agent

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-05
- **Gate:** 4 (Arquitetura, design defensivo e SLOs)
- **Demanda:** `pi-conductor` — reconstruir o Conductor Coding Agent sobre o runtime Pi (github.com/earendil-works/pi)
- **Autor (papel):** software-architect
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças a esta decisão criam um ADR sucessor, não editam este
  (Documenting Software Architecture — Complete Professional Guide, §3.10 "ADRs são imutáveis; mudanças
  supersedem"; The Practice of Architecting — Complete Professional Guide, §2.8 checklist).
- **Insumo concorrente:** o threat model do Gate 3 (`docs/conductor/gate3-threat-model.md`) **ainda não
  existe** na hora desta escrita (confirmado por `ls`). Pelo próprio protocolo do projeto, "Gate 3 e Gate 4
  são iterativos, não estritamente sequenciais". Este ADR trata segurança pelo que já está fixado no
  Gate 1 (7 regras de negócio) e no PRD (§3.3 fail-closed, §14 riscos), e **exige um adendo** (ADR 0001-A)
  quando o threat model do Gate 3 aterrissar, para reconciliar cobertura do hook `tool_call`, confiança em
  extensions/packages de terceiros e prompt injection (que o Pi declara fora de escopo).

---

## 1. Contexto

### 1.1 Origem da decisão

O PRD (`plano_desenvolvimento.md`, §3.1–3.2, §7.6, §8 Fase 0) recomenda adotar o Pi como fundação de
runtime via **composição antes de fork**. O Gate 1 (`docs/conductor/gate1-discovery.md`, §1.3–1.4)
aceitou essa direção como hipótese testável (**H1**) mas **adiou deliberadamente a decisão formal** para
este ADR, porque é uma decisão arquitetural "difícil de reverter e que molda um atributo de qualidade" —
o critério que a literatura usa para justificar o custo de deliberação de um ADR (Software Architecture and
Quality Attributes — Complete Professional Guide, §1.12 "When not to treat a decision as architectural").
Este ADR fecha a decisão com base na evidência da Fase 0.

### 1.2 Base de evidência (não re-derivada aqui)

A base primária é o recon técnico read-only do Pi em `docs/conductor/_recon-pi-architecture.md`. Os fatos
abaixo são **citados**, não redescobertos:

- **O Pi expõe DUAS superfícies não-intercambiáveis para "dirigir uma sessão"** (recon §0, §1, §4):
  1. `Agent`/`AgentSession` (`createAgentSession()`, packages `agent` + `coding-agent`) — **estável**, é o
     que SDK, RPC e CLI usam hoje.
  2. `AgentHarness` v2 — um design doc de 3165 linhas cujos métodos operacionais (`prompt`, `steer`,
     `abort`, `resume`, `compact`, `navigateTree`, `createLane`, …) **rejeitam com `HarnessNotImplemented`**.
- **Verificação independente desta sessão** (o Gate 4 não confia só no recon): `git log` no branch atual
  (`feature/fase0-descoberta-arquitetural`) tem como topo exatamente os commits que o recon cita
  (`c38319ea1 share state between memory and JSONL sessions`, `a5953d2e1 validate harness recovery record
  logs`); e `grep` em `packages/agent/src/harness/agent-harness.ts` confirma **17 rejeições
  `HarnessNotImplemented`/`unavailable()`**, com `prompt/steer/resume/compact/abort/navigateTree/createLane`
  ainda stubs nas linhas 368–464. O commit `44289550a promote durable harness API` **promoveu a superfície
  da API, não a implementação das operações** — elas continuam rejeitando. O recon procede.
- **`pi.on("tool_call", …)` é um hook genuíno de pré-execução** — muta `event.input` in place ou retorna
  `{ block: true, reason }` para negar; dispara depois de `tool_execution_start` mas **antes** da execução
  real da ferramenta; múltiplos handlers encadeiam (recon §2). É o primitivo sobre o qual o permission gate
  do Conductor será construído.
- **Convenção de workspace é `packages/*` puro** — novos `packages/conductor-*` entram como irmãos, com
  **zero mudança** nos packages existentes do Pi (recon §10). Versionamento do monorepo Pi é **lockstep**
  ("todos os packages compartilham uma versão"; recon §10).
- **O skill loader do Pi é compatível com o padrão Agent Skills** e já olha para `~/.claude/skills` — as 44
  skills `.claude/skills/*/SKILL.md` do Conductor são plausivelmente reutilizáveis com pouca/nenhuma
  conversão (recon §6).
- **Lacunas 100% do Conductor** (recon §9, "Gaps"): não há máquina de estados de gate/papel, não há conceito
  de model-role tier (só `scopedModels` por sessão), não há fallback automático de provedor, não há schema
  de evidência/journal, e — crucialmente — **não há NENHUM sistema de permissão embutido** ("Pi does not
  include a built-in permission system…", README + `security.md`). Project trust **não** é um gate de
  permissão em runtime; prompt injection é **explicitamente fora de escopo** do Pi.
- **RPC (stdio JSON) é estável**; o stack CBOR/socket (`protocol`/`server`/`client`) é explicitamente
  experimental, sem implementação de serviço default (recon §5).

### 1.3 Restrições não-negociáveis herdadas (Gate 1 §3, §4)

Duas moldam esta decisão diretamente:

- **Fail-closed (regra 1):** qualquer operação sem política explícita é negada por padrão. Dado que o Pi
  **não tem enforcement algum**, essa garantia passa a repousar **inteiramente** no código do Conductor.
- **Dual-harness (regra 7 / H2):** a capacidade de **emitir** o Conductor para harnesses de terceiros
  (Claude Code, Codex, Cursor via `.claude/agents`, `CLAUDE.md`, `AGENTS.md`, regras do Cursor) **coexiste**
  com o runtime nativo Pi e **não é degradada** por ele. Esta é uma restrição de escopo, não uma decisão de
  runtime — e, como se verá em §4.5, é o argumento arquitetural mais forte contra colocar *todo* o Conductor
  dentro do fork do Pi.

### 1.4 Atributos de qualidade priorizados (para esta decisão)

Em ordem, e é a ordem que governa os trade-offs abaixo (não há arquitetura certa, só a menos errada para
este contexto):

1. **Segurança / correção fail-closed** — é a promessa do produto; tem prioridade sobre desempenho.
2. **Manutenibilidade / baixa divergência do upstream** — o esforço poupado no runtime é a tese H1; um fork
   permanente devolve esse esforço em taxa de merge.
3. **Preservação da governança existente** (14 gates, papéis, skills, memória, dual-harness) — nada pode
   regredir.
4. **Operabilidade** — SLIs/SLOs rascunhados aqui (§5), instrumentados no Gate 11.
5. **Desempenho** — importa (o hook está no caminho quente de cada tool call), mas é o último a ceder.

---

## 2. Decisão

**Adotamos o Pi como runtime do Conductor Coding Agent, por composição:** a governança do Conductor
(permission engine, protected paths, máquina de 14 gates, model-role routing, captura de evidência, memória
Library/Diary, emissor dual-harness) é construída como **`packages/conductor-*` (irmãos) + `extensions/*`**,
consumindo os primitivos estáveis do Pi. **Nenhum patch ao código-fonte do próprio Pi é necessário para a
Fase 0**, e — pela análise de §4 — para nenhuma das capacidades do MVP.

Isto confirma a direção do PRD §3.2/§7.6, **com três refinamentos deliberados** (não é carimbo):

### 2.1 Superfície do Pi: `Agent`/`AgentSession`, não `AgentHarness` v2

Construímos contra a superfície **estável** `Agent`/`AgentSession` + `SessionManager` JSONL. **Não**
assumimos que o modelo durável multi-lane do `AgentHarness` exista — porque, verificadamente, ele não existe
(§1.2). Consequência concreta e vinculante:

> A camada de sessão/checkpoint/evidência do Conductor **NÃO pode depender** de lanes, operation-log durável
> ou crash-recovery do harness-v2. Ela terá **estado próprio** — um `ConductorSessionStore` que o Conductor
> possui — sobre `AgentSession` + JSONL. Esse store é uma **anti-corruption layer fina**: o schema de
> evidência/journal é do Conductor; o substrato de persistência (JSONL hoje) é trocável. Se/quando o
> harness-v2 estabilizar (o recon nota que sua chegada é *breaking*), reavaliamos migrar o substrato **sem
> reescrever o schema de evidência** — isso é registrado como ponto de reavaliação, não como dependência.

Trade-off aceito: o par `Agent`/`AgentSession` + JSONL **é** fork/branch/resume-capaz hoje (recon §4), mas
**não** oferece as garantias de crash-recovery que o harness-v2 projeta. Para PoC-scale (Fase 0) e para o MVP
(PRD §15), fork/branch/resume + checkpoints por compaction são suficientes; a garantia crash-safe formal fica
como débito conhecido, endereçável quando o upstream a entregar — e não é um bloqueador porque a evidência do
Conductor é append-only em JSONL, que já sobrevive a um crash entre entradas.

### 2.2 Fronteira de repositório: o fork é o veículo de exploração, não o lar permanente

O PRD §6 desenha um monorepo `conductor-agent/` **autônomo** (packages/core, runtime, roles, …), enquanto o
enunciado da demanda fala em `packages/conductor-*` **dentro do fork** `eltonssouza/pi-conductor`. Isso é uma
tensão real, e a resolvemos assim:

- **Durante a Fase 0 (esta fase):** desenvolver **dentro do fork** é pragmático e correto — precisamos ler os
  internals do Pi, o walking skeleton se beneficia de um build único, e experimentos descartáveis de patch ao
  core (para *testar* se falta um seam) são baratos ali. O recon §10 confirma que os irmãos `conductor-*`
  entram sem tocar em nenhum package do Pi.
- **Fronteira-alvo (Fase 1+):** o conteúdo canônico e a orquestração do Conductor vivem em **workspace de
  propriedade do Conductor**, e o Pi é consumido como **`@earendil-works/pi-*` versionado e pinado**, atrás do
  `conductor-runtime` adapter (a mesma anti-corruption layer de §2.1). Razões, na ordem dos atributos de §1.4:
  (a) a **regra de dependência** — a governança do Conductor é a regra de negócio de vida longa; o runtime Pi
  é a infraestrutura trocável; a fronteira pertence exatamente aí, não espalhada como fork do core
  (Architecture Boundaries and the Dependency Rule — Complete Professional Guide, §1.12: o custo de fronteira
  se paga onde "as regras de negócio sobrevivem à infraestrutura"); (b) **risco de divergência** (PRD §14,
  linha 1, "Alto") — pinar uma versão publicada minimiza a taxa de rebase; (c) **lockstep versioning** do
  monorepo Pi (recon §10) acoplaria a cadência de release do Conductor à do Pi se os packages morarem dentro
  dele; (d) a restrição **dual-harness** (§4.5).

Não é uma contradição com "composição antes de fork": o fork é o ambiente de trabalho da Fase 0 (com upstream
configurado), e a *direção* é reduzir a superfície de fork a zero patches, conforme o próprio §7.6 exige
("remover o patch após adoção upstream").

### 2.3 Skills e model-role reaproveitados como primitivos, não reconstruídos

O skill loader do Pi (Agent-Skills-compliant, progressive disclosure, aliasing `~/.claude/skills`) é um
**superset** do que o Conductor precisa (recon §6): as 44 skills entram via entrada `skills` em settings.json,
pendente de validação de frontmatter. O conceito de **model-role** (strategic/standard/lightweight →
`@plan/@default/@slow/@smol`) **não** tem casa no `pi-ai` (recon §7), então é código novo do Conductor — mas
usando `scopedModels` como *pool candidato* por papel e `session.setModel()` como atuador; não exige fork.

---

## 3. Critérios de fork-controlado aplicados (PRD §7.6)

O PRD §7.6 lista cinco gatilhos para justificar um fork do código do Pi. Aplico cada um às capacidades
concretas que o Conductor precisa. **Nenhum gatilho está acionado hoje.**

### 3.1 Capacidade × primitivo × classificação

| Capacidade do Conductor | Primitivo do Pi (recon) | Classificação | Fork? |
|---|---|---|---|
| **Permission gate** (block/modify por política) | `pi.on("tool_call")` pré-exec, `{block,reason}` (§2, §9) | extension pura | **Não** |
| **Protected paths** (`~/.ssh`, `.env` fora do workspace, pais do projeto) | `tool_call` + `realpath` + `withFileMutationQueue` (§2, §3) | extension pura | **Não** |
| **Máquina de estado de 14 gates** + checkpoint humano | `registerCommand` + `ctx.ui.confirm`/`select` (TUI e RPC) + `appendEntry` + package (§2, §4, §9) | package/extension | **Não** |
| **Model-role routing** (recusa fail-closed se não há modelo do tier) | `model_select` hook + `setModel` + `scopedModels` pool; recusa na camada de composição antes de `createAgentSession` (§7) | package/extension | **Não** |
| **Captura de evidência / journal** (schema de gate, citação, risco aceito) | `appendEntry` (custom entries) + `setLabel` como substrato (§4, §9) | extension/package | **Não** |
| **Emissão dual-harness** (`.claude/`, `AGENTS.md`, Cursor) | — (ortogonal ao Pi; o Pi nem participa) | Conductor-owned | **Não** |

### 3.2 Os cinco gatilhos do §7.6, um a um

1. *"Uma API necessária não é exposta"* — **não acionado.** Todas as APIs necessárias existem: `tool_call`,
   `registerTool`, `registerCommand`, `appendEntry`/`setLabel`, `setModel`, `DefaultResourceLoader`
   (`systemPromptOverride`), hooks de ciclo de sessão.
2. *"Uma extensão não consegue aplicar política antes da operação"* — **não acionado.** O `tool_call` é
   comprovadamente pré-execução, com bloqueio e mutação in place (recon §2). É o cenário exato dos exemplos
   "confirm before `rm -rf`" e "block writes to `.env`" da própria doc do Pi.
3. *"Não existe suporte suficiente a metadados"* — **não acionado.** `custom entries` + labels + o adapter
   `ConductorSessionMetadata` (PRD §7.5) cobrem `projectId/demandId/gate/role/parentSessionId/budget`.
4. *"O ciclo de vida da sessão não pode ser interceptado"* — **não acionado.** Existem
   `session_start/shutdown/before_switch/before_fork`, `before_agent_start`, `turn_start/end` (recon §2).
5. *"O comportamento necessário é relevante para segurança"* — **este é o único a vigiar.** O comportamento
   de segurança (o permission gate) **é** alcançável pelo hook pré-exec. O resíduo não é uma API faltante do
   Pi, e sim uma **propriedade de não-bypass**: a garantia fail-closed só é tão forte quanto "o permission
   gate está sempre carregado, primeiro, e não pode ser sobrescrito por outra extension registrada depois".
   Como o Conductor controla o bootstrap do `createAgentSession` (quais extensions carregam e em que ordem),
   isso é resolvível **em composição** — carregando o permission gate como *core extension confiável do
   Conductor*, não como extension de usuário — e **não** exige patch ao Pi. **Reavaliar após o Gate 3.**

**Conclusão de §3:** nenhuma capacidade do MVP é fork-worthy. O candidato mais afiado (não-bypass do
fail-closed) resolve-se por controle do bootstrap de sessão, que o Conductor já possui por composição. Se o
threat model do Gate 3 identificar um caminho de execução de ferramenta que **não** passe pelo `tool_call`
(p.ex. um built-in tool com side-effect fora do dispatch interceptado, ou um package de terceiro que execute
no load), aí — e só aí — reabrimos o gatilho 5. Registrado como risco aberto (§4.2).

---

## 4. Consequências

### 4.1 Positivas

- O esforço de engenharia sai do runtime não-diferenciador (loop, sessões, streaming, tool dispatch, TUI) e
  vai para a governança diferenciadora — a validação direta de H1 (Gate 1 §1.4).
- ~34 provedores, streaming, tool-calling, persistência de sessão fork/branch/resume, skill loader
  progressive-disclosure e 4 modos de execução (interactive/print/json/rpc) vêm de graça do Pi (recon §7, §8).
- As 44 skills e o conteúdo canônico de papéis migram com baixa fricção (recon §6).
- Fronteira limpa (adapter) mantém o Pi **trocável** — o interface-vs-implementação se paga precisamente no
  caso "trocar de fornecedor" (Object-Oriented Thinking — Complete Professional Guide, §2.12).

### 4.2 Riscos aceitos (com mitigação)

| # | Risco | Sev. | Mitigação |
|---|---|---|---|
| R1 | **Divergência do upstream do Pi** ao longo do tempo (PRD §14, linha 1) | Alto | Consumir packages publicados + pinar versão + adapter fino; patches (se algum dia) isolados e com plano de remoção (§7.6). Fronteira-alvo de §2.2. |
| R2 | **Fail-closed repousa 100% no código do Conductor** — o Pi tem ZERO enforcement embutido (recon §9). Não há rede de segurança do Pi por trás do hook `tool_call`. Se a extension não carregar, ou um caminho de tool escapar do hook, **não há default-deny do runtime**. | **Crítico** | Permission gate como *core extension confiável* carregada primeiro no bootstrap do Conductor (não como user extension); invariant validator (PRD §10, regras 6/7/8: toda tool declara permissão, sem permissão → negada, protected paths inacessíveis); **mutation testing** no permission engine (PRD §9.5); suite de segurança (PRD §9.4: path traversal, symlink escape, bypass de aprovação). **Correção-SLO de §5.4 mede exatamente isto.** |
| R3 | **Dependência do harness-v2** — construir sessão sobre `AgentSession` significa que a chegada (breaking) do harness-v2 pode forçar migração de substrato. | Médio | `ConductorSessionStore` como anti-corruption layer (§2.1): schema de evidência do Conductor desacoplado do substrato JSONL/harness. Ponto de reavaliação, não dependência. |
| R4 | **Extensions/packages do Pi rodam com acesso total ao sistema** (PRD §14, linha 2; recon §9). Carregar um package de terceiro é execução de código arbitrário. | **Crítico** | Fora do escopo de decisão *deste* ADR; é insumo direto do threat model do Gate 3. Registrado aqui para o adendo. Postura: project-trust do Pi + allowlist de packages + revisão manual de novas dependências (PRD §12). |
| R5 | **Prompt injection** de arquivos de repositório é declarado fora de escopo pelo Pi (recon §9). | Alto | Separar dados de instruções + política (PRD §14, linha 3). Detalhamento no Gate 3. |
| R6 | **Fork como lar permanente eroderia o dual-harness** (ver §4.5) — risco que o PRD §6 **não** resolve. | Alto | Ver §4.5 e §2.2: conteúdo canônico harness-agnóstico fora do formato nativo Pi; Pi como *um* alvo de render, não a raiz. |

### 4.3 Negativas / custos assumidos

- O Conductor escreve **todo** o permission engine, a máquina de gates, o model-role routing e o schema de
  evidência do zero (recon "Gaps" 1–5) — nenhum é presente do Pi. É trabalho real, apenas construído sobre
  primitivos em vez de infraestrutura pronta.
- A garantia crash-safe formal fica como débito até o harness-v2 (§2.1).
- Manter o adapter `conductor-runtime` é custo de manutenção contínuo — o preço da trocabilidade.

### 4.4 Impacto no diagrama de arquitetura (refino do PRD §5)

O diagrama em camadas do PRD §5 permanece válido, com uma inserção explícita: entre "Conductor Services" e
"Pi Runtime" há a **`conductor-runtime` anti-corruption layer** (a fronteira de §2.1/§2.2). Módulos do
Conductor dependem **do adapter**, nunca de internals do Pi — a regra de fronteira imponível
"`conductor.* -> pi.internal.*` = deny" (Architecture Styles and Trade-offs — Complete Professional Guide,
§1.4–1.5: modularidade e topologia de deploy são independentes; a fronteira imponível é uma propriedade de
design, testável no build).

### 4.5 Risco não plenamente sinalizado pelo PRD: o fork versus o dual-harness

O PRD §6 desenha o layout de repositório com o runtime nativo Pi implicitamente como raiz, e o Gate 1 §3 já
alertou que isso pode empurrar o "modo emissor" para segundo plano. **Torno explícito o corolário
arquitetural:** se *todo* o conteúdo canônico do Conductor for autorado no formato nativo do Pi *dentro* do
fork, o emissor dual-harness (H2, não-negociável) degrada — o conteúdo `content/roles`, `content/skills`,
`content/gates` precisaria ser re-derivado para `.claude/`/`AGENTS.md`/Cursor a partir de um formato que já
nasceu acoplado ao Pi. A mitigação é arquitetural e vira decisão deste ADR: **o conteúdo canônico é
harness-agnóstico e mora no workspace do Conductor**; os packages nativos Pi **e** o emissor de terceiros são
ambos *alvos de render* do mesmo `content/`. Isso reforça §2.2 (Pi como dependência consumida, não raiz).

---

## 5. SLIs / SLOs rascunhados (PoC-scale — Gate 4 define, Gate 11 instrumenta)

Mantidos leves e proporcionais à Fase 0 (Software Architecture and Quality Attributes — Complete Professional
Guide, §1.12: não gastar a cerimônia da decisão irreversível numa fatia de PoC). Distinguem-se **SLOs de
desempenho** (percentis) de **SLOs de correção** (conformidade binária) — e a promessa real do produto é de
correção, não de latência.

### 5.1 Latência de avaliação do hook `tool_call` (desempenho)
- **SLI:** wall-time gasto dentro do handler do permission gate, por tool call.
- **SLO (rascunho):** p99 < 50 ms de overhead adicionado por tool call. Justificativa: o hook está no caminho
  quente **antes de cada** execução de ferramenta; caro aqui multiplica por toda tool call da sessão.

### 5.2 Latência de escrita de persistência de sessão (desempenho)
- **SLI:** wall-time de um append JSONL (entrada de mensagem/tool-result/checkpoint).
- **SLO (rascunho):** p99 < 100 ms por entrada.

### 5.3 Tempo de retomada de sessão (desempenho)
- **SLI:** wall-time de `SessionManager.open()` + reconstrução de contexto até primeiro prompt pronto.
- **SLO (rascunho):** < 2 s para sessões PoC-scale (walking skeleton).

### 5.4 Escapes de escrita não autorizada — **SLO de CORREÇÃO (a promessa do produto)**
- **SLI:** nº de tool calls de write/exec/network/security fora da política que **executam** (deveriam ser
  bloqueadas), medido pela suite de segurança + invariant validator + mutation tests, não em produção.
- **SLO:** **ZERO.** 100% das operações fora da política protegida (protected paths, tools sem permissão
  declarada) são negadas. **Error budget = 0** — é fail-closed; não é um percentil, é uma invariante. É a
  materialização direta do risco R2 e a razão de existir do produto.

### 5.5 Completude de evidência por gate — **SLO de correção**
- **SLI:** % de gates fechados que têm ≥1 artefato de evidência verificável (PRD §3.4).
- **SLO:** 100%. Nenhum gate fecha só com texto do modelo.

### 5.6 Recusa fail-closed de model-role — **SLO de correção**
- **SLI:** % de sessões de gate crítico sem modelo do tier configurado que são **recusadas** (não
  degradadas silenciosamente; PRD §4.15).
- **SLO:** 100%. Gate crítico não sofre downgrade silencioso.

---

## 6. Alternativas consideradas e rejeitadas

### 6.1 (a) Manter o loop Python atual do Conductor e não usar o Pi
**Rejeitada.** Perpetua o gasto de engenharia em runtime não-diferenciador que o próprio PRD §11.2 já assume
substituível (TUI, sessão, tool dispatch, event stream, compactação). O Gate 1 §1.2 fundamenta com
Outside-In Development (§1.12): rodar/reforçar um esqueleto sobre uma arquitetura que **já existe** "não prova
nada… só atrasa a fatia real". Não move nenhum dos atributos de qualidade priorizados (§1.4); mantém a taxa
de manutenção do runtime que a decisão quer eliminar.

### 6.2 (b) Construir um runtime do zero
**Rejeitada.** Repete o mesmo erro em nova linguagem: orçamento de engenharia em infraestrutura genérica
(loop, sessões, tool-calling, TUI, ~34 integrações de provedor) em vez de na governança (Gate 1 §1.3).
Piora os riscos do PRD §14 "Alto custo de modelos" e "Complexidade" sem ganho de diferenciação. Um runtime
maduro (Pi) já existe, com MIT license, SDK, RPC, extensions e skill loader padronizado (recon §0, §6, §8).

### 6.3 (c) Forkar o core do Pi diretamente, em vez de compor por extensions/packages
**Rejeitada.** É a alternativa mais próxima e por isso a mais importante de refutar com evidência. Perde por
dois motivos concretos: (i) o recon §10 **prova** que os irmãos `conductor-*` funcionam com **zero edições**
ao core do Pi — logo um fork de core **não compra nada** que o seam de extension já não entregue (§3); e
(ii) paga uma **taxa de merge permanente** contra o upstream — exatamente os riscos "Divergência do upstream"
e "Fork permanente" (ambos "Alto") do PRD §14. A literatura corrobora pôr a fronteira onde a implementação
realmente troca (o adapter do Pi), e **não** espalhá-la como custo de fronteira em cada arquivo do core que
não precisa dela (Architecture Boundaries and the Dependency Rule — Complete Professional Guide, §1.12: o
custo de fronteira só se paga onde as regras de negócio sobrevivem à infraestrutura — a governança do
Conductor sobrevive, o core do Pi é a infra trocável). Um fork de core inverteria essa relação: pagaria o
custo de fronteira no lugar errado, permanentemente.

> Nota honesta de grounding: as passagens retornadas pelo RAG para "composição vs fork" são majoritariamente
> do tipo *"quando NÃO"* separar/inverter/esconder (DDD §5.12; Boundaries §1.12; Object-Oriented Thinking
> §2.12/§3.12). Elas não tratam literalmente de "forkar uma dependência upstream" — o corpus não cobre esse
> caso com um match forte (top score 0.618). Foram aplicadas por analogia defensável (a fronteira Conductor↔Pi
> **é** o caso "trocar de fornecedor" onde a interface se paga), e essa limitação de cobertura é reportada em
> vez de forçada, conforme o contrato de grounding do projeto.

---

## 7. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4`:

1. **Composição/extensão sobre fork de dependência** → *Architecture Boundaries and the Dependency Rule —
   Complete Professional Guide*, §1.12 ("When not to invert dependencies" — custo de fronteira só onde regras
   de negócio sobrevivem à infra); *Object-Oriented Thinking — Complete Professional Guide*, §2.12/§3.12
   (interface/composição se pagam ao "trocar de fornecedor", não como reflexo); *Domain-Driven Design —
   Complete Professional Guide*, §5.12 (não converter fronteira de pacote em fronteira de deploy sem
   necessidade). Aplicadas em §2.2, §3, §6.3, §4.4. **Cobertura fraca reportada** (top 0.618; corpus não
   cobre "fork de upstream" diretamente — ver nota em §6.3).
2. **Prática de ADR (status/contexto/decisão/consequências/alternativas)** → *The Practice of Architecting —
   Complete Professional Guide*, §2.2 ("decisões não documentadas são re-litigadas… ADRs preservam
   rationale"), §2.8 (checklist: context/decision/consequences/status; imutáveis; supersedem; em VCS);
   *Documenting Software Architecture — Complete Professional Guide*, §3.5 e §3.10 (exemplo real + anti-padrões:
   não editar ADRs passados). Top 0.707 — match forte. Estrutura deste ADR segue-as.
3. **SLIs/SLOs em arquitetura inicial** → *Software Architecture and Quality Attributes — Complete
   Professional Guide*, §3.4 (avaliar contra cenários de forma barata; táticas de performance/availability) e
   §1.12 (não tratar toda decisão como arquitetural — proporcionalidade da cerimônia). *Solution Architecture
   — Complete Professional Guide*, §3.2 (trade-offs de custo/latência). Top 0.568 — match moderado; aplicado
   em §5 para manter os SLOs leves e PoC-scale.
4. **Secure defaults / fail-closed / chokepoint único** → *Architecture Boundaries and the Dependency Rule*,
   §1.12; *Architecture Styles and Trade-offs — Complete Professional Guide*, §1.4–1.5 (fronteira de módulo
   imponível no build: `deny billing.*->orders.internal.*`) — aplicado em §4.4 para a regra
   `conductor.*->pi.internal.*`. Top 0.551 — match moderado; o ângulo "single chokepoint de autorização" não
   retornou passagem forte no corpus de arquitetura (é mais tema de segurança — a ser aprofundado no adendo do
   Gate 3).

Diário: `cdt journal recall` confirmou o contexto do Gate 1 (H1, dual-harness H2, adiamento da decisão para
este ADR) e a execução paralela de três agentes no Gate 4 (threat model do Gate 3, este ADR, matriz+gaps).

---

## 8. Follow-ups

- **ADR 0001-A (adendo)** quando `docs/conductor/gate3-threat-model.md` aterrissar: reconciliar cobertura do
  hook `tool_call`, confiança em packages/extensions de terceiros (R4), prompt injection (R5), e reabrir o
  gatilho 5 de §3.2 se o threat model achar um caminho de tool fora do dispatch interceptado.
- **Fase 0 walking skeleton** deve exercer o critério de falseabilidade de H1 (Gate 1 §1.4): abrir sessão →
  chamar modelo → ler/editar com aprovação (exercita o permission gate de §3) → rodar testes → persistir →
  retomar — e não introduzir limitação estrutural que impeça fail-closed, delegação isolada ou captura de
  evidência. Se introduzir, H1 é refutada e a decisão de build-vs-adopt reabre.
- **Validar** in loco que as 44 skills `.claude/skills/*/SKILL.md` carregam via entrada `skills` do
  settings.json do Pi sem conversão (recon §6 diz "plausível", não "confirmado").
- **Matriz Pi × Conductor + lista de gaps upstream** — entregável irmão da Fase 0, sendo escrito
  concorrentemente pelo solutions-architect em arquivo separado; este ADR não o duplica.

---

## Adendo 0001-A — Reconciliação com o Gate 3 (threat model da Fase 0)

**Status:** anexado após aprovação do checkpoint; não edita as seções 1–8 acima
(ADRs são imutáveis — §0, Documenting Software Architecture §3.10). Escrito pelo
orquestrador a partir de `docs/conductor/gate3-threat-model.md`, que aterrissou
depois deste ADR.

**Reconciliação, ponto a ponto:**

1. **Gatilho 5 (§3.2) — condição de reabertura foi tecnicamente atingida, mas
   Gate 3 a neutraliza por escopo, não por patch.** O ADR previu reabrir o
   gatilho de fork "se o threat model achar um caminho de tool fora do
   dispatch interceptado". O Gate 3 achou exatamente isso — **T4(b)**: uma
   extension/package pode chamar `child_process`/`fs` diretamente, sem passar
   por `pi.on("tool_call")`, e o hook nunca dispara. Isto confirma a
   observação de fronteira do próprio Gate 3 (TB6): "no Pi um plugin não é
   cliente do processo, ele **é** o processo". A mitigação do Gate 3 para a
   Fase 0 é **reduzir escopo** (nenhuma extension/skill/package de terceiros
   carregada — só first-party do Conductor), não um patch ao Pi. Logo: **o
   gatilho 5 continua não-acionado para a Fase 0** especificamente porque não
   há código não-confiável no TCB nesta fase. **Isto é adiamento, não
   resolução** — quando a Fase 2 permitir extensions/packages de terceiros
   (requisito real do PRD §4.6, §8), a pergunta "isso exige um patch/seam novo
   do Pi (p.ex. um host de extension sandboxado) ou basta allowlist+assinatura
   em composição?" precisa ser refeita como uma decisão de arquitetura própria
   — não herdar por omissão a conclusão "não-acionado" deste ADR. Registrado
   como item de arquitetura pendente para a Fase 2, não como risco fechado.

2. **R2, R4, R5 do ADR (§4.2) foram detalhados, não alterados, pelo Gate 3.**
   R2 (fail-closed repousa 100% no código do Conductor) → Gate 3 T3/T8: a
   correção concreta é "handler nunca lança; timeout de `ctx.ui.confirm()`
   default = DENY", já incorporado como secure default (Gate 3 §5, item 2/7).
   R4 (extensions com privilégio total) → Gate 3 T4, risco residual aceito
   explicitamente, mesmo veredito de severidade (Crítico) e mesma fronteira de
   sign-off (CISO, entrada na Fase 1/2). R5 (prompt injection fora do escopo
   do Pi) → Gate 3 T5, mesma conclusão: contenção via permission-gate, não
   prevenção; ambos os documentos relatam a mesma lacuna de cobertura da
   biblioteca (sem capítulo dedicado a prompt injection de LLM) em vez de
   forçar citação.
3. **Nenhuma fronteira de confiança nova** apareceu no Gate 3 que este ADR não
   tivesse antecipado em §1.2–§1.3 — o DFD de 6 travessias (TB1–TB6) do Gate 3
   é um refinamento diagramático das mesmas fronteiras (usuário↔aprovação,
   modelo↔tool-call, processo↔FS, processo↔provedor, processo↔store,
   3os↔processo) já presentes na análise de gatilhos de §3. Nenhuma consequência
   deste ADR muda.
4. **Consistência independente como evidência adicional (não citada em nenhum
   dos dois documentos individualmente, porque cada subagente rodou sem ver o
   outro):** os três agentes do Gate 3/4 — security-engineer, software-architect
   e solutions-architect — convergiram, cada um por caminho de evidência
   próprio, na mesma conclusão central ("não construir sobre `AgentHarness` v2;
   `pi.on('tool_call')` é o único primitivo de enforcement real; nenhuma
   capacidade do MVP é fork-worthy"). Convergência sem coordenação prévia é um
   sinal de robustez da decisão, não uma prova formal — registrado como tal.

**Efeito líquido:** nenhuma mudança à Decisão (§2) ou aos Riscos (§4.2) deste
ADR. Um item novo de arquitetura fica **aberto e explícito** para a Fase 2
(ponto 1 acima), evitando que o silêncio deste adendo seja lido como "resolvido
para sempre".

---

## Adendo 0001-B — Resolução das lacunas de layout A1/A2 (`pi-upstream-gaps.md`)

**Status:** anexado após aprovação do checkpoint. Fecha duas decisões de Gate 4
que o solutions-architect deixou explicitamente em aberto para este ADR
(`docs/conductor/pi-upstream-gaps.md`, itens A1/A2 — omissões do PRD §6, não
lacunas do Pi).

**A1 — camada de inteligência/adaptação (PRD §4.12, matriz linha 22).**
**Resolução: dobrar dentro de `packages/memory` (+ `packages/library` para
confiança de RAG), não criar `packages/intelligence` agora.** Motivo: as
capacidades de §4.12 (detecção de padrões entre projetos, contradições entre
gates, knowledge graph, busca híbrida) são análises **sobre** dados que já
vivem em `memory`/`library` — fragmentar num 9º pacote antes de haver sinal de
que a fronteira dói é o inverso do princípio "núcleo pequeno" do próprio PRD
(§3.6) e do critério "quando NÃO separar" já citado em §6.3 deste ADR (Object-
Oriented Thinking §2.12). Reavaliar extração se/quando o módulo crescer a
ponto de o acoplamento com `memory`/`library` custar mais do que economiza —
não antes.

**A2 — pacote emissor dual-harness (Gate 1 §3, H2 não-negociável; matriz linha
27).** **Resolução: `packages/conductor-emit` como fachada TS fina que invoca o
emissor Python existente (`conductor-main`), não uma reescrita.** Motivo, com
base no próprio PRD: a seção 11.1 ("Conteúdo reaproveitável") lista papéis,
skills, gates, regras, comandos, automations, corpus e templates de projeto —
exatamente o que o emissor produz — como **migração direta**; a seção 11.2
("Código que deverá ser reimplementado") lista loop do agente, clientes LLM,
TUI, sessão, tool dispatch, event stream, provider runtime — e **não** lista o
emissor. O PRD já assume implicitamente que o emissor não precisa ser reescrito.
Reescrever em TS agora pagaria custo de migração num componente que o próprio
plano não pede para trocar, e arriscaria exatamente o risco R6 (§4.2): se o
emissor for refeito só depois do runtime nativo, ele vira cidadão de segunda
classe por acidente de sequenciamento, não por decisão. Manter o emissor Python
como está, chamado via `packages/conductor-emit`, preserva o modo emissor **em
paridade** com o runtime nativo Pi desde o primeiro dia — a própria garantia que
o Gate 1 (H2) e a Consequência §4.5 deste ADR exigem. Uma futura port para TS,
se justificada, é decisão de um ADR sucessor, não desta Fase 0.

**Efeito no layout do repositório (refinamento de §2.2 / diagrama do PRD §6):**
nenhum novo pacote de primeira classe além de `conductor-emit`; a lacuna A1
fecha por composição dentro de pacotes já planejados.
