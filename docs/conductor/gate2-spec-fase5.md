# Gate 2 — Especificação (fonte da verdade): Fase 5 — Library e grounding

**Demanda:** `Fase 5 — Library e grounding` (`plano_desenvolvimento.md` linhas 1351-1375), lida junto com
§4.10 "Memória" (linhas 658-740 — a distinção Diary=dinâmico vs. Library=estático) e §4.11 "RAG e
grounding" (linhas 742-780 — o pipeline de consulta e os requisitos explícitos de filtros/citações/
offline).
**Gates cobertos por este documento:** Gate 1 (descoberta de domínio) + Gate 2 (especificação), ambos
**leves** — calibração "feature" recebida do orquestrador. O domínio já vem dado pelo plano (§4.10/§4.11)
e por uma referência real e madura no mesmo repositório-pai (`conductor-main/conductor/library.py` +
`rag/*.py`), o que reduz a descoberta de domínio a "o que desse comportamento já provado vira requisito
observável desta fase" em vez de inventar do zero. Full nos gates 3,5,7,8 (nunca colapsáveis, `CLAUDE.md`);
profundidade dos demais decidida a partir do Gate 3.
**Papel responsável:** `product-owner` (skill `refine-backlog`), Gate 2 do fluxo Conductor — delegando a
`business-analyst`/`quality-assurance` seria o padrão de outras fases, mas o orquestrador designou o
product-owner diretamente para este documento.
**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/fase5-library-e-grounding` (de
`develop`, já criada).

**Princípio orientador (herdado, não decidido aqui):** o plano separa duas memórias com papéis opostos
(§4.10) — a **Diary** (Fase 6, ainda não construída) é conhecimento **dinâmico** do projeto (decisões,
erros, checkpoints); a **Library** (esta fase) é conhecimento **estático** (livros, padrões, políticas,
guias). Esta spec trata exclusivamente da segunda. Onde este documento referencia "citação" ou "evidência
de grounding", é sempre no sentido Library — nunca um substituto para o que a Fase 6 ainda vai construir.

**Consome (lido integralmente antes de escrever este documento):**
- `plano_desenvolvimento.md` linhas 1351-1375 (Fase 5 em si: objetivos, entregáveis, critério de saída),
  658-740 (§4.10, a distinção Diary/Library), 742-780 (§4.11, o pipeline de RAG e os requisitos explícitos).
- `conductor-main/conductor/library.py` — a CLI real `cdt library` (search/status/stacks/export/import/
  compact/update/add/reindex), o mapeamento gate→categoria (`_GATE_CATEGORY`), o enriquecimento de query por
  projeto (`_project_context`), a telemetria de grounding (`_log_telemetry`/`_log_unreachable`) e o padrão
  "biblioteca indisponível é loud, nunca silencioso".
- `conductor-main/conductor/rag/core.py` — chunking por parágrafo respeitando blocos de código, embeddings
  via Ollama (`bge-m3`, 1024-d), ChromaDB embutido (`PersistentClient`) OU remoto (`CONDUCTOR_CHROMA_HTTP`),
  seleção de corpus por tier/stack (`select_corpus`), `BackendUnreachable` como contrato de falha explícito.
- `conductor-main/conductor/rag/bootstrap.py` — `cdt up`: fetch do corpus, pull do modelo, ingest; a decisão
  de (re)fetch (`_fetch_decision`) e o import de um índice pré-computado (`_try_prebuilt`) antes de cair para
  embutir localmente — o caminho que hoje entrega "offline para o corpus básico" no conductor-main.
- `packages/conductor-runtime/src/gate-evidence.ts` (Fase 4) — `EvidenceRef` (union fechada: `git-commit` |
  `file` | `journal-entry` | `test-run`), `EvidenceProvenance` (`runtime-derived` | `author-declared`), e a
  regra de ouro `hasSufficientEvidenceForMandatoryGate`: só conta evidência Tier-1 genuinamente resolvida,
  nunca uma alegação em texto livre.
- `packages/conductor-runtime/src/gate-state.ts` (Fase 4, ADR 0005 §18, contrato travado) — **achado central
  desta sessão:** `Evidence` e `Decision` já carregam `groundingCitations?: string[]` — um array de strings
  livre, **sem formato definido**. Esta fase é quem primeiro especifica o que entra nesse array e como ele se
  relaciona (ou não) com `EvidenceRef`/Tier-1.
- `packages/conductor-runtime/src/gate-state-policy.ts` (Fase 4) — `isGateGenuinelyApproved` nunca lê
  `groundingCitations` para decidir se um gate obrigatório está satisfeito; só consulta
  `hasSufficientEvidenceForMandatoryGate` sobre os itens de `evidence`. Confirma, lendo o código e não
  supondo, que citação de biblioteca hoje **não** participa do cálculo de "gate fechado" — ver §5 Grupo E.
- `pi/docs/conductor/gate2-spec-fase4.md` — formato de referência (Given/When/Then, tabelas de goals/
  non-goals, glossário com grounding próprio).

---

## 1. O que já existe vs. o que a Fase 5 constrói

| Capacidade | Já existe (conductor-main ou Fase 4 do pi) | Fase 5 constrói/especifica |
|---|---|---|
| CLI de busca semântica sobre um corpus de livros | **Sim, madura**, em Python (`cdt library`, este próprio repo-pai a usa para se fundamentar agora mesmo). | O **comportamento observável equivalente** para o produto pi (`conductor library status/search/ingest/update`) — esta spec não assume que a implementação reusa o processo Python; isso é decisão de Gate 4 (§9.2). |
| Busca híbrida (lexical + vetorial) com reranking | **Parcial no conductor-main**: `rag/core.py` hoje só faz busca vetorial pura (cosine sobre embeddings ChromaDB); não há um estágio lexical (BM25) nem um reranker separado no código lido. | G2/FR-2 exige o **par completo** (lexical + vetorial, fundido, depois rerankeado) — uma capacidade nova, não só portada, fundamentada na biblioteca (§8.1). |
| Citação obrigatória (origem + score em cada resultado) | **Sim**, já no formato de saída de `cdt library search` (`source`, `section`, `path`, `score` por hit). | Formaliza isso como requisito testável (FR-6) e — o gap real — **conecta** a citação ao contrato já travado da Fase 4 (`groundingCitations`), que hoje não tem formato definido. |
| Enriquecimento de query com contexto de projeto | **Sim**, parcial: `_project_context` prefixa tipo+stack; `--gate N` auto-seleciona uma categoria. Não enriquece com **papel** (role). | FR-3 generaliza para os 4 eixos que o plano pede literalmente (projeto, stack, gate, **papel** — §4.11), papel sendo o eixo que falta na referência. |
| Code-aware RAG (cruzar biblioteca com código do projeto) | **Sim**, via `--code-aware` + `intelligence/code_aware_rag.py` (não lido linha a linha, fora do escopo desta leitura, mas o comportamento observável do flag está documentado em `library.py`). | FR-7 formaliza o comportamento observável (dois conjuntos de resultados, library e código, rotulados distintamente) sem herdar a implementação Python. |
| Corpus/backend indisponível reportado de forma alta | **Sim, exemplar**: `BackendUnreachable` com mensagem acionável; `_log_unreachable` grava um evento honesto mesmo na falha — é o padrão fail-**visible** que esta fase adota (FR-12/BR-7). | Reusa o **padrão de comportamento**, não o código; formaliza como FR/BR testável para o produto pi. |
| Indexação incremental (skip conteúdo inalterado) | **Sim**: `ingest.py` faz dedupe por hash de conteúdo (`chash`, não lido linha a linha mas citado por `rag/core.py`'s `CHUNKER_VERSION` e pelo próprio texto de `cmd_reindex`: "skipping unchanged chunks (content-hash dedup)"). | FR-9/BR-9 exigem a **propriedade observável** ("uma atualização de rotina não reprocessa conteúdo inalterado"); o mecanismo exato é Gate 4/6. |
| Operação offline do corpus básico | **Sim, com um caminho de 3 camadas**: índice pré-computado bundled → índice pré-computado via release remoto → embed local via Ollama nativo. Docker é **opcional** (`CHROMA_HTTP` só é setado em modo Docker/remoto; o padrão é `PersistentClient` embutido, sem servidor). | FR-11/FR-13/§9.1 — o plano pede tanto "offline para o básico" quanto "suporte a índices remotos"; a referência já resolve isso com um **default embutido + opt-in remoto**, mas se esse é o desenho que o pi deve seguir (dado o hardware fraco já registrado para a Fase 6/Diary) é uma questão que esta spec deixa explicitamente aberta para o Gate 4 (§9.1), não decide por herança automática. |
| `GateState.Evidence`/`Decision.groundingCitations` | **Sim, o campo existe** (Fase 4, ADR 0005 §18) mas é um `string[]` sem formato, e nenhum código-fonte lido o preenche ou consome hoje. | **O gap que esta fase fecha de fato**: FR-14 a FR-17 definem o conteúdo mínimo de uma citação, sua relação (nula, deliberadamente) com `EvidenceRef`/Tier-1, e o comportamento de recusa de uma `Decision` não fundamentada num gate configurado como grounded. |
| Filtros por categoria/design-system/collection | **Sim**, mas o facet design-system/collection é específico do corpus de templates de frontend (`15_templates_for_frontend`), não pedido pelo plano para esta fase (linhas 768-779 só citam categoria/tecnologia/versão). | **Non-goal explícito aqui** (§3) — os filtros desta fase são categoria/tecnologia/versão; design-system fica para quando um projeto `type=frontend/fullstack` precisar dele. |

---

## 2. Goals

1. **G1 — Superfície de CLI observável.** `conductor library status|search|ingest|update` (os 4
   entregáveis literais do plano, linha 1362-1369) produzem saída determinística e testável para qualquer
   papel/gate que precise se fundamentar.
2. **G2 — Busca híbrida com reranking.** Toda consulta combina recuperação lexical e vetorial e é
   rerankeada antes de retornar — nenhum dos dois modos sozinho é suficiente (§8.1).
3. **G3 — Citação nunca é opcional.** Toda passagem devolvida carrega origem verificável (livro/seção/
   caminho/score); nenhuma resposta "solta" sem atribuição.
4. **G4 — Consulta enriquecida antes de buscar.** Uma pergunta crua é enriquecida com projeto, stack, gate
   e papel antes de chegar ao estágio de busca (pipeline literal do plano, §4.11).
5. **G5 — Code-aware quando pedido.** Uma consulta pode cruzar a biblioteca com o código-fonte do próprio
   projeto, retornando os dois conjuntos de resultados distinguíveis.
6. **G6 — Corpus básico funciona offline; índice remoto é opt-in.** O tier padrão do corpus é pesquisável
   sem rede após a ingestão local inicial; um índice remoto, quando configurado, complementa sem ser
   pré-requisito. (Como isso se arquiteta é aberto — §9.1; o comportamento observável não é.)
7. **G7 — Uma citação de biblioteca é consumível pela Fase 4, com papel explícito e limitado.** Uma
   citação vira um registro estruturado anexável a `Decision.groundingCitations`/`Evidence.groundingCitations`
   (gate-state.ts) — mas **nunca** conta como `EvidenceRef` Tier-1 nem fecha um gate obrigatório sozinha.
   Generaliza o mesmo princípio "referência conferível, nunca alegação" (Fase 3 `DelegationEvidence`, Fase 4
   `EvidenceRef`) para o domínio de "esta decisão foi informada por uma fonte", que é uma alegação mais fraca
   e deliberadamente distinta de "este gate foi cumprido".
8. **G8 — Filtros por categoria/tecnologia/versão.** Uma consulta pode ser restringida por esses três
   eixos (requisito explícito do plano, §4.11) — nenhum outro facet é exigido por esta fase.
9. **G9 — Indexação incremental.** Uma atualização de rotina do corpus nunca reprocessa conteúdo
   inalterado.
10. **Critério de saída (herdado literalmente do plano, linha 1373):** "Decisões não triviais nos gates
    configurados como grounded devem exigir evidência da Library" — restated de forma testável em FR-16/
    FR-17, não deixado como aspiração de prompt.

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Diary/journal** (`add`/`recall`/`search`/`digest`/`ingest`, captura automática de eventos) | Nomeado explicitamente Fase 6 (linha 1377, memória **dinâmica**). Esta spec só referencia onde ele vive (`.conductor/memory/diary/`, §4.10) — nunca especifica seu comportamento. | Fase 6 |
| **Redefinir papéis/skills/gates por papel** | Já existe (Fase 3: `BUILTIN_GATE_ROLES`/`gatesForBuiltinRole`). A Library é **consumida** por gates/papéis para se fundamentar; não redefine quem serve qual gate. | Fase 3 (já entregue) |
| **`GateState`/`Evidence`/`Decision`/`EvidenceRef` como tipos** | Já existem, travados por ADR 0005 §18 (Fase 4). Esta fase **usa** o campo `groundingCitations?: string[]` já declarado e define seu **conteúdo mínimo** (FR-14) — nunca redeclara ou muda a forma do tipo. Se o conteúdo mínimo definido aqui exigir uma forma mais rica que `string[]` no futuro, isso é uma decisão de Gate 4 que reabre o Apêndice §18 (§9.4) — não decidido, nem assumido, por esta spec. | Fase 4 (tipos já entregues); possível extensão futura é Gate 4 |
| **Arquitetura física do backend de RAG** (ChromaDB embutido vs. remoto, SQLite, um motor de busca vetorial escrito do zero, Docker vs. nativo) | Comportamento observável (offline funciona, filtros funcionam, busca é híbrida), não implementação. Ver a tensão explícita em §9.1 — múltiplas opções viáveis, cada uma com trade-off real, nenhuma decidida aqui. | Gate 4 (ADR) |
| **Reimplementar em TS vs. invocar o `cdt library` (Python) do conductor-main como processo externo** | O pi é um rewrite TS (Fases 0-3 são TS puro); decidir se a Fase 5 reescreve a busca híbrida/embeddings nativamente ou embrulha o processo Python maduro já lido é uma decisão de arquitetura com custo real dos dois lados (duplicar ~500 LOC testadas vs. introduzir uma dependência de runtime cruzado Python+pip). Não decidido aqui — ver §9.2. | Gate 4 (ADR) |
| **Mecanismo exato de enforcement do FR-16** (onde a recusa de uma `Decision` não fundamentada é aplicada — pre-check de CLI, extensão de `gate-state-policy.ts`, ou um hook estilo `cdt gate guard` do conductor-main) | Comportamento observável definido (FR-16/17); o ponto de aplicação no código é arquitetura. | Gate 4 |
| **Formato de distribuição de embeddings pré-computados** (`cdt library export/import`, GitHub releases, `.jsonl.gz`) | O plano pede a **propriedade** "embeddings pré-computados para o corpus padrão" (FR-11 exige isso ser observável: offline funciona sem GPU no tier básico); o mecanismo de empacotamento/distribuição é implementação/release, não comportamento de gate. | Gate 4/10 |
| **Facets `design-system`/`collection`** (corpus de templates de frontend) | Não pedido pelo plano para esta fase (§4.11 só cita categoria/tecnologia/versão). Pertence a quando um projeto `type=frontend/fullstack` precisar de `choose-visual-direction` (já nomeado no `CLAUDE.md` deste repo-pai). | Fase de UI ainda não nomeada para o pi |
| **UI/TUI de biblioteca** (navegar resultados visualmente, histórico de consultas) | Mesmo padrão já registrado nas specs de fases anteriores: depende de dados que só existem a partir desta fase; cresce organicamente. | Não nomeado, cresce organicamente |

---

## 4. Glossário (linguagem ubíqua)

*Grounding:* **Domain-Driven Design — Complete Professional Guide §1.1/§1.12** (já citado nas specs
anteriores desta série) — um vocabulário único evita que "citação", "evidência" e "grounding" colidam
silenciosamente entre esta fase e a Fase 4, que já usa "evidência" com um sentido mais estrito (Tier-1).

| Termo | Definição | Fonte |
|---|---|---|
| **Corpus** | O conjunto de arquivos-fonte (livros/guias em markdown) que a Library pode indexar. Selecionado por tier (`core`/`supporting`/`foundational`/`optional`) e por stack (linguagem/framework opt-in). | `rag/core.py` (`LIBRARY_TIERS`/`LIBRARY_STACKS`, `select_corpus`) |
| **Chunk** | Um trecho de um livro, do tamanho de um parágrafo empacotado (~1500-2400 chars), rotulado com a seção markdown em que aparece. Unidade que é de fato embedada e indexada. | `rag/core.py:chunk_markdown` |
| **Passagem (passage)** | Um chunk devolvido como resultado de uma busca, sempre acompanhado de origem (fonte/seção/caminho) e um score de relevância. | `library.py:search` |
| **Citação (citation)** | O registro estruturado e autocontido de uma passagem usada para fundamentar uma decisão de gate — fonte, seção, categoria, versão do corpus, score, a pergunta feita, e quando. Distinto de "passagem" porque uma citação **persiste** (vira parte do `GateState`), enquanto uma passagem é efêmera (existe só na resposta da consulta). | Definido nesta fase — FR-14 |
| **Busca híbrida (hybrid search)** | Recuperação que combina um índice lexical (correspondência de termos/BM25) e um índice vetorial (similaridade semântica de embeddings), fundidos antes do reranking — nem um nem outro sozinho. | §8.1 (Context Engineering §4.4/§4.5) |
| **Reranking** | Um segundo estágio, mais caro por candidato, que reordena o top-k bruto da busca híbrida por relevância real à pergunta — gasta computação só onde os candidatos já foram filtrados. | §8.1 |
| **Enriquecimento de consulta (query enrichment)** | Transformar a pergunta crua do usuário/agente, prefixando ou reescrevendo com contexto de projeto, stack, gate e papel, antes de buscar. | `plano_desenvolvimento.md` §4.11 (pipeline); `library.py:_project_context` (parcial, referência) |
| **Consulta code-aware** | Uma busca que retorna, além das passagens da Library, trechos do código-fonte do próprio projeto relacionados à mesma pergunta — dois conjuntos de resultados, nunca fundidos silenciosamente num só. | `library.py` (`--code-aware`) |
| **Threshold de relevância** | O score mínimo abaixo do qual uma passagem é descartada, mesmo que esteja dentro do top-k pedido — "a coragem de não recuperar nada" quando nada é bom o suficiente. | §8.4 (Context Engineering §4.6) |
| **Corpus básico (core/base tier)** | O tier de corpus sempre incluído, agnóstico de linguagem/framework — o que deve funcionar offline por padrão (G6). | `rag/core.py` (`_TIERS`, `core` sempre incluído) |
| **Backend de RAG** | O par de serviços que a busca depende para funcionar de fato: um motor de embeddings (ex. Ollama servindo `bge-m3`) e um armazenamento vetorial (ex. ChromaDB). "Indisponível" significa que um dos dois não responde. | `rag/core.py:BackendUnreachable` |
| **`EvidenceRef` / Tier-1** | (Herdado da Fase 4, não redefinido aqui.) Uma referência a algo que o runtime consegue mecanicamente verificar como real — um commit, um arquivo, um test-run/journal-entry gravado pelo próprio runtime. Uma citação de biblioteca **nunca** é um `EvidenceRef` (G7). | `gate-evidence.ts` |
| **`groundingCitations`** | O campo já declarado em `Evidence`/`Decision` (Fase 4, ADR 0005 §18) — um `string[]` cujo conteúdo mínimo esta fase define pela primeira vez (FR-14). | `gate-state.ts` |

---

## 5. Requisitos funcionais (FR)

*Grounding para Given/When/Then:* **Specification by Example — Complete Professional Guide §2.12/§2.13**
(mesma base já usada nas specs anteriores desta série) — vocabulário que se repete por todo este grupo,
resultado nomeável.

### Grupo A — Consulta (`library search`) — G1/G2/G3/G4/G8

**FR-1 — `library search "<pergunta>"` retorna passagens rankeadas com origem e score.**
> Given um corpus indexado com ao menos um livro sobre o tópico perguntado,
> When alguém roda `conductor library search "como definir um circuit breaker?"`,
> Then a saída lista passagens ordenadas por relevância, cada uma com fonte (livro), seção, caminho no
> corpus, e um score numérico — nunca um texto de resposta sem essa origem anexada.

**FR-2 — A busca combina recuperação lexical e vetorial, fundidas e rerankeadas, antes de retornar.**
> Given uma pergunta que contém um termo técnico exato (ex. "bulkhead") que só um índice lexical
> pega bem e uma intenção semântica mais ampla que só um índice vetorial capta,
> When a busca é executada,
> Then o resultado reflete candidatos de **ambos** os índices, fundidos (ex. reciprocal-rank fusion) e
> reordenados por um estágio de reranking — nunca apenas um dos dois modos isolado. *Grounding:* §8.1.

**FR-3 — A pergunta é enriquecida com projeto, stack, gate e papel antes da busca.**
> Given uma demanda no Gate 3 de um projeto backend Python, conduzida pelo papel `security-engineer`,
> When esse papel roda `library search --gate 3 --role security-engineer "tratamento de credenciais"`
> (ou o enriquecimento automático equivalente do pipeline, sem que o chamador precise nomear os 4 eixos à
> mão sempre),
> Then a consulta efetivamente buscada carrega esse contexto (ex.: prefixo "no contexto de um projeto
> backend Python, no Gate 3 (segurança), do ponto de vista de um security-engineer, ...") — a pergunta
> crua nunca é buscada sem essa passagem de enriquecimento. Generaliza `_project_context` (referência,
> só projeto+stack) para os 4 eixos que o plano pede (§4.11): projeto, stack, gate, **papel**.

**FR-4 — Filtros por categoria/tecnologia/versão restringem a busca.**
> Given um corpus com livros de mais de uma categoria (ex. segurança e arquitetura) e mais de uma stack
> (ex. Python e Java, em versões diferentes),
> When alguém roda `library search --category security_and_privacy "STRIDE"` (ou `--tech python
> --version 3.13`),
> Then apenas passagens que casam o(s) filtro(s) pedido(s) aparecem no resultado — um filtro nunca é
> ignorado silenciosamente (ver BR-8/edge case §7.5).

**FR-5 — Nenhuma passagem acima do threshold → resposta explícita de "nenhum resultado".**
> Given uma pergunta fora do escopo de qualquer livro indexado (ex. sobre um domínio de negócio muito
> específico que nenhum livro cobre),
> When a busca roda e o melhor candidato fica abaixo do threshold de relevância configurado,
> Then a saída diz explicitamente que nenhuma passagem relevante foi encontrada — nunca força os top-k
> piores candidatos como se fossem uma resposta útil. *Grounding:* §8.4.

**FR-6 — Toda passagem carrega citação obrigatória.**
> Given qualquer resultado de busca não-vazio,
> When a saída é formatada (texto ou JSON),
> Then cada item inclui, no mínimo, fonte + seção + caminho + score — omitir a origem de uma passagem
> retornada é um defeito, não uma opção de formatação mais enxuta. *Grounding:* §8.2.

### Grupo B — Consulta code-aware — G5

**FR-7 — Uma consulta code-aware retorna passagens da Library e trechos de código do projeto,
rotulados distintamente.**
> Given um projeto com código-fonte que implementa um padrão perguntado (ex. um circuit breaker já
> implementado em `resilience/circuit-breaker.ts`),
> When alguém roda `library search --code-aware "onde aplicar circuit breaker"`,
> Then a saída mostra dois conjuntos claramente rotulados: passagens da Library (com citação, FR-6) e
> trechos do código-fonte do projeto que casam a mesma pergunta — nunca fundidos num único conjunto
> indistinguível quanto à origem.

### Grupo C — Ciclo de vida do corpus (`status`/`ingest`/`update`) — G1/G9

**FR-8 — `library status` relata o que está de fato indexado.**
> Given um corpus com N livros ingeridos em M categorias,
> When alguém roda `conductor library status`,
> Then a saída mostra, no mínimo: total de chunks, total de livros, categorias com contagem, e uma versão
> do corpus (quando conhecida) — o suficiente para responder "o que esta instalação realmente sabe
> buscar?" sem inspecionar o armazenamento manualmente.

**FR-9 — `library ingest` indexa conteúdo novo/alterado sem reprocessar o que não mudou.**
> Given um corpus já indexado e um único arquivo alterado desde a última ingestão,
> When `conductor library ingest` roda novamente,
> Then apenas o conteúdo novo/alterado é (re)embedado e gravado — o restante do corpus, inalterado, não é
> reprocessado. *Grounding conceitual:* §8.6; mecanismo exato (ex. hash de conteúdo) é Gate 4/6.

**FR-10 — `library update` busca a fonte do corpus e reindexa apenas o que mudou.**
> Given uma fonte de corpus configurada (ex. um repositório remoto de livros) que publicou uma nova
> versão desde a última sincronização,
> When alguém roda `conductor library update`,
> Then o conteúdo é buscado novamente e apenas os chunks cujo conteúdo mudou são reescritos no índice —
> uma fonte inalcançável (rede fora) não apaga nem corrompe o corpus local já existente (mesma disciplina
> de "uma falha de leitura nunca é tratada como permissão para destruir o que já funciona").

### Grupo D — Operação offline e disponibilidade do backend — G6

**FR-11 — O corpus básico é pesquisável sem rede após a ingestão local inicial.**
> Given o tier `core` do corpus já ingerido localmente (com sua indexação vetorial/lexical já
> construída em disco),
> When a máquina é desconectada da rede e `library search` roda sobre uma pergunta coberta pelo tier
> `core`,
> Then a busca funciona normalmente — nenhuma chamada de rede é necessária para servir uma consulta sobre
> o corpus já indexado.

**FR-12 — Backend indisponível → falha alta e visível, nunca resultado degradado silenciosamente.**
> Given o serviço de embeddings ou o armazenamento vetorial fora do ar,
> When `library search` é chamado,
> Then o comando falha explicitamente, nomeando qual backend está inacessível e uma ação corretiva — e
> registra a tentativa (mesmo padrão de `_log_unreachable`: um evento honesto de "tentei e falhou" é
> aceitável para o gate de grounding; um silêncio total não é). Nunca retorna um resultado vazio ou
> parcial como se fosse uma resposta completa.

**FR-13 — Um índice remoto opcional complementa, nunca é pré-requisito, para o corpus básico.**
> Given uma instalação sem nenhum índice remoto configurado,
> When o corpus básico já foi ingerido localmente,
> Then toda a superfície do Grupo A funciona normalmente sem que um índice remoto jamais tenha existido —
> configurar um índice remoto é estritamente aditivo (arquitetura exata: §9.1).

### Grupo E — Citação como evidência rastreável (integração com a Fase 4) — G7/G10

**FR-14 — Uma citação usada num gate é capturada como registro estruturado e autocontido.**
> Given uma busca feita durante um gate (ex. Gate 3, papel `security-engineer`, pergunta sobre STRIDE)
> que retornou uma passagem usada para fundamentar uma decisão,
> When essa citação é anexada a uma `Decision`/`Evidence` daquele gate,
> Then o registro carrega, no mínimo: fonte (livro), seção, categoria, versão do corpus no momento da
> consulta, score, a pergunta exata feita, e um timestamp — nunca apenas um nome de livro solto ou uma
> frase digitada de memória pelo agente. É esse registro estruturado (serializado como uma das strings de
> `groundingCitations`, Fase 4) que fecha o gap identificado em §1: o campo já existe, o conteúdo não
> tinha forma definida antes desta fase.

**FR-15 — Uma citação nunca é `EvidenceRef` Tier-1 nem conta para fechar um gate obrigatório sozinha.**
> Given uma `Decision` de Gate 3 com 5 citações de biblioteca anexadas e **nenhum** item em `evidence`
> (nenhum commit, arquivo, test-run ou journal-entry resolvido),
> When `isGateGenuinelyApproved`/`hasSufficientEvidenceForMandatoryGate` (Fase 4, inalterados por esta
> fase) avaliam se o Gate 3 pode ser aprovado,
> Then o gate permanece **não** satisfeito — citações estabelecem que a decisão foi informada por uma
> fonte, nunca que o trabalho do gate foi de fato feito (BR-6/R25 da Fase 4, herdados sem enfraquecimento).
> *Este FR existe para eliminar uma ambiguidade real, não hipotética*: é natural supor que "5 citações =
> gate bem fundamentado = pode aprovar"; a Fase 4 já decide que não, mas nenhum documento até aqui
> afirmava isso explicitamente do lado da Library.

**FR-16 — Um gate configurado como "grounded" recusa persistir uma `Decision` não-trivial sem citação
nem nota de indisponibilidade explícita.**
> Given um gate no qual o `CLAUDE.md`/a política do projeto exige grounding (ex. qualquer gate que
> registre uma decisão técnica não-trivial — o non-negotiable "Ground every non-trivial claim"),
> When um papel tenta registrar uma `Decision` de kind `"decision"` sem nenhum item em
> `groundingCitations` e sem uma nota equivalente a "library unavailable — proceeding ungrounded" (FR-17),
> Then o registro é recusado no momento da tentativa — nunca aceito silenciosamente para ser descoberto
> como lacuna só no Gate 8/9. Isto operacionaliza o critério de saída do plano (linha 1373) como
> comportamento checável, no mesmo espírito do que `cdt gate guard` já faz via hook de `commit-msg` no
> conductor-main (referência de comportamento, não de mecanismo — o ponto de aplicação exato no pi é
> Gate 4, §9.3).

**FR-17 — Backend indisponível ainda permite registrar uma decisão, via nota explícita de risco aceito.**
> Given o backend de RAG fora do ar no momento em que um gate precisaria se fundamentar,
> When um papel tenta registrar uma `Decision` sem citação,
> Then o registro só é aceito se carregar uma nota explícita equivalente a "library unavailable —
> proceeding ungrounded" — nunca aceito por omissão silenciosa, e nunca bloqueado permanentemente por uma
> indisponibilidade real (mesmo princípio do "genuine override" do `CLAUDE.md`: `[skip-ground]` é um
> risco aceito e registrado, não um bypass silencioso).

---

## 6. Business rules

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | Toda passagem retornada carrega metadados de origem verificáveis (fonte + seção/caminho) — nunca uma resposta sem atribuição. | §8.2 (Context Engineering §10.1/§10.2/§4.7) | FR-1, FR-6 |
| **BR-2** | Um threshold de relevância é aplicado antes de devolver resultados; forçar uma correspondência de baixa confiança para preencher k é pior do que devolver nada. | §8.4 (Context Engineering §4.6) | FR-5 |
| **BR-3** | Citação de biblioteca é rastreabilidade, nunca prova de trabalho: apenas um `EvidenceRef` genuinamente resolvido conta para fechar um gate obrigatório — herdado sem enfraquecimento da Fase 4 (R25/BR-6). | `gate-evidence.ts`; Context Engineering §11.4 ("does the cited context actually entail what the answer asserts?") | FR-15 |
| **BR-4** | Toda citação anexada a `groundingCitations` é um registro estruturado e reproduzível — nunca uma string livre digitada de memória pelo agente. | `gate-state.ts` (contrato já travado, ADR 0005 §18); esta fase define o conteúdo pela primeira vez | FR-14 |
| **BR-5** | Uma citação registra o estado do corpus/da consulta no momento em que foi feita — é um retrato (snapshot), nunca um ponteiro vivo; uma atualização do corpus (`library update`) nunca invalida nem reescreve silenciosamente uma citação já registrada. | Decorre de FR-9/FR-10 (indexação incremental muda o índice ao longo do tempo) + FR-14 (a citação carrega sua própria versão de corpus) | FR-14; edge case §7.3 |
| **BR-6** | O tier básico/core do corpus permanece pesquisável com zero chamadas de rede após a ingestão local inicial — offline é piso, não melhor-esforço. | Plano §4.11 ("funcionamento offline para o corpus básico"), requisito explícito | FR-11 |
| **BR-7** | Um backend indisponível degrada de forma alta e visível, nunca silenciosa — mesma direção de falha que a Fase 4 já fixou para I/O incerto de `GateState` (BR-9 daquela spec), aplicada aqui à consulta em vez da mutação de estado. | `gate2-spec-fase4.md` BR-9 (mesmo princípio, domínio irmão); reforçado por `rag/core.py:BackendUnreachable`/`_log_unreachable` como referência de comportamento | FR-12, FR-17 |
| **BR-8** | Um filtro (categoria/tecnologia/versão) com valor não reconhecido é reportado explicitamente — nunca tratado como "sem filtro" por omissão. | §8.5 (Managing Software Complexity §3.12, "When not to hide information or define an error away") | FR-4; edge case §7.5 |
| **BR-9** | Reindexação incremental nunca reprocessa conteúdo inalterado numa atualização de rotina. Cobertura na biblioteca é **conceitual** (§8.6: "ingest re-run nightly on changed documents"); o mecanismo específico de deduplicação por hash de conteúdo é prior art do próprio projeto (`conductor-main/rag/ingest.py`), **não** uma citação de livro — declarado, não forçado. | §8.6 (parcial) + prior art do projeto | FR-9 |
| **BR-10** | Uma citação nunca é, sozinha, motivo para recusar um gate — a ausência dela é (FR-16); o par (recusa-sem-grounding / citação-não-é-prova) é uma só regra vista de dois lados, e as duas metades precisam ser lidas juntas para não virar nem "grounding é decorativo" nem "citações substituem evidência real". | Síntese de FR-15/FR-16 (Non-negotiable Rule 1, `CLAUDE.md`) | FR-15, FR-16 |

---

## 7. Edge cases

1. **Corpus vazio (nunca ingerido).** `library status` reporta explicitamente "índice vazio, rode a
   ingestão" (FR-8) em vez de uma tabela vazia sem explicação; `library search` sobre um índice vazio
   retorna a mesma resposta de "nenhum resultado" que FR-5 já define para threshold, mas com uma causa
   diferente e nomeada (índice vazio ≠ pergunta sem passagem relevante) — a saída não deve confundir as
   duas.
2. **Backend de RAG indisponível.** FR-12 (busca falha alta) + FR-17 (uma `Decision` ainda pode ser
   registrada, mas só via nota explícita de risco aceito) — nunca um meio-termo onde a busca finge ter
   funcionado ou o gate trava permanentemente porque um serviço externo caiu.
3. **Citação de um chunk que não existe mais no índice atual.** Coberto por BR-5: a citação registrada em
   `groundingCitations` é um retrato autocontido (fonte+seção+score+versão do corpus **no momento da
   citação**) — nunca um ID que depende do índice atual para ser lido. Given uma citação gravada quando o
   corpus estava na versão X e continha aquela passagem, When o corpus é atualizado para a versão Y e a
   passagem é removida/alterada, Then a citação já registrada continua legível e válida como rastro
   histórico; uma tentativa posterior de "re-verificar" contra o índice **vivo** pode legitimamente
   reportar "não encontrado na versão atual" sem que isso invalide o registro original.
4. **Query sem nenhum resultado acima do threshold.** FR-5 — resposta explícita de "nenhuma passagem
   relevante", nunca os top-k piores candidatos disfarçados de resposta.
5. **Filtro com valor não reconhecido** (ex. `--category` para uma categoria que não existe no corpus
   selecionado). BR-8 — reportado explicitamente (ex. "categoria 'xyz' não existe; categorias disponíveis:
   ..."), nunca silenciosamente tratado como "sem filtro" (o que devolveria resultados de todas as
   categorias e enganaria quem pediu um recorte específico).
6. **Filtro válido, mas a categoria pedida nunca foi selecionada/ingerida** (ex. tier `supporting` nunca
   escolhido, então nenhum livro de segurança está no índice, embora "segurança" seja uma categoria real
   do corpus completo). Distinto do edge case 5: aqui o filtro é reconhecido, mas o corpus local
   simplesmente não tem conteúdo naquela categoria. A resposta deve distinguir isso de "sem resultados
   acima do threshold" (edge case 4) — é "nada indexado nesta categoria", não "nada relevante o
   suficiente".
7. **Consulta code-aware sem nenhum trecho de código correspondente.** FR-7 degrada graciosamente: o
   conjunto de passagens da Library ainda é retornado normalmente; o conjunto de código fica vazio e
   nomeado como tal — nunca um erro nem um resultado totalmente vazio só porque o lado código não achou
   nada.
8. **Duas gravações concorrentes de `groundingCitations` no mesmo `GateState`.** Não é um caso novo desta
   fase — herda a garantia já fixada em `gate2-spec-fase4.md` FR-14 ("nenhuma mutação perdida"); esta fase
   não reabre o mecanismo de concorrência do `GateState`, só adiciona mais um campo que passa por ele.

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate 2` (backend
saudável).

1. **Busca híbrida + reranking** (consulta feita pelo orquestrador antes de delegar) → **Context
   Engineering — Designing Information Environments for LLM Systems §4.4 "Hybrid Search: Dense and
   Lexical Are Complements"** (top **0.666**: "dense and lexical fail in opposite directions; combining
   is what earns its keep") e **§4.5 "Reranking: Spend Compute Where the Candidates Are"** (cross-encoder
   reordena o top-k depois do retrieval barato) — base de G2/FR-2.
2. **Citação obrigatória e rastreabilidade de origem** → **Context Engineering §10.1 "Source-of-Truth
   Hierarchies"** (top **0.646**) e **§10.2 "Provenance: Every Chunk Carries Its Passport"** (0.611:
   "provenance... source document and section... ingestion and last-modified timestamps, authority tier")
   — base direta do formato mínimo de citação em FR-14/BR-4. **§11.4 "Faithfulness and Groundedness
   Evals"** (0.626: "a grounded system makes an implicit promise: the answer is supported by the retrieved
   sources") — base de BR-3 (citar não é provar).
3. **Trade-offs de arquitetura local vs. remota (sem decidir)** → **Solution Architecture — Complete
   Professional Guide §3.2 "Business context: cloud, cost, and integration trade-offs"** (top **0.578**)
   e **Distributed Architecture Decisions — Complete Professional Guide §1.1 "Introduction: trade-offs,
   not best practices"** (0.561: "'best practice' is usually a trap: the same decision that helps one
   quality attribute hurts another") — usada para **enquadrar** a questão aberta §9.1 como opções com
   trade-offs, não para recomendar uma — é precisamente a postura que este livro descreve como correta
   quando a resposta certa depende do contexto (aqui: hardware do usuário, não decidido nesta spec).
4. **Threshold e "a coragem de não recuperar nada"** → **Context Engineering §4.6 "Selection: Top-k,
   Thresholds, and the Courage to Retrieve Nothing"** (top **0.653**/0.652/0.636: "a relevance threshold
   on the reranker score: discard candidates below it regardless of rank") — base direta de FR-5/BR-2.
   **§4.7 "Citation and Grounding: Closing the Loop"** (0.632: "citations are not decoration; they are
   the pipeline's feedback channel") — reforça FR-6/FR-14. **§4.1 "RAG Is a Context Decision, Not a Model
   Feature"** (0.615: pipeline `question → [rewrite/expand] → search (hybrid) → merge → rerank → select
   → format`) — este diagrama é quase idêntico ao pipeline do próprio plano (§4.11) e fundamenta
   diretamente FR-3 (enriquecimento = "rewrite/expand" antes da busca).
5. **Erro explícito em vez de omitir/ignorar silenciosamente** → **Managing Software Complexity —
   Complete Professional Guide §3.12 "When not to hide information or define an error away"** (top
   **0.599**: "in a reconciliation job, a missing record means data loss — defining that away deletes
   the signal that would have caught it") — base direta de BR-8 (filtro não reconhecido nunca vira "sem
   filtro" por omissão).
6. **Indexação incremental** → **Context Engineering §14.1 "Case Study One: A RAG Knowledge Assistant"**
   (top **0.587**: "Ingest (offline, re-run nightly on changed documents)... provenance") — cobertura
   **conceitual** (reprocessar só o que mudou), não o mecanismo. **A biblioteca não cobre especificamente**
   deduplicação por hash de conteúdo como técnica — declarado, não forçado; BR-9 cita o próprio
   `conductor-main` como prior art de projeto para essa parte específica.

---

## 9. Questões em aberto para o Gate 4 (arquitetura)

Registradas aqui porque nasceram durante a especificação, mas **não são decisões desta PO** — são
insumo, não resposta.

1. **A tensão offline-vs-remoto (a que o orquestrador pediu para não resolver aqui).** O plano pede tanto
   "funcionamento offline para o corpus básico" quanto "suporte opcional a índices remotos" (§4.11, linhas
   777-779) — não são contraditórios em si (a referência `conductor-main` já resolve os dois com um
   default embutido + opt-in remoto via `CONDUCTOR_CHROMA_HTTP`), mas HÁ uma decisão prévia desta mesma
   demanda-track (memória de sessão anterior, aplicada à Diary/Fase 6, **ainda não decidida para a
   Library/Fase 5**): preferir uma stack leve — evitar Docker+Chroma quando der, reusar bge-m3/Ollama
   nativo, storage local leve — por causa do hardware fraco de um usuário. Opções que esta spec enxerga,
   sem escolher nenhuma:
   - **Opção A — Motor local leve e próprio.** Um índice vetorial embutido mais simples que ChromaDB (ex.
     um armazenamento SQLite com FTS5 para lexical + uma busca vetorial flat/ANN leve), reusando o
     bge-m3/Ollama nativo já cogitado para a Diary. *Trade-off:* menor pegada e zero dependência nova além
     do que a Diary já traria, mas reimplementa (e precisa validar) recall/performance que o ChromaDB já
     resolveu em produção no conductor-main.
   - **Opção B — ChromaDB embutido, igual à referência.** `PersistentClient` local (sem servidor, sem
     Docker) mais um `HttpClient` opcional para remoto — replica 1:1 o desenho já provado em
     `rag/core.py`. *Trade-off:* menor risco de reinventar um motor de busca vetorial, mas adiciona uma
     dependência (ChromaDB) que a Diary talvez esteja evitando por decisão de hardware — não confirmado
     se essa decisão se estende à Library.
   - **Opção C — Híbrida por padrão.** Motor local (Opção A ou B) como piso offline obrigatório (G6),
     mais um backend remoto **explicitamente opt-in** como camada adicional — é o desenho que menos
     diverge da referência já lida e que satisfaz as duas exigências do plano ao mesmo tempo, mas ainda
     não resolve QUAL motor local usar (Opção A vs. B continua em aberto dentro dela).
   Nenhuma das três é escolhida aqui — a fundamentação de trade-offs, não de melhor prática única, é
   deliberada (§8.3).
2. **Reimplementar nativamente em TS vs. embrulhar o `cdt library` (Python) existente como processo
   externo.** O pi é um rewrite TS; a referência lida (`rag/core.py`, ~500 LOC testadas em produção) já
   resolve chunking, embeddings e busca vetorial. Reescrever agora duplica esse trabalho maduro; invocar o
   processo Python como subprocess a partir do runtime TS introduz uma dependência de runtime cruzado
   (Python + pip instalados) que as Fases 0-3 do pi parecem ter evitado até aqui. Acoplada à questão 1
   (a escolha do motor local muda o cálculo de custo de reimplementar vs. embrulhar).
3. **Ponto de aplicação exato do FR-16** (recusar uma `Decision` não fundamentada num gate grounded): um
   pre-check no lado do CLI (`gate evidence`/`gate approve`, Fase 4), uma extensão de
   `evaluateAdvance`/`gate-state-policy.ts` (Fase 4), ou um mecanismo equivalente ao hook de `commit-msg`
   (`cdt gate guard`) do conductor-main? Esta spec só define o comportamento observável (FR-16/17); o
   ponto exato no código é decisão de Gate 4, e pode exigir uma pequena extensão em código já entregue pela
   Fase 4 — mas **sem tocar na forma dos tipos travados** pelo Apêndice §18 do ADR 0005.
4. **Formato exato da string em `groundingCitations`** (FR-14 define o conteúdo mínimo, não a
   representação): uma string serializada (ex. JSON-in-string) carregando os campos exigidos, ou uma
   extensão futura do próprio tipo (`groundingCitations?: string[]` → `groundingCitations?: Citation[]`
   estruturado)? A segunda opção reabre o Apêndice §18 do ADR 0005 (um tipo hoje travado) — custo real que
   só o Gate 4 deve pesar contra o ganho de tipagem forte.
5. **Facets `design-system`/`collection`.** Não pedidos pelo plano para esta fase — vale antecipá-los
   agora (o conductor-main já os tem prontos como referência) ou esperar por uma fase de UI ainda não
   nomeada (`choose-visual-direction`, já citado no `CLAUDE.md` deste repo-pai)? Marcado como Non-goal
   aqui (§3); confirmar quando um projeto `type=frontend/fullstack` precisar.
6. **Mecanismo de distribuição de embeddings pré-computados** (equivalente a `cdt library export/import`
   + release do artefato portátil no GitHub) — o plano pede a propriedade (offline sem GPU no tier
   básico), FR-11 exige isso como comportamento; a forma de empacotar/distribuir os vetores é decisão de
   Gate 4/10 (release engineering), não resolvida aqui.

---

## Registro no diário

`cdt journal add --gate 2 --kind decision` registrado a partir de `C:\development\source\projects\conductor`
ao final desta sessão, resumindo: 17 FRs em 5 grupos, 10 business rules, 8 edge cases (incluindo os 4
pedidos explicitamente: corpus vazio, backend indisponível, citação de chunk removido, query sem
resultado acima do threshold), e 6 questões em aberto para o Gate 4 — a mais central sendo a tensão
offline-vs-remoto herdada da decisão (ainda não tomada para a Library) já registrada para a Diary/Fase 6
por causa do hardware fraco do usuário, e o achado de que `groundingCitations` (Fase 4) já existe como
`string[]` sem formato definido — esta fase é quem primeiro especifica seu conteúdo mínimo (FR-14),
deixando deliberadamente aberta apenas sua representação exata em código.
