# Gate 2 — Especificação (fonte da verdade): Fase 3 — Papéis, skills e subagentes

**Demanda:** `Fase 3 — Papéis, skills e subagentes` (`plano_desenvolvimento.md` linhas 1293-1321).
**Gates cobertos por este documento:** Gate 1 (descoberta de domínio) + Gate 2 (especificação), ambos
**leves** por decisão do usuário — o domínio (papel, skill, delegação, budget) já está estabelecido pelo
plano e pela Fase 0-2; este documento herda a linguagem ubíqua já cunhada no plano e no código, não a
reinventa.
**Papel responsável:** `business-analyst` (skill `map-requirements`), Gate 2 do fluxo Conductor.
**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/fase3-papeis-skills-e-subagentes`
(de `develop`).

**Princípio orientador (esclarecido com o usuário antes de iniciar — não é decisão desta BA, é herdado):**
esta fase porta o **conteúdo e a governança** do Conductor atual (37 papéis, 44 skills, regras de segurança,
semântica de delegação/budget) para o runtime do pi-conductor — **não** o código Python do `conductor-main`
linha por linha. `plano_desenvolvimento.md` §3.2 ("Composição antes de fork"): usar os pontos de extensão que
o Pi já resolve (extensions/custom tools/event handlers/skills/SDK) antes de reimplementar; fork só quando
houver limitação estrutural real. `conductor-main/conductor/{roles,budget}.py`, `agent/host.py` (`spawn`,
`run_tool`) e `tools/task.py` são **referência de comportamento/semântica** — o que a delegação e o
orçamento precisam garantir — não mandato de portar cada refinamento acumulado lá (ex.: prewalk downgrade
de modelo, `cdt stats`, truncamento de output — ver Non-goals §3).

**Consome (lido integralmente antes de escrever este documento):**
- `plano_desenvolvimento.md` §1 (visão geral), §3.2 (composição antes de fork), §3.6 (progressive
  disclosure), §4.2 (ferramentas nativas + `ToolPolicy`), §4.4 (`ConductorRole`, papéis, requisitos),
  §4.5 (subagentes — modelo de execução + regras), §4.6 (sistema de skills — YAML), §10 (invariantes,
  especialmente 1/2/3/14), linhas 1293-1350 (Fase 3 + fronteira com Fase 4).
- `conductor-main/conductor/roles.py` (registro de 37 papéis, `spawns` DAG, `MANDATORY_GATES`,
  `GATE_MODEL_ROLE`, `merge_spawns`/`find_cycle`).
- `conductor-main/conductor/budget.py` (`Budget` compartilhado por referência, `spent_so_far`,
  `BudgetExhausted`).
- `conductor-main/conductor/agent/host.py` — `spawn()` (linhas 1457-1601: contexto isolado, aprovação
  herdada do pai, budget por referência, evidência em `details`) e `run_tool()` (onde a aprovação
  acontece, antes de qualquer mutação).
- `conductor-main/conductor/tools/task.py` — a ferramenta `task` completa: assinatura, checagem do DAG
  **antes** de gastar budget/chamar modelo, profundidade máxima (`MAX_DEPTH = 5`), mensagens de erro.
- `conductor-main/conductor/templates/agents/{backend-engineer,security-engineer,tech-lead}.md` e
  `templates/skills/{map-requirements,design-service}/SKILL.md` — forma real de frontmatter + corpo.
- Código já existente no pi-conductor: `packages/conductor-runtime/src/{permission-gate,permission-engine,
  resource-loader}.ts`, `docs/adr/0003-fase2-security-architecture.md` (arquitetura de segurança decidida
  na Fase 2 — o Permission Gate/Engine que a ferramenta `task` **reusa**, não contorna).
- Mecanismos que o **Pi já oferece** e que esta fase deve compor, não reinventar (achado desta sessão,
  registrado em §1):
  `packages/coding-agent/src/core/skills.ts` (`loadSkills`/`formatSkillsForPrompt` — progressive disclosure
  de skills já implementada nativamente), `packages/agent/src/harness/skills.ts` (idem, na camada `agent`),
  `packages/coding-agent/examples/extensions/subagent/{index,agents}.ts` (exemplo oficial de ferramenta de
  delegação a subagente, sem grafo de autorização — o vazio exato que esta fase preenche).

---

## 1. O que já existe vs. o que a Fase 3 constrói (evita reinventar)

| Capacidade | Já existe (Pi nativo ou Fase 0-2) | Fase 3 constrói/estende |
|---|---|---|
| Progressive disclosure de skills | **Sim, nativo.** `coding-agent/src/core/skills.ts:formatSkillsForPrompt` injeta só `name`+`description`+`location` num bloco `<available_skills>` e instrui: *"Use the read tool to load a skill's file when the task matches its description"*. O corpo completo só entra na conversa quando o modelo chama `read` no path indicado — nunca é reinjetado no system prompt. | Apontar esse loader para os pacotes canônicos de skill do Conductor (44 skills); decidir (Gate 4) se a instrução "use `read`" é suficiente ou se o tool nomeado `skill` do plano §4.2 é um wrapper fino sobre o mesmo mecanismo. **Este documento não decide isso** — ver §9. |
| Carregamento de papel (persona + tools + model) | **Parcial.** `examples/extensions/subagent/agents.ts:discoverAgents` já lê `.md` com frontmatter `name`/`description`/`tools`/`model` + corpo como `systemPrompt`, de diretórios `user`/`project`. `ConductorResourceLoader` (`resource-loader.ts`) hoje trava `noSkills: true`/`noExtensions: true` com o comentário explícito: *"roles / skills / rules / commands -> Fase 3"*. | Estender esse formato com os campos que `ConductorRole` (plano §4.4) exige e que **não existem** em `AgentConfig`: `modelRole` (indireção `strategic/standard/lightweight` → `@default/@slow/@plan/@smol`, `roles.py:MODEL_ROLES`/`GATE_MODEL_ROLE`), `skills: string[]`, `canSpawn: string[]`, `gates: number[]`, `approvalPolicy?`. Habilitar o carregamento (`noSkills`/`noExtensions` → `false` para os pacotes canônicos do Conductor). |
| Delegação a subagente (mecanismo) | **Parcial.** O exemplo `subagent/index.ts` já resolve o mecanismo inteiro: processo isolado, contexto que não herda a conversa do pai, streaming de progresso, captura de uso (tokens/custo) por subprocesso, truncamento de output (50 KB/tarefa), modos single/parallel/chain. | O que falta é **política**, não mecanismo: (a) autorização — o exemplo deixa qualquer `agent` chamar qualquer outro por nome, sem checagem de grafo; (b) orçamento compartilhado de verdade (o exemplo soma uso por subprocesso, mas não impõe um teto único que pai+filhos dividem); (c) contrato de evidência estruturado (o exemplo devolve só a última mensagem de texto do assistente). |
| Validação de grafo de delegação (aciclicidade) | **Não existe no pi-conductor.** Existe em `conductor-main/roles.py:merge_spawns`/`find_cycle` (DFS, porta pura testável) e é a origem do invariante #3 do plano. | Construir a validação equivalente sobre o registro de papéis do pi-conductor — **não** decidir aqui se é a mesma implementação DFS ou outra; só o comportamento observável (§5, Grupo E). |
| Bloqueio de delegação não autorizada | **Não existe no pi-conductor** (o exemplo de subagente do Pi não tem esse conceito). Existe como referência completa em `conductor-main/tools/task.py:127-191`: checagem do papel de origem, do papel-alvo, do `spawns` allowlist e da profundidade máxima — **tudo antes de `ctx.spawn` ser chamado**, ou seja, sem gastar budget nem chamar modelo algum. | Portar a **semântica**, não o código: mesma ordem de checagens, mesmo "nega antes de gastar", adaptado à ferramenta `task` do pi-conductor. |
| Budget compartilhado entre pai e subagente | **Não existe no pi-conductor** como orçamento único. Existe como referência em `conductor-main/budget.py` (`Budget` é um objeto único passado **por referência** pela árvore de delegação: *"a subagent with its own allowance is a way to spend the budget twice"*) e em `host.py:1517-1521` (`budget=self.budget`, mesmo objeto, não cópia). | Garantir que o gasto de um subagente é contabilizado contra a **mesma** cota do pai — ver §5 Grupo G e BR-4/BR-8. |
| Aprovação de ferramentas destrutivas dentro de um subagente | **Já resolvido em arquitetura pela Fase 2** — o Permission Gate (`permission-gate.ts`, `pi.on("tool_call")`) é o único chokepoint de aprovação do processo inteiro; não há noção de "sessão" que o contorne. `conductor-main/host.py:1509-1512` documenta a mesma regra para o host próprio: *"The approval callback is the parent's: a subagent that could approve its own writes would make `task` the way around the permission model."* | A ferramenta `task` desta fase **precisa** passar pelo mesmo `pi.on("tool_call")` como qualquer outra tool Exec — não criar um segundo caminho de aprovação. Ver G0/BR-7. |
| Evidência obrigatória no retorno de um subagente | **Fraco nos dois lados.** `conductor-main/host.py:1570-1599` devolve `content` (texto livre) + `details: {role, session, depth, tokens}` e, se isolado, `{applied, files, patch}` — mas não impõe um schema, é o campo mais fraco da própria referência. O exemplo do Pi devolve só a última mensagem de texto. | Fase 3 define o **mínimo observável exigível** (§5 Grupo H) — não um verificador automático de qualidade (isso é Gate 8/9, não esta ferramenta). |
| Canal `content`/`details` (dois canais, nunca um só) | **Já é lei do produto.** `pi/CLAUDE.md`-equivalente (regra "Unretrofittable" nº 4 do `conductor-main`, herdada por este projeto): *"Two-channel results everywhere (content/details/isError/useless)... content must stand alone."* Também já em uso em `permission-gate.ts` (`ToolDecisionOutcome`) e no exemplo de subagente (`AgentToolResult<SubagentDetails>`). | A ferramenta `task` **deve** seguir o mesmo contrato: `content` autossuficiente (a resposta do subagente), `details` carrega a evidência estruturada. Não é uma decisão nova desta fase, é uma regra já vigente aplicada a uma ferramenta nova. |

---

## 2. Goals

1. **G0 — Nenhum caminho de aprovação paralelo.** A ferramenta `task` é uma ferramenta de risco Exec como
   qualquer outra (o filho herda as mesmas ferramentas do papel, logo pode alcançar o mesmo raio de ação) e
   passa pelo **mesmo** `pi.on("tool_call")`/Permission Gate/Engine já construído na Fase 2 — nenhuma
   aprovação "especial" para delegação.
2. **G1 — Carregamento de papel por nome.** `conductor chat --role <papel>` carrega a persona, as skills,
   as ferramentas e o `modelRole` daquele papel; um papel inexistente é um erro claro, nunca uma sessão
   genérica silenciosa.
3. **G2 — Listagem observável.** `conductor roles list` e `conductor skills list` tornam o catálogo
   completo inspecionável sem abrir uma sessão.
4. **G3 — Progressive disclosure mensurável.** Uma sessão aberta com um papel carrega só o catálogo
   resumido de skills (nome+descrição+local); o corpo de uma skill só entra na conversa quando o modelo a
   invoca — nunca antes, nunca "por via das dúvidas".
5. **G4 — Delegação como grafo governado.** A relação "papel A pode delegar a papel B" é um grafo
   acíclico, validado, e a violação (ciclo, alvo não autorizado, profundidade excessiva) é recusada de
   forma determinística e sem custo.
6. **G5 — Orçamento único por árvore de delegação.** Um subagente gasta da mesma cota que o pai; a árvore
   inteira de delegação nunca gasta mais do que o limite configurado permite.
7. **G6 — Evidência, não promessa.** O retorno de um subagente carrega, no canal estruturado (`details`),
   algo que o pai (ou um revisor humano/outro papel) pode conferir independentemente do texto livre que o
   subagente escreveu sobre si mesmo.
8. **Critério de saída (herdado literalmente do plano, linhas 1318-1321):** um agente principal deve
   delegar uma tarefa a um papel autorizado, receber um resultado com evidências, e ter uma delegação não
   permitida impedida — restated de forma testável nas seções 5 e 6 abaixo.

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Máquina de estados dos 14 gates** (transições, aprovação humana por gate, persistência de estado de gate) | O plano nomeia isso explicitamente como Fase 4 (linhas 1324-1350). Esta fase só exige que um papel **declare** `gates: number[]` — a que gates ele serve — não que o runtime saiba transicionar entre eles. | Fase 4 |
| **RAG / backend da Library** (`conductor library search/ingest/update`, citações automáticas) | Nomeado como Fase 5 — "Library e grounding" (plano linha 1351). O grounding **desta especificação** (via `cdt library` do Conductor-CLI enrolado neste repo-pai) é um processo do fluxo de gates, não um recurso do produto pi-conductor sendo especificado aqui. | Fase 5 |
| **MCP client/servidor** (`mcp` tool) | Nomeado como Fase 9 (plano linha 1456). A ferramenta `task` desta fase não depende de MCP. | Fase 9 |
| **Captura automática de diário / Diary** (memória automática por evento) | Nomeado como Fase 6 — "Diary e captura automática" (plano linha 1377). O `journal` tool desta fase (se usado por um papel) grava, não é capturado automaticamente. | Fase 6 |
| **Model routing avançado**: downgrade automático de modelo por heurística ("prewalk downgrade", `conductor-main/host.py:416-422,_prewalk_downgraded`), fallback entre provedores com cooldown (`_drive_fallback`/`_arm_cooldown`), dashboard de custo (`conductor-main/budget.py:usage_report`/`estimate_cost`, `cdt stats`) | São refinamentos acumulados no `conductor-main` **depois** de sua própria Fase equivalente ter fechado — não fazem parte do critério de saída desta fase (delegar, receber evidência, impedir delegação não autorizada). Citados como **referência**, não requisito: um `modelRole` simples que resolve para um modelo configurado já satisfaz G1/G5. Model routing completo é nomeado como Fase 7 — "Model routing e provedores" (plano linha 1404). | Fase 7 (routing); nenhuma fase nomeada para o dashboard de custo — backlog |
| **Sandbox de processo/SO para o subagente** (container, seccomp, isolamento de kernel) | Herdado do residual já aceito e declarado por escrito na Fase 2 (ADR 0003 §1.2/§3.3/§11.2 R1: "sem-sandbox... grau-classificação, não grau-sandbox"). Um subagente roda no mesmo processo/confiança que o pai; esta fase não muda esse modelo de ameaça, só posiciona a delegação dentro dele. | Não nomeado no plano — decisão de arquitetura da Fase 0, não desta fase |
| **Integridade criptográfica do audit trail / schema de evidência formal e persistido** (hash-chain, assinatura, `ConductorSessionStore` completo) | Já adiado explicitamente para a Fase 4 pelo ADR 0002 §6 e reafirmado no ADR 0003 §6.3/§11.2 R3. A evidência que esta fase exige (G6) é um contrato de **retorno da ferramenta** (`details`), não um armazenamento formal e à prova de adulteração. | Fase 4 |
| **Redesenho da superfície de status da TUI** (papel ativo, orçamento restante, subagentes em execução, visualização do grafo de delegação) | Mesmo padrão já registrado no Gate 2 da Fase 2 (§4.16 do plano): depende de dados que só existem a partir desta fase e da Fase 4/8; cresce organicamente, não é um entregável nomeado aqui. | Cresce organicamente Fase 4+ |
| **Verificação automática de qualidade da evidência** ("o resultado do subagente está *certo*?", re-execução por outro papel como mecanismo obrigatório da própria ferramenta `task`) | O plano (§4.5, regra 7: "trabalhos críticos devem ser verificados por outro agente") é uma disciplina de **processo** dos gates (ex.: Gate 8/9 revisando o trabalho de Gate 6), não uma obrigação estrutural que a ferramenta `task` deva impor sozinha a cada chamada. Esta fase garante que a evidência **existe e é inspecionável** (G6); decidir *quem* a inspeciona e *quando* é dos gates que a usam. | Gates 8/9 (processo), não a ferramenta em si |

---

## 4. Glossário (linguagem ubíqua)

Termos já cunhados no plano ou no código (Fase 0-2) são reusados literalmente. Termos novos desta fase são
marcados **[NOVO]**. *Grounding:* **Domain-Driven Design — Complete Professional Guide §1.1** ("a ubiquitous
language is a single, shared vocabulary — used by domain experts, product, and engineers, and reflected
literally in the code"); **§1.12** ("pays for itself wherever the same word means different things... and
the code will be edited by people who were not in the conversation that settled it") — exatamente o caso
aqui: quem implementar a Fase 3 não participou da escrita do plano.

| Termo | Definição | Fonte |
|---|---|---|
| **Papel (Role)** | Uma persona com prompt próprio, um conjunto de skills, uma lista explícita de ferramentas permitidas, uma categoria de modelo (`modelRole`), uma lista do que pode delegar (`canSpawn`) e os gates a que serve (`gates`). Distinto de "agente" no sentido genérico do Pi (`AgentConfig` no exemplo de subagente) — um Papel é um `AgentConfig` **mais** `modelRole`/`skills`/`canSpawn`/`gates`. | `plano_desenvolvimento.md` §4.4 (`ConductorRole`) |
| **Skill** | Um pacote de procedimento carregável sob demanda: quando usar, entradas, pré-condições, procedimento, evidências obrigatórias, critérios de conclusão, o que não fazer, falhas conhecidas, referências. Fisicamente um `SKILL.md` com frontmatter `name`/`description` (+ campos do plano: `version`/`areas`/`gates`/`requires`). | `plano_desenvolvimento.md` §4.6; `coding-agent/src/core/skills.ts` (formato já reconhecido pelo Pi) |
| **Progressive disclosure** | O padrão pelo qual o system prompt de uma sessão carrega só o catálogo resumido (nome+descrição+local) de cada skill disponível ao papel; o corpo completo só é lido quando o modelo decide que a tarefa casa com a descrição. Já implementado nativamente pelo Pi (`formatSkillsForPrompt` + instrução "use `read`"). | `plano_desenvolvimento.md` §3.6; `coding-agent/src/core/skills.ts:335-361` |
| **Subagente** | Uma execução filha, criada pela ferramenta `task`, com contexto isolado (não herda a conversa do pai — só o prompt explícito que o pai escreveu), seu próprio papel/persona/skills, e um retorno que volta ao pai como resultado de ferramenta (não como uma ramificação da conversa do pai). | `plano_desenvolvimento.md` §4.5; `conductor-main/host.py:1457-1601` (`spawn`) |
| **Grafo de delegação** [formaliza um conceito já nomeado no plano] | O grafo dirigido cujos nós são papéis e cuja aresta `A → B` existe sse `B ∈ A.canSpawn`. Deve ser acíclico (invariante #3 do plano). | `plano_desenvolvimento.md` §4.4 ("a relação de delegação deverá formar um grafo acíclico"), §10 item 3 |
| **Budget (orçamento)** | Um teto de gasto (tokens) compartilhado **por referência** por todos os hosts de uma árvore de delegação — pai e todo subagente descontam do mesmo contador; nenhum subagente recebe uma cota própria. | `plano_desenvolvimento.md` §4.4 ("o orçamento de tokens deverá ser compartilhado"), §4.5, §10 item 14; `conductor-main/budget.py` |
| **Evidência** [NOVO — nomeia o que o plano exige sem lhe dar um nome próprio] | O conteúdo do canal estruturado (`details`) que o retorno de um subagente carrega além do texto livre: no mínimo uma referência à própria transcrição/sessão do subagente; quando a tarefa envolveu alterar arquivos, também quais arquivos e (em execução isolada) se as mudanças de fato chegaram à árvore de trabalho do pai. É o que torna "o pai não deve confiar apenas na declaração de sucesso" (§4.5) verificável, não apenas desejável. | `plano_desenvolvimento.md` §4.5; `conductor-main/host.py:1570-1599` |
| **Registro de papéis (Role Registry)** [NOVO] | A fonte única de verdade que enumera todo papel conhecido, seu `canSpawn` e suas skills — o análogo desta fase ao `ROLES: Dict[str, Role]` de `conductor-main/roles.py`. | Nomeado nesta fase |
| **Model Role** (categoria/indireção de modelo) | Um rótulo de custo (`@smol`/`@default`/`@plan`/`@slow` no `conductor-main`) que cada papel carrega (`strategic`/`standard`/`lightweight` no plano §4.4) e que o operador mapeia, uma vez, para um modelo real configurado — nunca um nome de modelo hard-coded no papel. | `plano_desenvolvimento.md` §4.4; `conductor-main/roles.py:MODEL_ROLES`/`GATE_MODEL_ROLE` |
| **Ferramenta `task`** | A ferramenta nativa que delega um trabalho autocontido a outro papel. Ver assinatura em FR-7/FR-8. | `plano_desenvolvimento.md` §4.2, §8 (entregável da Fase 3) |
| **Profundidade de delegação** [NOVO] | Quantos níveis de `task` já foram encadeados até chegar à sessão atual (0 = sessão do usuário). Tem um teto configurável para impedir uma cadeia sem fim. | `conductor-main/tools/task.py:57` (`MAX_DEPTH = 5`, referência de valor, não mandato) |

---

## 5. Requisitos funcionais (FR)

Cada FR tem um critério de aceite Given/When/Then testável. *Grounding para o uso de Given/When/Then*:
**Specification by Example — Complete Professional Guide §2.12/§2.13** — G/W/T "earns its indirection...
[for] behaviour a non-programmer will actually read and dispute, stated in a vocabulary that recurs across
many scenarios, whose outcome is a value someone can name" (top 0.623) — exatamente o caso de "papel A pode
delegar a papel B?": vocabulário que se repete por todo o Grupo F, e o resultado (permitido/negado) é um
valor nomeável.

### Grupo A — Carregamento de papel (G1)

**FR-1 — Um papel conhecido carrega sua persona, skills, ferramentas e model role.**
> Given um papel `backend-engineer` registrado com persona, `skills: ["design-service"]`,
> `tools: [...]` e `modelRole: "standard"`,
> When o usuário roda `conductor chat --role backend-engineer`,
> Then a sessão inicia com o system prompt daquele papel, o catálogo resumido de `design-service`
> disponível (não o corpo — ver Grupo C), apenas as ferramentas listadas em `tools` utilizáveis, e o
> modelo resolvido a partir de `modelRole: "standard"`.

**FR-2 — Um papel inexistente é um erro claro, nunca uma sessão genérica silenciosa.**
> Given nenhum papel chamado `backedn-engineer` (erro de digitação) no registro,
> When o usuário roda `conductor chat --role backedn-engineer`,
> Then o comando falha com uma mensagem que nomeia o papel não encontrado — nunca abre uma sessão sem
> papel nem inventa um papel — e, quando houver um nome próximo no registro (ex.: `backend-engineer`),
> sugere-o. *Referência de comportamento:* `conductor-main/tools/task.py:152-162` já resolve o mesmo
> problema (papel-alvo de uma delegação) com `difflib.get_close_matches`; esta fase aplica a mesma
> disciplina de UX ao carregamento de papel via `--role`, não necessariamente o mesmo algoritmo.

### Grupo B — Listagem (G2)

**FR-3 — `conductor roles list` mostra o catálogo completo, uma linha por papel.**
> Given N papéis registrados,
> When o usuário roda `conductor roles list`,
> Then a saída tem N linhas, cada uma mostrando ao menos: o id do papel, sua área, seu `modelRole`, a(s)
> skill(s) que carrega, e os gates a que serve (`gates`) — o suficiente para responder "que papel eu uso
> para X" sem abrir uma sessão.

**FR-4 — `conductor skills list` mostra o catálogo completo, uma linha por skill.**
> Given M skills registradas,
> When o usuário roda `conductor skills list`,
> Then a saída tem M linhas, cada uma mostrando ao menos: nome, descrição, `version`, e os gates em que
> a skill se aplica (`gates` do YAML, plano §4.6).

### Grupo C — Progressive disclosure (G3)

**FR-5 — O prompt inicial de uma sessão com papel carrega só o catálogo resumido de skills.**
> Given o papel `backend-engineer` com a skill `design-service` (corpo de N linhas),
> When a sessão é aberta e nenhuma ferramenta foi chamada ainda,
> Then o system prompt montado contém, para `design-service`, apenas nome+descrição+localização (o bloco
> `<available_skills>` já produzido por `formatSkillsForPrompt`) — o corpo de `design-service` (as N
> linhas de procedimento) está ausente do prompt. **Testável por inspeção do prompt montado**: buscar uma
> string exclusiva do corpo da skill (ex.: um passo do procedimento) no system prompt monta deve falhar.

**FR-6 — O corpo de uma skill entra na conversa só quando invocada, nunca antes.**
> Given a mesma sessão de FR-5,
> When o modelo decide que a tarefa casa com `design-service` e lê o arquivo indicado em `<location>`,
> Then o corpo da skill aparece **como resultado de uma chamada de ferramenta** (`read`), não como um
> bloco reinjetado no system prompt — e só a partir desse ponto da conversa em diante.

### Grupo D — A ferramenta `task` (G0, G6, entregável nomeado da Fase 3)

**FR-7 — `task` delega um trabalho autocontido a um papel autorizado.**
> Given uma sessão rodando como papel `tech-lead` (que tem `software-engineer` em `canSpawn`),
> When o modelo chama `task` com `{role: "software-engineer", prompt: "<tarefa autocontida>"}`,
> Then um subagente é criado cujo contexto inicial é **apenas** a persona/skills/tools do papel
> `software-engineer` mais o texto de `prompt` — não a conversa do `tech-lead` até aquele ponto — e o
> subagente roda até completar ou até estourar seu backstop (budget/passos), devolvendo um resultado ao
> `tech-lead` como resultado da chamada de `task` (não como uma nova mensagem na conversa do `tech-lead`
> vinda de "lugar nenhum").

**FR-8 — O retorno de `task` segue o contrato de dois canais do produto.**
> Given o subagente de FR-7 concluiu com sucesso,
> When o resultado retorna ao `tech-lead`,
> Then `content` contém a resposta final do subagente, legível sozinha (sem exigir olhar `details` para
> fazer sentido) e `details` contém a evidência estruturada (Grupo H) — nunca misturados no mesmo campo,
> nunca a evidência serializada dentro do texto de `content` como JSON solto.

**FR-9 — `task` é uma ferramenta Exec avaliada pelo Permission Gate existente, sem atalho.**
> Given um papel autorizado a delegar e um Permission Gate já configurado (Fase 2),
> When o modelo chama `task`,
> Then a chamada passa pelo mesmo `pi.on("tool_call")` que qualquer `bash`/`write`/`edit` — nível de
> permissão Exec, sujeita ao mesmo mecanismo de classificação/aprovação — e nenhuma chamada de ferramenta
> **dentro** do subagente (um `write` que ele mesmo faça, por exemplo) pula essa avaliação por estar
> "dentro" de uma delegação.

### Grupo E — Validação do grafo de delegação (G4, invariante #3 do plano)

**FR-10 — Um ciclo de 2 nós é rejeitado, nomeando o ciclo.**
> Given um papel `A` com `canSpawn: ["B"]` e um papel `B` com `canSpawn: ["A"]`,
> When o registro de papéis é validado,
> Then a validação falha com um erro que nomeia o ciclo exato (`A → B → A`) — não um erro genérico de
> "grafo inválido" — e nenhum dos dois papéis fica disponível para delegar até o ciclo ser corrigido.

**FR-11 — Um ciclo de 3+ nós é rejeitado da mesma forma.**
> Given papéis `A → B → C → A` (cada um com o próximo em `canSpawn`),
> When o registro é validado,
> Then a validação falha nomeando o caminho completo do ciclo encontrado.

**FR-12 — Um papel referenciado por `canSpawn` mas inexistente é rejeitado.**
> Given um papel `A` com `canSpawn: ["papel-fantasma"]` e nenhum papel `papel-fantasma` registrado,
> When o registro é validado,
> Then a validação falha nomeando o alvo desconhecido — o grafo nunca contém uma aresta para um nó que
> não existe.

### Grupo F — Bloqueio de delegação não autorizada (G4, invariante do plano §4.4 "o runtime deverá impedir delegações não autorizadas")

**FR-13 — Papel A tenta delegar a um papel B que não está em seu `canSpawn`.**
> Given um papel `business-analyst` cujo `canSpawn` é vazio (ou não inclui `security-engineer`),
> When o modelo, rodando como `business-analyst`, chama `task` com `{role: "security-engineer", ...}`,
> Then a chamada é recusada **antes** de qualquer subagente ser criado, **antes** de qualquer chamada de
> modelo em nome do subagente, e **antes** de qualquer gasto de budget ser contabilizado — a checagem
> acontece inteiramente dentro da própria ferramenta `task`, como uma decisão local e determinística sobre
> dados já disponíveis (o papel de origem, seu `canSpawn`, o papel-alvo), sem I/O de rede nem chamada de
> modelo. O erro nomeia os papéis que `business-analyst` **pode** delegar (ou declara que é uma folha do
> grafo, se `canSpawn` for vazio). *Referência de comportamento, ponto a ponto:*
> `conductor-main/tools/task.py:164-176` implementa exatamente esta ordem — a checagem do DAG acontece
> antes de `ctx.spawn` ser sequer referenciado.

**FR-14 — Papel-alvo desconhecido não é criado ad hoc.**
> Given o modelo chama `task` com `{role: "papel-que-nao-existe", ...}`,
> When a ferramenta processa a chamada,
> Then a chamada é recusada com uma mensagem que deixa claro que aquele papel não existe (não confundir
> com "não autorizado") — o sistema nunca cria um papel improvisado a partir do nome que o modelo chutou.

**FR-15 — Profundidade máxima de delegação é aplicada.**
> Given uma cadeia de delegação já no nível máximo configurado (referência: `conductor-main` usa 5),
> When o subagente naquele nível tenta chamar `task` para delegar mais um nível,
> Then a chamada é recusada com uma mensagem que identifica o limite atingido e instrui a completar o
> trabalho na sessão atual em vez de delegar de novo — **não decide-se aqui qual é o número exato** (é
> parâmetro de configuração a fixar no Gate 4/6); o requisito observável é que **existe** um teto e ele é
> aplicado antes de criar mais um nível.

### Grupo G — Budget compartilhado (G5, invariante #14 do plano)

**FR-16 — O gasto de um subagente é descontado da mesma cota do pai.**
> Given uma sessão pai com um orçamento restante de X tokens e um subagente gastando Y tokens,
> When o subagente conclui e o controle volta ao pai,
> Then o orçamento restante visível ao pai é, no máximo, X − Y (nunca X, como se o gasto do filho não
> tivesse acontecido; nunca um valor que ignora subagentes de gerações anteriores na mesma árvore).

**FR-17 — Orçamento esgotado não derruba a sessão pai; é reportado como falha graciosa.**
> Given um orçamento já esgotado quando o subagente tenta seu próximo passo,
> When o subagente estoura o orçamento,
> Then o subagente para (não continua gastando) e o pai recebe um resultado de ferramenta identificando o
> esgotamento — não uma exceção não tratada que derruba a sessão do pai inteira. Se o pai, em seguida,
> tentar qualquer ação que também exija orçamento, essa ação **também** falha pelo mesmo motivo (o teto é
> um só). *Referência de comportamento:* `conductor-main/host.py:1540-1547` (`except BudgetExhausted`)
> devolve `Result.error`, não propaga.

### Grupo H — Evidência obrigatória (G6, invariante "o pai não deve confiar apenas na declaração de sucesso")

**FR-18 — O retorno de um subagente inclui, no mínimo, uma referência verificável ao que de fato aconteceu.**
> Given um subagente concluído,
> When seu resultado retorna ao pai,
> Then `details` inclui, no mínimo, uma referência à própria transcrição/sessão do subagente (algo que um
> revisor — humano ou outro papel — possa abrir e conferir de forma independente do texto que o subagente
> escreveu sobre si mesmo) e o custo em tokens daquela execução.

**FR-19 — Quando a tarefa envolveu alterar arquivos, a evidência inclui o quê foi alterado.**
> Given um subagente cuja tarefa era modificar código,
> When ele conclui,
> Then `details` inclui a lista de arquivos tocados e, se a execução foi isolada (worktree), se as
> mudanças de fato chegaram à árvore de trabalho do pai ou não — uma declaração de texto livre como "corrigi
> o bug" sem nenhum arquivo listado não satisfaz este requisito quando a tarefa era, precisamente, alterar
> arquivos.

### Grupo I — Ferramentas fora da lista do papel

**FR-20 — Um papel não consegue usar uma ferramenta fora de sua lista `tools`.**
> Given um papel `business-analyst` cujo `tools` não inclui `bash`,
> When o modelo, rodando como `business-analyst`, tenta chamar `bash`,
> Then a chamada é recusada antes de executar — consistente com a disciplina de "sem política declarada,
> nega" já implementada no Permission Gate da Fase 2 (`permission-engine.ts:216-220`, o branch `security`
> terminal: *"no policy declared for tool ... — fail closed"*) — a lista `tools` de um papel é uma
> restrição adicional sobre esse mesmo modelo de fail-closed, não um mecanismo novo e paralelo.

---

## 6. Business rules

Extraídas do plano §10 (invariantes 1, 2, 3, 14) e §4.5 (regras de subagentes, linhas 404-412), cada uma
reformulada como regra testável e ligada ao(s) FR(s) que a exercitam.

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | Todo papel deve referenciar apenas skills que existem no catálogo — uma referência a uma skill inexistente é um erro de validação, nunca um papel que carrega parcialmente. | Plano §10 item 1 | FR-1 (implícito), edge case §7.1 |
| **BR-2** | Toda skill deve ter metadados válidos (no mínimo `name`+`description` não vazios, `name` casando com o diretório) — uma skill com metadado inválido é excluída do catálogo com um diagnóstico visível, nunca silenciosamente ignorada nem carregada malformada. | Plano §10 item 2; comportamento já real do Pi (`coding-agent/src/core/skills.ts:117-127,289-307` — descrição vazia ⇒ skill excluída com diagnóstico) | FR-4, edge case §7.2 |
| **BR-3** | O grafo de delegação (união de todo `canSpawn` de todo papel) deve ser acíclico — verificado como propriedade do grafo inteiro, não par a par. | Plano §10 item 3, §4.4 | FR-10, FR-11 |
| **BR-4** | O orçamento de um subagente é a **mesma** cota do pai, nunca uma cota própria — um subagente com orçamento independente é, na prática, uma forma de gastar o orçamento em dobro. | Plano §10 item 14, §4.4; `conductor-main/budget.py` ("One budget for the whole tree... not an optimisation") | FR-16, FR-17 |
| **BR-5** | Um subagente não recebe automaticamente todo o histórico da conversa do pai. | Plano §4.5, regra 1 | FR-7 |
| **BR-6** | O pai é responsável por fornecer, no `prompt` da delegação, apenas a tarefa e os artefatos necessários — um subagente que "não sabe" algo que o pai esqueceu de incluir é um defeito de autoria do pai, não um bug de runtime. | Plano §4.5, regra 2 | FR-7 |
| **BR-7** | Ferramentas destrutivas continuam sujeitas a aprovação **dentro** de um subagente exatamente como estariam na sessão do pai — a delegação não é uma forma de contornar o Permission Gate. | Plano §4.5, regra 3; ADR 0003 (Permission Gate/Engine já construídos na Fase 2) | FR-9, FR-20 |
| **BR-8** | O orçamento é descontado de uma cota compartilhada (reafirmação, com redação própria do plano, da mesma regra de BR-4 — mantida como item distinto para rastreabilidade com a linha exata do plano). | Plano §4.5, regra 4 | FR-16 |
| **BR-9** | O resultado de uma delegação deve conter evidências, no canal estruturado do retorno da ferramenta. | Plano §4.5, regra 5 | FR-8, FR-18, FR-19 |
| **BR-10** | O pai (ou o processo ao redor dele) não deve confiar apenas na declaração de sucesso do subagente — o contrato desta ferramenta existe para tornar essa verificação **possível**; esta fase não obriga que toda chamada de `task` seja de fato auditada por um humano ou por outro papel, isso é disciplina de gate (Gate 8/9), não uma trava mecânica desta ferramenta. | Plano §4.5, regra 6 | FR-18, FR-19; ver Non-goals §3 ("verificação automática de qualidade da evidência") |
| **BR-11** | Trabalhos críticos devem poder ser verificados por outro agente — esta fase não impõe *quando* isso é obrigatório (é dos gates), mas o grafo de delegação e o contrato de evidência não podem impedir estruturalmente que um papel revisor peça e inspecione a evidência de um trabalho que outro papel delegou. | Plano §4.5, regra 7 | Restrição de design para o Gate 4, não um FR autônomo |

---

## 7. Edge cases

1. **Papel que referencia skill inexistente.** Coberto por BR-1: o papel não carrega parcialmente; a
   validação falha nomeando a skill ausente. *(Não vira um FR próprio — é o mesmo mecanismo de FR-12,
   aplicado a skills em vez de a `canSpawn`.)*
2. **Skill com metadado inválido** (frontmatter sem `description`, `name` não batendo com o diretório).
   Coberto por BR-2 — comportamento já observado no loader nativo do Pi: a skill é excluída, um
   diagnóstico é produzido, e esse diagnóstico precisa ser visível em `conductor skills list` (ou
   equivalente), não engolido silenciosamente.
3. **Ciclo de delegação de 2 nós.** FR-10.
4. **Ciclo de delegação de 3+ nós.** FR-11.
5. **Subagente que nunca retorna.** Nem a referência (`conductor-main`) nem o exemplo nativo do Pi
   (`examples/extensions/subagent`) implementam um timeout de parede (wall-clock) dedicado para isso — os
   dois backstops existentes são o orçamento (FR-17) e um limite de passos/iterações do laço do agente
   (`conductor-main/loop.py:MAX_STEPS = 100`, explicitamente descrito como "a backstop against a model
   that calls the same tool forever", não uma política de custo). **Esta especificação não resolve isso**:
   o requisito observável mínimo é que o usuário sempre tenha um jeito de cancelar uma execução travada
   (o exemplo do Pi já propaga `AbortSignal`/Ctrl+C ao subprocesso) — um timeout automático de parede fica
   como pergunta aberta para o Gate 4 (ver §9).
6. **Dois subagentes concorrentes consumindo do mesmo budget (race).** Requisito observável: a soma do
   gasto de dois subagentes rodando em paralelo sob o mesmo orçamento nunca deve ser subcontada por uma
   corrida de leitura-then-escrita no contador compartilhado — dito de outra forma, o mecanismo de
   contabilidade do budget precisa ser seguro sob concorrência o bastante para que o teto configurado não
   seja ultrapassado por mais do que o gasto de uma requisição já em voo no momento em que o teto foi
   atingido. O **mecanismo** exato (lock, contador atômico, serialização) é decisão de Gate 4/6; o
   **comportável observável** é a garantia de não-ultrapassagem, testável determinando um cenário com N
   subagentes paralelos cuja soma excederia o teto e verificando que o gasto total registrado não excede
   o teto por mais do que uma unidade de "gasto em voo".
7. **Papel tentando usar uma ferramenta fora de sua lista `tools`.** FR-20.
8. **Um subagente, ele mesmo, chama `task` para delegar mais um nível (profundidade máxima).** FR-15.

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 2` (backend
saudável).

1. **Uso de Given/When/Then testável** → **Specification by Example — Complete Professional Guide §2.12/
   §2.13** (top **0.623**): G/W/T vale a pena onde há "behaviour a non-programmer will actually read and
   dispute... whose outcome is a value someone can name" — base de todo o §5 deste documento.
2. **Goals/non-goals explícitos** → **Spec-Driven Development — The Complete Book, Appendix B/C** (top
   **0.643**): checklist cita literalmente "the goals are clear and there's a non-goals section" — base
   das §2/§3.
3. **Linguagem ubíqua / glossário de domínio** → **Domain-Driven Design — Complete Professional Guide
   §1.1/§1.12** (top **0.673**): "a single, shared vocabulary... reflected literally in the code"; "pays
   for itself... the code will be edited by people who were not in the conversation" — base da §4.
4. **Exemplos concretos para regras/edge cases** → **Specification by Example §1.1/§1.12** (top **0.670**):
   "replacing abstract requirements with concrete examples... unambiguous, testable" — base da §7.
5. **Evidência verificável / Definition of Done não subjetivo** → **Spec-Driven Development §11.4** (top
   **0.573**, "The Machine-Checkable Definition of Done": "❌ Bad DoD: 'Endpoint working well.' ✅ Good
   DoD: '...acceptance scenario tests C-01 and C-04 pass'") e **Prompt Engineering — Principles, Patterns
   and Practice §12.4** (top **0.593**, "Done is defined by *verifiable* criteria... do not report
   completion without running the verification") — base direta do Grupo H (FR-18/FR-19) e de BR-9/BR-10:
   a exigência de evidência estruturada, não uma declaração de sucesso em texto livre, é a mesma disciplina
   que estes dois livros descrevem para "done" em geral, aplicada aqui ao retorno de um subagente.
6. **Aciclicidade de grafo como regra de negócio / progressive disclosure como redução de carga cognitiva**
   → cobertura **fraca/fora do alvo** (top 0.590-0.601, retornando material de postmortem, ACID, grafos
   NoSQL — nenhum sobre validação de grafo de delegação ou progressive disclosure especificamente). **A
   biblioteca não cobre isso especificamente** — declarado, não forçado. A regra de aciclicidade (BR-3) é
   fundamentada diretamente no invariante já decidido do plano (§10 item 3) e no comportamento de referência
   já testado do `conductor-main` (`roles.py:find_cycle`, um DFS puro), não em uma citação de livro; o
   requisito de progressive disclosure (Grupo C) é fundamentado no comportamento **já implementado e
   observado** no próprio Pi (`skills.ts`), não numa citação de biblioteca.

---

## 9. Perguntas abertas para o Gate 3 (threat model) e Gate 4 (arquitetura)

Registradas aqui porque nasceram durante a especificação, mas **não são decisões desta BA** — são
insumo, não resposta:

1. A instrução nativa do Pi "use o `read` tool para carregar uma skill" é suficiente para satisfazer o
   Grupo C, ou o produto quer um tool nomeado `skill` (plano §4.2) por uniformidade com `task`/`journal`/
   `library`? Ambos satisfazem o comportamento observável desta spec; a escolha é de composição vs.
   uniformidade de superfície, portanto do Gate 4.
2. Mecanismo exato de orçamento compartilhado quando o subagente roda como **processo separado** (o
   padrão que o exemplo nativo do Pi já usa, via `child_process.spawn`) em vez de um host in-process como
   `conductor-main` — agregação pós-hoc via leitura de uso reportado, ou um serviço/lock compartilhado?
   Afeta diretamente a resposta ao edge case de concorrência (§7.6). Gate 4.
3. Valor numérico da profundidade máxima de delegação (FR-15) e do timeout de parede, se algum for
   adotado (edge case §7.5) — parâmetros de configuração, não requisitos de comportamento. Gate 4/6.
4. Onde exatamente a checagem de FR-13 (delegação não autorizada) e a validação do Grupo E (aciclicidade)
   vivem no código do pi-conductor — dentro da própria ferramenta `task` (paralelo a
   `conductor-main/tools/task.py`) ou num validador de build/CI separado, ou ambos (uma validação estática
   do registro + uma checagem em runtime na ferramenta, como o próprio `conductor-main` faz com R23 +
   `task.py`)? Gate 4.
5. Esta fase levanta uma superfície de execução nova (a ferramenta `task`, capaz de rodar um subagente com
   as mesmas ferramentas do papel-pai) — o Gate 3 (threat model) desta demanda precisa avaliar
   explicitamente se isso introduz uma fronteira de confiança nova além do que a Fase 2 já modelou (por
   exemplo: um subagente isolado em worktree cujo merge de volta ao pai não passa por revisão humana antes
   de aplicar).

---

## Registro no diário

`cdt journal add --gate 2 --kind decision` registrado a partir de
`C:\development\source\projects\conductor` (ver confirmação na resposta final).
