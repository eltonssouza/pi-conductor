# Gate 2 — Especificação (fonte da verdade): Fase 6 — Diary e captura automática

**Demanda:** `Fase 6 — Diary e captura automática` (`plano_desenvolvimento.md` linhas 1377-1403), lida junto
com §4.9 "Sessões" (linhas ~640-655 — persistência de tool calls, redação, separação de sessões de
subagentes, gate/papel/modelo registrados, redaction por seção na exportação) e §4.10 "Memória" (linhas
658-740 — a distinção Diary=dinâmico vs. Library=estático, a estrutura `.conductor/memory/`, a estratégia de
recuperação combinando busca vetorial+lexical+fatos estruturados+contexto temporal+grafo+RRF, e a
"Integração automática": "o README atual reconhece que a captura automática ainda não está integrada ao
loop nativo do Conductor e deverá ser tratada como requisito prioritário nesta implementação").
**Gates cobertos por este documento:** Gate 1 (descoberta de domínio) + Gate 2 (especificação), ambos
**leves** — nenhuma calibração explícita foi recebida do orquestrador para esta rodada; esta BA replica o
default já adotado nas duas specs anteriores desta série (Fases 4/5) por consistência: full nos gates 3,5,7,8
(nunca colapsáveis, `CLAUDE.md`); profundidade dos demais decidida a partir do Gate 3. Registrado aqui como
decisão desta BA, não herdada de uma instrução explícita.
**Papel responsável:** `business-analyst` (skill `map-requirements`), Gate 2 do fluxo Conductor.
**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/fase6-diary-e-captura-automatica`
(de `develop`, já criada e limpa). **Esta é uma tarefa de escrita de spec** — sem código, sem commit/push
(fica para o orquestrador).

**Princípio orientador (herdado do orquestrador, aplicado aqui):** "composição antes de fork" — o mesmo
princípio já usado nas Fases 3/4/5. O precedente mais próximo dentro do próprio pi-conductor não é a Library
(Fase 5): a Library é conhecimento **estático e global** (mesmo corpus para todo projeto, D9 do ADR 0006); o
Diary é conhecimento **dinâmico e por-projeto** (decisões mudam a cada sessão, ficam sujeitas a correção — ver
§6 BR-1/BR-5). O precedente real é a **forma** que a Fase 5 já provou para "log local append-only + índice
consultável": `corpus-store.ts` (SQLite+FTS5) e, mais ainda, `grounding-ledger.ts` — um writer que **lança**
em falha de I/O e um reader que **nunca lança** (R36), exatamente a disciplina que um diário de decisões
precisa (uma escrita que falha silenciosamente é pior do que travar; uma leitura que lança por um arquivo
ausente/corrompido derruba todo `recall`).

**Achado mais importante desta sessão** (leitura integral de `gate-evidence.ts`, Fase 4): o tipo
`EvidenceRef` já inclui `{ kind: "journal-entry"; id: string }`, e o contexto de resolução
(`ResolveEvidenceRefContext.runtimeRecordedJournalEntryIds`) já carrega, **no próprio código**, este
comentário: *"a real, durable ledger for this does not exist yet in this codebase (Fase 6 'Diary e captura
automática' is the named home for a full event ledger... this is the SEAM a future real ledger plugs into)"*.
O relatório de Gate 8 da Fase 4 confirma isso ao vivo: `status:"approved"` era estruturalmente
**inalcançável** para qualquer gate obrigatório até um loop-back interino aceitar `git-commit` como
substituto, porque os dois `EvidenceRef` kinds capazes de produzir proveniência `"runtime-derived"`
(`test-run`/`journal-entry`) eram alimentados por conjuntos que `cli.ts` sempre passava **vazios** — não
existia (e ainda não existe) um ledger real. Esta fase não está inventando um requisito novo aqui: está
fechando uma promessa que o próprio código do monorepo já fez — o mesmo teste de duas perguntas que o
`CLAUDE.md` do `conductor-main` usa para decidir o que vale construir ("o Conductor já promete isso e não
entrega? Então construa. Só depois: vale construir porque outra ferramenta tem?"). Isto está refletido como
G12/BR-8/FR-24 abaixo — não é decoração, é o fio que amarra esta spec ao resto do monorepo.

**Consome (lido integralmente antes de escrever este documento):**
- `plano_desenvolvimento.md` linhas 1377-1403 (Fase 6 em si), ~640-655 (§4.9 Sessões), 658-740 (§4.10
  Memória — Diary/Library, estrutura de diretórios, estratégia de recuperação, integração automática),
  1639-1662 (§10 invariantes — 9 "secrets não aparecem em sessões exportadas", 13 "sessões são append-only",
  19 "artefatos gerados possuem proveniência", diretamente aplicáveis ao Diary).
- `conductor-main/conductor/journal.py` (1760 linhas) — a **referência de comportamento**, nunca de
  implementação: `cmd_add`/`_stamp_provenance`/`_write_mirror` (como uma entrada é gravada, com proveniência
  best-effort por campo); `cmd_recall`/`_scan_diary`/`_scan_markdown` (recall como "tenta um backend
  semântico, cai para varredura local"); `cmd_digest`/`_render_digest` (derivação pura, agrupada por kind);
  `cmd_ingest`/`_iter_ingestable`/`_content_hash` (ingestão hash-idempotente de `docs/`/`records/`);
  `_write_mirror`/`_read_mirror`/`active_entries` (mirror JSONL + a distinção "histórico bruto" vs.
  "conhecimento corrente", via `supersedes`); `_redact_text` (redação ANTES de qualquer persistência, nos
  dois braços — mirror local e sync remoto); `edit_entry`/`EDIT_MODES` (correção como um novo registro que
  `supersedes` o original, nunca mutação); `_gate_to_role` (vínculo journal↔gate↔papel); `_save_pattern`/
  `_search_patterns`/`cmd_patterns` (promoção de padrão cross-project — avaliado e excluído, §3); `cmd_observe`/
  `_append_observation`/`_do_capture`/`_parse_transcript`/`cmd_capture`/`cmd_snapshot`/`cmd_flush`/
  `_flush_observations`/`_maybe_sync` (o bloco "Honcho live memory: total capture + per-prompt injection" —
  o "captura automática" do título, mapeado a hooks de harness: UserPromptSubmit/Stop/PreCompact/SessionEnd/
  SessionStart); `_maybe_sync`'s própria nota (`get_backend`, `local` default vs. `honcho` opt-in) — a camada
  de memória distribuída avaliada e excluída, §3.
- `packages/conductor-runtime/src/gate-state.ts`/`gate-state-store.ts` (Fase 4) — o par `Evidence`/`Decision`,
  a escrita atômica com lock+CAS, o fail-closed em corrupção (BR-9 daquela spec) — referência de disciplina
  de persistência local, não redecidida aqui.
- `packages/conductor-runtime/src/gate-evidence.ts` (Fase 4) — `EvidenceRef{kind:"journal-entry"}` e
  `runtimeRecordedJournalEntryIds`, o achado central desta sessão (acima).
- `packages/conductor-runtime/src/audit-trail.ts` — o par "writer síncrono que lança em falha de I/O" +
  "pre-write, not best-effort-after", e a disciplina "cada sink redige independentemente, nunca confia que um
  chamador upstream já redigiu" — referência direta para a redação do Diary (§6 BR-2).
- `packages/conductor-runtime/src/redaction.ts` — `redactSecrets` (wrapper de `@conductor/secrets`), a
  função que esta fase **reusa**, nunca reimplementa (ver §3 non-goal e §6 BR-2/BR-3).
- `packages/conductor-library/src/corpus-store.ts`/`grounding-ledger.ts`/`library-home.ts` (Fase 5) — o
  precedente de forma mais próximo (SQLite+FTS5 local; writer-lança/reader-nunca-lança; `~/.conductor/
  library/projects/<projectId>/...` como convenção de path por-projeto dentro do home do usuário).
- `docs/adr/0001-adopt-pi-as-runtime.md` + `docs/conductor/_recon-pi-architecture.md` — confirma que o `pi`
  expõe `session.subscribe(listener)` (eventos `message_update`) e hooks de ciclo de vida genuínos
  (`session_start/shutdown/before_switch/before_fork`, `agent_start/end/settled`, `turn_start/end`,
  `message_start/update/end`) — uma superfície de **stream de eventos ao vivo**, diferente (e mais direta)
  do que o `conductor-main` tem: lá a captura automática existe apenas porque o Claude Code **não** expõe um
  stream equivalente, só um arquivo de transcript JSONL para varrer (`_parse_transcript`). Ver §9 questão 3.
- `docs/conductor/gate2-spec-fase4.md`/`gate2-spec-fase5.md` — formato de referência (estrutura exata deste
  documento) e os precedentes já registrados (BR-9 fail-closed, BR-9 ingestão hash-idempotente da Fase 5) que
  esta spec reaplica sem reabrir.

---

## 1. O que já existe vs. o que a Fase 6 constrói

| Capacidade | Já existe (conductor-main, Fases 0-5 do pi, ou o próprio `pi`) | Fase 6 constrói/especifica |
|---|---|---|
| Diário maduro (add/recall/log/digest/ingest/patterns/observe/capture) | **Sim, em Python**, `conductor-main/conductor/journal.py` — referência de **comportamento**, nunca de implementação (o pi é um rewrite TS, ADR 0001). | O comportamento observável equivalente para o produto pi (`conductor journal add/recall/search/digest/ingest`) — package novo, ainda inexistente em `packages/` (confirmado por `glob`). |
| Persistência local append-only com escrita atômica, fail-closed em corrupção | **Sim, provado duas vezes**: `gate-state-store.ts` (Fase 4, lock+CAS+checksum) e `grounding-ledger.ts`/`corpus-store.ts` (Fase 5, writer-lança/reader-nunca-lança). | Reusa a **disciplina** (nunca o código) para o mirror JSONL do Diary — ver §6 BR-1/BR-4. |
| Redação de segredos antes de persistir | **Sim, completo e já genérico**: `redactSecrets` (`@conductor/runtime/redaction.ts`, sobre `@conductor/secrets`), já usado por `audit-trail.ts`/`grounding-ledger.ts`-adjacentes. | **Reusa por import** — não reimplementa (o mesmo gap que `journal.py:_redact_text` fecha no conductor-main, mas lá com uma função própria porque o Python não tinha o equivalente de `@conductor/secrets` compartilhado). Ver §3 non-goal. |
| `EvidenceRef{kind:"journal-entry"}` + o contrato de que só um id **runtime-derived** conta como Tier-1 | **Sim, o TIPO e o CONTRATO já existem** (Fase 4) — mas **sem produtor real**: `runtimeRecordedJournalEntryIds` é sempre um conjunto vazio hoje. | **O gap central que esta fase fecha**: um diário real que gera ids, e algum ponto de integração (Gate 4) que preenche `runtimeRecordedJournalEntryIds` a partir dele. Ver G12/BR-8/FR-24. |
| Persistência de sessão completa (tool calls, mensagens, JSONL append-only, versionado) | **Sim, já resolvido pelo próprio `pi`** (`Agent`/`AgentSession` + `SessionManager` JSONL, ADR 0001 §1.2/§2.1) — não é uma lacuna desta fase. | **Não reconstruído aqui.** O Diary consome/deriva DESSE stream (ou de um subconjunto curado dele), nunca duplica a persistência da sessão inteira — ver glossário §4 (Sessão vs. Diary) e Non-goal §3. |
| Stream de eventos ao vivo do loop (hooks de ciclo de vida) | **Sim**, `session.subscribe(listener)` + hooks `turn_start/end`, `message_start/update/end`, `agent_start/end/settled`, `session_start/shutdown` (ADR 0001, recon §2/§4). | O **ponto de extensão** que a captura automática (Grupo F) provavelmente usa — mais direto que o `_parse_transcript` (varredura de arquivo) do conductor-main, que só existe porque o Claude Code não expõe um stream equivalente. Qual hook exato é Gate 4 (§9 questão 3). |
| Busca híbrida local (lexical FTS5 + vetorial + reranking) sobre um corpus | **Sim, mas sobre conhecimento ESTÁTICO** (Fase 5, `corpus-store.ts`, livros). | Se o Diary (conhecimento DINÂMICO, sujeito a correção/supersessão) reusa o MESMO motor físico, o mesmo banco, ou nenhum dos dois, não é decidido aqui — sinalizado pelo próprio orquestrador como questão aberta. Ver §9 questão 2. |
| Vínculo journal↔gate↔papel | **Sim**, `journal.py:_gate_to_role` — um mapeamento simples gate→papel para telemetria de efetividade (fora do escopo desta fase, `intelligence/effectiveness.py`). | Esta fase só herda o CAMPO `gate` numa entrada (já um FR); a telemetria de efetividade cross-project não é reconstruída — non-goal. |
| Padrão cross-project (erro→solução promovido, `~/.conductor/patterns.jsonl`) | **Sim**, capability separada do conductor-main, própria (`_save_pattern`/`_search_patterns`/`cmd_patterns`), fora dos 5 entregáveis literais desta fase. | **Não é um entregável desta fase** — avaliado e excluído, §3. |
| Memória distribuída/remota (Honcho, dialectic reasoning) | **Sim, no conductor-main, como backend OPT-IN** (`memory_backend.py`: `local` default, `honcho` opt-in). | **Não decidida aqui** — mesma lógica já aplicada à Library na Fase 5 (motor local por causa do hardware fraco do usuário, memória de sessão anterior). Ver §3. |

---

## 2. Goals

1. **G1 — Diário local append-only como fonte de verdade.** Um log local, nunca perdido nem substituído por
   omissão, do qual toda derivação (índice de busca, digest, mirror legível) é reconstruível — nunca a
   derivação vira uma segunda cópia de verdade divergente do log. *Grounding:* §8.1.
2. **G2 — `journal add` grava uma entrada completa e identificável.** Toda entrada carrega, no mínimo:
   texto, `kind` (vocabulário fechado), `gate` (opcional), sessão, timestamp ISO-8601, e proveniência
   git (branch/sha/repo) quando resolvível — nunca uma alegação sem esses campos.
3. **G3 — `journal recall` responde por significado, com origem e data (o critério de saída literal).**
   "Uma decisão tomada em uma sessão deverá ser recuperada semanticamente em outra sessão, com origem e
   data" (plano, linha 1400) — nunca apenas substring matching, e nunca uma resposta sem proveniência anexada.
   *Grounding:* §8.5.
4. **G4 — `journal search` permite um lookup estruturado/filtrado**, distinto de "responda uma pergunta em
   linguagem natural" (G3) — por `kind`/`gate`/sessão/intervalo de datas/texto exato. (Se os dois comandos
   colapsam num só verbo é uma questão aberta, §9 questão 1 — esta spec assume a distinção como hipótese de
   trabalho e a torna explícita, não decide silenciosamente.)
5. **G5 — `journal digest` deriva um resumo Markdown legível, puro e determinístico**, a partir das entradas
   de uma sessão/período — nunca uma fonte primária adicional (é derivação de G1, regenerável sem perda).
   *Grounding:* §8.6.
6. **G6 — `journal ingest` estende o alcance do recall/search a documentos do projeto** (README, `docs/`)
   além das próprias entradas do diário, de forma incremental e hash-idempotente.
7. **G7 — Captura automática: o entregável nomeado no título da fase.** Decisões, erros, soluções,
   checkpoints, mensagens e tool calls relevantes são registrados **sem exigir uma chamada manual de
   `journal add` para cada evento** — o próprio plano nomeia isto "requisito prioritário" (§4.10,
   "Integração automática") e nota que o loop nativo atual não o tem. *Grounding:* §9 questão 3 (mecanismo).
8. **G8 — Nenhum segredo bruto persiste no diário**, manual ou automaticamente, antes de tocar qualquer
   meio de persistência — reusando `redactSecrets` (`@conductor/runtime`), nunca uma segunda implementação
   paralela. *Grounding:* §8.4.
9. **G9 — Proveniência verificável em toda entrada.** Quem (autor/kind), quando (timestamp), onde
   (branch/sha/repo quando resolvível) — nunca uma entrada sem essa origem, mesmo quando parte da
   proveniência não resolve (nesse caso, o campo ausente é omitido, nunca inventado). *Grounding:* §8.3.
10. **G10 — Uma correção é sempre um novo registro; o diário nunca é mutado nem apagado in-place.**
    Corrigir/retirar/invalidar uma entrada anterior aponta para ela (`supersedes`), nunca a sobrescreve —
    e uma entrada superseded para de contar como conhecimento CORRENTE em `recall`/`search`, mas permanece
    legível como histórico em `log`/`digest`/export. *Grounding:* §8.2.
11. **G11 — Memória temporal: recência pondera, nunca decide sozinha.** Uma entrada mais antiga ainda pode
    ser a resposta certa quando é a mais relevante — recência é um fator de ranking, não um filtro absoluto
    que descarta o passado. *Grounding:* §8.7.
12. **G12 — O diário é o produtor real do `EvidenceRef{kind:"journal-entry"}` que a Fase 4 já espera.**
    Um id de entrada gerado por este mecanismo é resolvível pela Fase 4 (`resolveEvidenceRef`) como Tier-1,
    runtime-derived — fechando o SEAM já declarado em `gate-evidence.ts` (achado central desta sessão,
    ver cabeçalho) sem reabrir a forma do tipo `EvidenceRef` em si.

---

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Memória distribuída/remota** (Honcho ou qualquer backend de "dialectic reasoning" hospedado) | O plano modela isso como um backend **opt-in** no conductor-main (`local` default). A mesma lógica já aplicada à Library na Fase 5 (motor local por causa do hardware fraco do usuário, decisão de sessão anterior citada naquela spec) se estende aqui: o Diary funciona 100% local primeiro; um backend remoto é aditivo. **Não confirmado formalmente para o Diary especificamente antes desta spec** — ver §9 questão 4. | Gate 4 (se aceito como opt-in futuro) |
| **Promoção de padrão cross-project** (`patterns` — erro+solução recorrente virando conhecimento reutilizável entre projetos) | Não é um dos 5 entregáveis literais do plano (`add`/`recall`/`search`/`digest`/`ingest`, linhas 1390-1396). É uma capability **separada** no conductor-main (`~/.conductor/patterns.jsonl`, fora do diretório do projeto), com sua própria superfície (`cmd_patterns`) nunca nomeada no critério de saída desta fase. | Não nomeado — extensão futura, se decidida |
| **Reconstruir a persistência de sessão inteira** (tool calls, mensagens completas, árvore fork/branch) | Já resolvido pelo próprio `pi` (`Agent`/`AgentSession` + `SessionManager` JSONL, confirmado em ADR 0001 §1.2/§2.1 — "fork/branch/resume + checkpoints por compaction são suficientes"). O Diary é uma camada **curada** por cima desse stream (decisões/erros/soluções/checkpoints), nunca uma segunda cópia da sessão bruta inteira. | Já entregue (fundação do `pi`) |
| **Grafo de entidades e relações + reciprocal-rank fusion completos** | O plano (§4.10, "Estratégia de recuperação") lista vetorial+lexical+fatos estruturados+contexto temporal+**grafo de entidades e relações**+RRF como a estratégia de recuperação desejada a longo prazo. Os 5 entregáveis literais e o critério de saída desta fase cobrem vetorial+lexical+contexto temporal (G3/G4/G11); um grafo de entidades é uma capability adicional que nenhuma dessas 6 linhas exige para o critério de saída ser satisfeito. | Não nomeado — extensão futura |
| **Reimplementar redação de segredos** | `redactSecrets` (`@conductor/runtime/redaction.ts`) já existe, é genérico, e já é o padrão de todo sink deste monorepo (`audit-trail.ts`, `grounding-ledger.ts`-adjacentes). Reimplementar seria o mesmo erro que este próprio monorepo já evitou nas Fases 2-5. | Já entregue (Fase 2) |
| **Motor físico de busca do Diary** (reusar o SQLite+FTS5 da Library, um schema/banco próprio, ou algo híbrido) | Comportamento observável (G3/G4/G11), não arquitetura — e já sinalizado pelo orquestrador como uma questão real: a Library é conhecimento estático GLOBAL (D9, Fase 5); o Diary é dinâmico POR-PROJETO e sujeito a correção/supersessão (G10) — misturar os dois motores/tabelas repetiria exatamente o risco que a Fase 5 já evitou deliberadamente entre corpus (global) e code-index (nunca global, "T51 cross-project leakage"). | Gate 4 |
| **Mecanismo exato de captura automática** (qual hook do `pi` — `turn_end`, `message_end`, `agent_settled`, `session_shutdown` — ou uma combinação; via `session.subscribe` ou via extension lifecycle hooks) | Comportamento observável definido (Grupo F); qual hook(s) alimenta(m) a captura é uma decisão de arquitetura sobre uma superfície que o `pi` já expõe (ADR 0001) — mas nunca antes consumida por este monorepo para este fim. | Gate 4 |
| **Extensão do enum `kind` para cobrir literalmente "risco/aprovação/hipótese/aprendizado"** (linguagem do plano §4.10) | A Fase 4 já modela `Risk`/`Approval` como tipos ESTRUTURADOS dentro de `GateState` (não como um `kind` de texto livre em um log). Se o Diary deve DUPLICAR esses fatos como seu próprio `kind`, ou apenas referenciá-los/espelhá-los, é uma decisão com risco real de duas fontes de verdade divergentes para o mesmo fato — não resolvida aqui. | Gate 4 |
| **UI/TUI de memória** (navegar entradas do diário visualmente, histórico de consultas) | Mesmo padrão já registrado nas specs das Fases 4/5: depende de dados que só existem a partir desta fase; cresce organicamente. | Não nomeado, cresce organicamente |

---

## 4. Glossário (linguagem ubíqua)

*Grounding:* **Domain-Driven Design — Complete Professional Guide §1.1/§1.12** (já citado nas duas specs
anteriores desta série) — um vocabulário único evita que "Sessão", "Diário" e "Biblioteca" colidam
silenciosamente, já que o plano (§4.9/§4.10) os trata como três camadas de memória adjacentes, mas distintas.

| Termo | Definição | Fonte |
|---|---|---|
| **Sessão (Session)** | A conversa completa entre o usuário/agente e o modelo — mensagens, tool calls, resultados — persistida pelo próprio `pi` (`Agent`/`AgentSession` + `SessionManager` JSONL). **Não** é o Diary: é a matéria-prima da qual a captura automática (G7) deriva entradas curadas. | ADR 0001 §1.2/§2.1; plano §4.9 |
| **Diário (Diary)** | Conhecimento **dinâmico** do projeto: decisões, erros, soluções, checkpoints, riscos, aprovações, hipóteses, aprendizados, contexto temporal — persistido como um log local append-only, distinto e mais curado do que a Sessão bruta. | plano §4.10 ("Diary: conhecimento dinâmico"); glossário desta spec |
| **Biblioteca (Library)** | (Herdada da Fase 5, não redefinida aqui.) Conhecimento **estático** e global — livros, padrões, guias. Onde este documento diz "Diary", nunca quer dizer "Library". | `gate2-spec-fase5.md` §4; plano §4.10 |
| **Entrada (Entry)** | Um registro individual do Diário — texto, `kind`, gate opcional, sessão, timestamp, proveniência, id gerado pelo runtime. A unidade que `journal add`/a captura automática produzem. | `journal.py`'s formato de entrada (referência de comportamento) |
| **`kind`** | O vocabulário fechado que classifica uma entrada: `reasoning`\|`decision`\|`plan`\|`error`\|`solution`\|`checkpoint` (herdado do `CLAUDE.md`/`journal.py` deste próprio repositório-pai — ver §9 questão 5 sobre se cresce). Um valor fora deste conjunto é recusado (BR-7). | `CLAUDE.md` (conductor-main), `journal.py:KINDS` |
| **Mirror (espelho)** | A representação legível em Markdown do Diário (ou de uma fatia dele) — derivada, nunca uma segunda fonte de verdade (G1/G5). Distinto de "log" (o append-only, a fonte real). | `journal.py:_render_digest`/`cmd_digest` (comportamento de referência) |
| **Digest** | Um resumo Markdown de um período/sessão, agrupado por `kind`, gerado por `journal digest` — pura derivação de G1, regenerável sem perda. | plano (entregável `conductor journal digest`) |
| **Recall (semântico)** | Responder uma pergunta em linguagem natural com entradas relevantes por significado — nunca por substring exata — cada uma carregando origem e data. | plano, linha 1400 (o critério de saída literal) |
| **Search (estruturado)** | Um lookup filtrado por `kind`/`gate`/sessão/data/texto exato — distinto de "recall" por ser uma consulta ESTRUTURADA, não uma pergunta aberta. (Hipótese de trabalho desta spec, §9 questão 1.) | plano (entregável `conductor journal search`, nomeado separadamente de `recall`) |
| **Ingest (de documentos)** | Indexar documentos do projeto (README, `docs/`) para que `recall`/`search` também os alcancem — hash-idempotente, distinto de uma entrada de diário (rotulado como documento, nunca confundido com uma decisão). | `journal.py:cmd_ingest`/`_iter_ingestable` (comportamento de referência) |
| **Captura automática (automatic capture)** | O mecanismo pelo qual uma entrada é produzida a partir de um evento da sessão (uma resposta do agente, um tool call relevante, uma conclusão de gate) **sem** uma chamada manual de `journal add` — o entregável nomeado no título da fase (G7). | plano §4.10 ("Integração automática... requisito prioritário") |
| **Correção (via `supersedes`)** | Um novo registro que aponta para uma entrada anterior (`supersedes: <id>`) para atualizá-la, retirá-la, ou invalidá-la — nunca uma mutação/exclusão in-place (G10). | `journal.py:edit_entry`/`EDIT_MODES` (comportamento de referência) |
| **Conhecimento corrente vs. histórico** | Uma entrada superseded deixa de contar como conhecimento CORRENTE em `recall`/`search` (BR-5), mas permanece legível no histórico bruto (`log`/`digest`/export) — a mesma distinção que `journal.py:active_entries` (filtra) vs. `_read_mirror` (não filtra) já fazem. | `journal.py:active_entries` |
| **Proveniência (provenance)** | Quem/quando/onde uma entrada foi gravada — autor, timestamp ISO, e branch/sha/repo git quando resolvíveis (nunca inventados quando não resolvem). | plano §10 invariante 19; `journal.py:_stamp_provenance` |
| **`EvidenceRef{kind:"journal-entry"}`** | (Herdado da Fase 4, não redefinido aqui.) Uma referência Tier-1, runtime-derived, a uma entrada do Diário — só conta como evidência suficiente para um gate obrigatório quando o id foi genuinamente registrado pelo runtime (nunca um id digitado à mão que apenas parece plausível). Esta fase é o produtor real que faltava (G12). | `gate-evidence.ts` (Fase 4) |

---

## 5. Requisitos funcionais (FR)

*Grounding para Given/When/Then:* **Specification by Example — Complete Professional Guide §2.12/§2.13**
(mesma base já usada nas duas specs anteriores desta série) — vocabulário que se repete por todo este grupo,
resultado nomeável.

### Grupo A — Captura manual e identidade da entrada (`journal add`) — G2/G9/G12

**FR-1 — `journal add` grava uma entrada completa.**
> Given um projeto enrolado com o Diary inicializável,
> When alguém roda `conductor journal add --kind decision --gate 4 "escolhida arquitetura hexagonal"`,
> Then uma entrada é persistida com: o texto, `kind="decision"`, `gate=4`, uma sessão, um timestamp
> ISO-8601, e branch/sha/repo git quando resolvíveis — nunca uma entrada com algum desses campos ausente
> sem uma razão (proveniência não resolvida é o único caso legítimo de omissão, ver FR-3/BR-3).

**FR-2 — `journal add` recusa um `kind` fora do vocabulário fechado.**
> Given o vocabulário fechado de `kind` (`reasoning`\|`decision`\|`plan`\|`error`\|`solution`\|`checkpoint`),
> When alguém roda `conductor journal add --kind "observação-solta" "..."`,
> Then o comando recusa explicitamente, nomeando os valores válidos — nunca aceita um `kind` desconhecido
> como texto livre disfarçado de categoria (BR-7).

**FR-3 — Proveniência ausente é omitida, nunca inventada.**
> Given um ambiente onde a resolução de git falha para UM campo específico (ex.: HEAD destacado — `sha`
> resolve mas `branch` não),
> When uma entrada é gravada,
> Then o campo que não resolveu é omitido da entrada — nunca um valor inventado (`"unknown"`,
> string vazia tratada como branch real) — e os campos que RESOLVERAM (aqui, `sha`) são gravados
> normalmente; uma falha de resolução nunca impede a escrita da entrada em si.

**FR-4 — Todo id de entrada é gerado pelo runtime, nunca aceito como valor digitado pelo autor.**
> Given uma entrada sendo gravada (manual ou automaticamente),
> When o runtime atribui seu id,
> Then esse id é gerado NELE MESMO (nunca lido de um `--id` fornecido pelo chamador) — a mesma golden rule
> R25 já estabelecida na Fase 4 ("apenas um id que o RUNTIME registrou conta como Tier-1 runtime-derived")
> aplicada aqui à sua própria origem: é esse id que precisa ser resolvível depois como
> `EvidenceRef{kind:"journal-entry"}` (G12).

### Grupo B — Recall semântico e memória temporal (`journal recall`) — G3/G11

**FR-5 — `journal recall` responde por significado, com origem e data.**
> Given um diário com uma entrada `decision` gravada numa sessão anterior,
> When alguém roda `conductor journal recall "por que escolhemos essa arquitetura?"` numa sessão
> **diferente**,
> Then a resposta inclui a entrada relevante (mesmo que a pergunta não repita as palavras exatas do texto
> original), anotada com sua origem (sessão/gate/autor) e data — o critério de saída literal do plano
> (linha 1400), restated como comportamento verificável.

**FR-6 — Nenhuma entrada relevante encontrada → resposta explícita, nunca inventada.**
> Given uma pergunta fora do que qualquer entrada cobre,
> When `journal recall` roda,
> Then a saída diz explicitamente que nenhuma memória correspondente foi encontrada — nunca força as
> entradas mais parecidas (porém irrelevantes) como se fossem uma resposta útil (mesma disciplina de FR-5
> da Fase 5 para a Library, aplicada aqui ao Diary).

**FR-7 — Recência pondera o ranking, nunca decide sozinha.**
> Given duas entradas relevantes para a mesma pergunta, uma recente e superficial, outra antiga e mais
> completa/definitiva,
> When `journal recall` rankeia os resultados,
> Then a entrada mais RELEVANTE pode aparecer primeiro mesmo sendo mais antiga — recência é um fator de
> composição do ranking (um prior), nunca um filtro que descarta ou sempre vence sobre relevância
> (G11). *Grounding:* §8.7.

### Grupo C — Busca estruturada (`journal search`) — G4

**FR-8 — `journal search` filtra por facets exatos.**
> Given um diário com entradas de múltiplos `kind`s, gates e sessões,
> When alguém roda `conductor journal search --kind error,solution --gate 6`,
> Then apenas entradas que casam TODOS os filtros pedidos aparecem — comportamento de lookup estruturado,
> distinto de "responda uma pergunta aberta" (Grupo B).

**FR-9 — Um filtro com valor não reconhecido é reportado explicitamente.**
> Given um `--kind` com um valor fora do vocabulário fechado, ou um `--gate` fora de 1-14,
> When `journal search` roda,
> Then o comando recusa nomeando o valor inválido e os valores aceitos — nunca trata um filtro não
> reconhecido como "sem filtro" (mesma BR-8 já estabelecida na Fase 5 para a Library, aplicada aqui).

### Grupo D — Digest (`journal digest`) — G5

**FR-10 — `journal digest` gera um resumo Markdown puro e agrupado por `kind`.**
> Given uma sessão com entradas de kinds variados,
> When alguém roda `conductor journal digest`,
> Then um arquivo Markdown é gerado, agrupando as entradas por `kind` (decisões primeiro, seguidas de
> soluções/planos/erros/reasoning — ordem legível para humano), cada uma anotada com gate/autor quando
> presente — derivação pura de G1, nunca uma escrita que também altera o log de origem.

**FR-11 — Regenerar um digest é determinístico.**
> Given o mesmo conjunto de entradas já gravado (nenhuma mudança no log de origem),
> When `journal digest` roda duas vezes seguidas,
> Then o Markdown gerado é byte-idêntico nas duas execuções — nunca uma segunda fonte de verdade que
> diverge silenciosamente do log.

### Grupo E — Ingest de documentos (`journal ingest`) — G6

**FR-12 — `journal ingest` estende recall/search a documentos do projeto.**
> Given um `README.md` e um `docs/architecture.md` no projeto,
> When alguém roda `conductor journal ingest`,
> Then o conteúdo desses arquivos passa a ser alcançável por `recall`/`search`, rotulado explicitamente
> como **documento** — nunca confundido com uma entrada de diário (decisão/erro/solução) na saída.

**FR-13 — Ingestão é hash-idempotente.**
> Given um corpus de documentos já ingerido e um único arquivo alterado desde a última ingestão,
> When `journal ingest` roda de novo,
> Then apenas o conteúdo novo/alterado é reprocessado — o restante, inalterado, não é retocado (mesma
> BR-9 já estabelecida na Fase 5 para `library ingest`, aplicada aqui).

### Grupo F — Captura automática (o entregável nomeado no título da fase) — G7

**FR-14 — Uma decisão/erro/solução/checkpoint que ocorre durante uma sessão é capturado sem uma chamada
manual de `journal add` por evento.**
> Given uma sessão em andamento onde o agente conclui um gate, registra um erro e sua correção,
> When a sessão progride normalmente (sem que o usuário/agente rode `journal add` para cada um desses
> momentos),
> Then entradas correspondentes aparecem no diário de qualquer forma — a captura automática observou o
> evento e registrou por conta própria (G7, o "requisito prioritário" do plano §4.10).

**FR-15 — Um tool call relevante é capturado, rotulado distintamente de uma resposta em prosa.**
> Given uma sessão onde o agente executa uma escrita de arquivo, um comando, ou delega a um subagente,
> When a captura automática observa essa ação,
> Then um registro de "ação" é gravado, rotulado distintamente de um registro de "resposta" — nunca
> fundidos de forma indistinguível na mesma entrada.

**FR-16 — A captura automática nunca bloqueia nem adiciona latência perceptível ao turno em andamento.**
> Given a captura automática de um evento em curso,
> When o registro é produzido,
> Then a escrita local (o mirror) acontece de forma síncrona e rápida (best-effort local), e qualquer
> sincronização com um backend adicional (se algum dia configurado, ver §3 non-goal) acontece de forma
> assíncrona/desacoplada — o turno do usuário nunca espera por essa sincronização. *Prior art do projeto,
> não citação de livro* — ver §8.8.

**FR-17 — A captura automática respeita a separação de sessões de subagentes já decidida.**
> Given uma sessão principal que delega a um subagente (com sua própria sessão, já separada por decisão
> anterior — §4.9),
> When a captura automática observa eventos de ambas,
> Then os registros do subagente são rotulados distintamente (nunca misturados sem rótulo na sessão do
> orquestrador) — esta fase NÃO reabre a decisão de separação de sessões, apenas a respeita.

**FR-18 — A captura automática é limitada, nunca cresce sem controle.**
> Given uma sessão longa que gera muitos eventos capturáveis,
> When o log de captura ultrapassa um limite configurado,
> Then as entradas mais antigas são podadas do log de CAPTURA bruta (nunca do diário curado já promovido
> a entrada formal) — o mecanismo exato do limite é Gate 4, mas a propriedade observável ("nunca cresce
> sem limite") é exigida aqui.

### Grupo G — Redação (nunca reimplementada) — G8

**FR-19 — Nenhum segredo bruto persiste, manual ou automaticamente.**
> Given um texto de entrada (manual, via `journal add`, ou automático, via captura) que contém algo que
> casa um padrão de segredo (ex. um token de API),
> When a entrada é gravada,
> Then o texto persistido já está redigido ANTES de tocar o disco local ou qualquer sincronização futura —
> nunca um segredo bruto que existe "só até o próximo passo redigir".

**FR-20 — A redação usa `redactSecrets` (`@conductor/runtime`), nunca uma segunda implementação.**
> Given o texto de uma entrada a ser persistida,
> When a redação é aplicada,
> Then é feita através de `redactSecrets` (o mesmo mecanismo já usado por `audit-trail.ts`) — nunca um
> detector de segredo próprio e paralelo do Diary (G8).

### Grupo H — Persistência, mirror e correção (append-only) — G1/G10

**FR-21 — O diário é persistido em um mirror local append-only, versionado desde a primeira escrita.**
> Given uma entrada sendo gravada pela primeira vez neste projeto,
> When o arquivo é escrito em disco,
> Then ele carrega um campo de versão de schema — mesmo padrão já em uso no projeto para
> `GateStateEnvelope`/`.cdt/config.json` ("retrofitting a version onto a format already in the wild is
> guesswork; stamp it from the first write") — nunca um formato sem versão.

**FR-22 — O diário também é legível como Markdown — nunca apenas um formato opaco.**
> Given um diário com entradas gravadas,
> When alguém quer ler o histórico sem ferramentas especiais,
> Then existe uma representação Markdown (mirror/digest) gerável a qualquer momento — nunca só um JSONL
> que exige uma ferramenta própria para ser lido por um humano.

**FR-23 — Corrigir uma entrada anterior nunca apaga nem sobrescreve a original.**
> Given uma entrada já gravada cujo texto precisa ser corrigido/retirado/invalidado,
> When a correção é registrada,
> Then um NOVO registro é escrito, apontando (`supersedes`) para o original — o original permanece
> exatamente como foi escrito, para sempre, no log bruto (G10).

**FR-24 — Uma entrada superseded deixa de contar como conhecimento corrente, mas permanece no histórico.**
> Given uma entrada corrigida (superseded) por FR-23,
> When `journal recall`/`search` consultam o diário,
> Then a entrada superseded NÃO aparece mais como resposta corrente (a correção "vence"); quando
> `journal log`/`digest`/uma futura exportação leem o mesmo diário, AMBAS (original + correção) aparecem,
> em ordem, como histórico completo — a mesma distinção "conhecimento atual vs. histórico bruto" (G10,
> glossário §4).

### Grupo I — Interoperação com a Fase 4 (o achado central desta sessão) — G12

**FR-25 — Um id de entrada do diário é resolvível como `EvidenceRef{kind:"journal-entry"}` Tier-1.**
> Given uma entrada gravada por este mecanismo (manual ou automática), com um id gerado pelo runtime
> (FR-4),
> When a Fase 4 (`resolveEvidenceRef`) tenta resolver um `--ref journal-entry:<id>` contra
> `runtimeRecordedJournalEntryIds`,
> Then esse id RESOLVE (estava genuinamente no conjunto que o runtime registrou) — fechando o SEAM já
> declarado em `gate-evidence.ts` sem exigir uma segunda mudança na FORMA do tipo `EvidenceRef` (que
> permanece exatamente como a Fase 4 o travou). O PONTO exato de integração (quem preenche
> `runtimeRecordedJournalEntryIds` a partir do diário, e quando) é Gate 4 — esta spec só exige que o id
> seja, de fato, resolvível.

---

## 6. Business rules

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | Uma entrada de diário é imutável uma vez escrita — correção é sempre um NOVO registro (append-only); nunca mutação/exclusão in-place. | Plano §10 invariante 13 ("sessões são append-only"); Context Engineering §6.4 (§8.2) | FR-23, FR-24 |
| **BR-2** | Nenhum segredo bruto persiste em uma entrada — a redação acontece ANTES de tocar qualquer meio de persistência ou sincronização, no ponto único onde o texto é primeiro gravado (manual ou automático) — nunca um chamador upstream presumido como já tendo redigido. | Plano §10 invariante 9; OWASP ASVS 4.0.3 V6.4 (§8.4); `audit-trail.ts` ("cada sink redige independentemente") | FR-19, FR-20 |
| **BR-3** | Toda entrada carrega proveniência verificável (quem, quando, e branch/sha/repo quando resolvível) — nunca uma alegação sem origem; quando uma parte da proveniência não resolve, o campo é OMITIDO, nunca inventado, e a escrita da entrada em si nunca falha por causa disso. | Plano §10 invariante 19; `journal.py:_stamp_provenance` (cada campo falha independentemente, "must never fail the journal write itself") | FR-1, FR-3 |
| **BR-4** | O log local (JSONL) é a fonte de verdade; qualquer índice de busca (semântico ou lexical) é uma VIEW derivada, reconstruível a partir do log — nunca a única cópia de um fato. | Designing Data-Intensive Systems §10.4/§10.5/§10.13 (§8.1) | G1, FR-21, todo o Grupo B/C (o índice que os serve) |
| **BR-5** | Uma entrada superseded por uma correção deixa de contar como conhecimento CORRENTE em `recall`/`search`, mas nunca desaparece do histórico bruto (`log`/`digest`/export). | Context Engineering §6.4 "Staleness without supersession" (§8.2); `journal.py:active_entries` vs. `_read_mirror` | FR-24 |
| **BR-6** | A captura automática nunca bloqueia nem adiciona latência perceptível ao turno em andamento — a escrita local síncrona acontece primeiro (best-effort), qualquer sincronização remota é assíncrona/desacoplada. | Prior art do projeto — `journal.py:record_event`'s próprio docstring (mede ~8,7s de round-trip Honcho; "must not pay a multi-second synchronous tax"); `audit-trail.ts` ("pre-write, not best-effort-after"). **A biblioteca não cobre especificamente** este mecanismo (melhor resultado 0.594, fora do alvo) — declarado, não forçado (§8.8). | FR-16 |
| **BR-7** | Um `kind` de entrada pertence a um vocabulário FECHADO — um valor desconhecido é recusado explicitamente, nunca aceito como texto livre disfarçado de categoria. | Mesma disciplina já estabelecida na Fase 5 (Managing Software Complexity §3.12, "When not to hide information or define an error away"), aplicada aqui ao `kind` do diário | FR-2, FR-9 |
| **BR-8** | Um id de entrada é gerado pelo RUNTIME no momento da escrita — nunca aceito como um valor digitado pelo autor — porque é exatamente esse id que a Fase 4 (`EvidenceRef.journal-entry`) precisa poder resolver como Tier-1 runtime-derived (a mesma golden rule R25 já estabelecida: "apenas um id que o RUNTIME registrou conta"). | `gate-evidence.ts` (Fase 4, já no código) — precedente direto deste monorepo, não um livro | FR-4, FR-25 |
| **BR-9** | Ingestão de documentos (`README`/`docs/`) é hash-idempotente — uma atualização de rotina nunca reprocessa conteúdo inalterado. | Mesma BR-9 já estabelecida na Fase 5 para `library ingest` (Context Engineering §14.1), aplicada aqui ao `journal ingest` | FR-13 |
| **BR-10** | Recência é um fator de PONDERAÇÃO no ranking, nunca um veredito absoluto — uma entrada antiga pode continuar sendo a resposta certa quando é a mais relevante. | Context Engineering §10.3 "Recency: Weighting Time Without Worshipping It" (§8.7) | FR-7 |

---

## 7. Edge cases

1. **Diário nunca escrito ainda** (`recall`/`search`/`digest`/`log` num projeto novo). Resposta explícita
   ("nenhuma entrada ainda, rode `journal add` ou aguarde a captura automática"), nunca um erro genérico nem
   uma tabela vazia sem explicação (mesmo padrão já estabelecido na Fase 5 para um corpus vazio).
2. **Mirror JSONL com uma linha corrompida no meio do arquivo.** A linha malformada é pulada; as entradas
   antes e depois dela continuam legíveis normalmente — uma linha corrompida é dado ruim, não um motivo para
   derrubar a leitura inteira (mesmo padrão `journal.py:_read_mirror`: "skipped, not raised" — um JSON
   sintaticamente válido mas que não é um objeto também é tratado como dado malformado, nunca lança).
3. **`recall` sem nenhuma entrada relevante acima do threshold de relevância.** Resposta explícita de
   "nenhuma memória correspondente" (FR-6) — nunca força as entradas mais parecidas, porém irrelevantes,
   como se fossem uma resposta útil.
4. **Duas sessões concorrentes escrevendo no diário ao mesmo tempo.** Nenhuma entrada é perdida — a mesma
   classe de garantia que `gate-state-store.ts` (lock+CAS) e `grounding-ledger.ts` (append síncrono) já
   entregam em domínios irmãos deste mesmo monorepo. O MECANISMO exato (um arquivo por sessão, como o
   conductor-main já faz por design — colisão só ocorre se duas sessões do MESMO dia reusarem o mesmo id de
   sessão — ou um lock explícito compartilhado) é Gate 4 (§9 questão 7); a propriedade observável ("nenhuma
   entrada perdida") é exigida aqui.
5. **A redação falha** (o padrão de segredo não é reconhecido por engano, ou o redator lança uma exceção
   inesperada). A entrada NUNCA é persistida sem passar pela redação — falha FECHADA (recusa a escrita, não
   grava texto não redigido "só desta vez") — mesma direção já estabelecida nas specs anteriores desta série
   para I/O incerto (Security Engineering Principles §2.2/§2.9, §8.5).
6. **Correção de um id que não existe.** Recusada explicitamente, nunca cria uma referência pendurada
   (`supersedes` apontando para nada) — mesmo padrão `journal.py:edit_entry`'s `KeyError` (comportamento de
   referência).
7. **Captura automática de um tool call cujo conteúdo JÁ foi redigido por um sink anterior** (ex.:
   `audit-trail.ts` já redigiu o mesmo comando bash). A redação da captura automática é IDEMPOTENTE sobre
   texto já redigido — um placeholder `[REDACTED:label]` não é, ele mesmo, "secret-shaped", então não é
   duplamente processado nem corrompido (mesma disciplina que `audit-trail.ts`'s próprio comentário já
   documenta: "idempotent against an already-redacted string").
8. **`journal ingest` encontra um arquivo que o SO não consegue ler** (permissão negada, etc.). Um aviso
   claro é emitido, nomeando o arquivo; os demais arquivos continuam sendo processados normalmente — um
   arquivo ilegível nunca aborta a ingestão inteira (mesmo padrão `journal.py:_read_md`'s tratamento de
   `OSError`).
9. **Um backend remoto (se algum dia configurado, non-goal desta fase) fica fora do ar durante a captura
   automática.** A escrita local (mirror) continua funcionando normalmente; a sincronização pendente fica
   para a próxima tentativa — nunca bloqueia nem descarta a observação já gravada localmente (mesmo padrão
   `journal.py:record_event`'s "neither backend's `add` raises... background daemon thread").

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate <N>` (backend
saudável).

1. **Append-only event log como fonte de verdade, índice como view derivada** → **Designing Data-Intensive
   Systems — Complete Professional Guide §10.4 "Architecture: derived state from an event log"** (top
   **0.659**: diagrama `source: append-only event log → stream processor → search index / cache / aggregates`,
   "re-run from the log to..."), **§10.5** ("Make the order event log the source of truth and the search index
   a derived view. Fix the indexing code and reprocess the log to rebuild the index"), **§10.12** ("Log-as-truth
   is the right design... where reprocessing an immutable input beats an in-place migration nobody can
   verify") — base direta de G1/BR-4/FR-21: o mesmo argumento se aplica ponto a ponto ao diário (o JSONL local
   é o log; um futuro índice semântico/lexical, se construído, é reconstruível a partir dele, nunca a única
   cópia).
2. **Correção sem sobrescrita; conhecimento corrente vs. histórico** → **Context Engineering — Designing
   Information Environments for LLM Systems §6.4 "Vector Memories: Retrieval Turned Inward"** (top **0.636**/
   **0.602** nas duas rodadas desta sessão: "Staleness without supersession. Documents in a knowledge base get
   re-published; memories accrete... similarity search has no concept of..." [supersessão]) — base direta de
   G10/BR-1/BR-5/FR-23/FR-24. Eco secundário em **Dimensional Modeling for Analytics — Complete Professional
   Guide §3.10 "Anti-patterns: slowly changing dimensions"** (0.578: "Overwriting (Type 1) an attribute whose
   history the business reports on — silently falsifying the past... needs Type 2 history") — o mesmo
   princípio (nunca sobrescrever um fato histórico) de um domínio irmão (modelagem dimensional), reforçando
   sem duplicar a citação primária.
3. **Proveniência como "passaporte" de todo registro** → **Context Engineering §10.2 "Provenance: Every Chunk
   Carries Its Passport"** (top **0.613**: "provenance... source document and section... ingestion and
   last-modified timestamps, authority tier" — "The payoff structure is asymmetric: provenance is invisible
   while everything works, and it is the *entire* investigation when something doesn't") — base direta de
   G9/BR-3, e do próprio critério de saída literal do plano ("com origem e data").
4. **Nenhum segredo em log/audit trail** → **OWASP ASVS 4.0.3 — V6.4 Secret Management** (top **0.579**:
   "Logging sensitive information is dangerous... Ensure only necessary information is kept in logs, and
   certainly no payment, credentials (including session tokens), sensitive or personally identifiable [data]")
   — base direta de G8/BR-2/FR-19/FR-20, e a mesma seção que `journal.py:_redact_text`'s próprio docstring já
   cita no conductor-main (confirmando que este documento não está inventando o requisito, apenas
   restatando-o como comportamento testável do produto pi).
5. **Recall por significado, não substring** → **Specification by Example — Complete Professional Guide
   §2.12/§2.13** (mesma base já usada nas duas specs anteriores desta série) — base de todo o §5 (Given/When/
   Then); e **Security Engineering Principles — Complete Professional Guide §2.2/§2.9/§2.12** (top **0.624**/
   **0.597**: "Errors/uncertainty deny access (fail closed)") — base do edge case 5 (redação falha → recusa a
   escrita, mesma direção já estabelecida nas duas specs anteriores para I/O incerto).
6. **Digest como resumo derivado, mirror como texto plano legível** → **Context Engineering §5.3
   "Hierarchical Summarization: Compressing at Multiple Resolutions"** (top **0.631**: "compress at multiple
   resolutions ahead of time and let the consumer choose its altitude") e **§6.3 "Memory Files: The
   Unreasonable Effectiveness of a Text File"** (0.600: "The simplest long-term memory that actually works is a
   curated plain-text file... `CLAUDE.md`-style project files are the canonical example") — base direta de
   G5/FR-10/FR-22: o próprio `CLAUDE.md` que rege esta demanda é citado pelo livro como o exemplo canônico do
   padrão que o mirror do Diário implementa.
7. **Recência como prior, não veredito** → **Context Engineering §10.3 "Recency: Weighting Time Without
   Worshipping It"** (top **0.621**/**0.612** nas duas rodadas: "Recency is a *prior*, not a verdict — the
   newest document touching a topic is frequently a half-baked draft... and 'latest wins' elevates exactly
   those over the settled canonical text") — base direta de G11/BR-10/FR-7, o objetivo explícito "adicionar
   memória temporal" do plano.
8. **Captura automática best-effort, sem bloquear o caminho quente** → cobertura **fraca/fora do alvo** na
   biblioteca (melhor resultado desta sessão: Writing Maintainable Code §1.12, top 0.594, sobre legibilidade
   de código — não sobre o mecanismo assíncrono em si). **A biblioteca não cobre isso especificamente** —
   declarado, não forçado. FR-16/BR-6 são fundamentados no comportamento já medido e documentado no próprio
   `journal.py:record_event` deste repositório-pai (~8,7s de round-trip Honcho, "must not pay a multi-second
   synchronous tax") e no padrão já estabelecido em `audit-trail.ts` ("pre-write, not best-effort-after") —
   prior art do projeto, não citação de livro. Da mesma forma, o MECANISMO exato de captura automática via
   hooks do `pi` (qual hook, `turn_end` vs. `agent_settled` vs. outro) não tem cobertura na biblioteca por ser
   uma pergunta sobre a API específica de um framework (`pi`), não uma prática geral — fundamentado em
   `docs/adr/0001-adopt-pi-as-runtime.md`/`docs/conductor/_recon-pi-architecture.md`, prior art deste próprio
   monorepo.

---

## 9. Questões abertas para o Gate 3 (ameaças) e Gate 4 (arquitetura)

Registradas aqui porque nasceram durante a especificação, mas **não são decisões desta BA** — são insumo,
não resposta.

1. **`journal search` vs. `journal recall`: mesmo verbo com dois nomes, ou dois modos de recuperação
   distintos?** A referência de comportamento (`conductor-main/journal.py`) só tem UM verbo, `recall`
   (tenta um backend semântico primeiro, cai para varredura local por palavra-chave) mais um `log` (dump
   filtrado bruto, nunca semântico) — **nenhum comando ali se chama literalmente `search`**. O plano do pi,
   porém, nomeia os dois (`journal recall` e `journal search`) como entregáveis SEPARADOS (linhas 1392-1393).
   Esta spec assumiu, como hipótese de trabalho (Grupo B = pergunta em linguagem natural com síntese; Grupo C
   = lookup estruturado por facets, mais perto do `log` do conductor-main do que do `recall`), mas isso não
   está decidido — o risco de errar é entregar dois comandos que fazem essencialmente a mesma coisa com
   nomes diferentes, ou um comando faltando uma capability real. Gate 4.
2. **Reusar o motor `@conductor/library` (SQLite+FTS5, Fase 5) para a busca do Diary, ou um schema/motor
   próprio?** Já sinalizado pelo orquestrador como questão aberta. A Library é conhecimento ESTÁTICO e
   GLOBAL (D9); o Diary é DINÂMICO e POR-PROJETO, sujeito a correção/supersessão (G10) — misturar os dois no
   MESMO banco/tabela repetiria o risco que a Fase 5 já evitou deliberadamente entre corpus (global) e
   code-index (nunca global, "T51 cross-project leakage via uma collection compartilhada"). Um motor
   FISICAMENTE separado, mas com a MESMA tecnologia (SQLite+FTS5, o mesmo padrão de chunking) é uma opção
   intermediária não avaliada aqui. Gate 4.
3. **Mecanismo exato da captura automática.** O `pi` expõe `session.subscribe(listener)` + hooks de ciclo de
   vida genuínos (`turn_start/end`, `message_start/update/end`, `agent_start/end/settled`,
   `session_start/shutdown`) — uma superfície de stream ao vivo mais direta do que o
   `_parse_transcript`/varredura-de-arquivo que o conductor-main usa (só porque o Claude Code não expõe um
   equivalente). Qual hook, ou combinação, alimenta a captura (e como isso convive com o modo `emit` do
   `pi-conductor` para harnesses de terceiros, se algum dia relevante) é Gate 4.
4. **Memória distribuída/remota para o Diary (Honcho ou equivalente) — confirmação formal do non-goal.** A
   decisão "motor local primeiro, por causa do hardware fraco do usuário" foi registrada como memória de
   sessão anterior **aplicada à Diary/Fase 6**, mas nunca formalizada nesta fase especificamente (a spec da
   Fase 5 deixou isso explicitamente em aberto para a Library, não para o Diary). Esta spec assume o
   non-goal (§3) como ponto de partida, mas o ADR formal (se um backend remoto compatível deve existir como
   opt-in futuro, e sob qual configuração) é Gate 4.
5. **O enum `kind` deve crescer para cobrir risco/aprovação/hipótese/aprendizado** (linguagem literal do
   plano §4.10), ou esses fatos continuam vivendo exclusivamente como os tipos `Risk`/`Approval` já
   estruturados em `GateState` (Fase 4), e o Diary apenas os referencia/espelha (nunca duplica)? Risco real
   de duas fontes de verdade divergentes para o mesmo fato se a resposta for "duplicar". Gate 4 (e
   possivelmente reabre uma pequena extensão de tipo, análoga ao precedente já registrado na Fase 5 para
   `groundingCitations`).
6. **Onde o diário fisicamente vive em disco, e se compartilha alguma convenção de path com
   `@conductor/library`.** A Library já usa `~/.conductor/library/projects/<projectId>/...` (por-projeto
   dentro do HOME do usuário, D9). O `GateState` da Fase 4 usa `.conductor/gates/` (dentro do WORKSPACE do
   projeto). O plano (§4.10.1) desenha `.conductor/memory/diary/` (também workspace). Qual convenção o
   Diary segue — e por quê, dado que ele é claramente por-projeto como o code-index da Library, mas talvez
   deva viver DENTRO do repositório (como `GateState`) para acompanhar a branch/commit, e não fora dele
   (como o code-index, que é explicitamente "nunca compartilhado" mas ainda assim vive no HOME) — não é
   decidido aqui. Gate 4.
7. **Mecanismo exato de proteção contra duas sessões concorrentes escrevendo no mesmo arquivo.** Um arquivo
   POR SESSÃO (como `journal.py` já faz — colisão só ocorre se duas sessões do MESMO dia reusarem o mesmo id
   de sessão, o que o formato padrão `<prefix>-<data>` torna plausível) evita a maior parte da concorrência
   por design, mais barato que o lock+CAS que `gate-state-store.ts` usa para um arquivo genuinamente
   compartilhado entre processos. Qual dos dois desenhos (ou algo entre eles) o Diary adota é Gate 4 — o
   requisito observável (edge case 4, "nenhuma entrada perdida") é exigido aqui, o mecanismo não.

---

## Registro no diário

`cdt journal add --gate 2 --kind decision` registrado a partir de `C:\development\source\projects\conductor`
ao final desta sessão, resumindo: 25 FRs em 9 grupos (A-I), 10 business rules, 9 edge cases, e 7 questões em
aberto para o Gate 4 — a mais central sendo `gate-evidence.ts`'s `EvidenceRef{kind:"journal-entry"}` já
existir no código da Fase 4 sem produtor real ("this is the SEAM a future real ledger plugs into"), o que
torna esta fase não uma feature nova, mas o fechamento de uma promessa já feita pelo próprio monorepo — e a
descoberta de que o plano nomeia `journal search` separado de `journal recall` enquanto a referência de
comportamento (`conductor-main/journal.py`) só tem um verbo de recall, não resolvida silenciosamente (questão
aberta 1).
