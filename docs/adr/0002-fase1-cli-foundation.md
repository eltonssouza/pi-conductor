# ADR 0002 — Fase 1 (Fundação do produto): packages, `.conductor/`, resource loader e os quatro comandos

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-05
- **Gate:** 4 (Arquitetura, design defensivo e SLOs)
- **Demanda:** `Fase 1 — Fundação do produto` (`plano_desenvolvimento.md` §8), branch
  `feature/fase1-fundacao-do-produto` (de `develop`, que já contém a Fase 0 mergeada)
- **Autor (papel):** software-architect
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças a esta decisão criam um ADR sucessor, não editam este
  (The Practice of Architecting — Complete Professional Guide, §2.8). Este ADR **não edita** o ADR 0001 —
  ele o **aplica**: toda decisão aqui é derivada das seções 2.1–2.3 e dos adendos 0001-A/0001-B do ADR 0001,
  citados por número onde usados.
- **Insumo herdado:** ADR 0001 (`docs/adr/0001-adopt-pi-as-runtime.md`) já decidiu construir contra
  `Agent`/`AgentSession` (não `AgentHarness` v2), classificou as capacidades do MVP como compose/build/decline
  (matriz Fase 0), e deixou dois itens **explicitamente abertos para este ADR**: (A1) onde mora a camada de
  inteligência — já fechado no Adendo 0001-B, não reaberto aqui — e a fronteira fork-vs-workspace de §2.2, que
  §2 abaixo resolve para o escopo concreto da Fase 1.
- **Insumo concorrente (Gate 3 iterativo):** `docs/conductor/gate3-fase1-addendum.md` — o adendo de threat
  model da Fase 1 (ameaças T11–T16) — **aterrissou antes deste ADR** e deixou a reconciliação com ele
  explicitamente como follow-up (seu §6, último parágrafo), porque `docs/adr/0002-*` ainda não existia quando
  foi escrito. Este ADR fecha esse follow-up no §12, ponto a ponto, conforme o protocolo do projeto exige
  ("Gate 3 e Gate 4 são iterativos, não estritamente sequenciais" — CLAUDE.md, Gate 4).

---

## 1. Contexto

### 1.1 O que já está decidido e não é redecidido aqui

- **Superfície do Pi:** `Agent`/`AgentSession` + `SessionManager` JSONL, não `AgentHarness` v2 (ADR 0001 §2.1).
  **Reverificado nesta sessão** (não apenas herdado): `grep` em
  `packages/agent/src/harness/agent-harness.ts` confirma que os 13 métodos operacionais (`prompt`, `skill`,
  `promptFromTemplate`, `compact`, `navigateTree`, `resume`, `abort`, `steer`, `followUp`, `nextRun`,
  `cancelQueued`, `recordUsage`, `createLane`) **continuam** rejeitando com `HarnessNotImplemented`
  (linhas 371–464) — o número caiu de 17 (ADR 0001, momento da Fase 0) para 13 porque o upstream *reduziu* a
  superfície pública ainda-stub, não porque a implementou. A decisão do ADR 0001 §2.1 permanece válida sem
  ressalvas para a Fase 1.
- **Nenhuma capacidade do MVP é fork-worthy** (ADR 0001 §3) — Fase 1 não introduz nada que mude essa análise:
  os quatro comandos (`init`/`doctor`/`config`/`chat`) são compostos inteiramente sobre `createAgentSession`,
  `DefaultResourceLoader`, `pi.on("tool_call")` e `packages/tui` — todas APIs já catalogadas como suficientes.
- **`packages/conductor-poc` é código provado, não descartável** — `src/{session,permission-gate,
  workspace-policy,fail-closed,confirm}.ts` + `src/tools/conductor-note.ts` implementam exatamente o padrão
  que ADR 0001 §3 descreveu como não-fork-worthy, testado (Fase 0, Gate 8 validado). Este ADR decide sua
  promoção (§3.1), não sua reescrita.
- **A2 do Adendo 0001-B** — o emissor dual-harness continua Python (`conductor-main`), invocado via
  `packages/conductor-emit` quando esse pacote existir. **Não afetado por este ADR** — Fase 1 não emite nada
  para `.claude/`/`AGENTS.md`/Cursor (ver §5.1).

### 1.2 O que a Fase 1 precisa entregar (`plano_desenvolvimento.md` §8)

Quatro comandos (`conductor init|doctor|config|chat`) e um critério de saída: o agente funciona em um projeto
real com detecção de stack, workspace limitado, sessão persistente, prompt customizado, ferramentas básicas e
TUI inicial. Nenhuma menção a papéis, skills, gates, RAG, memória dinâmica, MCP ou model-routing — todos esses
são fases posteriores nomeadas explicitamente (§8 Fase 2–10), o que é o principal guardrail de escopo deste
ADR: **cada capacidade que este documento propõe adiar cita a fase do próprio plano que a reclama**, não uma
opinião solta.

### 1.3 Atributos de qualidade priorizados para esta decisão

Herdados de ADR 0001 §1.4, reordenados para o que a Fase 1 especificamente tensiona:

1. **Núcleo pequeno / proporcionalidade** (plano §3.6) — a decisão mais visível deste ADR é *quantos pacotes*
   nascem agora; errar para mais é o risco concreto aqui, não errar para menos.
2. **Preservação da governança já provada** (permission-gate fail-closed, protected-paths) — nada do que a
   Fase 0 provou pode regredir ao ser promovido.
3. **Manutenibilidade / não antecipar fases futuras por engenharia especulativa** — o `ConductorResourceLoader`
   e o session store são os dois candidatos naturais a serem construídos "completos demais, cedo demais".
4. **Operabilidade mínima viável** — `doctor` e o status da TUI precisam ser úteis no dia 1, não apenas
   esqueletos.

---

## 2. A tensão fork-vs-workspace (ADR 0001 §2.2) — resolução explícita para a Fase 1

O ADR 0001 §2.2 registrou a **fronteira-alvo** (Fase 1+): conteúdo canônico e orquestração do Conductor em um
**workspace de propriedade do Conductor**, consumindo `@earendil-works/pi-*` como dependência pinada, atrás do
adapter `conductor-runtime`. A demanda desta Fase 1, porém, **continua explicitamente dentro do fork**
(`eltonssouza/pi-conductor`, branch já criada de `develop`) — não em um novo repositório. Isso não é herdado
por omissão; é tratado aqui como decisão própria, com critério de reabertura, não como "a Fase 0 ficou no fork
e ninguém revisitou".

**Resolução: adiar a migração de workspace — deliberadamente, não por inércia — com um gatilho de reabertura
explícito, não uma data.**

Fundamento, verificado contra o que a Fase 1 realmente contém (§3 abaixo), não contra a Fase 1 em abstrato:

1. **O risco que ADR 0001 §4.5/§2.2 protegia não tem superfície na Fase 1.** O argumento do ADR 0001 era: se
   conteúdo canônico (`content/roles`, `content/skills`, `content/gates`) for autorado *dentro* do formato
   nativo do Pi, o emissor dual-harness (H2) degrada. A Fase 1, por decisão própria deste ADR (§4), **não
   carrega papéis, skills nem gates** — `ConductorResourceLoader` fica deliberadamente fino (§4). Não existe,
   hoje, nenhum conteúdo canônico sendo autorado que precisasse ser harness-agnóstico. O risco nomeado em
   ADR 0001 §4.5 ativa em **Fase 3** (papéis/skills), não em Fase 1 — é o gatilho de reabertura concreto,
   não "revisitar depois".
2. **Nenhuma capacidade da Fase 1 depende de estar no workspace do Pi** — verificado, não assumido:
   `packages/conductor-poc/package.json` já declara `@earendil-works/pi-ai`/`@earendil-works/pi-coding-agent`
   como `dependencies` normais com range semver (`^0.83.0`), resolvidas hoje pelo link do workspace npm
   (`packages/*` — recon §10) porque os nomes coincidem com pacotes locais, não porque exista uma dependência
   estrutural do fork. O versionamento é lockstep e publicado (recon §10, "todo release atualiza todos
   juntos") — um workspace externo poderia fixar a mesma versão via registry sem estar dentro do monorepo Pi.
   Continuar no fork por ora é **conveniência operacional** (ler os internals/docs do Pi no mesmo checkout
   enquanto a superfície harness-v2 ainda está em mudança ativa — commits do dia desta sessão confirmam isso,
   §1.1), não necessidade estrutural.
3. **O custo de montar a fronteira de workspace agora seria pago no lugar errado.** A literatura já citada em
   ADR 0001 §6.3 (Object-Oriented Thinking — Complete Professional Guide, §2.12: "the split pays where
   implementations really do change... what costs more than it returns is the reflex") se aplica aqui pelo
   mesmo argumento: não há hoje nenhum "trocar de fornecedor" real a proteger — os quatro pacotes da Fase 1
   (§3) dependem do Pi exatamente da mesma forma dentro ou fora do fork. Reforçado por esta sessão:
   *Distributed Architecture Decisions — Complete Professional Guide*, §2.12 ("When not to decompose data" —
   decompor paga quando cadências de release ou perfis de escala realmente divergem; aqui não divergem ainda)
   e *Managing Software Complexity — Complete Professional Guide*, §1.12 ("When not to treat complexity as the
   problem" — o mesmo raciocínio de proporcionalidade, aplicado a uma fronteira de repositório em vez de um
   módulo).

**Não é uma reversão de ADR 0001 §2.2** — a fronteira-alvo continua correta e não é descartada; é **adiada com
data de revisão amarrada a um evento do próprio roadmap**: a migração para workspace próprio (ou, no mínimo, a
formalização de `conductor-runtime` como consumidor de uma versão **pinada e publicada** do Pi, em vez do link
de workspace) é reavaliada **no início da Fase 3**, quando o primeiro conteúdo canônico de papel/skill for
autorado — porque é exatamente aí que ADR 0001 §4.5 preveria degradação se a fronteira não existir. Registrado
como item de arquitetura pendente para a Fase 3 (mesmo padrão usado pelo Adendo 0001-A para o gatilho 5).

---

## 3. Decisão — layout de packages para a Fase 1

### 3.1 Os quatro pacotes que nascem agora

| # | Pacote | Responsabilidade (uma linha) | Origem |
|---|---|---|---|
| 1 | **`packages/conductor-runtime`** | A camada de composição contra o Pi (ADR 0001 §2.1/§4.4's "conductor-runtime anti-corruption layer", nomeada ali, construída aqui): sessão (`createConductorSession`), permission-gate fail-closed, protected-paths, `ConductorResourceLoader` (§4). | **Promoção** de `packages/conductor-poc` (renomeado, não reescrito — ver §3.2) |
| 2 | **`packages/conductor-config`** | Schema versionado de `.conductor/config.json`; leitura/escrita/validação; get/set por chave. | Novo |
| 3 | **`packages/conductor-project`** | Detecção de stack (tipo/tecnologias/evidência) a partir dos manifests do projeto-alvo; função pura, sem I/O de configuração. | Novo — porta a lógica de `conductor-main/conductor/detect.py` (ver §5.1) |
| 4 | **`packages/conductor-cli`** | O binário `conductor`/`cdt`: parsing de argumentos, os quatro comandos, o loop interativo/TUI de `chat`. | Novo |

Grafo de dependência: `conductor-cli` depende dos três outros; `conductor-config`, `conductor-project` e
`conductor-runtime` **não dependem uns dos outros** — `conductor-project.detect()` retorna um
`DetectionResult` puro, e é `conductor-cli`'s comando `init` que o funde em um `ConductorConfig` via
`conductor-config`'s writer. Isso é deliberado: mantém cada pacote testável isoladamente contra fixtures
(plano §9.3) sem um pacote precisar mockar o outro. Grounded nesta sessão: *Enterprise Application
Architecture Patterns — Complete Professional Guide*, §2.2 ("Layers localize change and risk... clean
layering lets teams work and test in parallel") — aplicado aqui como justificativa da separação
detecção/config/runtime em vez de um único pacote "init".

Quatro pacotes, não cinco: `ConductorResourceLoader` **não** vira pacote próprio — fica dentro de
`conductor-runtime` porque sua única responsabilidade na Fase 1 (injetar system prompt customizado sobre o
`DefaultResourceLoader` já existente) já é território de `conductor-runtime`, que já constrói um
`DefaultResourceLoader` inline hoje (`session.ts:81-93`). Criar um pacote para uma classe fina que envolve
outra classe fina seria exatamente o "reflexo de uma interface por classe" que a citação de §2 acima adverte
contra.

### 3.2 O que acontece com `conductor-poc`

**Renomeado para `conductor-runtime`, não descartado e não reescrito.** `package.json` sai de
`"name": "@conductor/poc"`, `"version": "0.0.0"`, `"private": true` para um pacote real e versionado
(`"name": "@conductor/runtime"` ou `@earendil-works`-scoped conforme convenção de publicação decidida em fase
posterior — não bloqueante aqui). O código-fonte (`session.ts`, `permission-gate.ts`, `workspace-policy.ts`,
`fail-closed.ts`, `confirm.ts`, `tools/conductor-note.ts`) migra **como está**, com dois acréscimos apenas
(não reescritas):
- a classe `ConductorResourceLoader` (§4), que substitui a construção inline de `DefaultResourceLoader` em
  `session.ts` por uma classe nomeada com o contrato documentado;
- o ajuste de `agentDir`/`modelRuntime` para o layout `.conductor/` real (§5.2), em vez do `.conductor-agent/`
  usado como default de conveniência nos testes da Fase 0.

`conductor_note` permanece como está — é a referência viva do padrão de custom tool (plano §7.3), não um
recurso de produto da Fase 1; nenhuma tool nova é adicionada aqui (a tabela de 19 tools do plano §4.2 é
explicitamente Fase 3, ver §3.3).

### 3.3 O que fica de fora — nomeado, não esquecido

Da lista de 18 pacotes do plano §6, os quatro acima cobrem o necessário; os demais são **prematuros para a
Fase 1**, cada um com a fase do próprio plano que o reclama:

| Pacote (plano §6) | Por que não agora | Fase que o reclama |
|---|---|---|
| `packages/core` | Nenhum tipo/utilitário compartilhado tem hoje um segundo consumidor fora de `conductor-runtime`; extrair sem um segundo chamador real é decompor antes da dor aparecer (grounding §2, item 3). | Extrair quando `roles`/`gates` (Fase 3/4) precisarem de tipos compartilhados que não são "runtime". |
| `packages/roles`, `content/roles` | `ConductorResourceLoader` da Fase 1 não carrega papéis (§4) — não há `ConductorRole` para registrar ainda. | Fase 3 |
| `packages/skills`, `content/skills` | Mesma razão — `noSkills: true` permanece `true` na Fase 1 (§4). | Fase 3 |
| `packages/gates`, `content/gates` | Nenhuma máquina de estado de gate existe; `conductor chat` não tem conceito de gate ainda (§4.16 na TUI, §4). | Fase 4 |
| `packages/tools` (dedicado) | Só existe uma custom tool (`conductor_note`, referência); as 19 tools do plano §4.2 (`ast_search`, `journal`, `library`, `task`...) chegam junto com os papéis/skills que as usam. | Fase 3 |
| `packages/policies` (dedicado) | O permission-gate da Fase 1 é o subconjunto PoC-grade já promovido para `conductor-runtime` (§3.1); o motor de 5 níveis + classificador de risco + allowlists é maior e nomeado explicitamente no plano. | Fase 2 |
| `packages/sessions` (o `ConductorSessionStore` ACL de ADR 0001 §2.1) | Ver §6 — decisão própria desta seção: adiado. | Fase 4 (schema de evidência) |
| `packages/memory`, `packages/library`, `packages/learning` | Nenhuma consulta RAG nem diário dinâmico na Fase 1. | Fase 5, 6, 10 |
| `packages/mcp` | Nenhum cliente/servidor MCP na Fase 1. | Fase 9 |
| `packages/providers` (model-routing/tiers) | `conductor chat` usa um único modelo configurado diretamente (§5.3); não há resolução por gate/papel ainda. | Fase 7 |
| `packages/tui`/`packages/ui` (status-surface **do Conductor**, matrix row 26, `conductor-ui`) | Fase 1 consome `packages/tui` **do Pi** diretamente dentro de `conductor-cli` (§4.16 abaixo); não há dados de gate/papel/orçamento/subagentes ainda para justificar uma superfície de status própria e empacotada. | Cresce organicamente a partir da Fase 3/4, quando esses dados existirem |
| `packages/rpc`, `packages/sdk`, `packages/testing` | Nenhum segundo consumidor headless/embutido ainda — o critério de saída da Fase 1 é `conductor chat` interativo. | Fase 7 (headless/CI) em diante |
| `packages/conductor-emit` | Já fechado pelo Adendo 0001-B (A2) — fora do escopo desta demanda. | (decisão já tomada, não desta Fase) |

---

## 4. Decisão — `ConductorResourceLoader`: contrato e escopo deliberadamente fino

### 4.1 Contrato TypeScript

```typescript
// packages/conductor-runtime/src/resource-loader.ts

export interface ConductorResourceLoaderOptions {
  /** Raiz absoluta do workspace (mesmo valor passado ao permission-gate). */
  workspaceRoot: string;
  /** Diretório .conductor/ do projeto-alvo (não o home global do Pi — ver §5.2). */
  agentDir: string;
  /** Config já validada por conductor-config; única fonte do prompt customizado. */
  config: ConductorConfig;
  /** Repassado ao permission-gate subjacente (mesmo campo de CreateConductorSessionOptions hoje). */
  additionalProtectedPaths?: string[];
}

export class ConductorResourceLoader {
  private readonly inner: DefaultResourceLoader;

  constructor(options: ConductorResourceLoaderOptions) {
    this.inner = new DefaultResourceLoader({
      cwd: options.workspaceRoot,
      agentDir: options.agentDir,
      systemPromptOverride: () => buildFase1SystemPrompt(options.config),
      // Secure defaults herdados do Gate 3 (threat model, Fase 0) sem alteração:
      // nenhuma extension/skill/prompt/tema/context-file de terceiros no TCB.
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        createPermissionGateExtension({
          workspaceRoot: options.workspaceRoot,
          additionalProtectedPaths: options.additionalProtectedPaths,
        }),
      ],
    });
  }

  async reload(): Promise<CreateAgentSessionResult["extensionsResult"]> {
    return this.inner.reload();
  }

  /** Repassado como `resourceLoader` para createAgentSession()/createConductorSession(). */
  get pi(): DefaultResourceLoader {
    return this.inner;
  }
}
```

### 4.2 Em escopo agora vs. deliberadamente stub — para a Fase 3 não precisar adivinhar

| Responsabilidade (plano §7.4) | Fase 1 | Por quê |
|---|---|---|
| **Configuração do projeto** (`.conductor/config.json`) | **Em escopo** — é a única entrada do loader | É literalmente o critério de saída ("prompt customizado") |
| **Stack detectada** | **Em escopo, indireto** — via `config.project.*`, já persistido por `conductor init`; o loader não redetecta nada em tempo de sessão | Evita acoplar `conductor-runtime` a `conductor-project` (§3.1) |
| **Papéis** | **Stub** — `noSkills`/ausência de `ConductorRole` continua; nenhum `systemPromptOverride` seleciona papel | Fase 3 (plano §8) |
| **Skills** | **Stub** — `noSkills: true` inalterado desde a Fase 0 | Fase 3 |
| **Regras** (`content/rules`) | **Stub** — nenhuma regra não-negociável é injetada no prompt ainda | Fase 3 (junto com papéis, mesma fonte `content/`) |
| **Comandos** (`content/commands`) | **Stub** — `noPromptTemplates: true` inalterado | Fase 3 |
| **Políticas** (além do permission-gate já promovido) | **Stub** — o motor de 5 níveis é maior que isto | Fase 2 |
| **Memória relevante** (Diary) | **Stub** — nenhuma consulta de journal no prompt | Fase 6 |
| **Gate atual** | **Stub** — nenhum conceito de gate existe para injetar | Fase 4 |

Este é o "fatia real, não esqueleto vazio" que o próprio ADR 0001 (citando Outside-In Development) já usou
para justificar a Fase 0: o loader da Fase 1 faz uma coisa (prompt customizado a partir da config real), e
cada linha da tabela acima é uma promessa nomeada, não um silêncio que a Fase 3 tem que descobrir sozinha.

---

## 5. Decisão — `.conductor/` como formato desde o dia 1; `.cdt/` fica para `conductor migrate`

### 5.1 `conductor init`

**Detecção de stack: porta a lógica de `conductor-main/conductor/detect.py` para TypeScript — não invoca o
Python via subprocess.** Isto resolve a ambiguidade real que o plano deixa entre §11.1 ("conteúdo
reaproveitável": papéis, skills, gates, regras, comandos, *"configurações de stack"*) e §11.2 ("código a
reimplementar": loop, clientes LLM, TUI, sessão, tool dispatch...). Lida com atenção, "configurações de
stack" em §11.1 refere-se aos **dados** (os templates `.cdt/stack/<type>.md`, o mapa tech→stack-id da
biblioteca), não ao **algoritmo de detecção** que os produz — que é código, e código de detecção de projeto é
exatamente a classe de coisa que §11.2 já assume substituível (tool dispatch, sessão — infraestrutura do
próprio produto, não conteúdo de conhecimento). Reforça a leitura: `detect.py` (lido nesta sessão,
`conductor-main/conductor/detect.py:1-719`) não tem nenhuma dependência específica de Python além de um uso
opcional de PyMuPDF para PDFs — é leitura de manifest (`package.json`/`pom.xml`/`requirements.txt`/...) + JSON
+ regex, com zero I/O que não seja `fs`. É diretamente portável. Invocar o Python via subprocess, em
contraste, obrigaria **todo** `conductor init` da Fase 1 (o comando de onboarding central do novo produto) a
depender de um interpretador Python instalado — um acoplamento muito mais pesado do que o caso do emissor
(Adendo 0001-B, A2), que só é invocado quando emissão dual-harness é pedida explicitamente, não em todo
projeto. A mesma lógica de "portar o algoritmo, reaproveitar o conhecimento das tabelas de mapeamento
(framework→tech, tech→stack-id), não o runtime" que resolveu A2 na direção oposta (manter Python) resolve
aqui na direção de portar — porque aqui o algoritmo é pequeno e seu único acoplamento externo é opcional
(PDF), enquanto lá o conteúdo é grande e seu acoplamento externo é a própria identidade do produto (37
papéis/44 skills Python-owned).

`conductor init` então: roda `conductor-project.detect(root)` → `{type, technologies, evidence}`; escreve
`.conductor/config.json` (schema §5.3) via `conductor-config`; escreve `.conductor/.gitignore` (§5.2). **Não**
faz scaffolding completo de projeto — não emite `.claude/agents/`, `.claude/skills/`, `CLAUDE.md` nem
equivalentes. Isso é explicitamente fora de escopo: é o modo emissor (ADR 0001 §4.5, H2), que continua Python
via `conductor-emit` (Adendo 0001-B) e não tem nenhum motivo para entrar na Fase 1 — nenhum critério de saída
da Fase 1 o exige, e misturá-lo aqui reabriria exatamente a tensão que ADR 0001 §4.5 já resolveu.

**Idempotência e no-clobber (T16, `gate3-fase1-addendum.md` secure default 12).** `init` sobre um
`.conductor/` já existente é **merge, nunca sobrescrita cega**: re-detecta `project.*` (o dado que só o
próprio `init` produz) mas preserva todo campo que o usuário pode ter alterado por fora — `provider.*` (via
`conductor config set`, §7.3) e `workspace.additionalProtectedPaths`. Diferente do cenário de `conductor
migrate` (Fase 11, plano §11.3, que move árvores inteiras de memória/skills e por isso precisa de backup
explícito + validação de hash + rollback), `conductor init` da Fase 1 escreve um único arquivo pequeno que já
se espera versionado em git — a rede de segurança contra uma escrita indesejada **é o próprio git** (o usuário
vê o diff, reverte se for engano); não há necessidade de reimplementar backup/rollback para este caso restrito.
Isso é proporcional, não uma lacuna: T16 pede "nunca clobber silencioso de arquivo editado pelo usuário", e
merge campo-a-campo com o dado do usuário sempre vencendo satisfaz isso sem duplicar a maquinaria de
backup/rollback que `migrate` genuinamente precisa (árvores inteiras, formato antigo) e `init` não.

### 5.2 Layout de `.conductor/` — o que é commitado, o que não é

O plano §4.10.1 desenha uma única árvore `.conductor/` contendo `config.json`, `stack/`, `sessions/`,
`memory/`... sem distinguir o que é estado versionado do que é estado gerado pela máquina. Essa distinção
importa concretamente aqui porque **credenciais nunca podem arriscar ir para um diretório presumidamente
commitado** — e o próprio plano já concorda com isso indiretamente: `~/.conductor/credentials` está na lista
de *protected paths* (plano §4.3), ou seja, credenciais já são modeladas como vivendo **fora** de qualquer
`.conductor/` de projeto, em um local global protegido.

**Decisão:** `.conductor/` é escrito por `conductor init` como um único diretório de projeto, com um
`.conductor/.gitignore` que o próprio `init` gera:

```gitignore
# escrito por `conductor init` — não editar à mão; `conductor doctor` valida a presença
/sessions/
```

- **Commitado:** `config.json`, e (fases futuras) `stack/`, `policy.json`.
- **Não commitado:** `sessions/` (transcritos podem conter trechos de código/prompt proprietários — mesmo
  raciocínio que já levou o `conductor-main` (Python) a nunca deixar estado gerado pela máquina dentro de
  `.cdt/`, que é commitado por convenção — ver `conductor-main/CLAUDE.md`: *"`.cdt/` is user-committed —
  machine-written state does not belong in it"*. Tratado aqui como aprendizado de projeto-irmão, não como
  citação de biblioteca — registrado honestamente como tal).
- **Credenciais/modelos NÃO vivem em `.conductor/` de forma alguma — isto satisfaz T11 do
  `gate3-fase1-addendum.md` por construção, não apenas por convenção de `.gitignore`.** O adendo do Gate 3
  pede que `config.json` guarde **referência, nunca chave crua** (nome de env var / id de keychain / id de
  provedor+modelo) e que `init` garanta um `.gitignore` para o material sensível como rede de segurança. Esta
  decisão vai além: como nenhuma credencial jamais é escrita dentro de `.conductor/` (nem mesmo uma referência
  é necessária — ver adiante), não existe arquivo sensível ali para vazar por um `git add .` acidental que um
  `.gitignore` mal escrito deixasse passar. `.conductor/.gitignore` ainda existe (abaixo) mas protege
  `sessions/`, não credenciais — que simplesmente nunca chegam a esse diretório. `conductor chat` **não** sobrescreve
  `authPath`/`modelsPath` do `ModelRuntime` para dentro de `.conductor/` — diferente do que
  `conductor-poc/src/session.ts` faz hoje (que aponta `authPath`/`modelsPath` para dentro do próprio
  `agentDir` de teste, aceitável para fixtures descartáveis, não para um diretório de projeto real). Em vez
  disso, `conductor-cli`'s comando `chat` constrói seu próprio `ModelRuntime` com os defaults globais do Pi
  (`~/.pi/agent/{auth,models}.json`) e o passa via o parâmetro `modelRuntime` que `createConductorSession` já
  expõe hoje (`session.ts:36`, `options.modelRuntime ?? (await ModelRuntime.create({...}))`) — **zero mudança
  de assinatura** em `conductor-runtime`, apenas um jeito diferente de chamá-la. Apenas `agentDir`
  (→ `sessions/`) fica escopado a `.conductor/`, via o `sessionManager` que a função já aceita
  separadamente. Consequência prática: `conductor doctor` (§7.2) pode confirmar que `.conductor/config.json`
  está versionado sem nunca correr o risco de reportar uma credencial dentro de um `git status`.

### 5.3 `.conductor/config.json` — shape mínimo para a Fase 1

```typescript
// packages/conductor-config/src/schema.ts
export interface ConductorConfig {
  /** Formato versionado desde a primeira escrita — não retrofitar depois. */
  schema: 1;
  project: {
    type: "backend" | "frontend" | "fullstack" | "mobile" | "library" | "data" | "unknown";
    technologies: string[];   // ex.: ["Java/Maven", "Angular 21"]
    evidence: string[];       // caminhos de manifest relativos à raiz
    detectedAt: string;       // ISO-8601 UTC
  };
  workspace: {
    /** "." = implícito (diretório-pai de .conductor/); absoluto só para restringir ainda mais. */
    root: string;
    additionalProtectedPaths?: string[];
  };
  provider: {
    model: string;            // "provider/modelId", ex. "anthropic/claude-sonnet-5"
    thinkingLevel?: string;
  };
}
```

**Nenhum campo deste schema pode conter material de chave** — o campo `provider.model` é sempre um
identificador (`provedor/modelo`), nunca uma credencial; é exatamente uma das três formas de referência que
`gate3-fase1-addendum.md` T11 já permite ("id de provedor+modelo — nunca o material da chave"). Não há campo
`apiKeyEnv` porque a resolução de auth do Pi já sabe encontrar a credencial certa a partir de qual provedor
`provider.model` seleciona (prioridade CLI flag → credencial armazenada/OAuth → env var → `models.json` —
recon §7), sem que o Conductor precise ensinar a ele onde procurar.

Deliberadamente **não** inclui: `policy.json`-equivalente completo (Fase 2), lista de papéis/skills
habilitados (Fase 3), configuração de gates (Fase 4), tiers de modelo por gate (Fase 7). `schema: 1` segue a
convenção já estabelecida no projeto-irmão Python para formatos versionados desde a primeira escrita
(aprendizado de projeto, não citação de livro — mesma ressalva de §5.2).

### 5.4 `.cdt/` — não suportado nesta fase, e isso é a decisão certa, não uma lacuna

O plano §11.3 já resolve a estratégia (`.conductor/` novo; `.cdt/` em modo compatibilidade; comando de
migração explícito com backup) — o que faltava decidir era **quando**. Resolução: `.cdt/` read-compat **não**
entra na Fase 1. `conductor migrate` está listado no plano junto de "migração do Conductor anterior", que é
Fase 11 (`Hardening e release`), não Fase 1. Construir um leitor de compatibilidade para um formato antigo
antes de o formato novo sequer existir em produção não tem consumidor — é exatamente o tipo de generalidade
especulativa que o grounding desta sessão adverte (Managing Software Complexity §1.12/§2.12). `conductor
doctor` (§7.2), ao encontrar um `.cdt/` sem `.conductor/`, apenas reporta "projeto Conductor legado detectado
— migração ainda não implementada (chega na Fase 11)" em vez de tentar interpretar o formato antigo.

---

## 6. Decisão — persistência de sessão: JSONL do Pi, escopado a `.conductor/sessions/`; o `ConductorSessionStore` (ADR 0001 §2.1) fica para a Fase 4

**Reusa o mecanismo/convenção JSONL do Pi tal como está — não constrói o `ConductorSessionStore` agora.**

O ADR 0001 §2.1 já previu esta pergunta e a nomeou: *"Esse store é uma anti-corruption layer fina: o schema de
evidência/journal é do Conductor; o substrato de persistência (JSONL hoje) é trocável"* — mas não decidiu
**quando** construí-la, apenas que ela existiria eventualmente. Este ADR fecha o "quando": **não na Fase 1**.

Razão, específica ao que a Fase 1 realmente precisa (não a uma objeção genérica a construir cedo demais):
- O `ConductorSessionStore` existe para carregar um **schema de evidência** (decisão de gate, citação, risco
  aceito — ADR 0001 §2.1, plano §3.4 "evidência antes de conclusão"). A Fase 1 **não tem gates** (§3.3) — não
  há schema de evidência para o store transportar ainda. Construir o adapter antes de o schema existir é
  construir uma interface sem um segundo lado real — o próprio contra-argumento já citado em ADR 0001 §6.3 e
  reforçado nesta sessão (*Object-Oriented Thinking*, §2.12: "the reflex of one interface per class" custa
  mais do que retorna quando não há troca de implementação real acontecendo).
- O que a Fase 1 precisa de sessão — persistir, retomar, listar — `SessionManager.create()`/`.continueRecent()`/
  `.open()` já entrega **hoje**, comprovado pela própria Fase 0 (critério de saída: "persistir a sessão",
  "retomar a sessão", ambos marcados feitos). Reescrever isso agora não destrava nenhum comando dos quatro
  desta fase.
- **Único ajuste real:** o `agentDir` passado a `SessionManager.create(workspaceRoot, sessionsDir)` aponta
  para `.conductor/sessions/` em vez do global `~/.pi/agent/sessions/--<cwd>--/` — um argumento de
  configuração, zero código de persistência novo (§5.2). Isso por si só já satisfaz a árvore do plano §4.10.1
  (`sessions/` sob `.conductor/`).

**Quando reabrir:** no início da Fase 4 (`Gates e evidências`), quando `GateState`/`Evidence` (plano §4.7)
precisarem de um formato que o `custom` entry genérico do Pi não carrega nativamente — momento em que a
"anti-corruption layer fina" do ADR 0001 §2.1 finalmente tem um segundo lado (o schema de evidência) para
justificar sua própria existência.

---

## 7. Decisão — os quatro comandos

### 7.1 `conductor init`

Cobrto em §5.1/§5.2/§5.3. Resumo de forma e fronteira: detecta stack (TS portado, §5.1) → escreve
`.conductor/config.json` + `.conductor/.gitignore` (§5.2/§5.3) → **não** escreve nada em `.claude/`/
`AGENTS.md`/Cursor (fora de escopo, §5.1) → **não** faz scaffolding de papéis/skills/gates (Fase 3/4).
Idempotente: rodar de novo sobre um `.conductor/` existente re-detecta e atualiza `project.*`, preservando
`provider.model` já configurado pelo usuário (não sobrescreve escolha humana com re-detecção automática).

### 7.2 `conductor doctor`

Quatro categorias do escopo sugerido pela demanda, mais uma quinta com justificativa própria:

1. **`.conductor/` presente e válido** — `config.json` parseia, `schema` reconhecido, campos obrigatórios
   presentes (usa o mesmo validador de `conductor-config` que `init`/`config` usam — "validado no load", não
   um checker duplicado).
2. **Node/npm** — versão do Node ≥ `22.19.0` (mesmo `engines.node` de todo `package.json` do Pi, recon §10) —
   um `chat` que roda sobre uma versão de Node incompatível com o Pi falharia de forma confusa sem este check.
3. **Estado do repositório git** — dentro de um repo git? branch atual? dirty? Informativo, não bloqueante:
   um projeto sem git ainda funciona, `doctor` apenas reporta "branch/dirty indisponível — sem repositório
   git".
4. **Biblioteca (RAG) — só se configurada.** A Fase 1 não escreve nenhuma chave de biblioteca em
   `config.json` (Fase 5 a introduz); `doctor` verifica **se** ela existe e, só então, faz um ping —
   ausência não é falha, é "Library chega na Fase 5".
5. **(Acréscimo próprio, além do pedido) Credencial/modelo resolvível.** Verifica se `ModelRuntime` consegue
   resolver ao menos um provedor/modelo configurado (mesma checagem que `conductor chat` precisaria fazer
   antes de abrir sessão). Justificativa: é o único dos cinco checks diretamente **bloqueante** para o
   comando carro-chefe da fase (`chat`) — sem ele, um usuário só descobriria a falta de credencial no meio de
   `chat`, não em `doctor`, que existe precisamente para adiantar esse diagnóstico.

**Regra vinculante (T12, `gate3-fase1-addendum.md` secure default 10): `doctor` reporta status, nunca
valor.** Para cada item acima que toca credencial/config sensível, a saída é estritamente
presença/permissão/forma — `ANTHROPIC_API_KEY: set` (nunca o valor), `auth.json: present, readable` (nunca o
conteúdo), `provider anthropic: configured` (nunca a chave). Nenhum código de `conductor doctor` lê o valor de
um segredo para dentro de um campo que vá para stdout/relatório — um relatório de `doctor` é, por natureza,
algo colável num chat de suporte ou anexado a uma issue (o próprio raciocínio do adendo), então esta regra é
tratada como invariante de implementação, não como preferência de estilo.

### 7.3 `conductor config`

`get`/`set`/`show` sobre `.conductor/config.json`, endereçado por chave em dot-path (`provider.model`,
`workspace.additionalProtectedPaths`). `set` valida contra o schema de `conductor-config` **antes** de
escrever (chave desconhecida ou tipo errado → erro, não gravação silenciosa) — mesma disciplina "descoberto
falha suave, nomeado à mão falha alto" já validada como correta no projeto-irmão Python (aprendizado de
projeto). `show` imprime o documento completo (redigindo nada — não há segredo em `config.json` por
construção, §5.2). Sem "apply" separado: `set` é imediato, porque não há motor de política complexo ainda
para justificar um passo intermediário (esse motor é Fase 2).

**`conductor config set` é precisamente o canal "fora de banda" que `gate3-fase1-addendum.md` T13 já
antecipa e sanciona.** T13 (o achado mais forte do adendo) proíbe que a **ferramenta `write`/`edit` de uma
sessão de agente** reescreva `config.json`/`policy.json` — mas o próprio texto do adendo nomeia
explicitamente "um `conductor` command dedicado com seu próprio gate" como a via legítima de mudar a política
(§2, T13, "Mitigação"). `conductor config set` é esse comando: roda fora de qualquer loop de agente/LLM
(nenhum tool-call, nenhum `pi.on("tool_call")` envolvido — é uma invocação de CLI direta que grava com `fs`
puro), então a proibição de T13 não se aplica a ele, exatamente como já não se aplica a um humano editando o
arquivo num editor de texto. Nenhuma mudança de design é necessária aqui — apenas o registro explícito de por
que este comando é seguro por construção, não apesar de T13.

### 7.4 `conductor chat`

Envolve `createConductorSession` (agora em `conductor-runtime`) + `ConductorResourceLoader` (§4) numa TUI real
construída sobre `packages/tui` do Pi — não um loop `readline` simples.

**Decisão: TUI real agora, não um loop plano.** Dois motivos, não um por conveniência:
1. O critério de saída da própria Fase 1 diz "TUI inicial" — não "prompt de linha de comando". Um loop
   `readline` sub-entregaria contra o próprio plano e teria que ser descartado já na Fase 1 seguinte-imediata
   quando a superfície de status crescer (§7.5) — trabalho jogado fora sem necessidade.
2. `packages/tui` já é máquina de renderização reutilizável e provada — `TuiMainScreen`, `Editor`,
   componentes `Text`/`SelectList`/`VStack`/`HStack`/`ScrollView` (lido nesta sessão,
   `packages/tui/README.md:1-120`) — sem custo de fork (é um pacote npm irmão, mesmo argumento de "reusar o
   framework, construir a superfície" que a própria matriz da Fase 0 já aplicou à linha 26). Construir sobre
   ele agora é a mesma decisão de composição-antes-de-fork que rege todo o resto deste ADR.

Forma concreta: `TuiMainScreen` (preserva scrollback do terminal — mais barato e adequado a uma sessão de chat
longa do que `TuiAltScreen`, que a Fase 1 não precisa) + `Editor` para o prompt do usuário + `Text`/
`Container` para o transcrito + os eventos de `PermissionGateDecision` (já emitidos por
`conductor-permission-gate` hoje, `permission-gate.ts:41-49`) roteados para uma linha de status simples.

**Três regras vinculantes de `gate3-fase1-addendum.md`, fechadas aqui, não deixadas para a implementação
decidir sozinha:**

- **T13 — `.conductor/config.json` (e o futuro `policy.json`) entram em `additionalProtectedPaths` sempre que
  `conductor chat` abre uma sessão.** O mecanismo já existe e não muda: `createConductorSession`/
  `createPermissionGateExtension` já aceitam `additionalProtectedPaths?: string[]` (`session.ts:39`,
  `permission-gate.ts:51`) — hoje usado só para paths extras do usuário. `conductor-cli`'s comando `chat`
  passa `join(workspaceRoot, ".conductor", "config.json")` (e, quando existir, `policy.json`) nessa lista
  incondicionalmente, sem opt-out. Efeito: uma ferramenta `write`/`edit` **dentro da sessão** que tente gravar
  em `config.json` é bloqueada por `evaluateToolPath` antes mesmo de chegar em `ctx.ui.confirm()` — o mesmo
  caminho que já protege `~/.ssh` etc. Nenhum código novo de política; é reuso literal do primitivo que já
  existe, aplicado a um alvo novo, exatamente como o adendo pediu.
- **T14 — texto controlado pelo modelo é sanitizado antes de qualquer render em terminal real.**
  `conductor-runtime`'s `confirm.ts` (reusado sem mudança de assinatura) e o adapter que `conductor-cli`
  escreve para desenhar `ctx.ui.confirm()`/o transcrito sobre `packages/tui` devem escapar caracteres de
  controle C0/C1 e sequências CSI/OSC de `event.input.path`/`event.input.command`/`event.input.note` **antes**
  de passá-los para qualquer componente `Text`/`Editor` do Pi — tratados como dado de linha única, nunca como
  marcação de terminal. Esta é uma responsabilidade do Conductor (não assumir que o `Text` do Pi já escapa;
  verificar, e escapar de qualquer forma) — é a própria ressalva que fez a Fase 0 rodar headless não ser
  suficiente evidência para a Fase 1.
- **T15 — nenhum comando interno da TUI (mesmo os poucos que a Fase 1 tem — `/exit`, e o que §7.5 mantiver)
  chama `child_process`/`fs` fora de `pi.on("tool_call")`.** A Fase 1 não introduz `/branch`/`/approve` (esses
  são §4.16 completo, não reclamados por nenhum critério de saída desta fase — ver §7.5), o que já reduz a
  superfície do T15 ao mínimo; a regra fica registrada aqui como invariante de design para quando comandos
  internos crescerem (Fase 3+), não como algo a implementar agora sem alvo.

### 7.5 §4.16 do plano — o que é realista nesta fase

Das quinze categorias de status que o plano §4.16 lista para a TUI final, cinco têm dado real disponível **sem
nenhuma máquina nova**, e dez precisam de mecanismos que a Fase 1 explicitamente não constrói (gates, papéis,
budgets, subagentes, evidência, Library, Diary):

| Campo do plano §4.16 | Fase 1? | Fonte do dado |
|---|---|---|
| Modelo ativo | **Sim** | `session`/config já carregam o modelo resolvido |
| Branch e dirty state | **Sim** | `git status --porcelain` + `git branch --show-current`, chamada direta, sem dependência de gate |
| Tokens utilizados | **Sim** | Estatísticas de uso já expostas pela sessão/RPC (`get_session_stats`, matriz Fase 0 linha 1) |
| Contexto restante | **Parcial** — derivável de tokens usados vs. janela do modelo, sem precisar de orçamento por gate | Mesmo dado de tokens + metadado de contexto do modelo |
| Nível de permissão | **Parcial** — não há 5 níveis ainda (Fase 2); mostra a postura fail-closed atual + contagem de decisões do permission-gate desta sessão | `PermissionGateDecision` (já emitido, `permission-gate.ts:41-49`) |
| Gate atual | Não | Fase 4 |
| Papel ativo | Não | Fase 3 |
| Orçamento restante | Não | Fase 8 |
| Ferramentas em execução | Não | Existe evento de tool-call no Pi, mas sem papel/gate para contextualizar "por quê" é pouco acionável agora — adiado com o resto da superfície de status |
| Subagentes ativos | Não | Fase 3 (`task` tool) |
| Riscos pendentes | Não | Fase 4 (schema de evidência) |
| Resultados de testes | Não | Fase 4/5 |
| Status do RAG | Não | Fase 5 |
| Status da memória | Não | Fase 6 |
| Checkpoints | Não | Fase 4 |

---

## 8. Reconciliação com `docs/conductor/gate3-fase1-addendum.md` — fechando o follow-up do Gate 3

O adendo do Gate 3 da Fase 1 (ameaças T11–T16) aterrissou **antes** deste ADR e registrou explicitamente, em
seu §6 final: *"Reconciliação pendente (follow-up): o ADR 0002 ... ainda não existia ... Quando aterrissar,
verificar consistência de: (i) onde `config.json`/`policy.json` residem ...; (ii) se algum comando novo
introduz um data flow de saída ou uma travessia não modelada."* Esta seção fecha esse follow-up, ponto a
ponto — o mesmo padrão que o Adendo 0001-A usou para reconciliar ADR 0001 com o Gate 3 da Fase 0.

**(i) Onde `config.json`/`policy.json` residem.** O adendo assumiu `.conductor/` na raiz do projeto (plano
§4.10.1/§11.3) por hipótese. **Confirmado, sem divergência**: §5.2/§5.3 deste ADR fixam exatamente isso —
`.conductor/config.json` na raiz, commitado; `policy.json` seguirá o mesmo padrão quando a Fase 2 o
introduzir. Nenhuma reabertura necessária aqui.

**(ii) Nenhum novo data flow de saída não modelado — verificado explicitamente, não assumido.**
`conductor config` (não nomeado individualmente pelo escopo original do adendo, que falava em
`init`/`doctor`/`chat`/`init-migrate`) foi checado: é o canal fora-de-banda que a própria mitigação de T13 já
sancionava por nome (§7.3 acima) — não é uma travessia nova, é o preenchimento do "comando dedicado" que o
adendo previu sem nomear. O único data flow genuinamente novo que este ADR introduz e o adendo não cobria é o
ping opcional de `doctor` a um backend de Library (§7.2, item 4) — de severidade baixa por construção: só
existe se o usuário já configurou uma URL de Library (não é um default da Fase 1), não carrega credencial
(Library é conhecimento estático, não autenticado por design do produto), e é o mesmo tipo de egress de rede
que o plano §4.3 já modela sob o nível "Network" do sistema de permissões (consentimento + registro) — não é
uma classe de ameaça nova, é uma instância a mais da categoria já coberta. Não gera um T17: é severidade baixa
demais e estruturalmente idêntica a um caso já modelado para justificar reabrir o Gate 3 por ele; registrado
aqui para que a decisão de não abrir um novo threat ID seja auditável, não silenciosa.

**Ponto a ponto, T11–T16 contra este ADR:**

| Ameaça | Onde este ADR fecha | Status |
|---|---|---|
| **T11** (segredo cru em config.json) | §5.2 — credenciais nunca entram em `.conductor/`, nem como referência | **Excede** a mitigação pedida (não precisa nem de `.gitignore` para isso) |
| **T13** (automodificação de política) | §7.4 — `config.json`/`policy.json` em `additionalProtectedPaths` sempre, incondicionalmente, em toda sessão de `chat` | **Fechado**, mecanismo já existente reusado |
| **T12** (doctor ecoa segredo) | §7.2 — regra vinculante "status, nunca valor" | **Fechado** |
| **T14** (escape de terminal no prompt de aprovação) | §7.4 — sanitização obrigatória antes de qualquer render em `packages/tui` | **Fechado** como invariante de design; verificação de que o `Text` do Pi já escapa ou não fica para a implementação (item de follow-up, §12) |
| **T16** (init sobrescreve silenciosamente) | §7.1 — merge campo-a-campo, git como rede de segurança para o caso restrito de um único arquivo pequeno | **Fechado**, com escopo explicitamente mais estreito que `migrate` (Fase 11) — justificado, não uma lacuna |
| **T15** (efeito colateral de TUI fora do chokepoint) | §7.4 — invariante registrado; superfície mínima na Fase 1 porque `/branch`/`/approve` não existem ainda | **Fechado para o escopo atual**; recarregado automaticamamente quando §7.5 crescer a lista de comandos internos |

**Veredito:** nenhuma decisão deste ADR contradiz o adendo do Gate 3; nenhuma decisão deste ADR expõe uma
fronteira de confiança que T11–T16 não previu. O Gate 3 e o Gate 4 desta fase estão consistentes — a condição
de saída que o protocolo do projeto exige antes de avançar.

---

## 9. Consequências

### 8.1 Positivas

- Quatro pacotes, não a lista de 18 do plano — a "cerimônia da decisão" (ADR 0001 §5, citando Software
  Architecture and Quality Attributes §1.12) fica proporcional ao tamanho real da Fase 1.
- Zero retrabalho de `conductor-poc`: é promovido, não reescrito — o Gate 8 já validou esse código.
- `.conductor/config.json` versionado desde a primeira escrita evita o retrofit de versionamento que o
  projeto-irmão já identificou como doloroso.
- A separação `sessions/` (gitignored) vs. `config.json` (commitado) fecha, para este produto, um risco que o
  plano §4.10.1 deixava implícito.

### 8.2 Riscos aceitos (com mitigação)

| # | Risco | Sev. | Mitigação |
|---|---|---|---|
| R1 | A detecção de stack portada para TS diverge silenciosamente do `detect.py` Python ao longo do tempo (duas implementações do mesmo conhecimento) | Médio | Fixtures de teste espelhadas (plano §9.3: Java/Spring, Angular, Node, Python, Go, Rust, fullstack, monorepo) rodadas contra ambas as implementações até uma delas ser formalmente aposentada; não é um problema desta Fase resolver, é um item de teste a herdar |
| R2 | Adiar `.cdt/` read-compat (§5.4) significa que um usuário do Conductor Python que tentar `conductor init` sobre um projeto `.cdt/` existente não recebe migração automática | Baixo | `doctor` reporta a situação com clareza (§7.2 item 1) em vez de falhar silenciosamente ou corromper `.cdt/` |
| R3 | Continuar no fork (§2) adia, não elimina, o trabalho de separação de workspace — se a Fase 3 chegar sem essa reavaliação acontecer, o risco original de ADR 0001 §4.5 (erosão do dual-harness) materializa | Alto | Gatilho de reabertura registrado explicitamente em §2, amarrado ao início da Fase 3 — mesmo padrão do Adendo 0001-A para o gatilho 5, que funcionou (foi de fato revisitado) |
| R4 | `ConductorResourceLoader` fino demais pode subestimar o que a Fase 3 realmente precisa, forçando uma reescrita em vez de uma extensão | Baixo | O contrato (§4.1) já expõe `pi` (o `DefaultResourceLoader` interno) e aceita opções adicionais por composição — extensão é mais provável que reescrita, mas não garantida; registrado como suposição, não certeza |

### 8.3 Negativas / custos assumidos

- Nenhum scaffolding de `.claude/`/`AGENTS.md` na Fase 1 significa que um usuário só ganha o modo emissor
  depois — aceito porque nenhum critério de saída da Fase 1 o exige e misturá-lo reabriria a tensão de
  ADR 0001 §4.5 sem necessidade.
- O `chat` da Fase 1 não tem gates/papéis — é deliberadamente um agente "genérico" governado só pelo
  permission-gate, não ainda o Conductor completo. Isso é o próprio ponto do faseamento do plano, não um
  defeito deste ADR.

---

## 10. Alternativas consideradas e rejeitadas

### 9.1 (a) Criar os 18 pacotes do plano §6 desde já, mesmo vazios/stub

**Rejeitada.** Contradiz diretamente "núcleo pequeno" (plano §3.6) e o próprio pedido desta demanda
("proporcional... 3-5 pacotes reais, não 18"). Pacotes vazios não reduzem trabalho futuro — apenas adicionam
14 `package.json` para manter em lockstep com nada dentro.

### 9.2 (b) Invocar `conductor-main`'s `detect.py` via subprocess Python em vez de portar

**Rejeitada** — ver análise completa em §5.1. Resumo: `detect.py` é pequeno, autocontido, sem dependência
Python-específica de peso, e portá-lo evita impor um interpretador Python como pré-requisito do comando de
onboarding central do novo produto — um acoplamento estrutural muito mais caro do que o mesmo raciocínio
aplicado ao emissor (Adendo 0001-B), que só entra em cena quando emissão é pedida explicitamente.

### 9.3 (c) Construir o `ConductorSessionStore` (ADR 0001 §2.1) já na Fase 1, "para não ter que voltar depois"

**Rejeitada.** Não há schema de evidência para o store carregar até a Fase 4 (§6) — construir a
anti-corruption layer antes do segundo lado dela existir é o "reflexo de interface" que a própria literatura
citada (§2, Object-Oriented Thinking §2.12) adverte custar mais do que retorna. "Não ter que voltar depois" é
exatamente o argumento contra o qual essa citação foi trazida.

### 9.4 (d) Migrar para um workspace Conductor-owned já nesta Fase, cumprindo a fronteira-alvo de ADR 0001 §2.2 imediatamente

**Rejeitada, adiada com gatilho — ver §2.** Nenhuma capacidade da Fase 1 exige a migração; o risco que ela
mitigaria (erosão do dual-harness, ADR 0001 §4.5) não tem superfície ainda porque a Fase 1 não autora
conteúdo canônico de papel/skill. Migrar agora pagaria o custo de fronteira antes de haver algo real para
proteger.

---

## 11. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4`:

1. **"CLI configuration management: versioned config file schema, get/set commands, validation at load time,
   minimal viable config vs full policy engine"** → top **0.573** — cobertura **fraca**, relatada
   honestamente: o corpus retornou passagens genéricas de arquitetura/documentação de views (Solution
   Architecture §3.5/§1.12, Documenting Software Architecture §1.12/§2.5, Enterprise Application Architecture
   Patterns "How to read this guide") sem nenhuma tratando especificamente de design de ferramenta CLI,
   formato de arquivo de configuração ou comandos get/set. **Confirma a observação já feita nesta demanda**
   (uma consulta anterior desta sessão sobre "CLI architecture: command structure, configuration loading"
   também retornou match fraco, top 0.586). O corpus deste projeto é de arquitetura de software em geral
   (Clean Architecture, DDD, fundamentos), não de design de ferramentas de linha de comando — não força
   citação onde não há cobertura real. As decisões de §5.3/§7.3 (schema versionado, get/set validado antes de
   escrever) se apoiam em aprendizado de projeto-irmão (`conductor-main`), citado como tal, não como biblioteca.

2. **"resource loader and plugin discovery design: progressive disclosure, thin adapter scope for an early
   phase vs full feature scope deferred to a later phase"** → **Managing Software Complexity — Complete
   Professional Guide**, §2.12 ("When not to deepen a module" — profundidade é benefício sobre custo de
   interface; um módulo aprofundado além do que os chamadores precisam desloca complexidade para
   workarounds) e §2.3/§3.3 (profundidade = benefício/custo; hiding vs. leakage). Top **0.559** — match
   moderado, usado em §4 para justificar por que `ConductorResourceLoader` fica deliberadamente fino
   (interface pequena, implementação pequena — profundidade correta para o que a Fase 1 realmente esconde).

3. **"when to split a new module or package versus keep functionality inside an existing one: premature
   fragmentation vs coupling cost, small core principle"** → **Distributed Architecture Decisions — Complete
   Professional Guide**, §2.12 ("When not to decompose data" — decompor paga quando cadências de release ou
   perfis de escala realmente divergem entre partes) e **Managing Software Complexity**, §1.12 ("When not to
   treat complexity as the problem"). Top **0.618** — match forte para este corpus; usado em §2 e §3.3 para
   justificar tanto o adiamento da fronteira de workspace quanto o não-desmembramento dos 14 pacotes restantes.

4. **"YAGNI: building only what the current phase needs, deferring a persistence/store abstraction until a
   real requirement forces it, avoiding speculative generality"** → **Enterprise Application Architecture
   Patterns — Complete Professional Guide**, §2.2 ("Layers localize change and risk... clean layering lets
   teams swap implementations") e §2.12 ("When not to add a separate domain layer" — layering por reflexo
   cria três lares para uma preocupação); **Object-Oriented Thinking**, §2.12 (já citado em ADR 0001 §6.3,
   reaplicado aqui). Top **0.570** — match moderado; usado em §6 para justificar adiar o
   `ConductorSessionStore` e em §3.1 para justificar a separação `conductor-config`/`conductor-project`.

**Nota de cobertura consolidada:** as quatro consultas confirmam o padrão já relatado nesta demanda — este
corpus responde bem a perguntas de **arquitetura de módulos/fronteiras/camadas em geral** (0.55–0.62 de
score, todas do mesmo cluster de livros de arquitetura), mas **não cobre CLI-tool-specific design**
(estrutura de subcomandos, convenções de arquivo de config, UX de terminal) com nenhuma força — reportado
explicitamente em vez de forçar uma citação onde não existe.

Diário: `cdt journal recall` (a rodar antes do checkpoint) deve confirmar o contexto do Gate 4 anterior
(ADR 0001, matriz, gaps) já revisado nesta sessão diretamente dos arquivos.

---

## 12. Follow-ups

- **Gatilho de reabertura de §2** (fronteira fork-vs-workspace): revisitar no início da Fase 3, quando o
  primeiro conteúdo canônico de papel/skill for autorado.
- **Gatilho de reabertura de §6** (`ConductorSessionStore`): construir no início da Fase 4, quando
  `GateState`/`Evidence` precisarem de um schema que o `custom` entry genérico do Pi não carrega.
- **R1 (§9.2):** decidir, antes de a Fase 1 fechar, se as fixtures de teste de `conductor-project` rodam
  também contra `detect.py` (Python) como suíte de paridade, ou se a paridade é responsabilidade só de leitura
  humana no code review — não decidido aqui, registrado como aberto.
- Validar in loco, durante a implementação (fora do escopo deste Gate 4, que é arquitetura, não código): que
  `packages/tui`'s `TuiMainScreen`/`Editor` realmente compõem sem fricção com o padrão `session.subscribe()`
  já provado em `conductor-runtime` — o recon não testou essa combinação especificamente, só cada metade
  isoladamente.
- **T14 (§8, reconciliação com `gate3-fase1-addendum.md`):** verificar, na implementação, se os componentes
  `Text`/`Editor` de `packages/tui` já escapam caracteres de controle/sequências CSI/OSC por conta própria —
  se sim, a sanitização do Conductor em `confirm.ts` fica redundante-mas-segura (defesa em profundidade); se
  não, a sanitização é a única linha de defesa e vira teste de segurança obrigatório (plano §9.4, "output
  poisoning"), não apenas uma boa prática.
