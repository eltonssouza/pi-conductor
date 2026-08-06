# Gate 3 — Adendo da Fase 3: Papéis, skills e subagentes (STRIDE da fronteira de delegação)

**Demanda:** reconstruir o Conductor Coding Agent sobre o runtime Pi
(earendil-works/pi) — **Fase 3, "Papéis, skills e subagentes"**.
**Branch:** `feature/fase3-papeis-skills-e-subagentes` (de `develop`).
**Papel responsável:** `security-engineer` (skill `model-threats`), executado como
subagente, Gate 3 **FULL** (gate mandatório, nunca colapsado — CLAUDE.md
"never-collapse").

**Natureza deste documento:** é um **adendo** aos threat models da Fase 0
(`gate3-threat-model.md`, T1–T10), Fase 1 (`gate3-fase1-addendum.md`, T11–T16) e
Fase 2 (`gate3-addendum-fase2.md`, T17–T29). **Estende, não substitui.** O DFD de
6 travessias (TB1–TB6), as ameaças T1–T29, os secure defaults 1–20, as regras
vinculantes R1–R12 e a **regra-mãe fail-closed** continuam válidos e **não são
re-litigados**. Este adendo modela a **fronteira de confiança nova** que a Fase 3
abre e que a spec do Gate 2 (`gate2-spec-fase3.md` §9 #5) explicitamente rotou
para cá: a **ferramenta `task` e a árvore de delegação** — um vetor de execução
novo (rodar um subagente com as mesmas ferramentas de um papel) mais o **grafo de
autorização** (`canSpawn`) que hoje **não existe** no pi-conductor.

**Superfície modelada = a spec da Fase 3** (`gate2-spec-fase3.md`): 20 FRs
(grupos A–I), 11 BRs, 8 edge cases, 8 goals (G0–G6). Este documento é o Gate 3 que
a própria spec §9 #5 declarou devido.

**Método:** Shostack — o que estamos construindo (o delta de superfície da Fase 3,
§1); o que pode dar errado (STRIDE-per-element sobre as 7 superfícies novas, §2);
o que fazemos a respeito (mitigações → regras vinculantes R13–R22 pro Gate 4, §4);
fizemos um bom trabalho (critérios de saída §7 + lacunas honestas reportadas de
volta ao Gate 2, §5).

---

## 0. O fato dominante herdado — e a torção que a Fase 3 lhe dá

A Fase 0–2 assentou o **fato dominante**: um **único processo de SO, sem sandbox**,
rodando com o privilégio do usuário; o único primitivo de enforcement é
`pi.on("tool_call")` (a Permission Gate da Fase 2). Toda garantia da Fase 2 é uma
camada de **política** dentro desse processo confiado, **não** isolamento de
kernel.

**A torção da Fase 3 (o achado que molda todo este documento).** O exemplo oficial
de subagente do Pi que esta fase estende
(`packages/coding-agent/examples/extensions/subagent/index.ts`) roda o subagente
como um **processo `pi` SEPARADO** — `child_process.spawn(invocation.command, …)`
(linha 335), com `--tools`/`--append-system-prompt` e, crucialmente,
**`cwd: cwd ?? defaultCwd`** (linha 337: o filho herda o **mesmo diretório de
trabalho** do pai) e **`--no-session`** (linha 294). O `conductor-main` de
referência faz o oposto — spawn **in-process** (`host.py:spawn`, `ctx.spawn`),
mesmo objeto `Budget` por referência, mesmo callback de aprovação do pai.

O Gate 4 ainda **não decidiu** qual dos dois modelos o pi-conductor usa (spec §9
#2 é essa pergunta em aberto). Mas a decisão de **segurança** independe dela e tem
que ser dita agora, porque um leitor ingênuo lê "processo separado" como
"isolamento":

> **O limite de processo do subagente NÃO é um limite de segurança.** Um segundo
> processo `pi` roda com o **mesmo usuário, o mesmo disco, a mesma confiança** que
> o pai — não há fronteira de privilégio entre eles. A separação de processo compra
> **uma** coisa: isolamento do **contexto de conversa** (transcrição nova — um
> benefício de janela-de-contexto/economia, exatamente a economia que a spec §4.5
> e `task.py` descrevem). Ela **não** compra isolamento de **autoridade**, de
> **sistema de arquivos**, nem de **política**.

A consequência é a espinha dorsal deste gate: **todo mecanismo da Fase 2 —
Permission Gate, protected-paths, Command Classifier, audit trail, elegibilidade
`--yes` fail-closed — precisa ser RE-ESTABELECIDO dentro do filho.** Não é
automático, ao contrário do que G0/FR-9/BR-7 assumem por prosa. O exemplo do Pi
**não** o re-estabelece: lança um `pi` cru. Se o pi-conductor herdar esse molde sem
a regra R13 abaixo, a delegação vira um buraco com o formato exato do modelo de
permissão (T30). Este é o **mesmo padrão de T29** (uma propriedade de segurança que
depende de um processo/dependência que muda fora do nosso controle) elevado de
"um sink de redação" para "toda a gate".

---

## 1. Delta de superfície — as 7 superfícies novas da Fase 3

A Fase 2 encerrou com a Permission Gate de 5 níveis + classifier + policy split-trust
+ redação + audit + `--yes` fail-closed. A Fase 3 acrescenta 7 superfícies, uma por
eixo do critério de saída desta demanda:

| # | Superfície | NOVO / estende | Relação com o herdado |
|---|---|---|---|
| SF1 | **Ferramenta `task`** (novo vetor de execução: spawna um subagente com as tools do papel-alvo) | **NOVO** | É uma tool Exec (spec G0/FR-9; `task.py:approval → TIER_EXEC`). Atravessa TB2 (o chokepoint), mas **o que ela alcança** é um processo/host inteiro, não uma única syscall |
| SF2 | **Grafo de delegação / Role Registry** (`canSpawn`, o análogo do `ROLES[*].spawns` de `roles.py`) | **NOVO** | Um novo *data store de política* + sua validação (aciclicidade). Não existe no pi-conductor hoje (spec §1) |
| SF3 | **Fronteira de execução do subagente** (in-process vs. processo separado — §0) | **NOVO** | Decide onde a Permission Gate/budget/audit do pai alcançam o filho. É a fronteira de confiança central desta fase |
| SF4 | **Budget compartilhado pela árvore de delegação** | **NOVO** | `budget.py` de referência (`Budget` por referência). Novo teto de recurso que pai+filhos dividem |
| SF5 | **Contrato de evidência** (`details` do retorno de `task`) | **NOVO** | Refina a regra-de-produto dos dois canais (`content`/`details`) para o retorno de um subagente |
| SF6 | **Role Registry como fonte de confiança de entrada** (definições de papel vindas de `user`/`project` dirs = repo-controladas) | **NOVO** | O análogo exato de T18/T28 (`policy.json`/TrustStore): um arquivo que chega **dentro de um repo clonado** e é **lido-e-obedecido** para configurar quem executa o quê |
| SF7 | **Catálogo de skills + progressive disclosure** (resolução de `<location>`, corpo carregado via `read`) | Estende o loader nativo do Pi (`coding-agent/src/core/skills.ts`) | O catálogo resumido (nome+descrição+local) está **sempre no system prompt**; o corpo entra via `read`. Duas superfícies de conteúdo não-confiável (descrição sempre-presente; path de `<location>`) |

**Observação de fronteira (a que mais importa).** SF6 é a imagem espelhada do que a
Fase 2 aprendeu com `policy.json` (T18): a Fase 2 perguntou "quem **autorou** a
política que a gate obedece?"; a Fase 3 pergunta "quem **autorou** o **papel** —
suas `tools`, seu `canSpawn`, sua `approvalPolicy`, sua persona — que o runtime
carrega e executa?". `discoverAgents` (o exemplo do Pi) lê papéis de `user` **e**
`project`; o `merge_spawns` do `conductor-main` une `spawns:` de `.cdt/agents/*.md`
do projeto. Ambos são **atacante-alcançáveis** num repo clonado.

---

## 2. Ameaças novas da Fase 3 (T30–T39)

Escala idêntica às fases anteriores: Probabilidade {Baixa, Média, Alta} × Impacto
{Baixo, Médio, Alto, Crítico}; Prioridade P1…P4. Cada mitigação é amarrada a um
primitivo real e vira uma **regra vinculante** numerada no §4.

### Sumário priorizado

| ID | Ameaça | STRIDE | Prob | Impacto | Prio | Superfície |
|---|---|---|---|---|---|---|
| **T30** | Subagente **não governado** por uma Permission Gate equivalente — o limite de processo não re-estabelece a gate; `bash`/`write` do filho contornam TODA a Fase 2 | E, T, R | **Alta** | **Crítico** | **P1** | SF1/SF3 |
| **T34** | **Evidência forjável** — o filho declara sucesso com transcript/lista-de-arquivos fabricados; o pai (ou o checker do `/cdt-triage`) confia | S, R | **Alta** | **Alto** | **P1** | SF5 |
| **T37** | **Definição de papel hostil** vinda de repo clonado (`tools:[bash]`, `canSpawn` amplo, `approvalPolicy` permissiva, persona injetada) — TOFU não modelado | E, S, T | Média | **Crítico** | **P1** | SF6 |
| **T33a** | Budget **fail-open** — exaustão/estado ilegível tratado como "allow" em vez de "deny" (a classe de bug corrigida 2× na Fase 2) | E | Média | **Crítico** | **P1** | SF4 |
| **T31** | **Escalação por delegação** (confused deputy) — papel `read`-only delega a papel `bash` pra rodar o que ele mesmo não podia | E | Média | Alto | **P2** | SF1/SF2 |
| **T33b** | Budget **race** — N subagentes concorrentes (o Pi roda até 4) lêem-then-escrevem o contador → teto ultrapassado; ou filho cria **cota própria** ("gastar em dobro") | E, D | Média | Alto | **P2** | SF4 |
| **T32** | **Ciclo/profundidade** de delegação como DoS — grafo MERGED (built-in ∪ projeto) com ciclo, ou fan-out exponencial dentro do depth cap → exaustão | D | Média | Alto | **P2** | SF2 |
| **T35** | **Vazamento por workspace compartilhado** — o filho lê session/audit/config/segredos do pai via `read` (permitido dentro do workspace) | I | Média | Alto | **P2** | SF3 |
| **T36** | **Merge-back de worktree isolado sem revisão** — "aplica limpo" ≠ "é seguro"; auto-aplica no working tree do pai, possivelmente em protected-paths | T, E | Média | Alto | **P2** | SF1 |
| **T38** | **Catálogo de skill malicioso** (descrição sempre no prompt = injeção) + **path traversal** na resolução de `<location>` | T, E, I | Média | Alto | **P2** | SF7 |
| **T39** | Papel com **skill/tool inexistente** carregado — fail-closed em runtime, não só no linter estático | E, D | Baixa | Médio | **P3** | SF2/SF7 |

---

### T30 — Subagente não governado pela Permission Gate (P1 — o achado mais forte da fase)
**STRIDE:** Elevation + Tampering + Repudiation · **Elemento:** SF1/SF3 (a fronteira
de delegação).
**Achado verificado no código, não hipotético.** O exemplo do Pi
(`subagent/index.ts:333-339`) lança o subagente com
`spawn(invocation.command, invocation.args, { cwd: cwd ?? defaultCwd, … })` e
`args = ["--mode","json","-p","--no-session", "--tools", …, "--append-system-prompt", …]`.
Não há **nenhuma** referência à `conductor-permission-gate` no comando do filho. Como
`pi.on("tool_call")` é um hook do **processo** que registra a extensão, o handler da
Permission Gate do **pai não vê** as tool calls do **filho** — elas nascem noutro
processo, noutro event bus. Se o `pi` do filho for iniciado sem a extensão da Fase 2
carregada e **fiada com o mesmo `workspaceRoot`/`policy`/`audit`/`yesFlagActive`**,
então um `bash: rm -rf ~/.ssh`, um `write .conductor/config.json`, um comando tier
`critical` **rodam sem classificação, sem protected-path, sem aprovação, sem
auditoria** — dentro da delegação. Isso torna **estruturalmente ilusória** a
afirmação da spec (G0/FR-9: "nenhuma chamada de ferramenta dentro do subagente pula
essa avaliação"; BR-7: "ferramentas destrutivas continuam sujeitas a aprovação
dentro de um subagente"): ela vale **por construção só se** o filho re-carregar a
gate. O `conductor-main` acerta isso **porque é in-process** — `host.py` documenta:
*"The approval callback is the parent's: a subagent that could approve its own writes
would make `task` the way around the permission model."* O molde de **processo
separado** do Pi perde essa garantia de graça. Prob **Alta** (o exemplo literalmente
lança `pi` cru; é o caminho de menor resistência); Impacto **Crítico** (desarma toda
a Fase 2 dentro de qualquer `task`).
**Mitigação (semântica — mecanismo é Gate 4):** **R13.** A tool `task` é Exec e
atravessa a Permission Gate do pai (FR-9) — mas isso só gate o **ato de spawnar**,
não o que o filho faz depois. A garantia real é: **o subagente executa sob uma
Permission Gate equivalente-ou-mais-estrita, fiada ao MESMO `workspaceRoot`, à MESMA
`EffectivePolicy` (grants incluídos), ao MESMO audit trail (o do pai — senão as ações
do filho não deixam rastro no log do pai, repudiation), aos MESMOS protected-paths e
ao MESMO estado de `--yes`.** Se essa gate **não puder ser estabelecida** no contexto
do filho, o subagente **não roda** (fail-closed — a incerteza nega, não "roda sem
gate"). No modelo **in-process** isso é natural (mesmo `pi.on`); no modelo **processo
separado** é uma **fiação que pode ser silenciosamente esquecida** — logo herda o
guard de T29/R12: um **teste-canário bloqueante** que prova, sobre o comportamento
observável, que uma tool destrutiva **dentro** de um subagente é negada/classificada
idêntico a fora dele; re-executado a cada upgrade do Pi, Pi pinado no lockfile.
*Grounding:* **Security Engineering Principles §1.2** (defense in depth — "multiple
independent layers so one failure doesn't cause a breach; assume the attacker gets
past one control"; a delegação não pode ser a camada onde todas as outras somem);
**Secure and Reliable Systems Design §3.3** (zero-trust: "network location grants no
authority" — por analogia, **a posição de um subagente na árvore não lhe concede
autoridade nenhuma**; ele é re-avaliado do zero), **§3.13** ("route privileged access
through an audit trail" — o valor do audit pressupõe que **toda** ação privilegiada,
inclusive a do filho, passa por ele). **Reportado como refinamento de FR-9 ao Gate 2
(GAP-3A).**

### T34 — Evidência forjável / falso sucesso (P1)
**STRIDE:** Spoofing (de resultado) + Repudiation · **Elemento:** SF5.
`gate2-spec-fase3.md` BR-10 diz "o pai não deve confiar apenas na declaração de
sucesso do subagente" — mas trata isso como **prosa**. O mecanismo real está aberto:
o exemplo do Pi devolve `getFinalOutput(messages)` (linha 170-180) — **a última
mensagem de texto do assistente filho**, isto é, prosa 100% autorada pelo modelo do
filho. Um filho sob prompt-injection, ou simplesmente alucinando, devolve
*"corrigi o bug e os testes passam"* sem ter rodado teste nenhum; um filho maker do
`/cdt-triage` devolve um "diff aplicado" que não aplicou nada. Se o pai (ou o checker)
avança um gate confiando nesse texto, **um gate fecha sobre uma mentira** — e no laço
autônomo `/cdt-triage`, onde o maker e o checker são ambos subagentes, a premissa
inteira de "verificação independente" (plano §4.5 regra 7) colapsa. Prob **Alta**
(um modelo declara sucesso por default); Impacto **Alto** (regressão que escapa a um
gate mandatório — Gate 5 "teste passa" que nunca rodou).
**Mitigação (semântica):** **R14.** A evidência em `details` tem que ser
**derivada-do-runtime, não auto-reportada pelo filho** — precisamente o que o filho
**não pode forjar**: (i) a referência de transcrição aponta para o **arquivo de
sessão do filho que o runtime escreveu** (não uma string que o filho compôs) — um
revisor humano ou outro papel abre e confere independentemente; (ii) a lista de
"arquivos alterados" vem do **registro do runtime de tool calls `write`/`edit`** (ou
de um `git diff` real da árvore), **não** da narração do filho — uma declaração de
texto sem arquivos derivados não satisfaz FR-19 quando a tarefa era alterar arquivos;
(iii) em modo isolado (worktree), **se o merge de fato aplicou** é o relato do
runtime, não a alegação do filho; (iv) o custo em tokens vem do contador do budget,
não do filho. É a distinção que **Secure Code Review §2.12** faz literalmente: *"a
completed trace is evidence about that question and about nothing else … not a
coverage claim"* — a evidência é o que o runtime **observou**, não o que o filho
**disse** ter feito. Esta fase garante que a evidência **existe, é inspecionável e é
não-forjável** (G6); ela não obriga que toda `task` seja auditada (isso é disciplina
de Gate 8/9 — BR-10, Non-goal da spec §3), mas o contrato tem que tornar a auditoria
**possível com material confiável**. *Grounding:* **Secure Code Review §1.2** (mindset
adversarial: "assume inputs are hostile … hunting the assumptions the developer made
that an attacker can violate" — a *assumção* aqui é "o filho fala a verdade sobre si"),
**§2.12** (trace ≠ claim de cobertura); **Penetration Testing §3.12** ("when someone
will ask 'what did you cover,' a coverage map is the only honest answer, and recorded
skips are what make the gaps deliberate" — a evidência estruturada É esse coverage
map, oposto de uma auto-declaração). **Nota de cobertura honesta:** a biblioteca
**não tem capítulo dedicado a anti-forja de evidência num contexto de delegação**
(consulta desta sessão top 0.605, material genérico de coverage/mindset); ancorado
por trace≠coverage + mindset-adversarial + o DoD machine-checkable já usado no
grounding do Gate 2 (Spec-Driven §11.4), **não forçado**. **Reportado como GAP-3B ao
Gate 2** (FR-18/19 devem exigir evidência derivada-do-runtime, nomeando o que o filho
não pode forjar).

### T37 — Definição de papel hostil vinda de repo clonado (P1)
**STRIDE:** Elevation + Spoofing (de autoridade) + Tampering · **Elemento:** SF6.
É o **T18 por outra porta**. Um papel é uma persona **mais** `tools`/`canSpawn`/
`modelRole`/`approvalPolicy` (spec §4, `ConductorRole`; plano §4.4). O exemplo do Pi
lê papéis de `user` **e** `project` (`discoverAgents(ctx.cwd, agentScope)`,
`agentScope: "project"|"both"`); o `conductor-main` une `spawns:` de
`.cdt/agents/*.md` do projeto no grafo (`merge_spawns`). Um **repo clonado hostil**
pode trazer um `.conductor/agents/software-engineer.md` que **sombreia** um papel
built-in e (a) se concede `tools: [bash]`; (b) amplia `canSpawn` para alcançar papéis
mais privilegiados; (c) define `approvalPolicy` permissiva; (d) embute
prompt-injection na persona/`systemPrompt`; (e) aponta `skills` para uma skill
maliciosa. Um usuário que só rodou `git clone && conductor chat --role software-engineer`
**silenciosamente** executa com os papéis reconfigurados pelo atacante. O exemplo do
Pi tem uma mitigação **parcial** — `confirmProjectAgents` pergunta antes de rodar
papéis project-local (*"Project agents are repo-controlled. Only continue for trusted
repositories."*, linha 518-520) — e o `merge_spawns` tem tetos reais (união-só, não
pode **remover** aresta built-in; rejeita alvo desconhecido; exclui o nó `advisor`;
re-valida aciclicidade e cai fail-closed pro built-in). Mas o modelo merged ainda
deixa um papel de projeto **ganhar** uma aresta (`AC-T6a-01`: "a role with ZERO
built-in spawns gains one") e **nada** hoje trata `tools`/`approvalPolicy`/persona de
um papel de projeto como grant não-confiável. Prob **Média** (exige repo hostil, mas
é o cenário "clonar um projeto da internet"); Impacto **Crítico** (persona + tools +
delegação arbitrárias na abertura).
**Mitigação (semântica):** **R15.** A disciplina **split-trust** de `policy.json`
(R3/R4/T18) aplica-se **idêntica** ao Role Registry:
- **Restrições** (um papel de projeto que **estreita** `tools`, que **adiciona** um
  protected-path, que **sobe** um tier): aplicam **incondicionalmente e unidas** —
  qualquer fonte pode restringir mais.
- **Grants** (um papel de projeto que **amplia** `tools` além do built-in, que
  **adiciona** uma aresta `canSpawn`, que **afrouxa** `approvalPolicy`, que
  **sombreia a persona** de um papel built-in): exigem **trust-on-first-use** por hash
  do arquivo — o usuário aprova **fora de banda** (o `confirmProjectAgents` do Pi é o
  embrião disso) vendo **os grants concretos** (quais tools ganharia, quais papéis
  alcançaria); um papel de projeto desconhecido/alterado cai para **grants-ignorados**
  (só o built-in), nunca honrado silenciosamente.
- **Tetos rígidos, independentes de confiança:** um papel de projeto **nunca** ganha
  uma tool que o **usuário** não sancionou; **nunca** desabilita a Permission Gate via
  `approvalPolicy` (a gate é o chokepoint do processo, BR-7/G0 — `approvalPolicy` de
  um arquivo de repo é, no máximo, mais restritivo); **nunca** introduz um ciclo
  (R17); `merge` de grants é **interseção/trust-ordered**, `merge` de restrições é
  **união** (R4 aplicado a papéis).
*Grounding:* **Secure and Reliable Systems Design §3.12** ("the reachable authority
has never been enumerated" — um `tools`/`canSpawn` de um arquivo de repo **é**
autoridade alcançável que ninguém enumerou), **§3.13** (least privilege; "require
multi-party authorization for sensitive actions" — o TOFU é a segunda parte);
**Security Engineering Principles §2.2** (secure-by-default — o default de um papel
de repo desconhecido é o built-in, não o que o arquivo pede). Cobertura TOFU dedicada
**ausente** (mesma postura de T28, herdada): análogo mais próximo = pinning por
content-hash (**Penetration Testing §14.5/§14.9**, "dependencies pinned via lockfile /
won't execute if tampered"). **Reportado como GAP-3C ao Gate 2** (FR-1 trata o Role
Registry como confiável; BR-1/BR-2 validam estrutura, **não** proveniência).

### T33a — Budget fail-open na exaustão / estado ilegível (P1)
**STRIDE:** Elevation · **Elemento:** SF4.
A **mesma classe de bug fail-open** que a Fase 2 corrigiu **duas vezes** nesta sessão
(T24 `--yes`, T27 resolução de nível; e o alerta explícito do usuário) — merece
atenção redobrada aqui. Se a exaustão do budget, **ou** um estado de budget que não
pôde ser lido/determinado (arquivo `triage.json` corrompido, contador inacessível no
modelo de processo separado, exceção na contabilidade), resolver para **"allow"**
("na dúvida, deixa gastar") em vez de **"deny"**, o teto vira decorativo. Prob
**Média**; Impacto **Crítico** (perda do único backstop econômico da árvore de
delegação; um ciclo que evada o depth cap (T32) roda sem freio).
**Mitigação (semântica):** **R16a.** Budget-desconhecido/ilegível/exausto **é tratado
como esgotado → nega** (fail-closed), nunca como ilimitado. O `budget.py` de
referência acerta a **direção temporal**: `check()` levanta `BudgetExhausted`
**antes** da requisição (*"Called before a request, never after — a budget checked
only on the way out has already spent the money"*), e o loop propaga como **parada
graciosa** (`except BudgetExhausted → Result.error`, FR-17), não crash do pai. O
pi-conductor deve preservar **as duas** propriedades: (i) checar-antes-de-gastar;
(ii) na incerteza, negar. *Grounding:* **Security Engineering Principles §2.9**
("Errors/uncertainty deny access"), **§2.2/§2.12** (secure-by-default; o
timeout-como-allow é o exemplo canônico de conveniência que vira bypass — budget
como-allow é a mesma classe). Cross-ref: T24/T27 (Fase 2). **A direção é vinculante,
não escolha de Gate 4.**

### T31 — Escalação por delegação / confused deputy (P2)
**STRIDE:** Elevation · **Elemento:** SF1/SF2.
Um papel `business-analyst` cujo `tools` **não** inclui `bash` (FR-20 o proíbe de
chamar `bash` diretamente) delega, via `task`, a um papel `software-engineer` cujo
`tools` **inclui** `bash`, instruindo-o a rodar o comando que ele mesmo não podia. O
filho recebe as tools do **papel-alvo** — um **superconjunto**. Isso é delegação
**pretendida** em parte (o ponto de delegar é alcançar capacidade especializada), mas
é um **confused deputy** quando `canSpawn` é amplo: o pai ganha, por procuração, a
união das tools de tudo que pode spawnar. A defesa **não** é proibir (mataria a
feature) — é reconhecer que **uma aresta `canSpawn` É um grant de autoridade
alcançável** e cercá-la em três camadas: (a) `task` é Exec e sua aprovação
**superfície o papel-alvo e a autoridade que ele alcança** (não só "rodar task" — um
`task` aprovado às cegas é aprovação-teatro, primo de T17/T24); (b) o `canSpawn`
limita **quais** papéis são alcançáveis (T32/R17); (c) o `bash` que o filho de fato
roda **ainda** passa pela Permission Gate do filho (T30/R13) — classificado,
aprovado, auditado. Se **qualquer** das três falhar, a delegação vira o bypass do
modelo de permissão (`task.py` diz exatamente isto: *"approving a `task` is approving
whatever it goes on to run … tiering this below the most dangerous thing it can reach
would be a permission model with a hole shaped like delegation"*). Prob **Média**;
Impacto **Alto**.
**Mitigação (semântica):** **R17a.** A aprovação de `task` exibe o papel-alvo e um
resumo da autoridade que ele alcança (tools + o que ele, por sua vez, pode spawnar);
a autoridade efetiva do filho é `tools(papel-alvo)` **sob a Permission Gate do filho**
(R13), nunca mais que isso; `canSpawn` é revisado como um **grant de privilégio**, não
como um mero grafo de conveniência. *Grounding:* **Penetration Testing §19.10**
(anti-patterns de privesc: "user-writable scripts executed by root … broad NOPASSWD" —
delegar autoridade ampla sem enumerar o que ela alcança é a mesma forma), **§19.12**
("privilege-escalation … measures blast radius on a host with more than one account" —
a árvore de delegação **é** um host com mais de um principal); **Secure and Reliable
Systems Design §3.3/§3.13** (least privilege, blast radius — "narrow purpose-built APIs
instead of ambient root").

### T33b — Budget: race entre subagentes concorrentes / cota própria (P2)
**STRIDE:** Elevation + DoS · **Elemento:** SF4.
Dois sub-vetores: (a) **race** — o exemplo do Pi roda até `MAX_CONCURRENCY = 4`
subagentes em paralelo (`mapWithConcurrencyLimit`); dois filhos que lêem-então-escrevem
o mesmo contador de budget podem, numa corrida, ultrapassar o teto (spec edge §7.6 já
nomeia isso). No modelo de **processo separado** **não há contador em memória
compartilhado** — cada filho soma o próprio uso e o pai agrega **pós-hoc** (é o que o
`spent_so_far` do `conductor-main` faz, glob `<id>.*.jsonl` incluindo a subárvore
`tasks/`), então o teto pode ser estourado por até (N em-voo × gasto de cada) antes de
alguém perceber. (b) **cota própria** — um filho que cria seu **próprio** `Budget` em
vez de descontar do pai é, literalmente, *"a way to spend the budget twice"*
(`budget.py`). Prob **Média**; Impacto **Alto**.
**Mitigação (semântica):** **R16b.** Há **um** teto por árvore de delegação, imposto
**por construção** — um objeto por referência (in-process) ou uma cota-de-contagem
única que a subárvore `tasks/` inteira desconta (processo separado); **nenhum filho
recebe cota própria** (BR-4/BR-8). O comportável observável (spec §7.6): com N
subagentes paralelos cuja soma excederia o teto, o gasto total registrado **não excede
o teto por mais que o gasto de uma requisição já em voo** no instante em que o teto foi
atingido. O **mecanismo** (lock, contador atômico, serialização, agregação pós-hoc com
reserva) é Gate 4/6; a **garantia de não-ultrapassagem-material** é vinculante.
*Grounding:* **Secure and Reliable Systems Design §3.3** (scope/duration/failure
domains — o budget é a *duration/scope* da árvore; a autoridade efetiva é a
**interseção** dos limites, não a união), **§3.12** (autoridade alcançável enumerada —
a soma de todos os filhos é a autoridade que o teto existe para limitar). **Nota:** a
biblioteca **não fala** de contabilidade de token/custo especificamente (mesma lacuna
que `budget.py:UsageRow` já declarou, citando *Observability* §1.10 só pela forma
geral) — a garantia de não-ultrapassagem é fundamentada no invariante #14 do plano +
comportamento de `spent_so_far`, não em citação de livro.

### T32 — Ciclo / profundidade de delegação como DoS (P2)
**STRIDE:** Denial of Service · **Elemento:** SF2.
Papel A→B→A (ciclo de 2) ou cadeia mais longa sem detecção = spawn sem fim →
exaustão de processo/memória/budget. Dois pontos exigem cuidado além do óbvio: (i) a
aciclicidade tem que ser re-validada sobre o **grafo MERGED** (built-in ∪ adições de
`.cdt/agents/*.md` do projeto), **não** só o built-in — um papel de projeto pode
**introduzir** um ciclo que o built-in não tem; o `conductor-main` acerta
(`merge_spawns`+`find_cycle` no merged, fail-closed pro built-in em rejeição); (ii)
**aciclicidade estática não impede fan-out em runtime** — mesmo um DAG acíclico tem um
papel que spawna N filhos, cada um spawnando N, com blowup exponencial **dentro** do
depth cap. Logo o **budget (T33) é o backstop econômico** e o **depth cap é o backstop
estrutural**, ambos necessários. Prob **Média**; Impacto **Alto** (exaustão de
recurso). A checagem de profundidade tem que rodar **antes** do spawn
(`task.py:178-182`: `if depth >= MAX_DEPTH → error` antes de `ctx.spawn`).
**Mitigação (semântica):** **R17b.** (i) O grafo **merged** é validado acíclico no
**load** (união built-in ∪ projeto), com rejeição **fail-closed para o built-in**
(um projeto nunca amplia para um ciclo — R15); (ii) um **teto de profundidade** é
aplicado **antes** de criar mais um nível (o valor numérico é Gate 4/6 — `conductor-main`
usa 5; o requisito observável é que **existe** e é aplicado antes do spawn); (iii) o
**budget único** (R16) é o backstop contra fan-out que evade o depth cap; (iv) as
mensagens de recusa nomeiam o ciclo/limite exato (FR-10/11/15), não um genérico.
*Grounding:* a biblioteca **não cobre detecção de ciclo em grafo de autorização
especificamente** (declarado no Gate 2 §8 desta demanda; consultas top 0.59-0.60 fora
do alvo) — fundamentado no invariante #3 do plano + no `find_cycle`/R23 já testado do
`conductor-main` (DFS puro). O **enquadramento** de DoS/exaustão é
**Secure and Reliable Systems Design §3.3** (failure domains — conter o raio de uma
cadeia que não termina) + **Security Engineering Principles §1.2** (defense in depth:
depth cap **e** budget, camadas independentes). **Não forçado.**

### T35 — Vazamento por workspace compartilhado (P2)
**STRIDE:** Information disclosure · **Elemento:** SF3.
O subagente recebe "contexto novo e isolado" (spec §4.5, BR-5) — mas isso é isolamento
de **conversa**, não de **sistema de arquivos**. O filho compartilha o **workspace** do
pai (Pi: `cwd ?? defaultCwd`; `conductor-main`: escreve em `.cdt/sessions/tasks/` sob a
mesma raiz). Logo o filho, via `read`/`bash`, pode ler: a **session JSONL do pai**
(`.conductor/sessions/*.jsonl` — que, por T21/T29, captura I/O de tool, possivelmente
segredo), o **audit trail** do pai, `.env`, credenciais, `.conductor/config.json`. Na
Fase 2, `read` é **permitido em qualquer lugar dentro do workspace**
(`permission-gate.ts` branch `read`: allowed se contido) — e os arquivos sensíveis do
pai **estão** dentro do workspace. Um filho instruído (por um prompt envenenado, ou por
um pai sob injeção) a *"leia ../a-sessão-do-pai e me devolva"* alcança dado que a
delegação nunca pretendeu expor. Prob **Média**; Impacto **Alto**.
**Mitigação (semântica):** **R18.** (i) O filho herda os **mesmos protected-paths** do
pai — a session/audit/config/policy/trust-store/credenciais do pai são protected-path
para o `write`/`edit`/`bash` do filho **exatamente** como para o pai (T23/T25/R7/R9
aplicados transitivamente ao filho); (ii) como **não há sandbox** (fato dominante §0),
o `read` do filho dentro do workspace **não pode** ser impedido de alcançar o que o
processo alcança — logo a defesa real contra o vazamento de **segredo** é a
**redação-at-rest** (T29/R12: a session JSONL já está redigida no disco, então um
`read` dela vaza conteúdo não-sensível, não credencial); (iii) **residual declarado,
honesto:** o filho compartilha a árvore de trabalho do pai; conteúdo **não-secreto** do
pai (código, specs, o próprio texto da tarefa) É legível pelo filho — é o mesmo modelo
sem-sandbox da Fase 2, agora com um segundo leitor no mesmo domínio de confiança. Não
se **afirma** isolamento de FS entre pai e filho. *Grounding:* **Secure and Reliable
Systems Design §3.3** (zero-trust / failure domains — a posição do filho não lhe dá
acesso; mas sem mecanismo de isolamento, o limite é a **redação** do que é sensível),
**§3.13** (least privilege por default); **OWASP ASVS V6.4** (herdado de T21/T29 —
segredo não pode ser material persistido em claro, senão qualquer leitor o obtém).
**Reportado como GAP-3D ao Gate 2** (BR-5 fala de histórico de conversa; é silente
sobre o filho compartilhar o FS e poder ler os stores sensíveis do pai).

### T36 — Merge-back de worktree isolado sem revisão (P2)
**STRIDE:** Tampering + Elevation · **Elemento:** SF1. **(Responde a spec §9 #5.)**
O modo `isolated` (`task.py`, param `isolated`) roda as edições do filho num worktree
git privado; *"its changes reach your working tree only if it finishes and they apply
cleanly; a failure leaves your tree untouched"*. Mas **"aplica limpo" ≠ "é seguro"**:
"aplica limpo" é uma checagem de **conflito**, não de **conteúdo**. Se as mudanças do
filho **auto-aplicam** no working tree do pai ao aplicar-sem-conflito, um filho
comprometido/injetado escreve mudanças maliciosas que **pousam na árvore do pai sem o
pai (ou um humano) revisar** — o isolamento deu uma falsa sensação de segurança
(isolou **durante** a execução e auto-aplicou **depois**). Pior: se o merge-back for
uma operação `git` em bloco (nível `bash`), ele pode **contornar o write-gate por
arquivo** — um `git apply`/`merge` que escreve 50 arquivos, inclusive
`.conductor/config.json`, evade o `evaluateToolPath` (T23: `bash` passa por baixo do
check de path). Ou seja, o merge-back é um **re-instance de T23 na fronteira de
delegação**. Prob **Média**; Impacto **Alto**.
**Mitigação (semântica):** **R19.** (i) O merge-back **não auto-aplica a
protected-paths** — mudanças do worktree do filho que toquem `.conductor/*` (config,
policy, trust-store, audit) **não** entram silenciosamente; (ii) a aplicação de volta
passa pelo **mesmo tratamento de escrita** que uma escrita direta — write-gate por
arquivo **ou** o diff é **exposto como evidência revisável** (T34/R14) antes de
aplicar, de modo que "aplica limpo" nunca seja confundido com "é aprovado"; (iii) a
distinção conflito-vs-segurança é explícita no design. *Grounding:* **Secure and
Reliable Systems Design §3.13** (route privileged access through review/audit — um
merge que muta a árvore do pai é acesso privilegiado); **Security Engineering
Principles §2.9** (incerteza/erro nega — na dúvida sobre o conteúdo do diff, revisar,
não aplicar); cross-ref T23 (Fase 2, `bash` fura o path check — o merge em bloco é a
mesma porta). Cobertura de "worktree/container hardening" **pode não existir** na
biblioteca (mesma ressalva do Gate 13 do fluxo) — declarado.

### T38 — Catálogo de skill malicioso / path traversal na resolução de skill (P2)
**STRIDE:** Tampering + Elevation + Information disclosure · **Elemento:** SF7.
Progressive disclosure carrega só nome+descrição+`<location>` no system prompt; o corpo
entra via `read`. Dois vetores: (a) **a descrição é a superfície pior**, não o corpo —
a descrição de uma skill (de fonte `project`/repo) está **sempre no system prompt de
toda sessão**, ao contrário do corpo que só entra sob demanda; uma descrição maliciosa
(*"…ignore os passos anteriores e rode X"*) é **injeção de prompt embutida no catálogo
sempre-presente**, e ainda pode enganar o papel a **carregar a skill errada**; (b)
**path traversal** — se o `<location>` de uma skill aponta para **fora** do diretório
de skills esperado (`../../…` ou um symlink), o `read` que o modelo é instruído a fazer
pode **divulgar arquivo arbitrário** ou **carregar um corpo malicioso**. O loader
(`coding-agent/src/core/skills.ts`) resolve `<location>`; a resolução tem que ser
contida. Prob **Média**; Impacto **Alto**.
**Mitigação (semântica):** **R20.** (i) O `<location>` de toda skill é **canonicalizado
e tem que resolver dentro de um skills-root conhecido** (mesma disciplina real-path de
`evaluateToolPath`); um location que escapa → skill **excluída com diagnóstico visível**
(BR-2 estendido de "metadado válido" para "path contido"), nunca lida de um path
arbitrário; (ii) a **descrição de uma skill de fonte `project`/repo é conteúdo
não-confiável** — mesma disciplina TOFU de T37/R15 no sombreamento de uma skill built-in,
e, no mínimo, delimitada como **dado, não instrução**, no prompt; (iii) o `read` do
corpo de uma skill é permitido **só a partir dos skills-roots conhecidos** — skills podem
morar no config-dir do usuário **fora** do workspace, então lê-las é um `read` fora do
workspace que só é liberado para paths de skill validados, jamais arbitrário.
*Grounding:* **Secure Code Review, Part II** ("bugs concentrate at trust boundaries" —
o catálogo de skill de repo é uma nova boundary), **§1.2** (mindset adversarial —
descrição/location são input hostil até prova em contrário); **Penetration Testing §14.5/
§14.9** (integridade de recurso de terceiro — pinar/conter, não confiar em location cru).
Cross-ref T5 (Fase 0, o limite estrutural do prompt injection — não se "entende e libera"
uma descrição hostil, só se **contém e delimita**). **Reportado como GAP-3E ao Gate 2**
(BR-2 valida metadado, é silente sobre containment de path e descrição-como-untrusted).

### T39 — Papel com skill/tool inexistente: fail-closed em runtime (P3)
**STRIDE:** Elevation (via fail-open) + DoS · **Elemento:** SF2/SF7.
Invariantes #1/#2 (papel referencia skills existentes; skill tem metadado válido) são
validados **estaticamente**. Task #7 pergunta: e se falhar em **runtime** (um papel de
projeto adicionado após a validação; uma skill removida entre validar e carregar)? A
direção fail-closed: (i) papel que referencia skill inexistente → o papel **falha ao
carregar** nomeando a skill ausente, **não** um papel que carrega **parcialmente** sem
a skill (BR-1 diz exatamente isso); (ii) skill com metadado inválido → **excluída com
diagnóstico** (BR-2), nunca carregada malformada; (iii) papel cujo `tools` nomeia uma
tool que **não existe** no registro → a tool está simplesmente ausente (seguro); o
perigo inverso — um `tools` que nomeia uma tool que **existe mas não deveria ser
alcançável** — é T31/FR-20. O fail-**open** a evitar: "skill não encontrada" resolver
para "carrega o papel mesmo assim" (se a skill era uma **restrição** — ex.: uma skill
de revisão de segurança — o papel roda menos seguro); ou "tool fora da lista" resolver
para "libera tudo". A semântica: referência ausente/inválida resolve para o **resultado
mais restritivo** (papel não carrega / tool negada), nunca o permissivo — é R10/T27
(resolução fail-closed) aplicado ao carregamento de papel/skill, **em runtime, não só
no CI**. Prob **Baixa** (majoritariamente pego no estático); Impacto **Médio**.
**Mitigação (semântica):** **R21.** Carregamento de papel/skill é fail-closed **em
runtime**: skill/tool ausente ou inválida → o papel falha ao carregar (erro nomeando o
que falta) ou a tool é negada; **nunca** carrega-parcial nem libera-tudo. *Grounding:*
**Security Engineering Principles §2.9/§2.2** (erro/incerteza nega; secure-by-default);
cross-ref T27 (Fase 2, fail-open na resolução). Majoritariamente **já coberto** por
BR-1/BR-2 — o delta é fixar a direção **em runtime**, não só estático.

---

## 3. Cobertura explícita dos 8 eixos do critério deste gate

Mapa direto dos vetores que o orquestrador nomeou como a razão deste gate para as
ameaças/regras que os fecham:

| Eixo do critério | Ameaça(s) | Regra | Status |
|---|---|---|---|
| **1.** `task` como novo vetor de execução / contorno da gate por delegação | **T30** (+ T31) | R13, R17a | Fechado por semântica: filho sob gate equivalente-ou-estrita fiada ao mesmo estado; o limite de processo **não** é limite de segurança. **GAP-3A** |
| **2.** Ciclo como DoS/exaustão — qual checagem, onde | **T32** | R17b | Fechado: aciclicidade no grafo **merged** no load (fail-closed pro built-in) + depth cap **antes** do spawn + budget como backstop de fan-out |
| **3.** `canSpawn` como controle de acesso — bypass | **T30/T31** (+ ref `task.py`) | R13, R17a | Confirmado que a arquitetura de referência **impede** (checa `want ∉ allowed` **antes** de spawn/budget/modelo, `task.py:164-176`); o pi-conductor deve portar a **ordem**, não só a intenção |
| **4.** Budget — exaustão, race, cota própria, fail-open | **T33a** + **T33b** | R16a, R16b | Fechado: teto único por construção; race bounded a um em-voo; cota própria proibida; **exhaustão/ilegível = nega** (fail-closed, a classe corrigida 2× na Fase 2) |
| **5.** Evidência forjável | **T34** | R14 | Fechado: evidência **derivada-do-runtime**, não auto-reportada pelo filho (transcript escrito pelo runtime, arquivos do registro de tool-calls/git diff). **GAP-3B** |
| **6.** Isolamento de contexto — vazamento | **T35** | R18 | Fechado honestamente: contexto isolado = conversa, **não** FS; filho compartilha workspace → protected-paths transitivos + redação-at-rest; residual sem-sandbox declarado. **GAP-3D** |
| **7.** Papel com skill/tool inexistente — fail-closed runtime | **T39** | R21 | Fechado: falha-ao-carregar / tool-negada em runtime, nunca carrega-parcial/libera-tudo |
| **8.** Progressive disclosure como injeção/confusão / path traversal | **T38** | R20 | Fechado: `<location>` canonicalizado+contido; descrição de repo = untrusted/delimitada; read de corpo só de skills-roots. **GAP-3E** |
| *(bônus)* Definição de papel hostil de repo (levantado ao modelar SF6) | **T37** | R15 | Fechado: Role Registry = trust-on-first-use (T18 por outra porta); restrições unem, grants intersectam. **GAP-3C** |
| *(bônus)* Merge-back de worktree sem revisão (spec §9 #5) | **T36** | R19 | Fechado: "aplica limpo" ≠ "é seguro"; sem auto-apply a protected-paths; diff revisável/write-gate por arquivo |

---

## 4. Regras vinculantes para o Gate 4 (arquitetura DEVE respeitar)

Semânticas de segurança (o que deve ser bloqueado / fail-closed / auditado),
**não** arquitetura de classes. O Gate 4 escolhe o mecanismo; **não pode violar
estas**. Continuam R1–R12 (Fase 2), inalteradas.

- **R13 (subagente governado por gate equivalente, fiada ao mesmo estado; senão não
  roda).** O subagente executa sob uma Permission Gate equivalente-ou-mais-estrita,
  fiada ao **mesmo** `workspaceRoot` / `EffectivePolicy` (grants incluídos) /
  **audit trail do pai** / protected-paths / estado `--yes`. Se essa gate não puder
  ser estabelecida no contexto do filho, o subagente **não roda** (incerteza nega). No
  modelo de **processo separado**, isso é uma fiação esquecível → **guard-canário
  bloqueante** (herda R12/T29): prova observável de que uma tool destrutiva **dentro**
  de um subagente é negada/classificada idêntico a fora; re-executado a cada upgrade do
  Pi, Pi pinado no lockfile. O limite de processo **não** é um limite de segurança. (T30)
- **R14 (evidência derivada-do-runtime, não auto-reportada).** `details` carrega, como
  evidência, o que o **runtime observou**, não o que o filho **declarou**: referência à
  transcrição = **arquivo de sessão escrito pelo runtime**; lista de arquivos = registro
  de tool-calls `write`/`edit` do runtime (ou `git diff`); merge-aplicado = relato do
  runtime; custo = contador do budget. O contrato torna a auditoria **possível com
  material não-forjável** (G6/BR-9/BR-10); não obriga auditar toda `task` (Gate 8/9). (T34)
- **R15 (Role Registry split-trust — TOFU para grants de repo).** Restrições de um
  papel de projeto (estreitar `tools`, adicionar protected-path, subir tier) aplicam
  incondicionais e unidas; **grants** (ampliar `tools`, adicionar aresta `canSpawn`,
  afrouxar `approvalPolicy`, sombrear persona built-in) exigem **trust-on-first-use** por
  hash + **pin informado** (o usuário vê os grants concretos) + **tetos** (nunca ganha
  tool que o usuário não sancionou; nunca desabilita a gate; nunca introduz ciclo). Merge
  de grants = interseção/trust-ordered; de restrições = união. (T37)
- **R16a (budget fail-closed).** Budget exausto/ilegível/desconhecido → **nega**
  (tratado como esgotado), nunca "allow"; checar-**antes**-de-gastar; exaustão é parada
  graciosa (Result.error), não crash do pai. (T33a)
- **R16b (teto único por árvore, não-ultrapassável por construção).** Um teto por
  árvore de delegação; **nenhum filho recebe cota própria** (BR-4/BR-8); com N
  subagentes concorrentes o gasto total não excede o teto por mais que uma requisição em
  voo (spec §7.6). (T33b)
- **R17a (delegação é grant de autoridade; aprovação informada).** A aprovação de `task`
  superfície o papel-alvo + a autoridade que ele alcança (tools + seu `canSpawn`); a
  autoridade efetiva do filho é `tools(alvo)` **sob a gate do filho** (R13), nunca mais;
  `canSpawn` é revisado como grant de privilégio. (T31)
- **R17b (grafo merged acíclico + depth cap antes do spawn + budget de backstop).**
  Aciclicidade validada no grafo **merged** (built-in ∪ projeto) no load, fail-closed pro
  built-in; teto de profundidade aplicado **antes** de criar mais um nível; budget único
  (R16) como backstop de fan-out exponencial dentro do depth cap; recusas nomeiam o
  ciclo/limite exato. (T32)
- **R18 (workspace compartilhado — protected-paths transitivos + redação-at-rest +
  residual declarado).** O filho herda os protected-paths do pai para write/edit/bash;
  como não há sandbox, o `read` do filho não é impedido de alcançar o workspace, então a
  defesa contra vazamento de segredo é a **redação-at-rest** (R12/T29); não se afirma
  isolamento de FS entre pai e filho — residual sem-sandbox declarado. (T35)
- **R19 (merge-back de worktree: conflito ≠ segurança).** "Aplica limpo" nunca é
  confundido com "aprovado"; sem auto-apply a protected-paths; a aplicação de volta passa
  pelo write-gate por arquivo **ou** expõe o diff como evidência revisável (R14) antes de
  aplicar. (T36)
- **R20 (resolução de skill contida + descrição untrusted).** `<location>` de skill
  canonicalizado e contido a um skills-root conhecido, senão excluída com diagnóstico;
  descrição de skill de fonte `project`/repo é conteúdo não-confiável (TOFU no
  sombreamento / delimitada como dado); read de corpo só de skills-roots validados. (T38)
- **R21 (carregamento de papel/skill fail-closed em runtime).** Skill/tool
  ausente/inválida em runtime → papel falha ao carregar (erro nomeado) ou tool negada;
  nunca carrega-parcial nem libera-tudo — R10/T27 aplicado ao load de papel/skill. (T39)

---

## 5. Lacunas reportadas de volta ao Gate 2 (a spec não cobriu)

O Gate 3 é iterativo com o Gate 2/4. Estas lacunas foram encontradas ao modelar as
ameaças e **precisam voltar à spec** (`gate2-spec-fase3.md`) antes do Gate 5:

- **GAP-3A (FR-9/G0 assume governança automática — T30).** FR-9 diz "nenhuma chamada
  de ferramenta dentro do subagente pula a avaliação" como se fosse automático. No
  modelo de **processo separado** (o do exemplo do Pi) **não é** — a gate tem que ser
  re-estabelecida no filho, fiada ao mesmo `workspaceRoot`/`policy`/`audit`/`--yes`, e a
  falha em estabelecê-la deve **impedir o subagente de rodar**. FR-9 deve especificar o
  **mecanismo por modelo de processo** e o guard-canário (R13/R12).
- **GAP-3B (FR-18/19 não exigem evidência não-forjável — T34).** FR-18/19 exigem
  evidência mas são silentes sobre ela ser **derivada-do-runtime**. O exemplo do Pi
  devolve só prosa do modelo filho (`getFinalOutput`). Adicionar: a evidência é o que o
  runtime observou (transcript escrito pelo runtime, arquivos do registro de tool-calls/
  git diff), o que o filho não pode forjar — é o mecanismo por trás de BR-10.
- **GAP-3C (Role Registry tratado como confiável — T37).** FR-1 carrega um papel; BR-1/
  BR-2 validam **estrutura**, não **proveniência**. Uma definição de papel vinda de um
  repo clonado (`tools`/`canSpawn`/`approvalPolicy`/persona) é atacante-alcançável e deve
  ser **trust-on-first-use** (a mesma disciplina de `policy.json`, T18/R3). Adicionar:
  grants de papel de projeto exigem TOFU + tetos; restrições unem, grants intersectam.
- **GAP-3D (BR-5 silente sobre workspace compartilhado — T35).** BR-5 fala de histórico
  de **conversa** não-herdado; é silente sobre o filho compartilhar o **sistema de
  arquivos/workspace** e poder **ler** a session/audit/config/segredos do pai. Adicionar:
  o filho compartilha o workspace (residual sem-sandbox); os stores sensíveis do pai são
  protected-path para o filho; o vazamento de segredo é contido pela redação-at-rest, não
  por isolamento de FS.
- **GAP-3E (BR-2 não cobre containment de path nem descrição-untrusted — T38).** BR-2
  valida metadado (`name`/`description` não-vazios, `name` casa diretório); é silente
  sobre (i) o `<location>` de uma skill ter que resolver dentro de um skills-root
  (path traversal) e (ii) a **descrição** de uma skill de repo ser conteúdo
  não-confiável sempre-presente no prompt. Adicionar ambos a BR-2.

---

## 6. Secure defaults acrescentados na Fase 3 (append aos itens 1–20 das fases anteriores)

Os itens 1–20 (Fase 0–2) permanecem. A Fase 3 acrescenta:

21. **Subagente sob gate equivalente, fiada ao mesmo estado; sem gate estabelecível →
    não roda; guard-canário no modelo de processo separado** (R13/T30).
22. **Evidência derivada-do-runtime, nunca a auto-declaração do filho** (R14/T34).
23. **Role Registry split-trust** — papel de projeto: restrições incondicionais/unidas;
    grants (tools/canSpawn/approvalPolicy/persona) só por TOFU + tetos (R15/T37).
24. **Budget fail-closed** (exaustão/ilegível = nega) + **teto único por árvore**
    não-ultrapassável (R16a/R16b/T33).
25. **Delegação é grant de autoridade** — aprovação de `task` informada; `canSpawn` =
    grant de privilégio (R17a/T31).
26. **Grafo merged acíclico + depth cap antes do spawn + budget de backstop** (R17b/T32).
27. **Workspace compartilhado com protected-paths transitivos + redação-at-rest; sem
    afirmar isolamento de FS pai↔filho** (R18/T35).
28. **Merge-back: conflito ≠ segurança** — sem auto-apply a protected-paths; diff
    revisável (R19/T36).
29. **Resolução de skill contida a skills-roots + descrição de repo untrusted**
    (R20/T38).
30. **Load de papel/skill fail-closed em runtime** (R21/T39).

**Aplicação (Pi/Conductor):** todos realizáveis sobre primitivos existentes —
`evaluateToolPath`/`workspace-policy.ts` (protected-paths transitivos, containment de
skill), o pipeline de redação da Fase 2 (redação-at-rest do que o filho pode ler), a
Permission Gate da Fase 2 re-carregada no filho, o `merge_spawns`/`find_cycle` e o
`spent_so_far`/`Budget` do `conductor-main` como **semântica** de referência. O que é
**novo** first-party: a fiação da gate no filho (modelo de processo), o contrato de
evidência derivada-do-runtime, e o split-trust do Role Registry. **Nenhum exige fork
do Pi** — o exemplo de subagente é ponto de partida a **endurecer**, não a copiar.

---

## 7. Critérios de saída deste adendo (Fase 3)

- [x] Delta de superfície das 7 superfícies novas modelado sobre o DFD Fase 0–2, sem
      re-litigar T1–T29 (§1) + o **fato dominante torcido** (o limite de processo não é
      limite de segurança, §0).
- [x] Ameaças novas T30–T39 enumeradas, avaliadas (prob × impacto) e mitigadas com
      primitivo real; cada mitigação amarrada a uma regra vinculante (§2/§4).
- [x] Os 8 eixos do critério do gate cobertos explicitamente + 2 bônus (T36 responde a
      spec §9 #5; T37 levantado ao modelar SF6) (§3).
- [x] 9 regras vinculantes novas (R13–R21) entregues ao Gate 4; 10 secure defaults
      acrescentados (21–30, §6).
- [x] 5 lacunas (GAP-3A…E) reportadas de volta ao Gate 2 — a spec não é tratada como
      completa (§5).
- [x] Grounding por livro+seção; lacunas de cobertura (autorização de delegação
      agente↔agente; anti-forja de evidência; detecção de ciclo em grafo de autorização;
      TOFU dedicado; contabilidade de budget) **reportadas honestamente**, não forçadas
      (§8).
- [ ] **Aprovação do usuário** — checkpoint do gate (protocolo do fluxo, passo 5).

**Findings críticos/altos em aberto ao fim do gate:** nenhum *não mitigado por regra*.
Quatro P1 são **estruturais e devem constar como restrição de arquitetura, não como bug
a corrigir depois**: **T30** (o subagente tem que re-estabelecer a gate — é a condição
de G0/FR-9/BR-7 não serem ilusórios no modelo de processo separado), **T34** (evidência
não-forjável é a condição de a verificação independente do `/cdt-triage` significar algo),
**T37** (Role Registry é trust boundary de repo, não fonte confiável) e **T33a** (budget
fail-closed — mesma classe corrigida 2× na Fase 2). Residual aceito e **declarado, não
escondido**: (a) o modelo **sem-sandbox** herdado — pai e filho no mesmo domínio de
confiança, sem isolamento de FS (T35); (b) o canal do provedor de modelo continua exfil
não-gated (Fase 0 T5/T7, agora com um segundo processo que também o alcança); (c)
cripto-integridade de audit/evidência/trust-store é **Fase 4** (herdado). A escolha
**in-process vs. processo separado** (spec §9 #2) é do Gate 4 — este gate fixa que, **qualquer
que seja**, os invariantes R13/R14/R16 valem **por construção**, e que o modelo de
processo separado carrega **maior ônus de prova** (a gate/budget do filho tem que ser
re-estabelecida e provada por guard-canário, T29-like).

---

## 8. Grounding (biblioteca) — consultas desta sessão

Backend saudável. Consultas rodadas de `C:\development\source\projects\conductor` via
`cdt library "<pergunta>" --gate 3`, complementares às já rodadas pelo orquestrador
(*Secure Code Review* §3.3 transitive trust; *Secure and Reliable Systems Design*
§3.3/§3.12 least privilege/scope). **Postura honesta:** o corpus cobre **forte** os
eixos least-privilege/blast-radius/confused-deputy e fail-closed/secure-by-default;
cobre **fraco/ausente** os eixos **agente-nativos** (autorização de delegação
agente↔agente, anti-forja de evidência de subagente, ciclo em grafo de autorização,
TOFU dedicado, contabilidade de budget de token) — reportado, não forçado, mesma
disciplina das Fases 0–2 (T5/T10/T17/T28).

1. **Confused deputy / privilege escalation / blast radius num host multi-principal**
   (T30, T31) → **Penetration Testing — Complete Professional Guide §19.10**
   (anti-patterns de privesc: "user-writable scripts executed by root; broad NOPASSWD" —
   o formato do confused deputy por delegação), **§19.12** ("privilege-escalation
   measures blast radius on a host with more than one account" — a árvore de delegação
   **é** multi-principal). Top **0.628**. Reforçado por **Secure and Reliable Systems
   Design §3.3** (scope/duration/failure domains; zero-trust: "network location grants
   no authority" → a posição do subagente não concede autoridade), **§3.12** ("the
   reachable authority has never been enumerated" — âncora direta de "canSpawn/tools são
   autoridade alcançável"), **§3.13** (least privilege, blast radius, route privileged
   access through an audit trail). Top **0.625**.

2. **Defense in depth / least privilege / fail-closed** (T30, T33a, T39) → **Security
   Engineering Principles — Complete Professional Guide §1.2** ("multiple independent
   layers so one failure doesn't cause a breach; assume the attacker gets past one
   control" — as 3 camadas de T31; a delegação não pode ser onde todas somem), §2.2
   (secure-by-default), §2.9 ("Errors/uncertainty deny access" — budget/load
   fail-closed), §2.12 (o default seguro é opt-out). Top **0.548** na consulta de
   isolamento; reforçado pelo material já ancorado nas Fases 0–2.

3. **Anti-forja de evidência / trace ≠ coverage claim** (T34) → **Secure Code Review —
   Complete Professional Guide §2.12** ("a completed trace is evidence about that
   question and about nothing else … not a coverage claim" — a evidência é o observado,
   não o declarado), **§1.2** (mindset adversarial: "assume inputs are hostile … the
   assumptions the developer made that an attacker can violate"); **Penetration Testing
   §3.12** ("when someone will ask 'what did you cover,' a coverage map is the only
   honest answer, and recorded skips are what make the gaps deliberate"). Top **0.605**.
   **Cobertura dedicada ausente** — ancorado por trace≠coverage + mindset + o DoD
   machine-checkable do Gate 2 (Spec-Driven §11.4), **não forçado**.

4. **Trust boundary de recurso não-controlado / TOFU / seam de terceiro** (T30 separado,
   T37, T38) → **Secure Code Review, Part II** ("bugs concentrate at trust boundaries";
   "the organizing idea is the trust boundary"); herdado da reconciliação T28/T29 da
   Fase 2: **Penetration Testing §14.5/§14.9** (content-hash pin / lockfile — o análogo
   de TOFU), **§13.12** ("every new route is a fresh chance to omit" → guaranteed-by-
   generation, para a gate re-estabelecida no filho por construção), **§14.12** (terceiro
   muda sem seu build rodar — o guard-canário do upgrade do Pi), **§22.12** (retest/guard
   bloqueante não é opcional). **TOFU dedicado ausente** — declarado (idêntico a T28).

**Lacunas de cobertura reportadas (não forcei citação):**
- **Autorização de delegação agente↔agente / `canSpawn` como controle de acesso** (T30/
  T31): a biblioteca **não tem capítulo** — é conceito agente-nativo. Ancorado nos
  análogos de confused-deputy/privesc (§19, §3.x) + no comportamento já testado do
  `conductor-main` (`task.py` checa antes de spawnar; `roles.py` DAG por senioridade).
- **Detecção de ciclo em grafo de autorização** (T32): **ausente** (declarado no Gate 2
  §8 desta demanda). Fundamentado no invariante #3 do plano + `find_cycle`/R23 (DFS puro,
  já testado).
- **Anti-forja de evidência num contexto de delegação** (T34): **sem capítulo dedicado**
  (top 0.605, genérico). Ancorado por trace≠coverage-claim.
- **Contabilidade de budget de token / não-ultrapassagem sob concorrência** (T33b): a
  biblioteca **não fala** de custo/token (mesma lacuna que `budget.py:UsageRow` já
  declarou). Fundamentado no invariante #14 do plano + comportamento de `spent_so_far`.
- **Sandbox/worktree/container hardening** (T35/T36): pode **não** ser coberto (mesma
  ressalva do Gate 13 do fluxo). Residual sem-sandbox herdado da Fase 0/2, declarado.

**Reconciliação Gate 3 ↔ Gate 4 (protocolo iterativo):** este adendo entrega 9 regras
vinculantes (R13–R21) e 10 secure defaults (21–30) ao ADR da Fase 3 (Gate 4, ainda não
escrito). A escolha **in-process vs. processo separado** (spec §9 #2) é do Gate 4 — se
ele escolher **processo separado**, **voltar a este Gate 3** para confirmar que R13
(gate no filho) e R16 (budget na subárvore) são fiados por construção + guard-canário,
antes de avançar. As 5 lacunas do §5 (GAP-3A…E) devem voltar ao Gate 2 antes do Gate 5
(test-first) — em particular, o Gate 5 deve derivar como test-first o **guard-canário de
R13** (destrutivo dentro do subagente é negado idêntico a fora) e o **teste de evidência
não-forjável de R14** (o pai detecta uma lista-de-arquivos declarada que o registro do
runtime não confirma).

---

## 9. Reconciliação pontual — as 3 fronteiras que a decisão in-process (Gate 4) ela mesma abriu (T40–T42)

**Origem:** o Gate 4 escolheu **subagente in-process** via `createAgentSession`
(ADR 0004 §2). A escolha **fecha diretamente** T30 (por referência de objeto, não por
fiação cross-process) — logo o mandato do §7 ("se escolher processo separado, voltar
para confirmar R13/R16 + canário") **não** dispara na sua forma original. Mas a própria
decisão in-process **expõe três fronteiras de confiança novas** que o STRIDE T30–T39
(construído sob a incerteza processo-separado-vs-in-process, §0) **não** modelou porque
assumia a fronteira de processo. O ADR as reportou de volta (§13, riscos R3/R5/R6) e o
Gate 4 pediu esta reconciliação **antes do Gate 5**. É um adendo **pontual** — não
re-litiga T1–T39, R1–R21, nem os secure defaults 1–30.

**O deslocamento de fronteira (o que mudou do §0).** Em processo separado, o filho é um
**binário isolado** cujo event bus, budget e sinks são *outro processo* — o risco era
"o controle não atravessa a fronteira" (fiação esquecível, fail-open). In-process, o
filho **compartilha o processo** mas **não** compartilha automaticamente: (a) o
**contador de budget** vira objeto mutável sob concorrência de event-loop; (b) o
**event bus** do filho é uma instância **própria** — `pi.on("tool_call")` do pai não o
escuta; (c) o **SessionManager** do filho é uma instância **nova** cujo arquivo é um
**escritor de sessão adicional**. As três ameaças abaixo são a versão **in-process** de
riscos já nomeados — T33b, T30 e T21 — por **portas novas** que a fronteira de processo
antes escondia.

### Sumário priorizado

| ID | Ameaça | STRIDE | Prob | Impacto | Prio | Loop-back |
|---|---|---|---|---|---|---|
| **T41** | **Filho não-governado por porta in-process** — o event bus do filho é instância própria; o gate/audit do pai **não** o escuta a menos que re-registrado; um 2º construtor de sessão-filha (fora da `task`) que alcance `createAgentSession` **público** sem re-fiar a gate = T30 com o mesmo formato, mas silencioso e no mesmo processo | E, T, R | Média | **Crítico** | **P1** | T30 (SF1/SF3) |
| **T42** | **Transcrito-evidência não-redigido** — o `SessionManager` disco-backed do filho é um **escritor de sessão novo**; se a redação-at-rest não estiver no seam de escrita compartilhado, o arquivo de sessão do filho (que R14 devolve ao pai como evidência **por referência**) persiste em claro o segredo que o filho leu | I, R | Média | **Alto** | **P1** | T21 (SF5) |
| **T40** | **Budget: janela reserve→settle sob concorrência** — a atomicidade depende de `reserve` debitar o estimate **no reserve-time** e de o estimate ser **teto-superior**; um `reserve` que difere o débito ao `settle`, ou um estimate que subestima, deixa `remaining()` superestimado durante o `await` do modelo, e N raias concorrentes (o Pi roda até 4) sobre-comprometem | E, D | Baixa | **Alto** | **P2** | T33b (SF4) |

---

### T41 — Filho não-governado pela porta in-process (event bus próprio) — P1, T30 por porta nova
**STRIDE:** Elevation + Tampering + Repudiation · **Elemento:** SF1/SF3 · **Loop-back R13/T30.**

**A porta nova.** `pi.on("tool_call")` registra um handler no **emitter de uma sessão
específica**. A sessão-filha criada por `createAgentSession` (`sdk.ts:169`) tem seu
**próprio** emitter. Logo o handler da Permission Gate do **pai**, registrado no emitter
do **pai**, **não vê** as tool calls do filho — mesma consequência de T30 (filho fora da
gate), mas por um mecanismo **diferente** do que o §0 modelou: não é "outro processo sem
a extensão carregada", é "**mesmo processo, event bus próprio, extensão não re-registrada
no emitter do filho**". A `task` fecha isso construindo o `resourceLoader` do filho com o
**mesmo** `createPermissionGateExtension(...)` fiado às **mesmas** referências
(`EffectivePolicy`/`AuditTrailWriter`/`workspaceRoot`/protected-paths/`--yes`) — o
emitter próprio do filho ganha **seu próprio** handler ligado ao **mesmo** estado
compartilhado (ADR §2). **A ameaça residual** é a que o prompt do Gate 4 nomeia: um
**caminho de spawn alternativo** — um segundo call-site que alcance `createAgentSession`
(que é **SDK público** do Pi, não um construtor privado) para uma filha **sem** essa
fiação. O filho roda in-process, com autoridade total do processo, e **nenhuma** de suas
tool calls é classificada/aprovada/auditada — e, pior que em processo separado, **não
deixa nem o rastro de um `child_process.spawn`** no log do pai. Prob **Média** (exige um
2º construtor; mas `createAgentSession` ser público torna isso um `import` de distância);
Impacto **Crítico** (desarma a Fase 2 inteira dentro da delegação, silenciosamente).

**Mitigação — o ADR já a prevê; esta reconciliação a torna vinculante por construção, não
por disciplina.** O ADR §2.2 (precondição sole-constructor) + R5 (2º construtor reabre
T30) + o canário R13 rebaixado (§8) são a **direção certa**. Precisões que o Gate 5/6
DEVE travar para que T41 valha **por construção**, não por convenção:
1. **Referências da gate = parâmetros OBRIGATÓRIOS do único construtor de filha
   governada.** O `SharedBudget` já faz isto (param obrigatório → R16b por construção,
   ADR §5.2); **estender a mesma disciplina à gate**: o wrapper de spawn recebe
   `EffectivePolicy`/`AuditTrailWriter`/`workspaceRoot`/protected-paths/`--yes` como
   params **não-opcionais**, de modo que "esqueci de fiar" seja **erro de compilação**,
   não fail-open em runtime. "Fail-closed-if-unwireable" (GAP-3A) só é real se a
   ausência de referência **não compilar** — não se for um `if (policy) …` esquecível.
2. **Lint/teste sole-constructor:** nenhum call-site além desse wrapper chama
   `createAgentSession` para uma filha (o teste (c) do §13 do ADR). É o enforcement
   mecânico do §2.2 — sem ele, a precondição é prosa.
3. **Residual declarado (novo, honesto):** uma **extensão de terceiro** carregada no
   mesmo processo (já dentro do domínio de confiança — sem sandbox, fato dominante §0)
   pode chamar `createAgentSession` cru, **fora do alcance** do nosso teste. In-process
   **aumenta o número de principais** que alcançam a fábrica crua (antes era um binário;
   agora é qualquer código in-process). Dobra no residual sem-sandbox herdado, mas
   **nomeado** porque a decisão in-process o agrava — o canário R13 cobre o **nosso**
   código através de um upgrade do Pi, **não** um terceiro.
*Grounding:* **Secure and Reliable Systems Design §3.13** ("expose narrow purpose-built
APIs instead of ambient root … route privileged access through an audit trail" — top
**0.633**; o wrapper estreito é a API purpose-built, `createAgentSession` cru é o ambient
root), **§3.4** ("the safe proxy … direct connections defeat the proxy" — top 0.609; o
2º construtor **é** a conexão direta que derrota o proxy), **§3.12** ("the reachable
authority has never been enumerated" — top 0.628; um call-site esquecido a
`createAgentSession` **é** autoridade alcançável não-enumerada). Cross-ref **Penetration
Testing §13.12** (herdado de T29: "every new route is a fresh chance to omit" —
guaranteed-by-construction). **Veredito: confirmado — a arquitetura resolve**, condicional
às precisões 1–2 viverem como restrição-de-tipo + teste no Gate 5/6; residual de terceiro
declarado.

### T42 — Transcrito-evidência não-redigido (escritor de sessão novo) — P1, T21 por porta nova
**STRIDE:** Information disclosure + Repudiation · **Elemento:** SF5 · **Loop-back R14 ∩ R12/R18/T21.**

**A porta nova.** R14 exige que a evidência devolvida ao pai seja
**derivada-do-runtime**: `details.transcript = {sessionId, filePath}` — uma **referência**
ao arquivo de sessão que o runtime escreveu, **não** texto inlinado (ADR §6). Para que
esse arquivo exista e seja durável, o filho usa um `SessionManager` **novo,
disco-backed** (correção do ADR §6: `inMemory()` derrubaria R14). Mas — por T21/T29 — uma
session JSONL **captura o I/O de tool**, e um `read` de `.env`/config que o filho faça
grava a **credencial** nesse arquivo. Portanto o arquivo que R14 entrega ao revisor
**pode conter o segredo que o filho tocou**. A pergunta do Gate 4 é exatamente: esse
transcrito **precisa de um 7º sink** de redação, ou já passa por um existente?

**Resposta — não precisa de 7º sink, SE E SÓ SE a redação-at-rest estiver no seam
compartilhado de escrita do `SessionManager`.** É a bifurcação que decide se T42 está
fechada ou reaberta:
- **Redação no primitivo de escrita do `SessionManager`** (código compartilhado por
  **toda** instância) → o `SessionManager` novo do filho **herda a redação por
  construção**; o transcrito-evidência já está redigido em disco; um `read` dele vaza
  conteúdo não-sensível, não credencial (exatamente R12/T29). **T42 fechada.**
- **Redação na fiação parent-específica** (só o wiring de persistência do pai chama
  `redact()` antes de escrever) → o `SessionManager` **separado** do filho escreve
  **cru**. O arquivo de sessão do filho é um **7º sink não-redigido**, e R14 o entrega ao
  pai como "evidência" — **T21 reaberto**: um sink esquecido porque **um escritor novo
  apareceu**. In-process torna isto **dinâmico**: há agora **N** escritores de sessão
  (pai + um por filho), cada filho "a fresh chance to omit" o sink.

O ADR **acerta a direção** (§13 fronteira 3, R6: "reusa o sink R12/R18; não escreve
cru"), mas trata como afirmação; esta reconciliação a torna **verificável**. Precisões
vinculantes ao Gate 5/6:
1. **Verificar no código do Pi ONDE a redação-at-rest é aplicada.** Se no primitivo de
   escrita do `SessionManager` → herança por construção (preferido). Se na fiação
   parent-específica → **rotear explicitamente** o `SessionManager` do filho pelo mesmo
   sink, senão o transcrito-evidência vaza.
2. **Regra vinculante:** redação-at-rest é propriedade do **primitivo de escrita do
   `SessionManager`**, aplicada a **toda instância** por construção — não um bolt-on
   por-wiring. É a única forma de a contagem-de-sinks dinâmica (N filhos) não virar N
   chances de esquecer.
3. **O payload `details` em si não carrega segredo cru** — `transcript` é **referência**
   (filePath), `filesTouched` vem do `AuditTrailWriter` (já redigido at-rest),
   `tokenCost` é numérico, `merge.diffPath` é caminho. **Confirmar por teste** que
   **nenhum** caminho inlina o **texto cru** do transcrito do filho no `content`/sessão/
   audit do pai.
4. **Residual declarado (reforçado, não novo):** o `content` (prosa do modelo-filho, o
   único canal auto-reportado) pode **ecoar** um segredo que o filho leu, e alcança o
   **contexto vivo** do pai — a redação-**at-rest** protege o **arquivo**, não a janela
   viva. É o residual herdado T5/T7 (canal do modelo não-gated), agora com um principal a
   mais alcançando o segredo. Fora de escopo desta fase, **declarado**.

**Teste a derivar no Gate 5/6:** um filho que lê um segredo produz um arquivo
transcrito-evidência **redigido** — o revisor que abre `details.transcript.filePath` vê o
placeholder de redação, nunca a credencial. É o gêmeo do teste de evidência-não-forjável
de R14.
*Grounding:* **Penetration Testing §20.12** ("a secret can leave the repository … each of
those routes **around every application control** … no amount of web testing sees it" —
top **0.625**; o sink esquecido é a rota que contorna a redação), **§14.2** (secrets/
supply-chain: segredo não pode persistir onde outro leitor o obtém); **Secure Code Review
§2.12** (herdado de R14: "a completed trace is evidence about that question and about
nothing else" — a evidência é o **observado**, e o observado não pode ser a credencial em
claro); **OWASP ASVS V6.4** (herdado de T21/T29: segredo não persistido em claro).
**Veredito: confirmado — a arquitetura resolve sem 7º sink, condicional** à verificação
(1) de que a redação vive no seam compartilhado; se viver na fiação do pai, é **ajuste
obrigatório** (rotear o `SessionManager` do filho pelo sink) antes do Gate 6.

### T40 — Budget: janela reserve→settle sob concorrência de event-loop — P2, T33b por porta nova
**STRIDE:** Elevation + DoS · **Elemento:** SF4 · **Loop-back R16b/T33b.**

**A porta nova.** In-process **troca** a corrida entre processos de SO (T33b, sem contador
compartilhado) por uma corrida de **dados in-memory** sobre o objeto `SharedBudget`. O
prompt do Gate 4 aponta o cenário exato: **e se uma chamada assíncrona (o streaming do
modelo) acontecer ENTRE `reserve` e `settle`, abrindo uma janela onde outro subagente
reserva sobre um saldo desatualizado?** É corrida real em JS (single-threaded, mas com
microtasks/I/O intercalado), não hipotética.

**Análise — o cenário específico está fechado por construção, mas por uma razão precisa
que o ADR deve tornar vinculante.** A janela reserve→settle **só é stale se o débito for
diferido ao `settle`**. O design do ADR §5.2 é `reserve(estimate)` = **check-E-reserve
numa única chamada síncrona**, que **debita `remaining` pelo estimate no reserve-time**
(reserva otimista); `settle(reservation, actual)` **reconcilia** o estimate já debitado
com o uso real **depois**. Consequência: durante o `await` do modelo entre `reserve` e
`settle`, `remaining()` **já reflete** a reserva — um segundo subagente que reserva nessa
janela lê o saldo **já debitado**, **não** stale. A janela que o prompt descreve é
**fechada precisamente porque `reserve` debita na hora**, não porque `reserve`/`settle`
sejam adjacentes no tempo. Duas condições sustentam isso, e ambas têm de ser **codificadas
no contrato**, não deixadas à disciplina:
1. **`reserve` DEBITA no reserve-time** (reserva otimista), nunca "registra intenção e
   debita só no `settle`". O ADR diz "check-E-reserve" — o que **implica** débito-no-
   reserve —, mas isto tem de ser **explícito e testado**: um refactor que torne `reserve`
   um mero check e mova o débito ao `settle` **reabre** exatamente a janela stale que o
   prompt descreve.
2. **Zero `await`/Promise no corpo de `reserve` e de `settle`** (ADR §5.3, condição (i)) +
   **sem `check()` avulso** (condição (ii)) — o read-then-write do contador tem de ser um
   corpo síncrono run-to-completion. É o residual R3 do ADR, **confirmado** e promovido a
   **lint + teste** no Gate 5/6.

**O ajuste que esta reconciliação faz ao ADR (não é só confirmação):** o ADR §5.3 afirma o
bound "não excede o teto por mais que **uma requisição em voo**" (spec §7.6). Esse bound é
verdadeiro **apenas se o estimate for teto-superior** do custo real (reserve
sobre-reserva, settle credita de volta). Se o estimate **subestima** — plausível, porque o
custo em tokens de uma resposta **streamed** não é conhecido até completar —, então durante
o `await` o filho gasta **mais** que o reservado, `remaining()` **superestima** o saldo
por `(actual − estimate)`, e com N raias concorrentes (o Pi roda até 4) o sobre-comprometi-
mento é até **N × (actual − estimate)**, **não** "uma em voo". O `settle` corrige **depois**
(impede acúmulo entre turnos **sequenciais**), mas o over-commit **concorrente dentro da
janela já ocorreu**. Logo, para o bound de "uma em voo" valer, o Gate 5/6 DEVE **uma** das
duas: (a) exigir que o estimate seja **teto-superior** (conservador); **ou** (b) adicionar
uma **checagem-de-teto fail-closed no `settle`** — se o custo real cruzar o teto, é a
**parada graciosa** (R16a, `Result.error`), pegando o último turno mesmo que seu estimate
fosse baixo. Prob **Baixa** (exige estimate subestimado **e** concorrência **e** saldo
perto do teto); Impacto **Alto** (o único backstop econômico da árvore vaza por N×delta).

**Mitigação:** **R16b reafirmado** + as três precisões acima (débito-no-reserve; síncrono/
sem-check-avulso; bound restated com teto-superior **ou** ceiling-check no settle).
*Grounding:* a biblioteca **não cobre** contabilidade de budget de token nem atomicidade
de event-loop (consulta desta sessão **top 0.560**, genérica — mesma lacuna já declarada
em T33b e no ADR §5.3). Ancorado, honestamente: **Secure and Reliable Systems Design
§1.12** ("the failure direction is forced … an authorization check must fail closed" —
top 0.554; o budget é uma checagem de autorização de gasto, o débito diferido/subestimado
falha na direção errada), **Secure Code Review §1.2** ("hunting the assumptions the
developer made that an attacker can violate" — top 0.551; as **assumções** aqui são
"`reserve`/`settle` permanecem síncronos" e "o estimate é teto-superior"), **Threat
Modeling §3.5** (STRIDE-per-element, forma). Fundamentado no invariante #14 do plano +
comportamento de `spent_so_far` do `conductor-main`, **não forçado**. **Veredito:
confirmado — a arquitetura resolve o cenário do prompt (a janela não é stale porque
`reserve` debita na hora)**, com **um ajuste ao bound declarado**: "uma em voo" só vale
com estimate teto-superior; senão, ceiling-check no `settle`.

---

### 9.1 Veredito consolidado sobre a arquitetura do Gate 4

**A arquitetura do Gate 4 está OK — avança para o Gate 5.** Nenhuma das três fronteiras
reabre um P1 como finding **não-mitigado**: as três já eram **antecipadas** pelo ADR
(riscos R3/R5/R6, fronteiras §13.1/2/3) e são **fechadas pelos próprios primitivos** da
decisão in-process (reserve-debita-na-hora; sole-constructor; sink de escrita
compartilhado do `SessionManager`). O que a reconciliação **acrescenta** são **três
precisões vinculantes** — restrições-de-design + testes a carregar ao Gate 5/6, **não**
re-arquitetura, **não** bloqueio:

- **T41 → confirmado, resolve por construção** *se* as referências da gate forem
  **params obrigatórios** do único wrapper de spawn (erro de compilação na omissão —
  estender a disciplina que o `SharedBudget` já aplica) **e** um teste sole-constructor
  proibir qualquer outro call-site de `createAgentSession`. Residual de terceiro
  in-process declarado.
- **T42 → confirmado, resolve sem 7º sink** *condicional* a **verificar** que a
  redação-at-rest vive no **primitivo de escrita compartilhado** do `SessionManager` (toda
  filha herda). Se viver na fiação parent-específica → **ajuste obrigatório**: rotear o
  `SessionManager` do filho pelo mesmo sink antes do Gate 6.
- **T40 → confirmado, resolve o cenário do prompt** (a janela reserve→settle não é stale
  porque `reserve` debita no reserve-time), com **um ajuste ao claim**: o bound "uma
  requisição em voo" só vale com **estimate teto-superior**; senão, **ceiling-check
  fail-closed no `settle`**. Débito-no-reserve e "zero await + sem check() avulso" viram
  lint+teste (residual R3 do ADR promovido).

**Nada exige revisitar a decisão central (in-process).** Ao contrário: as três fronteiras
são **consequência** da decisão certa (in-process fecha T30 por referência), e cada uma se
fecha reusando um primitivo que a própria decisão já introduziu. **O ônus é de codificação
e teste, não de design.**

### 9.2 Secure defaults acrescentados (append aos itens 1–30)

31. **Único construtor de filha governada com referências da gate como params
    obrigatórios** (erro de compilação na omissão, não fail-open em runtime) + teste
    sole-constructor proibindo outro call-site de `createAgentSession` (R13/T41).
32. **Redação-at-rest no primitivo de escrita do `SessionManager`**, herdada por toda
    instância-filha por construção; transcrito-evidência nunca escrito cru (R14∩R12/T42).
33. **`reserve` debita no reserve-time + bound de não-ultrapassagem só com estimate
    teto-superior, senão ceiling-check fail-closed no `settle`**; "zero await em
    reserve/settle, sem check() avulso" como lint+teste (R16b/T40).

### 9.3 Costuras adicionais que o Gate 5 DEVE travar (test-first) — append ao §7 e ao ADR §13

- **(f) Teste da porta in-process de T41:** um subagente construído por qualquer
  call-site que **não** seja o wrapper governado é rejeitado (sole-constructor); e uma
  tool destrutiva dentro do subagente construído pela `task` é negada/classificada
  idêntico a fora (o canário R13, já em (a) — reforçado aqui pela porta do event bus
  próprio).
- **(g) Teste de redação do transcrito-evidência (T42):** um filho que lê um arquivo com
  credencial produz um `details.transcript.filePath` cujo conteúdo em disco está
  **redigido** — o revisor nunca lê o segredo.
- **(h) Teste do bound do budget sob subestimativa (T40):** N subagentes concorrentes com
  estimate **abaixo** do custo real não ultrapassam o teto além do tolerado — provando o
  ceiling-check no `settle` (ou a exigência de estimate teto-superior). Estende o teste de
  atomicidade já em (d).

### 9.4 Grounding desta reconciliação (consultas desta sessão)

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>"
--gate 3` (backend saudável, 2267 chunks). Postura honesta mantida: **forte** nos eixos
choke-point/least-privilege/fail-direction e secret-at-rest/route-around-controls;
**fraco/ausente** no eixo **agente-nativo** de contabilidade de budget de token sob
concorrência de event-loop — declarado, não forçado.

1. **Único chokepoint / narrow purpose-built API / o 2º caminho derrota o proxy** (T41) →
   **Secure and Reliable Systems Design §3.13** (top **0.633**, "narrow purpose-built APIs
   instead of ambient root; route privileged access through an audit trail"), **§3.4**
   (0.609, "the safe proxy … direct connections defeat the proxy"), **§3.12** (0.628,
   "the reachable authority has never been enumerated"). Cross-ref **Penetration Testing
   §13.12** (herdado, "every new route is a fresh chance to omit").
2. **Segredo não persiste em claro / a rota que contorna todo controle** (T42) →
   **Penetration Testing §20.12** (top **0.625**, "a secret can leave the repository …
   routes around every application control"), **§14.2** (secrets/supply-chain); **Secure
   Code Review §2.12** (herdado de R14, trace = evidência do observado); **OWASP ASVS
   V6.4** (herdado de T21/T29).
3. **Direção de falha forçada / assumção que o atacante viola** (T40) → **Secure and
   Reliable Systems Design §1.12** (top 0.554, "the failure direction is forced … must
   fail closed"), **Secure Code Review §1.2** (0.551, "the assumptions the developer made
   that an attacker can violate"), **Threat Modeling §3.5** (STRIDE-per-element).
   **Contabilidade de budget de token sob concorrência: ausente** (top 0.560) —
   declarado; ancorado no invariante #14 do plano + `spent_so_far`.

**Fecho da reconciliação Gate 3 ↔ Gate 4.** As três fronteiras que o ADR 0004 §13
reportou de volta estão modeladas (T40/T41/T42), com veredito **confirmado — a arquitetura
resolve** para as três, condicionadas a três precisões de **codificação/verificação**
(não re-arquitetura) que o Gate 5/6 trava como test-first (§9.3 (f)(g)(h) + secure
defaults 31–33). **Sem finding crítico/alto não-mitigado em aberto.** Liberado para o
Gate 5 (test-first).
