# Gate 1 — Descoberta de domínio: Conductor Coding Agent sobre o runtime Pi

**Demanda:** reconstrução do Conductor Coding Agent usando o projeto open source
**Pi** (github.com/earendil-works/pi) como fundação técnica de runtime.

**Fonte primária:** `plano_desenvolvimento.md` (raiz de `conductor`) — tratado
como PRD aprovado. Este documento não redriva esse plano; ele o encaixa no
protocolo de Gate 1 do Conductor (problema, hipótese, atores, regras de
negócio, glossário, critérios de saída) e explicita uma restrição de produto
que o PRD não deixa suficientemente explícita.

**Status:** rascunho para checkpoint do usuário. Não iniciar Gate 2
(especificação) antes da aprovação deste Gate 1.

---

## 1. Problema e hipótese

### 1.1 Problema real (separado da solução)

O Conductor atual funciona como uma **camada de governança e metodologia**
(14 gates, papéis, skills, memória local, política de segurança) que opera de
duas formas simultâneas:

1. como **harness nativo** — um CLI Python (`conductor`/`cdt`) que roda um
   loop de agente próprio;
2. como **emissor (emitter)** — faz *scaffold* de `.claude/agents/`,
   `.claude/skills/` e `CLAUDE.md` (ou equivalentes) dentro de projetos de
   terceiros, para que harnesses de terceiros (Claude Code, Codex, Cursor)
   sigam o mesmo fluxo de 14 gates. O próprio arquivo `CLAUDE.md` do projeto
   `conductor` é um artefato dessa emissão — prova viva de que o modo (2) já
   funciona hoje.

O loop de agente Python do modo (1) é um componente que o próprio PRD
(seção 11.2) já assume que "provavelmente deverá ser substituído": TUI,
sessão, tool dispatch, event stream e parte da compactação são artefatos
caseiros que competem com um projeto de runtime maduro, com SDK, RPC, modo
subagente e sistema de extensões — funcionalidades que o Conductor não
justifica reconstruir do zero para um produto cuja proposta de valor está na
**governança**, não no loop de tool-calling em si.

**Problema de negócio:** manter e evoluir um runtime de agente próprio
(loop, sessões, streaming, tool dispatch, TUI) consome esforço de engenharia
que não diferencia o Conductor — esse esforço deveria ir para gates, papéis,
skills, memória e política, que são a proposta de valor real. Ao mesmo tempo,
qualquer novo runtime nativo não pode reduzir a capacidade atual do Conductor
de governar harnesses de terceiros, porque essa capacidade já está em uso e é
um ativo de produto validado (evidenciado pelo próprio funcionamento deste
projeto).

### 1.2 Por que não manter o loop Python atual

`cdt library` (ver §6, citação Outside-In Development, item 1.12) observa que
uma prova de arquitetura por *walking skeleton* "não prova nada" quando "a
arquitetura e o caminho de deploy já existem" — rodar um esqueleto sobre algo
que já roda apenas atrasa a fatia real. Isso é exatamente o argumento a favor
de **não** reconstruir o loop Python: ele já existe, já roda, e qualquer
tempo gasto reforçando-o não valida nada nem sobre o loop nem sobre a tese do
Pi. O argumento inverso é o que justifica a Fase 0 do PRD: o *caminho de
integração* Conductor↔Pi é o que ainda não existe e ainda não está provado —
por isso, ali sim, um esqueleto andante é o instrumento certo (ver §6).

### 1.3 Por que não construir um runtime do zero

Construir um novo loop de agente, sessões, tool-calling e TUI do zero
repetiria o mesmo erro em nova linguagem: gastar orçamento de engenharia em
infraestrutura genérica (não diferenciadora) em vez de na governança
(diferenciadora). O PRD (seção 3.1-3.2) já registra essa análise e recomenda
**composição antes de fork** sobre o Pi. Este Gate 1 aceita essa análise como
ponto de partida, mas nota que ela é, formalmente, uma decisão arquitetural
"difícil de reverter e que molda um atributo de qualidade" — exatamente o
critério que a literatura de arquitetura usa para dizer quando vale o custo
de deliberação de um ADR (ver §6, citação The Practice of Architecting /
Software Architecture and Quality Attributes). Isso significa: **este Gate 1
não é o lugar para fechar a decisão** — ele apenas confirma que o problema e
a direção de investigação estão bem colocados; a decisão formal (ADR de
adoção do Pi, já previsto no PRD §8 Fase 0) pertence ao Gate 4, depois de a
Fase 0 (prova de conceito) gerar evidência.

### 1.4 Hipótese testável

> **H1:** Se o Conductor adotar o Pi como fundação de runtime via composição
> (extensions, custom tools, packages, SDK — não fork), então o esforço de
> engenharia gasto em infraestrutura de agente (loop, sessões, streaming,
> tool dispatch) cai, **sem perda de nenhuma capacidade de governança hoje
> existente** — incluindo a capacidade de emitir para harnesses de terceiros.
>
> **Como falsear H1 (Fase 0, PRD §8):** o protótipo mínimo deve (a) abrir uma
> sessão, chamar um modelo, ler/editar arquivo com aprovação, rodar testes,
> persistir e retomar sessão sobre o Pi; e (b) não introduzir nenhuma
> limitação estrutural que impeça policy fail-closed, delegação a
> subagentes com contexto isolado, ou captura de evidência por gate. Se (b)
> falhar — i.e., se o Pi exigir fork extenso para suportar essas
> propriedades — H1 é refutada e a análise de build-vs-adopt deve ser
> reaberta no Gate 4 com uma alternativa (ex.: outro runtime, ou runtime
> próprio mínimo).
>
> **H2 (não-negociável de produto, ver §3):** a existência de um runtime
> nativo Pi não substitui a capacidade de emissão para outros harnesses; as
> duas capacidades coexistem no mesmo produto. Esta hipótese não é validada
> por protótipo técnico — é uma restrição de escopo que este Gate 1 fixa
> antes de qualquer especificação, para que nenhuma fase do roadmap (Fase 0
> a 11) a erode por omissão.

### 1.5 Risco de viés a evitar

Ao formular as perguntas de discovery da Fase 0 ("o Pi suporta X?"), evitar
perguntas que só podem confirmar a tese já escrita no PRD (viés de
confirmação — o equivalente, em contexto de decisão técnica interna, do que
*The Mom Test* descreve para entrevistas de cliente: não perguntar "o Pi é
bom o suficiente?", e sim "o que o Pi **não** suporta, e o que isso custaria
para contornar?"). A matriz Pi×Conductor (PRD §17.1) deve registrar
explicitamente os pontos onde o Pi **não** atende, não apenas onde atende.

---

## 2. Atores primários

| Ator | Papel no sistema | Observação |
|---|---|---|
| **Desenvolvedor solo (interativo)** | Roda `conductor`/`cdt` diretamente sobre o runtime Pi nativo; acompanha e aprova decisões gate a gate. | Modo "interactive" do PRD §4.8. |
| **Desenvolvedor usando harness de terceiro** | Trabalha em Claude Code, Codex, Cursor etc., com o Conductor **emitido** para dentro do projeto (`.claude/agents`, `.claude/skills`, `CLAUDE.md` ou equivalente do harness). Não interage com o runtime Pi diretamente. | Este é o modo em que a presente sessão de discovery está rodando agora. Não pode ser degradado pela adoção do Pi. |
| **Executor autônomo/agendado** | Roda `conductor auto` ou `cdt-triage` sem checkpoint por gate; aprova automaticamente decisões de baixo risco; para em sign-offs; grava `needs-human`. | Modo "autonomous" do PRD §4.8 / §8 Fase 8. |
| **Subagente/papel invocado pelo orquestrador** | Recebe contexto mínimo e isolado, ferramentas permitidas, orçamento próprio; produz evidência, não apenas declaração de sucesso. | PRD §4.5. Vale tanto rodando nativo sobre Pi quanto como subagent Task de um harness de terceiro. |
| **Pipeline de CI** | Consome `conductor --plain --json "execute o Gate 7"` ou equivalente headless; não há humano no loop de aprovação em tempo real. | PRD §4.8 (Headless/CI) — relevante para o Gate 7 do próprio fluxo de 14 gates. |
| **Operador de política/segurança (CISO/security-engineer)** | Não citado no PRD como "ator" de runtime, mas é quem autoriza exceções fail-closed (pentest, egress, fallback de provedor). Incluído aqui porque §3.3-3.4 do PRD dependem de alguém com autoridade para *conceder* uma política, não apenas negá-la por padrão. | Ator de governança, não de execução de tarefa. |

Nota de calibração: este é um projeto de infraestrutura técnica (dev tool),
não um produto de consumo — não há necessidade de personas elaboradas com
biografia; os atores acima são papéis funcionais o suficiente para orientar
casos de uso e regras de acesso/permissão.

---

## 3. Restrição de produto não-negociável (explicitada neste Gate 1)

**"Runtime nativo Pi" e "governa outros harnesses via emissão" são duas
capacidades que coexistem — a segunda não é substituída pela primeira.**

Evidência de que a capacidade de emissão já existe e está em uso: o arquivo
`C:\development\source\projects\conductor\CLAUDE.md` deste mesmo projeto é
um artefato gerado por essa emissão (roles em `.claude/agents/`, skills em
`.claude/skills/`, regras não-negociáveis, protocolo de gate, tudo escrito
para ser consumido por Claude Code). O PRD, ao descrever a arquitetura
proposta (§5) e o roadmap (§8), foca inteiramente na pilha nativa
Pi-runtime → Conductor-orchestration → CLI, e não modela explicitamente onde
o "modo emissor" se encaixa nessa pilha.

Isso é uma lacuna de especificação, não uma decisão de descontinuar o modo
emissor — mas se não for escrita agora, no Gate 1, o risco é que as Fases 1-11
do roadmap (PRD §8) tratem implicitamente "Conductor Coding Agent" como
sinônimo de "harness nativo sobre Pi" e o conteúdo reaproveitável de emissão
(`content/roles`, `content/skills`, `content/commands` — PRD §6) termine
sendo escrito apenas no formato nativo do Pi, sem uma camada de projeção para
os formatos de terceiros (`.claude/`, `AGENTS.md` do Codex, regras do
Cursor, etc.).

**Consequência para o escopo (a ser detalhada no Gate 2):**

- o mesmo conteúdo canônico de papéis/skills/gates (`content/` no PRD §6)
  deve ter **pelo menos dois alvos de renderização**: (a) formato nativo Pi
  (packages/extensions/skills do runtime), e (b) formato de emissão para
  harnesses de terceiros (o que hoje o Conductor Python já produz via
  scaffold);
- a Fase 3 do PRD ("Papéis, skills e subagentes") e a Fase 11
  ("Hardening e release", que inclui "migração do Conductor anterior") são os
  pontos onde essa dualidade precisa de critério de saída explícito — hoje o
  PRD não lista "emissão para harness de terceiro continua funcionando" como
  critério de saída de nenhuma fase;
- fora de escopo deste Gate 1 (a decidir no Gate 2/4): se o emissor
  permanece implementado em Python (como hoje) rodando ao lado do novo core
  TypeScript/Pi, ou se é reescrito para consumir o mesmo `content/` canônico
  do novo monorepo. Ambas são compatíveis com a restrição acima; a escolha é
  arquitetural, não de descoberta.

---

## 4. Regras de negócio / restrições não-negociáveis herdadas

Extraídas do `CLAUDE.md` atual ("Non-negotiable rules") e do PRD §3.3–3.6,
tratadas como requisitos de domínio que a nova implementação deve preservar
literalmente, não como boas intenções:

1. **Segurança fail-closed** (PRD §3.3) — qualquer operação sem política
   explícita é negada por padrão. Isso é uma regra de domínio, não um detalhe
   de implementação: afeta o modelo de `ToolPolicy` (PRD §4.2) e a máquina de
   estados de gates (nenhuma transição sem evidência).
2. **Evidência antes de conclusão** (PRD §3.4) — um gate não fecha com base
   em resposta textual do modelo; precisa de artefato verificável (arquivo,
   teste executado, log, aprovação humana registrada).
3. **Memória local-first com separação Library/Diary** (PRD §3.5) —
   `Library` é conhecimento estático (livros, padrões) consultado via RAG;
   `Diary` é conhecimento dinâmico do projeto (decisões, erros, soluções).
   Essa distinção é ubíqua no vocabulário do Conductor atual e não pode
   colapsar em uma única "memória" genérica no novo runtime.
4. **Núcleo pequeno, progressive disclosure** (PRD §3.6) — o system prompt
   não carrega todos os papéis/skills; carrega catálogo resumido e expande
   sob demanda. Isso é regra de domínio porque afeta diretamente o
   orçamento de contexto por gate, não é só otimização de custo.
5. **Gates nunca silenciosamente pulados** — override existe
   (`[skip-ground]`) mas é sempre registrado como risco aceito no diário,
   nunca implícito.
6. **Composição antes de fork** (PRD §3.2, §7.6) — mudança no Pi upstream só
   depois de esgotar extension/tool/package; fork é exceção documentada com
   caminho de remoção.
7. **Dual-harness (esta descoberta, §3 acima)** — capacidade de emissão para
   harnesses de terceiros não é removida nem degradada pela adoção do
   runtime nativo Pi.

Essas sete regras formam a base do que o Gate 2 (especificação) deve
transformar em critérios de aceite testáveis — nenhuma delas é, hoje,
verificável automaticamente; isso por si só é um gap a ser fechado por um
"invariant validator" (PRD §10), já citado no PRD como prática herdada do
Conductor atual.

---

## 5. Glossário (linguagem ubíqua)

| Termo | Definição no domínio deste projeto |
|---|---|
| **Pi** | Runtime de agente open source (earendil-works/pi) que fornece loop de tool-calling, sessões, TUI, SDK, RPC e sistema de extensões. Fundação técnica, não o produto final. |
| **Conductor** | Camada de governança e metodologia: 14 gates, papéis, skills, memória, política de segurança. O produto/marca. |
| **Harness** | Qualquer ambiente de execução de agente capaz de rodar o Conductor — nativo (Pi) ou de terceiro (Claude Code, Codex, Cursor). |
| **Emissor / Emissão (emitter)** | Mecanismo pelo qual o Conductor projeta seu conteúdo canônico (roles, skills, gates, regras) para as convenções nativas de um harness de terceiro (ex.: `.claude/agents/`, `CLAUDE.md`). |
| **Runtime nativo** | O harness Pi rodando o Conductor diretamente, sem camada de emissão — o próprio CLI `conductor`/`cdt`. |
| **Role (Papel)** | Persona especializada com prompt próprio, skills, ferramentas, model role e lista de para quem pode delegar (`canSpawn`). |
| **Skill** | Procedimento carregável sob demanda que instrui um papel a executar uma tarefa específica dentro de um gate. |
| **Gate** | Etapa da máquina de estados de 14 etapas do fluxo de desenvolvimento; possui papéis responsáveis, critério de saída e protocolo obrigatório (recall → grounding → delegação → registro → checkpoint). |
| **Demand (Demanda)** | Unidade de trabalho que percorre os gates (equivalente a uma feature/bug/tarefa); possui branch própria em gitflow. |
| **Diary (Diário)** | Memória dinâmica do projeto — decisões, erros, soluções, riscos, aprovações — persistida localmente antes de qualquer sync remoto. |
| **Library (Biblioteca)** | Corpus estático de conhecimento (livros de referência) consultado via RAG (`cdt library`), com citação obrigatória. |
| **Model role** | Categoria de exigência de modelo por gate/papel (`strategic`, `standard`, `lightweight` no PRD; mapeado a `@plan`/`@slow`/`@default`/`@smol` no Conductor atual) — indireção que desacopla "força do modelo" de "papel". |
| **Extension** | Ponto de extensão do Pi usado para interceptar tool calls, aplicar política, capturar eventos — mecanismo preferido de composição antes de fork. |
| **Tool policy** | Declaração obrigatória por ferramenta (`permission`, `risk`, `requiresApproval`, `allowedRoots`, `timeout`, `redactOutput`) que sustenta a regra fail-closed. |
| **Subagente** | Agente filho invocado por `task`, com contexto isolado, orçamento próprio descontado de uma cota compartilhada, e obrigação de entregar evidência (não apenas declaração de sucesso). |
| **Session (Sessão)** | Árvore append-only de mensagens/tool-calls/checkpoints/branches; nunca perde histórico em undo; branching move apenas o ponteiro ativo. |
| **Checkpoint** | Marco explícito de estado recuperável dentro de uma sessão ou gate — usado tanto para retomada quanto para auditoria de evidência. |
| **Evidence (Evidência)** | Artefato verificável (arquivo, teste, log, aprovação) exigido para fechar um gate — nunca apenas texto do modelo. |
| **Sign-off** | Aprovação humana explícita e registrada, não fabricável por um agente, exigida em decisões críticas (ex.: aceitar risco residual). |
| **needs-human** | Estado de gate que interrompe execução autônoma e exige intervenção humana antes de prosseguir. |
| **Fail-closed** | Princípio: qualquer operação sem política explícita correspondente é negada por padrão. |
| **Composição antes de fork** | Princípio de integração: preferir extension/tool/package/SDK do Pi; fork é última opção, documentada e com plano de remoção. |
| **Progressive disclosure** | Estratégia de contexto: catálogo resumido primeiro, corpo completo de skill carregado só quando necessário. |
| **Tracer bullet / Walking skeleton** | Fatia vertical mínima, ponta-a-ponta, usada para provar que uma arquitetura de integração funciona antes de construir sobre ela — o instrumento da Fase 0 do PRD. Ver §6 para a ressalva sobre quando **não** usar. |
| **ADR (Architecture Decision Record)** | Registro formal e imutável de uma decisão arquitetural difícil de reverter — o formato em que a decisão de adotar o Pi deve ser fechada, no Gate 4, após a Fase 0 gerar evidência. |
| **Invariant validator** | Verificador executável de regras estruturais do sistema (ex.: grafo de delegação acíclico, toda ferramenta declara permissão) — mecanismo que transforma as regras de negócio da seção 4 em checagem automática. |

---

## 6. Grounding (biblioteca)

Consultas rodadas nesta sessão a partir de `C:\development\source\projects\conductor`
via `cdt library "<pergunta>" --gate 1`:

1. **Query (desta sessão):** *"Gate 1 domain discovery: how to identify actors
   and build a ubiquitous language glossary before writing a spec"*
   → **Domain-Driven Design — Complete Professional Guide**, seções 1.1
   ("Ubiquitous language... single, shared vocabulary... reflected literally
   in the code"), 1.4 ("Architecture: where the language lives") e 1.12
   ("When not to build a ubiquitous language" — só vale o esforço "quando uma
   palavra significa duas coisas e o código precisa escolher uma"). Usada
   para orientar o glossário da seção 5 e para justificar por que ele foi
   mantido enxuto (~24 termos, não uma enciclopédia): os termos incluídos são
   exatamente os que colidem entre o vocabulário do Pi (session, extension,
   tool) e o vocabulário do Conductor (gate, role, skill, diary) — onde a
   ambiguidade é real.

2. **Query (desta sessão):** *"how to validate a build-vs-adopt decision for a
   runtime foundation before committing (composition before fork, ADR for
   structural decisions)"*
   → **The Practice of Architecting — Complete Professional Guide**, 2.5
   ("Real example: ADRs" — decisão de adotar tecnologia externa registrada no
   momento da decisão, não meses depois) e **Software Architecture and
   Quality Attributes — Complete Professional Guide**, 1.12 ("When not to
   treat a decision as architectural" — deliberação formal (ADR) só se paga
   quando a decisão é **difícil de reverter** e **molda um atributo de
   qualidade**). Usada na seção 1.3 para justificar por que este Gate 1 não
   fecha a decisão de adotar o Pi — apenas confirma que ela cumpre os dois
   critérios acima e por isso deve virar ADR formal no Gate 4, depois da
   evidência da Fase 0.

3. **Query (desta sessão):** *"how to state a testable hypothesis for an
   internal infrastructure/build-vs-adopt decision, avoiding confirmation
   bias, before committing to a technical foundation"*
   → **Outside-In Development — Complete Professional Guide**, 1.9 ("Best
   practices: walking skeleton and double feedback loop" — "validate
   architecture and deployment with a skeleton before features") e 1.12
   ("When not to start with a walking skeleton" — não vale quando "a
   arquitetura e o caminho de deploy já existem"; rodar um esqueleto ali "não
   prova nada... só atrasa a fatia real"). Usada nas seções 1.2 e 1.4 para
   distinguir os dois casos: o loop Python atual já tem arquitetura e deploy
   provados (não precisa de esqueleto novo), enquanto a integração
   Conductor↔Pi ainda não tem — e por isso a Fase 0 do PRD, que já propõe
   exatamente esse esqueleto, está corretamente direcionada.

4. **Citação já obtida em consulta anterior nesta sessão** (reaproveitada,
   não re-executada): **Pragmatic Programming Practices** ("tracer bullets")
   — reforça o mesmo ponto do item 3 acima sobre a Fase 0 funcionar como fatia
   vertical de prova, disparando cedo através de todas as camadas
   (SDK → sessão → tool → aprovação → teste → persistência) em vez de
   construir camada por camada sem integração ponta-a-ponta.

**Nota de cobertura:** nenhuma consulta rodada tentou "Inspired" ou
"Continuous Discovery Habits" diretamente (livros citados no `CLAUDE.md` para
Gate 1) porque o corpus retornado pelo RAG deste projeto responde por
"Domain-Driven Design — Complete Professional Guide" e pelos guias de
arquitetura/engenharia acima — não foi encontrada, nas consultas rodadas,
nenhuma passagem atribuída a Cagan ou Torres para o ângulo específico
"actor discovery + hipótese de infraestrutura interna". Isso é reportado
explicitamente aqui em vez de forçar uma citação inexistente — se uma
consulta futura direcionada a esses livros trouxer algo mais específico, ela
deve ser adicionada nesta seção.

---

## 7. Critérios de saída deste Gate 1 (o que "pronto" significa aqui)

Este Gate 1 está completo — não o projeto inteiro — quando:

- [x] problema separado da solução, com hipótese testável e critério de
      falseabilidade (H1, §1.4);
- [x] restrição de produto não-negociável (dual-harness, §3) escrita
      explicitamente, com evidência de que a capacidade de emissão já existe
      hoje;
- [x] atores primários identificados por papel funcional (§2), sem
      personas desnecessárias para um projeto de infraestrutura;
- [x] regras de negócio/restrições herdadas listadas como requisitos de
      domínio, não como aspiração (§4);
- [x] glossário de linguagem ubíqua iniciado e enxuto, focado nos termos que
      colidem entre o vocabulário do Pi e o do Conductor (§5);
- [x] grounding na biblioteca com citações e uma lacuna de cobertura
      relatada explicitamente em vez de forçada (§6);
- [ ] **aprovação do usuário** (checkpoint obrigatório do protocolo de gate)
      — pendente até este documento ser revisado.

**Fora de escopo deste Gate 1** (fica para Gate 2 em diante):
critérios de aceite testáveis por fase do PRD; a ADR de adoção do Pi em si
(Gate 4, após Fase 0); o desenho de como o emissor Python atual e o novo core
TypeScript/Pi coexistem tecnicamente (Gate 4); modelagem de ameaças de
packages/extensions de terceiros do Pi (Gate 3 — já sinalizado como risco
crítico no PRD §14, "Extensões com acesso total ao sistema").
