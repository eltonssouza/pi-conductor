# ADR 0007 — Fase 6 (Diary e captura automática): diário local append-only **por-máquina** como fonte de verdade com índice de busca **derivado**, `journal-entry` como evidência de **existência (não de trabalho)** por correção cirúrgica em `hasSufficientEvidenceForMandatoryGate`, reuso das primitivas **puras** de recuperação da Library sem import de estado, captura automática **minimizada na origem** por hooks de ciclo de vida do Pi, e o Diary como **8º sink fechado** de redação

- **Status:** Proposto (pendente do checkpoint do usuário no Gate 4 — protocolo de gate, passo 5)
- **Data:** 2026-08-07
- **Gate:** 4 (Arquitetura, design defensivo e SLOs) — FULL
- **Demanda:** `Fase 6 — Diary e captura automática` (`plano_desenvolvimento.md` linhas 1377-1403, lidas junto
  com §4.9 "Sessões" e §4.10 "Memória"), branch `feature/fase6-diary-e-captura-automatica` (de `develop`)
- **Autor (papel):** software-architect
- **Decisores:** usuário (sign-off do Gate 4)
- **Supersessão:** ADRs são imutáveis; mudanças criam um ADR sucessor, não editam este. Este ADR **não edita**
  os ADRs 0001–0006 — ele os **aplica** e, em **um** ponto nomeado e justificado (§4/D2, §12.4), **refina** o
  corpo (não a assinatura) de uma função de política da Fase 4 (`hasSufficientEvidenceForMandatoryGate`,
  `gate-evidence.ts:208-211`), exatamente pela porta que o **próprio loop-back de Gate 8 daquela fase já
  abriu** (o campo `EvidenceProvenanceInfo.ref.kind`, acrescentado "so the golden-rule check below can tell a
  genuinely resolved `git-commit` apart from a resolved `file`"). Refinar o predicado de uma função de política
  que a Fase 4 já refinou por loop-back **não é** redefinir o contrato travado do §18 do ADR 0005: nenhuma
  assinatura, nenhum tipo persistido, `resolveEvidenceRef` e `ResolveEvidenceRefContext` permanecem
  **literalmente** como estão. A spec da Fase 6 (§9.5) e o Gate 3 (GAP-6A/T59) rotearam essa decisão
  exatamente para este gate.

- **Insumo herdado (código lido nesta sessão, não presumido):**
  - **ADR 0005** (Fase 4) — o par `Evidence`/`Decision`/`GateState` (`gate-state.ts`), a resolução Tier-1
    (`gate-evidence.ts:resolveEvidenceRef`/`hasSufficientEvidenceForMandatoryGate`, com o **achado central
    desta fase**: `EvidenceRef{kind:"journal-entry"}`, `ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds`
    e o campo `EvidenceProvenanceInfo.ref.kind`), o store com lock+CAS+checksum (`gate-state-store.ts`), e a
    disciplina "runtime-derived vence author-declared; um ref que não resolve nega".
  - **ADR 0006** (Fase 5) — o precedente de **forma** mais próximo do Diary: `grounding-ledger.ts` (o par
    "writer síncrono que **lança** em falha de I/O" + "reader que **nunca lança**, colapsa toda falha para
    vazio", com escopo por `projectId` e linha corrompida pulada), `library-home.ts` (a convenção de path
    por-projeto dentro do home global, `computeProjectId = sha256(realpath).slice(0,16)`), `corpus-store.ts`
    (o schema `node:sqlite`+FTS5, `IF NOT EXISTS`, mode `0o600`), e — o insumo de acoplamento mais importante —
    `fts-query.ts:buildFtsMatchExpression` e `hybrid-search.ts:fuseAndRerank` (funções **puras, sem estado**),
    mais a **regra de dependência port+adapter** de D8 (`@conductor/runtime` declara a port, a Library é o
    adapter, a CLI injeta).
  - **`redaction.ts`** — `REDACTION_SINKS` (a enumeração fechada, **7 sinks** hoje), `redactSecrets`
    (fail-closed com `SECRET_SCAN_FAILED_PLACEHOLDER`), e `deepRedact`/`redactSessionEntryForPersistence`
    (o mecanismo R12a que redige **todo leaf string** e reconstrói fresco, nunca muta) — o Diary os **reusa**,
    nunca reimplementa.
  - **Referência de comportamento (semântica, não código a portar):** `conductor-main/conductor/journal.py` —
    `KINDS` (`journal.py:43`, o vocabulário fechado de **6** valores), `_stamp_provenance`/`_head_sha` (cada
    campo de proveniência falha independentemente para `None`, "must never fail the journal write itself"),
    `_redact_text` (redação antes das duas pernas de persistência), `active_entries` vs. `_read_mirror`
    (corrente vs. histórico bruto), `edit_entry`/`EDIT_MODES` (correção como novo registro `supersedes`,
    `KeyError` em id inexistente), `record_event` (a captura, o "must not pay a multi-second synchronous tax").
  - **Gate 2 spec Fase 6** (`docs/conductor/gate2-spec-fase6.md`) — 12 goals (G1–G12), 25 FR (grupos A–I),
    10 BR, 9 edge cases, e as 7 questões abertas (§9) roteadas para este gate.
  - **Gate 3 addendum Fase 6** (`docs/conductor/gate3-addendum-fase6.md`) — 6 ameaças novas (T59–T64), as
    **6 regras vinculantes R40–R45** (§4) que esta arquitetura DEVE respeitar, os secure-defaults 49–54, e os
    4 GAPs (6A–6D) devolvidos ao Gate 2. **É o insumo vinculante desta fase.**

- **Insumo concorrente (Gate 3 ↔ Gate 4 iterativos, CLAUDE.md Gate 4):** §13 reconcilia ponto a ponto com
  R40–R45; §14 fecha os 4 GAPs; §15 devolve ao Gate 3 a única superfície nova que este gate expõe (a decisão
  de path por-máquina de D4, e o reuso da primitiva de busca da Library de D3), classificada como retorno
  **não bloqueante** (fechado por composição, com sinal anexado).

---

## 1. Contexto

### 1.1 O que as Fases 0–5 já entregaram, e que esta fase usa sem reescrever

Verificado abrindo os arquivos, não presumido:

| Primitivo | Arquivo | O que a Fase 6 faz com ele |
|---|---|---|
| Writer append-only síncrono que **lança** em I/O + reader que **nunca lança** (falha→vazio), escopado por `projectId`, linha corrompida pulada | `conductor-library/src/grounding-ledger.ts` | É o **molde exato** do log do Diary (D1/D7). Nenhuma disciplina de persistência nova — a mesma forma, um domínio novo |
| Convenção de path por-projeto no home global + `computeProjectId` | `conductor-library/src/library-home.ts` | O Diary segue a **mesma convenção** (`~/.conductor/diary/projects/<projectId>/`, D4), pelo **mesmo motivo de segurança** (SF-N1/D7/D9) |
| Funções **puras** de recuperação | `fts-query.ts:buildFtsMatchExpression`, `hybrid-search.ts:fuseAndRerank` | O Diary **reusa** `buildFtsMatchExpression` por import (D3) e **compõe** a fusão RRF; o ranking final é próprio (recência) |
| Enumeração fechada de sinks + deep-redação por-leaf | `conductor-runtime/src/redaction.ts` (`REDACTION_SINKS` 7; `deepRedact`/`redactSessionEntryForPersistence`) | O Diary vira o **8º sink** e reusa `deepRedact` (D8) — nunca um segundo redator |
| `EvidenceRef{kind:"journal-entry"}` + `runtimeRecordedJournalEntryIds` + `EvidenceProvenanceInfo.ref.kind` | `conductor-runtime/src/gate-evidence.ts` | **O seam central que esta fase preenche** (D2/G12) — e a porta pela qual a correção cirúrgica de R40 passa |
| Protected paths secure-by-default | `conductor-runtime/src/workspace-policy.ts` (`defaultProtectedPaths`) | **Ganha uma entrada:** `~/.conductor/diary` (D4) — simetricamente a `~/.conductor/library` (Fase 5 D9) |

### 1.2 O fato dominante herdado, e a torção da Fase 6

O fato dominante das Fases 0–5 continua: **um único processo de SO, sem sandbox, com o privilégio do
usuário**; toda garantia é **política dentro de um processo confiado**.

A torção que o Gate 3 nomeou (§0 do addendum) é a que organiza este ADR, e é uma **assimetria**, não uma
feature nova. A Fase 5 trouxe conteúdo não-confiável para dentro (a Library) e o devolveu com um **selo de
citação** que é confiável porque a citação é amarrada a um evento `rag-query` que o **pipeline de fato
executou** — uma busca real, observável, com hits/score/`corpusVersion`. A Fase 6 devolve **conhecimento
dinâmico que o próprio agente escreve** — e o devolve como **evidência que gateia um obrigatório**. Três
consequências arquiteturais, e nenhuma delas é sobre desempenho de busca:

1. **O `journal-entry` é evidência runtime-derived, mas o "runtime" só observou uma _escrita_, nunca o
   _trabalho_.** Uma citação da Fase 5 prova que *algo aconteceu no mundo* (o pipeline buscou). Uma entrada
   de diário prova que *o agente escreveu uma frase*. Os dois compartilham o valor `"runtime-derived"` no
   tipo `EvidenceProvenance`, mas a garantia anti-forja **não é a mesma**. No minuto em que a Fase 6 preenche
   `runtimeRecordedJournalEntryIds`, `hasSufficientEvidenceForMandatoryGate` — que aceita **qualquer** item
   runtime-derived como suficiente sozinho (`gate-evidence.ts:209`) — deixa uma nota de diário **fechar um
   gate obrigatório sem trabalho feito** (T59). Toda a §4/D2 deste ADR existe para essa frase.
2. **O canal de memória dinâmica tem DUAS portas de conteúdo não-confiável, não uma.** `journal ingest`
   (documentos do projeto — o paralelo direto de T48 da Library) **e** a captura automática (que pode
   registrar como "uma entrada" um tool-result cujo conteúdo o atacante controla). Um `recall` posterior
   devolve os dois com a autoridade de *"algo que este projeto decidiu/aconteceu aqui"* (T60).
3. **A captura automática tem uma superfície de vazamento ESTRUTURALMENTE MAIOR que a escrita manual.**
   `journal add` é sempre uma escrita deliberada; a captura **observa passivamente**, sem o agente decidir o
   que persistir. Segredo/PII de negócio não-padrão (que `redactSecrets` não casa) entra no diário mesmo com
   redação (T61), e uma entrada multi-campo fura uma redação por-campo ingênua (T62).

**E um quarto fato, tornado explícito por este gate:** o Diary é o primeiro subsistema que a decisão de
**onde ele vive em disco** transforma de convenção em **decisão de segurança** — porque um diário que
alimenta `runtimeRecordedJournalEntryIds` é um **ledger de evidência de governança**, e um ledger
repo-supplied num clone é o vetor mais barato para materializar T59 pela porta do sistema de arquivos
(T63(b)). É exatamente a classe SF-N1 que a Fase 5 já resolveu movendo o índice/ledger para fora do
workspace (ADR 0006 D7/D9).

### 1.3 Atributos de qualidade priorizados para esta decisão

Ordenados. A ordem é a decisão; ela resolve os empates abaixo.

1. **Não-forjabilidade honesta do canal de evidência.** É o produto desta fase. Uma nota de diário que
   fecha um gate never-collapse sozinha torna o non-negotiable #2 do `CLAUDE.md` ("Gate 5 — every code change
   ships with a test") decorativo. Vence conveniência, vence paridade de comando com a referência Python.
2. **Fonte de verdade única, append-only, com correção sem sobrescrita.** O log é a verdade; o índice é uma
   view. Uma correção é um novo registro. Um fato histórico nunca é apagado nem mutado (integridade
   anti-forense de um artefato de governança).
3. **Minimização na origem antes da redação de padrão.** A captura passiva tem uma superfície maior que a
   escrita manual; o default tem que **minimizar** (capturar o mínimo curado), não capturar tudo e confiar na
   redação — que só casa padrões conhecidos.
4. **Contenção (blast radius) entre domínios de confiança.** Diary (por-projeto, dinâmico) ≠ Library (global,
   estático); workspace ≠ máquina; log autoritativo ≠ digest derivado. Um vazamento aqui é o dano que R42/R44
   existem para impedir.
5. **Baixa complexidade acidental (Ousterhout).** Nenhum motor de busca novo, nenhuma dependência nativa,
   nenhum lock cross-process onde o design append-only por-sessão o dispensa. Reuso das primitivas puras da
   Fase 5 e da disciplina de persistência da Fase 4/5, não uma segunda invenção.

*Grounding:* **Architecture Boundaries and the Dependency Rule §3.4** (0.621 nesta sessão: "I/O at the edges,
policy in the middle; a use case is a function of data in → data out" — a razão de o Diary ser I/O na borda +
funções puras no meio, e de reusar as puras da Library sem herdar o I/O dela) e **Managing Software
Complexity** (herdado do ADR 0006 §1.3: profundidade é benefício sobre custo de interface — a razão de **não**
criar um motor de busca novo quando o corpus dinâmico de um projeto é pequeno e as primitivas já existem).

---

## 2. Decisão central, e o mapa D1–D8

**O Diary é um pacote novo (`@conductor/diary`) cujo log local append-only por-máquina é a fonte de verdade,
cujo índice de busca é uma view derivada reconstruível a partir do log, que reusa as primitivas _puras_ de
recuperação da Library sem importar seu estado, e cujo único produto para a máquina de gates é um `id` de
entrada que a Fase 4 resolve como evidência de _existência_ — nunca de _trabalho_ — e que, por isso, nunca
fecha um gate obrigatório sozinho.**

Tudo o mais decorre disso. As oito decisões:

| # | Decisão | Fecha / responde |
|---|---|---|
| **D1** | Pacote novo `@conductor/diary`; log JSONL append-only **por-projeto** como fonte de verdade + índice `node:sqlite` **derivado**; enum `kind` fechado de 6 valores; `Risk`/`Approval` referenciados, nunca duplicados | spec §9.1/§9.2/§9.5, G1 |
| **D2** | `journal-entry` é evidência de **existência**, não de **trabalho**: correção cirúrgica no ramo runtime-derived de `hasSufficientEvidenceForMandatoryGate` (exige `ref.kind==="test-run"`), usando o campo `ref.kind` que a Fase 4 já expõe; `resolveEvidenceRef`/`ResolveEvidenceRefContext` **inalterados** | **GAP-6A / T59 / R40**, spec §9.5 |
| **D3** | Reuso das primitivas **puras** da Library por import (`buildFtsMatchExpression`; núcleo RRF), ranking **próprio** (recência + supersessão), store **fisicamente separado**; `recall`/`search` devolvem **dado citado**, rotulado documento-vs-entrada | **GAP-6B / T60 / R41**, spec §9.2, FR-12 |
| **D4** | Log autoritativo **por-máquina** em `~/.conductor/diary/projects/<projectId>/`, protected-path; o único artefato no workspace é o **digest derivado** | **GAP-6D / T63 / R44**, spec §9.6 |
| **D5** | Captura automática por hooks de ciclo de vida **discretos** (nunca o stream bruto), **minimizada na origem**, alto-risco **OFF por default**, limitada, subagente rotulado, nunca bloqueia o turno | **GAP-6C / T61 / R42**, spec §9.3, FR-14..18 |
| **D6** | `recall` (semântico) e `search` (faceta estruturada) são **dois modos distintos**, funções separadas por tipo (nunca um booleano num verbo só) | spec §9 questão 1, G3/G4 |
| **D7** | Correção via `supersedes` (novo registro append-only, `KeyError` em id inexistente); superseded sai de recall/search corrente mas fica no histórico; reader **fail-closed** (apagar revoga, nunca fabrica) | **T63 / R44**, G10, FR-23/24 |
| **D8** | O Diary é o **8º sink fechado** em `REDACTION_SINKS`; deep-redige **todo leaf** antes de persistir, nunca spread-then-overwrite | **T62 / R43**, G8 |

---

## 3. D1 — Pacote novo `@conductor/diary`: log append-only como verdade, índice como view derivada

### 3.1 A decisão

Um pacote novo, `@conductor/diary`, seguindo o padrão já estabelecido (`@conductor/{config,runtime,cli,
library}`). O Diary persiste em **duas camadas com papéis distintos**, e a distinção **é** a decisão:

```
~/.conductor/diary/projects/<projectId>/entries.jsonl   # FONTE DE VERDADE — append-only, mode 0o600 (D4/D7)
~/.conductor/diary/projects/<projectId>/index.sqlite    # VIEW DERIVADA — reconstruível a partir do JSONL
```

- **O JSONL é a fonte de verdade.** Cada entrada é uma linha, append-only, escrita síncrona que **lança** em
  falha de I/O — o molde exato de `grounding-ledger.ts`. Uma escrita que falha silenciosamente é pior do que
  travar; o writer nunca engole uma falha (§8/D7).
- **O `index.sqlite` é uma view derivada, reconstruível.** FTS5 para o lado lexical e vetores `float32` como
  BLOB varridos linearmente para o denso — o **mesmo motor físico** que `corpus-store.ts` já usa (`node:sqlite`,
  builtin, zero dependência nativa), mas um **arquivo por projeto**, nunca o `corpus.sqlite` global (§5/D3). Se
  o índice corromper ou o schema evoluir, ele é **reconstruído reprocessando o JSONL** — nunca uma migração
  in-place de um formato que ninguém pode verificar.

**Por que a fonte de verdade é o JSONL e não o SQLite** (a inversão exata em relação à Library): na Library, o
`corpus.sqlite` **é** o store porque os livros são **estáticos** — ingeridos uma vez, imutáveis. No Diary, as
entradas são **dinâmicas e append-only**, sujeitas a correção/supersessão (D7); um log append-only é a
representação canônica de "uma sequência de fatos que só cresce", e um índice de busca sobre ele é
naturalmente uma projeção. Colocar a verdade no SQLite exigiria uma migração in-place a cada mudança de
schema de busca; colocá-la no JSONL torna toda mudança de índice um **reprocessamento de um input imutável**.

*Grounding:* **Designing Data-Intensive Systems — Complete Professional Guide §10.5 "Real example: batch and
stream processing"** (top **0.702** nesta sessão, `--category 05_databases`: *"Make the **order event log** the
source of truth and the search index a **derived view**. Fix the indexing code and **reprocess the log** to
rebuild the index from a known-good input"*), **§10.4 "Architecture: derived state from an event log"** (0.681:
o diagrama `source: append-only event log → stream processor → search index / cache / aggregates`), **§10.12
"When not to make an event log the source of truth"** (0.664: o critério inverso, satisfeito aqui — reprocessar
um input imutável vence uma migração in-place). É a mesma citação que a spec §8.1/BR-4 já ancorou, agora
recuperada em 0.702 na categoria certa, aplicada ponto a ponto ao diário.

### 3.2 O schema da entrada (contratos completos no §16)

Cada entrada carrega, no mínimo: `id` (runtime-mintado, nunca `--id` do autor — FR-4/BR-8), `schemaVersion`
literal (versionado desde a 1ª escrita — FR-21), `ts` ISO-8601 string (nunca `Date` — a armadilha do
canonicalizer da Fase 4), `sessionId`, `author`, `kind`, `gate?`, `source` (`manual|capture|document` — a
distinção que D3/D5 exigem), `text` (já redigido — D8), `provenance` (`branch?`/`sha?`/`repo?`, best-effort,
cada campo omitido quando não resolve, nunca inventado — BR-3), e `supersedes?`/`editMode?` (D7).

**O enum `kind` é fechado, com 6 valores — verbatim de `journal.py:43`** (`assert behaviour over prose`, a
disciplina do próprio conductor-main): `reasoning | decision | plan | error | solution | checkpoint`. Note que
o `CLAUDE.md` do pai lista 5 (sem `checkpoint`), mas o **código** aplicado por `journal.py` tem 6, e a captura
automática precisa de `checkpoint` (FR-14 o nomeia). Um valor fora do conjunto é **recusado** nomeando os
válidos (FR-2/BR-7), nunca aceito como texto livre disfarçado de categoria.

### 3.3 Resolução da spec §9.5 — o enum NÃO cresce para `risco/aprovação/hipótese/aprendizado`

A spec §9.5 (e o Gate 3, ao tocar T59) perguntou se o `kind` deve crescer para cobrir a linguagem do plano
§4.10 (risco/aprovação/hipótese/aprendizado). **Decisão: não.** `Risk` e `Approval` já são tipos
**estruturados** dentro de `GateState` (Fase 4, `gate-state.ts:Risk`/`gate-approval.ts:Approval`) — eles têm
uma fonte de verdade, e ela não é o Diary. Duplicá-los como um `kind` de texto livre criaria **duas fontes de
verdade divergentes para o mesmo fato** — exatamente o risco que o Gate 3 sinalizou. O Diary **referencia**
esses fatos (uma entrada `decision` pode citar um gate cujo `Approval` vive no `GateState`), nunca os
**substitui**. "Hipótese" e "aprendizado" mapeiam para `reasoning`/`plan` (a mesma discussão que os produz),
não pedem um `kind` novo. Isto é a mesma disciplina de linguagem ubíqua que a Fase 5 aplicou ao reclassificar
`reject()` para `kind:"rejection"` (ADR 0006 §6.3).

*Grounding:* **Domain-Driven Design — Complete Professional Guide §1.12 "When not to build a ubiquitous
language"** (top **0.690**, `--category 03_design_and_architecture`: *"Pinning terms with domain experts pays
when one word means two things and the code has to pick one"* — aqui, "aprovação" já significa uma coisa
(`Approval` estruturado); deixá-lo virar também um `kind` de texto livre é a colisão que a linguagem ubíqua
existe para recusar).

### 3.4 Concorrência (edge case 4 / spec §9 questão 7) — um arquivo por sessão, sem lock+CAS

O `GateState` (Fase 4) precisa de lock+CAS porque é um arquivo **único, mutável, compartilhado** entre
processos (`gate-state-store.ts`). O Diary **não** — é append-only e **um arquivo por sessão** (o mesmo
desenho de `journal.py`: `entries.jsonl` particionado por sessão sob `projects/<projectId>/`). Duas sessões
concorrentes escrevem em arquivos diferentes; `appendFileSync` com `flag:"a"` é atômico para uma linha no
mesmo volume (a mesma garantia que `grounding-ledger.ts` já usa). A propriedade observável ("nenhuma entrada
perdida", edge case 4) é entregue **por construção da partição**, não por um lock — mais barato e sem a
superfície de lock-stale que o `GateState` teve que enfrentar.

### 3.5 Alternativas consideradas

| Opção | Trade-off | Veredito |
|---|---|---|
| **Uma tabela nova dentro do `corpus.sqlite` global da Library** | Um arquivo a menos; **mas** o corpus é conhecimento **estático global** (D9 da Fase 5) e o Diary é **dinâmico por-projeto** — misturá-los no mesmo banco reabriria exatamente o risco "T51 cross-project leakage via uma collection compartilhada" que a Fase 5 evitou deliberadamente entre corpus e code-index | **Rejeitada** |
| **SQLite como fonte de verdade (sem JSONL)** | Um store só; **mas** força uma migração in-place a cada mudança de schema de busca, e perde a propriedade "reprocessar um input imutável" (§3.1). Um append-only é a representação canônica de um log de decisões | **Rejeitada** |
| **Módulo dentro de `@conductor/runtime`** (sem pacote novo) | Menos cerimônia; **mas** empurraria I/O de SQLite e um schema para dentro do pacote que é a casa da **política de gates pura** (o mesmo argumento que ADR 0006 §11.3 já fez para a Library) | **Rejeitada** |
| **JSONL append-only (verdade) + `node:sqlite` FTS5/BLOB (view derivada), pacote novo** | Fonte de verdade reprocessável, índice reconstruível, zero dependência nativa, reuso do molde `grounding-ledger.ts` e do motor `corpus-store.ts`; concorrência resolvida por partição | **Escolhida** |

---

## 4. D2 — `journal-entry` é evidência de EXISTÊNCIA, não de TRABALHO (fecha GAP-6A / T59 / R40)

### 4.1 O achado, no código

`hasSufficientEvidenceForMandatoryGate` (`gate-evidence.ts:208-211`) hoje é:

```ts
export function hasSufficientEvidenceForMandatoryGate(evidence: readonly EvidenceProvenanceInfo[]): boolean {
	if (evidence.some((item) => item.provenance === "runtime-derived")) return true;
	return evidence.some((item) => item.provenance === "author-declared" && item.ref.kind === "git-commit");
}
```

E `resolveEvidenceRef` marca um `journal-entry` como `provenance: "runtime-derived"` sempre que o id está em
`ctx.runtimeRecordedJournalEntryIds` (`:147-150`). Hoje esse conjunto é **sempre vazio** (não existe produtor
real — o próprio comentário do arquivo declara o seam: *"a REAL source once wired"*). No minuto em que a Fase 6
o preenche (G12/FR-25), **uma entrada de diário runtime-registrada satisfaz o primeiro `some(...)` e fecha um
obrigatório sozinha** — e o que o runtime observou foi uma **escrita de texto livre**, não a **execução de um
teste**. É o coração de T59, e é *pior* que o T53 da Fase 5, porque lá a citação **nunca** deixava fechar um
obrigatório sozinho (a máquina segurava); aqui a máquina **não segura**, porque `journal-entry` está no mesmo
allowlist runtime-derived que `test-run`.

### 4.2 A decisão — a correção cirúrgica, pela porta que a Fase 4 já abriu

R40 dá duas opções admissíveis: **(A)** `journal-entry` **não entra** no ramo runtime-derived de
`hasSufficientEvidenceForMandatoryGate` (fica como sinal de contexto/proveniência, nunca prova única de um
obrigatório), **ou (B)** entra apenas **pareado** com um artefato mais forte (`test-run`/`git-commit`) para o
mesmo gate.

**Escolhida: (A).** É a mais cirúrgica, e ela cabe **sem tocar assinatura nem tipo**, porque o loop-back de
Gate 8 da Fase 4 **já acrescentou** o campo `ref.kind` a `EvidenceProvenanceInfo` "so the golden-rule check
below can tell a genuinely resolved `git-commit` apart from a resolved `file`". A Fase 6 usa o mesmo campo para
uma distinção irmã:

```ts
export function hasSufficientEvidenceForMandatoryGate(evidence: readonly EvidenceProvenanceInfo[]): boolean {
	// runtime-derived fecha um obrigatório SOZINHO só para um test-run (uma execução de teste observada) —
	// NUNCA um journal-entry (uma ESCRITA de texto observada: existência, não trabalho — R40/T59). O
	// journal-entry continua resolvendo como runtime-derived em resolveEvidenceRef (G12, o seam FECHA), mas
	// é sinal de contexto/proveniência, nunca a prova única de um gate never-collapse.
	if (evidence.some((item) => item.provenance === "runtime-derived" && item.ref.kind === "test-run")) return true;
	return evidence.some((item) => item.provenance === "author-declared" && item.ref.kind === "git-commit");
}
```

Três propriedades que isto preserva, cada uma verificada no código:

1. **O seam FECHA (G12/FR-25).** `resolveEvidenceRef` continua **literalmente** como está: um
   `--ref journal-entry:<id>` cujo id o runtime registrou resolve como `runtime-derived` (`:147-150`). O id é
   resolvível — a promessa que o `gate-evidence.ts` fez ("a REAL source once wired") está cumprida. O que muda
   é **só** o que uma entrada resolvida *habilita*: contexto/auditoria/o sinal que informa um `recall`, nunca o
   fechamento solitário de um obrigatório.
2. **O id digitado continua recusado (R25 mantido).** `resolveEvidenceRef` exige
   `ctx.runtimeRecordedJournalEntryIds.has(ref.id)`; um id inventado retorna `ok:false`. Fecha o sub-vetor (a)
   de T59 exatamente como antes.
3. **`test-run` mantém seu lugar; `git-commit` mantém o fallback interino.** `test-run` (uma execução de teste
   observada) continua fechando um obrigatório sozinho — é o que o Gate 5 quer. O `git-commit` resolvido segue
   como o fallback que o loop-back de Gate 8 introduziu. Só o `journal-entry` é rebaixado a
   contexto/proveniência.

### 4.3 A ligação (quem preenche `runtimeRecordedJournalEntryIds`), fail-closed

O `ResolveEvidenceRefContext` da Fase 4 **não muda** — ele recebe um `ReadonlySet<string>`. A CLI (o
composition root, `@conductor/cli`, que já injeta as dependências dos comandos `gate *`) lê os ids registrados
do diário deste projeto e passa o conjunto. A leitura é **fail-closed**, portando a disciplina do reader de
`grounding-ledger.ts`: um diário ausente/ilegível colapsa para um **conjunto vazio** → um
`EvidenceRef{journal-entry:<id>}` que o citava **deixa de resolver** → o obrigatório que ele contextualizava
**não regride para "sem evidência" indevidamente** — e mais fortemente, **apagar o diário torna a sessão
menos permissiva, nunca mais** (a garantia R44/T63, §8/D7). A função que produz o conjunto vive em
`@conductor/diary` (`readRecordedJournalEntryIds`, §16), não em `@conductor/runtime` — a mesma seta port+adapter
da Fase 5 (D8).

### 4.4 O residual, declarado e não resolvido (o teto de T47/T53)

Num SO single-user sem sandbox, um agente com execução de código pode **rodar de fato** `journal add` (obtendo
um id legítimo) e citá-lo — o sub-vetor (b) de T59. R40/D2 **não fecha** isso e **não afirma fechá-lo**: o que
D2 garante é que uma entrada de diário, sozinha, **nunca é tratada como equivalente a um `test-run`** para
fechar um never-collapse — o freio que sobra é o revisor humano do Gate 8 (a alegação é Tier-2, do revisor, não
da máquina) e a superfície de execução que habilitaria a forja direta já é gated pela Fase 2 (T17/R1). D2 eleva
o custo de "digitar uma citação" para "produzir uma entrada consistente **e** ela sobreviver ao olhar do
revisor **e** ainda assim não fechar o gate sozinha".

### 4.5 Alternativa considerada

**Opção (B) — `journal-entry` conta apenas pareado com um `test-run`/`git-commit` para o mesmo gate.**
Trade-off honesto: modela literalmente "uma nota que anota uma evidência já resolvida". Rejeitada por
complexidade acidental: exigiria `hasSufficientEvidenceForMandatoryGate` correlacionar itens por gate (um
segundo laço, um estado a manter), quando a opção (A) entrega a **mesma** garantia de segurança (um
`journal-entry` nunca fecha um obrigatório sozinho) com uma mudança de **uma linha** que reusa um campo já
existente. Se algum dia o pareamento for desejado como *feature* (uma entrada que "confirma" um teste), ele é
aditivo sobre (A), não um pré-requisito.

*Grounding:* **cobertura declarada fraca (a mesma lacuna que a Fase 5 declarou para T53/T47).** A consulta
desta sessão para "log de decisão forjável pelo ator que precisa prová-lo em um audit trail local" retornou
fora do alvo (a mesma classe, top ~0.60). A **direção** é ancorada em **Security Engineering Principles §2.2
"secure by default and failing safely"** (top **0.660**, `--category 09_security_and_privacy`) e **§2.12**
(0.654: *"the authorization path, where an error must never read as permission"* — a evidência incerta não
fecha o gate) e **§2.9** (0.638); e no **precedente de código já testado deste próprio monorepo** —
`gate-evidence.ts`'s contrato explícito `"runtime-derived"` vs `"author-declared"`, R25/T41 "runtime-derived
vence self-reported", e o campo `ref.kind` que o loop-back de Gate 8 abriu — **não** numa citação forçada. A
biblioteca **não cobre especificamente** este ângulo; declarado, não escondido.

---

## 5. D3 — Reuso das primitivas PURAS da Library, ranking próprio, store separado (fecha GAP-6B / T60 / R41)

### 5.1 A decisão de acoplamento — a parte que importa

O critério de saída literal da Fase 6 ("uma decisão tomada numa sessão deve ser recuperada **semanticamente**
em outra") exige a mesma busca híbrida (lexical+vetorial) que a Library já implementa. A decisão tem **três
camadas**, e a distinção entre elas é o núcleo de D3:

1. **Reusa por import (funções puras, sem estado).** `@conductor/diary` importa
   `buildFtsMatchExpression` de `@conductor/library`. **Não** duplica. A razão não é DRY genérico — é
   **segurança**: `buildFtsMatchExpression` é a defesa estrutural de D12/R29 da Fase 5 (um `NOT`, um `title:`,
   uma aspa no texto de uma entrada ou de um documento ingerido tem que ser neutralizado **identicamente** ao
   corpus, senão é injeção de sintaxe FTS5 **e** a porta de R41/T60 pela via da consulta). Duas cópias que
   derivam desse escape são duas vulnerabilidades. Uma função pura, tratada por R41 como a *instrução* que o
   runtime autora enquanto os termos da entrada são *dado*, tem que ter **um** dono.

2. **Compõe (não reusa inteira) a fusão RRF; o ranking final é PRÓPRIO.** `fuseAndRerank` da Library empacota
   RRF + rerank + threshold numa função só, e seu reranker foi **deliberadamente** sintonizado para o corpus
   estático — ele **não** modela recência (o comentário do próprio `hybrid-search.ts` nomeia isso: os pesos
   foram "chosen so the RRF consensus signal dominates"). O Diary é **temporal**: recência é um prior (BR-10/
   G11) e uma entrada **superseded** para de contar como corrente (BR-5) — dois sinais que o reranker do corpus
   **não tem e não deveria ter**. Logo o Diary **compõe** a fusão RRF (o núcleo `Σ 1/(k+rank)`, `k=60`, o mesmo
   `Context Engineering §4.4` da Fase 5 — estruturalmente idêntico, um laço puro de ~15 LOC que é duplicação
   **estrutural** aceitável, ou um helper compartilhado) com um **rerank próprio** que acrescenta a feature de
   recência e o filtro de supersessão. Isto é a disciplina exata que o ADR 0006 §11.2 fixou: **duplicação
   estrutural de lógica é ok; import cruzado de estado não é** — aplicada agora ao ranking temporal do Diary.

3. **Store fisicamente separado, sempre.** O índice do Diary é `~/.conductor/diary/projects/<projectId>/
   index.sqlite` — **nunca** o `corpus.sqlite` global. A contenção é uma propriedade do sistema de arquivos
   (um arquivo por projeto), não da disciplina de quem escreve o `WHERE` — a mesma razão de D7 da Fase 5.

**A direção da dependência.** A aresta `@conductor/diary → @conductor/library` toca **apenas** funções puras
(a política estável de recuperação), **nunca** os stores de I/O da Library (`corpus-store`, `code-index`,
`remote-endpoint`). Para tornar "só puro" um fato **assertável** e não uma convenção, as primitivas puras são
importadas de um entrypoint dedicado sem I/O (um barrel `@conductor/library/retrieval` que não importa nenhum
módulo de borda), de modo que um import do Diary que alcançasse um store da Library seria um **erro de
compilação/lint**, não um lapso. A seta aponta para dentro, rumo à política mais estável e pura.

*Grounding:* **Architecture Boundaries and the Dependency Rule §1.1 "the dependency rule"** (top **0.634** nesta
sessão: *"source-code dependencies point **inward**, toward higher-level, more stable policy — never outward
toward volatile detail"* — uma função pura de recuperação é policy estável; o SQLite/embedding da Library é o
detalhe volátil que o Diary **não** importa), **§1.12 "When not to invert dependencies"** (0.622: *"Where there
is no policy, or the detail will never change, that freedom is bought and never spent"* — lido na direção
correta: aqui a política **existe** e é compartilhada (o escape FTS5), então o import é justificado; a fusão RRF
é estrutural o bastante para tolerar duplicação), **§3.4 "I/O at the edges, policy in the middle"** (0.621).

### 5.2 `recall`/`search` como dado citado, nunca instrução (R41/T60) + a distinção documento-vs-entrada (FR-12)

A saída de `recall`/`search` — **entrada** OU **documento ingerido** — entra no contexto de um papel/laço, e é
por construção *dados do atacante alcançando um interpretador* se a entrada/documento estiver envenenada
(T60). A decisão fixa a **direção** (prevenção completa de injection indireta é não-resolvida na indústria,
declarado desde a Fase 0 T5):

- Toda passagem recuperada é apresentada como **material citado** — delimitada, atribuída com a origem+data que
  G3/G9 já exigem, e **rotulada `source`** (`entry` | `capture` | `document` — o discriminante que D1 já carrega
  no schema). FR-12 já exige que um documento ingerido nunca se confunda com uma decisão; o `source` torna isso
  um campo, não uma convenção de apresentação.
- A **procedência do que se ingere/captura é condição de confiança consciente:** `journal ingest` sobre
  `docs/`/README é um ato deliberado sobre conteúdo do próprio projeto; a captura de um tool-result (D5) herda
  o **mesmo** tratamento — o conteúdo observado é dado citado, nunca instrução re-executável.
- `sanitize`/normalização (se houver, para o embed) é **declarada insuficiente contra injection** — ninguém
  confunde "limpo para o embed" com "seguro para injetar no contexto".

*Grounding (herdado, a direção que R41 fixa):* **Web Application Security §1.2/§2.4** ("separate code from
data"; "untrusted data rendered inert" — do addendum Gate 3 R41) e o precedente **R29/T48** da Fase 5 (a mesma
direção, agora no canal do Diary). **A biblioteca não cobre RAG/recall poisoning especificamente** (a mesma
lacuna que a Fase 0 T5 e o Gate 3 já declararam); a não-eliminabilidade é declarada, não escondida.

### 5.3 Alternativa considerada

**Duplicar toda a lógica de recuperação no Diary (zero import cruzado).** Trade-off: zero acoplamento de build.
Rejeitada **só para `buildFtsMatchExpression`** (uma função de segurança onde duas cópias são duas
vulnerabilidades que derivam), **aceita** para a fusão RRF (estrutural, ~15 LOC, sem superfície de segurança se
divergir marginalmente). A escolha não é "reusar tudo" nem "duplicar tudo" — é reusar **onde a divergência é um
risco** e compor/duplicar **onde o Diary tem uma semântica própria (recência/supersessão)** que a Library
deliberadamente não tem.

---

## 6. D4 — O log autoritativo vive POR-MÁQUINA; o digest é o único artefato no workspace (fecha GAP-6D / T63 / R44)

### 6.1 A decisão

**O `entries.jsonl` (a fonte de verdade que alimenta `runtimeRecordedJournalEntryIds` e o `index.sqlite`) vive
por-máquina em `~/.conductor/diary/projects/<projectId>/`, adicionado a `defaultProtectedPaths()` — NÃO no
workspace.** O único artefato do Diary que toca o workspace é o **digest Markdown derivado** (`journal digest`),
que o usuário pode escrever no repo e commitar se quiser — porque um digest é regenerável e **nunca**
autoritativo (não alimenta evidência).

```
~/.conductor/diary/projects/<projectId>/entries.jsonl   # AUTORITATIVO, protected-path, por-máquina
~/.conductor/diary/projects/<projectId>/index.sqlite    # derivado, por-máquina
<workspaceRoot>/qualquer-lugar/digest.md                # DERIVADO, escrito só quando o usuário pede (FR-22/FR-10)
```

- `projectId = sha256(realpath(workspaceRoot)).slice(0,16)` — **precedente in-repo exato**: `computeProjectId`
  de `library-home.ts` (idêntico ao `resolveGateGitContext` da Fase 4). Um projeto alcançado por dois symlinks
  ainda tem um id estável.
- `defaultProtectedPaths()` ganha `join(homedir(), ".conductor", "diary")` — simetricamente ao
  `~/.conductor/library` da Fase 5 (D9). Como `isWithinRoot` faz correspondência de subárvore, uma entrada
  protege `projects/**` inteiro.

### 6.2 Por que por-máquina, e não `.conductor/memory/diary/` como o plano desenha

O plano §4.10.1 desenha o diário em `.conductor/memory/diary/` (dentro do workspace). O Gate 3 (GAP-6D/T63)
elevou essa questão de convenção a **decisão de segurança**, e a decisão inverte o sketch do plano por três
razões, cada uma uma ameaça real:

1. **Um diário in-workspace é repo-supplied (T63(b)).** Um repositório clonado pode chegar com um
   `entries.jsonl` pré-fabricado: entradas com **ids escolhidos pelo atacante**. Se a CLL preenchesse
   `runtimeRecordedJournalEntryIds` a partir dele, um `EvidenceRef{journal-entry:<id-forjado>}` **resolveria** —
   e T59 se materializa pela porta do sistema de arquivos, com o controle mais forte (o id runtime-derived)
   virando o vetor mais barato. É **exatamente** a classe SF-N1 que a Fase 5 resolveu movendo o índice/ledger
   para fora do workspace (ADR 0006 D7 §10.1): "um artefato que vem no clone nunca é autoridade".
2. **Um diário in-workspace entra no `git log` do usuário.** Mesmo redigidas (D8), decisões técnicas às vezes
   carregam contexto sensível de negócio que a redação de padrão não pega (o residual de T61). Um log
   autoritativo versionável coloca isso na história do repo por default. Por-máquina, nada entra no git a menos
   que o usuário **explicitamente** rode `journal digest` e commite o Markdown derivado — a escolha é dele, não
   um efeito colateral.
3. **Protected-path fecha a anti-forense (T63(a)) pelo caminho mais provável.** Um diário sob
   `defaultProtectedPaths()` está fora do alcance das tools `write`/`edit`/`bash` do agente — o **próprio loop**
   não pode apagar/reescrever o registro dos seus próprios atos. É a mesma razão de `.conductor/gates/` e
   `.conductor/audit.jsonl` serem protegidos.

**A consequência dita em voz alta** (o mesmo custo deliberado que ADR 0006 D10.4 aceitou para o code-index): o
diário **não é versionável junto com o repositório**, e um clone fresco em outra máquina começa sem diário. Um
time que queira compartilhar decisões usa `journal digest` → commita o Markdown, ou ADRs em `docs/`. A mesma
propriedade que tornaria o log compartilhável (viver no repo) é a que o tornaria forjável.

### 6.3 Fail-closed anti-forense (a razão de segurança de R44, o mecanismo em §8/D7)

A **leitura** do log porta R36/R11a: o reader **nunca lança**; um log ausente/ilegível/linha-corrompida
colapsa para "vazio". Efeito de rede: apagar o diário **revoga** a evidência que ele produzia (o
`EvidenceRef{journal-entry:<id>}` deixa de resolver, o obrigatório que ela contextualizava não ganha esse
sinal), **nunca a fabrica**. Perder o log torna a sessão **menos** permissiva, nunca mais.

*Grounding:* **Secure and Reliable Systems Design — Complete Professional Guide §3.12 "When not to tighten
least privilege further"** (top **0.659** nesta sessão, `--category 09_security_and_privacy`: *"The reachable
authority has never been enumerated"* — um diário in-workspace é autoridade alcançável que ninguém enumerou),
**§3.11 "least privilege and blast-radius control in practice"** (0.650) e **§3.13** (0.666: least privilege +
bounded blast radius + "route privileged access through an audit"). É o mesmo anchor que ADR 0006 D7/§10.2 usou
para mover o índice de código para fora do workspace — aplicado aqui, sob a mesma lógica, ao diário.

### 6.4 Alternativa considerada

**In-workspace (`.conductor/memory/diary/`) com a disciplina T56/R37** ("um diário sob um clone é indicador de
ataque, reportado, nunca aberto/adotado"). Trade-off honesto: satisfaz o sketch do plano e torna o diário
versionável. Rejeitada porque **validar** um diário repo-supplied para decidir "é ataque?" exige **abri-lo e
parsear** um JSONL não-confiável (a mesma dependência que a Fase 5 recusou em §10.3), e porque a razão #2 (git
log) e #3 (protected-path contra o loop) só o por-máquina entrega. A opção in-workspace foi a que o Gate 3
nomeou como a que "**decide se a forja é possível**" — e a resposta é: por-máquina fecha, in-workspace só
mitiga.

---

## 7. D5 — Captura automática: hooks discretos, minimização na origem (fecha GAP-6C / T61 / R42)

### 7.1 O mecanismo — quais hooks, e por que não o stream bruto

O `pi` expõe `session.subscribe(listener)` (eventos `message_start/update/end`) **e** hooks de ciclo de vida
genuínos (`session_start/shutdown/before_switch/before_fork`, `agent_start/end/settled`, `turn_start/end`) —
confirmado no ADR 0001/recon. A captura automática assina **eventos discretos e de alto sinal**, **nunca** o
stream token-a-token:

- **`turn_end`** → um turno completo pode conter uma decisão/erro/solução/checkpoint (uma unidade curável).
- **`agent_settled`** → um subagente terminou; seu **resultado** é curável, **rotulado com a sessão do
  subagente** (FR-17 — nunca fundido sem rótulo na sessão do orquestrador; a separação de sessões da Fase 3
  **não** é reaberta aqui, é respeitada).
- **`session_shutdown`** → um checkpoint de fim de sessão.
- **gate-concluído** (o sinal que a máquina de gates da Fase 4 emite ao aprovar/rejeitar) → uma entrada
  `decision`/`checkpoint` amarrada ao gate.

**Nunca `message_update`** (o stream bruto) — capturar o transcript verbatim é a raiz de T61.

### 7.2 A minimização na origem — o secure-default (R42/T61)

A superfície da captura é **estruturalmente maior** que a de `journal add` (observa passivamente, não decide),
então o default tem que **minimizar**, não capturar tudo e confiar na redação:

- **Grava o mínimo curado:** METADADO estruturado (gate, `kind` inferido, sessão, timestamp) + um **resumo
  curto**, **nunca** o corpo verbatim de mensagens/tool-calls. Só `decision|error|solution|checkpoint` são
  auto-capturados (FR-14), não todo evento.
- **Conteúdo de alto risco OFF por default:** a íntegra de um tool-result, o corpo de uma mensagem — capturá-los
  exige **opt-in explícito** (`captureHighRiskBodies`, default `false`). É uma decisão de secure-default porque a
  captura, por observar, tem uma superfície maior que a escrita manual.
- **Tool call rotulado distintamente de prosa (FR-15):** um registro de "ação" (`source:"capture"`, e o `kind`
  apropriado) é gravado distinto de um registro de "resposta" — nunca fundidos indistinguivelmente. E como uma
  entrada de tool-call é **multi-campo** (args/saída/excerto/rótulo), ela **tem** que passar pela deep-redação
  de D8, nunca por uma redação que nomeia só `text` (T62).
- **Limitada, nunca cresce sem controle (FR-18/T64/R45):** o buffer de captura **bruta** é podado além de um
  limite configurado; o **diário curado já promovido a entrada formal nunca é podado**. A propriedade observável
  ("nunca cresce sem limite") é exigida; o limite exato é sintonia (medida no Gate 11).

### 7.3 Nunca bloqueia o turno (FR-16/BR-6)

A escrita local (o `entries.jsonl`) é **síncrona e rápida** (append-only, best-effort local — o molde
`grounding-ledger.ts`); qualquer sincronização com um backend remoto (se algum dia configurado — non-goal §3 da
spec) é **assíncrona/desacoplada**. O turno do usuário **nunca** espera pela sincronização. A curadoria de um
evento em `JournalAddInput` é uma função **pura** (`curateCaptureEvent`, §16) — ela decide *o que pouco*
persistir; a **escrita** (redação + append) é o `JournalWriter`. Purez­a na decisão de minimização, I/O na
borda.

### 7.4 O residual, declarado (R42(iii))

`redactSecrets` casa **padrões conhecidos** (token, chave de API) — **não** um segredo de negócio arbitrário em
prosa (um nome sob NDA, um valor estratégico). A captura pode persistir isso mesmo redigida. D5 **reduz** o
risco (minimização na origem + alto-risco OFF) e **não o elimina** — declarado, não escondido, e é por isso que
a minimização é o controle *primário* aqui e a redação (D8) o *complementar*, não o contrário.

*Grounding:* **Data Protection and GDPR Compliance — Complete Professional Guide §3.10 "Anti-patterns: privacy
by design in practice"** (top **0.671** nesta sessão, `--category 09_security_and_privacy`: *"Make minimization
and purpose limitation **schema decisions, not afterthoughts**. Set privacy-protective defaults so an inactive
user is still protected"*), **Privacy Engineering §1.10 "Anti-patterns: privacy by design"** (0.663: *"Make the
private option the default. Minimize and pseudonymize by default; expand only with consent"*) e **§1.5 "Real
example: privacy by design"** (0.661). É o anchor exato que o Gate 3 R42 já usou. **Cobertura declarada fraca**
para o **mecanismo assíncrono** (spec §8.8, top 0.594) e para **qual hook do `pi`** (pergunta sobre a API de um
framework específico, não uma prática geral) — ambos ancorados em prior art do projeto (`journal.py:record_event`
"must not pay a multi-second synchronous tax"; ADR 0001/recon do `pi`), não em citação forçada.

---

## 8. D7 — Correção via `supersedes`, reader fail-closed (T63 núcleo, R44)

> (D6 é apresentada depois, em §9, para manter D7 imediatamente após D5 por afinidade de tema — persistência
> append-only. A numeração D1–D8 é lógica, não posicional.)

### 8.1 A decisão

Uma correção é **sempre um novo registro append-only** cujo `supersedes` nomeia o id do original — nunca
mutação/exclusão in-place. Portando `journal.py:edit_entry`/`EDIT_MODES` como referência de comportamento:

- Três modos (`update|forget|invalidate`) — o mesmo append por baixo, o modo só diz como ler a intenção depois.
- O novo registro **herda** `session`/`gate`/`kind`/`author` do original (uma correção pertence à mesma
  conversa e gate) e carimba **proveniência fresca** (uma correção feita de outra branch/commit deve dizê-lo).
- Um `supersedes` para um id **inexistente** é **recusado** (o análogo do `KeyError` de `edit_entry`) — nunca
  cria uma referência pendurada (edge case 6).

### 8.2 Corrente vs. histórico bruto (BR-5)

- `recall`/`search` leem **entradas ativas** — uma entrada superseded **para de contar como corrente** (o
  análogo de `journal.py:active_entries`, que filtra o que uma entrada posterior supersede).
- `log`/`digest`/export leem o **histórico bruto** — AMBAS (original + correção) aparecem, em ordem, sempre
  (o análogo de `_read_mirror`, que não filtra). Uma correção nunca reescreve o que os contratos "read exactly
  what is on disk" mostram.

### 8.3 O reader fail-closed — a razão de segurança de R44

O reader do log **nunca lança** (R36 portado de `grounding-ledger.ts`): log ausente/ilegível/linha-corrompida
colapsa para vazio; uma linha malformada é **pulada**, as entradas antes e depois seguem legíveis (edge case 2).
O efeito de rede é o que §6.3/D4 já nomeou: **apagar o diário revoga a evidência, nunca a fabrica** — a sessão
fica menos permissiva. É a mesma direção fail-closed que `policy-trust-store.ts:loadPolicyTrustStore` e
`grounding-ledger.ts:readEvents` já aplicam a domínios irmãos.

**O residual (o teto de T47/T55, GAP-4D herdada):** acesso ao disco **fora do loop do agente** ainda escreve um
diário consistente com um id forjado (sem tamper-evidence criptográfica). R44/D7 **não** fecha esse teto e
**não** afirma fechá-lo — o teto continua sendo o gate de execução da Fase 2 (T17/R1) e o protected-path (D4).

### 8.4 Alternativa considerada

**Um comando `journal edit` que reescreve a linha original** (como um `UPDATE` de banco). Rejeitada
frontalmente: seria anti-forense num artefato de governança (um agente comprometido apagaria o registro do que
fez), e quebraria a fonte-de-verdade-append-only de D1. A correção-como-append é a única forma que preserva o
histórico bruto **e** mantém `runtimeRecordedJournalEntryIds` monotônico (um id que existiu continua existindo).

*Grounding:* **Context Engineering §6.4 "Vector Memories: Retrieval Turned Inward"** (top **0.656** nesta
sessão, `--category 10_ai_and_llm`: *"**Staleness without supersession.** Documents in a knowledge base get
re-published; memories accrete... similarity search has no concept of"* [supersessão] — base direta de
G10/BR-1/BR-5) e **Designing Data-Intensive Systems §10.4/§10.12** (herdado de D1: log-as-truth, nunca uma
migração in-place). **Fail-closed:** **Secure and Reliable Systems Design §1.12 "When not to treat security and
reliability as one problem"** (top **0.605**: *"the failure direction is forced... the auth path admitting
requests it could not verify"* — a leitura do diário falha **fechada**) + **Security Engineering Principles
§2.2/§2.9** (herdado de D2). Eco de domínio irmão em **Dimensional Modeling §3.10** (SCD Type-1 anti-pattern:
"overwriting... silently falsifying the past", herdado da spec §8.2).

---

## 9. D6 — `recall` (semântico) e `search` (faceta) são dois modos distintos (spec §9 questão 1)

### 9.1 A decisão

A spec §9 questão 1 registrou uma tensão real: `journal.py` de referência só tem **um** verbo de recuperação
semântica (`recall`, que tenta um backend semântico e cai para varredura local) mais um `log` (dump filtrado
bruto, nunca semântico); o plano do `pi` nomeia **dois** entregáveis separados (`recall` **e** `search`). Esta
fase **confirma a hipótese de trabalho da spec** e a fecha:

- **`recall` — pergunta em linguagem natural, com síntese (G3/FR-5).** Busca híbrida (fusão RRF reusada + rerank
  próprio com recência-como-prior, D3), devolve as entradas relevantes por **significado** — nunca substring —
  cada uma anotada com **origem e data** (o critério de saída literal). Se nada cruza o threshold de relevância,
  a resposta diz **explicitamente** "nenhuma memória correspondente" (FR-6), nunca força as entradas mais
  parecidas porém irrelevantes. Recência é um **fator de ranking**, nunca um filtro que descarta o passado
  (BR-10/G11).
- **`search` — lookup estruturado por faceta (G4/FR-8).** Filtra por `kind`/`gate`/`sessão`/intervalo de
  datas/texto exato sobre o índice derivado — mais perto do `log` do conductor-main do que do `recall`. Um valor
  de faceta não reconhecido (um `--kind` fora do enum, um `--gate` fora de 1-14) é **reportado explicitamente**,
  nomeando o inválido e os aceitos (FR-9/BR-8), nunca tratado como "sem filtro".

**São dois modos, funções separadas por TIPO** (`recall(...)` e `search(...)`, §16), **nunca um booleano num
verbo só** — a mesma disciplina que a Fase 5 aplicou a `recordGroundedDecision` vs. `recordUngroundedDecision`
(ADR 0006 §14.2: "não há parâmetro booleano que os una... a distinção passa a ser garantida pelo compilador,
não pela memória de quem escreve o próximo caller"). O risco que a spec §9.1 nomeou (dois comandos que fazem a
mesma coisa com nomes diferentes) é fechado por eles terem **contratos de tipo diferentes**: `recall` devolve
`RecallOutcome` (síntese ou "nenhuma memória"), `search` devolve `JournalSearchOutcome` (linhas filtradas ou
faceta inválida).

*Grounding:* **Context Engineering §10.3 "Recency: Weighting Time Without Worshipping It"** (top **0.767** nesta
sessão, `--category 10_ai_and_llm`: *"Recency is a *prior*, not a verdict — the newest document touching a topic
is frequently a half-baked draft... 'latest wins' elevates exactly those over the settled canonical text"* —
base direta do ranking de `recall`, G11/BR-10) e **§10.2 "Provenance: Every Chunk Carries Its Passport"** (0.652:
a origem+data que toda resposta de `recall` carrega). A separação-por-tipo é ancorada no **precedente in-repo**
(ADR 0006 §14.2, `recordGrounded`/`recordUngrounded`), não numa citação de livro.

---

## 10. D8 — O Diary é o 8º sink fechado de redação, deep-redigido (fecha T62 / R43)

### 10.1 A decisão

`REDACTION_SINKS` (`redaction.ts:38-46`) passa de **7 para 8 valores**, ganhando `"diary"`. A enumeração fechada
é o mecanismo que o ADR 0003 §6.2 criou para que "a lista está completa" seja um **fato asseverável** e não um
parágrafo que encolhe em silêncio — acrescentar o sink aqui é usar o mecanismo como projetado. Duas propriedades
vinculantes:

1. **Toda escrita do Diary (manual E automática) deep-redige TODO leaf string, antes de tocar o disco.** Reusa
   `redactSessionEntryForPersistence`/`deepRedact` (`redaction.ts:111-143`, o mecanismo R12a) — que redige todo
   leaf e **reconstrói a entrada fresca**, nunca muta — **nunca** um spread-then-overwrite
   `{...entry, text: redactSecrets(entry.text)}` que mascara só `text` e **vaza** os demais campos. Uma entrada
   auto-capturada de tool-call é **multi-campo** (args/saída/excerto/rótulo): a lição literal de T57/R38 da Fase
   5 ("acrescentar um campo ao tipo sem atualizar a reconstrução o descartaria silenciosamente") aplica-se
   diretamente. A redação acontece no **ponto único de escrita** (o `JournalWriter`), nunca presumindo que um
   chamador upstream já redigiu (BR-2, a disciplina de `audit-trail.ts` "cada sink redige independentemente").
2. **Fail-closed no matcher.** `redactSecrets` já devolve `SECRET_SCAN_FAILED_PLACEHOLDER` quando o matcher
   lança (`redaction.ts:87-99`); a entrada é escrita **redigida**, nunca com texto cru "só desta vez" (edge case
   5). A redação é **idempotente** sobre texto já redigido — um placeholder `[REDACTED:...]` não é, ele mesmo,
   "secret-shaped" (edge case 7).

### 10.2 A relação com D5 (a defesa em profundidade)

D8 (redação) e D5 (minimização) são **duas camadas independentes**, e a ordem de importância é deliberada: D5 é
o controle **primário** (não capturar o que não precisa), D8 é o **complementar** (redigir o que for capturado).
A razão é o residual declarado em §7.4: `redactSecrets` casa padrões, não segredo de negócio arbitrário — então
a defesa não pode ser só a redação. Duas camadas independentes, cada uma podendo falhar, é a definição de defesa
em profundidade.

*Grounding:* **Security Engineering Principles §1.5 "Real example: defense in depth and least privilege"** (top
**0.658** nesta sessão, `--category 09_security_and_privacy`) e **§1.2 "Business context: defense in depth and
least privilege"** (0.651: *"**Defense in depth** means using **multiple, independent layers** of security so
that one failure doesn't cause a breach"* — a razão de D5+D8 serem duas camadas) e **§1.9** (0.649). É o mesmo
anchor de R38/T57 da Fase 5 e de R43 do Gate 3. **OWASP ASVS V6.4** (herdado, spec §8.4: "no credentials... or
personally identifiable [data]" em logs) — a mesma seção que `journal.py:_redact_text` já cita, confirmando que
este ADR restata um requisito, não o inventa.

---

## 11. SLIs / SLOs por componente (objetivo explícito do Gate 4)

Medidos no Gate 11; **definidos aqui**, antes da primeira linha de código.

| # | SLI | Alvo (candidato) | Tipo |
|---|---|---|---|
| 1 | Latência de `journal recall` (híbrida, índice local por-projeto) | p95 < **800 ms** (dominado pelo embed da pergunta no Ollama; paridade com `library search`, ADR 0006 §18) | SLO |
| 2 | Latência de `journal search` (faceta, sem embed) | p95 < **120 ms** | SLO |
| 3 | Latência de `journal add` (mint + deep-redação + append + upsert no índice) | p95 < **80 ms** (paridade com `gate start`, ADR 0005 §12) | SLO |
| 4 | Latência que a captura automática acrescenta ao turno em andamento | **0 espera síncrona por sync remoto** — a escrita local é síncrona e rápida, o sync é async (FR-16) | Invariante, error-budget 0 |
| 5 | Entrada persistida com **qualquer** leaf não-redigido (medido por scan do índice/mirror no CI) | **0** | Invariante, error-budget 0 (D8/R43) |
| 6 | Um `journal-entry` fechando um gate obrigatório **sozinho** (sem `test-run`/`git-commit`) | **0** | Invariante, error-budget 0 (D2/R40/T59) |
| 7 | Entrada superseded devolvida como **corrente** por `recall`/`search` | **0** | Invariante, error-budget 0 (BR-5/D7) |
| 8 | Apagar o log → um `EvidenceRef{journal-entry}` que o citava **deixa de resolver** (revoga, nunca fabrica) | **100 %** | Invariante, error-budget 0 (R44/T63/D7) |
| 9 | `journal digest` regenerado 2× sobre um log inalterado | **byte-idêntico** | Invariante (FR-11) |
| 10 | Buffer de captura **bruta** cresce além do limite configurado | **0** (podado; o diário curado nunca é podado) | Invariante (FR-18/T64/R45) |

**Honestidade sobre a natureza destes números.** *Grounding:* **Site Reliability Engineering §1.12** (herdado,
ADR 0006 §18, 0.661): SLOs pressupõem *"a continuously served, user-facing request path with enough traffic
that the ratio is a measurement"*. Um CLI single-user **não é isso** — por isso só os itens 1–3 são SLOs de
verdade (latência, com distribuição real ao longo do uso); 4–10 são **invariantes com error-budget zero**,
asseverados por teste no Gate 5/7, não estimados por amostragem.

---

## 12. Reconciliação R40–R45 (o mandato do Gate 3 §4) + a extensão declarada

| Regra | Onde satisfeita | Status |
|---|---|---|
| **R40** (`journal-entry` = existência, não trabalho; não equivale a `test-run` sozinho) | §4/D2 — ramo runtime-derived exige `ref.kind==="test-run"`; `journal-entry` vira contexto/proveniência; seam FECHA em `resolveEvidenceRef` inalterado; residual declarado | Confirmada |
| **R41** (conteúdo de `recall`/`search` é dado, nunca instrução) | §5.2/D3 — passagem = material citado, rotulado `source` (entry/capture/document); procedência é condição de confiança; prevenção completa não afirmada | Confirmada na direção |
| **R42** (captura redige antes de persistir + minimiza na origem) | §7/D5 — mínimo curado, alto-risco OFF por default; redação antes de qualquer persistência (§10/D8); residual "segredo de negócio não-padrão" declarado | Confirmada |
| **R43** (Diary é o 8º sink; deep-redige todo campo) | §10/D8 — `"diary"` em `REDACTION_SINKS`; `deepRedact`/R12a, nunca spread-then-overwrite | Confirmada |
| **R44** (append-only + fail-closed; apagar revoga; path é decisão de segurança) | §8/D7 (append-only + reader fail-closed) + §6/D4 (path por-máquina, protected) | Confirmada, com path elevado a controle |
| **R45** (captura limitada e curada; recall pondera relevância, recência como prior) | §7.2/D5 (buffer bruto podado, curado nunca) + §9/D6 (recência-como-prior, superseded não corrente) | Confirmada |

### 12.4 A extensão declarada — o que exatamente muda no código já travado

Duas mudanças, e só duas, em código de fases anteriores:

| Antes | Depois | Onde |
|---|---|---|
| `hasSufficientEvidenceForMandatoryGate`: ramo `provenance === "runtime-derived"` (qualquer kind) | `+ && item.ref.kind === "test-run"` | `gate-evidence.ts:209` (D2) |
| `REDACTION_SINKS` = 7 valores | `+ "diary"` (8 valores) | `redaction.ts:38-46` (D8) |

Nada mais em código herdado muda. `resolveEvidenceRef`, `ResolveEvidenceRefContext`, `EvidenceRef`,
`EvidenceProvenance`, `EvidenceProvenanceInfo` (cuja forma **já** carrega `ref.kind`), `GateState`, e todo o
resto da Fase 4/5 permanecem **literalmente** como estão. `defaultProtectedPaths()` ganha uma entrada de path
(D4) — uma adição, não uma mudança de forma. Isto é **estender**, não redefinir: a assinatura de
`hasSufficientEvidenceForMandatoryGate` é idêntica, e a Fase 4 **já refinou o corpo dessa mesma função por
loop-back de Gate 8** (a adição do ramo `git-commit` e do campo `ref.kind`) — a Fase 6 usa a porta que aquele
loop-back abriu.

---

## 13. Reconciliação com o Gate 3 addendum Fase 6 (protocolo iterativo) + o que retorna

O mandato (Gate 3 §7): "se o Gate 4 expuser uma superfície nova, retornar a este gate". Avaliei as duas
decisões deste gate que tocam superfície:

- **D4 (path por-máquina)** — **não** é uma superfície nova para o Gate 3; é a **aplicação** do controle que o
  próprio Gate 3 (GAP-6D/R44) exigiu ("o path é uma decisão de segurança; por-máquina herda o protected-path
  D9"). O Gate 4 escolheu por-máquina exatamente sob essa regra. Nada a re-modelar.
- **D3 (reuso da primitiva de busca da Library)** — o Gate 3 §7 nomeou como gatilho de retorno "um índice de
  diário que reuse o motor da Library, reabrindo a fronteira global-vs-por-projeto de T51". D3 **fecha** essa
  fronteira por construção: o Diary reusa a **função pura** (`buildFtsMatchExpression`), **nunca** o store
  global (`corpus.sqlite`); o índice do Diary é fisicamente separado, por-projeto. A fronteira T51 **não** é
  reaberta — é respeitada exatamente como a Fase 5 a fechou. **Não** precisa de retorno formal; fechado por
  composição.
- **D5 (hook de captura)** — o Gate 3 §7 nomeou "um hook de captura que observe a sessão do subagente sem
  rótulo, reabrindo FR-17". D5 **rotula** o `agent_settled` do subagente com sua própria sessão (§7.1). FR-17
  respeitado; não reabre.

**Nada retorna ao Gate 3 como bloqueante.** As seis regras R40–R45 estão satisfeitas (§12); os três residuais
declarados (T59 forja via execução, T60 injection indireta não-eliminável, T63 forja fora do loop sem
tamper-evidence) são os **mesmos tetos herdados** (T47/T5/GAP-4D), reduzidos e **detectáveis**, não fechados — e
o Gate 3 §7b já os roteou para verificação empírica no Gate 9.

---

## 14. Resolução das 4 GAPs (GAP-6A…D, devolvidas pelo Gate 3 §5)

| GAP | Origem | Resolução no Gate 4 |
|---|---|---|
| **6A** — FR-25 trata `journal-entry` como Tier-1 sem nomear que é mais fraco que `test-run` | T59 | §4/D2: correção cirúrgica — `journal-entry` resolve (seam fecha, G12) mas **não** fecha um obrigatório sozinho; "existência ≠ trabalho" é Tier-2 do revisor; residual (execução forja a entrada) declarado |
| **6B** — FR-12 rotula o ingest como documento, mas não nomeia a passagem como dado-não-instrução | T60 | §5.2/D3: saída de `recall`/`search` é **dado citado**, rotulado `source` (entry/capture/document); procedência é condição de confiança; prevenção completa de injection não afirmada |
| **6C** — Grupo F não nomeia minimização-na-origem nem default-OFF para alto risco | T61 | §7/D5: mínimo curado (metadado + resumo, nunca verbatim), alto-risco OFF por default; residual "segredo de negócio não-padrão" declarado; minimização é o controle primário, redação o complementar |
| **6D** — a spec §9.6 trata o path como convenção, não decisão de segurança | T63 | §6/D4: log autoritativo **por-máquina** protected-path (fecha T63(b) por construção — clone não planta diário; protected-path fecha a anti-forense); digest derivado é o único artefato no workspace |

---

## 15. Consequências

### 15.1 Positivas

1. **O seam mais antigo do monorepo fecha honestamente.** `gate-evidence.ts` prometeu "a REAL source once
   wired" desde a Fase 4; a Fase 6 a entrega **e** declara em voz alta o que ela prova (existência) e o que não
   prova (trabalho) — o non-negotiable #2 do `CLAUDE.md` continua um controle, não vira decoração.
2. **Zero dependências novas de terceiros.** `node:sqlite` é builtin; o Ollama já era pressuposto; a redação e a
   primitiva de escape FTS5 são reusadas. O inventário de cadeia de suprimentos do Gate 7 não cresce.
3. **Uma mudança de duas linhas em código travado** (§12.4), ambas usando primitivos que já existem
   (`ref.kind`, `REDACTION_SINKS`, `deepRedact`) — cirúrgica, testável, revisável.
4. **Funções puras** (`buildFtsMatchExpression` reusada, a fusão RRF, `curateCaptureEvent`, `renderDigest`, o
   ranking com recência) permitem ao Gate 5 escrever testes RED reais antes de qualquer motor existir.
5. **Duas classes de forja fechadas por construção:** um clone não pode plantar um diário autoritativo (D4,
   por-máquina); uma entrada de diário não pode fechar um obrigatório sozinha (D2).

### 15.2 Riscos aceitos (com mitigação)

| # | Risco | Sev. | Mitigação | Residual |
|---|---|---|---|---|
| R1 | Execução de código forja `journal add` **e** seu id no ledger | Alto | D2 (nunca fecha um obrigatório sozinho) + protected-path (D4) + gate de execução da Fase 2 | **Declarado, não resolvido** — teto de T47 |
| R2 | Segredo de negócio **não-padrão** persistido pela captura | Médio-Alto | D5 minimização na origem + alto-risco OFF + D8 deep-redação de padrões | **Declarado** — redação casa padrões, não semântica de negócio |
| R3 | Injection indireta via `recall` de um doc/entrada envenenada | Alto | D3/R41 (dado citado, nunca instrução; procedência) | **Declarado, não-eliminável** — problema aberto na indústria |
| R4 | Sem tamper-evidence criptográfica no log | Médio | Append-only + reader fail-closed (D7) + protected-path (D4) | **Declarado** — mesma GAP-4D herdada |
| R5 | Diário não versionável/compartilhável (por-máquina) | Baixo | Deliberado (D4); `journal digest` → Markdown commitável | Onboarding começa sem diário — assumido |
| R6 | Recall degradado por volume adversarial | Baixo (fail-safe) | D5 limite + D7 supersessão + D6 recência-como-prior | **Declarado** — reduzido, não eliminado; sintonia no Gate 11 |

### 15.3 Negativas / custos assumidos

- **Um pacote novo** (`@conductor/diary`: `package.json`, `tsconfig`, suíte de testes, build).
- **Duas camadas de persistência** (JSONL verdade + SQLite derivado) — mais superfície que um store só, pago
  pela propriedade "reprocessar um input imutável" (§3.1).
- **Uma feature de recuperação duplicada em parte** (a fusão RRF estrutural) — pago pela recusa consciente de
  importar o estado da Library (§5.1).
- **Digest é o único ponto de compartilhamento** — um time paga um passo manual (`journal digest` + commit) para
  compartilhar decisões que um diário in-workspace daria "de graça" (mas forjável).

---

## 16. Apêndice — contratos TypeScript (para o Gate 5/6 não reinventar a interface)

> Ilustrativos de contrato, não código de produção pronto para commit. **Este apêndice ESTENDE** o §18 do ADR
> 0005 e o §19 do ADR 0006 em exatamente os dois pontos de §12.4 (`hasSufficientEvidenceForMandatoryGate` e
> `REDACTION_SINKS`); tudo que não aparece aqui permanece como lá.

```typescript
// ==== @conductor/diary — journal-entry.ts (NOVO pacote, D1/D3) ====

/** O vocabulário FECHADO — verbatim de conductor-main journal.py:43 KINDS (assert-behaviour-over-prose:
 *  os 6 valores do CÓDIGO, incl. "checkpoint", não os 5 da prosa do CLAUDE.md). Um valor fora disto é
 *  recusado nomeando os válidos (FR-2/BR-7), nunca aceito como texto livre. */
export type JournalKind = "reasoning" | "decision" | "plan" | "error" | "solution" | "checkpoint";
export const JOURNAL_KINDS: readonly JournalKind[] =
  ["reasoning", "decision", "plan", "error", "solution", "checkpoint"] as const;

/** Como a entrada entrou no diário — a distinção que D3/D5 exigem, nunca fundida (T60/R41: um documento é
 *  dado citado; uma entrada é uma decisão; uma captura é uma observação). Rotulada na saída de recall/search. */
export type JournalSource = "manual" | "capture" | "document";

/** Correção append-only (D7): os modos de journal.py EDIT_MODES — o mesmo append por baixo, o modo só diz
 *  como ler a intenção. */
export type EditMode = "update" | "forget" | "invalidate";

/** Proveniência best-effort — cada campo INDEPENDENTEMENTE omitido (nunca inventado) quando o git não
 *  resolve (BR-3/FR-3; journal.py:_stamp_provenance's per-field independent None). `sha` é machine-read do
 *  HEAD, NUNCA derivado do `text` (BR-8). */
export interface JournalProvenance {
  branch?: string;
  sha?: string;
  repo?: string;
}

export interface JournalEntry {
  /** Runtime-mintado (randomUUID), NUNCA um --id do autor (FR-4/BR-8). É este id que a Fase 4 resolve como
   *  EvidenceRef{journal-entry} (G12/FR-25). */
  id: string;
  /** LITERAL — versionado desde a 1ª escrita (FR-21; a regra do monorepo). v2 vira união discriminada. */
  schemaVersion: 1;
  /** ISO-8601 string, NUNCA um Date (a armadilha do canonicalizer da Fase 4). */
  ts: string;
  sessionId: string;
  author: string;
  kind: JournalKind;
  /** 1..14 quando presente. */
  gate?: number;
  source: JournalSource;
  /** JÁ redigido antes desta forma ser persistida (BR-2/D8 — deep-redação no JournalWriter). */
  text: string;
  provenance: JournalProvenance;
  /** Correção (D7/FR-23): aponta para o id do original — NUNCA uma mutação. Um supersedes para id
   *  inexistente é recusado antes de escrever (nunca uma ref pendurada). */
  supersedes?: string;
  editMode?: EditMode;
}

// ==== @conductor/diary — writer (BORDA: fs; append-only, LANÇA em I/O — molde grounding-ledger.ts) ====

/** Input de uma escrita — SEM campo `id` (o runtime o minta, FR-4/BR-8). */
export interface JournalAddInput {
  kind: JournalKind;
  text: string;
  sessionId: string;
  author: string;
  gate?: number;
  source: JournalSource;
}

export interface JournalWriter {
  /** Manual (SF-D1) ou captura (SF-D2). Deep-redige TODO leaf ANTES de persistir (D8/R43), minta o id,
   *  faz append síncrono. LANÇA em falha de I/O — nunca engole (a disciplina do writer de grounding-ledger.ts). */
  append(input: JournalAddInput): JournalEntry;
  /** Correção append-only (D7): novo registro com `supersedes`, herda session/gate/kind/author do original,
   *  proveniência fresca. Recusa (sem lançar) um id inexistente. */
  supersede(originalId: string, newText: string, mode: EditMode):
    | { ok: true; entry: JournalEntry }
    | { ok: false; kind: "unknown-entry"; id: string };
}
export function openJournalWriter(entriesPath: string): JournalWriter;

// ==== @conductor/diary — reader (BORDA: fs; NUNCA lança — molde grounding-ledger.ts reader, R44/T63) ====

export interface JournalReader {
  /** Histórico bruto — TODAS as entradas incl. superseded (log/digest/export leem isto, sem filtrar). */
  readAll(): readonly JournalEntry[];
  /** Conhecimento CORRENTE — superseded removidas (BR-5; journal.py:active_entries). recall/search leem isto. */
  readActive(): readonly JournalEntry[];
}
/** NUNCA lança: log ausente/ilegível/linha-corrompida -> "sem entradas" (R44/T63/R36 portado). */
export function openJournalReader(entriesPath: string, projectId: string): JournalReader;

/** Fase 4 interop (D2/G12/FR-25): o conjunto de ids que o runtime genuinamente registrou, para
 *  ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds. FAIL-CLOSED: um diário ilegível -> conjunto
 *  VAZIO, então um EvidenceRef{journal-entry} deixa de resolver e o obrigatório que ele contextualizava
 *  perde o sinal (apagar o diário REVOGA, nunca fabrica — R44/T63). O ResolveEvidenceRefContext da Fase 4
 *  é INALTERADO — a CLI (composition root) passa este conjunto. */
export function readRecordedJournalEntryIds(reader: JournalReader): ReadonlySet<string>;

// ==== @conductor/diary — recall (D6/G3): semântico, dado citado (R41/T60) ====

export interface RecalledEntry {
  entry: JournalEntry;
  score: number;                 // FINITO (a mesma guarda de finitude do ADR 0006 §5.3)
  /** Rótulo apresentado como MATERIAL CITADO, nunca diretiva (R41): source + origem + data. */
  citedAs: { source: JournalSource; sessionId: string; gate?: number; ts: string };
}
export type RecallOutcome =
  | { ok: true; hits: RecalledEntry[] }
  | { ok: true; hits: []; reason: "no-matching-memory" }                    // FR-6 — explícito, nunca inventado
  | { ok: false; kind: "backend-unreachable"; backend: "embeddings" | "index"; reason: string };  // falha ALTA
export interface RecallContext {
  projectType?: string; technologies?: string[]; gate?: number; role?: string;  // enriquecimento (FR-3)
  now: Date;                     // recência-como-prior é função do tempo (BR-10/G11) — injetado, testável
}
export function recall(query: string, reader: JournalReader, ctx: RecallContext): RecallOutcome;

// ==== @conductor/diary — search (D6/G4): faceta estruturada, separada por TIPO de recall ====

export interface JournalSearchFilters {
  kind?: JournalKind[];
  gate?: number;
  sessionId?: string;
  since?: string; until?: string;    // ISO-8601
  text?: string;                     // substring exata (NÃO semântico — isso é recall)
}
export type JournalSearchOutcome =
  | { ok: true; entries: JournalEntry[] }
  | { ok: false; kind: "unknown-facet"; facet: string; value: string; available: string[] };  // FR-9/BR-8
export function search(filters: JournalSearchFilters, reader: JournalReader): JournalSearchOutcome;

// ==== @conductor/diary — digest (G5/FR-10/FR-11): PURO, determinístico, o ÚNICO artefato do workspace (D4) ====

/** Markdown agrupado por kind, byte-idêntico em regenerações sobre um log inalterado (FR-11). Lê readAll
 *  (histórico bruto), NUNCA muta o log. Derivação de G1 (§3.1), regenerável sem perda. */
export function renderDigest(entries: readonly JournalEntry[]): string;

// ==== @conductor/diary — captura automática (D5/G7): minimização na origem ====

export interface CaptureConfig {
  enabled: boolean;                  // default true (só para eventos curados)
  captureHighRiskBodies: boolean;    // default FALSE (R42/T61 secure-default: íntegra de tool-result/msg OFF)
  rawBufferLimit: number;            // FR-18/T64/R45: buffer BRUTO podado além disto; o curado NUNCA é podado
}
/** Os eventos de ciclo de vida do Pi que a captura assina (D5) — discretos, alto sinal; NUNCA message_update
 *  (o stream bruto). agent-settled carrega parentSessionId para o rótulo de subagente (FR-17). */
export type CaptureEvent =
  | { kind: "turn-end"; sessionId: string; summary: string; gate?: number }
  | { kind: "agent-settled"; sessionId: string; parentSessionId: string; summary: string; gate?: number }
  | { kind: "session-shutdown"; sessionId: string; summary: string }
  | { kind: "gate-concluded"; gate: number; sessionId: string; outcome: string };
/** PURA (D5): mapeia um evento a NO MÁXIMO um JournalAddInput curado (ou null). A minimização vive aqui —
 *  decide O QUE POUCO persistir (metadado + resumo curto, nunca o verbatim). A ESCRITA (redação + append) é
 *  o JournalWriter. Nunca bloqueia o turno (FR-16): esta função é síncrona e barata; o sync remoto (se algum
 *  dia) é desacoplado a jusante. */
export function curateCaptureEvent(event: CaptureEvent, cfg: CaptureConfig): JournalAddInput | null;

// ==== @conductor/runtime — gate-evidence.ts (DELTA CIRÚRGICO, D2/R40/T59) ====
// Assinatura INALTERADA; só o predicado do ramo runtime-derived muda, usando o campo ref.kind que o
// loop-back de Gate 8 da Fase 4 JÁ acrescentou a EvidenceProvenanceInfo.
export function hasSufficientEvidenceForMandatoryGate(evidence: readonly EvidenceProvenanceInfo[]): boolean {
  // runtime-derived fecha um obrigatório SOZINHO só para test-run (execução observada) — NUNCA journal-entry
  // (escrita observada: existência, não trabalho — R40/T59). journal-entry segue resolvendo como
  // runtime-derived em resolveEvidenceRef (G12); aqui é contexto/proveniência, nunca a prova única.
  if (evidence.some((i) => i.provenance === "runtime-derived" && i.ref.kind === "test-run")) return true;
  return evidence.some((i) => i.provenance === "author-declared" && i.ref.kind === "git-commit");
}
// resolveEvidenceRef, ResolveEvidenceRefContext, EvidenceRef, EvidenceProvenance, EvidenceProvenanceInfo:
// INALTERADOS. A CLL passa readRecordedJournalEntryIds(reader) como runtimeRecordedJournalEntryIds,
// fail-closed a vazio num diário ilegível (R44/T63).

// ==== @conductor/runtime — redaction.ts (DELTA: 7 -> 8 sinks, D8/R43/T62) ====
export const REDACTION_SINKS = [
  "transcript", "notify", "sessionJsonl", "auditTrail", "rethrownError", "sessionExport", "codeIndex",
  "diary",   // NOVO — toda escrita do diário deep-redige TODO leaf (redactSessionEntryForPersistence),
             //        antes de tocar o disco, NUNCA spread-then-overwrite que nomeia só `text` (T62/T57/R38)
] as const;

// ==== @conductor/runtime — workspace-policy.ts (DELTA, D4/R44/T63) ====
// defaultProtectedPaths() ganha: join(homedir(), ".conductor", "diary")  — simétrico a "library" (Fase 5 D9)
```

**Superfície CLI (os comandos do plano, linhas 1390-1403):**

```text
conductor journal add     --kind <k> [--gate N] [--session <id>] "<texto>"   # id MINTADO pelo runtime (FR-4)
conductor journal recall  "<pergunta>" [--gate N] [--role <papel>]           # semântico, síntese (D6)
conductor journal search  [--kind k1,k2] [--gate N] [--session <id>] [--since <d>] [--until <d>] [--text "<s>"]
conductor journal digest  [--session <id>] [--out <path.md>]                 # derivado; único artefato no workspace (D4)
conductor journal ingest  [<path>...]                                        # docs do projeto, hash-idempotente (FR-13)
conductor journal supersede --id <id> --mode <update|forget|invalidate> "<texto>"   # correção append-only (D7)
# A captura automática NÃO é um comando — assina os hooks de ciclo de vida do Pi (D5), OFF-por-default p/ alto risco.
```

---

## 17. Rastreabilidade

| Decisão | FR / BR / G da spec | Regra / ameaça / GAP do Gate 3 |
|---|---|---|
| **D1** pacote novo, JSONL-verdade + índice derivado, enum fechado | G1, FR-1/2/21, spec §9.1/§9.2/§9.5 | — (§9.5 resolvida: enum não cresce) |
| **D2** `journal-entry` = existência, não trabalho | G12, FR-4/25, BR-8 | **R40 / T59 / GAP-6A** |
| **D3** reuso puro + ranking próprio + store separado + dado citado | G3/G4, FR-5/12, BR-10 | **R41 / T60 / GAP-6B** |
| **D4** log por-máquina protected; digest no workspace | G9, FR-21/22 | **R44 / T63 / GAP-6D** |
| **D5** captura minimizada, alto-risco OFF, limitada | G7, FR-14/15/16/17/18 | **R42 / R45 / T61 / T64 / GAP-6C** |
| **D6** recall vs search por tipo | G3/G4/G11, FR-5/6/7/8/9, BR-10 | spec §9 questão 1 |
| **D7** supersedes append-only, reader fail-closed | G10, FR-23/24, BR-1/5 | **R44 / T63** |
| **D8** 8º sink, deep-redação | G8, FR-19/20, BR-2 | **R43 / T62** |
| §11 SLIs/SLOs | critério de saída do Gate 4 | — |

Cobertura das 7 questões abertas da spec §9: **1** → D6 (§9); **2** → D3 (§5); **3** → D5 (§7); **4** → mantida
Non-goal (spec §3, backend remoto opt-in não decidido aqui — o local funciona 100% primeiro); **5** → D1 §3.3
(enum não cresce; `Risk`/`Approval` referenciados); **6** → D4 (§6, por-máquina); **7** → D1 §3.4 (arquivo por
sessão, sem lock+CAS).

---

## 18. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 4 [--category …]`
(backend saudável; `library --health` confirmou 2267 chunks). Uma consulta específica por decisão, na disciplina
do ADR 0006 (não uma query genérica por ADR inteiro).

1. **Log-as-truth + índice derivado (D1)** → **Designing Data-Intensive Systems §10.5** (top **0.702**,
   `05_databases`: *"Make the order event log the source of truth and the search index a derived view... reprocess
   the log to rebuild"*), **§10.4** (0.681), **§10.12** (0.664); + **Domain-Driven Design §1.12** (0.690,
   `03_design_and_architecture`: quando NÃO fazer linguagem ubíqua — base de §3.3, o enum não duplicando
   `Approval`).
2. **Evidência de existência vs. trabalho (D2)** → **cobertura declarada fraca** (a mesma lacuna de T53/T47, top
   ~0.60): direção em **Security Engineering Principles §2.2** (**0.660**, `09_security_and_privacy`), **§2.12**
   (0.654: "an error must never read as permission"), **§2.9** (0.638); semântica ancorada no **precedente
   in-repo** `gate-evidence.ts` (`runtime-derived` vs `author-declared`, R25/T41, o campo `ref.kind`), **não**
   numa citação forçada.
3. **Regra de dependência, reuso de função pura (D3)** → **Architecture Boundaries and the Dependency Rule §1.1**
   (top **0.634**: "source-code dependencies point inward toward stable policy"), **§1.12** (0.622, quando NÃO
   inverter), **§3.4** (0.621); + herdado **Context Engineering §10.3** (recência) para o ranking próprio.
4. **Path como decisão de segurança (D4)** → **Secure and Reliable Systems Design §3.12** (top **0.659**,
   `09_security_and_privacy`: "the reachable authority has never been enumerated"), **§3.11** (0.650), **§3.13**
   (0.666) — o mesmo anchor de blast radius/least privilege que ADR 0006 D7 usou.
5. **Minimização na origem, default-OFF (D5)** → **Data Protection & GDPR §3.10** (top **0.671**: "minimization
   and purpose limitation schema decisions, not afterthoughts; privacy-protective defaults"), **Privacy
   Engineering §1.10** (0.663), **§1.5** (0.661). **Fraco declarado** no mecanismo assíncrono (spec §8.8, 0.594)
   e no hook do `pi` (API de framework) — prior art `journal.py:record_event` / ADR 0001.
6. **Recall: recência como prior (D6)** → **Context Engineering §10.3** (top **0.767**, `10_ai_and_llm`:
   "Recency is a *prior*, not a verdict... 'latest wins' elevates a half-baked draft"), **§10.2** (0.652,
   provenance). Separação-por-tipo ancorada no precedente ADR 0006 §14.2.
7. **Append-only supersessão + reader fail-closed (D7)** → **Context Engineering §6.4** (**0.656**: "staleness
   without supersession") + **Secure and Reliable Systems Design §1.12** (0.605: "the failure direction is
   forced... the auth path must fail closed") + **Security Engineering Principles §2.2/§2.9** (herdado); eco em
   **Dimensional Modeling §3.10** (herdado, SCD Type-1).
8. **Defesa em profundidade por-sink (D8)** → **Security Engineering Principles §1.5** (top **0.658**), **§1.2**
   (0.651: "multiple, independent layers so that one failure doesn't cause a breach"), **§1.9** (0.649) + **OWASP
   ASVS V6.4** (herdado, spec §8.4).

**Declarações honestas de cobertura fraca ou ausente** (nenhuma forçada): **"log de decisão forjável pelo ator
que precisa prová-lo"** (D2, top ~0.60 — a mesma lacuna de T53/T47, ancorada em fail-closed + provenance + o
contrato de código); **captura assíncrona / qual hook do `pi`** (D5 — prática de framework, não coberta;
ancorada em prior art); **RAG/recall poisoning / injection indireta** (D3, a mesma lacuna de T48/Fase 0 T5 —
R41 fixa a direção, a não-eliminabilidade é declarada).
