# ADR 0004 — Fase 3 (Papéis, skills e subagentes): delegação in-process governada, Role Registry split-trust, budget único por árvore e evidência derivada-do-runtime

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-05
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 3 — Papéis, skills e subagentes` (`plano_desenvolvimento.md` linhas 1293-1321), branch
  `feature/fase3-papeis-skills-e-subagentes` (de `develop`)
- **Autor (papel):** software-architect, com delegação via Task tool a `security-engineer` (reconciliação
  R13–R21 ↔ decisão de processo — mandato do Gate 3 §7) e `backend-engineer` (contratos TS, mecanismo de
  budget, loader de papéis, formato de evidência, grafo de pacotes)
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças criam um ADR sucessor, não editam este (*The Practice of
  Architecting* §2.8). Este ADR **não edita** os ADRs 0001/0002/0003 — ele os **aplica**: o grafo de pacotes
  (0002 §3.1), a regra de dependência, os protected-paths, o Permission Gate/Engine (PDP/PEP) e o `PolicyTrustStore`
  (0003) são **insumos**, citados por número onde usados.

- **Insumo herdado:**
  - **ADR 0003** (`docs/adr/0003-fase2-security-architecture.md`) — o Permission Gate (PEP,
    `permission-gate.ts`, `pi.on("tool_call")`), o Permission Engine (PDP puro, `permission-engine.ts`,
    `decide()`/`resolvePermissionLevel()`), o Command Classifier, o `EffectivePolicy` (merge assimétrico
    restrições=união/grants=interseção), o `PolicyTrustStore` (trust-on-first-use por content-hash,
    fail-closed), o Audit Trail (`audit-trail.ts`, append-only, fail-closed-write) e a redação-at-rest —
    **tudo reusado, nada reescrito**. A ferramenta `task` **reusa** esse chokepoint; não o contorna.
  - **Gate 3 addendum Fase 3** (`docs/conductor/gate3-addendum-fase3.md`) — 10 ameaças novas (T30–T39), as
    **9 regras vinculantes R13–R21** (§4) que esta arquitetura DEVE respeitar, as **5 lacunas GAP-3A…E** (§5)
    devolvidas ao Gate 2, e o **mandato de reconciliação** (§7): "se o Gate 4 escolher processo separado,
    voltar a este Gate 3 para confirmar R13/R16 por construção + guard-canário".
  - **Gate 2 spec Fase 3** (`docs/conductor/gate2-spec-fase3.md`) — 20 FR (grupos A–I), 11 BR, 8 edge cases,
    8 goals (G0–G6), e as 5 perguntas em aberto (§9) explicitamente roteadas para este gate.
  - **Referência de comportamento (semântica, não código a portar):** `conductor-main/conductor/roles.py`
    (`merge_spawns`/`find_cycle`, `MODEL_ROLES`, `MANDATORY_GATES`), `budget.py` (`Budget` por referência,
    `check()`-antes-de-gastar, `BudgetExhausted`→parada graciosa), `tools/task.py` (ordem de checagens ANTES
    do spawn, `MAX_DEPTH=5`), `agent/host.py:spawn()` (contexto isolado, budget por referência, evidência em
    `details`).

- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, CLAUDE.md Gate 4):** §13 reconcilia ponto a ponto com o
  addendum do Gate 3 e **reporta de volta a ele** as três fronteiras de confiança novas que a decisão
  **in-process** expõe, conforme o protocolo exige.

---

## 1. Contexto

### 1.1 O que a Fase 0–2 já entregou (código lido nesta sessão, não assumido)

O chokepoint de permissão existe e é real: `permission-gate.ts` (`pi.on("tool_call")`) → `decideToolCall`
cobrindo `read`/`write`/`edit`/`bash`/`conductor_note`, com **default-deny terminal** (`no policy declared for
tool "…" — fail closed`), tudo dentro do envelope `evaluatePolicyFailClosed`, com o Audit Trail escrito
**dentro** desse envelope (uma falha de escrita → deny). Os primitivos que esta fase **reusa, não reescreve**:
o `EffectivePolicy` já mesclado/trust-checado, `defaultProtectedPaths`, `evaluateToolPath`/`resolveRealPath`/
`isWithinRoot` (a **autoridade única de path**), o `PolicyTrustStore` (TOFU por content-hash), a redação-at-rest.

O que o Pi já oferece nativamente e que esta fase **compõe, não reinventa** (achado confirmado no Gate 2 e
verificado no código nesta sessão):
- **Progressive disclosure de skills** — `coding-agent/src/core/skills.ts:formatSkillsForPrompt` injeta só
  nome+descrição+`<location>` num bloco `<available_skills>` e instrui "use o `read` para carregar"; o corpo
  só entra sob demanda. G3/FR-5/FR-6 já são satisfeitos por esse mecanismo.
- **Carregamento de papel por frontmatter** — `examples/extensions/subagent/agents.ts:parseFrontmatter` lê
  `name`/`description`/`tools`/`model` + corpo como `systemPrompt`, de dirs `user`/`project`.
- **Fábrica de sessão in-process** — `coding-agent/src/core/sdk.ts:169 createAgentSession(options)`: cria uma
  sessão **no mesmo processo Node**, aceitando `resourceLoader` injetável (as extensões vêm de
  `resourceLoader.getExtensions()`), `customTools`, allowlist `tools`, `sessionManager`, `model` resolvido e
  `modelRuntime` compartilhável. **Esta é a peça-chave da decisão central** (§2).

### 1.2 O fato dominante herdado — e a torção da Fase 3

O fato dominante (Fase 0–2, ADR 0001 R2 / 0003 §1.2): **um único processo de SO, sem sandbox**, com o
privilégio do usuário; o único primitivo de enforcement é `pi.on("tool_call")`. Toda garantia é **política
dentro de um processo confiado**, não isolamento de kernel.

A torção que a Fase 3 abre (Gate 3 §0, o achado que molda tudo): **o limite de processo de um subagente NÃO é
um limite de segurança.** Um segundo processo `pi` roda com o **mesmo usuário, o mesmo disco, a mesma
confiança**. A separação de processo compra **uma** coisa — isolamento do **contexto de conversa** (economia de
janela) — e **não** compra isolamento de **autoridade**, de **sistema de arquivos**, nem de **política**. O
exemplo oficial do Pi (`examples/extensions/subagent/index.ts:335`) lança um `pi` **separado** com `--tools`
mas **nenhuma** referência à Permission Gate da Fase 2 — o buraco T30: `bash`/`write` do filho contornam TODA a
Fase 2 dentro da delegação. A consequência estrutural é a espinha deste gate: **todo mecanismo da Fase 2 tem
que ser re-estabelecido no filho** — não é automático.

### 1.3 Atributos de qualidade priorizados para esta decisão

Herdados da mesma ordem de ADR 0003 §1.3, porque a Fase 3 abre um **vetor de execução** (a ferramenta `task`)
e a tensão central abaixo é resolvida a favor do item mais alto. *Grounding:* **Software Architecture and
Quality Attributes §3.9** ("choose tactics from prioritized quality-attribute scenarios, not habit; make
sensitivity and trade-off points explicit; evaluate early and cheaply" — top **0.691**); **Architecture Styles
and Trade-offs §3.5** ("rank the few [attributes] that dominate; don't maximize all" — top 0.689).

1. **Fail-closed / não-regressão de segurança** — nenhuma garantia da Fase 0–2 pode enfraquecer dentro de uma
   delegação; toda incerteza nega (*Security Engineering Principles §2.9*).
2. **Não-over-claim (honestidade da garantia)** — a arquitetura não pode afirmar isolamento que o modelo
   sem-sandbox não entrega. Uma garantia falsa é pior que uma garantia menor declarada.
3. **Testabilidade / regra de dependência** — as decisões (validação de grafo, `decide()`, budget) têm que ser
   unit-testáveis sem `ctx`/UI/disco (*Architecture Boundaries §3.4*, "I/O nas bordas, policy no meio").
4. **Baixo ônus-de-prova operacional** — a garantia de segurança não pode depender de uma **fiação
   esquecível** que precise ser re-provada a cada upgrade do Pi (o padrão T29/R12).
5. **Proporcionalidade de packaging** — não criar pacote por reflexo (ADR 0002 §2 item 3).

---

## 2. Decisão central — subagente **in-process** via `createAgentSession`, com conversa isolada e a **mesma** pilha de governança da Fase 2 fiada por referência

**Decisão:** a ferramenta `task` cria o subagente **no mesmo processo Node** do pai, via a fábrica pública do
Pi `createAgentSession` (`sdk.ts:169`), com: (a) uma sessão **nova e isolada** (novo `SessionManager`
disco-backed — **não** herda as mensagens do pai, satisfazendo BR-5); (b) a allowlist `tools` = as ferramentas
do papel-alvo (FR-20/R17a); (c) o `resourceLoader` do filho construído com a **mesma** extensão
`createPermissionGateExtension(...)` do pai, fiada por referência ao **mesmo** `workspaceRoot`, ao **mesmo**
objeto `EffectivePolicy`, à **mesma** instância de `AuditTrailWriter`, aos **mesmos** protected-paths e ao
**mesmo** estado `--yes`; (d) o **mesmo** objeto `SharedBudget` por referência (§5); (e) o `model` resolvido a
partir do `modelRole` do papel.

Em uma frase: *o subagente é uma sessão-filha no mesmo processo, com conversa nova mas com a Permission Gate,
o Audit Trail, os protected-paths e o budget do pai re-estabelecidos por referência a partir de um único
ponto de construção.*

### 2.1 O trade-off explícito (in-process vs. processo separado)

*Grounding:* **Architecture Styles and Trade-offs §3.1** ("a primeira lei da arquitetura é que **tudo é
trade-off**; não há estilo 'melhor', só o mais adequado a *este* contexto" — top **0.692**); **Distributed
Architecture Decisions §1.1** ("a mesma decisão que ajuda um atributo prejudica outro" — top 0.669).

| Eixo | **In-process** (escolhido) | **Processo separado** (o molde do exemplo do Pi) |
|---|---|---|
| Isolamento de **segurança** | Nenhum (sem sandbox) | Nenhum (sem sandbox) — **idêntico**; o limite de processo não é de segurança (Gate 3 §0) |
| Isolamento de **conversa** (BR-5) | Sim — `SessionManager` novo/vazio | Sim — `--no-session` |
| Isolamento de **recurso** (OOM/CPU do filho não derruba o pai) | **Não** — pai+filhos numa VM | **Sim** — vantagem real, mas de baixa prioridade num CLI local single-user; já contida por budget+depth+step cap |
| **R13** (gate do filho) | **Fiada por referência de um ponto** — object reference compile-checável | **Serialização** de `workspaceRoot`/policy/audit/`--yes` via CLI/IPC + re-load da extensão no filho — **fiação esquecível** que falha-aberto se esquecida (T30) |
| **R16** (budget único) | **Um objeto por referência**; `check`-antes-de-gastar síncrono | Sem contador em memória compartilhado → agregação pós-hoc (`spent_so_far`) com **janela de corrida** (T33b) |
| **R14** (evidência) | Runtime observa direto (audit writer compartilhado, contador de budget, resultado de git) | Evidência atravessa canal stdout/IPC — **forjável** (T34) |
| Ônus-de-prova (atributo #4) | **Baixo** — "prove que um construtor passa as referências certas": local, unit-testável | **Alto** — "prove que o controle foi re-estabelecido através da fronteira **e** sobrevive a cada mudança do Pi": guard-canário bloqueante re-executado a cada upgrade |
| Composição-antes-de-fork (plano §3.2) | **Satisfeito** — `createAgentSession` é a SDK pública do Pi para exatamente isto | Satisfeito, mas herda um exemplo cru a endurecer |

**Por que in-process é o *menos errado* para este contexto:** a única coisa que o processo separado compra a
mais — isolamento de **recurso** — é (i) de baixa prioridade neste contexto (um CLI local single-user, não um
servidor multi-tenant onde noisy-neighbor importaria) e (ii) já limitada pelos backstops que existem de todo
jeito (budget único, depth cap, step cap do loop). Em troca, o processo separado **piora os três atributos mais
altos**: torna R13/R16/R14 dependentes de **fiação esquecível** que **falha-aberto** se esquecida (atributo #4)
e obriga um guard-canário bloqueante em cada upgrade (o padrão T29). O in-process faz R13/R16/R14 valerem por
**referência de objeto** (estaticamente visível), não por contrato de serialização. Resolve-se a favor do
atributo #1 (fail-closed) e do #4 (baixo ônus-de-prova). *(Nota honesta de cobertura: a biblioteca **não tem
capítulo** sobre isolamento subprocesso-vs-in-process para agentes de IA — consulta desta sessão top 0.591,
retornou material genérico de boundaries. A decisão é fundamentada nos princípios acima + no fato dominante do
Gate 3 + no comportamento de referência do `conductor-main` (spawn in-process, `host.py`), **não** numa citação
que ranqueie os dois modelos — declarado, não forçado.)*

### 2.2 Precondição vinculante — a ferramenta `task` é o **único** construtor de uma sessão-filha governada

"R13 vale por construção" **é falso** se qualquer outro call-site puder alcançar `createAgentSession` para uma
filha sem a fiação da gate. Portanto: **`task.ts` é o único ponto de construção de um subagente governado** —
mesma disciplina "sole sink" que a Fase 2 usou (o funil único de `transcript.ts`, ADR 0003 §6.2). Um segundo
construtor sem a fiação re-abre T30. *Grounding:* **Secure and Reliable Systems Design §3.13** ("expose narrow
purpose-built APIs instead of ambient root" — um único construtor estreito, não N caminhos ambientes).

### 2.3 `task` é uma ferramenta Exec avaliada pela Permission Gate existente (fecha G0/FR-9)

Duas correções verificadas no código (backend-engineer), necessárias para FR-9 não ser ilusório:
1. **`permission-engine.ts` não tem entrada `task`** → cairia no default-deny `"security"` (`resolvePermissionLevel`),
   tornando a tool **inutilizável**. Adicionar `task: "exec"` ao mapa de níveis, para que `task` receba nível
   Exec e seja auditada corretamente.
2. **`decideToolCall` precisa de um branch `task`** (paralelo a `write`/`edit`/`conductor_note`): valida os
   params, então `confirmOrDeny` com uma mensagem que **superfície o papel-alvo e a autoridade que ele
   alcança** (tools + o `canSpawn` dele) — **R17a**: a aprovação de `task` é a aprovação de tudo que ele pode
   rodar, então a aprovação tem que mostrar isso, senão é aprovação-teatro. As chamadas de ferramenta **dentro**
   do filho (o `bash`/`write` que ele mesmo faz) passam pela **gate re-fiada do filho** (R13) — cada uma
   classificada/aprovada/auditada, sem atalho por estar "dentro" de uma delegação.

---

## 3. Role Registry — formato, carregamento e split-trust (R15, GAP-3C, fecha FR-1/FR-2/BR-1/BR-2)

### 3.1 Formato — **manter Markdown+frontmatter**, estender, não introduzir JSON/YAML

**Decisão:** `ConductorRole` estende estruturalmente o `AgentConfig` já lido pelo Pi; o loader continua
`parseFrontmatter` + corpo-como-`systemPrompt`.

Justificativa (em ordem de peso): (i) **um parser já existe e é exercido pelo próprio Pi**
(`agents.ts:parseFrontmatter`) — composição-antes-de-fork (plano §3.2); (ii) **os 37 templates já estão nesse
formato** (`conductor-main/templates/agents/*.md`) — migrar para JSON/YAML seria reescrita lossy de todos, para
um campo (`systemPrompt`) que é **prosa**, exatamente o que Markdown serve; um block-scalar YAML de persona é
pior de autorar e revisar. *Grounding honesto:* a consulta direta "Markdown+frontmatter vs JSON/YAML para
config autorada por humano e lida por máquina" retornou só material genérico de clareza (*Writing Maintainable
Code §1.1/§1.9*, top 0.573) — fraco; o argumento load-bearing é o fato de compatibilidade com o Pi, não um
livro.

Campos de `ConductorRole` (plano §4.4): núcleo compatível com `AgentConfig` (`name`, `description`,
`systemPrompt`, `model?`) **mais** `tools: string[]` (**obrigatório**, nunca "undefined = tudo" — FR-20 exige
um teto sempre), `modelRole` (`strategic`/`standard`/`lightweight`, indirection resolvida uma vez pelo
operador — nunca modelo hard-coded), `skills: string[]`, `canSpawn: string[]` (`[]` = folha, não chama `task`),
`gates: number[]` (declarativo — a máquina de gates é Fase 4, non-goal), `approvalPolicy?` (só **teto**, nunca
liga auto-aprovação por si), e **proveniência** (`source: "builtin"|"user"|"project"`, `contentHash` = sha256
dos bytes crus — o mesmo primitivo do `policy-loader.ts`, `filePath`, `area?`). Interface completa no Apêndice.

### 3.2 Split-trust — `RoleTrustStore` paralelo ao `PolicyTrustStore` (R15, T37)

Uma definição de papel vinda de um repo clonado é **atacante-alcançável** (é o T18 por outra porta: `tools`,
`canSpawn`, `approvalPolicy`, `persona` são autoridade que um arquivo de repo declara). A disciplina split-trust
de `policy.json` (ADR 0003 §5.2, R3/R4) aplica-se **idêntica**:

- **Restrições** (papel de projeto que **estreita** `tools`/`canSpawn`, que **sobe** um tier, que **aperta**
  `approvalPolicy`): aplicam **incondicionais e unidas** — remover autoridade nunca é ameaça.
- **Grants** (papel de projeto que **amplia** `tools`/`canSpawn` além do built-in, que **afrouxa**
  `approvalPolicy`, que **sombreia a persona** de um built-in de mesmo nome — mesmo um diff de 1 caractere, pois
  a persona envenenada **é** o ataque): exigem **trust-on-first-use** por `contentHash` + pin informado (o
  usuário vê os grants concretos — o `confirmProjectAgents` do exemplo do Pi é o embrião) + **tetos rígidos**
  (nunca ganha tool que o usuário não sancionou; nunca desabilita a gate via `approvalPolicy` — a gate é o
  chokepoint do processo, G0/BR-7; nunca introduz ciclo, R17b). Um papel de projeto **sem** contraparte built-in
  e sem trust cai para a postura mais restritiva (`tools: []`, `canSpawn: []`) até um humano confiar.

`RoleTrustStore` **reusa o contrato exato** do `PolicyTrustStore` (fail-closed, nunca lança, nunca default-true).
*Grounding:* **Secure and Reliable Systems Design §3.12** ("the reachable authority has never been enumerated"
— `tools`/`canSpawn` de um arquivo de repo **é** autoridade alcançável não-enumerada), **§3.13** (multi-party
authorization = o TOFU é a segunda parte); **Penetration Testing §14.5/§14.9** (content-hash pin/lockfile = o
análogo de TOFU). **Cobertura TOFU dedicada ausente** — declarado, herdado de T28.

### 3.3 Fail-closed em runtime + carregamento não-parcial (R21, BR-1, FR-2)

Papel que referencia skill/tool inexistente → **falha ao carregar** nomeando o que falta, nunca carrega parcial
(R21/BR-1). Papel-alvo inexistente numa chamada `task` → recusa nomeando (com sugestão por proximidade, FR-2/
FR-14). *Grounding:* **Security Engineering Principles §2.9/§2.2** (erro/incerteza nega; secure-by-default) —
R10/T27 aplicado ao load de papel.

---

## 4. Delegation Graph Validator — acíclico no load, autorização por-uso (R17b, GAP fechado, spec §9 #4)

**Decisão (responde spec §9 #4 — "onde vive a checagem"): ambos, para propriedades distintas e não-sobrepostas.**

- **Ciclo + alvo-desconhecido = só no load**, uma vez, quando o Role Registry é construído sobre o grafo
  **merged** (built-in ∪ adições de projeto). São propriedades **estáticas** do grafo — re-rodar DFS a cada
  `task` é desperdício. Falha na validação → **o registro não carrega** (estende BR-1 de um papel para o grafo
  inteiro), **fail-closed para o built-in** (um projeto nunca amplia para um ciclo — R15). Porta a semântica de
  `merge_spawns` (**união nunca override**, dedup first-seen, exclui nó `advisor`, dropa alvo desconhecido) —
  **exceto** que FR-12 (já checkpointado no Gate 2) torna um alvo desconhecido um **erro nomeado**, não um drop
  silencioso; divergência deliberada da referência Python, e FR-12 é o contrato autoritativo.
- **`canSpawn`-autorizado + depth-cap = necessariamente por-chamada**, porque dependem de dado que não existe no
  load: *qual papel roda agora* e *quão fundo a cadeia viva já está*. São lookups O(1)/O(k) baratos contra o
  grafo **já validado** — nunca uma busca de ciclo nova.

*Grounding:* a biblioteca **não cobre detecção de ciclo em grafo de autorização** (declarado no Gate 2 §8 e
Gate 3 §8; consulta desta sessão top ≤0.545, genérica). A **divisão de trabalho** (validar uma vez na
composição, decidir barato por-chamada contra o valor validado) é o **precedente já construído neste código**:
`mergePolicies` valida no load, `decide()` decide barato por-chamada (ADR 0003 §2) — reuso da mesma divisão,
não invenção. O enquadramento de DoS/exaustão de ciclo+fan-out é **Security Engineering Principles §1.2**
(defense in depth: depth cap **e** budget, camadas independentes). Fundamentado no invariante #3 do plano +
`find_cycle` (DFS puro, já testado no `conductor-main`), **não** forçado numa citação.

---

## 5. Budget único por árvore — mecanismo in-process e fail-closed (R16a/R16b, T33, spec §9 #2/#6)

### 5.1 Ponto de enforcement — **wrap de `ModelRuntime.streamSimple` via `Proxy`**, não `before_provider_request`

**Correção crítica verificada no código (backend-engineer):** o hook de extensão `before_provider_request`
(`runner.ts:1016-1048`) envolve cada handler em `try/catch` e roteia um throw para logging, **continuando com o
payload inalterado** — uma guarda de budget que lança ali é **silenciosamente derrotada**. O seam real de
enforcement é `CreateAgentSessionOptions.modelRuntime` (`sdk.ts:44,176`): envolver `ModelRuntime.streamSimple`
num `Proxy` que lança um erro **genuíno (não-engolido) ANTES** de delegar. O throw propaga pela cadeia `await`
do próprio `streamFn` do `Agent` — o try/catch do `task` em torno do run do filho o converte na **parada
graciosa** (`Result.error`, FR-17), nunca um crash do pai. Um `Proxy` (não subclasse) porque o construtor de
`ModelRuntime` faz I/O real que um decorator não deve repetir.

### 5.2 `SharedBudget` — um objeto por referência, `check`-antes-de-gastar, fail-closed (R16a/R16b)

Interface `SharedBudget` com `reserve(estimate)` (**check-E-reserve numa única chamada síncrona**, devolve
`null` — nunca lança — quando excederia o restante **OU** o estado é ilegível: R16a, "desconhecido = nega"),
`settle(reservation, actual)` (reconcilia estimativa com uso real após a chamada), `remaining()`, `limit`.
Construído **uma vez** no composition root da sessão top-level e passado **por referência** por toda a recursão
de delegação (espelha `host.py:1517-1521` `budget=self.budget`). É **parâmetro obrigatório do construtor** da
`task` — **não há caminho de código** onde `task.ts` construa um `SharedBudget` próprio → **R16b (nenhum filho
recebe cota própria) por construção**, "gastar em dobro" (`budget.py`) vira impossibilidade de tipo.

### 5.3 Concorrência — sem lock, **por construção**, não por disciplina (T33b, edge §7.6)

A semântica **single-threaded run-to-completion** do JS garante que um **corpo de função síncrono** não pode ser
interleaved por outra task async concorrente; dois `reserve()` de dois subagentes (o Pi roda até 4 em paralelo)
executam cada um seu read-then-write completo do contador antes de ceder. Isso fecha T33b **por construção**
desde que **duas condições** (codificadas no **contrato**, não deixadas à disciplina do chamador): (i)
`reserve`/`settle` têm **zero `await`/Promise dentro do corpo**; (ii) check e reserve são **uma chamada**, nunca
`if (remaining() > x) reserve()` como duas chamadas com um `await` entre elas (a forma TOCTOU que T33b alerta) —
a API **deliberadamente não expõe** um `check()` avulso. Um único `reserve` em voo pode legitimamente
ultrapassar o teto ligeiramente (uma requisição já reservada quando o teto foi atingido completa) — **não é bug
a corrigir**, é a tolerância que a spec §7.6 aceita **verbatim** ("não excede o teto por mais do que uma unidade
de gasto em voo"). **Ganho da decisão in-process registrado:** isto colapsa "corrida entre processos de SO" em
atomicidade de event-loop — sem IPC, file lock ou semáforo, que o molde de processo separado exigiria para a
mesma garantia. *Grounding honesto:* a biblioteca **não fala** de contabilidade de token/custo nem de
atomicidade de event-loop (semântica de runtime, não padrão de arquitetura). *Reactive Systems §3.12* ("quando
**não** ir reativo — o event-loop já detém a concorrência") apoia **não** buscar uma lib de async-mutex aqui,
mas é analogia frouxa, não match. Fundamentado no invariante #14 do plano + comportamento de `spent_so_far`.

**Residual vinculante declarado:** a garantia vale **só enquanto** `reserve`/`settle` forem síncronos — um
refactor futuro que adicione um `await` dentro re-abre a corrida. Vira uma **restrição de design + teste** para
o Gate 5/6.

---

## 6. Contrato de evidência — derivada-do-runtime, não-forjável (R14, GAP-3B, T34, fecha G6/FR-18/FR-19)

**Decisão:** `details: DelegationEvidence` carrega **o que o runtime observou**, nunca a prosa do modelo-filho
(que vai **só** em `content`). Fontes concretas, cada uma o que o filho **não pode forjar**:

- **`transcript: {sessionId, filePath}`** — **correção verificada (backend-engineer):** `SessionManager.inMemory()`
  (sugerido para "conversa isolada") **derrotaria** R14 — não deixa transcrito durável. Usar um `SessionManager`
  **novo e disco-backed** (sessão nova/vazia = isolamento; arquivo real = evidência). O revisor abre e confere
  independente da prosa do filho.
- **`filesTouched?: string[]`** — **correção de precisão (security-engineer):** in-process, o filho tem seu
  **próprio** event bus/handler; o pai **não observa** as tool calls do filho diretamente. A lista vem da
  **instância compartilhada de `AuditTrailWriter`** (fiada por referência, R13) na qual a **gate re-fiada do
  filho** grava seus `write`/`edit` — é uma **leitura do audit trail** (filtrada pela sessão/toolCallIds do
  filho), **não** "o pai observando o bus do filho", **nem** texto parseado de `content`. Declaração livre "corrigi
  o bug" sem arquivos derivados **não satisfaz** FR-19 quando a tarefa era alterar arquivos.
- **`tokenCost: BudgetUsage`** — do `SharedBudget.settle()` (uso real), nunca do auto-relato do filho.
- **`merge`** — em modo `isolated`, "aplica limpo" é o **exit code de `git apply --check`**, nunca auto-relato;
  `autoApplied` é tipado como o literal **`false`** (R19: esta tool **nunca** o seta true; conflito ≠ segurança).

*Grounding:* **Secure Code Review §2.12** ("a completed trace is evidence about that question and about nothing
else … not a coverage claim" — a evidência é o **observado**, não o **declarado**), **§1.2** (mindset
adversarial: a assumção a violar é "o filho fala a verdade sobre si"). **Cobertura dedicada a anti-forja de
evidência em delegação ausente** — ancorado por trace≠claim + o DoD machine-checkable do Gate 2 (*Spec-Driven
§11.4*), **não forçado**.

---

## 7. Skill loader — containment de path e descrição não-confiável (R20, GAP-3E, T38)

Progressive disclosure já é nativa do Pi (§1.1). A Fase 3 acrescenta **containment**, reusando a **autoridade
única de path** (`resolveRealPath`/`isWithinRoot`, `workspace-policy.ts`) — **não** uma segunda implementação
(uma segunda canonicalização seria a exata classe de bug que a Fase 0 fechou): `filterSkillsWithinRoots(skills,
skillsRoots)` canonicaliza cada `<location>` e exige que resolva dentro de um skills-root conhecido; um location
que escapa → skill **excluída com diagnóstico visível** em `skills list` (estende BR-2 de "metadado válido" para
"path contido"). A **descrição** de uma skill de fonte `project`/repo — que está **sempre no system prompt** — é
**conteúdo não-confiável** (pior superfície que o corpo, que só entra sob demanda): mesma disciplina TOFU de
R15 no sombreamento de uma skill built-in, e delimitada como **dado, não instrução**. *Grounding:* **Secure Code
Review Part II** ("bugs concentrate at trust boundaries"); **Penetration Testing §14.5/§14.9** (conter, não
confiar em location cru). Cross-ref T5 (limite estrutural do prompt injection — contém e delimita, não "entende
e libera").

---

## 8. Reconciliação R13–R21 (o mandato do Gate 3 §7, delegado ao security-engineer)

Verdicto por regra sob a decisão **in-process**: (a) vale por construção · (b) vale, exige fiação explícita na
`task` (nomeada) · (c) mecanismo net-new independente do modelo de processo.

| Regra | Verdicto | Como fica satisfeita |
|---|---|---|
| **R13** (gate do filho ≡, mesmo estado; senão não roda) | **(b)** | Filho tem event bus próprio → **não** é o mesmo hook; vale porque a `task` constrói o handler do filho fiado às **mesmas** referências (`EffectivePolicy`/`AuditTrailWriter`/`workspaceRoot`/protected-paths/`--yes`) de **um** ponto (§2.2). Fail-closed se qualquer referência ausente. **Canário retido** (abaixo). |
| **R14** (evidência derivada-do-runtime) | **(b)** | Material-fonte disponível por construção (audit writer compartilhado, contador de budget, resultado de git); a `task` **deve** popular `details` desses, nunca de `getFinalOutput` (§6). |
| **R15** (Role Registry split-trust) | **(c)** | `RoleTrustStore` (§3.2) — independente do modelo de processo; a decisão in-process é **ortogonal**. |
| **R16a** (budget fail-closed) | **(a)/(b)** | O modo de falha "ilegível através da fronteira → allow" **desaparece** in-process (objeto vivo, não arquivo serializado no hot path) — (a); a **direção** `check`-antes + exausto→nega é código do objeto — (b). |
| **R16b** (teto único, não-ultrapassável) | **(a)+(b)** | Teto único / sem cota própria **por construção** (um objeto por referência, param obrigatório do construtor); o bound de concorrência exige `reserve` síncrono único (§5.3) — (b). |
| **R17a** (delegação = grant; aprovação informada) | **(b)** | `tools(alvo)` injetado como allowlist do filho; branch `task` no PEP superfície alvo + autoridade alcançada (§2.3). |
| **R17b** (grafo merged acíclico + depth cap + budget backstop) | **(c)+(a)** | Aciclicidade merged fail-closed pro built-in = net-new (§4) — (c); depth cap = inteiro checado antes do construtor + budget = R16b — (a). |
| **R18** (workspace compartilhado: protected-paths transitivos + redação + residual) | **(a)+residual** | Protected-paths transitivos **grátis** (mesmo `EffectivePolicy` por referência); `read` no workspace não-bloqueável (sem sandbox) → defesa de segredo é redação-at-rest (R12); **sem afirmar isolamento de FS** — residual mais **nítido** in-process, não mais brando. |
| **R19** (merge-back: conflito ≠ segurança) | **(c)** | Independente do processo: sem auto-apply a protected-paths; merge-back por-arquivo via `evaluateToolPath` **ou** diff exposto como evidência revisável (§6, `autoApplied:false`). |
| **R20** (skill contida + descrição untrusted) | **(b)** | Reusa a autoridade de path existente (§7). |
| **R21** (load de papel/skill fail-closed em runtime) | **(b)** | Falha ao **construir** o filho antes de `createAgentSession` numa skill/tool ausente (§3.3). |

**O canário de R13 ainda merece seu lugar? SIM — rebaixado, não removido.** In-process, R13 é "fiada por
construção de **um** construtor", não "o mesmo objeto de hook" — o filho tem bus próprio e só **compartilha
estado por referência**. Esse seam é exatamente por que o canário sobrevive: sua **justificativa muda** — em
processo separado era **necessidade P1-bloqueante** (provar um controle re-estabelecido através de uma fronteira
que um drift de `--tools`/carga-de-extensão poderia silenciosamente omitir); in-process **rebaixa para guard de
regressão barato** cujo trabalho específico é pegar **drift entre o handler próprio do filho e a gate de
estado-compartilhado através de um upgrade do Pi** (ex.: um `createAgentSession` futuro que fie `customTools`/
extensões diferente). A asserção comportável ("uma tool destrutiva **dentro** de um subagente é negada/
classificada idêntico a fora") é a **única** coisa que sobrevive a tal refactor ainda compilando. Mantido,
re-executado a cada bump do Pi, Pi pinado no lockfile. *Grounding:* **Security Engineering Principles §1.2**
(uma afirmação by-construction vira garantia by-observation barato); **Penetration Testing §14.12/§22.12**
(terceiro muda sem seu build rodar; retest guard não é opcional).

**Ônus-de-prova LIGHTER in-process — confirmado (security-engineer):** a prova colapsa de *"prove que o controle
foi re-estabelecido através da fronteira **e** sobrevive a cada mudança upstream"* (um guard-canário
re-executado a cada upgrade, porque o filho é um binário separado cuja carga de extensão pode driftar fora do
nosso controle) para *"prove que um construtor passa as referências certas"* — asserção local, revisável,
unit-testável. É o *"narrow purpose-built API"* de **Secure and Reliable Systems Design §3.13** e minimiza a
superfície security-crítica a re-auditar (**Secure Code Review §3.13**). O canário não some — rebaixa.

---

## 9. Resolução das 5 GAPs (GAP-3A…E, devolvidas pelo Gate 3 §5)

- **GAP-3A** (FR-9/G0 assumia governança automática — T30) → **fechada pela decisão** + §2.1/§2.2/§2.3. In-process,
  "não-fiável" vira condição **local e detectável** (referência nula em um construtor), não omissão silenciosa
  cross-process. **Duas condições:** (1) o fail-closed-if-unwireable tem que ser **codificado** (um bug que passe
  um `EffectivePolicy` vazio ao filho enfraqueceria a gate — não é automático); (2) **precondição vinculante**:
  a `task` é o **único** construtor de sessão-filha governada (§2.2).
- **GAP-3B** (FR-18/19 não exigiam evidência não-forjável — T34) → **fechada e fortalecida** por §6. **Precisão:**
  a lista de arquivos vem da **instância de `AuditTrailWriter` compartilhada** (na qual a gate re-fiada do filho
  grava), **não** "o pai observando o bus do filho"; o transcrito exige `SessionManager` **disco-backed**, não
  `inMemory`.
- **GAP-3C** (Role Registry tratado como confiável — T37) → **fechada por §3.2** (`RoleTrustStore`), **NÃO pela
  decisão in-process** — ortogonal; tem que ser construída de todo jeito. Não deixar "escolhemos in-process"
  implicar que está tratada.
- **GAP-3D** (BR-5 silente sobre workspace compartilhado — T35) → **fechada e fortalecida** por R18 (§8). Protected-
  paths transitivos agora **por construção** (mesmo `EffectivePolicy` por referência); redação-at-rest é a defesa
  de segredo; residual (sem isolamento de FS pai↔filho) **declarado** — in-process remove a **ilusão** de
  isolamento de FS que um processo separado sugere falsamente.
- **GAP-3E** (BR-2 silente sobre containment de path + descrição untrusted — T38) → **fechada por §7**, **NÃO pela
  decisão in-process** — ortogonal; reusa `evaluateToolPath`/`resolveRealPath`.

**Líquido:** a decisão in-process **fecha diretamente GAP-3A**, **fortalece materialmente GAP-3B e GAP-3D**
(dá o material-fonte derivado-do-runtime / os paths transitivos por construção), e é **ortogonal a GAP-3C e
GAP-3E** (mecanismos net-new independentes que ainda devem ser construídos).

---

## 10. SLIs / SLOs por componente (objetivo explícito do Gate 4)

**Cobertura de biblioteca honesta:** o corpus responde ao *framing* de SLO (*Software Architecture and Quality
Attributes §3.9*, "make sensitivity and trade-off points explicit; evaluate early and cheaply") mas **não** tem
números para gate de agente CLI local (mesma lacuna de ADR 0003 §10). Números abaixo são **candidatos
PoC-scale**, a confirmar/afinar por medição no Gate 11 — declarados como candidatos, não fechados por citação.

| Componente | SLI | SLO proposto (candidato) | Nota |
|---|---|---|---|
| **Spawn de subagente** (latência) | wall-clock do `task` (pós-aprovação) ao 1º turno de modelo do filho, excluindo o trabalho do filho | **p95 < 300 ms** | Alcançável **porque in-process**: sem fork de processo, sem cold-start de `pi` (que o processo separado pagaria em segundos). O ganho de latência é uma consequência direta da decisão central. |
| **Detecção de ciclo** | ciclos no grafo merged detectados **no load, antes de qualquer sessão abrir** | **100% — error budget 0** | **Não é "taxa".** É invariante de correção (DFS total, determinístico). Um ciclo que chega ao runtime é defeito, mesma postura "error-budget 0 para write-escapes" (ADR 0003 §10). |
| **Autorização de delegação** (overhead) | latência local das checagens role-exists/`canSpawn`/depth na `task` antes do spawn | **p95 < 10 ms** | Puras, in-memory, contra o grafo já validado; sem I/O de rede, sem chamada de modelo — mesma postura "checa antes de gastar" (`task.py`). |
| **Budget-check por chamada** (overhead) | latência local de `reserve()` por turno de modelo | **p95 < 5 ms** | Leitura síncrona de contador in-memory. + **garantia de não-ultrapassagem**: gasto total ≤ teto + uma requisição em voo (R16b, §5.3). |

*Grounding:* **Software Architecture and Quality Attributes §3.4/§3.9** ("tactics per attribute:
performance = latency; a **sensitivity point** is a decision that strongly affects an attribute; evaluate
early with a utility tree"). Os números de gate de agente local **não** são cobertos (declarado, como a spec e
o ADR 0003 já fizeram).

---

## 11. Consequências

### 11.1 Positivas
- A decisão central (in-process) faz R13/R14/R16 valerem por **referência de objeto** (compile-checável), não
  por contrato de serialização esquecível — o achado T30 fechado por **construção**, não por afirmação.
- T33b (corrida de budget) colapsa em atomicidade de event-loop — **sem** IPC/lock/semáforo, que o processo
  separado exigiria.
- Latência de spawn baixa (sem cold-start de `pi`) — SLO de spawn alcançável.
- Nenhum pacote novo; contratos puros (grafo, budget, evidência) unit-testáveis sem `ctx`/UI/disco.
- Composição-antes-de-fork honrada: `createAgentSession` é a SDK pública do Pi para exatamente isto.

### 11.2 Riscos aceitos (com mitigação)
| # | Risco | Sev. | Mitigação |
|---|---|---|---|
| R1 | **Sem-sandbox / sem isolamento de FS pai↔filho** — filho lê código/specs/task do pai; conteúdo não-secreto É legível | Alto | Herdado (Fase 0/2); redação-at-rest para segredo; residual **declarado**, mais nítido in-process |
| R2 | **Isolamento de recurso perdido** — OOM/CPU de um filho pode afetar o pai (uma VM) | Médio | Backstops: budget único + depth cap + step cap do loop; baixa prioridade num CLI local single-user |
| R3 | **Concorrência do budget vale só enquanto `reserve`/`settle` síncronos** — um `await` futuro re-abre a corrida | Médio | Restrição de design + teste (Gate 5/6); API não expõe `check()` avulso |
| R4 | **Drift do handler próprio do filho através de upgrade do Pi** | Médio | Guard-canário retido (comportável: destrutivo dentro = negado idêntico a fora); Pi pinado no lockfile |
| R5 | **Precondição sole-constructor** — um 2º construtor de filha sem fiação re-abre T30 | Alto | Disciplina "sole sink" (§2.2); revisão + teste que nenhum outro call-site chame `createAgentSession` para filha |
| R6 | **Transcrito de evidência tem que passar pela redação-at-rest** — `inMemory` não redige de graça | Médio | Persistência do transcrito-evidência reusa o sink R12/R18; não escreve cru |
| R7 | **Canal do provedor de modelo continua exfil não-gated** — agora com N principais in-process alcançando-o via o `modelRuntime` compartilhado | Alto | Herdado (Fase 0 T5/T7); declarado; fora de escopo |
| R8 | **Cripto-integridade de audit/evidência/trust-store** | Médio | Fase 4 (herdado ADR 0002 §6 / 0003) |

### 11.3 Negativas / custos assumidos
- Novos arquivos: `ConductorRole`+loader e `RoleTrustStore`+grafo em `@conductor/config`; `SharedBudget`+
  `createBudgetGuardedModelRuntime`, a tool `task` e `filterSkillsWithinRoots` em `@conductor/runtime`;
  `role-resolution.ts` em `@conductor/cli`. **Nenhum pacote novo** (§12). Além disso: `task: "exec"` no mapa de
  níveis + branch `task` no PEP (§2.3).
- O `RoleTrustStore` e a persistência-redigida do transcrito-evidência são fronteiras novas que voltam ao Gate 3
  (§13) — custo de processo.

---

## 12. Alternativas consideradas e rejeitadas

- **(A) Subagente em processo separado** (o molde do exemplo do Pi) — **rejeitada** (§2.1): o único ganho
  (isolamento de recurso) é de baixa prioridade neste contexto e já contido por backstops; em troca piora os três
  atributos mais altos (fail-closed, não-over-claim, ônus-de-prova) tornando R13/R16/R14 fiação esquecível que
  falha-aberto. Admitido como **residual declarado** que o guard-canário cobriria **se** um dia for necessário.
- **(B) `SessionManager.inMemory()` para o filho** — **rejeitada** (§6): satisfaz BR-5 mas **derruba** R14 (sem
  transcrito durável). Isolamento vem de uma sessão nova/vazia disco-backed, não de viver só no heap.
- **(C) Guarda de budget via `before_provider_request`** — **rejeitada** (§5.1): o runner engole o throw; o hook
  é observabilidade, não enforcement. Usa-se `Proxy` sobre `ModelRuntime.streamSimple`.
- **(D) Novo formato JSON/YAML para papéis** — **rejeitada** (§3.1): reescrita lossy dos 37 templates para um
  campo que é prosa; o parser Markdown+frontmatter já é exercido pelo Pi.
- **(E) Async-mutex / file-lock para o budget** — **rejeitada** (§5.3): o event-loop já detém a concorrência
  (*Reactive Systems §3.12*); um `reserve` síncrono único é atômico por construção.
- **(F) Re-validar aciclicidade a cada chamada `task`** — **rejeitada** (§4): ciclo é propriedade estática do
  grafo; validar uma vez no load, decidir barato por-chamada (precedente `mergePolicies`/`decide`).
- **Pacote `packages/policies`/`packages/roles` dedicado** — **rejeitada** (§12 abaixo): sem segundo consumidor
  real; reintroduziria fronteira de import sem troca de implementação.

**Packaging — nenhum pacote novo** (extensão do grafo ADR 0002 §3.1 / 0003 §9; invariante `conductor-config` ⊥
`conductor-runtime` preservado via a interface estrutural `RoleRegistryView`, espelhando `EffectivePolicyInput`):

| Componente | Pacote | Por quê ali |
|---|---|---|
| `ConductorRole` + role-loader (frontmatter) | `@conductor/config` | Mesma carta que `policy-loader.ts`: parsear documento on-disk não-confiável autorado por projeto |
| `RoleTrustStore` | `@conductor/config` | Irmão estrutural de `policy-trust-store.ts` |
| `buildMergedGraph`/`findCycle`/`validateDelegationGraph` | `@conductor/config` | Mesmo trabalho que `mergePolicies`: mesclar fontes não-confiáveis num valor validado, uma vez |
| `SharedBudget` + `createBudgetGuardedModelRuntime` | `@conductor/runtime` | Lógica pura de decisão/guarda, família de `permission-engine.ts` |
| tool `task` | `@conductor/runtime/src/tools/task.ts` | O dir `tools/` já existe (`conductor-note.ts`) |
| `filterSkillsWithinRoots` | `@conductor/runtime` | Reusa `resolveRealPath`/`isWithinRoot` já ali — sem duplicar primitivo security-crítico |
| `role-resolution.ts` (compõe load+trust+validate+containment) | `@conductor/cli/src/commands/chat/` | Espelha `policy-resolution.ts` — o seam que compõe config+runtime sem um depender do outro |

*Grounding da proporcionalidade:* **Enterprise Application Architecture Patterns §2.12** ("when not to add a
layer that only forwards"), **Domain-Driven Design §2.12/§5.12** ("when not to split into bounded
contexts/services"), **Architecture Boundaries §1.12** ("when not to invert — sem policy, a interface é puro
custo") — split quando a preocupação é genuinamente nova, não por reflexo (top 0.577–0.586).

---

## 13. Reconciliação com o Gate 3 addendum Fase 3 (protocolo iterativo) + fronteiras novas reportadas

O mandato (Gate 3 §7): "se o Gate 4 escolher **processo separado**, voltar a este Gate 3 para confirmar R13/R16
por construção + guard-canário". **A escolha foi in-process** — logo R13/R16 valem por construção com **menor**
ônus-de-prova (§8), o guard-canário **rebaixa** de necessidade P1 para guard de regressão. As três **fronteiras
de confiança novas** que a decisão in-process **ela mesma** expõe, a confirmar no Gate 3 antes do Gate 5:

1. **Objeto `SharedBudget` mutável sob concorrência** (loop-back R16b) — in-process **troca** a corrida entre
   processos por uma corrida de dados in-memory; fechada por `reserve` síncrono único (§5.3), mas o Gate 3 deve
   confirmar que a garantia de não-ultrapassagem vale e que o residual (vale só enquanto síncrono) é aceito.
2. **Event bus próprio do filho vs. objetos de estado compartilhados** (loop-back R13) — "handler próprio" ≠ "mesmo
   handler"; o seam que um refactor do `createAgentSession` poderia deslocar ainda compilando — é o que mantém o
   canário vivo.
3. **Transcrito `inMemory` do filho vs. redação-at-rest para evidência R14** (loop-back R14 ∩ R18/R12) — qualquer
   caminho que persista o transcrito-evidência do filho **tem que** passar pelo mesmo sink de redação-at-rest da
   Fase 2, senão o arquivo de evidência vaza o segredo que a session JSONL teria redigido.

*(Reforçado, não novo: o `modelRuntime` compartilhado significa que todo filho alcança o egress do provedor via o
runtime do pai — o canal exfil não-gated da Fase 0 T5/T7, agora com N principais in-process. Residual declarado,
não fronteira nova.)*

**Costuras que o Gate 5/6 DEVE travar (test-first):** (a) o **guard-canário de R13** (destrutivo dentro do
subagente negado/classificado idêntico a fora); (b) o **teste de evidência não-forjável de R14** (o pai detecta
uma lista-de-arquivos declarada que o audit não confirma); (c) o **teste de sole-constructor** (nenhum outro
call-site chama `createAgentSession` para uma filha); (d) o **teste de atomicidade do budget** (N subagentes
paralelos não ultrapassam o teto por mais que um em voo); (e) o **teste de ciclo/depth** (grafo merged com ciclo
rejeitado no load nomeando o caminho; depth cap aplicado antes do spawn).

---

## 14. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4` (backend saudável,
2267 chunks; `--gate 4` escopa a `03_design_and_architecture`). As consultas de *segurança semântica* (R13–R21)
foram esgotadas no Gate 3 addendum e são **herdadas por cross-ref**, não re-rodadas (o security-engineer
confirmou que suas queries `--gate 4` rotearam ao corpus de design e **não** adicionaram grounding de segurança
novo — as citações de segurança abaixo são o conjunto já estabelecido do Gate 3).

1. **Trade-off como primeira lei; ranquear atributos, não maximizar** → **Architecture Styles and Trade-offs
   §3.1/§3.5/§3.12** (top **0.692**) + **Software Architecture and Quality Attributes §3.9** (top 0.691) +
   **Distributed Architecture Decisions §1.1** (0.669). Base do §1.3 e da decisão central §2.
2. **In-process vs. processo separado para agentes** → cobertura **fraca/fora do alvo** (top 0.591, boundaries
   genéricos) — **declarado**. Ancorado nos princípios de trade-off + fato dominante do Gate 3 + comportamento
   de referência do `conductor-main`, não numa citação que ranqueie os dois.
3. **Validação de grafo acíclico no load vs. por-uso** → cobertura **fraca** (top ≤0.545) — **declarado**.
   Ancorado no precedente já construído (`mergePolicies` valida no load, `decide` por-chamada) + `find_cycle`
   (DFS testado) + invariante #3 do plano.
4. **Contabilidade de budget compartilhado sob concorrência** → cobertura **ausente** (top ≤0.545; token/custo
   e atomicidade de event-loop não são padrões de arquitetura) — **declarado**. *Reactive Systems §3.12* ("quando
   não ir reativo — o event-loop já detém a concorrência") como apoio frouxo a não usar async-mutex. Ancorado no
   invariante #14 do plano + `spent_so_far`.
5. **Proporcionalidade de packaging** → **Enterprise Application Architecture Patterns §2.12** + **Domain-Driven
   Design §2.12/§5.12** + **Architecture Boundaries §1.12** (top 0.577–0.586). Base do §12.
6. **SLI/SLO / sensitivity point** → **Software Architecture and Quality Attributes §3.4/§3.9** (top 0.691).
   Base do §10; números de gate de agente local **não** cobertos (declarado).

**Segurança (herdado do Gate 3, cross-ref):** Secure and Reliable Systems Design §3.3/§3.12/§3.13; Security
Engineering Principles §1.2/§2.2/§2.9/§2.12; Penetration Testing §14.5/§14.9/§14.12/§19.10/§19.12/§22.12; Secure
Code Review §1.2/§2.12/§3.13/Part II.

**Nota consolidada (honesta, mesma disciplina do ADR 0002 §11 / 0003 §14):** o corpus cobre **forte**
trade-offs/atributos-de-qualidade/boundaries/proporcionalidade (0.58–0.69) e **fraco/ausente** os eixos
**agente-nativos** (isolamento subprocesso-vs-in-process, ciclo em grafo de autorização, contabilidade de budget
de token, TOFU dedicado, anti-forja de evidência). Reportado por eixo, ancorado em princípios + comportamento de
referência do `conductor-main` + invariantes do plano — **não forçado**.

---

## 15. Follow-ups
- **Gate 3 (§13):** confirmar as três fronteiras novas (budget concorrente, event bus próprio do filho,
  transcrito-evidência redigido) antes do Gate 5.
- **Gate 5 (test-first):** derivar os 5 testes travados em §13 (canário R13, evidência não-forjável R14,
  sole-constructor, atomicidade de budget, ciclo/depth); + unit tests puros sobre `findCycle`/`validateDelegationGraph`/
  `resolveRoleGrants`/`SharedBudget.reserve`.
- **Gate 6:** valores numéricos (`MAX_DEPTH`, teto de budget, timeout de parede se algum — spec §9 #3); mecanismo
  de persistência do `RoleTrustStore`; ponto de persistência-redigida do transcrito-evidência; resolução exata
  `modelRole` → modelo configurado; a sintaxe do `closestMatch` para sugestão de papel.
- **Gate 11:** medir os 4 SLOs (§10) contra um corpus real; afinar.
- **Fase 4:** máquina de 14 gates; cripto-integridade de audit/evidência/trust-store; `ConductorSessionStore`
  completo. **Fase 7:** model routing avançado (o `modelRole` desta fase é a indirection simples).

---

## 16. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. Derivados dos subagentes
> `backend-engineer` (contratos, budget, loader, evidência, packaging) e `security-engineer` (reconciliação
> R13–R21). Correções verificadas no código do Pi estão anotadas.

```typescript
// ---- @conductor/config — Role Registry (§3) ----
export type ModelRole = "strategic" | "standard" | "lightweight";
export type RoleProvenanceSource = "builtin" | "user" | "project";

export interface RoleApprovalPolicy {
  autoApprove?: false;                        // TETO — nunca liga auto-aprovação por si (grant, R15)
  maxRiskTier?: "low" | "medium";             // high/critical sempre confirmam, independente deste campo
}
export interface ConductorRole {
  name: string; description: string; systemPrompt: string; model?: string;
  tools: string[];                            // OBRIGATÓRIO (FR-20): nunca "undefined = tudo"
  modelRole: ModelRole; skills: string[]; canSpawn: string[]; gates: number[];
  approvalPolicy?: RoleApprovalPolicy;
  source: RoleProvenanceSource; contentHash: string; filePath: string; area?: string;
}

// ---- @conductor/config — Delegation Graph Validator (§4) ----
export type DelegationGraph = ReadonlyMap<string, ReadonlyArray<string>>;
export type DelegationGraphError =
  | { kind: "cycle"; path: string[] }                          // FR-10/11 — caminho exato ["A","B","C","A"]
  | { kind: "unknown-target"; from: string; target: string };  // FR-12 — erro nomeado, não drop silencioso
export interface ValidateDelegationGraphResult { ok: boolean; graph: DelegationGraph; errors: DelegationGraphError[]; }
export function buildMergedGraph(                               // UNIÃO nunca override; dedup first-seen; exclui advisor
  builtin: ReadonlyArray<{ id: string; canSpawn: string[] }>,
  projectAdditions: ReadonlyArray<{ id: string; canSpawn: string[] }>): DelegationGraph;
export function findCycle(graph: DelegationGraph): string[] | null;   // DFS puro white/gray/black
export function validateDelegationGraph(                              // roda no LOAD; falha → registro não carrega
  builtin: ReadonlyArray<{ id: string; canSpawn: string[] }>,
  projectAdditions: ReadonlyArray<{ id: string; canSpawn: string[] }>): ValidateDelegationGraphResult;

// ---- @conductor/config — RoleTrustStore (§3.2, paralelo a PolicyTrustStore, R15/T37) ----
export interface RoleTrustEntry { roleId: string; contentHash: string; grantedAt: string; }
export interface RoleTrustStore { isTrusted(roleId: string, contentHash: string): boolean; } // nunca lança, nunca default-true
export function loadRoleTrustStore(filePath: string, options?: { onError?: (e: unknown) => void }): RoleTrustStore;
export function resolveRoleGrants(builtinRole: ConductorRole | undefined,   // restrições unem; grants só com trust
  projectRole: ConductorRole, trustStore: RoleTrustStore): ConductorRole;

// ---- @conductor/runtime — permission-engine.ts (correção §2.3): task é Exec ----
// TOOL_NAME_TO_LEVEL DEVE ganhar: task: "exec"  (senão resolvePermissionLevel → "security" = deny, tool inútil)

// ---- @conductor/runtime — tools/task.ts (§2, §6) ----
export interface TaskToolParams { role: string; prompt: string; isolated?: boolean; }
export interface BudgetUsage { input: number; output: number; total: number; }
export interface DelegationEvidence {                          // R14 — tudo derivado-do-runtime, nunca prosa do filho
  transcript: { sessionId: string; filePath: string };        // SessionManager DISCO-backed (não inMemory! §6)
  role: string; depth: number;
  tokenCost: BudgetUsage;                                      // de SharedBudget.settle(), não auto-relato
  filesTouched?: string[];                                     // da instância COMPARTILHADA de AuditTrailWriter (§6)
  merge?: | { isolated: false }
          | { isolated: true; worktreePath: string; appliesCleanly: boolean; diffPath: string; autoApplied: false };
  budgetRemaining: number;
}
export type TaskToolResult =
  | { content: [{ type: "text"; text: string }]; details: DelegationEvidence }
  | { content: [{ type: "text"; text: string }]; details: DelegationEvidence; isError: true };
// Ordem de checagens ANTES de createAgentSession (task.py:164-176): role-exists → target ∈ canSpawn →
// depth+1 <= MAX_DEPTH → sharedBudget.reserve(estimate). Todas síncronas, sem rede, sem modelo.

// ---- @conductor/runtime — SharedBudget (§5) ----
export interface BudgetReservation { readonly estimatedCost: number; }
export interface SharedBudget {
  reserve(estimatedCost: number): BudgetReservation | null;   // check-E-reserve numa chamada síncrona; null = nega (R16a)
  settle(reservation: BudgetReservation, actual: BudgetUsage): void;
  remaining(): number; readonly limit: number;
}                                                              // param OBRIGATÓRIO do construtor da task → R16b por construção
export class BudgetExhaustedError extends Error {}
export function createBudgetGuardedModelRuntime(base: ModelRuntime, budget: SharedBudget): ModelRuntime;
// Proxy sobre streamSimple (NÃO before_provider_request, que engole o throw — §5.1)

// ---- @conductor/runtime — skill containment (§7, R20/T38) ----
export interface SkillCatalogEntry { name: string; description: string; location: string; }
export interface ContainedSkillCatalogEntry extends SkillCatalogEntry { realPath: string; }
export interface SkillContainmentViolation { name: string; declaredLocation: string; reason: string; }
export function filterSkillsWithinRoots(skills: SkillCatalogEntry[], skillsRoots: string[]):
  { included: ContainedSkillCatalogEntry[]; excluded: SkillContainmentViolation[] };  // <location> via resolveRealPath/isWithinRoot

// ---- @conductor/runtime — RoleRegistryView (interface estrutural; mantém config ⊥ runtime, §12) ----
export interface RoleRegistryView {
  get(roleId: string): ConductorRole | undefined;
  canSpawn(from: string, to: string): boolean;
}
```
