# ADR 0005 — Fase 4 (Gates e evidências): a máquina de estados de governança (`GateState`) persistida, fail-closed, com mint de sign-off por construção, verdict tri-estado terminal e store protegido

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-06
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 4 — Gates e evidências` (`plano_desenvolvimento.md` linhas 1324-1349), branch
  `feature/fase4-gates-e-evidencias` (de `develop`)
- **Autor (papel):** software-architect, com delegação via Task tool a `backend-engineer` (mecanismo de
  persistência atômica em Windows, formato/localização, checksum, assinaturas TS) e `security-engineer`
  (reconciliação R22–R28 ↔ decisão de arquitetura — mandato do Gate 3 §7; canal de sign-off, verdict,
  fronteira nova do store)
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças criam um ADR sucessor, não editam este. Este ADR **não edita**
  os ADRs 0001/0002/0003/0004 — ele os **aplica**: o Permission Gate/Engine (PDP/PEP), os protected-paths
  (`defaultProtectedPaths`, `workspace-policy.ts`), o Audit Trail (`audit-trail.ts`), o canal de confirmação
  humana (`confirm.ts`), o padrão de mutação atômica (`shared-budget.ts`) e o contrato de evidência
  derivada-do-runtime (`task.ts:DelegationEvidence`) são **insumos**, citados por arquivo onde usados.

- **Insumo herdado:**
  - **ADR 0003** (`docs/adr/0003-fase2-security-architecture.md`) — o Permission Gate (PEP,
    `permission-gate.ts`), o envelope fail-closed (`fail-closed.ts`), o Audit Trail append-only que **lança**
    em falha de I/O (`audit-trail.ts`), o enum `ApprovalMethod` e a regra "never collapse yes-flag into human",
    o canal de confirmação humana com timeout fail-closed (`confirm.ts`), e a lista `defaultProtectedPaths()`
    (`workspace-policy.ts`). **Tudo reusado, nada reescrito.**
  - **ADR 0004** (`docs/adr/0004-fase3-roles-skills-subagents.md`) — o `SharedBudget.reserve()`
    (check-e-reserve síncrono, zero `await` no corpo → atomicidade por construção no event-loop), o contrato
    `DelegationEvidence`/`assertValidTaskToolResult` (evidência = referência conferível, não alegação), a
    tabela `BUILTIN_GATE_ROLES` (`builtin-roles-data.ts`).
  - **Gate 3 addendum Fase 4** (`docs/conductor/gate3-addendum-fase4.md`) — 7 ameaças novas (T40–T46), as
    **7 regras vinculantes R22–R28** (§4) que esta arquitetura DEVE respeitar, as **4 lacunas GAP-4A…D** (§5),
    e o gatilho de retorno iterativo (§7). **É o insumo vinculante desta fase.**
  - **Gate 2 spec Fase 4** (`docs/conductor/gate2-spec-fase4.md`) — 15 FR (grupos A–F), 10 BR, 8 edge cases,
    6 goals (G1–G6), e as 7 perguntas em aberto (§9) roteadas para este gate.
  - **Referência de comportamento (semântica, não código a portar):** `conductor-main/conductor/gate_land.py`
    — o verdict de 3 valores (`Allow`/`Deny`/`Override`/`CouldNotEvaluate` + `Completeness`), o
    construction-token (`_CneToken`/`_could_not_evaluate` como única factory), `_is_approval` (allowlist
    positivo por regex, nunca substring), o chaveamento `(repo_id, branch)` (D7/D8), a lição "propriedade
    terminal, não enumeração de causas" (F10). **A direção lá é fail-OPEN** (nunca travar o `git push` do
    usuário); **a do `GateState` é fail-CLOSED** — a mesma disciplina, direção invertida (spec §8.6).

- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, CLAUDE.md Gate 4):** §14 reconcilia ponto a ponto com o
  addendum do Gate 3 e **reporta de volta a ele** a fronteira de confiança nova que a decisão de localização
  do store expõe — a qual o `security-engineer` classificou como **controle obrigatório antes de fechar o
  Gate 4**, não apenas residual a re-declarar.

---

## 1. Contexto

### 1.1 O que a Fase 0–3 já entregou (código lido nesta sessão, não assumido)

- `confirm.ts:confirmOrDeny` — o **único** sink de confirmação interativa: `!hasUI → deny`; `reject`/`timeout →
  deny` (nunca allow-on-timeout); `true → allow`. Sanitiza título/mensagem num único ponto.
- `permission-gate.ts` — o **único** lugar onde `approvalMethod:"human"` é cunhado: nos ramos que rodam
  **após** `confirmOrDeny` retornar `true` (linhas ~182-189, 224-233, 259-266). O enum vive em
  `audit-trail.ts`: `ApprovalMethod = "human" | "yes-flag" | "allowlist" | "none"`, com a regra FR-21/BR-11
  "must always be distinguishable — never collapse yes-flag into human".
- `audit-trail.ts` — log append-only, escrita síncrona que **lança** em falha de I/O ("pre-write, not
  best-effort-after"); é um **protected-path** (`.conductor/audit.jsonl`) — o próprio agente não pode
  reescrever o registro dos seus próprios atos via `write`/`edit`.
- `shared-budget.ts:reserve()` — check-E-reserve numa **única chamada síncrona, zero `await` no corpo**: a
  atomicidade no event-loop single-threaded é **por construção**, não por lock. É o padrão que a mutação de
  `GateState` porta (R27).
- `task.ts:DelegationEvidence`/`assertValidTaskToolResult` — evidência é **referência conferível**
  derivada-do-runtime (transcript disco-backed, `filesTouched` do AuditTrail, `tokenCost` do `settle()`),
  nunca a prosa do filho. É o contrato que o Grupo C (evidência de gate) generaliza (R25).
- `builtin-roles-data.ts` — `BUILTIN_GATE_ROLES` (papéis por gate, verbatim de `roles.py`). **Achado
  verificado pelo `security-engineer`:** **não existe** constante `MANDATORY_GATES` em nenhum package do `pi`
  (o único hit de grep é prosa não-relacionada num template `tech-lead.md`) — ela **precisa** ser criada aqui.
- `write-config.ts` — **já usa** escrita temp-em-mesmo-dir + `renameSync` para `.conductor/config.json`
  (achado do `backend-engineer`, não estava na lista de contexto). É o precedente in-repo de escrita atômica
  a reusar, não reinventar.
- `workspace-policy.ts:defaultProtectedPaths()` — cobre `.conductor/{config,policy,policy-trust}.json`,
  `.conductor/audit.jsonl`, `~/.conductor/credentials` — **e nada mais**.

**Correção de precedente (achado do `backend-engineer`):** a spec §5 FR-12 citou `.cdt/config.json` como
precedente de "schema versionado desde a 1ª escrita" — mas `.cdt/` é convenção do projeto-pai Python, **não
existe** nesta árvore `pi`. O precedente in-repo real e mais forte: `packages/evals/src/vitest-evals/
harness-table.ts` (campo literal `schemaVersion: 1` + `canonicalizeJson` + `sha256`) e
`packages/ai/scripts/model-data.ts` (lança em mismatch de versão **nomeando** esperado-vs-atual).

### 1.2 O fato dominante herdado — e a torção da Fase 4

O fato dominante (Fase 0–3): **um único processo de SO, sem sandbox**, com o privilégio do usuário; **não há
servidor de auth**, não há segundo principal, não há kernel de isolamento. Toda garantia é **política dentro de
um processo confiado**.

A torção da Fase 4 (Gate 3 §0, o achado que molda tudo): as fases anteriores governavam **atos** (uma tool
call, um spawn); o chokepoint decidia allow/deny **no instante do ato**. A Fase 4 protege um objeto de natureza
diferente — um **registro de governança persistido**: a afirmação durável "esta demanda **passou** pelo Gate N,
**aprovada por** fulano". O ataque não é mais "rode algo perigoso agora"; é **"grave um fato de aprovação que
não aconteceu"** ou **"leia um estado e conclua avançar quando o estado não prova isso"**. Forjar um `Approval`
**fabrica o próprio ato de governança** — a diferença entre adulterar o log de quem entrou no prédio e
**assinar você mesmo a autorização de entrada**. O invariante #11 ("sign-offs não podem ser fabricados") é
literalmente desta fase.

### 1.3 Atributos de qualidade priorizados para esta decisão

Herdados da ordem de ADR 0003 §1.3 / 0004 §1.3, porque a Fase 4 constrói o **registro de autoridade** de que
todo o resto depende, e a tensão central é resolvida a favor do item mais alto. *Grounding:* **Software
Architecture and Quality Attributes §1.12** (top **0.605** nesta sessão — "treat a decision as architectural
[apenas] where it is hard to reverse and shapes a quality attribute"; um formato de aprovação persistido é
exatamente os dois) e **§3.9/§3.4** (herdado — "rank the few [attributes] that dominate; make sensitivity
points explicit").

1. **Fail-closed / não-forjabilidade do registro de governança** — nenhum caminho de erro, default, `catch`,
   env var, `whoami` ou campo settable pode produzir "avançar" ou "aprovado-por-humano"; toda incerteza nega
   (*Security Engineering §2.9/§2.12*, top **0.705**, "an error must never read as permission").
2. **Não-over-claim (honestidade da garantia)** — a máquina afirma que a evidência **existe e é conferível**
   (Tier-1), nunca que ela **prova** o gate (Tier-2); afirma que "human" passou pelo **canal**, nunca que
   provou a **pessoa**. O residual crypto é **re-declarado**, não escondido.
3. **Queryabilidade sem reabrir a sessão** — `gate status` responde "esta demanda pode avançar?" objetivamente,
   sem a conversa que produziu o estado (G1). *Grounding:* **Domain-Driven Design §1.1/§1.12** (herdado —
   "code will be edited by people who were not in the conversation that settled it").
4. **Baixa complexidade acidental** — **nenhum** segundo canal de confirmação, **nenhum** pacote novo, reuso
   dos primitivos da Fase 2/3. *Grounding:* **Architecture Boundaries §1.12** (herdado — "sem policy, a
   interface é puro custo") e **Object-Oriented Thinking §3.12** (top **0.547** — "variants closed by something
   outside you": o conjunto de `status`/verdict é fechado pelo plano, não por nós).

---

## 2. Decisão central — o `GateState` como máquina de estados persistida, com I/O na borda e política pura no meio

**Decisão:** materializar o fluxo de 14 gates (hoje inteiramente **protocolo de prompt**) como um `GateState`
persistido por demanda, mutado por **cinco pontos de comando** (`gate start/status/evidence/approve/reject`
+ `gate calibrate`), com a **regra de dependência** aplicada literalmente:

- **Borda (adapter de I/O):** o `GateStateStore` — ler/escrever o arquivo, lock, checksum, temp+rename. É o
  **único** lugar com `fs`.
- **Meio (política pura, sem I/O):** as funções de decisão — `evaluateAdvance` (o verdict tri-estado, R26),
  `isMandatorySatisfied` (o piso `{3,5,7,8,9}`, R23), `evaluateCalibration` (o teto, R24). Puras,
  unit-testáveis **sem disco/UI**, contra um `GateState` em memória — a mesma carta que o PDP puro
  (`permission-engine.ts:decide`) vs. o PEP fino (`permission-gate.ts`) e o `runTask` puro vs. o
  `spawnChildSession` (ADR 0004 §2). *Grounding:* **Architecture Boundaries §3.4** (top **0.571** — "I/O at
  the edges, policy in the middle; a use case is a function of data in → data out") e **§3.12** (top 0.573 —
  "purity is worth paying for when the rule is a **decision** — branches, invariants" — o verdict É uma decisão
  de invariante, o lugar exato onde a pureza se paga).

Isto **não** é slideware: cada ponto de comando é um comando CLI concreto (§13 apêndice), o piso obrigatório é
uma constante importada de um lugar só, e o verdict é um tipo TS que o Gate 5 escreve como teste falho antes de
qualquer implementação.

---

## 3. Persistência — formato, localização, escrita atômica (R27, FR-12/14/15)

### 3.1 Formato e localização (decisão #1)

- **Um arquivo por demanda:** `.conductor/gates/<sanitized-branch>--<hash8>.json`. `sanitized-branch` = branch
  com o conjunto ilegal-no-Windows (`\ / : * ? " < > |`) substituído; `hash8` = 8 hex de `sha256(branch)`
  anexados, para que duas branches que colidam após sanitização (`feature/foo-bar` vs `feature-foo/bar`) nunca
  se sobrescrevam. O nome é humano-scaneável mas **nunca autoritativo**.
- **Conteúdo, não nome, é a verdade:** o envelope carrega `demandId`, `repoId`, `branch`; todo reader
  **verifica** esses três contra o esperado **antes** de confiar no arquivo — a mesma disciplina que R23 já
  vinculou para o `Approval` (chaveado a gate+demanda+branch, portando o `(repo, branch)` D7/D8 de
  `gate_land.py`), aplicada agora ao envelope.
- **Versão de schema desde a 1ª escrita (FR-12):** `schemaVersion: 1` como **literal** (não `number`), de modo
  que um v2 vira união discriminada — precedente in-repo `harness-table.ts` (literal `schemaVersion: 1`,
  retorna `undefined`/nunca adivinha em mismatch) e `model-data.ts` (lança nomeando esperado-vs-atual). Um
  schema/versão que não bate → `could-not-verify` (R26), nunca adivinhação de forma.

### 3.2 Escrita atômica em Windows (R27/FR-14) — verificado pelo `backend-engineer`

- `fs.renameSync` em Windows → libuv → `MoveFileExW(src, dst, MOVEFILE_REPLACE_EXISTING)`: **substitui** o
  destino existente e o NTFS trata o rename como atômico para um leitor **no mesmo volume** — por isso o temp
  **tem que** ser criado no **mesmo diretório** do alvo, nunca em `os.tmpdir()`. `write-config.ts` **já faz
  exatamente isso** hoje — reusar, não reinventar.
- **`reserve()` porta direto:** ler → mutar → escrever-temp → `fsync` → `rename` é **uma pilha síncrona sem
  `await`/microtask no meio** → o event-loop single-threaded torna o caso **in-process** atômico por
  construção (propriedade real de `shared-budget.ts:reserve()` linhas 74-86, não uma alegação nova).
- **Gap fechado:** `write-config.ts` **não** faz `fsync` do fd temp antes do rename — aceitável para config, não
  para um **registro de aprovação**. Aqui: abrir temp, escrever, `fsyncSync(fd)`, fechar, `renameSync`.
- **Residual honesto declarado (para o Gate 5/6 testar em CI Windows real, como `audit-trail.ts` já faz para
  O_APPEND):** (a) `MoveFileExW` pode falhar `EPERM`/`EBUSY` quando Defender/indexador/backup segura um handle
  transitório — precisa de **retry com backoff limitado**, não single-shot; um teste tem que segurar um handle
  no temp durante o rename e assertar o caminho retry-then-`io-error`. (b) Windows **não tem** equivalente
  limpo do "fsync do diretório-pai" do POSIX para commitar durably o **rename em si** — a assimetria é real e é
  **nomeada**, não glosada.

### 3.3 Escritor único cross-process (R27) — verificado pelo `backend-engineer`

O argumento do event-loop **não** cobre dois processos `conductor gate ...` separados (ou o CLI + uma sessão
viva). Logo, dois controles independentes (belt-and-suspenders, como a Fase 2 já pratica):

1. **Lock exclusivo:** `fs.openSync(lockPath, "wx")` = `O_CREAT|O_EXCL` (POSIX) / `CREATE_NEW` (Windows) — criar
   atômico se-ausente nos dois; o perdedor da corrida recebe `EEXIST` deterministicamente. Segurado por toda a
   read-modify-write. Conteúdo do lock: `{ pid, acquiredAt }`. **Lock stale por IDADE** (não por liveness de
   PID — não há `process.kill(pid,0)` confiável em Windows): um lock mais velho que um bound generoso (»
   read-modify-write-fsync-rename, ex. 30s) é **renomeado para o lado atomicamente**
   (`renameSync(lock, lock+".stale-"+Date.now())`) e a aquisição é retentada — nunca delete-e-siga silencioso
   (reintroduziria a corrida).
2. **CAS por `revision`** (backstop de defesa-em-profundidade): um contador monotônico no estado; uma escrita
   que encontrar `revision-em-disco ≠ revision-que-leu` retorna **`could-not-verify`** (R26), nunca sobrescreve.
   Isto converte "o lock foi de algum modo contornado" de um **lost-update silencioso** numa **recusa loud** —
   o lock é a otimização de contenção, o CAS é a **garantia de correção**. Mesmo uma quebra-de-stale errada (o
   processo "morto" não estava morto) degrada para `could-not-verify` no perdedor, nunca lost-update.

*Grounding:* **Messaging and Integration Patterns §3.3/§3.4** (top **0.611** — "assume duplicates, design
idempotency; a processed-id store / naturally idempotent write") — diretamente análogo a "assuma um escritor
concorrente, **detecte** em vez de sobrescrever". **Cobertura honesta:** a biblioteca **não cobre**
especificamente atomicidade de `rename` em Windows, mecânica de lock `O_EXCL`, nem CAS/TOCTOU — seis consultas
`--gate 4` toparam 0.50–0.61 em capítulos off-target; declarado, ancorado no invariante #14 do plano + no
comportamento já testado de `reserve()`/`write-config.ts`, **não forçado**.

---

## 4. Conjunto obrigatório imposto ao vivo, de fonte única (R23, decisão #4)

- **Nova constante canônica** em `packages/conductor-config/src/builtin-roles-data.ts`, ao lado de
  `BUILTIN_GATE_ROLES` (irmão canônico correto — mesmo arquivo, mesma disciplina "verbatim de `roles.py`,
  fonte única"):

  ```ts
  export const MANDATORY_GATES: ReadonlySet<number> = new Set([3, 5, 7, 8, 9]);
  ```

  Resolve a discrepância BR-10/§9.1 (`CLAUDE.md` `{3,5,7,8}` vs. `roles.py:MANDATORY_GATES` `{3,5,7,8,9}`)
  **para `{3,5,7,8,9}`** — decisão já registrada no diário do Gate 2 desta demanda, por dois motivos: (1) o
  princípio do próprio conductor-main "assert behaviour over prose — nossa própria prosa já errou antes" (o
  código de fato aplicado por `gate_land.py` pesa mais que a documentação); (2) empírico **desta sessão** — o
  Gate 9 (pentest de aplicação) achou e corrigiu criticais reais na Fase 2 (bypass de `--yes`). Importado de
  **um lugar só** (BR-10), nunca duplicado à mão.
- **`gate start N`** recusa **fail-closed** (nomeando o faltante) se qualquer gate de `MANDATORY_GATES` `< N`
  **não coberto por calibração** (§5) não está `approved`. `rejected` bloqueia **tanto quanto** `not-started`
  (FR-9 generalizado).
- **`gate approve` de um obrigatório** recusa se o gate está `not-started`/`rejected` **ou** tem zero
  `Evidence` (FR-8/BR-6) — "aprovar o Gate 9 sem rodar" é exatamente "aprovar um obrigatório vazio".
- **Chaveamento anti-spoofing (forma de `_is_approval` + D7/D8):** um `Approval` só conta para o Gate N se for
  **estruturalmente de (gate N, este demandId, esta branch)** — nunca substring, nunca emprestado de outro
  gate/demanda/branch. Fecha T42.

---

## 5. Teto de calibração — a calibração nunca alcança o piso obrigatório (R24, decisão #5)

O `CLAUDE.md` **permite** colapsar gates para demandas pequenas (FR-3) — feature, não bug. O teto de segurança:

- Um `Decision` de calibração (`kind: "calibration"`, campo `collapsedGates`) só pode colapsar gates **fora**
  de `MANDATORY_GATES`. `evaluateCalibration` **recusa no momento de registrar** (`gate calibrate`) qualquer
  colapso que **nomeie** um obrigatório — o piso é intocável pela calibração, "regardless of how small the
  change looks" (BR-1). Estruturalmente impedido: a calibração opera só sobre o complemento, então SF5 (o
  registro de calibração) **não pode** virar um bypass de SF4 (o piso).
- Um salto (`gate start N` pulando gates intermediários) só é permitido se há um `Decision` de calibração
  **registrado e atribuído** cobrindo os gates pulados (todos no complemento); sem ele, recai em FR-2/R23
  (recusa). Um colapso **é** um registro auditável, nunca uma omissão.
- A calibração carrega o **mesmo `approvalMethod` (human/auto)** que qualquer aprovação (R22): um leitor
  posterior vê "o laço autônomo decidiu colapsar estes gates" vs. "um humano decidiu" — nunca ambíguo.
  `gate status` mostra **quais** gates foram colapsados e **por qual método**.

---

## 6. Canal de sign-off — mint por construção, um sink, dois entry points (R22, decisão #2)

**Verificado e confirmado pelo `security-engineer`, com uma condição vinculante.**

- **`gate approve` não escreve `method:"human"`.** Ele roteia pelo **mesmo** `confirmOrDeny` (o sink
  interativo com timeout fail-closed). `method:"human"` é cunhado **só** numa **factory com construction-token**
  — `mintHumanApproval(confirmResult)` — espelhando o `_CneToken`/`_could_not_evaluate` de `gate_land.py`: um
  literal `{ method: "human" }` de qualquer chamador **não** é um `HumanApproval` válido (o campo não é
  settable; a única forma ergonômica de obtê-lo é a factory).
- **Um sink, dois entry points (BR-8):** (a) o checkpoint em `/cdt` via `ctx.ui.confirm()`; (b) o `gate approve`
  standalone via o **mesmo** `confirmOrDeny`. **Condição vinculante do `security-engineer`:** o input booleano
  do mint **tem que vir do próprio `confirmOrDeny`** (ou de um sink que compartilhe suas duas invariantes:
  `!hasUI → deny`, `timeout/reject → deny`). Um CLI que role **seu próprio prompt readline** e depois chame o
  mint é um **segundo sink** — a classe exata que o doc-comment de `confirm.ts` existe para prevenir (o timeout
  de `ctx.ui.confirm` "is not guaranteed across run modes"). O token sozinho **não** cobre isso; a factory
  **consome o resultado de `confirmOrDeny`**, nunca um confirm paralelo.
- **O modo autônomo é estruturalmente incapaz de cunhar "human":** o `/cdt-auto`/`/cdt-triage` roda headless
  (sem UI/TTY) → `confirmOrDeny` nega (`!hasUI → deny`) → num gate obrigatório o `GateState.status` fica
  `needs-human` (FR-11), nunca `approved`. Não é convenção de prompt; é a mesma incapacidade estrutural que o
  `--yes`/allowlist já têm de virar "human" na Fase 2.

**Ruling A (pedido ao `security-engineer`) — "presença humana = uma confirmação TTY interativa que o laço
autônomo estruturalmente não pode fabricar" é a leitura correta e completa?** **Sim — é o teto honesto** para
um CLI local sem servidor de auth, **com uma precisão sobre "completa":** o sinal **não** pode ser a mera
**existência** do TTY (`isTTY`) — isso é o canal **existir**, não **alguém ter respondido**; `isTTY`-como-prova
seria o erro `whoami` deslocado uma camada. O mint é gated no `confirmOrDeny` **resolvendo `true`**, não em
haver um TTY. Com isso, env var/`whoami` **não** reentram: o único sinal é `hasUI` + resolução do confirm.
**Residual re-estabelecido:** o canal autentica (passou pela confirmação interativa), **não a identidade da
pessoa** ao teclado — mesmo teto que `audit-trail.ts` já aceita.

*Grounding (via `security-engineer`):* **Building Secure and Reliable Systems §3.3/§3.8** (zero-trust: "network
location grants no authority"; "no standing ambient authority"; **"sensitive actions require multi-party
authorization"** — o sign-off é a ação sensível que exige a segunda parte, o humano no canal), **§3.12**;
**Security Engineering §2.9/§2.12** (top **0.705** — "uncertainty deny; an error must never read as
permission"). Precedente de código: `permission-gate.ts` (mint só pós-`confirm()`), `gate_land.py` threat E
(rejeita env var). Lacuna "humano-vs-automatizado em trail local" **já declarada** (0.63–0.64) — não
re-forçada.

---

## 7. Verdict tri-estado, terminal (R26, decisão #3)

```ts
type GateAdvanceVerdict =
  | { kind: "approved" }
  | { kind: "refused"; missingMandatoryGates: number[]; reason: string }
  | { kind: "could-not-verify"; reason: string };
```

- **Os dois últimos bloqueiam** (o fail-closed alinha a direção); `could-not-verify` é **loud e registrado**
  (não silencioso) — distinguível de `refused` para que o operador saiba *por que* foi negado (o estado não
  passou vs. o estado não pôde ser lido). Espelho fail-closed da `Completeness` de 3 valores de `gate_land.py`.
- **Propriedade terminal:** qualquer incerteza (I/O, schema, checksum, CAS, exceção de causa não-antecipada) →
  `could-not-verify`, **nunca** `approved`. `approved` só nasce de um **sucesso positivo avaliado** — nunca
  default, fallback ou valor de `catch`.

**Ruling B (pedido ao `security-engineer`) — construction-token em `approved`, ou não?** **Não coloque token em
`approved`.** O controle honesto é a **união exaustiva + um teste comportamental de propriedade terminal** (o
análogo de `TestF10ArbitraryExceptionNeverProducesASilentAllow`: injeta uma exceção de classe não-antecipada e
assevera `could-not-verify`, nunca `approved`) + default fail-closed em cada boundary. *Grounding:* **Security
Engineering §1.12** — o valor de um controle mede-se **pela falha que previne, não pela contagem**; um token no
valor livremente-construível e comum (`approved`) adiciona cerimônia ao caminho de pass genuíno e **não**
defende a direção perigosa — esta é mantida por (1) a distinção de tipo (um `return {kind:"approved"}` dentro de
um `catch` é uma **mentira visível, revisável, testável**); (2) o teste terminal; (3) o default que nega. É a
própria lição ADR-0014 A1.4 de `gate_land.py`, espelhada na inversão fail-open→fail-closed.

**Precisão que o `security-engineer` afiou:** o token de `gate_land.py` **não** está lá por anti-forja — está
para **acoplar o valor a um efeito colateral obrigatório** ("holding a `CouldNotEvaluate` obtained through this
factory is proof a signal was attempted"). Aplicando isso **literalmente** à Fase 4: o valor com efeito
obrigatório aqui é **`could-not-verify`** (R26 ii, "loud e registrado") — logo, **se** algum token existisse
nesta máquina de verdict, seu lar natural seria `could-not-verify` (garantir que o registro loud foi tentado),
**jamais `approved`**. E o controle de não-forjabilidade **durável** que de fato importa não está no verdict
transitório — está em **como o `Approval{method:"human"}` foi construído e onde ele mora** (§6/R22 sole-mint +
§9.1 protected-path), **não** em recomputar `isGenuineHumanApproval`/o brand `HUMAN_MINT` sobre um registro **já
persistido e relido**.

**Correção (Gate 9 pentest, achado A, SEV BAIXA — o parágrafo acima super-afirmava isto):** `HUMAN_MINT` é um
`Symbol()` module-private; `JSON.stringify` **não serializa chaves `Symbol`**, então depois que um `Approval` é
persistido em disco (§3) e relido, a propriedade `[HUMAN_MINT]` **some** — `isGenuineHumanApproval` retorna
`false` para **todo** `Approval` persistido, genuíno ou forjado igualmente. Ou seja: `isGenuineHumanApproval` é
uma checagem **EM MEMÓRIA, no mesmo processo, logo após o mint** (o exato momento em que `mintHumanApproval`
devolve seu valor a `gate approve`, antes de qualquer `JSON.stringify`) — **não** é uma auditoria de um registro
já em disco, e o `GateState` não tenta recomputá-la ao ler um `GateStateEnvelopeV1` de volta (§3/§9.2 só
recomputam o checksum `sha256`, que é anti-acidente, não anti-forja — ver §9.3). A garantia **durável** de
verdade — a que sobrevive a um processo terminar e o arquivo ser relido depois — é a soma de duas propriedades
**estruturais**, não uma verificação em tempo de leitura: (1) **sole-mint** — `mintHumanApproval` é o único
lugar do pacote que escreve o literal `method: "human"` (confirmado por scan estático,
`gate-approval-sole-mint.test.ts`); (2) **protected-path** (§9.1) — `.conductor/gates/` é protegido, então
nada fora dos comandos `gate *` escreve o arquivo sem passar por (1). Consertar a checagem em tempo de leitura
para que sobreviva à serialização (ex.: uma assinatura HMAC persistida fora do brand-symbol) **seria** a fix de
verdade para tamper-evidence real contra um editor local — mas isso é exatamente o residual criptográfico já
adiado e re-declarado em §9.3 (GAP-4D); este parágrafo só corrige a afirmação, não implementa essa fix agora.
*Grounding:* **Spec-Driven Development §19.1/19.5** (top **0.706** — "governance preserves the *why*... a
record that has fallen out of date is worse than none, because people still read it": a razão para corrigir a
afirmação em vez de deixá-la, mesmo sem mudar código).

---

## 8. Contrato de evidência — Tier-1 imponível, Tier-2 é do revisor (R25, decisão #6)

Generaliza `DelegationEvidence` (Fase 3, "uma delegação") para "um gate inteiro". Confirmado pelo
`security-engineer`:

- **Tier-1 — integridade referencial (mecanicamente imponível, fail-closed):** `--ref` é **obrigatório** (FR-5)
  **e tem que resolver** para um objeto real e abrível **deste repo/runtime** — um SHA que `git rev-parse`
  resolve neste repo, um arquivo que existe (dentro do workspace), um id de journal/test-run que o **runtime de
  fato gravou**. Um ref pendurado/inexistente é **recusado** (não se anexa uma evidência que ninguém pode
  abrir) — a mesma disciplina de `assertValidTaskToolResult`.
- **Tier-2 — relevância ("o commit implementa mesmo o gate? o teste rodou e passou?") — NÃO mecanicamente
  decidível:** é **Non-goal**, julgamento do revisor (Gate 8/9). O `GateState` **não pode AFIRMAR Tier-2** —
  afirma só existência + referenciabilidade + não-forjabilidade-no-observado (G3). "ref anexado" **nunca** é
  "gate provado".
- **Runtime-derived preferido (R14 portado):** onde o runtime pode derivar a evidência (test-run-id que ele
  gravou, `git diff` real, registro de tool-calls), essa forma **vence** um `--ref` digitado à mão, e um `--ref`
  auto-declarado **não** a substitui para fechar um obrigatório (BR-6).

*Grounding (via `security-engineer`):* **Secure Code Review §2.12** ("a completed trace is evidence about that
question and about nothing else … not a coverage claim"); **Security Engineering §2.9** (ref que não resolve →
nega). Precedente: `task.ts:assertValidTaskToolResult`.

---

## 9. Store protegido + checksum + residual re-declarado (R28 + fronteira nova do `security-engineer`)

### 9.1 O store do `GateState` é um **protected-path obrigatório** (fronteira nova — CONTROLE, não só residual)

O `security-engineer` levantou — e classificou como **vinculante antes de fechar o Gate 4** — a fronteira de
confiança que a decisão de localização (§3.1) expõe: `defaultProtectedPaths()` cobre hoje só
`.conductor/{config,policy,policy-trust}.json` + `audit.jsonl` + credentials. Um store novo **não** é coberto
por construção. **Se** o Gate 4 não adicionar o caminho do `GateState` aos protected-paths, o **próprio agente**
pode reescrever suas próprias aprovações pelo tool `write`/`edit` normal — e o residual de T44/R28 deixa de ser
"acesso local ao disco **fora** do loop" (o risco aceito das fases anteriores) e passa a ser **o invariante #11
forjável pelo caminho mais provável de todos: o loop escrevendo o próprio sign-off**.

**Decisão vinculante:** o subtree `.conductor/gates/` inteiro (os arquivos `<demand>.json` **e** os `.lock`) é
adicionado a `defaultProtectedPaths()`, simetricamente a `audit.jsonl` ("o registro deve ser inapagável pelo
próprio agente cujos atos ele registra", `workspace-policy.ts:116`). Assim, a **única** mutação de `GateState` é
via os comandos `gate *` (que passam por R22/R27); `write`/`edit`/`bash` sobre esse subtree são **negados**.
Isto é a **terceira camada** da não-forjabilidade do invariante #11 para um CLL local:

1. **Construction-token** (§6) → o código em execução não cunha "human" sem passar pelo confirm.
2. **Protected-path** (esta §) → os próprios tools do agente não escrevem/editam o arquivo diretamente.
3. **Residual declarado** (§9.3) → um ator com acesso cru ao disco **fora** do loop ainda pode; exige crypto
   keyed; adiado + re-declarado.

### 9.2 Checksum — integridade-contra-acidente, não tamper-evidence (R28)

Um checksum `sha256` sobre o **corpo canônico** (envelope), recomputado na leitura; mismatch →
`could-not-verify` (fail-closed, loud), distinguível de um parse óbvio. **JSON canônico (ordem de chave
estável) é necessário** para o checksum ser estável — reusar `canonicalizeJson` de `harness-table.ts` (ordena
chaves, rejeita `NaN`/`Infinity`/circular), **não** escrever um segundo. **Gotcha (backend-engineer):** todo
campo de timestamp do `GateState` tem que ser **string ISO-8601 antes** de chegar ao checksum (misturar objetos
`Date` com o canonicalizer é a armadilha de corrupção silenciosa) — mesma disciplina `isValidIsoTimestamp` de
`audit-trail.ts`.

### 9.3 Residual re-declarado (GAP-4D) — decisão consciente exigida dos autores dos ADRs 0002/0003

Um checksum **no mesmo domínio de confiança não** defende contra o editor local (ele recomputa o hash) — só
pega corrupção **acidental** (torn-write de T43, bit-rot). Tamper-evidence **real** contra um editor local exige
**crypto keyed fora do arquivo** (HMAC/assinatura/hash-chain ancorada) — a "integridade criptográfica" que os
ADRs 0002/0003 **adiaram** e que os objetivos lidos da Fase 4 no plano **não nomeiam**. **A mudança de cálculo
(GAP-4D, confirmada pelo `security-engineer`):** o objeto editável agora é uma **aprovação**, não só um log — o
custo de forjar subiu de repudiação-de-log para **fabricação do ato de governança** (economia do atacante,
Anderson). O residual — "um `GateState` válido-mas-adulterado à mão é editável por acesso ao disco fora do
loop" — **tem que ser RE-DECLARADO aos autores dos ADRs 0002/0003** para decisão consciente (o residual aceito
para o audit trail **ainda** é aceito agora que é uma aprovação, ou o #11 exige ao menos um HMAC keyed?),
**nunca aceito por omissão**. Com a §9.1 (protected-path), o vetor mais provável (o loop) é fechado; o residual
volta ao teto honesto herdado ("acesso ao disco fora do loop").

---

## 10. Resolução das 4 GAPs (GAP-4A…D, devolvidas pelo Gate 3 §5)

| GAP | Origem | Resolução no Gate 4 |
|---|---|---|
| **4A** — origem de "human" (FR-7/10/11/BR-7 silentes) | T40 | §6: `method:"human"` cunhado pelo canal `confirmOrDeny` via factory com construction-token; autônomo → `needs-human`; residual "canal ≠ pessoa" declarado. **Condição vinculante:** o mint consome o resultado do sink, nunca um confirm paralelo. |
| **4B** — FR-3 permite salto, silente sobre o piso | T45 | §5: calibração colapsa só o complemento de `{3,5,7,8,9}`; um colapso que nomeie obrigatório é recusado ao registrar; colapso carrega `approvalMethod`. |
| **4C** — FR-5 exige `--ref` mas não que resolva | T41 | §8: Tier-1 (ref tem que resolver, fail-closed) vs. Tier-2 (relevância, Non-goal/revisor); runtime-derived preferido. |
| **4D** — cripto muda de cálculo (aprovação, não log) | T44 | §9.3: checksum = anti-acidente; tamper-evidence real = crypto keyed adiada; residual **re-declarado** aos autores 0002/0003 — **mais** o controle novo §9.1 (protected-path) que fecha o vetor do loop, elevando 4D de "re-declarar" para "controle obrigatório + re-declarar o remanescente". |

---

## 11. Reconciliação R22–R28 (o mandato do Gate 3 §4, confirmado pelo `security-engineer`)

| Regra | Onde satisfeita | Status |
|---|---|---|
| **R22** (sign-off não-fabricável) | §6 — mint por construction-token consumindo `confirmOrDeny`; autônomo→needs-human | **Confirmada, com condição vinculante** (um sink) |
| **R23** (obrigatório ao vivo, fail-closed, fonte única) | §4 — `MANDATORY_GATES={3,5,7,8,9}` em `builtin-roles-data.ts`; `Approval` chaveado a gate+demanda+branch | Confirmada |
| **R24** (calibração nunca alcança o piso) | §5 — `evaluateCalibration` recusa colapso de obrigatório ao registrar | Confirmada |
| **R25** (evidência Tier-1 imponível, Tier-2 do revisor) | §8 — `--ref` tem que resolver; runtime-derived preferido; não afirma Tier-2 | Confirmada |
| **R26** (verdict positivo-ou-nega, terminal, 3 valores) | §7 — `GateAdvanceVerdict`; sem token em `approved`; teste de propriedade terminal | Confirmada |
| **R27** (mutação atômica, sem mutação perdida) | §3.2/§3.3 — reserve()-síncrono + lock `O_EXCL` + CAS `revision` + temp+rename+fsync | Confirmada |
| **R28** (fail-closed em corrupção; checksum p/ acidente; residual crypto re-declarado) | §9 — checksum canônico; protected-path (**controle novo**); residual re-declarado | **Confirmada, com fronteira nova elevada a controle** |

---

## 12. SLIs / SLOs por componente (objetivo explícito do Gate 4)

**Cobertura de biblioteca honesta:** o corpus responde ao *framing* de SLO (*Software Architecture and Quality
Attributes §3.9*) mas **não** tem números para gate de agente CLI local (mesma lacuna de ADR 0003 §10 / 0004
§10). Números abaixo são **candidatos PoC-scale**, a medir/afinar no Gate 11 — declarados como candidatos, não
fechados por citação.

| Componente | SLI | SLO proposto (candidato) | Nota |
|---|---|---|---|
| **`gate status`** (latência) | wall-clock de 1 leitura: abrir + verificar checksum + parse + avaliar `evaluateAdvance` in-memory | **p95 < 50 ms** | Só leitura; sem lock, sem escrita. |
| **`gate start N`** (latência) | wall-clock: lock + read-verify + `isMandatorySatisfied`/`evaluateCalibration` + write-temp+fsync+rename | **p95 < 80 ms** | Inclui a escrita atômica; exclui contenção de lock. |
| **`gate approve`** (latência) | wall-clock do trabalho da **máquina** **após** o confirm resolver (mint + append `Approval` + write+rename) — **exclui** o tempo de decisão humana | **p95 < 80 ms** | O timeout do confirm humano é `DEFAULT_APPROVAL_TIMEOUT_MS`=30 s (`confirm.ts`), separado e fail-closed. |
| **Detecção de mutação concorrente perdida** | um lost-update (duas mutações concorrentes que descartam uma silenciosamente) | **100% detectado — error budget 0** | **Não é "taxa".** É invariante de correção (lock serializa; CAS recusa; nenhuma perdida em silêncio). Um lost-update silencioso é **defeito** (FR-14). |
| **`could-not-verify` sempre sinalizado** | um fail-closed que não registra (silencioso) | **100% loud — error budget 0** | Invariante (R26 ii; a lição F10 de `gate_land.py`). Um `could-not-verify` silencioso é defeito. |

*Grounding:* **Software Architecture and Quality Attributes §3.4/§3.9** ("tactics per attribute: performance =
latency; sensitivity point; evaluate early"). Os números de gate de agente local **não** são cobertos
(declarado, como a spec e os ADRs 0003/0004 já fizeram).

---

## 13. Consequências

### 13.1 Positivas
- A não-forjabilidade do invariante #11 vale por **três camadas construídas** (§9.1): construction-token +
  protected-path + residual honesto — nenhuma delas afirma mais do que entrega.
- Verdict tri-estado terminal + fail-closed: um `approved` dentro de um `catch` é uma mentira de tipo visível
  e testável; nenhum caminho de erro produz "avançar".
- Concorrência fechada por reserve()-síncrono (in-process) + lock+CAS (cross-process) — reuso de padrão
  provado, sem lock distribuído nem IPC.
- **Nenhum pacote novo**; política pura (verdict, piso, calibração) unit-testável sem `ctx`/UI/disco.
- **Nenhum segundo canal de confirmação** (BR-8) — `confirmOrDeny` reusado como sink único.

### 13.2 Riscos aceitos (com mitigação)
| # | Risco | Sev. | Mitigação |
|---|---|---|---|
| R1 | **`GateState` adulterável por acesso cru ao disco fora do loop** — agora uma **aprovação**, não só log | Alto | §9.1 fecha o vetor do loop (protected-path); residual **re-declarado** aos autores 0002/0003 (§9.3); crypto keyed = fase futura |
| R2 | **Atomicidade do rename em Windows** — `EPERM`/`EBUSY` de AV/lock; sem fsync-de-diretório | Médio | temp-mesmo-dir + fsync-do-fd + retry-backoff; **residual nomeado** p/ teste em CI Windows real (Gate 5/6), como O_APPEND de `audit-trail.ts` |
| R3 | **Concorrência vale só enquanto `reserve`/mutação síncronos** — um `await` futuro reabre a corrida in-process | Médio | Restrição de design + teste; lock+CAS cobre cross-process independentemente |
| R4 | **Lock stale de um processo morto** | Baixo | Stale por idade + rename-para-o-lado atômico; CAS backstoppa uma quebra-de-stale errada → `could-not-verify` |
| R5 | **`repoId` sem fonte estável in-repo hoje** | Baixo | Derivar de `git remote get-url origin` **ou** UUID persistido na 1ª escrita — **sub-pergunta aberta** (§15), afeta a defesa cross-repo do envelope |

### 13.3 Negativas / custos assumidos
- Novos arquivos: `GateStateStore`+`mutateGateState`+funções puras de verdict em `@conductor/runtime`;
  `MANDATORY_GATES` em `@conductor/config`; os comandos `gate *` em `@conductor/cli`. **Nenhum pacote novo.**
- `.conductor/gates/` entra em `defaultProtectedPaths()` (§9.1) — uma edição security-crítica em
  `workspace-policy.ts` que o Gate 5/6 tem que cobrir com teste (write/edit/bash negados no subtree).

---

## 14. Reconciliação com o Gate 3 addendum Fase 4 (protocolo iterativo) + fronteira nova reportada

O mandato (Gate 3 §7): "se o Gate 4 expuser uma superfície nova, retornar a este gate". **A decisão in-process
não expõe processo novo** — mas a **localização em disco do store** é uma fronteira de confiança nova, e o
`security-engineer` (invocado como subagente) a classificou como **controle obrigatório antes de fechar o Gate
4**, não só residual:

- **Fronteira nova reportada e já resolvida como controle (§9.1):** sem o `GateState` sob protected-path, o
  próprio loop forja o próprio sign-off pelo `write`/`edit` — o caminho mais provável de quebra do #11. **Com**
  a §9.1, a única mutação é via `gate *` (R22/R27). Esta é a costura que o Gate 5/6 **DEVE** travar test-first.
- **Retornar ao Gate 3 se:** qualquer RPC/SDK que exponha `approve` **fora** do canal interativo (spec §3
  Non-goal, mas nomeado) for adicionado; ou se o mint de "human" for alcançável por um segundo sink de confirm
  (§6, condição vinculante violada).

**Costuras que o Gate 5/6 DEVE travar (test-first):** (a) o **guard de mint** — o modo headless/autônomo **não**
consegue produzir `method:"human"` (needs-human); um literal `{method:"human"}` não é um `HumanApproval` válido;
(b) o **teste de propriedade terminal do verdict** — uma exceção de classe não-antecipada → `could-not-verify`,
nunca `approved`; (c) o **teste de atomicidade/concorrência** — N `gate` concorrentes: nenhuma mutação perdida,
CAS recusa o perdedor com `could-not-verify`, retry de lock stale; (d) o **teste de protected-path** —
`write`/`edit`/`bash` sobre `.conductor/gates/` negados; (e) o **teste do piso** — `MANDATORY_GATES` de fonte
única, calibração recusa nomear um obrigatório, `Approval` emprestado de outro gate/branch não conta;
(f) o **teste de evidência Tier-1** — `--ref` pendurado recusado; runtime-derived preferido para fechar um
obrigatório; (g) o **teste do rename em Windows** — handle aberto no temp → retry → `io-error`.

---

## 15. Follow-ups
- **`repoId`**: escolher a fonte (git remote vs. UUID persistido na 1ª escrita) — sub-pergunta §9 #6 da spec,
  afeta a defesa cross-repo do envelope. Gate 5.
- **Crypto keyed do `GateState`** (HMAC/assinatura fora do arquivo): decisão consciente dos autores dos ADRs
  0002/0003 sobre o residual re-declarado (§9.3) — fase futura não nomeada.
- **Idempotência de re-aprovar** (FR-13): idempotente vs. erro explícito com `--reopen` — decisão de UX que
  afeta o `conductor auto`; **decisão:** idempotente (reafirma o estado sem 2º `Approval` redundante), porque é
  mais amigável a um loop que retoma uma demanda interrompida; um `--reopen` explícito reabre. Confirmar no
  Gate 5.
- **Números de SLO** medidos no Gate 11.

---

## 16. Alternativas consideradas e rejeitadas
- **(A) Segundo canal de confirmação próprio para `gate approve`** (um prompt readline dedicado) — **rejeitada**
  (§6): é um segundo sink com semântica de timeout divergente, a classe exata que `confirm.ts` existe para
  prevenir; reusa `confirmOrDeny` (BR-8).
- **(B) Construction-token em `approved`** — **rejeitada** (§7): adiciona cerimônia ao caminho comum e não
  defende a direção perigosa; a união exaustiva + teste terminal + default-nega é o controle honesto (Security
  Engineering §1.12).
- **(C) `GateState` fora de `.conductor/` / sem protected-path** — **rejeitada** (§9.1): deixaria o loop forjar
  o próprio sign-off pelo `write`/`edit`.
- **(D) Env var (`CONDUCTOR_HUMAN=1`) ou `whoami` como prova de sign-off** — **rejeitada** (§6/T40): autoridade
  ambiente herdada por todo filho; é o vetor threat-E que `gate_land.py` já rejeitou por escrito.
- **(E) Só CAS, sem lock** — **rejeitada** (§3.3): CAS sozinho faz o perdedor re-tentar em loop sob contenção;
  o lock serializa e o CAS backstoppa — os dois, não um.
- **(F) `isTTY` como prova de presença humana** — **rejeitada** (§6): é o canal existir, não alguém responder;
  `whoami` deslocado uma camada. O mint é gated no confirm **resolver `true`**.
- **(G) Um arquivo único global indexado por `demandId`** — **rejeitada** (§3.1): vira hotspot de concorrência;
  um arquivo por demanda chaveia naturalmente e localiza o lock.

---

## 17. Grounding (biblioteca) — consultas desta sessão
Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4` (backend
saudável, 2267 chunks), mais as consultas dos subagentes `backend-engineer` e `security-engineer`.

1. **Decisão arquitetural = hard-to-reverse + shapes an attribute** → **Software Architecture and Quality
   Attributes §1.12** (top **0.605**): um formato de aprovação persistido é os dois — base de §1.3.
2. **I/O na borda, política pura no meio; pureza se paga quando a regra é uma decisão de invariante** →
   **Architecture Boundaries §3.4** (top **0.571**) e **§3.12** (0.573) — base da §2 (store adapter vs. verdict
   puro).
3. **Variantes fechadas por algo fora de você** → **Object-Oriented Thinking §3.12** (0.547) — o conjunto de
   `status`/verdict é fechado pelo plano — base de §1.3 item 4.
4. **Assuma duplicatas, projete idempotência; detecte em vez de sobrescrever** → **Messaging and Integration
   Patterns §3.3/§3.4** (top **0.611**, via `backend-engineer`) — base do lock+CAS (§3.3).
5. **Fail-closed / erro nunca lê como permissão; ação sensível exige multi-party** → **Security Engineering
   §2.9/§2.12** (top **0.705**) + **Building Secure and Reliable Systems §3.3/§3.8/§3.12** (via
   `security-engineer`) — base de §6/§7 (sign-off, verdict).
6. **Valor de um controle = a falha que previne, não a contagem** → **Security Engineering §1.12** (via
   `security-engineer`) — base do Ruling B (sem token em `approved`).
7. **Duas posturas de falha opostas, cada uma correta em seu ponto** → **Secure and Reliable Systems Design
   §1.12** (herdado, spec §8.6) — o `GateState` fail-closed vs. o `gate_land.py` fail-open.
8. **Cobertura fraca/ausente declarada (não forçada):** atomicidade de `rename`/lock `O_EXCL`/CAS em Windows
   (0.50–0.61, off-target — ancorado no invariante #14 + `reserve()`/`write-config.ts`); humano-vs-automatizado
   em audit trail local (0.63–0.64); tamper-evidence de registro de aprovação (0.616) — todas já declaradas
   pelo Gate 3, **não re-forçadas**.

---

## 18. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. Derivados dos subagentes
> `backend-engineer` (persistência, envelope, mutação atômica, checksum) e `security-engineer` (mint, verdict,
> piso, tiers). Correções verificadas no código do Pi estão anotadas.

```typescript
// ==== @conductor/config — fonte única do piso obrigatório (§4, R23/BR-10) ====
// Adicionar em builtin-roles-data.ts, ao lado de BUILTIN_GATE_ROLES (NÃO existe hoje — verificado):
export const MANDATORY_GATES: ReadonlySet<number> = new Set([3, 5, 7, 8, 9]);

// ==== @conductor/runtime — GateState (plano §4.7; spec §4 glossário) ====
export type GateStatus =
  | "not-started" | "in-progress" | "blocked" | "needs-human" | "approved" | "rejected";
export type ApprovalMethod = "human" | "auto";   // forma do audit-trail.ts; NUNCA colapsa auto em human

export type EvidenceRef =                          // R25 Tier-1: cada variante TEM que resolver
  | { kind: "git-commit"; sha: string }            //   git rev-parse --verify NESTE repo
  | { kind: "file"; path: string }                 //   existe e dentro do workspace (resolveRealPath/isWithinRoot)
  | { kind: "journal-entry"; id: string }          //   o runtime de fato gravou
  | { kind: "test-run"; id: string };              //   o runner rodou, o runtime gravou o id
export type EvidenceProvenance = "runtime-derived" | "author-declared";  // R25: runtime-derived preferido
export interface Evidence {
  gate: number;
  ref: EvidenceRef;                                // OBRIGATÓRIO (FR-5) e tem que RESOLVER (R25)
  provenance: EvidenceProvenance;
  note?: string;                                   // texto livre — NUNCA substitui o ref
  groundingCitations?: string[];                   // BR-4 (citação de biblioteca de uma decisão técnica)
  recordedAt: string;                              // ISO-8601 string (nunca Date — §9.2 gotcha do checksum)
}

// Approval: method:"human" é MINTADO só pela factory (§6/R22) — o campo NÃO é settable por um chamador.
// A marca `readonly __brand` só é produzível dentro de mintHumanApproval; um literal {method:"human"} não a tem.
declare const HUMAN_MINT: unique symbol;
export interface Approval {
  gate: number; demandId: string; branch: string; // R23: estruturalmente de (gate, demanda, branch)
  method: ApprovalMethod;
  source: string;                                  // referência opaca (sessão/CI) — NUNCA a prova sozinha
  approvedAt: string;                              // ISO-8601 string
  readonly [HUMAN_MINT]?: true;                    // presente só quando method==="human" veio do canal
}
export interface Decision {
  gate: number; kind: "reasoning" | "decision" | "plan" | "calibration";
  text: string; method: ApprovalMethod;            // R24: uma calibração carrega quem/como (human/auto)
  groundingCitations?: string[]; recordedAt: string;
}
export interface CalibrationDecision extends Decision {
  kind: "calibration";
  collapsedGates: number[];                        // R24: DISJUNTO de MANDATORY_GATES — validado ao registrar
}
export interface Risk { gate: number; text: string; accepted: boolean; recordedAt: string; }

export interface GateRecord {
  gate: number; status: GateStatus;
  evidence: Evidence[]; decisions: Decision[]; risks: Risk[]; approvals: Approval[];
  startedAt?: string; completedAt?: string;        // ISO-8601 strings
}
export interface GateState {
  demandId: string; repoId: string; branch: string;
  currentGate: number;
  gates: Record<number, GateRecord>;               // histórico por gate — nunca sobrescrito (FR-1)
  calibration?: CalibrationDecision;
  startedAt: string; completedAt?: string;
}

// ==== @conductor/runtime — envelope persistido + mutação atômica (§3, R27/FR-12/14/15) ====
export interface GateStateEnvelopeV1 {
  schemaVersion: 1;                                // LITERAL (harness-table.ts) — v2 vira união discriminada
  demandId: string; repoId: string; branch: string;// content-authoritative — nunca confie no nome do arquivo
  revision: number;                                // CAS monotônico (R27); +1 a cada mutação bem-sucedida
  checksum: string;                                // sha256(canonicalizeJson(state)) — anti-ACIDENTE (R28), não tamper-evidence
  state: GateState;
}
export type GateStateMutationError =               // terminal, 3 valores (R26) — nunca um 4º balde silencioso
  | { kind: "could-not-verify"; reason: string }   // ilegível / schema ruim / checksum mismatch / CAS-conflict
  | { kind: "locked"; heldSince: string }          // outro escritor segura o lock; o chamador pode re-tentar
  | { kind: "io-error"; cause: unknown };          // rename/fsync/write falhou por razão alheia à validade do conteúdo
// Result<T,E> reusado de packages/agent/src/harness/result.ts (NÃO redefinir):
export function mutateGateState(                    // síncrono ponta-a-ponta; ZERO await entre lock e rename
  demandId: string,                                //   (padrão reserve() de shared-budget.ts); mutate é puro+sync
  mutate: (current: GateState) => GateState,        //   um bug DENTRO de mutate LANÇA, não é engolido em io-error
): Result<{ next: GateState; revision: number }, GateStateMutationError>;

// ==== @conductor/runtime — verdict tri-estado, terminal (§7, R26) ====
export type GateAdvanceVerdict =
  | { kind: "approved" }                            // SÓ de sucesso positivo avaliado — nunca default/catch/fallback
  | { kind: "refused"; missingMandatoryGates: number[]; reason: string }
  | { kind: "could-not-verify"; reason: string };   // loud + registrado; qualquer incerteza cai aqui, nunca approved
export function evaluateAdvance(                    // PURA (sem I/O) — testável contra um GateState em memória
  state: GateState, targetGate: number, mandatory: ReadonlySet<number>): GateAdvanceVerdict;
export function isMandatorySatisfied(              // o piso {3,5,7,8,9}, considerando calibração (§5)
  state: GateState, upToGate: number, mandatory: ReadonlySet<number>): boolean;
export function evaluateCalibration(              // R24: recusa colapso que nomeie um obrigatório (ao REGISTRAR)
  collapsedGates: number[], mandatory: ReadonlySet<number>):
  { ok: true } | { ok: false; offendingMandatory: number[] };

// ==== @conductor/runtime — mint de sign-off (§6, R22) — o ÚNICO produtor de method:"human" ====
// Consome o RESULTADO de confirm.ts:confirmOrDeny (nunca um confirm paralelo — condição vinculante do §6/BR-8).
export function mintHumanApproval(
  confirmResult: boolean,                          // vindo de confirmOrDeny (que já garante !hasUI→deny, timeout→deny)
  meta: { gate: number; demandId: string; branch: string; source: string },
): Approval | null;                                // null quando confirmResult !== true (fail-closed); nunca lança
// mintAutoApproval(...) produz method:"auto" — usado só por gate NÃO-obrigatório em modo autônomo (FR-10);
// para um obrigatório em modo autônomo, o comando grava status="needs-human" (FR-11), nunca chama mint.

// ==== @conductor/runtime — resolução de evidência Tier-1 (§8, R25) — na BORDA (faz I/O) ====
export function resolveEvidenceRef(               // fail-closed: um ref que não resolve → refused (FR-5/R25)
  ref: EvidenceRef, ctx: { repoRoot: string; workspaceRoot: string }):
  { ok: true; provenance: EvidenceProvenance } | { ok: false; reason: string };
```

**Superfície CLI (§2 — os cinco pontos de comando + calibração):**

```text
conductor gate status  [--demand <id>]
conductor gate start   <N> [--demand <id>]
conductor gate evidence --gate <N> --ref <sha|path|id> --kind <git-commit|file|journal-entry|test-run>
                        [--note "..."] [--demand <id>]
conductor gate approve [--gate <N>] [--demand <id>]        # roteia por confirmOrDeny; "human" só em confirm→true
conductor gate reject  --reason "..." [--gate <N>] [--demand <id>]
conductor gate calibrate --collapse <N,M,...> [--demand <id>]   # recusado se algum ∈ MANDATORY_GATES (R24)
```
