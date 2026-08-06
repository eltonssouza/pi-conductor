# Gate 3 — Adendo da Fase 1: fundação do produto (CLI/config)

**Demanda:** reconstruir o Conductor Coding Agent sobre o runtime Pi
(earendil-works/pi) — **Fase 1, "Fundação do produto"**.

**Natureza deste documento:** é um **adendo** ao threat model da Fase 0
(`docs/conductor/gate3-threat-model.md`), que **estende, não substitui**. Toda a
análise da Fase 0 (DFD de 6 travessias TB1–TB6, ameaças T1–T10, secure defaults
1–7, regra-mãe fail-closed) **continua válida e não é re-litigada aqui**. Este
adendo modela **apenas** as superfícies **novas** que a Fase 1 acrescenta ao
introduzir a camada de CLI e o arquivo de configuração em disco. Referências da
forma "§N (Fase 0)" apontam para sções do documento da Fase 0; não são
reproduzidas.

**Escopo (ESTREITO, proporcional — como a Fase 0).** A Fase 1 adiciona
exatamente estas superfícies, e nada além:

1. `conductor init` grava `.conductor/config.json` (stack detectada +
   configuração de provedor/modelo). Pergunta central: o arquivo guarda uma
   **chave crua** ou apenas uma **referência** a onde a chave vive?
2. `conductor doctor` lê essa config + estado de repo/ambiente e **imprime** um
   relatório. Pergunta: um health-check pode vazar um segredo na própria saída?
3. `conductor chat` é a **mesma** sessão protegida pela permission-gate da Fase 0
   (`packages/conductor-poc`), agora embrulhada numa CLI/TUI. Pergunta: o embrulho
   introduz alguma nova forma de **contornar a permission-gate**?
4. Escritas em `.conductor/` vs `.cdt/`: `init`/`migrate` **nunca** podem
   sobrescrever silenciosamente um diretório que o usuário já editou
   (`plano_desenvolvimento.md` §11.3).

**Método:** o mesmo de Shostack usado na Fase 0. Aqui o passo (1) "o que
estamos construindo" é só o **delta** de superfície; (2)–(3) enumeram e mitigam
apenas as ameaças novas (T11–T16), numeradas em continuação a T1–T10.

**Papel responsável:** `security-engineer` (skill `model-threats`), executado
como subagente.

**Insumo concorrente:** o ADR do Gate 4 desta fase
(`docs/adr/0002-fase1-cli-foundation.md`) **ainda não existia** quando este
adendo foi escrito (confirmado por `ls docs/adr/`). Pelo protocolo do projeto,
"Gate 3 e Gate 4 são iterativos". Este adendo assume o layout de
`plano_desenvolvimento.md` §4.10.1 / §11.3 (diretório `.conductor/` na raiz do
projeto). Reconciliação com o ADR 0002 fica como follow-up (§6), do mesmo modo
que a Fase 0 reconciliou com o ADR 0001.

---

## 1. Delta de superfície — o que a Fase 1 acrescenta ao DFD da Fase 0

A Fase 0 já estabeleceu o fato dominante (§2, Fase 0): **um único processo de SO,
sem sandbox, rodando com o privilégio do usuário; o único primitivo de
enforcement é `pi.on("tool_call")`**. A Fase 1 **não** muda esse fato. Ela
acrescenta três coisas em cima dele:

| Novo elemento | O que é | Relação com o DFD da Fase 0 |
|---|---|---|
| **`.conductor/config.json`** (+ `policy.json`) | Data store em disco, **dentro do workspace**, com config de provedor/modelo e **a própria política** que a permission-gate consome (protected paths, allowed roots) | Novo *data store* de segurança-relevante. Refina **TB5** (processo↔store) e — porque está dentro da raiz — vira alvo alcançável pela ferramenta `write` (**TB4**). |
| **Saída do `conductor doctor`** | Um novo *data flow* de saída: processo → stdout/relatório, derivado de config + env + estado do repo | Nova travessia de **information disclosure**, análoga a TB5 mas para *fora* (tela/arquivo de relatório que pode ser colado num chat/issue). |
| **Camada CLI/TUI (`conductor chat`)** | Camada de *render* + *input binding* que chama `session.bindExtensions({ uiContext, mode })` e desenha o prompt de aprovação num terminal real | **Não** é um novo ponto na cadeia de execução de ferramenta. Fica **ao lado** de TB1 (o canal de aprovação humano), que na Fase 0 só era exercido headless/em teste. |

**Observação de fronteira (a que mais importa nesta fase):** a introdução de
`.conductor/config.json`/`policy.json` **dentro do workspace** cria uma
travessia que a Fase 0 não tinha — a política que governa a gate agora mora num
arquivo que a própria ferramenta `write` (governada por essa gate) pode alcançar.
É o análogo de segurança do "arquivo que descreve suas próprias permissões,
gravável por quem as permissões restringem". Trata-se disso em **T13**.

O código atual confirma o ponto de ancoragem: `createConductorSession`
(`packages/conductor-poc/src/session.ts:66-72`) já resolve a auth do modelo via
`ModelRuntime.create({ authPath: join(agentDir, "auth.json"), allowModelNetwork:
false })` — ou seja, **a chave já vem da resolução de auth do Pi (`auth.json` /
env / keychain), não da config do Conductor**. A Fase 1 só precisa **não
regredir** isso ao introduzir `config.json`.

---

## 2. Ameaças novas da Fase 1 (T11–T16)

Escala idêntica à da Fase 0 (§4): Probabilidade {Baixa, Média, Alta} × Impacto
{Baixo, Médio, Alto, Crítico}; Prioridade P1…P4.

| ID | Ameaça | STRIDE | Prob | Impacto | Prio |
|---|---|---|---|---|---|
| **T11** | `config.json` guarda uma **chave/segredo cru** → commitado no git / vazado | I | Alta | Alto | **P1** |
| **T13** | Ferramenta `write` (possivelmente sob prompt injection) **reescreve `policy.json`/`config.json`** para afrouxar a própria política (allowedRoots, protected paths, provedor) | T, E | Média | Crítico | **P1** |
| **T12** | `conductor doctor` **ecoa o valor** de um segredo (env/`auth.json`/campo de config) no relatório | I | Média | Alto | **P2** |
| **T14** | Saída de ferramenta / caminho / comando **controlado pelo modelo** injeta **sequência de escape de terminal** que forja/altera o **prompt de aprovação** exibido | S, T | Média | Alto | **P2** |
| **T16** | `init`/`migrate` **sobrescreve silenciosamente** `.cdt/`/`.conductor/` já editado pelo usuário (perda de dado) | T, D | Média | Alto | **P2** |
| **T15** | Keybinding/slash-command da TUI (`/branch`, `/approve`, …) dispara efeito colateral **fora do chokepoint** da permission-gate | E | Baixa | Alto | **P3** |

### T11 — Segredo cru em `.conductor/config.json` (P1) · superfície #1
**STRIDE:** Information disclosure · **Elemento:** novo store TB5.
`config.json` é, por natureza, um arquivo **fácil de commitar por acidente** (fica
na raiz do projeto, entra em `git add .`). Se ele contiver uma API key crua, o
vazamento é praticamente garantido pelo fluxo normal de trabalho. Prob **Alta**;
Impacto **Alto**.
**Regra (secure default, decidida agora, antes da implementação):**
`.conductor/config.json` **NUNCA** contém um segredo em claro. Ele guarda apenas
**referências**: o **nome** da variável de ambiente (`"apiKeyEnv":
"ANTHROPIC_API_KEY"`), ou o **identificador** de uma entrada de keychain do SO, ou
o **id de provedor+modelo** — nunca o material da chave. A chave crua permanece
**exclusivamente** na resolução de auth do próprio Pi (`auth.json` sob o
`agentDir`, env, ou keychain), como o código da Fase 0 já faz
(`session.ts:66-72`). Isto **estende diretamente o T6 da Fase 0** ("a API key vem
da resolução de auth do próprio Pi … nunca ecoada em prompt/arg") do transcript
para o **novo arquivo de config**. Reforços de secure-by-default (não confiar no
usuário para acertar): (i) o `init` **rejeita/avisa** se um valor com forma de
segredo (p.ex. `sk-…`, alta entropia) for passado para um campo de config; (ii)
`init` grava/garante uma entrada de `.gitignore` para `.conductor/` que
contém material sensível (no mínimo `auth.json`/`credentials`), de modo que o
default out-of-the-box já é o seguro. *Grounding:* OWASP ASVS 4.0.3 **V6.4 Secret
Management** (segredos fora de artefatos que se propagam); **Penetration Testing —
Complete Professional Guide** §14.9 ("No secrets are present in any … bundle") e
§20.12 (secrets management é um *controle permanente*, não um passe pontual) —
uma config commitável **é** um artefato distribuível. Cross-ref: T6 (Fase 0).

### T13 — Automodificação da política pela própria ferramenta `write` (P1) · superfícies #1+#4
**STRIDE:** Tampering + Elevation · **Elemento:** TB4 (write → `policy.json`).
A Fase 1 coloca a **política de segurança** (protected paths, allowedRoots,
provedor consentido) num arquivo em disco **dentro do workspace**
(`.conductor/policy.json`, `config.json` — §4.10.1 do plano). Como esse arquivo
está dentro da raiz, a ferramenta `write`/`edit` — que é **governada por essa
mesma política** — pode, por padrão, gravá-lo. Um agente sob prompt injection
(T5, Fase 0) ou um erro do modelo poderia reescrever `policy.json` para
**afrouxar a própria gate** (adicionar um allowedRoot, remover um protected path,
trocar o provedor de egress) — um clássico *confused-deputy* de elevação, agora
com um alvo concreto e persistente que a Fase 0 não tinha. Prob **Média**;
Impacto **Crítico** (desarma o único controle do produto).
**Mitigação (Pi, reusando o controle que já existe):** adicionar
`.conductor/policy.json` e os campos de segurança de `.conductor/config.json` ao
**conjunto de protected paths** avaliado por `evaluateToolPath`
(`workspace-policy.ts`) — eles estão dentro do workspace, então sem isto seriam
graváveis. O efeito é: uma escrita **de ferramenta** na política é **bloqueada**
(não apenas "pede aprovação") — a política só muda por edição **fora da banda**
(o usuário no editor, ou um `conductor` command dedicado com seu próprio gate),
nunca pelo agente sobre si mesmo. É a aplicação literal do secure default 3 da
Fase 0 (protected paths sobre o real path canonicalizado) a um alvo novo.
*Grounding:* **Secure and Reliable Systems Design — Complete Professional Guide**
§3.2/§3.5 (least privilege / raio de explosão — o componente não deve poder
ampliar a própria autoridade) — citado nesta sessão para o mesmo eixo; **Secure
Code Review — Complete Professional Guide** §2.2 (taint source→sink: entrada
controlada pelo modelo alcançando um sink sensível — aqui o sink é o arquivo de
política). Cross-ref: T1/T5 (Fase 0).

### T12 — `conductor doctor` ecoa valor de segredo (P2) · superfície #2
**STRIDE:** Information disclosure · **Elemento:** novo data flow de saída.
`doctor` é feito para ser **colado** (num issue, num chat de suporte, num log de
CI). Se ele imprimir o **valor** de `ANTHROPIC_API_KEY`, o conteúdo de
`auth.json`, ou um campo sensível de config em vez de só o **status**, o próprio
ato de diagnosticar vaza o segredo. Prob **Média**; Impacto **Alto**.
**Regra (decidida agora, antes de implementar):** `doctor` reporta **presença e
forma, nunca valor**. Para cada segredo/credencial, a saída é binária/estrutural:
`ANTHROPIC_API_KEY: set` (não o valor), `auth.json: present, readable, perms 0600`
(não o conteúdo), `provider anthropic: configured` (não a chave). O `doctor`
**nunca lê o valor de um segredo para dentro de um campo imprimível**: ele checa
existência/permissão/forma. Se um fingerprint for realmente necessário para
diagnóstico, no máximo os **últimos 4 caracteres mascarados** de um identificador
**não-secreto** — jamais de material de chave. É o mesmo princípio do T6 (Fase 0)
e do ASVS V6.4 aplicado a um novo *sink* de saída. *Grounding:* OWASP ASVS 4.0.3
V6.4 (credenciais fora de logs/relatórios — um relatório de doctor **é** um log);
**Penetration Testing** §14.9 ("No secrets … in any bundle"). Cross-ref: T6.

### T14 — Injeção de escape de terminal contra o prompt de aprovação (P2) · superfície #3
**STRIDE:** Spoofing + Tampering · **Elemento:** TB1 (o canal de aprovação
humano), exercido pela primeira vez num terminal real na Fase 1.
Este é **o** check que o "só embrulhar numa CLI" merecia. O prompt de aprovação
renderiza **texto controlado pelo modelo**: em `confirm.ts`/`permission-gate.ts`
a mensagem exibida é `${event.toolName} ${event.input.path}` (write/edit) ou
`event.input.command` (bash) — strings que vêm do modelo e podem ter sido
influenciadas por prompt injection (T5, Fase 0). Na Fase 0 isso rodava headless
(o `test-ui` captura a string, não a desenha). Na Fase 1, `conductor chat`
desenha essa string num **terminal real** via `ctx.ui.confirm(title, message)`.
Um caminho/comando forjado contendo **sequências de escape ANSI/CSI/OSC** poderia
**manipular a exibição do próprio prompt** que o humano usa para aprovar — reposi‑
cionar o cursor, apagar/reescrever a linha, esconder o alvo real, ou pintar um
comando "seguro" por cima do perigoso. **Não é um bypass do chokepoint** (a gate
TB2 já decidiu antes de exibir), mas é um ataque de **integridade de exibição**
contra o controle *humano-no-loop* do qual a contenção do T5 depende — logo, é
uma superfície **genuinamente nova** da Fase 1, não coberta pela Fase 0. Prob
**Média**; Impacto **Alto** (mina a decisão em que a contenção de injeção se
apoia).
**Mitigação:** o caminho de render do confirm (o `confirm.ts` do Conductor mais o
renderer de TUI que fizer o bind de `ctx.ui`) **deve sanitizar** qualquer string
controlada pelo modelo antes de exibi-la — remover/escapar caracteres de controle
C0/C1 e sequências CSI/OSC, e renderizar o alvo como **um literal de linha única
escapado**. Tratar o texto do modelo como **dado, não como marcação de terminal**
(mesma postura da Fase 0 para conteúdo de arquivo). Responsabilidade: é do
Conductor garantir a sanitização **antes** de passar a `ctx.ui.confirm` — não
assumir que o renderer da TUI do Pi escapa (verificar; se não escapar, escapar
nós). *Grounding:* **Secure Code Review — Complete Professional Guide** §2.2/§2.5
(taint source→sink; validar/sanitizar **no sink**) — o texto do modelo é a taint
source, o renderer do terminal é o sink; é o mesmo frame do XSS aplicado ao
terminal. **Nota de cobertura honesta:** a biblioteca **não tem capítulo dedicado
a injeção de escape de terminal**; o ângulo é ancorado por analogia taint→sink,
exatamente como a Fase 0 ancorou prompt injection (T5) sem forçar citação. As
consultas fresh desta sessão a esse ângulo pontuaram fraco (top 0.633,
majoritariamente material de frontend/secrets).

### T16 — Sobrescrita silenciosa de arquivos do usuário (P2) · superfície #4
**STRIDE:** Tampering + Denial (destruição/indisponibilidade de trabalho do
usuário) · **Elemento:** `init`/`migrate` escrevendo em `.cdt/`/`.conductor/`.
É mais uma preocupação de **integridade/perda de dado** do que de confidencialidade,
mas é um requisito explícito do plano §11.3: "backup antes da transformação;
nenhum arquivo editado pelo usuário deve ser sobrescrito silenciosamente". Um
`init` ingênuo que rode sobre um projeto que já tem `.cdt/` (formato antigo) ou um
`.conductor/` editado à mão destrói configuração/memória/skills do usuário. Prob
**Média**; Impacto **Alto**.
**Regra (secure/safe default):** `init`/`migrate` é **fail-closed no estado
pré-existente**, estendendo a regra-mãe da Fase 0 (§5 item 7) do plano de controle
para o **plano de dados**: (i) **detectar** `.cdt/`/`.conductor/` existentes antes
de escrever qualquer coisa; (ii) **backup antes de transformar** (§11.3 passos 3/8/10:
gerar backup, validar hashes, permitir rollback); (iii) **nunca** sobrescrever um
arquivo editado pelo usuário — na dúvida sobre se um arquivo foi editado, **tratar
como editado** e recusar/fazer backup em vez de clobber; (iv) `init` é
**idempotente**: rodar de novo num projeto já inicializado é no-op ou merge
explícito e consentido, jamais um clobber. *Grounding:* **cobertura fraca
reportada** — as consultas fresh desta sessão a "backup antes de sobrescrever /
escrita idempotente segura / integridade de arquivo de config" pontuaram fraco
(top 0.617, retornando material de frontend/secrets, nada sobre escrita segura de
arquivo). Não forcei citação. O ângulo é ancorado por (a) **fail-closed na
incerteza** — **Security Engineering Principles — Complete Professional Guide**
§2.5/§2.9 (na dúvida, tome o caminho **não-destrutivo**; um erro/incerteza nunca
autoriza a ação perigosa), estendido aqui da autorização para a integridade de
dado; e (b) o próprio requisito do plano §11.3. É o mesmo tratamento honesto que
a Fase 0 deu ao T10 (sem passagem dedicada → não forçar).

### T15 — Efeito colateral de keybinding/slash-command fora da gate (P3) · superfície #3
**STRIDE:** Elevation · **Elemento:** camada CLI/TUI.
A TUI da Fase 1 traz comandos internos (§4.16 do plano: `/branch`, `/approve`,
`/deny`, `/tools`, …). Risco: um keybinding ou slash-command que dispare um efeito
colateral (p.ex. `/branch` rodando `git` via `child_process`, ou um atalho que
execute uma ferramenta) **fora** do caminho `pi.on("tool_call")` — exatamente a
forma do **T4(b) da Fase 0** ("código chama `child_process`/`fs` direto; o hook
nunca dispara"), agora alcançável a partir de um keybinding em vez de uma
extension de terceiros. E `/approve`/`/deny` não podem virar um jeito de
**pular** a gate — têm que ser a *entrada humana* para ela. Prob **Baixa** (é
código first-party do Conductor, sob nosso controle); Impacto **Alto**.
**Regra (design, fixada agora):** **todo** efeito colateral disparado por
keybinding/slash-command roteia pelo **mesmo chokepoint único** da
permission-gate; execução de ferramenta passa **sempre** por `pi.on("tool_call")`
— nunca um `child_process`/`fs` cru na camada de TUI. `/approve`/`/deny` são o
input de aprovação para a gate (e produzem a entrada de evidência não-repudiável
do T8, Fase 0), não um bypass. É a extensão do T8 (centralizar a aprovação no
ÚNICO handler) e do T4(b) (nenhum efeito colateral fora do dispatch) para a nova
camada de TUI — **não uma classe nova de ameaça, e sim uma regra para não
reintroduzir uma classe conhecida**. *Grounding:* **Secure and Reliable Systems
Design** §3.2/§3.5 (least privilege / chokepoint único de autorização), citado
nesta sessão. Cross-ref: T4(b), T8 (Fase 0).

---

## 3. Secure defaults acrescentados na Fase 1 (append ao §5 da Fase 0)

Os itens 1–7 da Fase 0 (§5) permanecem. A Fase 1 acrescenta:

8. **`.conductor/config.json` nunca contém segredo cru** — só referência (nome de
   env var / entrada de keychain / id de provedor). A chave crua fica na resolução
   de auth do Pi (`auth.json`/env/keychain). `init` avisa/rejeita valor com forma
   de segredo e garante `.gitignore` do material sensível (T11).
9. **`policy.json` e os campos de segurança de `config.json` são protected paths**
   — escrita de ferramenta neles é **bloqueada** (não só "pede aprovação"); a
   política só muda fora da banda (T13).
10. **`doctor` reporta status, nunca valor** — presença/permissão/forma de cada
    segredo; jamais o material (T12).
11. **Texto controlado pelo modelo é sanitizado antes de ir para o terminal** —
    o prompt de aprovação escapa caracteres de controle/sequências de escape,
    renderizando o alvo como literal de linha única (T14).
12. **`init`/`migrate` é fail-closed no estado pré-existente e idempotente** —
    detecta, faz backup antes de transformar, nunca clobber silencioso, rollback
    disponível (T16).
13. **Efeitos colaterais de TUI roteiam pelo chokepoint único** — nenhum
    `child_process`/`fs` cru na camada de CLI/TUI; `/approve`/`/deny` alimentam a
    gate, não a contornam (T15).

**Aplicação (Pi):** todos os itens 8–13 são realizáveis **hoje**, sem fork, com
os primitivos já usados na Fase 0 — `evaluateToolPath` (protected paths, itens
9), `ModelRuntime` auth resolution (item 8), `confirm.ts`/`ctx.ui` (item 11), e
código de CLI first-party do Conductor (itens 10, 12, 13).

---

## 4. Respostas diretas às quatro perguntas do gate

**(1) `config.json` guarda chave crua ou referência? → Referência, sempre.** O
arquivo guarda o **nome da env var / entrada de keychain / id de provedor**,
nunca material de chave. A chave crua permanece na resolução de auth do Pi
(`auth.json`/env/keychain — já é assim no código da Fase 0, `session.ts:66-72`).
Isto **estende o T6 da Fase 0** ao novo arquivo. Reforçado por secure-default
(rejeitar valor com forma de segredo + `.gitignore` do material sensível). Ver
T11 e secure default 8.

**(2) `doctor` pode vazar segredo na saída? → Não, por regra: status, nunca
valor.** Presença/permissão/forma para cada credencial; o `doctor` nunca lê o
valor de um segredo para um campo imprimível. Ver T12 e secure default 10.

**(3) O embrulho CLI/TUI (`conductor chat`) cria nova superfície de bypass da
permission-gate? → NÃO cria um bypass do chokepoint em si, MAS introduz uma
superfície nova adjacente que exige duas regras.** O chokepoint da gate é
`pi.on("tool_call")`, que dispara **antes** da execução de qualquer ferramenta,
**independente da UI** (`session.ts`/`permission-gate.ts`). A TUI é uma camada de
render+input que só faz `bindExtensions({ uiContext })`; ela **não** entra na
cadeia de execução de ferramenta — **TB2 permanece inalterada**. Portanto,
"embrulhar numa CLI" **não** adiciona, por si só, um caminho que pule a gate.
**Duas ressalvas reais, ambas fixadas agora como regra:** (a) **T14** — o prompt
de aprovação passa a renderizar texto controlado pelo modelo num terminal real;
uma sequência de escape ANSI num caminho/comando pode **forjar a exibição do
próprio prompt** (ataque de integridade contra o humano-no-loop, não bypass do
chokepoint) → sanitizar caracteres de controle antes de exibir; (b) **T15** —
keybindings/slash-commands (`/branch`, `/approve`, …) **não podem** disparar
efeito colateral fora do chokepoint (seria o T4(b) da Fase 0 por outra porta) →
todo efeito roteia pela gate. Com essas duas regras, o veredito é: **o embrulho
CLI/TUI não abre nova via de bypass da permission-gate.** A ressalva (a) é a
resposta honesta ao "isso merece um check de verdade": sim, havia uma superfície
nova real — a de **exibição**, não a de **execução**.

**(4) `init` pode sobrescrever `.cdt/`/`.conductor/` do usuário? → Nunca
silenciosamente.** `init`/`migrate` é fail-closed no estado pré-existente:
detecta, faz backup antes de transformar, nunca clobber de arquivo editado pelo
usuário, idempotente com rollback (§11.3 do plano). Ver T16 e secure default 12.

---

## 5. Critérios de saída deste adendo (Fase 1)

- [x] Delta de superfície da Fase 1 modelado sobre o DFD da Fase 0, sem
      re-litigar T1–T10 (§1).
- [x] Ameaças novas T11–T16 enumeradas, avaliadas (prob × impacto) e mitigadas
      com primitivo real do Pi/Conductor (§2).
- [x] Regra de segredo definida para `config.json` (referência, nunca chave crua)
      e para a saída do `doctor` (status, nunca valor) — §2 T11/T12, §4.
- [x] Verificado explicitamente que o embrulho CLI/TUI **não** cria bypass do
      chokepoint da gate; superfície nova real (T14, exibição) identificada em vez
      de assumida ausente (§2 T14, §4.3).
- [x] Integridade de `.cdt/`/`.conductor/` coberta (T16); automodificação de
      política coberta (T13, o achado novo mais forte da fase).
- [x] Secure defaults 8–13 acrescentados ao §5 da Fase 0 (§3).
- [x] Grounding com citações por livro+seção; lacunas (escape de terminal;
      escrita segura de arquivo) **reportadas honestamente** em vez de forçadas (§6).
- [ ] **Aprovação do usuário** (checkpoint obrigatório) — pendente.

**Findings críticos/altos em aberto ao fim do gate:** nenhum *não mitigado* na
Fase 1 — cada T11–T16 tem regra/secure-default realizável hoje. **T13**
(automodificação de política) e **T11** (segredo cru em config) são P1: são a
razão de a config em disco ser tratada como superfície de segurança de primeira
classe, não como mero arquivo de ajustes. Os dois riscos Críticos
**escopados-para-fora** herdados da Fase 0 (T4 código de 3os; T6 redaction de
export) **continuam abertos e devidos ao passe product-wide antes da Fase 2**
(§7, Fase 0) — a Fase 1 não os fecha nem os reabre.

---

## 6. Grounding (biblioteca) — consultas desta sessão

Backend saudável (2267 chunks). Consultas rodadas de
`C:\development\source\projects\conductor` via `cdt library "<pergunta>"
--gate 3`. **Postura honesta:** o corpus cobre bem o eixo **least-privilege /
segredos-fora-de-artefato / taint→sink**, e cobre **fraco** os eixos específicos
de **escape de terminal** e **escrita segura de arquivo** — reportado, não
forçado.

1. **Segredos fora de artefatos/logs** (T11, T12) → **OWASP ASVS 4.0.3** V6.4
   Secret Management (credenciais fora de logs/bundles); **Penetration Testing —
   Complete Professional Guide** §14.9 ("No secrets are present in any … bundle"),
   §14.2 (supply chain / secrets como vetor de vazamento) e §20.12 (secrets
   management é controle *permanente*). Match moderado (top ~0.62). É o mesmo
   eixo do T6 da Fase 0, aqui aplicado a `config.json` e à saída do `doctor`.

2. **Least privilege / raio de explosão / chokepoint único** (T13, T15) →
   **Secure and Reliable Systems Design — Complete Professional Guide** §3.2/§3.5
   (um componente não amplia a própria autoridade; raio de explosão contido) —
   citado nesta sessão; reforçado por **Security Engineering Principles** §1.2
   (least privilege). Aplicado à automodificação de política e ao roteamento pelo
   chokepoint único.

3. **Taint source→sink / validar no sink** (T13, T14) → **Secure Code Review —
   Complete Professional Guide** §2.2 (taint analysis: source→sink — a maioria das
   vulns de alta severidade é dado tainted alcançando um sink) e §2.5 (sanitizar
   **no sink**). É a âncora defensável para: (a) texto do modelo alcançando o
   arquivo de política (T13) e (b) texto do modelo alcançando o renderer do
   terminal (T14) — mesmo frame do XSS, outro sink.

4. **Fail-closed na incerteza** (T16) → **Security Engineering Principles —
   Complete Professional Guide** §2.5/§2.9 (erro/incerteza **nega**/toma o caminho
   seguro) — estendido aqui da trilha de autorização para a **integridade de
   dado** (na dúvida, não destrua). Combinado com o requisito do plano §11.3.

**Lacunas de cobertura reportadas (não forcei citação):**
- **Injeção de escape de terminal** (T14): sem capítulo dedicado; ancorado por
  analogia taint→sink (Secure Code Review §2.2/§2.5), como a Fase 0 fez com prompt
  injection (T5). Consulta fresh desta sessão a esse ângulo: top 0.633, material de
  frontend/secrets.
- **Escrita segura de arquivo / backup antes de sobrescrever / idempotência**
  (T16): sem passagem dedicada; ancorado por fail-closed-na-incerteza + plano
  §11.3. Consulta fresh desta sessão: top 0.617, sem match sobre escrita de
  arquivo (retornou frontend/secrets). Mesmo tratamento honesto do T10 (Fase 0).

**Reconciliação pendente (follow-up):** o ADR 0002 (Gate 4, layout da CLI) ainda
não existia na escrita deste adendo. Quando aterrissar, verificar consistência de:
(i) onde `config.json`/`policy.json` residem (assumido `.conductor/` na raiz,
§4.10.1/§11.3); (ii) se algum comando novo (`doctor`/`migrate`) introduz um
data flow de saída ou uma travessia não modelada aqui. Se sim, **voltar a este
Gate 3** antes de avançar (protocolo iterativo Gate 3 ↔ Gate 4).
