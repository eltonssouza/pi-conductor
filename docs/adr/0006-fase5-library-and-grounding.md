# ADR 0006 — Fase 5 (Library e grounding): motor de recuperação local em `node:sqlite`+FTS5, citação estruturada com mint único provado por scan estático, índice de código por-máquina fora do workspace, e endpoint remoto por policy-grant com guarda SSRF sobre o IP resolvido

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-06
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 5 — Library e grounding` (`plano_desenvolvimento.md` linhas 1351-1375, lidas junto com
  §4.10 "Memória" e §4.11 "RAG e grounding"), branch `feature/fase5-library-e-grounding` (de `develop`)
- **Autor (papel):** software-architect
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças criam um ADR sucessor, não editam este. Este ADR **não edita**
  os ADRs 0001–0005 — ele os **aplica** e, num ponto nomeado e justificado (§7.4), **estende** o Apêndice §18
  do ADR 0005: a união `Decision["kind"]` ganha uma variante e dois campos mudam de `string[]` para um tipo
  estruturado. Estender não é redefinir — a forma de todo o resto do agregado fica intacta, e o §18 é
  explicitamente "para o Gate 5/6 não reinventar a interface", não uma proibição de evolução por um ADR
  sucessor. A spec da Fase 5 (§9.4) roteou essa decisão exatamente para este gate.

- **Insumo herdado (código lido nesta sessão, não assumido):**
  - **ADR 0003** (Fase 2) — o Permission Gate (`permission-gate.ts`), o envelope fail-closed
    (`fail-closed.ts`), o Audit Trail append-only síncrono que **lança** em falha de I/O
    (`audit-trail.ts`, incluindo `AuditEntry.egress`), o canal de confirmação humana com timeout fail-closed
    (`confirm.ts`), o par `policy-loader.ts`/`policy-trust-store.ts` (TOFU + interseção trust-ordered), e o
    pipeline de redação com a enumeração fechada `REDACTION_SINKS` (`redaction.ts`, 6 sinks hoje).
  - **ADR 0004** (Fase 3) — a fronteira de workspace (`workspace-policy.ts`: `resolveRealPath`/`isWithinRoot`/
    `defaultProtectedPaths`), o seam de redação-at-rest no `SessionManager`
    (`session-redaction-guard.ts`, o patch de protótipo em `appendMessage`), e o contrato "evidência é
    referência conferível, nunca alegação" (`task.ts:DelegationEvidence`).
  - **ADR 0005** (Fase 4) — `GateState`/`Evidence`/`Decision` (`gate-state.ts`), a resolução Tier-1
    (`gate-evidence.ts:resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate`), a política pura
    (`gate-state-policy.ts`), o store com lock+CAS+checksum (`gate-state-store.ts`, incluindo
    `canonicalizeJsonForChecksum`), a wiring real do CLI (`gate-store.ts`), e — o insumo mais importante
    deste ADR — a **correção do §7**: um brand `Symbol` **não sobrevive ao `JSON.stringify`**, logo a
    garantia durável de não-forjabilidade é a soma de propriedades **estruturais** (sole-mint provado por
    scan estático + protected-path), nunca uma revalidação do token sobre um registro relido.
  - **Gate 2 spec Fase 5** (`docs/conductor/gate2-spec-fase5.md`) — 17 FR (grupos A–E), 10 BR, 8 edge cases,
    10 goals, e as 6 questões em aberto (§9) roteadas para este gate.
  - **Gate 3 addendum Fase 5** (`docs/conductor/gate3-addendum-fase5.md`) — 7 ameaças novas (T48–T54), as
    **7 regras vinculantes R29–R35** (§4) que esta arquitetura DEVE respeitar, os 4 GAPs (5A–5D), os
    secure-defaults 38–44, e o gatilho de retorno iterativo (§7). **É o insumo vinculante desta fase.**
  - **Referência de comportamento (semântica, não código a portar):** `conductor-main/conductor/library.py`,
    `rag/core.py`, `rag/bootstrap.py`, `intelligence/code_aware_rag.py`. Lida como **prior art e como lista
    de defeitos**: os eventos `rag_query`/`rag_unreachable` de `_log_telemetry`/`_log_unreachable` são o
    sinal certo a portar; `iter_corpus` sem `resolve()`, a coleção global `project_code`, o
    `CONDUCTOR_CHROMA_HTTP` como autoridade ambiente e o `import --force` são exatamente as quatro coisas
    que **não** se porta (T49/T51/T52/T48c).

- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, CLAUDE.md Gate 4):** §17 reconcilia ponto a ponto com
  R29–R35 e **devolve ao Gate 3** a fronteira de confiança nova que a decisão de localização do índice/ledger
  expõe (`~/.conductor/library/`, D7/D9), classificada como **retorno obrigatório** (§18).

---

## 1. Contexto

### 1.1 O que as Fases 0–4 já entregaram, e que esta fase usa sem reescrever

Verificado abrindo os arquivos, não presumido:

| Primitivo | Arquivo | O que a Fase 5 faz com ele |
|---|---|---|
| Contenção de caminho por caminho **resolvido** | `conductor-runtime/src/workspace-policy.ts` (`resolveRealPath`, `isWithinRoot`) | A ingestão do corpus reusa integralmente (R30) — nenhum segundo checador de caminho |
| Protected paths secure-by-default | mesmo arquivo, `defaultProtectedPaths()` — hoje: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.config`, `~/.conductor/credentials`, e (com `workspaceRoot`) `.conductor/{config.json,policy.json,policy-trust.json,audit.jsonl,gates}` | **Ganha uma entrada nova**: `~/.conductor/library` (D9) |
| Redação-at-rest com enumeração fechada de sinks | `conductor-runtime/src/redaction.ts` (`REDACTION_SINKS`, 6 valores) + `@conductor/secrets` | **Ganha um 7º sink**: `"codeIndex"` (D6) |
| TOFU + interseção trust-ordered de grants | `conductor-config/src/policy-loader.ts` (`mergePolicies`, `intersectTrustOrdered`) + `policy-trust-store.ts` | O endpoint remoto vira um grant `network` que passa por esse caminho inteiro (D10) — nenhuma env var nova |
| Audit trail append-only, síncrono, durável-no-retorno, com `egress` | `conductor-runtime/src/audit-trail.ts` (`AuditEntry.egress?: { destination: string }`) | O egress de uma consulta remota é gravado **antes** do envio, reusando a garantia de ordenação que o próprio header desse arquivo documenta (D10) |
| Resolução de evidência que **sobrescreve** o que o chamador declarou | `conductor-runtime/src/gate-evidence.ts:resolveEvidenceRef` (+ `gate.ts:runGateEvidence`, que sempre sobrescreve a `provenance` declarada) | É a **forma** que `recordGroundedDecision` copia (D4) |
| Checksum canônico com recusa de não-serializável | `conductor-runtime/src/gate-state-store.ts:canonicalizeJsonForChecksum` — lança `TypeError` em `!Number.isFinite(value)` e em qualquer valor não-JSON | Motiva a guarda de finitude de D3 |
| `DatabaseSync` de `node:sqlite` já em produção neste monorepo | `packages/session-backends/sqlite-node/src/sqlite/*.ts` (`import { DatabaseSync } from "node:sqlite"`), publicado como `@earendil-works/pi-session-backend-sqlite-node@0.83.0`, `engines: node >=22.19.0` | É o **precedente in-repo real** de D1 — não uma aposta nova |

### 1.2 O fato dominante herdado, e a torção da Fase 5

O fato dominante das Fases 0–4 continua: **um único processo de SO, sem sandbox, com o privilégio do
usuário**; não há segundo principal; toda garantia é política dentro de um processo confiado.

A torção que o Gate 3 nomeou (§0 do addendum) é a que organiza este ADR: a Library é o **primeiro
subsistema que traz conteúdo não-confiável para dentro do processo e o devolve com um selo de
autoridade**. Três consequências arquiteturais, e nenhuma delas é sobre desempenho de busca:

1. **A passagem recuperada é uma _source_ tainted; o contexto do papel é um _sink_.** Isso não é
   resolvível na arquitetura (prevenção completa de prompt injection indireta é problema aberto na
   indústria — declarado na Fase 0 T5 e reafirmado em R29). O que a arquitetura pode fazer é **controlar
   as portas de entrada** (procedência do corpus, D5; contenção de caminho, R30) e **manter a fronteira
   dado/instrução explícita no ponto de consumo**.
2. **A citação é o novo ativo de integridade — e é produzida pelo ator que ela deveria vincular.** Se ela
   for uma string que o agente digita, FR-16 é teatro (T53). Toda a §7 deste ADR existe para essa frase.
3. **O endpoint remoto e o índice de código são portas de exfiltração, não só de entrada** (T52/T50). O
   desenho tem que decidir o que **nunca** sai da máquina, não só o que é criptografado a caminho.

**E um quarto fato, descoberto neste gate e não previsto pelo Gate 3** (§9.3, empiricamente verificado): o
motor de busca escolhido tem um **parser próprio** (a expressão FTS5 MATCH), distinto do parser SQL. Ligar
a consulta como parâmetro protege o segundo e **não** o primeiro. Isso cria uma superfície de injeção *e*
um modo de auto-DoS que nenhuma das sete ameaças T48–T54 cobre.

### 1.3 Atributos de qualidade priorizados para esta decisão

Ordenados. A ordem é a decisão; ela é o que resolve os empates abaixo.

1. **Integridade da citação (não-forjabilidade estrutural).** É o produto desta fase. Uma citação forjável
   torna o non-negotiable #1 do `CLAUDE.md` decorativo. Vence conveniência, vence desempenho, vence
   paridade de recall com a referência Python.
2. **Contenção (blast radius) entre domínios de confiança.** Projeto A ≠ projeto B; workspace ≠ máquina;
   corpus ≠ código; local ≠ remoto. Um vazamento aqui é o dano que R20/R32 existem para impedir.
3. **Disponibilidade honesta.** O canal ou funciona e diz por quê, ou falha e diz por quê — nunca entrega
   um resultado parcial com cara de completo (FR-12/BR-7). Um grounding silenciosamente degradado é pior
   que nenhum, porque ainda é *lido* como prova.
4. **Baixa complexidade acidental (Ousterhout).** Módulos fundos, interfaces estreitas; nada de motor de
   busca vetorial genérico, nada de servidor, nada de dependência nativa compilada. O corpus real tem
   **2267 chunks**; qualquer coisa mais sofisticada que uma varredura linear é complexidade paga sem nada
   do outro lado.
5. **Operabilidade em hardware fraco e offline.** Restrição real do usuário, já registrada no diário para a
   Diary/Fase 6 e agora estendida à Library. Zero Docker, zero servidor, zero GPU obrigatória.

*Grounding:* **Software Architecture and Quality Attributes §1.12** e **Distributed Architecture Decisions
§1.12** (0.523 nesta sessão: "the decision reverses in an afternoon" — o critério inverso: as decisões
abaixo são as que **não** revertem numa tarde: formato de tipo persistido, localização de store, fronteira
de pacote); **Managing Software Complexity §2.10/§2.12** (top **0.709**/**0.711**: "shallow classes that add
an interface without hiding much"; "depth is benefit over interface cost, and both sides can fail") — a
razão de D1 rejeitar um motor genérico e de D8 aceitar um pacote novo mesmo assim.

---

## 2. Decisão central, e o mapa D1–D14

**A Library é um pacote novo (`@conductor/library`) que implementa um motor de recuperação local, sem
servidor e sem dependência nativa, sobre `node:sqlite` — FTS5 para o lado lexical e vetores `float32` como
BLOB varridos linearmente para o lado denso — e cujo único produto exportado para a máquina de gates é uma
`GroundingCitation` que `@conductor/runtime` **monta a partir de um ledger de eventos que o próprio runtime
gravou**, nunca a partir do que o chamador digitou.**

Tudo o mais decorre disso. As catorze decisões:

| # | Decisão | Fecha / responde |
|---|---|---|
| **D1** | Motor local: `node:sqlite` (builtin) + FTS5 + vetores BLOB com varredura flat; **sem** ChromaDB, sem ANN, sem dependência nativa | spec §9.1 |
| **D2** | Reescrita **nativa em TS**, não subprocess do `cdt library` Python | spec §9.2 |
| **D3** | `groundingCitations` vira `GroundingCitation[]` estruturado em **`Decision` E `Evidence`**, com guarda de finitude antes de persistir | spec §9.4, GAP-5A |
| **D4** | `recordGroundedDecision` é o **único** mint; garantia durável = **sole-mint por scan estático** + protected-path + resolução contra ledger. `reject()` passa a escrever `kind:"rejection"` | R34/T53, spec §9.3 |
| **D5** | `library import` é **Non-goal declarado** desta fase; `library add` fica, confinado por caminho resolvido | R29(ii)/T48(c), GAP-5C |
| **D6** | Code-aware reusa o seam de redação como **7º sink `"codeIndex"`**, aplicado **antes** do embed; allowlist de extensões; exclusão de git-ignored; opt-in confirmado | R31/T50, GAP-5D |
| **D7** | Índice de código escopado por **separação física**, num caminho **por-máquina fora do workspace**; manifest com recusa fail-closed em mismatch; índice repo-supplied nunca é aberto | R32/T51 + **SF-N1** |
| **D8** | Pacote novo `@conductor/library`; a seta de dependência aponta para dentro (port em `@conductor/runtime`, adapter na Library) | regra de dependência |
| **D9** | Corpus e ledger globais em `~/.conductor/library/`, adicionado a `defaultProtectedPaths()` | R33/R34, ADR 0005 §9.1 |
| **D10** | Endpoint remoto = grant `network` do `policy.json` sob TOFU + interseção trust-ordered; **guarda SSRF sobre o IP resolvido no momento da conexão, com pin e re-checagem em redirect**; egress logado antes do envio; code-aware **nunca** sai da máquina | R33/T52, GAP-5B |
| **D11** | `search` falha alto (FR-12) e grava `rag-unreachable`; degradação só via `--lexical-only` **explícito**, que ainda grava `rag-query` | FR-12/FR-17, R35/T54 |
| **D12** | A expressão FTS5 MATCH é **construída pelo runtime a partir de tokens citados**; bind é necessário e **não suficiente** | **SF-N2** (metade injeção) + R29 |
| **D13** | Ledger de eventos `rag-query`/`rag-unreachable` em JSONL append-only, separado do índice, com janela fixa de 15 min para FR-17 | R34/R35 |
| **D14** | Reranking leve determinístico (RRF + re-score por features novas), **declaradamente não** um cross-encoder; cross-encoder é opt-in | FR-2, restrição de hardware |

---

## 3. D1 — Motor local: `node:sqlite` + FTS5 + vetores BLOB, varredura flat

### 3.1 A decisão

`@conductor/library` armazena o corpus num **único arquivo SQLite por escopo**, aberto pelo `DatabaseSync`
de **`node:sqlite`** (módulo builtin do Node, zero dependências):

```
~/.conductor/library/corpus.sqlite                        (corpus global de livros — D9)
~/.conductor/library/projects/<projectId>/code.sqlite      (índice de código — D7)
```

Esquema mínimo (ilustrativo, contratos completos no §19):

```sql
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
--  schemaVersion, corpusVersion, embeddingModel, embeddingDim, projectId, workspaceRealPath

CREATE TABLE chunk(
  chunk_id     TEXT PRIMARY KEY,    -- sha256 determinístico (D7 para código; path+ordinal para corpus)
  content_hash TEXT NOT NULL,       -- dedupe incremental (FR-9/BR-9)
  source       TEXT NOT NULL,       -- livro / arquivo
  section      TEXT NOT NULL,
  path         TEXT NOT NULL,
  category     TEXT NOT NULL,
  tech         TEXT,  version TEXT, -- filtros FR-4
  ordinal      INTEGER NOT NULL,
  body         TEXT NOT NULL,
  vec          BLOB NOT NULL        -- Float32Array(embeddingDim), little-endian
);
CREATE INDEX chunk_content_hash ON chunk(content_hash);

CREATE VIRTUAL TABLE chunk_fts USING fts5(
  body, section, source, content=chunk, content_rowid=rowid
);
```

- **Lexical:** FTS5 com `bm25()`. Verificado nesta sessão que o SQLite embutido no `node:sqlite` deste Node
  traz FTS5 compilado (`CREATE VIRTUAL TABLE ... USING fts5` executou e `bm25()` devolveu score).
- **Denso:** o embedding é gravado como BLOB e **varrido linearmente** em JS (cosseno sobre `Float32Array`).
  Verificado o round-trip `Float32Array → Buffer → Float32Array` sem perda.
- **Nenhum índice ANN, nenhuma extensão nativa (`sqlite-vec`), nenhum servidor.**

### 3.2 Por que a varredura linear é a escolha certa aqui, e não uma preguiça

Aritmética, não opinião. O corpus real do repositório-pai — o mesmo que este projeto consulta agora — tem
**2267 chunks em 65 livros** (`cdt library status`, executado nesta sessão). Com `bge-m3` (1024 dimensões,
`float32`):

- **Memória/disco dos vetores:** 2267 × 1024 × 4 B ≈ **9,3 MiB**. Cabe inteiro em RAM sem estratégia.
- **Custo de uma consulta:** 2267 × 1024 ≈ 2,3 M multiplicações-acumuladas — sub-milissegundo em JS, ordens
  de grandeza abaixo do custo de embedar a própria pergunta (uma ida ao Ollama, dezenas a centenas de ms).
- **Margem:** mesmo com 50 000 chunks (22× o corpus atual, mais do que o plano prevê), são 51 M MACs e
  ~200 MiB — ainda uma varredura de dezenas de milissegundos, ainda dominada pelo embed da pergunta.

Um índice ANN (HNSW/IVF) troca exatidão por tempo numa escala que **este sistema não alcança**, e cobra:
parâmetros a afinar, um índice a reconstruir na ingestão, recall aproximado a validar, e um modo de falha
novo (índice dessincronizado do conteúdo). *Grounding:* **Managing Software Complexity §2.12** (top
**0.711**: "depth is benefit over interface cost, and both sides can fail — a module made deeper than its
callers allow does not hide complexity, it displaces it") e **§1.12** (0.697: complexidade estratégica se
paga onde um fluxo constante de mudanças típicas vai continuar tocando o código — o motor de busca desta
fase não é esse lugar). A busca exata também **elimina uma classe inteira de bug de qualidade**: qualquer
resultado ruim é do embedding ou do rerank, nunca do índice.

### 3.3 Compatibilidade de runtime — e a recusa explícita de adivinhar

`node:sqlite` é marcado experimental e a exigência do flag `--experimental-sqlite` **variou entre minors do
Node**. Não vou afirmar em qual minor exato ela caiu; o que é verificável e verificado é:

- este monorepo **já publica** um pacote que importa `node:sqlite` com `engines: node >=22.19.0`
  (`@earendil-works/pi-session-backend-sqlite-node`) — o precedente é real e está em produção;
- neste ambiente (Node **v26.5.0**) o módulo importa **sem flag** e FTS5 está presente.

Decisão: `@conductor/library` declara `engines.node >= 22.19.0` (paridade com todo o monorepo) e faz uma
**sondagem de boot fail-closed**, uma vez, no primeiro uso:

1. `import("node:sqlite")` — se lançar, erro alto nomeando a versão do Node encontrada e o flag, **nunca**
   um caminho degradado;
2. `CREATE VIRTUAL TABLE probe USING fts5(x)` num `:memory:` descartável — se lançar, erro alto dizendo que
   o SQLite embutido veio sem FTS5.

Essa sondagem é o análogo de `conductor doctor`: uma incompatibilidade de plataforma é diagnosticada com o
nome do problema, não descoberta como "a busca não retorna nada".

### 3.4 Alternativas consideradas

| Opção | Trade-off | Veredito |
|---|---|---|
| **ChromaDB embutido (`PersistentClient`), 1:1 com a referência** (spec §9.1 Opção B) | Recall e chunking já provados em produção; **mas** é Python — adotá-lo **força** D2 para o lado do subprocess, e arrasta a decisão de motor para dentro da decisão de linguagem. Além disso, é a dependência que a decisão de hardware já registrada para a Diary/Fase 6 evita | **Rejeitada** |
| **`better-sqlite3` / `sqlite-vec`** | `sqlite-vec` daria KNN dentro do SQL; **mas** ambos são addons nativos com `node-gyp`/prebuilds por plataforma. O monorepo tem `check-pinned-deps` e um shrinkwrap gerado — um binário por plataforma é custo de cadeia de suprimentos (Gate 7) e a fonte clássica de falha de instalação no Windows do usuário. E o ganho (KNN aproximado) é exatamente o que §3.2 mostra não ser necessário | **Rejeitada** |
| **Índice próprio em `.jsonl`/binário caseiro** | Zero dependências; **mas** reimplementa transação, atomicidade e busca lexical — três coisas que o SQLite resolve há décadas. Complexidade acidental pura | **Rejeitada** |
| **`node:sqlite` + FTS5 + BLOB flat** | Zero dependências novas, um arquivo por escopo (que é o que torna D7 possível por separação física), transação/atomicidade grátis, precedente in-repo. Custo: `node:sqlite` é experimental e a superfície do flag varia por minor — mitigado por §3.3 | **Escolhida** |

---

## 4. D2 — Reescrita nativa em TS, não subprocess do `cdt library` Python

### 4.1 A decisão e o argumento decisivo

A Fase 5 reescreve o pipeline em TypeScript. **Não** embrulha o processo Python maduro.

O argumento que decide não é estético ("o pi é TS") nem de dependência ("exigiria Python+pip instalados",
embora ambos valham). É este: **o `cdt library` Python, como está, viola quatro das sete regras vinculantes
deste gate.** Verificado no código lido:

| Regra do Gate 3 | Violação na referência |
|---|---|
| **R30** (ingestão confinada por caminho resolvido) | `rag/core.py:430-431` — `library.rglob("*.md")` + `relative_to(library)` **sem `resolve()`**: symlink-escape (T49) |
| **R31** (redação antes do embed) | `intelligence/code_aware_rag.py:186` — `_build_chunk` embeda `text[:3000]` cru; `_CODE_EXTENSIONS` inclui `.tf`/`.json`/`.yaml`/`.sql`/`.sh` (T50) |
| **R32** (escopo por projeto) | `code_aware_rag.py:50` — `_CODE_COLLECTION = "project_code"`, coleção única global; id = `sha256(rel_path)` (T51) |
| **R33** (endpoint remoto é policy, nunca env) | `rag/core.py:79,510-513` — `CONDUCTOR_CHROMA_HTTP` como autoridade ambiente (T52) |

Embrulhar o processo herdaria as quatro **intactas**. O ADR não pode violar R29–R35 (§4 do addendum). Um
wrapper que "corrige de fora" essas quatro coisas teria que reimplementar a contenção de caminho, a redação,
o escopo e o roteamento de rede — ou seja, **reescreveria o que importa e ainda pagaria o subprocess**.

O que de fato se duplica é menor do que a spec §9.2 temia: chunking por parágrafo respeitando blocos de
código (~80 LOC), um cliente HTTP para `/api/embed` do Ollama (~50 LOC), FTS5 (SQL, não código), cosseno
flat (~20 LOC), RRF (~25 LOC). O que **não** se duplica é justamente o que a referência tem de mais caro —
o servidor ChromaDB, o Docker, o gerenciamento de coleções — porque D1 os elimina.

### 4.2 Alternativa considerada

**Subprocess do `cdt library` Python com um wrapper de política em TS.** Trade-off honesto: mantém ~500 LOC
testadas em produção e entrega a fase mais rápido. Rejeitada porque (a) as quatro violações acima só se
fecham reescrevendo os mesmos pontos, (b) introduz uma dependência de runtime cruzado que as Fases 0–3
evitaram deliberadamente, e (c) a fronteira processo-a-processo tornaria o ledger de D13 **atravessável**:
o Python gravaria os eventos, e o TS teria que confiar num arquivo escrito por outro processo — que é
exatamente a classe de problema que D4 existe para fechar. *Grounding:* **Architecture Boundaries §1.1**
(0.599: dependências apontam para dentro, rumo à política estável — uma dependência de runtime externo é o
detalhe volátil mais caro possível).

---

## 5. D3 — `GroundingCitation` estruturado, nos **dois** campos, com guarda de finitude

### 5.1 A forma

```ts
export interface GroundingCitation {
  /** Id do evento `rag-query` que o RUNTIME gravou (D13). A âncora de não-forjabilidade. */
  queryEventId: string;
  /** sha256 do corpo do chunk NO MOMENTO da consulta — o "passaporte" da passagem. */
  chunkHash: string;
  /** A pergunta EFETIVAMENTE buscada (já enriquecida, FR-3) — como o runtime a observou. */
  question: string;
  source: string;      // livro / arquivo
  section: string;
  path: string;
  category: string;
  /** Versão do corpus no momento da consulta (BR-5: retrato, não ponteiro vivo). */
  corpusVersion: string;
  /** O índice É o modelo de embedding — sem isto a citação é irreproduzível. */
  embeddingModel: string;
  /** FINITO e em [0,1] — validado ANTES de persistir (§5.3). */
  score: number;
  /** ISO-8601. Nunca um `Date` (gotcha do checksum, ADR 0005 §9.2). */
  retrievedAt: string;
  /** Distingue uma busca híbrida de uma só-lexical legítima (D11) — nunca inferido. */
  mode: "hybrid" | "lexical-only";
}
```

`embeddingModel` e `corpusVersion` não são enfeite. *Grounding:* **Context Engineering §4.3 "Embedding
Models: The Geometry of Relevance"** (0.643): *"The index is the embedding model. Change the model and every
stored vector is garbage — vectors from different models are not comparable... Version the embedding
model."* Uma citação sem esses dois campos não pode ser re-verificada nem sequer em princípio, e o edge case
§7.3 da spec (citação de um chunk que não existe mais) depende deles para distinguir "o corpus mudou" de
"a citação era falsa". **Context Engineering §10.2 "Provenance: Every Chunk Carries Its Passport"** (0.715,
citado pelo Gate 3) é a origem do conjunto todo.

### 5.2 Por que **também** em `Evidence`, e não só em `Decision`

O parecer de reconciliação apontou isto e está correto. Aplicar o tipo estruturado só em
`Decision.groundingCitations` deixaria `Evidence.groundingCitations` (`gate-state.ts:40`) como `string[]`
livre. Três razões para estender aos dois, em ordem de peso:

1. **Assimetria forjável no mesmo agregado.** Um revisor no Gate 8 lê `evidence[]` e `decisions[]` lado a
   lado, no mesmo arquivo, com o mesmo nome de campo. Um campo não-forjável ao lado de um forjável, com o
   mesmo nome, é pior do que dois campos honestamente fracos: convida a ler os dois com a confiança do
   forte. É exatamente a assimetria que R34 existe para fechar, deixada aberta por uma porta lateral.
2. **Dois formatos no mesmo checksum.** `computeStateChecksum` canoniza o `GateState` inteiro. Manter duas
   representações do mesmo conceito no mesmo agregado é complexidade acidental cobrada em cada leitor,
   validador e migração futura.
3. **Custo zero.** Nenhum código de produção jamais escreveu `groundingCitations` — verificado por varredura
   (`grep`) sobre `packages/*/src`: os únicos escritores de `Decision` são `gate-store.ts:288` (`reject`) e
   `gate-store.ts:322` (`calibrate`), e o escritor de `Evidence` é `gate-store.ts:207` (`attachEvidence`);
   **nenhum** dos três popula o campo. Não há dado legado a migrar — só a forma do tipo muda.

### 5.3 A guarda de finitude — um DoS acidental antes de ser um ataque

`canonicalizeJsonForChecksum` (`gate-state-store.ts:148-151`) lança:

```ts
if (typeof value === "number") {
  if (!Number.isFinite(value)) throw new TypeError("GateState checksum input must contain only finite numbers.");
```

Como o checksum é calculado sobre o **`GateState` inteiro** antes de cada escrita, um único `score: NaN`
faz **toda** tentativa de mutação daquele gate lançar um `TypeError` — que, pelo contrato explícito de
`mutateGateState` (ponto 3 do seu header: "um bug DENTRO do callback LANÇA, não é engolido em io-error"),
**propaga como exceção não-tipada**, fora da união `GateStateMutationError`. O comando morre com uma
mensagem que fala de checksum e não menciona citações. É fail-closed — o disco não corrompe — mas é um
**DoS do caminho de gravação do gate**, com diagnóstico enganoso.

E o caminho mais provável até lá **não é um atacante**: é o rerank de D14. Uma normalização min-max de
scores num conjunto de candidatos empatados produz `(x - min) / (max - min)` com denominador zero — `NaN`
por aritmética normal, num dia normal. Um `Infinity` sai igualmente fácil de um `bm25()` degenerado.

Decisão vinculante, então:

- Toda `GroundingCitation` é construída por uma função única que **valida antes de devolver**:
  `Number.isFinite(score)` **e** `0 <= score <= 1`; um score fora disso é **recusa** (`ok:false`), nunca um
  clamp silencioso — clampar esconderia o bug de normalização que gerou o valor.
- Nenhuma chave opcional é escrita com valor `undefined` — ela é **omitida**. Precedente já documentado em
  `gate-store.ts:201-206` para `note`, generalizado aqui como regra do agregado.
- Teste de Gate 5 obrigatório: injetar `NaN`, `Infinity`, `-1`, `1.5` e `undefined` e asseverar recusa
  **antes** de qualquer chamada a `store.mutate`.

*Grounding:* **Managing Software Complexity §3.1** (0.691: "information hiding and defining errors out of
existence") lido na direção correta — o erro que **não** se define para fora é este: um score inválido é um
sinal de que a etapa anterior quebrou, e clampá-lo apagaria o sinal. Mesma leitura que a BR-8 da spec já
faz para filtros não reconhecidos.

### 5.4 Alternativa considerada

**Manter `string[]` e serializar a citação como JSON-em-string.** Zero mudança de tipo, zero bump de schema.
Rejeitada: um `string[]` de JSON é **literalmente** a "string livre que o agente digita" que R34 proíbe — o
tipo não impede nada, a validação vira parse em runtime (mais um ponto de falha, mais um `TypeError` no
caminho do checksum), e o revisor humano lê JSON escapado dentro de JSON. A spec §9.4 pediu que este gate
pesasse o custo de reabrir o §18 contra o ganho de tipagem forte; com zero dados legados (§5.2 item 3), o
custo é quase só o bump de schema (§7.4), e o ganho é a diferença entre uma regra imposta pelo compilador e
uma regra escrita num comentário.

---

## 6. D4 — `recordGroundedDecision` é o único mint (e o que isso significa de verdade)

### 6.1 A função e a forma

```ts
export function recordGroundedDecision(
  store: GateStateStore,
  input: {
    gate: number;
    text: string;
    method: ApprovalMethod;
    /** O chamador informa PONTEIROS, nunca uma citação pronta. */
    citations: readonly { queryEventId: string; chunkHash: string }[];
  },
  ledger: GroundingLedgerReader,   // port; a Library é o adapter (D8)
): Result<{ next: GateState; revision: number }, RecordDecisionError>;
```

Contrato:

1. **Nunca aceita uma `GroundingCitation` pronta.** Recebe pares `(queryEventId, chunkHash)` e **resolve**
   cada um contra o ledger (D13), montando o registro a partir do que o ledger observou — pergunta, fonte,
   seção, score, `corpusVersion`, `embeddingModel`, `mode`. Um par que não resolve é **recusa**, nunca "anexa
   como o chamador declarou".
2. É a mesma forma que a Fase 4 já usa e que foi verificada nesta sessão: `resolveEvidenceRef` devolve a
   `provenance` que **ele** determinou, e `gate.ts:runGateEvidence` **sobrescreve** a que o chamador
   declarou antes de persistir (documentado em `gate-evidence.ts:194-197`). D4 é essa disciplina aplicada a
   um segundo campo.
3. `citations` vazio → recusa, **exceto** pelo caminho FR-17, que é uma função **separada e nomeada**,
   `recordUngroundedDecision`, que exige um `rag-unreachable` do ledger dentro da janela (D13) ou um override
   de risco aceito explícito e atribuído (R35). Duas funções, dois caminhos, nunca um parâmetro booleano
   que os confunda.

### 6.2 A garantia durável — declarada com precisão, sem repetir o overclaim do §7 do ADR 0005

**Um construction-token/brand não é a garantia.** O ADR 0005 §7 já teve que corrigir exatamente essa
afirmação para `HUMAN_MINT`: um `Symbol()` module-private não é serializado por `JSON.stringify`, então
depois que o registro é persistido e relido a propriedade **some**, e uma revalidação em tempo de leitura
retorna `false` para todo registro — genuíno ou forjado igualmente. **Não repito esse erro aqui.**

A garantia durável de D4 é a soma de **três propriedades estruturais**, e nenhuma delas é um token:

**(1) Sole-mint provado por scan estático.** Um teste `grounding-citation-sole-mint.test.ts` varre
`packages/*/src/**/*.ts` (excluindo o próprio módulo de mint e os testes) e **falha** se qualquer arquivo
contiver:
- a chave `groundingCitations` numa posição de escrita (literal de objeto / atribuição), ou
- a construção de um `Decision` com `kind: "decision"`.

Precedente in-repo real e já verde: `gate-approval-sole-mint.test.ts` (ADR 0005 §7, "confirmado por scan
estático"). Este é o controle que **sobrevive à serialização**, porque não é uma propriedade do dado — é uma
propriedade do **código**, verificada no CI a cada commit (Gate 7).

**(2) Protected-path.** `.conductor/gates/` já está em `defaultProtectedPaths()` (Fase 4); D9 acrescenta
`~/.conductor/library/`. Com os dois, nem o `GateState` nem o ledger que o alimenta são alcançáveis pelas
tools `write`/`edit`/`bash` do agente — a única mutação passa pelos comandos.

**(3) Resolução contra um ledger runtime-derived** (§6.1 item 1). É o que torna "citação" uma afirmação
sobre algo que **aconteceu**, e não sobre algo que foi **digitado**.

**Residual, declarado e não resolvido** (herdado de T53(iii)/T47): num SO single-user sem sandbox, quem já
tem capacidade de execução de código pode escrever o `events.jsonl` diretamente e forjar o evento. O
protected-path tira isso das tools do agente; o teto continua sendo o gate de execução da Fase 2 (T17/R1).
D4 eleva o custo do ataque de "digitar uma string plausível" para "escrever um evento de telemetria
consistente com um índice real" — **não** o elimina, e não afirmo o contrário.

### 6.3 O escritor que quebrava a alegação: `reject()`

Verificado abrindo `packages/conductor-cli/src/commands/gate-store.ts:283-308`. `reject()` escreve:

```ts
const decision: Decision = { gate, kind: "decision", text: reason, method: "auto", recordedAt: ... };
```

Um `Decision` de `kind: "decision"`, sem `groundingCitations`, por um caminho que não é
`recordGroundedDecision`. Com isso, o scan estático de (1) falharia sobre código legítimo, e a alegação "um
único writer de `kind:"decision"`" seria falsa.

**Decisão: `reject()` passa a escrever `kind: "rejection"`, uma variante nova da união.**

Justificativa de fundo (não só de conveniência do scan): uma rejeição **não é** uma decisão técnica
fundamentável. Não faz sentido exigir grounding de "o gate foi rejeitado por este motivo" — o motivo é o
julgamento de quem rejeita, e o registro é uma transição de estado, não uma escolha de design. Chamar as
duas coisas de `"decision"` sempre foi uma imprecisão do vocabulário; FR-16 apenas a tornou visível.
*Grounding:* **Domain-Driven Design §1.12** (0.550: um termo que significa duas coisas é exatamente onde a
linguagem ubíqua tem que escolher uma).

**Viabilidade, verificada e não presumida:**
- `grep` por consumo de `Decision["kind"]` em código de produção: **nenhum**. Nada faz `switch` nem
  comparação sobre esse campo (os `.kind ===` encontrados são de `EvidenceRef`, `PolicySource`,
  `GateStateMutationError`, `PermissionOutcome` e do `ParseOutcome` interno do store — nenhum de `Decision`).
- `CalibrationDecision extends Decision { kind: "calibration" }` continua válido sem alteração.
- Um `switch` exaustivo futuro que esqueça a variante nova vira **erro de compilação**, pelo mesmo padrão
  `const exhaustive: never` que `resolveEvidenceRef` já usa (`gate-evidence.ts:155`).

**Alternativa considerada:** um registro dedicado, `GateRecord.rejections: Rejection[]`, em vez de uma
variante nova. Rejeitada: acrescenta um quarto array ao `GateRecord` (mais superfície no envelope, no
checksum, na projeção do `gate status`) para expressar algo que a união já expressa; e quebraria a ordenação
cronológica natural entre decisões e rejeições dentro de `decisions[]`. Custo maior, ganho nenhum.

---

## 7. A extensão declarada do Apêndice §18 do ADR 0005

### 7.1 O que exatamente muda

Três mudanças, e só três, no contrato travado:

| Antes (ADR 0005 §18) | Depois (este ADR) |
|---|---|
| `Decision.kind: "reasoning" \| "decision" \| "plan" \| "calibration"` | `+ \| "rejection"` |
| `Decision.groundingCitations?: string[]` | `?: GroundingCitation[]` |
| `Evidence.groundingCitations?: string[]` | `?: GroundingCitation[]` |

Nada mais. `GateState`, `GateRecord`, `Risk`, `Approval`, `EvidenceRef`, `EvidenceProvenance`,
`CalibrationDecision`, `GateStateEnvelopeV1` (exceto `schemaVersion`), `GateAdvanceVerdict`,
`GateStateMutationError` e todas as assinaturas de função permanecem **literalmente** como estão.

### 7.2 Por que isto é estender, não redefinir

O §18 se apresenta como "contratos TypeScript (para o Gate 5/6 não reinventar a interface)" e diz de si
mesmo que são "ilustrativos de contrato, não código de produção pronto para commit". Ele é uma trava contra
**divergência acidental** — um agente de Gate 5 inventando uma segunda forma de `Approval` —, não um voto de
imutabilidade de tipo. E a própria spec da Fase 5 (§9.4) roteou esta decisão para este gate, nomeando o
custo: *"a segunda opção reabre o Apêndice §18 do ADR 0005 (um tipo hoje travado) — custo real que só o
Gate 4 deve pesar contra o ganho de tipagem forte."* Este ADR o pesa (§5.4) e paga.

ADRs são imutáveis: o §18 do ADR 0005 **não é editado**. Este ADR é o sucessor que declara a extensão, e o
§19 abaixo é o contrato consolidado que o Gate 5/6 da Fase 5 lê.

### 7.3 Migração de schema

`GateStateEnvelopeV1.schemaVersion` é o literal `1`. Mudar a forma de um campo dentro de `state` é uma
mudança de schema, e o próprio §18 já previa a saída: *"`schemaVersion: 1` LITERAL — v2 vira união
discriminada"*.

Decisão: **`schemaVersion: 2`**, com um leitor que aceita as duas versões. E a migração é trivial pela
mesma razão de §5.2 item 3: **nenhum arquivo v1 no mundo tem `groundingCitations` preenchido**, porque
nenhum produtor jamais existiu. Portanto:

- ler v1 → migrar em memória tratando `groundingCitations` como ausente; a primeira mutação regrava como v2;
- ler um v1 que **tenha** o campo preenchido (impossível hoje; um arquivo assim só existe se alguém o
  escreveu à mão sob um protected-path) → **`could-not-verify`**, fail-closed, nunca "interpreta como
  puder";
- ler v2 num binário antigo → `could-not-verify` pela validação de envelope já existente.

### 7.4 O que **não** muda, e por quê

`isGateGenuinelyApproved`/`hasSufficientEvidenceForMandatoryGate` **continuam sem ler
`groundingCitations`**. Verificado em `gate-state-policy.ts` e `gate-evidence.ts:208-211`: a suficiência de
um gate obrigatório é decidida só por `provenance`/`ref.kind`. FR-15 e BR-3 exigem que continue assim, e
este ADR não toca nessas funções. **Uma citação nunca fecha um gate obrigatório**; ela só decide se uma
`Decision` **pode ser registrada** (FR-16). São dois checks diferentes, deliberadamente desacoplados.

---

## 8. D5 — Procedência do corpus: `import` é Non-goal desta fase (decisão binária)

### 8.1 A decisão

**`conductor library import` NÃO existe na Fase 5.** Declarado como Non-goal, não adiado por omissão.

O que existe:
- **`library ingest`** — indexa o corpus local, com contenção R30: cada arquivo é `resolveRealPath`d e
  verificado `isWithinRoot(corpusRoot)` **antes** de ser lido; um symlink cujo alvo real sai da árvore é
  **recusado** (não pulado silenciosamente: reportado). Reusa `workspace-policy.ts`, não um segundo checador.
- **`library add <path>`** — copia um `.md` para dentro do corpus, com a mesma contenção resolvida (a
  disciplina que `cmd_add` já aplica na referência e que `iter_corpus` não aplicava).
- **`library update`** — busca a fonte configurada. Se a fonte for remota, ela passa por D10 (grant + SSRF)
  como qualquer outro egress; o unpack de archive rejeita entradas `..`/absolutas (anti-zip-slip, R30(ii));
  e uma fonte inalcançável **nunca** apaga o corpus local existente (FR-10).

### 8.2 Por que não

- **T48(c) é uma superfície de cadeia de suprimentos, não de RAG.** Um `.jsonl.gz` de embeddings importado
  faz `upsert` de `documents` que viram **passagens autoritativas com citação**. Verificar isso direito
  significa assinatura (Cosign/minisign), uma chave confiada, uma cerimônia de pinagem, e uma política de
  revogação — que é literalmente o escopo do Gate 7 (SBOM/assinatura/proveniência) e do Gate 10, não desta
  fase.
- **FR-11 (offline) não depende de `import`.** Com D1, o artefato offline **é** o `corpus.sqlite` produzido
  pela ingestão local. A propriedade que o plano pede — "o corpus básico é pesquisável sem rede após a
  ingestão inicial" — é entregue sem o vetor. A referência precisava do `_try_prebuilt` porque embedar sem
  GPU era caro; com o `bge-m3` via Ollama nativo já pressuposto pela Diary/Fase 6, a ingestão inicial é uma
  espera única, não uma barreira.
- **`--force` da referência (`library.py:545-559`) pula a checagem de modelo/dimensão.** Um flag que desliga
  a única validação que existia é o desenho oposto ao de R29(ii).

### 8.3 Pré-condições declaradas para uma fase futura

Se `import` voltar: (i) assinatura verificada **antes** do upsert, contra uma chave pinada por cerimônia
explícita; (ii) `--force` não existe; (iii) `embeddingModel`+`embeddingDim` do artefato conferem com os do
índice, sem exceção; (iv) Gate 3 próprio — é uma superfície de confiança nova, não uma opção de CLI.

*Grounding:* **Penetration Testing §14.2** (0.628: "supply-chain attacks (compromised packages,
typosquats, malicious post-install scripts) have become a leading breach vector"); **Secure Code Review
§3.3** (0.586/0.575: "at each boundary, the more-trusted side must treat input from the less-trusted side as
hostile until validated" — e a **confiança transitiva** é exatamente o que um artefato pré-computado
propaga); **OWASP ASVS V12.4.1** (0.568: arquivos de fontes não-confiáveis armazenados fora do caminho
servido, com permissões limitadas).

---

## 9. D6 — Code-aware: 7º sink de redação, aplicado **antes** do embed

### 9.1 A decisão

`REDACTION_SINKS` (`redaction.ts:34`) passa de 6 para **7 valores**, ganhando `"codeIndex"`. A enumeração
fechada é o mecanismo que o ADR 0003 §6.2 criou justamente para que "a lista está completa" seja um fato
asseverável e não um parágrafo — acrescentar o sink aqui é usar o mecanismo como projetado, não contorná-lo.

**A ordem é a decisão, não um detalhe de implementação:**

```
ler arquivo → redactSecrets(text) → chunk → embed → upsert
```

Nunca `embed → upsert → redigir na saída`. Um embedding computado sobre um segredo **carrega a informação
do segredo** e permanece recuperável por similaridade semântica mesmo que o texto devolvido seja mascarado —
a busca por "database password" ainda traria aquele chunk ao topo, e o vizinho semântico revela o contexto.
Redigir na saída trata o sintoma; redigir antes do embed remove o dado. É o ponto que o Gate 3 fez em T50
("um segredo embedado é pior que num log: fica recuperável por similaridade") transformado em ordem de
operações.

**Fail-closed no fail do scanner.** `redactSecrets` já devolve `SECRET_SCAN_FAILED_PLACEHOLDER` quando o
matcher lança (`redaction.ts:51`). Nesse caso o chunk **não é indexado** — indexar um placeholder polui o
índice sem benefício, e a contagem de chunks não-indexados é reportada por `library status`.

### 9.2 Allowlist, não denylist

Indexa-se apenas o que está na lista (R31(ii) pede allowlist explicitamente):

```
.ts .tsx .js .jsx .mjs .cjs .py .go .rs .java .kt .scala .rb .php .cs .c .h .cpp .hpp .swift .md
```

Fora da allowlist por construção — e nomeados no ADR para que uma adição futura seja uma decisão consciente,
não um esquecimento: `.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.ppk`, `id_rsa*`,
`.netrc`, `.htpasswd`, `.tfvars`, `.tfstate`, `.tf`, `.hcl`, `.sql`, `.sh`, `.bash`, `.yaml`, `.yml`,
`.json`, `.toml`, `.xml`.

Note que os seis últimos são exatamente os que a referência **incluía** (`code_aware_rag.py:27-33`) e são a
razão de T50 existir. Excluí-los custa recall em projetos de infra; o trade-off é explícito e cai do lado da
confidencialidade — um `.yaml` de k8s com um Secret é mais provável que uma pergunta que só um `.yaml`
responde, e a redação **é** a defesa em profundidade para o resto.

### 9.3 Exclusões adicionais e opt-in

- **Arquivos git-ignored são excluídos.** Uma chamada em lote `git check-ignore --stdin`; se o git não
  responder (timeout/ausente), **nada é indexado** — não "indexa tudo por precaução". A direção é a mesma de
  `getGitStatus` degradando para um sentinela, invertida: aqui a incerteza é sobre *confidencialidade*, não
  sobre *informação*, então ela nega.
- **Opt-in confirmado.** `--code-aware` só roda com um grant registrado (mesma cerimônia de D10) **ou** um
  `confirmOrDeny` interativo. Nunca ligado por default; num loop autônomo sem UI, `confirmOrDeny` nega
  (`!hasUI`) e o comando falha alto.

*Grounding:* **Penetration Testing §14.2** (0.628, supply chain/segredos em bundles); **Secure Code Review
§3.3** (0.586: o mais-confiado trata a entrada do menos-confiado como hostil até validar). Precedente de
código: Fase 3 R18/T21 — o code-index é o escritor novo que **tem** que reusar aquele seam.

---

## 10. D7 — Índice de código por-máquina, fora da árvore do workspace (SF-N1)

### 10.1 O achado que muda o desenho

O rascunho anterior colocava o índice de código (e, por dependência, o ledger de D13) sob
`<workspaceRoot>/.conductor/library/`. **Isso é repo-supplied.** Um repositório clonado pode chegar com um
`.sqlite` e um `events.jsonl` pré-fabricados: chunks que o atacante escolheu e eventos `rag-query` forjados
com ids que "resolvem". D4 inteiro cai — a citação seria "runtime-derived" contra um ledger do atacante, e
o controle mais forte desta fase viraria o vetor mais barato.

É a mesma classe que `policy-trust-store.ts` já enfrenta para `policy.json` (T18: "um `policy.json` que
chega dentro de um repositório clonado é um arquivo que um atacante pode autorar"), e a resposta tem que ser
a mesma: **um artefato que vem no clone nunca é autoridade**.

### 10.2 A decisão

**Localização por-máquina, na home do usuário, fora de qualquer workspace:**

```
~/.conductor/library/projects/<projectId>/code.sqlite
~/.conductor/library/projects/<projectId>/events.jsonl
```

- `projectId = sha256(realpath(workspaceRoot)).slice(0, 16)` — hex. **Precedente in-repo exato:**
  `resolveGateGitContext` já deriva `repoId` assim (`gate-store.ts:366`,
  `createHash("sha256").update(cwd).digest("hex").slice(0,16)`).
- **Separação física, não filtro compartilhado.** Um arquivo por projeto. Um `WHERE project_id = ?` esquecido
  numa consulta nova vaza; um arquivo que nunca é aberto não vaza. A contenção é uma propriedade do sistema
  de arquivos, não da disciplina de quem escreve SQL. *Grounding:* **Secure and Reliable Systems Design
  §3.12** (0.620: "the reachable authority has never been enumerated" — a falha de um filtro é
  precisamente uma autoridade alcançável que ninguém enumerou) e §3.1/§3.5 (blast radius, citados pelo
  Gate 3 em R32).
- **Manifest com recusa fail-closed.** A tabela `meta` carrega `projectId` e `workspaceRealPath`. Ao abrir:
  se `meta.projectId !== projectId(cwd)`, o arquivo é **recusado** — erro alto, sem fallback, sem
  "reconstrói por cima".
- **`chunkId = sha256(projectId + "\0" + relPath + "\0" + ordinal)`** — fecha T51(b) (colisão de id entre
  projetos com o mesmo caminho relativo) por construção.

### 10.3 A regra TOFU para um índice encontrado sob o workspace

**Um `.sqlite` de índice, ou um diretório `.conductor/library/`, encontrado sob o `workspaceRoot` NUNCA é
aberto.** Ele é ignorado e **reportado alto** (`library status` e `doctor` o nomeiam). Não é migrado, não é
"adotado após validação do manifest", não é apagado (apagar arquivo de um repositório do usuário não é
prerrogativa desta ferramenta).

O motivo de não validar-e-adotar: validar o manifest exige **abrir o arquivo**, e abrir um arquivo SQLite
atacante-fornecível é parsear um formato binário não-confiável — a metade de SF-N2 que este ADR fecha por
composição (§16.2). A única defesa que não tem essa dependência é não abrir.

### 10.4 Consequência que precisa ser dita em voz alta

O índice de código **não é versionável junto com o repositório**. Um time não pode commitar um índice
pré-construído para acelerar o onboarding. Isso é um custo real, e é deliberado: a mesma propriedade que
tornaria o índice compartilhável é a que o torna forjável. Se algum dia esse compartilhamento for pedido, a
resposta é a mesma de D5 — assinatura e cerimônia, num Gate 3 próprio; não um caminho relaxado aqui.

---

## 11. D8 — Pacote novo `@conductor/library`, com a seta apontando para dentro

### 11.1 A decisão

Um pacote novo, seguindo o padrão já estabelecido (`@conductor/{config,runtime,cli,project,secrets}`):

```
packages/conductor-library/src/
  library-home.ts       # resolução de ~/.conductor/library/** (borda: fs, homedir)
  corpus-store.ts       # node:sqlite, schema, upsert incremental, FTS5 (borda: fs/sqlite)
  code-index.ts         # índice por projeto: allowlist, redação, projectId, manifest (borda)
  embedding-client.ts   # HTTP para /api/embed do Ollama (borda: rede local)
  remote-endpoint.ts    # guarda SSRF + pin de IP + egress (borda: rede + audit)
  grounding-ledger.ts   # append-only JSONL; implementa a port GroundingLedgerReader (borda)
  fts-query.ts          # construção da expressão MATCH — PURA (D12)
  query-enrichment.ts   # projeto+stack+gate+papel — PURA (FR-3)
  hybrid-search.ts      # RRF + rerank + threshold — PURA (D14)
  chunking.ts           # parágrafo respeitando blocos de código — PURA
  index.ts
```

Mesma carta do ADR 0005 §2: **I/O na borda, política pura no meio**. Cinco módulos puros são testáveis sem
disco, sem rede e sem Ollama — que é o que permite ao Gate 5 escrever testes RED de verdade para FR-2, FR-3,
FR-4, FR-5 e D12 antes de qualquer motor existir.

### 11.2 A direção da dependência — a parte que importa

**`GroundingCitation` é declarado em `@conductor/runtime`** (arquivo novo `gate-grounding.ts`, irmão de
`gate-evidence.ts`), porque é parte do agregado `GateState` que `gate-state.ts` compõe. `recordGroundedDecision`
também vive lá.

`@conductor/library` **não** é importado por `@conductor/runtime`. A ligação é uma **port**:

```ts
// @conductor/runtime — gate-grounding.ts
export interface GroundingLedgerReader {
  findQueryEvent(queryEventId: string): RagQueryEventView | null;
  findRecentUnreachable(now: Date, windowMs: number): RagUnreachableEventView | null;
}
```

`@conductor/library` fornece o **adapter**; `@conductor/cli` (que já depende dos dois) é o composition root
que injeta. Assim:

- a regra de dependência é respeitada — a política de grounding (estável) não depende do motor de índice
  (volátil: `node:sqlite`, Ollama, formato de arquivo);
- o invariante do ADR 0002 §3.1 (`conductor-config` e `conductor-runtime` não dependem um do outro) segue
  intacto, e nenhuma aresta nova entre pacotes existentes é criada;
- os testes de `recordGroundedDecision` usam um ledger falso, sem tocar em SQLite — o mesmo split
  "fake the expensive collaborator, test the ordering/decision for real" que `ResolveEvidenceRefContext`
  já usa para `gitCommitExists`.

*Grounding:* **Architecture Boundaries and the Dependency Rule §1.7** (0.619, literalmente o exercício deste
desenho: *"find a use case in your code that imports an ORM or HTTP client directly. Introduce a port it
owns and move the concrete call to an adapter. Unit-test the use case with a fake"*) e **§1.1** (0.599: as
dependências de código-fonte apontam para dentro, rumo à política mais estável).

### 11.3 Alternativa considerada

**Módulo dentro de `@conductor/runtime`.** Menos cerimônia (um `package.json` a menos, uma entrada a menos
no workspace). Rejeitada: empurraria uma dependência de I/O pesada — SQLite, HTTP, um esquema de banco e
migrações — para dentro do pacote que hoje é a casa da **política de gates pura**, exatamente onde o ADR
0005 §2 investiu para manter o meio testável sem disco. *Grounding:* **Architecture Boundaries §1.12**
(0.600: a regra falha quando aplicada uniformemente, "so a codebase pays boundary costs on every file to
protect logic that only a fraction of them contain") — lido como o teste inverso e passando: aqui a fração
protegida (a máquina de gates) é justamente a que **não** pode herdar o custo.

---

## 12. D9 — Corpus e ledger globais em `~/.conductor/library/`, como protected path

### 12.1 A decisão

```
~/.conductor/library/corpus.sqlite                    # corpus global (livros — conteúdo público, compartilhável entre projetos)
~/.conductor/library/projects/<projectId>/code.sqlite  # código do projeto (NUNCA compartilhado — D7)
~/.conductor/library/projects/<projectId>/events.jsonl # ledger runtime-derived (D13)
```

O corpus de livros é global de propósito: é conteúdo público, idêntico para todos os projetos, e duplicá-lo
por projeto multiplicaria ~9 MiB e o tempo de ingestão por nada. O código **nunca** é global — a assimetria
é a decisão, e ela é exatamente a fronteira que T51 atacou.

`defaultProtectedPaths()` ganha uma entrada:

```ts
join(home, ".conductor", "library"),   // ao lado do já existente join(home, ".conductor", "credentials")
```

Como `isWithinRoot` faz correspondência de subárvore (documentado em `workspace-policy.ts:151`), uma entrada
protege o `corpus.sqlite`, todos os `projects/**` e o `events.jsonl` de uma vez.

### 12.2 Por que

Idêntico ao raciocínio que o ADR 0005 §9.1 aplicou a `.conductor/gates/`, e antes dele o ADR 0003 a
`.conductor/audit.jsonl`: **o registro tem que ser inescrevível pelo próprio agente cujos atos ele
registra.** Se `write`/`edit`/`bash` alcançam o `events.jsonl`, o agente forja o `rag-query` que D4 exige e
o controle vira decoração — pelo caminho **mais provável**, não pelo mais sofisticado.

Isto fecha o par com D7: D7 tira o ledger do alcance de um *clone hostil*; D9 tira do alcance do *próprio
loop*. As duas metades são necessárias — nenhuma sozinha basta.

**Residual re-declarado, sem inflação:** não há tamper-evidence criptográfica. Um humano (ou um processo
fora do loop do agente) com acesso ao disco ainda edita o arquivo. É a mesma GAP-4D já declarada para o
audit trail (R9), para o trust store (R11d) e para o `GateState` (§9.3 do ADR 0005) — este ADR **não** a
fecha e **não** afirma fechá-la.

---

## 13. D10 — Endpoint remoto: policy-grant + TOFU, e guarda SSRF sobre o IP resolvido

### 13.1 O caminho de decisão (nunca uma env var)

Verificado lendo `policy-loader.ts:mergePolicies`: um grant `network` só se torna efetivo quando **todas**
estas condições valem:

1. a fonte está `status: "loaded"` (schema válido — um `policy.json` malformado liga `denyAllPrivileged`
   para **todas** as fontes, `policy-loader.ts:228-232`);
2. `trustStore.isTrusted(kind, contentHash) === true` — o **content-hash exato** já aprovado por cerimônia
   humana; editar o `policy.json` muda o hash e derruba o grant;
3. o destino sobrevive à `intersectTrustOrdered` — ou seja, o `user-global` **também** precisa concedê-lo.
   Um `policy.json` de projeto sozinho **nunca** habilita um remoto.

Consequência de sistema, não de configuração: **sem cerimônia `conductor policy trust`, `network` intersecta
para o conjunto vazio e o remoto nasce desabilitado.** FR-13 ("o remoto é estritamente aditivo, nunca
pré-requisito") é satisfeito pela aritmética de `intersectTrustOrdered`, não por um `if` que alguém precisa
lembrar de escrever.

**Nenhuma variável de ambiente participa.** `CONDUCTOR_CHROMA_HTTP`/`CONDUCTOR_LIBRARY_REPO` não são lidos —
nem como default, nem como override, nem como "só se o policy não disser nada". É a mesma classe de
autoridade ambiente que T40/R22 e o `gate_land.py` já rejeitaram por escrito.

### 13.2 A guarda SSRF — sobre o **IP resolvido**, no momento da conexão

Esta é a correção que o parecer exigiu, e ela é estrutural: validar a **string** `destination` no momento em
que o grant é concedido não defende contra nada que importe. Entre a concessão e a conexão, o DNS resolve —
e resolve de novo, e pode resolver para outra coisa (rebinding); e um `302` muda o alvo depois de toda
validação.

`PolicyNetworkEntry` hoje é `{ destination: string }`. Ele **não carrega informação suficiente** para a
guarda decidir. Extensão mínima (a mesma disciplina de "allow lists of protocols, domains, paths and ports"
da ASVS V5.2.6):

```ts
export interface PolicyNetworkEntry {
  destination: string;                 // host, sem esquema — o allowlist
  scheme?: "https" | "http";           // default "https"; "http" exige allowPlaintext
  port?: number;                       // default do esquema
  allowPlaintext?: boolean;            // default false
  /** ÚNICA forma de alcançar 127.0.0.1 (ex.: um Chroma local do próprio usuário) — explícito, por entrada. */
  allowPrivateAddress?: boolean;       // default false
}
```

E a guarda, no **momento da conexão**, em quatro passos, todos obrigatórios:

1. **Allowlist de host/porta/esquema** contra a entrada concedida — correspondência exata de host, nunca
   sufixo/substring (mesma disciplina de `_is_approval`: allowlist positivo, nunca `endsWith`).
2. **Resolver** (`dns.lookup(host, { all: true })`) e **rejeitar se QUALQUER endereço** resolvido cair em:
   loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16` — inclui `169.254.169.254`, metadata de
   nuvem — e `fe80::/10`), privado (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), unspecified
   (`0.0.0.0`, `::`), ou IPv4 mapeado em IPv6 disfarçando qualquer um dos acima (`::ffff:127.0.0.1`).
   Rejeitar se **qualquer** endereço bate, não "se o primeiro bate" — um resolvedor hostil devolve uma lista.
   Escapatória: só `allowPrivateAddress: true` naquela entrada.
3. **Pinar o IP e conectar naquele IP** (com `Host`/SNI do hostname original). É isto que fecha a janela
   TOCTOU entre a resolução e o `connect` — sem o pin, a validação e a conexão podem ver respostas de DNS
   diferentes, que é a definição de DNS rebinding.
4. **`redirect: "manual"`.** Cada `3xx` re-entra nos passos 1–3 **inteiros** para o novo alvo. Nunca seguir
   redirect automaticamente; um limite de saltos, e estouro é recusa.

### 13.3 Egress registrado **antes** do envio

`AuditEntry.egress` já existe (`audit-trail.ts:56`) e `createAuditTrailWriter` é síncrono e durável no
retorno — o header desse arquivo já documenta exatamente a garantia que aproveitamos: *"a caller that writes
the Egress Event and only then performs the network call gets a real ordering guarantee for free from this
synchronous contract, not from a race."*

Extensão mínima do campo, para que o registro diga **o que** saiu e **para onde de verdade**:

```ts
egress?: { destination: string; resolvedIp?: string; payloadKind?: "query-embedding" | "corpus-fetch" };
```

### 13.4 O que **nunca** sai da máquina

**O índice de código e seus embeddings são estritamente locais.** Mesmo com um remoto habilitado e confiado,
`code.sqlite` nunca é consultado remotamente e seus vetores nunca são enviados. Isto fecha a metade pior de
T52(a) — "o código-fonte do projeto (incl. segredos) é embedado e enviado ao host remoto" — **por
construção**, não por configuração correta. A referência tinha esse problema porque `index_project` e
`search` compartilhavam o mesmo `_client()`; aqui são dois stores diferentes com duas bordas diferentes.

O que **ainda** sai, quando o remoto está ligado e consentido: o **embedding da pergunta enriquecida**. Isso
vaza intenção (tipo de projeto, techs, gate, papel — FR-3). É o preço do remoto, é declarado, e é por isso
que o remoto exige cerimônia dupla e nasce desligado.

*Grounding:* **Penetration Testing §12.9** (top **0.638**: *"Server-side URL fetches use an allowlist and
block private/link-local ranges. Cloud metadata is protected (IMDSv2...)"*) e **§12.5** (0.633: o exemplo
real em que "the avatar fetcher rejects internal/metadata URLs"); **OWASP ASVS V5.2.6** (0.605: *"protects
against SSRF... uses allow lists of protocols, domains, paths and ports"*). **Nota de cobertura honesta:** a
biblioteca cobre allowlist + faixas privadas + metadata explicitamente; **não** cobre nominalmente *pin de
IP* nem *re-validação em redirect* como técnicas — essas duas são derivadas do mesmo princípio (a validação
tem que ser sobre o que se conecta, não sobre o que se declarou) e da própria mecânica do TOCTOU, não
forçadas numa citação que não as diz.

---

## 14. D11 — Falha alta, e `--lexical-only` como caminho explícito e distinto

### 14.1 A decisão

- **Backend indisponível → falha alta.** `library search` sai com código ≠ 0, nomeia **qual** backend
  (embeddings/índice/remoto) e a ação corretiva, e grava um `rag-unreachable` no ledger **antes** de sair.
  Nunca devolve lista vazia ou parcial com cara de resposta.
- **`--lexical-only` é um modo legítimo, pedido explicitamente.** Ele consulta só o FTS5 (que vive em disco e
  não precisa nem de rede nem de Ollama), grava um `rag-query` normal com `mode: "lexical-only"`, e a
  citação dele é uma citação **válida** que satisfaz FR-16.
- **`--lexical-only` NUNCA é inferido.** Se o embed falhar, o comando **falha** — não cai para lexical
  silenciosamente. Cair seria exatamente o "resultado degradado silenciosamente" que FR-12 proíbe, e pior:
  produziria uma citação de qualidade diferente sem que ninguém tivesse escolhido isso.

### 14.2 A distinção que nunca pode borrar

Os dois caminhos são **tipos diferentes no ledger** e **funções diferentes na API**:

| | Evento gravado | Função que a consome | O que a citação afirma |
|---|---|---|---|
| Busca híbrida | `rag-query` (`mode:"hybrid"`) | `recordGroundedDecision` | "esta passagem foi recuperada" |
| Busca só-lexical explícita | `rag-query` (`mode:"lexical-only"`) | `recordGroundedDecision` | idem, com o modo registrado |
| Backend fora do ar | `rag-unreachable` | `recordUngroundedDecision` | "o runtime tentou e falhou" |

`recordGroundedDecision` **não aceita** um `rag-unreachable`; `recordUngroundedDecision` **não aceita** um
`rag-query`. Não há parâmetro booleano que os una. É a mesma razão pela qual o ADR 0003 separou "malformado"
de "ausente" em `PolicyLoadResult` por tipo e não por flag: a distinção passa a ser garantida pelo
compilador, não pela memória de quem escreve o próximo caller.

*Grounding:* **Stability Patterns for Production §2.10** (0.627: "no fast-fail path, so callers always wait
the timeout" — o antipadrão que a falha alta evita) e **§3.5** (0.628: degradação graciosa, o widget que
simplesmente some). A leitura correta é o **contraste**: degradação graciosa é certa quando o produto é uma
página que ainda serve seu propósito sem o widget; é **errada** aqui, porque o produto deste canal é uma
*prova de fundamentação* — uma prova parcial apresentada como completa não é uma UX degradada, é uma
afirmação falsa.

---

## 15. D12 — A expressão FTS5 MATCH é construída pelo runtime; bind é necessário e não suficiente

### 15.1 O achado, verificado empiricamente nesta sessão

Sondei `node:sqlite` com uma tabela FTS5 em memória e um `SELECT ... WHERE t MATCH ?`, passando a expressão
como **parâmetro ligado**:

| Entrada ligada como parâmetro | Resultado observado |
|---|---|
| `bulkhead` | casa 1 documento (normal) |
| `bulkhead OR leaked` | casa **2** documentos — o `OR` foi **interpretado como operador** |
| `title:secret` | casa só o documento cuja **coluna `title`** contém "secret" — filtro de coluna aplicado |
| `lea*` | casa por **prefixo** |
| `"api key"` | casa como **frase** |
| `^circuit` | casa por **token inicial** |
| `NOT bulkhead` | **LANÇOU**: `fts5: syntax error near "NOT"` |
| `bulkhead AND "` | **LANÇOU**: `unterminated string` |

**Conclusão: ligar o parâmetro não escapa a sintaxe FTS5.** São dois parsers — o do SQL (protegido pelo
bind) e o do FTS5 (que recebe a string já ligada e a interpreta como expressão de consulta).

Duas consequências, e a primeira **não é de segurança**:

1. **Disponibilidade (auto-DoS do canal de grounding).** Uma pergunta legítima — `"does NOT resolve"`,
   `qual o papel do "sole-mint"?` — **derruba a busca inteira** com um erro de sintaxe do FTS5. O canal cuja
   função é fundamentar decisões falha em perguntas escritas em português/inglês normal.
2. **Segurança (injeção de sintaxe).** O enriquecimento de FR-3 concatena tipo de projeto e techs vindas de
   `.conductor/config.json` — **repo-supplied** — mais o nome do papel. Um `title:` injetado ali reescreve o
   recorte que o chamador pediu; um `*` altera o recall; um `OR` amplia o conjunto para além do filtro de
   FR-4, contradizendo BR-8 sem nenhum sinal de erro.

### 15.2 A decisão

Uma função **pura**, `buildFtsMatchExpression`, é o único lugar que produz uma expressão MATCH:

1. tokeniza o texto por `[^\p{L}\p{N}_]+` (descarta todo caractere que possa ser operador);
2. escapa cada token como **string literal FTS5**: `"` → `""`, envolto em aspas duplas;
3. junta os tokens com o operador que o **runtime** escolhe (`OR` para recall no primeiro estágio), e
   compõe as cláusulas estruturais (grupos, pesos) também no runtime;
4. o resultado é passado ao SQLite **ligado como parâmetro** (`MATCH ?`), nunca concatenado no SQL.

A **estrutura** da expressão é autoria do runtime; do usuário vêm apenas **valores**, e chegam como literais
que o FTS5 não pode reinterpretar como operadores.

**Verificado, mesma sessão, com a função de escape aplicada:**

| Entrada | Expressão gerada | Resultado |
|---|---|---|
| `NOT bulkhead` | `"NOT" OR "bulkhead"` | casa normalmente, **não lança** |
| `title:secret` | `"title" OR "secret"` | casa "secret" como **termo**, sem filtro de coluna |
| `bulkhead AND "` | `"bulkhead" OR "AND"` | casa normalmente, **não lança** |
| `does NOT resolve` | `"does" OR "NOT" OR "resolve"` | casa normalmente |

Os filtros de FR-4 (categoria/tecnologia/versão) **nunca** entram na expressão MATCH: viram cláusulas
`WHERE` sobre colunas normais da tabela `chunk`, com bind, e um valor não reconhecido é reportado
explicitamente (BR-8), nunca silenciado.

*Grounding:* **Web Application Security §1.9** (top **0.736**: *"I never concatenate untrusted input into
queries/commands. I use parameterized queries / safe APIs. Input is treated as data, not code. Validation
backs up parameterization"*) e **§1.5** (0.711); e — o hit que descreve exatamente este caso — **§1.12 "When
not to reach for a bind parameter"** (0.644): *"Parameterization stays the default for every value... the
limit is on what a placeholder can carry... Where it cannot carry the untrusted part, the answer is a
different structural control (an allowlist, an arg...)"*. A expressão FTS5 é precisamente uma posição que um
placeholder **não** neutraliza; a tokenização-e-citação é o controle estrutural que §1.12 manda usar no
lugar. **Penetration Testing §8.5** (0.603, o exemplo Node de parametrização) reforça o lado SQL.

---

## 16. D13 — O ledger de eventos runtime-derived

### 16.1 A decisão

`~/.conductor/library/projects/<projectId>/events.jsonl` — **JSONL append-only**, síncrono, mode `0o600`,
**lança** em falha de I/O. Mesma forma e mesma disciplina que `audit-trail.ts` já implementa (e cujo
`createAuditTrailWriter` é o modelo direto).

```jsonc
{ "kind":"rag-query", "id":"…", "projectId":"…", "question":"…", "enrichedQuery":"…",
  "mode":"hybrid", "corpusVersion":"…", "embeddingModel":"bge-m3", "gate":4, "role":"software-architect",
  "topScore":0.736, "hits":[{ "chunkHash":"…", "source":"…", "section":"…", "path":"…",
  "category":"…", "score":0.736 }], "at":"2026-08-06T…Z" }

{ "kind":"rag-unreachable", "id":"…", "projectId":"…", "backend":"embeddings",
  "reason":"connect ECONNREFUSED 127.0.0.1:11434", "at":"2026-08-06T…Z" }
```

### 16.2 Por que JSONL separado, e não uma tabela dentro do `.sqlite`

Porque são **domínios de falha diferentes**. `library ingest`/`update` reescrevem o índice; um `rag-query`
de ontem precisa continuar resolvendo a citação de ontem (BR-5: a citação é um **retrato**, não um ponteiro
vivo). Se o ledger vivesse dentro do índice, uma reindexação ou uma corrupção do índice apagaria a prova de
que as buscas anteriores aconteceram — e a prova é justamente o que não pode depender do artefato que ela
descreve. *Grounding:* **Secure and Reliable Systems Design §3.3** (scope/duration/failure domains, citado
pelo Gate 3 em R33).

### 16.3 A janela do FR-17, e por que ela é uma constante do código

`recordUngroundedDecision` aceita um `rag-unreachable` gravado dentro de **15 minutos** do `recordedAt` da
decisão.

- **Por que uma janela e não "qualquer evento":** sem ela, um único evento honesto de três meses atrás vira
  um passe-livre permanente para pular grounding — o abuso exato que R35 existe para fechar.
- **Por que 15 minutos:** o operador precisa de espaço para diagnosticar e tentar de novo sem que o gate
  trave; 1 minuto transformaria uma indisponibilidade real numa corrida. É um número **escolhido**, não
  derivado de nenhuma fonte — declarado como tal.
- **Por que uma constante do código e não configurável:** um valor configurável por `policy.json` seria
  repo-supplied, e "janela = 10 anos" reabriria o bypass pela porta da configuração. Fonte única no código,
  mesma disciplina de `MANDATORY_GATES` (ADR 0005 §4).

### 16.4 Retenção

Sem expurgo automático nesta fase — o arquivo é pequeno (uma linha por consulta). `library status` reporta
tamanho e contagem. Se um evento for removido manualmente, a `GroundingCitation` **já persistida** continua
legível como rastro histórico (BR-5); apenas a re-resolução contra o ledger vivo passa a dizer "não
encontrado", exatamente como o edge case §7.3 da spec já prevê para um chunk removido.

---

## 17. D14 — Reranking leve, declaradamente não um cross-encoder

### 17.1 O pipeline completo

```
pergunta crua
  → enriquecimento (projeto, stack, gate, papel)                   [puro — FR-3]
  → { FTS5 bm25 top-50 (expressão de D12) , cosseno flat top-50 }  [borda]
  → RRF: score = Σ 1/(60 + rank)                                   [puro — FR-2]
  → rerank leve sobre os top-30 fundidos                           [puro — §17.2]
  → threshold de relevância                                        [puro — FR-5/BR-2]
  → passagens com citação obrigatória                              [FR-6/BR-1]
```

O `k=60` do RRF é a constante do próprio **Context Engineering §4.4** (0.762, que traz o pseudocódigo
`rrf_merge(dense, lexical, k=60)` literalmente).

### 17.2 O reranker, e a honestidade sobre o que ele não é

**Context Engineering §4.5 "Reranking: Spend Compute Where the Candidates Are"** (0.662) define rerank como
um **cross-encoder** que lê par-a-par: caro por candidato, e é justamente esse custo que compra a qualidade.
Rodar um cross-encoder por consulta em CPU é incompatível com a restrição de hardware desta fase.

Decisão em duas camadas:

1. **Default — rerank leve, determinístico, puro.** Reordena os top-30 fundidos por uma combinação de
   features que o **primeiro estágio não usou**: (a) cobertura lexical — fração dos tokens de conteúdo da
   pergunta presentes no chunk; (b) casamento com o título da seção; (c) os dois scores normalizados dentro
   do conjunto de candidatos. É um segundo estágio genuíno (features novas, não uma reordenação pelo mesmo
   sinal), e custa microssegundos.
2. **Opt-in — `--rerank cross-encoder`**, usando um modelo servido pelo Ollama, se o usuário tiver um.
   **Desligado por default.**

**Declaração explícita, para o Gate 8 não ser induzido a erro:** a camada 1 **não é** o cross-encoder de
§4.5 e **não** afirmo paridade de qualidade com ele. É a aproximação que o orçamento de hardware permite,
com o caminho para o real disponível e nomeado.

**Conexão com D3, que não é acidental:** a normalização min-max da feature (c) tem denominador `max - min`,
que é **zero** quando todos os candidatos empatam — `NaN` por aritmética normal, num dia normal. Este é o
caminho concreto pelo qual um score não-finito chegaria a uma `GroundingCitation` e travaria toda mutação do
gate (§5.3). A guarda de finitude não é defesa contra um atacante hipotético; é defesa contra **este** bug.

O threshold (FR-5/BR-2) é aplicado **depois** do rerank, sobre o score reordenado. *Grounding:* **Context
Engineering §4.6** ("Selection: Top-k, Thresholds, and the Courage to Retrieve Nothing", 0.653 na sessão do
Gate 2).

---

## 18. SLIs e SLOs por componente (objetivo explícito do Gate 4)

Medidos em Gate 11; **definidos aqui**, antes da primeira linha de código.

| # | SLI | Alvo | Tipo |
|---|---|---|---|
| 1 | Latência de `library search` (híbrida, corpus core local) | p95 < **800 ms** (dominado pelo embed da pergunta no Ollama) | SLO |
| 2 | Latência de `library search --lexical-only` (sem rede, sem embed) | p95 < **120 ms** | SLO |
| 3 | Latência de `library status` | p95 < **50 ms** (paridade com `gate status`, ADR 0005 §12) | SLO |
| 4 | `library ingest` de rotina, nenhum arquivo alterado: **chamadas de embed** | **0**, sempre | Invariante (FR-9/BR-9) |
| 5 | Resultado de `search` devolvido **sem** citação completa | **0** | Invariante, error-budget 0 (FR-6/BR-1) |
| 6 | `Decision{kind:"decision"}` persistida sem citação resolvida **nem** `rag-unreachable` na janela | **0** | Invariante, error-budget 0 (FR-16/R34) |
| 7 | Egress remoto sem `AuditEntry.egress` gravado **antes** | **0** | Invariante, error-budget 0 (R33) |
| 8 | Chunk em `code.sqlite` contendo um padrão detectável por `@conductor/secrets` | **0** (medido por scan do índice no CI) | Invariante, error-budget 0 (R31) |
| 9 | `search` sobre o corpus core com a rede desligada | **100 %** sucesso | Invariante (FR-11/BR-6) |
| 10 | Backend fora do ar → exit ≠ 0 **e** `rag-unreachable` gravado | **100 %** | Invariante (FR-12/BR-7) |

**Honestidade sobre a natureza destes números.** *Grounding:* **Site Reliability Engineering §1.12** (0.661):
SLOs valem *"a continuously served, user-facing request path with enough traffic that the ratio is a
measurement"*. Um CLI single-user **não é isso**. Por isso só os itens 1–3 são SLOs de verdade (latência,
com distribuição real ao longo do uso); os itens 4–10 são **invariantes com error-budget zero** — asseverados
por teste no Gate 5/7, não estimados por amostragem. Chamá-los todos de "SLO" seria usar o vocabulário
errado e prometer uma medição que não existe. **§1.5** (0.647) é a leitura complementar: o alvo tem que ser
atingível e ligado a algo que o usuário nota.

---

## 19. Apêndice — contratos TypeScript consolidados (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. **Este apêndice ESTENDE o §18 do ADR
> 0005** nos três pontos de §7.1; tudo que não aparece aqui permanece exatamente como lá.

```typescript
// ==== @conductor/runtime — gate-state.ts (DELTA sobre ADR 0005 §18) ====
export interface Decision {
  gate: number;
  kind: "reasoning" | "decision" | "plan" | "calibration" | "rejection";  // + "rejection" (D4)
  text: string;
  method: ApprovalMethod;
  groundingCitations?: GroundingCitation[];   // era string[] (D3)
  recordedAt: string;
}
export interface Evidence {
  gate: number; ref: EvidenceRef; provenance: EvidenceProvenance; note?: string;
  groundingCitations?: GroundingCitation[];   // era string[] (D3) — a metade que o parecer exigiu
  recordedAt: string;
}
export interface GateStateEnvelopeV2 { schemaVersion: 2; /* resto idêntico ao V1 */ }
// Leitor aceita 1|2; um v1 com groundingCitations preenchido -> could-not-verify (§7.3)

// ==== @conductor/runtime — gate-grounding.ts (NOVO; irmão de gate-evidence.ts) ====
export interface GroundingCitation {
  queryEventId: string; chunkHash: string; question: string;
  source: string; section: string; path: string; category: string;
  corpusVersion: string; embeddingModel: string;
  score: number;            // FINITO e em [0,1] — validado ANTES de persistir (D3/§5.3)
  retrievedAt: string;      // ISO-8601 string, nunca Date
  mode: "hybrid" | "lexical-only";
}

/** PORT (D8): a Library é o adapter; conductor-runtime NUNCA importa conductor-library. */
export interface RagQueryEventView {
  id: string; question: string; enrichedQuery: string; mode: "hybrid" | "lexical-only";
  corpusVersion: string; embeddingModel: string; at: string;
  hits: readonly { chunkHash: string; source: string; section: string; path: string;
                   category: string; score: number }[];
}
export interface RagUnreachableEventView { id: string; backend: string; reason: string; at: string; }
export interface GroundingLedgerReader {
  findQueryEvent(queryEventId: string): RagQueryEventView | null;
  findRecentUnreachable(now: Date, windowMs: number): RagUnreachableEventView | null;
}

export const UNREACHABLE_WINDOW_MS = 15 * 60_000;   // constante do CÓDIGO, nunca configurável (D13/§16.3)

export type RecordDecisionError =
  | { kind: "citation-required" }                                   // FR-16 fail-closed
  | { kind: "citation-unresolved"; queryEventId: string; chunkHash: string }
  | { kind: "citation-invalid"; reason: string }                    // score não-finito/fora de [0,1] (D3)
  | { kind: "no-recent-unreachable" }                               // FR-17 sem lastro (R35)
  | { kind: "store"; error: GateStateMutationError };

/** O ÚNICO produtor de Decision{kind:"decision"} + groundingCitations (D4).
 *  NUNCA aceita uma GroundingCitation pronta: recebe ponteiros e RESOLVE contra o ledger.
 *  Não-forjabilidade durável = sole-mint por scan estático + protected-path + esta resolução;
 *  NÃO um brand/Symbol (que não sobrevive ao JSON — ADR 0005 §7). */
export function recordGroundedDecision(
  store: GateStateStore,
  input: { gate: number; text: string; method: ApprovalMethod;
           citations: readonly { queryEventId: string; chunkHash: string }[] },
  ledger: GroundingLedgerReader,
): Result<{ next: GateState; revision: number }, RecordDecisionError>;

/** Caminho FR-17, SEPARADO por tipo — nunca um booleano no anterior (D11/§14.2). */
export function recordUngroundedDecision(
  store: GateStateStore,
  input: { gate: number; text: string; method: ApprovalMethod;
           override?: { reason: string; acceptedBy: string } },
  ledger: GroundingLedgerReader, now: Date,
): Result<{ next: GateState; revision: number }, RecordDecisionError>;

// ==== @conductor/runtime — redaction.ts (DELTA: 6 -> 7 sinks, D6) ====
export const REDACTION_SINKS = [
  "transcript","notify","sessionJsonl","auditTrail","rethrownError","sessionExport",
  "codeIndex",                                   // NOVO — aplicado ANTES do embed, nunca depois
] as const;

// ==== @conductor/runtime — workspace-policy.ts (DELTA, D9) ====
// defaultProtectedPaths() ganha: join(homedir(), ".conductor", "library")

// ==== @conductor/runtime — audit-trail.ts (DELTA, D10/§13.3) ====
export interface AuditEntry { /* … inalterado … */
  egress?: { destination: string; resolvedIp?: string;
             payloadKind?: "query-embedding" | "corpus-fetch" };
}

// ==== @conductor/config — policy-loader.ts (DELTA, D10/§13.2) ====
export interface PolicyNetworkEntry {
  destination: string;                 // host — allowlist exato, nunca sufixo/substring
  scheme?: "https" | "http";           // default "https"
  port?: number;
  allowPlaintext?: boolean;            // default false
  allowPrivateAddress?: boolean;       // default false — ÚNICA porta para loopback/privado
}
// mergePolicies/intersectTrustOrdered INALTERADOS: é a aritmética deles que faz o remoto
// nascer desabilitado sem cerimônia (§13.1).

// ==== @conductor/library (NOVO pacote, D8) ====
export interface RetrievedPassage {                 // EFÊMERO — nunca persistido (é a citação que persiste)
  chunkId: string; chunkHash: string; body: string;
  source: string; section: string; path: string; category: string;
  tech?: string; version?: string; score: number;
}
export type SearchOutcome =
  | { ok: true; passages: RetrievedPassage[]; queryEventId: string; mode: "hybrid" | "lexical-only" }
  | { ok: false; kind: "backend-unreachable"; backend: "embeddings" | "index" | "remote";
      reason: string; unreachableEventId: string }        // FR-12: falha ALTA, evento gravado (D11)
  | { ok: false; kind: "empty-index" }                    // edge case §7.1 — distinto de "nada relevante"
  | { ok: false; kind: "unknown-filter"; facet: string; value: string; available: string[] };  // BR-8

/** PURA (D12) — o ÚNICO produtor de uma expressão MATCH. Bind é necessário e NÃO suficiente:
 *  o parâmetro ligado continua sendo parseado como expressão FTS5 (verificado empiricamente, §15.1). */
export function buildFtsMatchExpression(text: string, join: "OR" | "AND"): string;

/** PURA (D14) — RRF k=60 (Context Engineering §4.4), depois rerank leve, depois threshold. */
export function fuseAndRerank(
  lexical: readonly RetrievedPassage[], dense: readonly RetrievedPassage[],
  question: string, options: { rrfK: number; topK: number; threshold: number },
): RetrievedPassage[];

/** PURA (FR-3) — os 4 eixos do plano §4.11. */
export function enrichQuery(raw: string,
  ctx: { projectType?: string; technologies?: string[]; gate?: number; role?: string }): string;

/** BORDA (D7): recusa fail-closed se meta.projectId divergir; NUNCA abre um caminho sob o workspace. */
export function openCodeIndex(projectId: string, workspaceRealPath: string):
  | { ok: true; store: CodeIndexStore }
  | { ok: false; reason: "project-mismatch" | "repo-supplied-path-refused" | "missing" | "corrupt" };

/** BORDA (D10): allowlist -> resolve -> rejeita privado/link-local/metadata -> PINA o IP ->
 *  redirect manual re-entra na guarda inteira. Grava o egress ANTES de enviar. */
export function connectRemote(entry: PolicyNetworkEntry, audit: AuditTrailWriter):
  Promise<{ ok: true; conn: RemoteConnection } | { ok: false; reason: string }>;
```

**Superfície CLI:**

```text
conductor library status
conductor library ingest  [--tier core|supporting|foundational|optional] [--stack <s>]
conductor library update
conductor library add     <path>
conductor library search  "<pergunta>" [--gate N] [--role <papel>]
                          [--category <c>] [--tech <t>] [--version <v>]
                          [-k N] [--lexical-only] [--code-aware] [--rerank cross-encoder] [--json]
# NÃO existe: conductor library import   (D5 — Non-goal declarado, não omissão)
```

---

## 20. Rastreabilidade

| Decisão | FR / BR / G da spec | Regra / ameaça do Gate 3 | Achado do parecer |
|---|---|---|---|
| **D1** motor `node:sqlite`+FTS5+BLOB flat | G6, FR-11, FR-13, spec §9.1 | — | — |
| **D2** TS nativo | spec §9.2 | R30, R31, R32, R33 (a razão de não embrulhar) | — |
| **D3** `GroundingCitation` nos dois campos + finitude | G7, FR-14, BR-4, BR-5, spec §9.4 | R34 / T53, GAP-5A | **fechado:** `Evidence` incluída; guarda de finitude |
| **D4** mint único + `kind:"rejection"` | FR-16, BR-10, G10 | R34 / T53 | **fechado:** sole-mint por scan estático (não token); `reject()` reclassificado |
| **D5** `import` Non-goal | FR-10, FR-11, spec §3 | R29(ii) / T48(c), GAP-5C | **fechado:** decisão binária = NÃO |
| **D6** 7º sink `"codeIndex"` | FR-7, G5 | R31 / T50, GAP-5D | — |
| **D7** índice por-máquina fora do workspace | FR-7, G5 | R32 / T51 | **fechado: SF-N1** |
| **D8** pacote `@conductor/library` | G1 | — | — |
| **D9** `~/.conductor/library` protegido | G7, FR-16 | R33, R34 | **fechado: SF-N1** (metade "próprio loop") |
| **D10** remoto por policy + SSRF por IP resolvido | FR-13, G6 | R33 / T52, GAP-5B | **fechado:** IP resolvido + pin + redirect; `PolicyNetworkEntry` estendido |
| **D11** falha alta + `--lexical-only` | FR-12, FR-17, BR-7, G6 | R35 / T54 | **fechado:** dois caminhos separados por tipo |
| **D12** expressão MATCH construída pelo runtime | FR-2, FR-4, BR-8 | R29 (dado ≠ instrução) | **fechado: SF-N2** (metade injeção) |
| **D13** ledger JSONL + janela de 15 min | FR-14, FR-17, BR-5 | R34, R35 | **fechado:** o lastro que D4 resolve |
| **D14** rerank leve declarado | FR-2, FR-5, BR-2, G2 | — | — |
| §18 SLIs/SLOs | critério de saída do Gate 4 | — | — |

Cobertura das 6 questões abertas da spec §9: **1** → D1+D10 (§3, §13); **2** → D2 (§4); **3** → D4 (§6, o
ponto de aplicação é `recordGroundedDecision`, não um hook de `commit-msg`); **4** → D3+§7 (§5, §7);
**5** → mantida Non-goal (spec §3, sem mudança); **6** → D5 (§8, resolvida como Non-goal, não adiada).

---

## 21. Consequências

### 21.1 Positivas

1. **Uma citação passa a ser uma afirmação sobre algo que aconteceu.** É a diferença entre o non-negotiable
   #1 do `CLAUDE.md` ser um controle e ser um hábito.
2. **Zero dependências novas de terceiros.** `node:sqlite` é builtin; o Ollama já era pressuposto. O
   inventário de cadeia de suprimentos do Gate 7 não cresce.
3. **Zero Docker, zero servidor, zero GPU obrigatória.** A restrição de hardware do usuário é atendida por
   arquitetura, não por configuração cuidadosa.
4. **Cinco módulos puros** (`fts-query`, `query-enrichment`, `hybrid-search`, `chunking`, e as validações de
   `gate-grounding`) permitem que o Gate 5 escreva testes RED reais antes de qualquer motor existir.
5. **Duas classes de vazamento fechadas por construção, não por configuração correta:** código de projeto
   nunca sai da máquina (D10.4); índice de um projeto nunca é aberto na sessão de outro (D7).
6. **Um defeito de disponibilidade encontrado antes de existir** (D12): perguntas com `NOT` ou aspas
   quebrariam a busca em produção, e nenhum teste de unidade escrito a partir da spec teria pego isso.

### 21.2 Riscos aceitos (com mitigação)

| Risco | Mitigação | Residual |
|---|---|---|
| `node:sqlite` é experimental; a superfície do flag varia por minor do Node | Sondagem de boot fail-closed (§3.3); precedente in-repo já publicado com o mesmo floor de `engines` | Um bump de Node pode exigir ajuste — detectado na primeira execução, não em silêncio |
| Varredura linear degrada se o corpus crescer muito além do previsto | §3.2 mostra margem de 22× até 50 k chunks; o esquema já isola o estágio denso atrás de uma função | Se um dia romper, trocar por ANN é uma mudança local em `corpus-store.ts` |
| Rerank leve não iguala um cross-encoder | Declarado explicitamente (§17.2); caminho para o real disponível como opt-in | Qualidade de ranking inferior ao estado da arte — assumido |
| Quem já tem execução de código forja o `events.jsonl` | Protected-path (D9) tira do alcance das tools; gate de execução da Fase 2 é o teto | **Declarado, não resolvido** — mesmo teto de T47 |
| Sem tamper-evidence criptográfica em nenhum store | Herdado; mesma GAP-4D | **Declarado, não resolvido** |
| Bump para `schemaVersion: 2` | Migração trivial (nenhum dado legado — §5.2 item 3); leitor aceita ambos | Um binário antigo lendo um v2 falha `could-not-verify` — direção correta |
| Índice de código não é versionável/compartilhável | Deliberado (§10.4) | Onboarding paga a ingestão local uma vez |

### 21.3 Negativas / custos assumidos

- **Um pacote novo** no workspace (`package.json`, `tsconfig`, suíte de testes, entrada de build).
- **Reescrita de ~250 LOC** que já existem testadas em Python — pago pelas razões de §4.1, não de gosto.
- **Recall menor em projetos de infra** no code-aware, pela exclusão de `.tf`/`.yaml`/`.json`/`.sql` (§9.2).
- **Uma mudança de tipo num contrato travado** e o bump de schema que ela implica (§7).
- **Um estágio a mais no pipeline de consulta** (`buildFtsMatchExpression`) que a referência não tem —
  justificado por §15.1, mas é interface nova a manter.

---

## 22. Itens que retornam ao Gate 3

O §7 do addendum da Fase 5 fixa o gatilho: *"se o Gate 4 expuser uma superfície nova (ex.: um índice remoto
que reescreva o pipeline, ou um code-aware que reindexe fora do escopo do projeto), retornar a este gate."*

### 22.1 SF-N1 — **SIM, retorna. Bloqueante antes do Gate 5.**

D7 e D9 movem o índice de código **e** o ledger de grounding para `~/.conductor/library/` — **fora de
qualquer workspace**. O addendum modelou SF-L2 assumindo o índice sob `.conductor/`; a decisão deste gate
cria uma **fronteira de confiança nova e por-máquina** que ele não modelou. Três perguntas concretas para o
Gate 3, cada uma com uma decisão de segurança real por trás:

1. **`~/.conductor/library/` como fronteira nova.** Quem escreve, com que autoridade, e — o que mais
   importa — **qual é o fail-closed quando o diretório é apagado, substituído ou fica ilegível?** As duas
   direções são defensáveis e opostas: "sem ledger ⇒ nenhuma `Decision` fundamentada pode ser registrada"
   (trava o fluxo, seguro) ou "sem ledger ⇒ recai em FR-17 com override" (permite avançar, abusável). Este
   ADR **não** decide isso — é semântica de segurança, e é do Gate 3.
2. **O índice repo-supplied encontrado sob o workspace** (§10.3). A decisão aqui é "ignorar e reportar
   alto". Mas isso é **só higiene** ou é um **indicador de ataque** que merece um registro no audit trail e
   uma escalada? Um `.conductor/library/code.sqlite` num clone é um artefato que não tem razão inocente de
   existir.
3. **A extensão de `AuditEntry.egress` com `resolvedIp`** (§13.3). Mais dado no trail é mais dado a redigir.
   Um IP não é segredo, mas o trail atravessa `REDACTION_SINKS` e a decisão merece confirmação, não
   presunção.

Adicionalmente, o Gate 3 deve numerar o que decidir: os números disponíveis são **T55+** e **R36+** (a Fase 5
usou T48–T54 e R29–R35). Este ADR **não** atribui números novos — atribuir regras é prerrogativa daquele
gate.

### 22.2 SF-N2 — **NÃO precisa de retorno formal. Fechado por composição, com um sinal anexado.**

O raciocínio, explícito, nas duas metades:

**(a) "Abrir um `.sqlite` atacante-fornecível é parsear formato binário não-confiável".** Fechado por
**D7+D9**, não por uma mitigação nova. Depois desta arquitetura, o **único** caminho que abre um arquivo de
índice é `~/.conductor/library/**`, que (i) não vem de clone, (ii) é protected-path, (iii) é validado por
manifest com recusa fail-closed em mismatch de `projectId`, e (iv) **nunca** é aberto se estiver sob o
workspace (§10.3 — a regra é "não abrir", precisamente porque validar exigiria abrir). Não sobra caminho
pelo qual um binário repo-supplied alcance o parser. Isso não é uma regra nova a modelar: é **R32/R20
aplicadas**, que o Gate 3 já tem. Modelar uma ameaça cujo pré-requisito a arquitetura elimina seria gastar
o gate em papel.

**(b) "Montar a query FTS5 MATCH sem bind/quote é injeção de sintaxe".** Fechado por **D12**, e a regra que
o cobre já existe: **R29** ("conteúdo/entrada não-confiável é dado, nunca instrução") é exatamente esta
forma — a expressão MATCH é a *instrução*, os termos da pergunta são *dado*. D12 é a materialização de R29
no motor escolhido, não uma exceção a ela.

**Sinal anexado (não bloqueante, para a próxima passada do Gate 3):** a verificação empírica de §15.1
descobriu um modo de falha que **nenhuma** das sete ameaças T48–T54 cobre — elas são todas de
confidencialidade/integridade, e este é de **disponibilidade**: uma expressão FTS5 malformada **lança**, e
uma pergunta legítima em linguagem natural (`does NOT resolve`, uma aspa) derruba o canal inteiro de
grounding. O mesmo balde cobriria o `NaN` de §5.3, que trava toda mutação do `GateState` daquele gate. Se o
Gate 3 quiser um **T55 — "negação de serviço do canal de grounding (auto-infligida ou induzida)"**, ele é
barato de modelar e as duas mitigações **já estão neste ADR** (D12 e a guarda de finitude de D3). Não
bloqueia o Gate 5: o comportamento correto já está especificado e testável.

---

## 23. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4
[--category …] [--no-enrich]` (backend saudável; `library status` confirmou 2267 chunks / 65 livros /
7 categorias).

1. **Parametrização vs. concatenação (D12)** → **Web Application Security — Complete Professional Guide
   §1.9 "Best practices: injection"** (top **0.736**: *"I never concatenate untrusted input into
   queries/commands… Input is treated as data, not code. Validation backs up parameterization"*), **§1.5**
   (0.711, o exemplo real), **§1.2** (0.638), e — o hit decisivo — **§1.12 "When not to reach for a bind
   parameter"** (0.644: *"the limit is on what a placeholder can carry… Where it cannot carry the untrusted
   part, the answer is a different structural control (an allowlist, an arg…)"*). **Penetration Testing
   §8.5** (0.603).
2. **SSRF (D10)** → **Penetration Testing §12.9** (top **0.638**: *"Server-side URL fetches use an allowlist
   and block private/link-local ranges. Cloud metadata is protected (IMDSv2…)"*), **§12.5** (0.633), **OWASP
   ASVS V5.2.6** (0.605: allow lists de protocolos/domínios/caminhos/portas). **Cobertura declarada
   parcial:** pin de IP e re-validação em redirect **não** aparecem nominalmente — derivados do princípio,
   não forçados numa citação.
3. **Busca híbrida, RRF e reranking (D14)** → **Context Engineering §4.4 "Hybrid Search: Dense and Lexical
   Are Complements"** (top **0.782**, com o pseudocódigo `rrf_merge(dense, lexical, k=60)` de onde vem a
   constante), **§4.5 "Reranking: Spend Compute Where the Candidates Are"** (0.662, o cross-encoder que D14
   declara **não** implementar por default), **§4.3 "Embedding Models: The Geometry of Relevance"** (0.643:
   *"The index is the embedding model… Version the embedding model"* — base direta de `embeddingModel` e
   `corpusVersion` em D3).
4. **Complexidade e profundidade de módulo (D1, D8)** → **Managing Software Complexity §2.12 "When not to
   deepen a module"** (top **0.711**), **§2.10** (0.709), **§1.12** (0.697), **§3.1 "Information hiding and
   defining errors out of existence"** (0.691 — lido na direção correta em §5.3: o erro que **não** se
   define para fora).
5. **Regra de dependência e fronteira de pacote (D8)** → **Architecture Boundaries and the Dependency Rule
   §1.7** (top **0.619**, literalmente o desenho port+adapter+fake deste ADR), **§1.1** (0.599), **§1.12**
   (0.600, o teste inverso de quando **não** inverter).
6. **Cadeia de suprimentos e confiança transitiva (D5, D7)** → **Penetration Testing §14.2** (top **0.628**),
   **Secure Code Review §3.3 "domains, boundaries, and transitive trust"** (0.586/0.575: *"the more-trusted
   side must treat input from the less-trusted side as hostile until validated"*), **§3.11** (0.578),
   **OWASP ASVS V12.4.1** (0.568). **Cobertura declarada fraca** para "abrir um arquivo binário
   atacante-fornecível como superfície de parser": a melhor recuperação foi V12.4/genérica (0.568) —
   ancorado em fronteira de confiança + no fix estrutural de D7, **não forçado**.
7. **Least privilege / blast radius / choke point (D7, D9)** → **Secure and Reliable Systems Design §3.12
   "When not to tighten least privilege further"** (top **0.620**: *"the reachable authority has never been
   enumerated"* — a leitura exata de por que separação física vence filtro).
8. **Fail-fast vs. degradação graciosa (D11)** → **Stability Patterns for Production §3.5** (0.628,
   degradação graciosa), **§2.10** (0.627, "no fast-fail path"), **§3.12** (0.642) — usados pelo **contraste**
   (§14.2), não como endosso da degradação neste canal.
9. **SLIs/SLOs (§18)** → **Site Reliability Engineering §1.12 "When not to set an SLO"** (top **0.661**:
   SLOs pressupõem *"enough traffic that the ratio is a measurement"* — a razão de 7 dos 10 itens serem
   invariantes, não SLOs), **§1.5** (0.647), **§2.12** (0.651).
10. **Trade-offs de arquitetura como método (§1.3)** → **Distributed Architecture Decisions §1.12 "When not
    to run a trade-off analysis"** (0.523: *"the decision reverses in an afternoon… an ADR with a +/- table
    becomes the expensive part of a cheap decision"* — usado como critério de escopo: só as 14 decisões que
    **não** revertem numa tarde entraram aqui), **Solution Architecture §3.5/§3.2** (0.568/0.552).

**Declarações honestas de cobertura fraca ou ausente** (nenhuma forçada numa citação que não a diz):

- **Teste de scan estático como invariante estrutural** (a base de D4): a melhor recuperação foi genérica
  (top **0.601**, `Software Construction Practices §2.12`, fora do ponto). Ancorado no **precedente in-repo
  já verde** (`gate-approval-sole-mint.test.ts`, ADR 0005 §7) e em **Security Engineering §1.12** (o valor
  de um controle se mede pela falha que ele previne), **não** numa citação de livro sobre fitness functions.
- **`node:sqlite`/FTS5 como escolha de motor**: a biblioteca não cobre motores de busca embutidos
  especificamente. As afirmações de §3.1–§3.3 são **empíricas, verificadas nesta sessão** (FTS5 presente,
  round-trip de BLOB, comportamento do parser sob bind) e **aritméticas** (§3.2), não citadas.
- **Pin de IP e DNS rebinding**: ver item 2.
- **RAG poisoning / prompt injection indireta**: mesma lacuna que a Fase 0 T5 e o Gate 3 desta fase já
  declararam (top ~0.60, taint genérico). Este ADR **não** afirma resolvê-la; R29 fixa a direção, D5 fecha
  uma porta de entrada, e o residual segue declarado.
