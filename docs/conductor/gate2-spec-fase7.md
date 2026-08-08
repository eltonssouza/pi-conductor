# Gate 2 — Especificação (fonte da verdade): Fase 7 — Model routing e provedores

**Demanda:** `Fase 7 — Model routing e provedores` (`plano_desenvolvimento.md` linhas 1404-1429), lida junto
com §4.15 "Modelos e provedores" (linhas 889-962 — os 15 provedores suportados, a lista de 7 "model roles"
do plano, o pipeline de resolução `Gate → Model role → Política do projeto → Modelos configurados →
Disponibilidade → Modelo selecionado`, a regra "um gate crítico não pode sofrer downgrade silencioso" com
seu exemplo literal — "Gate 9 requer security. Nenhum modelo security está configurado. Resultado:
execução recusada" —, e os 8 critérios que um fallback deve respeitar), §4.1 linha 181 ("fallback entre
provedores" como capacidade do runtime), §4.3 linha 283 ("fallback para outro provedor de IA" listado sob
"Network: requer consentimento e registro"), §7.2 linha 1120 ("model fallback" como extension planejada),
§9.4 linha 1598 ("fallback indevido" como vetor de teste de segurança) e §9.5 linha 1615 ("model routing"
como componente crítico sujeito a mutation testing), §10 invariantes 5/16/17 (linhas 1647/1658/1659 —
"gates críticos possuem modelo mínimo", "fallback respeita tier mínimo", "operações de rede geram evento
de egress"), e §14 riscos (linha 1847 "Alto custo de modelos", Alto / mitigação "Model roles, budgets e
roteamento"; linha 1850 "Fallback inseguro", **Crítico** / mitigação "Tier mínimo e consentimento de
egress").

**Gates cobertos por este documento:** Gate 1 (descoberta de domínio) + Gate 2 (especificação). Calibração
já registrada nesta sessão pelo orquestrador (`journal recall`, entrada `[gate 0] plan`): demanda tamanho
"feature", mesmo padrão das Fases 1-6 (gates 1-2 leves → 3 STRIDE completo → 4 ADR → 5 RED → 6 GREEN → 7 CI
→ 8 validação FR-a-FR → 9 pentest, parando no 9 — gates 10-14 reservados para uma fase de hardening/release
única ao final do programa). Mandatórios {3,5,7,8,9} nunca colapsados — aqui nenhum seria colapsado de
qualquer forma dado o escopo: esta fase toca autenticação, credenciais, tokens e chamadas a APIs externas,
o que torna o Gate 3 completo obrigatório por definição própria do `CLAUDE.md` ("does this touch auth,
PII, tokens, or external APIs? If yes → full Gate 3").

**Papel responsável:** `business-analyst` (skill `map-requirements`), Gate 2 do fluxo Conductor.

**Repo:** `C:\development\source\projects\conductor\pi`, branch `feature/fase7-model-routing-e-provedores`
(de `develop`, já criada e limpa). **Esta é uma tarefa de escrita de spec** — sem código, sem commit/push
(fica para o orquestrador).

**Princípio orientador (herdado do orquestrador, aplicado aqui em duas direções):** "composição antes de
fork" — o mesmo princípio das seis fases anteriores, mas aqui com DOIS substratos distintos a reusar, não
um só:

1. **Autenticação/credenciais.** `packages/ai` (contrato `CredentialStore`, OAuth device/URL flow,
   detecção de env-var — `env-api-keys.ts`) e `packages/coding-agent` (`AuthStorage`: arquivo `auth.json`
   com lock via `proper-lockfile`, permissão `0600`/diretório `0700`, escrita atômica por provedor;
   `ModelRuntime.setRuntimeApiKey`/`.removeRuntimeApiKey`/`.getProviderAuthStatus`/`.listCredentials`) são
   um substrato **maduro e já em produção** dentro do próprio `pi` — usado hoje pelo diálogo de login da
   TUI interativa (`interactive-mode.ts`, `components/login-dialog.ts`, `components/oauth-selector.ts`,
   `components/model-selector.ts`). `conductor-cli` já declara `@earendil-works/pi-ai` e
   `@earendil-works/pi-coding-agent` como dependências reais (`package.json:21-22`). `conductor
   login/logout/auth` **compõem** uma camada fina de comandos CLI headless sobre esse substrato — nunca
   reimplementam OAuth, nunca reimplementam o armazenamento de credenciais.
   **Nota que evita um erro de composição óbvio:** `packages/ai/src/cli.ts` (`login [provider]`/`list`) É
   a ferramenta de desenvolvimento do PRÓPRIO pacote vendor — grava `auth.json` em texto plano no CWD, sem
   lock, sem `chmod`. Não é o alvo certo de composição (não tem o acabamento de segurança de `AuthStorage`).
   A composição correta é sobre `AuthStorage`/`ModelRuntime`, nunca sobre esse script de exemplo.
2. **Roteamento por papel/tier.** `ConductorRole.modelRole: ModelRole` já existe, já está travado por ADR
   (Fase 3, ADR 0004 §16 apêndice), já é validado em frontmatter (`role-catalog.ts:72,131-139`), e já é
   carregado pelos 37 papéis built-in hoje. O ponto de parada é documentado **no próprio código**
   (`chat.ts:328-332`, `task.ts:511-526`): a resolução `modelRole → Model` concreto simplesmente não
   existe em lugar nenhum. Esta fase completa essa resolução — nunca reabre a FORMA do tipo
   `ConductorRole`/`ModelRole` que a Fase 3 já travou.

Em ambos os casos a disciplina é a mesma: identificar precisamente o que já existe (maduro, ou
deliberadamente incompleto-mas-com-contrato-travado) e construir só a lacuna real — nunca uma segunda
implementação paralela de nenhum dos dois.

**Achado mais importante desta sessão:** três vocabulários incompatíveis para "nível/tier de modelo"
coexistem hoje neste monorepo, e nenhum dos três foi formalmente reconciliado com os outros dois:

1. **`plano_desenvolvimento.md` §4.15** (a fonte funcional que esta spec formaliza): **7 valores** —
   `strategic / planning / standard / fast / lightweight / security / review`.
2. **O código já commitado e travado por ADR** (`packages/conductor-config/src/role-loader.ts:44`,
   `ConductorRole.modelRole`): **3 valores** — `strategic / standard / lightweight`. É este o tipo que os
   37 papéis built-in já carregam hoje (frontmatter `model:`, validado por `role-catalog.ts:72`).
3. **O `CLAUDE.md` deste próprio repositório-pai**, seção "Model roles per gate" — a tabela que orienta
   ESTA MESMA sessão autônoma: **4 valores** — `@plan / @slow / @default / @smol`, explicitamente descritos
   como um EIXO DIFERENTE do item 2 ("A persona's tier ... says how strong a model that *expert* wants ...
   A model role is that second axis ... indirection you control: map `@slow` once to whatever reasoner you
   have credentials for").

O item 3 já resolve a tensão com o item 2 **por design** — são dois eixos ortogonais (força pretendida do
papel × indireção por-gate mapeada pelo projeto para um modelo concreto), não uma duplicata acidental. Mas
**nenhuma decisão de código ou de spec jamais reconciliou o item 1 com os itens 2/3**: o vocabulário de 7
valores do PLANO — a fonte que o critério de saída desta fase literalmente cita ("Gate 9 requer security")
— não corresponde a nenhum dos dois eixos já existentes, nem como superset nem como subset limpo (`planning`,
`review` e `security` não têm equivalente em `ModelRole`; `fast` pode ser `lightweight` renomeado, ou pode
ser um terceiro conceito distinto). Isto tem consequência de segurança direta e imediata: `security` é o
próprio tier usado no exemplo canônico do critério de saída do plano ("Gate 9 requer security... nenhum
modelo security configurado... execução recusada") — e esse tier **não existe em lugar nenhum do código
hoje**. Registrado como questão central para o Gate 4 (§9 questão 1) — não decidido por esta BA, é insumo,
não resposta (BR-7 abaixo torna essa não-decisão uma regra explícita, para que nenhuma FR a resolva
silenciosamente).

**Consome (lido integralmente antes de escrever este documento):**
- `plano_desenvolvimento.md` linhas 1404-1429 (Fase 7 em si), 889-962 (§4.15 Modelos e provedores —
  provedores, model roles, pipeline de resolução, regra de não-downgrade, fallback), 174-194 (§4.1 —
  "fallback entre provedores" como capacidade do runtime), 240-299 (§4.3 — sistema de permissões, nível
  Network exige "consentimento e registro", inclui "fallback para outro provedor de IA"), 1095-1124 (§7.2
  — extensions planejadas, inclui "model fallback"), 1587-1619 (§9.4/§9.5 — testes de segurança e mutation
  testing, ambos nomeiam fallback/model routing), 1639-1662 (§10 — os 20 invariantes, especialmente
  5/16/17), 1838-1855 (§14 — riscos principais, "Alto custo de modelos" e "Fallback inseguro").
- `packages/conductor-config/src/role-loader.ts` (linhas 1-80) — `ModelRole`, `ConductorRole`, o
  comentário de cabeçalho que localiza `ADR 0004 §3 / Apêndice §16` como fonte de verdade do contrato.
- `packages/conductor-cli/src/commands/role-catalog.ts` (arquivo completo) — carregamento real do
  registro de papéis built-in a partir de `templates/agents/*.md`, `VALID_MODEL_ROLES` validado contra os
  3 valores travados, e o próprio achado documentado no cabeçalho sobre `tools: []` como placeholder
  fail-closed (precedente direto do padrão "declarar a lacuna, nunca inventar um valor plausível" que esta
  spec reaplica ao tier `security` ausente).
- `packages/conductor-cli/src/commands/chat/role-resolution.ts` (linhas 140-193) — `toTaskRoleRegistryView`,
  o adaptador que já carrega `modelRole` até a borda do `task` tool sem nunca resolvê-lo a um `Model`.
- `packages/conductor-runtime/src/tools/task.ts` (linhas 1-100, 490-550) — `ModelRoleView`,
  `ConductorRoleView`, e o comentário mais importante desta leitura: a descrição verbatim do incidente
  `DEEPSEEK_API_KEY` (uma chave ambiente não intencional levou uma sessão-filha de delegação a chamar um
  provedor pago real, com `allowModelNetwork:false` e sem consentimento, via `findInitialModel`'s passo 5
  — "primeiro modelo disponível com API key válida"). O fix aplicado na Fase 3 (herdar o modelo do pai POR
  REFERÊNCIA) é descrito no próprio código como um contorno, não uma resolução real — "closing the hole
  until a real `modelRole` → `Model` registry exists". Esta é a causa raiz que a Fase 7 precisa fechar, não
  apenas o sintoma que a Fase 3 já conteve.
- `packages/conductor-cli/src/commands/chat.ts` (linhas 300-360) — o comentário que documenta a mesma
  lacuna do ponto de vista do `--role` flag: `role.modelRole` nunca influencia o `model`/`config.provider.model`
  efetivamente usado.
- `packages/conductor-cli/src/commands/config.ts` (linhas 50-180) — `provider.model`/`provider.thinkingLevel`
  como as únicas duas chaves de modelo hoje: um modelo flat por sessão inteira, nenhuma dimensão gate/papel.
- `packages/conductor-cli/src/commands/doctor.ts` (linhas 165-215) — `checkModelResolution`, o único check
  de credencial hoje: um único provider (`config.provider.model`), sem visão por-gate/papel, sem "why".
- `packages/coding-agent/src/core/model-resolver.ts` (arquivo completo, ~775 linhas) — `resolveCliModel`,
  `findInitialModel`, `parseModelPattern`, `defaultModelPerProvider`: o resolvedor genérico de padrão de
  modelo por flag de CLI, gate/papel-agnóstico. `findInitialModel`'s prioridade 4/5 ("saved default from
  settings" → "first available model with a valid API key") é o mecanismo exato do incidente acima.
- `packages/ai/src/auth/credential-store.ts` (arquivo completo) — `InMemoryCredentialStore`, a
  implementação de referência do contrato `CredentialStore` (não a usada em produção pelo `pi`, mas o
  contrato que `AuthStorage` também satisfaz).
- `packages/ai/src/env-api-keys.ts` (linhas 1-60) — detecção de env-var por provedor (`ANTHROPIC_API_KEY`
  etc.), incluindo o padrão de import dinâmico condicional Node-only (browser-safe).
- `packages/ai/src/cli.ts` (arquivo completo, ~120 linhas) — a ferramenta de dev do `pi-ai`: `login
  [provider]`/`list`, grava `auth.json` em texto plano no CWD via `writeFileSync` simples — confirmado NÃO
  ser o alvo de composição (ver princípio orientador acima).
- `packages/coding-agent/src/core/auth-storage.ts` (arquivo completo, ~390 linhas) — `AuthStorage`,
  `FileAuthStorageBackend`: lock via `proper-lockfile`, `chmodSync(0o600)`/dir `0700`, leitura com
  detecção de revisão de arquivo, escrita atômica por provedor. O substrato real de produção — muito mais
  endurecido que `pi-ai/src/cli.ts`.
- `packages/coding-agent/src/core/model-runtime.ts` (linhas 1-90, 480-570) — `ModelRuntime`,
  `CreateModelRuntimeOptions` (`authPath`/`modelsPath`/`allowModelNetwork`), `setRuntimeApiKey`/
  `removeRuntimeApiKey`/`getProviderAuthStatus` (retorna `{configured, source: "runtime"|"stored"|
  "environment"|undefined}` — exatamente a granularidade que `conductor auth`/`models why` precisam
  reportar).
- `packages/conductor-runtime/src/shared-budget.ts` (linhas 1-40) — `SharedBudget`, o cabeçalho que
  documenta as 3 decisões de ADR 0004 §5 que a implementação satisfaz (reserva síncrona, nunca lança,
  ceiling-check em `settle`). Contabilidade de TOKENS — nunca de custo em $, achado usado em G8/BR-6.
- `docs/adr/0004-fase3-roles-skills-subagents.md` (linhas 555-593) — §15 Follow-ups: "Fase 7: model
  routing avançado (o `modelRole` desta fase é a indirection simples)" — confirma que a Fase 3 deixou essa
  indireção deliberadamente simples, para esta fase completar.
- `docs/adr/0002-fase1-cli-foundation.md` (linhas 165-190) — §3.3, a tabela "o que fica de fora": linha
  `packages/providers (model-routing/tiers)` → "`conductor chat` usa um único modelo configurado
  diretamente; não há resolução por gate/papel ainda" → "Fase 7". A mesma linha também associa
  `packages/rpc`/`packages/sdk`/`packages/testing` a "Fase 7 (headless/CI) em diante" — **achado
  secundário, registrado como non-goal explícito abaixo**: modos headless/RPC/SDK são um escopo DIFERENTE
  (execução não-interativa da sessão) do model routing por gate desta fase, mesmo compartilhando o rótulo
  "Fase 7" nessa tabela — a ambiguidade é do ADR 0002, não desta spec, e não deve ser herdada silenciosamente.
- `docs/conductor/pi-conductor-feature-matrix.md` (arquivo completo) — linha **25** ("Model routing
  (roles/tiers + fail-closed on missing critical model)"): confirma `Pi today: no`, nomeia a tabela
  papel→tier (`strategic/planning/standard/fast/lightweight/security/review` — a mesma lista de 7 valores
  do plano §4.15, ecoada aqui), o resolvedor gate→papel→pool→disponibilidade, `model_select` hook como o
  seam real do Pi, e classifica a capacidade inteira como `build`. Nota da própria matriz (linha 120-122):
  "Layout gaps... §6's repo layout has no home for..." — e as notas sobre linhas 13/25 ("the two
  fail-closed builds... Pi supplies no default posture... Conductor writes the `if`-statements and owns
  the default-deny"). **Achado de path confirmado como divergente**: os caminhos que a matriz nomeia
  (`extensions/model-router`, `packages/providers`) **não existem nesta convenção real do repo** — `ls
  packages/` mostra apenas `agent, ai, client, coding-agent, conductor-cli, conductor-config,
  conductor-diary, conductor-library, conductor-project, conductor-runtime, conductor-secrets, evals,
  protocol, server, session-backends, tui`; não há diretório `extensions/` em lugar nenhum do repo
  (confirmado por `ls extensions` → "No such file or directory"). Flagrado, não resolvido — §9 questão 4.
- `CLAUDE.md` (raiz do repo-pai) — seção "### Model roles per gate", a tabela de 14 linhas
  (gate → `@plan`/`@slow`/`@default`/`@smol`) que hoje é prosa de orientação de sessão, não código — o
  requisito de produto real que G3/Grupo C tornam executável.
- `docs/conductor/gate2-spec-fase6.md` — formato de referência (estrutura exata deste documento).

---

## 1. O que já existe vs. o que a Fase 7 constrói

| Capacidade | Já existe | Fase 7 constrói/especifica |
|---|---|---|
| ~40 módulos de provedor (Anthropic/OpenAI/Google/OpenRouter/DeepSeek/Groq/Mistral/xAI/Azure/Bedrock/Ollama/LM Studio/llama.cpp/vLLM/OpenAI-compatible) | **Sim**, `packages/ai` — substrato pronto, confirmado pelo orquestrador (~40 módulos). | Nenhum cliente HTTP de provedor novo. Esta fase COMPÕE sobre o catálogo já existente (`builtinProviders()`), nunca escreve um provider do zero. |
| Armazenamento de credenciais endurecido (lock, permissão restrita, escrita atômica) | **Sim**, `AuthStorage` (`packages/coding-agent/src/core/auth-storage.ts`) — `proper-lockfile`, `chmodSync(0o600)`, dir `0700`. | Reusado por composição — `conductor login/logout/auth` chamam `ModelRuntime`, nunca reimplementam o storage. |
| OAuth device/URL flow, prompt estruturado | **Sim**, `packages/ai/src/auth/oauth/` + `provider.auth.oauth.login()` — já usado pela TUI interativa (`login-dialog.ts`) e pelo CLI de dev do vendor (`pi-ai/src/cli.ts`). | `conductor login <provider>` invoca o MESMO fluxo, headless (sem TUI), persistindo via `AuthStorage` — nunca via o arquivo solto de `pi-ai/cli.ts`. |
| Detecção de env-var (`ANTHROPIC_API_KEY` etc.) | **Sim**, `packages/ai/src/env-api-keys.ts`. | Reusada — `conductor auth`/`models why` reportam quando uma credencial resolveu por env-var. Isto é precisamente o mecanismo que capturou a chave ambiente não intencional no incidente `DEEPSEEK_API_KEY`. |
| `ConductorRole.modelRole: ModelRole` (`strategic`\|`standard`\|`lightweight`) | **Sim**, tipo travado (Fase 3, ADR 0004 §16), validado em frontmatter, carregado pelos 37 papéis built-in hoje. | NUNCA reaberto na forma. Esta fase implementa a RESOLUÇÃO que falta: `modelRole → Model` concreto, por gate. |
| Resolvedor de padrão de modelo por flag de CLI (genérico, gate/papel-agnóstico) | **Sim**, `packages/coding-agent/src/core/model-resolver.ts` (`resolveCliModel`/`findInitialModel`/`parseModelPattern`/`defaultModelPerProvider`). | Reusado como PRIMITIVO ("um texto casa um modelo") — nunca reimplementado. Mas `findInitialModel`'s passo 5 ("primeiro modelo disponível com API key válida") é EXATAMENTE o mecanismo do incidente `DEEPSEEK_API_KEY` e não pode ser o caminho de resolução por-gate sem o consentimento que faltou naquele incidente (FR-7). |
| Budget de tokens compartilhado por árvore de delegação | **Sim**, `SharedBudget` (`packages/conductor-runtime/src/shared-budget.ts`) — reserva síncrona, nunca lança, ADR 0004 §5. | Não redecidido — é uma contabilidade de TOKENS (teto de governança). Distinto de um LEDGER DE CUSTO em $ que esta fase precisa e que não existe hoje (G8, §9 questão 6). |
| `conductor doctor`'s check de "provider credential resolution" | **Sim, mas achatado** — um único provider (`config.provider.model`), sem dimensão gate/papel, sem "why" (`doctor.ts:176-204`). | `conductor models`/`models why` substituem esse escopo achatado por uma visão por-gate/papel. `doctor` pode passar a delegar a esse mecanismo em vez de duplicá-lo (Gate 4). |
| Retry same-model (transitório, não cross-provider) | **Sim**, primitivo do vendor (`set_auto_retry`, matrix row 4 — "same-model transient retry only; no cross-provider fallback"). | Não é fallback — esta fase constrói o fallback CROSS-provider que não existe (Grupo F). |
| Health-check/fallback entre provedores LLM | **Não existe.** Grep zero em `conductor-cli`/`conductor-runtime` para `health`/`fallback`/`HealthCheck` neste tópico. | O gap central desta fase, junto com a resolução `modelRole → Model` — Grupos F/G. |
| `conductor login`/`logout`/`auth`/`models`/`models why` | **Não existem.** Nenhum arquivo de comando correspondente em `packages/conductor-cli/src/commands`. | Os 5 entregáveis literais desta fase (plano linhas 1417-1422). |

---

## 2. Goals

1. **G1 — `conductor login`/`logout`/`auth` autenticam provedores de forma headless, compondo sobre o
   substrato vendor.** Nunca uma segunda implementação de OAuth/armazenamento de credencial. *Grounding:*
   §8.2.
2. **G2 — A resolução `modelRole → Model` concreto passa a existir de verdade.** Fecha o SEAM já
   documentado no próprio código (`chat.ts:328-332`, `task.ts:511-526`) — a causa raiz do incidente
   `DEEPSEEK_API_KEY`, não apenas o contorno que a Fase 3 já aplicou (herança por referência).
3. **G3 — O mapeamento gate → model role é tornado EXECUTÁVEL.** A tabela "Model roles per gate" do
   `CLAUDE.md` deixa de ser prosa de orientação de sessão e passa a ser dado consultável pelo runtime.
   *Grounding:* §8.1.
4. **G4 — `conductor models`/`models why` dão visibilidade e explicabilidade à resolução.** Uma pergunta
   "por que este modelo foi escolhido para este gate" (ou "por que nenhum foi") tem resposta rastreável
   pela cadeia completa do pipeline §4.15.
5. **G5 — Um gate cuja resolução não produz nenhum modelo compatível recusa a execução explicitamente —
   o critério de saída literal do plano.** Nunca um downgrade silencioso de tier. *Grounding:* §8.3.
6. **G6 — Fallback controlado entre provedores, respeitando tier mínimo e consentimento de egress.** Nunca
   automático quando cruza provedor sem os dois. *Grounding:* §8.2, tensão nomeada com BR6 do `CLAUDE.md`
   em §9 questão 3.
7. **G7 — Health check de disponibilidade por provedor é uma verificação de rede simples — nunca um novo
   backend Docker.** Distinto de `cdt up`'s Ollama/ChromaDB (backends que o PRÓPRIO Conductor gerencia
   para RAG/diário); aqui o alvo é a reachability de um endpoint HTTPS remoto (ou local, no caso de
   Ollama/LM Studio/llama.cpp — mas ainda assim um endpoint de rede, não um container que esta fase
   provisiona). *Grounding:* §8.4.
8. **G8 — Uso de tokens e custo em $ são medidos, por gate/papel/sessão, como conceitos DISTINTOS.**
   `SharedBudget` (teto de governança de tokens) não é sobrecarregado para carregar preço por modelo —
   bounded-context separation, prior art do próprio ADR 0004 §5. *Grounding:* §8.5 (declarado como não
   coberto pela biblioteca).

---

## 3. Non-goals (com justificativa)

| Non-goal | Por que fica fora desta fase | Onde pertence |
|---|---|---|
| **Reconciliar os 3 vocabulários de tier** (plano 7 valores / `ModelRole` 3 valores / CLAUDE.md 4 valores) | É exatamente o achado central desta sessão (acima) — uma decisão consequente de segurança, não uma formalidade de nomenclatura. Não decidida por esta BA. | Gate 4 (§9 questão 1) |
| **Escrever um cliente HTTP novo para qualquer provedor** | `packages/ai` já tem ~40 módulos de provedor prontos. Escrever um novo repetiria exatamente o erro que este monorepo já evitou nas Fases 2-6 (nunca reimplementar um substrato vendor maduro). | Já entregue (vendor) |
| **Reimplementar OAuth ou o armazenamento de credenciais** | `packages/ai/src/auth/oauth/` + `AuthStorage` já existem, testados, endurecidos (lock, permissão 0600). Esta fase compõe uma camada de comando fina por cima. | Já entregue (vendor) |
| **Reabrir a forma do tipo `ConductorRole`/`ModelRole`** | Travada por ADR 0004 §16 apêndice na Fase 3. Esta fase resolve `modelRole → Model`, nunca redesenha o campo em si. | Já decidido (ADR 0004) |
| **Modos de execução headless/RPC/SDK** (`packages/rpc`, `packages/sdk`, `packages/testing`) | ADR 0002 §3.3 associa esses pacotes ao rótulo "Fase 7 (headless/CI)" na MESMA linha da tabela que também cita "Fase 7" para model-routing — mas são escopos DIFERENTES (execução não-interativa da sessão vs. resolução de modelo por gate). Esta spec não herda essa ambiguidade silenciosamente: nomeada aqui como fora de escopo desta demanda específica. | Não nomeado — a rotulagem em si é uma questão a esclarecer com quem escreveu o ADR, não decidida aqui |
| **Um novo backend Docker para health check de provedor** | Não há Docker para providers LLM remotos (Anthropic/OpenAI/etc. são endpoints HTTPS de terceiros); mesmo os self-hosted (Ollama/LM Studio/llama.cpp/vLLM) não são containers que ESTA fase provisiona — são instâncias que o usuário já roda separadamente. Health check é rede simples, nunca infraestrutura nova. | N/A — verificação de rede, não infra |
| **Ledger de custo compartilhando a estrutura de `SharedBudget`** | `SharedBudget` é um teto de GOVERNANÇA de tokens (ADR 0004 §5, decisão travada, reusada sem redecidir); um ledger de custo em $ precisa de dados de preço por modelo/provedor que mudam ao longo do tempo — um conceito de OBSERVABILIDADE, não de governança. Misturar os dois arriscaria exatamente o tipo de acoplamento que este monorepo já evitou entre Library (Fase 5, estática/global) e Diary (Fase 6, dinâmico/por-projeto). | Gate 4 (mecanismo físico, §9 questão 6) |
| **Definir os valores numéricos exatos de cooldown/timeout de health check/intervalo de polling** | Comportamento observável definido (Grupo G); os números são uma decisão de arquitetura/tuning. | Gate 4/6 |
| **UI/TUI de status de model routing** (mostrar tier/modelo/custo ao vivo na TUI) | Mesmo padrão já registrado nas specs anteriores desta série: depende de dados que só existem a partir desta fase; cresce organicamente (matrix row 26 já nomeia isso como escopo "build" separado, `conductor-ui`). | Cresce organicamente, não nomeado aqui |

---

## 4. Glossário (linguagem ubíqua)

*Grounding:* **Domain-Driven Design — Complete Professional Guide §1.1/§1.12** (mesma base já usada em
todas as fases desta série) — um vocabulário único evita que "model role", "tier" e "provider" colidam
silenciosamente entre o plano, o código já commitado, e o `CLAUDE.md` — a colisão real é precisamente o
achado central desta sessão.

| Termo | Definição | Fonte |
|---|---|---|
| **Provedor (provider)** | Uma entidade que serve chamadas de modelo (Anthropic, OpenAI, Ollama local, etc.) — já modelada por `packages/ai`'s catálogo de ~40 módulos. Distinto de "modelo": um provedor OFERECE um ou mais modelos. | `packages/ai`; plano §4.15 |
| **Modelo (`Model`)** | Uma referência concreta e resolvida a um modelo específico de um provedor específico (ex.: `anthropic/claude-opus-4-8`) — o tipo `Model<Api>` já existente em `@earendil-works/pi-ai`. O que uma resolução PRODUZ, nunca o que um papel/gate DECLARA diretamente. | `packages/ai` |
| **`ModelRole`** | (Herdado da Fase 3, não redefinido aqui.) O campo de 3 valores (`strategic`\|`standard`\|`lightweight`) que uma `ConductorRole` já carrega — a intensidade PRETENDIDA de um papel, não um modelo concreto. | `role-loader.ts:44` |
| **Model role per gate** (`CLAUDE.md`) | A tabela de 14 linhas gate→`@plan`/`@slow`/`@default`/`@smol` — um eixo DIFERENTE de `ModelRole`: uma indireção por-projeto que o usuário mapeia para um modelo real, própria de cada gate, não de cada papel. Hoje é prosa; G3 a torna executável. | `CLAUDE.md`, seção "Model roles per gate" |
| **"Model role" do plano (§4.15)** | A lista de 7 valores (`strategic/planning/standard/fast/lightweight/security/review`) nomeada no plano como o vocabulário de tier do produto. **Não confirmado equivalente** a nenhum dos dois termos acima — achado central, §9 questão 1. | plano §4.15 |
| **Resolução (de modelo)** | O pipeline `Gate → Model role → Política do projeto → Modelos configurados → Disponibilidade → Modelo selecionado` (plano §4.15) — a função que, dado um gate e/ou papel, produz um `Model` concreto ou uma recusa explícita. | plano §4.15 |
| **Downgrade silencioso** | Quando a resolução substitui o tier pedido por um mais fraco sem sinalizar isso explicitamente — o comportamento que a regra "gate crítico não pode sofrer downgrade silencioso" proíbe (G5). | plano §4.15 |
| **Recusa fail-closed** | Quando a resolução não encontra nenhum modelo compatível, a execução do gate é recusada explicitamente — nunca uma exceção genérica, nunca um substituto silencioso. O comportamento observável do critério de saída literal. | plano §4.15; §8.3 |
| **Fallback (controlado)** | A troca para um modelo/provedor alternativo quando o primário está indisponível, respeitando os 8 critérios do plano §4.15 (tier mínimo, consentimento de egress, compatibilidade de ferramentas, contexto mínimo, cooldown, limites financeiros, residência dos dados, política de privacidade) — nunca uma otimização de custo/velocidade não solicitada. | plano §4.15 |
| **Egress (operação de rede)** | Qualquer chamada que sai do processo local para um provedor/serviço externo — inclui a chamada de modelo em si, um health check, e um fallback cross-provider. Toda egress gera um evento (invariante 17). | plano §10 invariante 17; `CLAUDE.md` BR6 |
| **Consentimento de egress (BR6, `CLAUDE.md`)** | A pergunta padrão do Gate 3 deste projeto: "este recurso encaminha conteúdo para um modelo/provedor/processo diferente do que o usuário está ativamente usando?" Se sim: divulgar o destino, usar o piso do mesmo provedor como padrão, falhar fechado se indisponível, exigir opt-in explícito para egress cross-provider. **Tensão nomeada, não resolvida, com o "tier mínimo" do fallback** — §9 questão 3. | `CLAUDE.md`, regra 2 |
| **Health check (de provedor)** | Uma verificação de disponibilidade de rede de um provedor — nunca um serviço Docker que esta fase provisiona. Distinto do "backend" que `cdt up` já gerencia (Ollama/ChromaDB, para RAG/diário — infraestrutura do PRÓPRIO Conductor, não um provider LLM arbitrário do usuário). | plano §4.15 (implícito em "Disponibilidade"); G7 |
| **Ledger de custo** | Um registro derivado de $ por chamada/gate/papel/sessão, calculado a partir de uma tabela de preço por modelo — DISTINTO de `SharedBudget` (teto de tokens, governança). O termo que esta fase introduz — não existia em nenhuma fase anterior. | G8; glossário desta spec |
| **Credencial** | Um segredo (API key ou token OAuth) que autentica uma sessão contra um provedor — já modelado pelo tipo `Credential` de `@earendil-works/pi-ai` (`type: "api_key"` \| tipos OAuth), persistido via `AuthStorage`. | `packages/ai`, `auth-storage.ts` |

---

## 5. Requisitos funcionais (FR)

*Grounding para Given/When/Then:* **Specification by Example — Complete Professional Guide §2.12/§2.13**
(mesma base já usada em todas as fases desta série).

### Grupo A — Autenticação headless (`conductor login`/`logout`/`auth`) — G1

**FR-1 — `conductor login <provider>` autentica um provedor headless, persistindo via o substrato
endurecido.**
> Given um provedor conhecido (ex.: `anthropic`) e nenhuma credencial armazenada ainda,
> When alguém roda `conductor login anthropic`,
> Then o fluxo apropriado ao provedor (OAuth device/URL, ou prompt de API key quando o provedor não
> oferece OAuth) é conduzido headless (sem TUI interativa), e a credencial resultante é persistida via
> `AuthStorage` (lock + permissão `0600`) — nunca um arquivo próprio, paralelo e menos endurecido.

**FR-2 — `conductor login` sem provider lista as opções conhecidas e solicita a escolha.**
> Given nenhum provider passado como argumento,
> When alguém roda `conductor login`,
> Then a lista de provedores conhecidos é apresentada (mesma disciplina de listagem já usada por
> `pi-ai/src/cli.ts`'s próprio `login` sem argumento, adaptada headless) — nunca um erro genérico "provider
> required" sem contexto do que é válido.

**FR-3 — `conductor logout <provider>` remove a credencial armazenada.**
> Given uma credencial armazenada para um provider,
> When alguém roda `conductor logout <provider>`,
> Then a credencial é removida do armazenamento persistente — nunca apenas "esquecida" da sessão corrente
> em memória enquanto o arquivo em disco continua com o segredo.

**FR-4 — `conductor logout` de um provider sem credencial armazenada reporta isso explicitamente.**
> Given nenhuma credencial armazenada para um provider,
> When alguém roda `conductor logout <provider>`,
> Then o comando reporta explicitamente que não havia nada a remover — nunca finge sucesso de uma remoção
> que não aconteceu (BR-9).

**FR-5 — `conductor auth` relata o status de credencial por provedor, com a origem exata.**
> Given um projeto com alguns provedores autenticados por credencial armazenada, outros por env-var, e
> outros sem nenhuma credencial,
> When alguém roda `conductor auth`,
> Then cada provedor conhecido aparece com seu status (`configured`/`not configured`) e, quando
> configurado, sua origem exata (`runtime`/`stored`/`environment`) — reusando `ModelRuntime.getProviderAuthStatus`,
> nunca um "configurado: sim/não" que esconde de onde a credencial realmente veio.

### Grupo B — Resolução `modelRole → Model` (G2)

**FR-6 — Um `modelRole` resolve a um `Model` concreto quando existe ao menos um provedor compatível
autenticado e disponível.**
> Given uma `ConductorRole` com `modelRole: "strategic"` e ao menos um modelo mapeado a esse tier com
> credencial válida,
> When a resolução roda para essa role,
> Then um `Model` concreto é retornado — a mesma role, invocada de novo sob as mesmas condições, resolve
> ao MESMO modelo (determinístico, não uma escolha aleatória entre candidatos empatados sem critério
> declarado).

**FR-7 — A resolução nunca reintroduz "primeiro modelo disponível com API key válida" sem consentimento
explícito.**
> Given um `modelRole` sem um modelo explicitamente mapeado pela política do projeto,
> When a resolução tenta encontrar um candidato,
> Then ela NUNCA cai automaticamente no comportamento do passo 5 de `findInitialModel` ("primeiro modelo
> disponível com QUALQUER API key presente no ambiente") — esse é exatamente o mecanismo do incidente
> `DEEPSEEK_API_KEY` (uma chave ambiente não intencional autorizando silenciosamente uma chamada paga e
> não consentida). Fecha a causa raiz, não apenas o sintoma que a Fase 3 já conteve por herança-por-referência.

**FR-8 — Um `modelRole` sem nenhum provedor configurado/disponível resolve para ausência explícita.**
> Given um `modelRole` para o qual nenhum modelo com credencial válida existe,
> When a resolução roda,
> Then o resultado é um valor explícito de "nenhum modelo resolvido", nomeando o `modelRole` que faltou —
> nunca uma exceção genérica sem contexto, e nunca uma substituição silenciosa por outro tier.
> *Grounding:* §8.2 (secure by default, failing safely).

### Grupo C — Mapeamento gate → model role (G3, torna a tabela do `CLAUDE.md` executável)

**FR-9 — Cada um dos 14 gates tem um model role mapeado, consultável programaticamente.**
> Given a tabela "Model roles per gate" do `CLAUDE.md` (hoje prosa),
> When o runtime precisa saber qual model role um gate usa,
> Then a resposta vem de um dado estruturado (não de uma releitura do Markdown em tempo real) — a MESMA
> informação, agora executável. *Grounding:* §8.1.

**FR-10 — Um gate sem model role mapeado é um erro de configuração explícito.**
> Given um gate cujo número não tem entrada no mapeamento (ex.: uma extensão futura de gate customizado),
> When a resolução é solicitada para esse gate,
> Then o erro nomeia exatamente qual gate não tem mapeamento — nunca cai silenciosamente em um default
> genérico não declarado.

**FR-11 — O mapeamento gate → model role é sobreponível por política de projeto.**
> Given a "Política do projeto" que o pipeline §4.15 nomeia como uma etapa própria (entre "Model role" e
> "Modelos configurados"),
> When um projeto declara uma política própria para um gate (ex.: "Gate 8 usa `@plan` neste projeto, não
> `@slow`"),
> Then essa sobreposição é respeitada — o mapeamento do `CLAUDE.md` é um DEFAULT do projeto, nunca um valor
> imutável hardcoded no runtime.

### Grupo D — Visibilidade e explicabilidade (`conductor models`/`models why`) — G4

**FR-12 — `conductor models` lista, por gate, o model role mapeado e o modelo concreto resolvido (ou
"nenhum").**
> Given os 14 gates com seus model roles mapeados,
> When alguém roda `conductor models`,
> Then uma tabela mostra, por gate: o model role, e o `Model` concreto resolvido — ou "nenhum modelo
> compatível" quando a resolução falha, nunca uma linha vazia sem explicação.

**FR-13 — `conductor models why <gate>` explica a cadeia de resolução completa.**
> Given um gate específico,
> When alguém roda `conductor models why 9`,
> Then a saída narra cada etapa do pipeline (`Gate → Model role → Política do projeto → Modelos
> configurados → Disponibilidade → Modelo selecionado`), nomeando em qual etapa a cadeia parou quando não
> resolveu — nunca apenas o resultado final sem o "porquê".

### Grupo E — Recusa fail-closed (G5, o critério de saída literal do plano)

**FR-14 — Um gate cuja resolução não produz nenhum modelo compatível recusa a execução explicitamente.**
> Given o exemplo literal do plano ("Gate 9 requer security. Nenhum modelo security está configurado."),
> When o runtime tenta iniciar a execução desse gate,
> Then a execução é RECUSADA com uma mensagem nomeando o gate e o model role que faltou — nunca um
> downgrade silencioso para outro tier disponível, e nunca uma execução que prossegue "mesmo assim".
> *Grounding:* §8.3.

**FR-15 — A recusa fail-closed é universal por gate; os 5 mandatórios adicionalmente vedam fallback
automático sem confirmação.**
> Given os 5 gates mandatórios `{3,5,7,8,9}` (nunca colapsáveis, `CLAUDE.md` regra 2) e os demais 9 gates,
> When a resolução falha para qualquer gate,
> Then TODOS os 14 recusam a execução sem modelo compatível (FR-14 é universal) — mas, adicionalmente, os
> 5 mandatórios NUNCA acionam um fallback automático (Grupo F) sem confirmação explícita, mesmo quando um
> candidato de tier inferior estaria tecnicamente disponível. **Hipótese de trabalho desta spec, não uma
> decisão fechada** — §9 questão 2 registra as leituras alternativas do texto literal do plano.

### Grupo F — Fallback controlado (G6) — a tensão com BR6 (egress-consent) nomeada, não resolvida

**FR-16 — Um fallback só é considerado quando o modelo/tier mapeado está genuinamente indisponível.**
> Given um modelo primário resolvido e disponível,
> When a execução do gate roda normalmente,
> Then nenhum fallback é acionado — fallback nunca é uma otimização de custo/velocidade não solicitada,
> apenas uma resposta a indisponibilidade real (falha de auth, health check negativo, erro do provedor).

**FR-17 — Um fallback respeita tier mínimo.**
> Given um modelo primário indisponível e um candidato de fallback de tier mais fraco que o mapeado,
> When o fallback é avaliado,
> Then esse candidato mais fraco é rejeitado — fallback nunca deriva silenciosamente para um tier inferior
> ao que o gate exige (plano §4.15, invariante 16).

**FR-18 — Um fallback que cruza provedor exige consentimento explícito de egress.**
> Given um modelo primário indisponível e um candidato de fallback do MESMO tier, mas de um provedor
> DIFERENTE do que o usuário está ativamente usando,
> When o fallback é avaliado,
> Then ele só prossegue com consentimento de egress explícito (BR6 do `CLAUDE.md`: divulgar destino, piso
> do mesmo provedor como default, falhar fechado se indisponível, opt-in explícito para cruzar provedor) —
> nunca automático. **A ordem exata entre "tier mínimo" (plano) e "piso do mesmo provedor primeiro" (BR6)
> quando os dois apontam para candidatos diferentes é a tensão central desta fase — §9 questão 3, não
> resolvida aqui.**

**FR-19 — Toda operação de fallback gera um evento de egress registrado.**
> Given qualquer fallback acionado (dentro ou fora do mesmo provedor),
> When ele ocorre,
> Then um evento de egress é registrado (plano invariante 17) — nunca uma troca silenciosa sem rastro.

### Grupo G — Health check de provedor (G7)

**FR-20 — Um provedor é verificável quanto à disponibilidade de rede antes de ser oferecido como
candidato de resolução/fallback.**
> Given um provedor configurado (remoto ou self-hosted como Ollama/LM Studio/llama.cpp/vLLM),
> When a resolução ou o fallback avaliam candidatos,
> Then a disponibilidade de rede desse provedor é verificável — uma checagem de rede simples (HTTP/HTTPS),
> nunca um serviço Docker que esta fase provisiona (distinto do `cdt up`'s Ollama/ChromaDB, que são
> backends do PRÓPRIO Conductor para RAG/diário, não providers arbitrários do usuário). *Grounding:* §8.4.

**FR-21 — Uma falha de health-check nunca derruba o comando inteiro.**
> Given múltiplos provedores configurados, um deles indisponível,
> When `conductor models`/`auth`/a resolução rodam,
> Then o provedor indisponível é reportado como tal — os demais continuam funcionando normalmente (mesma
> disciplina "uma checagem falha nunca derruba as outras" já em uso em `doctor.ts`).

### Grupo H — Custo e tokens (G8)

**FR-22 — Uso de tokens é atribuível por gate/papel/invocação, não apenas o teto agregado.**
> Given uma sessão que passa por múltiplos gates/papéis, cada um consumindo tokens,
> When alguém consulta o uso,
> Then o consumo é atribuível a QUAL gate/papel o gerou — distinto do teto agregado que `SharedBudget` já
> mede (que sabe "quanto resta", não "quem gastou o quê").

**FR-23 — Custo em $ é calculado quando uma tabela de preço por modelo está disponível; sua ausência é
reportada explicitamente.**
> Given um modelo cujo preço por token não está mapeado em nenhuma tabela conhecida,
> When o custo de uma invocação é reportado,
> Then a ausência de preço é reportada explicitamente ("custo desconhecido para este modelo") — NUNCA
> estimado silenciosamente como zero ou como uma média de outros modelos.

---

## 6. Business rules

| # | Regra | Fonte | FRs relacionados |
|---|---|---|---|
| **BR-1** | Uma credencial nunca é persistida em texto plano fora do storage já endurecido do vendor (`AuthStorage`: lock + `0600`/`0700`) — `conductor login` nunca escreve seu próprio arquivo paralelo (o mesmo anti-padrão que `pi-ai/src/cli.ts` tem e que esta fase explicitamente NÃO copia). | `auth-storage.ts` (comportamento de referência); Security Engineering Principles §2.2 (§8.2) | FR-1, FR-3 |
| **BR-2** | Um `modelRole` sem modelo resolvível nunca é tratado como "usa qualquer modelo disponível" — resolve para ausência explícita. Fecha a CAUSA RAIZ do incidente `DEEPSEEK_API_KEY`, não apenas o sintoma que a Fase 3 já conteve. | `task.ts:511-535` (o próprio incidente documentado no código); Security Engineering Principles §2.2 (§8.2) | FR-7, FR-8 |
| **BR-3** | Um gate cujo tier mapeado não tem modelo compatível nunca sofre downgrade silencioso — a regra literal do plano §4.15, testada pelo próprio exemplo do plano ("Gate 9 requer security..."). | plano §4.15; §10 invariante 5 | FR-14, FR-15 |
| **BR-4** | Fallback nunca cruza provedor sem consentimento de egress explícito (plano §4.15's própria lista de restrições de fallback + invariante 17 + `CLAUDE.md` BR6). **A reconciliação exata entre "tier mínimo" (plano) e "piso do mesmo provedor" (BR6) é uma tensão registrada, não resolvida aqui — §9 questão 3.** | plano §4.15; `CLAUDE.md` regra 2 (BR6); §10 invariante 16/17 | FR-17, FR-18, FR-19 |
| **BR-5** | Toda operação de rede do model routing (resolução, health check, fallback, refresh de catálogo) gera um evento de egress — invariante 17 literal. | plano §10 invariante 17 | FR-19, FR-20 |
| **BR-6** | O teto de tokens (`SharedBudget`) e o ledger de custo em $ são conceitos DISTINTOS — `SharedBudget` nunca é sobrecarregado para carregar preço por modelo. | ADR 0004 §5 (decisão travada, não redecidida); prior art do próprio monorepo (separação Library/Diary, Fases 5/6) | G8, FR-22, FR-23 |
| **BR-7** | O "model role" do plano (7 valores), o `ModelRole` já commitado (3 valores) e o "model role per gate" do `CLAUDE.md` (4 valores) NÃO são automaticamente equivalentes — esta spec não assume uma tradução implícita entre eles. Achado central desta sessão (cabeçalho), §9 questão 1. | Achado desta sessão — comparação direta dos 3 arquivos-fonte | Todos os FRs do Grupo B/C |
| **BR-8** | Health check nunca é uma dependência bloqueante de latência perceptível no turno em andamento — mesma disciplina já estabelecida na Fase 6 (BR-6 daquela spec) para captura automática, aplicada aqui a verificação de disponibilidade de provedor. | Prior art do próprio monorepo (`gate2-spec-fase6.md` BR-6); Reactive Systems §2.12/3.12/3.5 (§8.4) | FR-20, FR-21 |
| **BR-9** | `conductor logout` nunca falha silenciosamente — reporta explicitamente quando não havia credencial armazenada para o provedor. | Mesma disciplina "nunca finge sucesso de algo que não aconteceu" já estabelecida em specs anteriores desta série para operações de remoção/correção | FR-4 |
| **BR-10** | Um provedor sem preço mapeado nunca tem seu custo estimado silenciosamente como zero — a ausência é reportada, nunca inventada. | Mesma disciplina de "campo ausente é omitido, nunca inventado" já estabelecida na Fase 6 (BR-3 daquela spec, para proveniência) | FR-23 |

---

## 7. Edge cases

1. **Nenhum provedor autenticado ainda** (`conductor models`/`auth` num projeto novo). Resposta explícita
   ("nenhum provedor configurado, rode `conductor login <provider>`"), nunca uma tabela vazia sem
   explicação — mesmo padrão já estabelecido nas Fases 5/6 para corpus/diário vazios.
2. **Um gate mapeado para um model role que nenhum papel/provedor jamais oferece** (ex.: `security` do
   plano, sem equivalente em `ModelRole`). Recusa nomeando exatamente a lacuna (BR-7) — não um erro
   genérico, uma consequência direta e testável do achado central desta sessão.
3. **`conductor login` interrompido no meio do fluxo OAuth** (ex.: usuário fecha o navegador antes de
   completar). Nenhuma credencial parcial/corrompida é persistida — a mesma atomicidade que
   `AuthStorage`'s escrita-então-`chmod` já garante, reusada sem redecidir.
4. **Uma credencial válida por env-var E uma credencial stale gravada em `auth.json` para o mesmo
   provedor.** A ordem de prioridade é explícita e testável: `runtime > stored > environment` — a mesma
   ordem que `ModelRuntime.getProviderAuthStatus` já implementa. Esta spec declara essa ordem como
   CONTRATO (FR-5), não como acidente de implementação a ser redescoberto depois.
5. **Health check contra um provedor self-hosted (Ollama/LM Studio/llama.cpp/vLLM) que está desligado.**
   Reportado como "indisponível" — distinto de "mal configurado" (mensagens diferentes, para não confundir
   um usuário que só esqueceu de iniciar o serviço local com um erro de configuração real).
6. **Fallback dispara repetidamente contra o mesmo provedor indisponível, sem cooldown.** O plano já lista
   "cooldown" como uma das 8 restrições de fallback (§4.15) — a ausência de cooldown geraria looping caro
   e é explicitamente inaceitável, mesmo que o valor numérico exato seja Gate 4/6.
7. **Duas sessões concorrentes chamando `conductor login`/`logout` para o mesmo provedor ao mesmo tempo.**
   Nenhuma corrompe o arquivo — já garantido pelo lock de `AuthStorage`, reusado, não redecidido aqui
   (mesma classe de garantia que `gate-state-store.ts`/`grounding-ledger.ts` já entregam em domínios
   irmãos deste monorepo).
8. **`conductor models why <gate>` para um número de gate fora de 1-14.** Recusa nomeando o intervalo
   válido — mesma disciplina já estabelecida na Fase 5 (BR-8 daquela spec) para `--gate` fora do intervalo.
9. **Um projeto configura uma política de override (FR-11) que aponta para um modelo que não existe em
   nenhum provedor conhecido.** Erro explícito nomeando o modelo inválido no momento da resolução — nunca
   aceito silenciosamente como "válido, mas nunca resolve".

---

## 8. Grounding (biblioteca) — consultas desta sessão

Rodadas de `C:\development\source\projects\conductor` via `cdt library "<pergunta>" --gate <N>` (backend
saudável). **Cobertura honesta: todos os resultados abaixo são moderados (0.53-0.62), nenhum forte — reportado
como tal, não forçado**, consistente com o padrão já estabelecido nas Fases 5/6 desta série para tópicos
agente-nativos/LLM-específicos que o corpus (majoritariamente arquitetura/engenharia geral) não cobre em
profundidade.

1. **Roteamento por papel/tier como alavanca de custo (classification-then-routing)** → **Prompt
   Engineering — Principles, Patterns and Practice §8.2 "The Pipeline Patterns"** (top **0.604**:
   "Classification-then-routing... the cleanest cost lever... a small model with a 200-token prompt") —
   base direta de G1-G3/FR-9/FR-11: o mapeamento gate→tier É essa alavanca de custo, formalizada. Eco
   secundário (mais fraco) em *Context Engineering* e *Enterprise Application Architecture Patterns* na
   mesma rodada, não citados individualmente por não acrescentarem além da primária.
2. **Armazenamento seguro de credenciais, OAuth device flow, secure defaults** → **Security Engineering
   Principles — Complete Professional Guide §2.2 "secure by default and failing safely"** (top **0.613**)
   — base direta de BR-1/BR-2/FR-7/FR-8/FR-14 (fail-closed em toda a cadeia de autenticação e resolução).
   *Nota de cobertura:* a mesma rodada retornou *Penetration Testing — Complete Professional Guide*
   §14.9/14.2/14.5, mas esses trechos são **frontend-flavored** (secrets em código client-side) — usados
   com cautela, não como base para as reivindicações específicas de CLI/backend deste documento.
3. **Falha fechada quando não há fallback possível ("a call has no fallback and the request cannot
   proceed")** → **Stability Patterns for Production — Complete Professional Guide §2.12 "When not to put
   a dependency behind a circuit breaker"** (top **0.593**/**0.581**: "The call has no fallback and the
   request cannot proceed without it... Trip the breaker and the user gets the same error the timeout
   would...") — base direta de G5/FR-14/FR-15, o critério de saída literal do plano: um gate sem modelo
   compatível é exatamente esse caso — não há fallback aceitável, então a recusa explícita e imediata é o
   comportamento correto, não uma degradação silenciosa.
4. **Dependência externa falhando de forma independente; quando NÃO ser reativo** → **Reactive Systems —
   Complete Professional Guide §2.12/§3.12/§3.5** (top **0.571**) — base de G7/FR-20/FR-21: um health
   check de provedor pode permanecer síncrono/best-effort (não precisa de uma arquitetura reativa
   dedicada), a mesma leitura já aplicada nas Fases 5/6 para escolhas de mecanismo simples sobre
   infraestrutura nova.
5. **Medição de custo e uso de tokens de chamadas LLM multi-provedor** → **cobertura fraca/fora do alvo**
   (melhor resultado desta sessão: *Solution Architecture — Complete Professional Guide* §3.11, top
   **0.532**, sobre trade-offs de custo de CLOUD genéricos, não telemetria de LLM). **A biblioteca não
   cobre isto especificamente** — declarado, não forçado. G8/BR-6 são fundamentados em prior art do
   próprio monorepo: a separação já estabelecida entre `SharedBudget` (governança, ADR 0004 §5) e um
   conceito de observabilidade novo (ledger de custo), pelo mesmo raciocínio de bounded-context já usado
   entre Library (Fase 5) e Diary (Fase 6).
6. **Resolução em cascata de configuração com recusa quando nenhuma opção satisfaz um requisito mínimo
   obrigatório** → **Solution Architecture — Complete Professional Guide §3.5** (top **0.593**: "the
   solution is derived from prioritized drivers... and the chosen trade-offs are recorded so they can be
   revisited") — eco secundário do item 3 acima para o pipeline `Gate → Model role → Política → Modelos →
   Disponibilidade → Modelo selecionado` como uma cascata de resolução com critério de parada explícito.
7. **Vocabulário unificado evitando colisão de termos (glossário)** → **Domain-Driven Design — Complete
   Professional Guide §1.1/§1.12** (mesma base de todas as fases desta série) — base do §4, e
   especificamente do achado central (a colisão real entre os 3 vocabulários de tier é exatamente o tipo
   de falha que uma linguagem ubíqua única deveria ter prevenido).
8. **Given/When/Then, exemplos concretos** → **Specification by Example — Complete Professional Guide
   §2.12/§2.13** (mesma base de todas as fases) — base de todo o §5.

---

## 9. Questões abertas para o Gate 3 (ameaças) e Gate 4 (arquitetura)

Registradas aqui porque nasceram durante a especificação, mas **não são decisões desta BA** — são insumo,
não resposta.

1. **Reconciliação dos 3 vocabulários de tier — o achado central desta sessão.** O plano (7 valores:
   `strategic/planning/standard/fast/lightweight/security/review`) vs. `ModelRole` já commitado (3
   valores) vs. `CLAUDE.md`'s model role per gate (4 valores, eixo já declaradamente distinto de
   `ModelRole`). O tier `security`, usado no próprio exemplo canônico do critério de saída do plano, não
   existe em nenhum tipo do código hoje. Uma extensão de `ModelRole` para cobrir os 7 valores do plano é
   plausível, mas tem o MESMO risco que a Fase 6 já nomeou para o `kind` do diário (§9 questão 5 daquela
   spec): duas fontes de verdade divergentes se a tradução não for 1:1 limpa. Gate 4.
2. **Escopo exato de "gate crítico" na regra fail-closed.** Esta spec assumiu, como hipótese de trabalho
   (FR-15): a recusa fail-closed (G5) é universal por gate (todos os 14), mas o VETO a fallback automático
   sem confirmação se aplica adicionalmente aos 5 mandatórios `{3,5,7,8,9}`. O texto literal do plano
   ("Gate 9 requer security... execução recusada") não distingue explicitamente entre "todo gate" e "só os
   mandatórios" — a leitura alternativa (só os 5 mandatórios têm a garantia fail-closed; os demais 9
   poderiam, em tese, aceitar um downgrade configurável) não foi descartada, apenas não escolhida aqui sem
   confirmação. Gate 3/4.
3. **Reconciliação BR6 (egress-consent, `CLAUDE.md`) com "tier mínimo" (plano §4.15) — a tensão de desenho
   real desta fase.** O plano lista "tier mínimo" como a PRIMEIRA restrição de fallback; BR6 exige "piso do
   mesmo provedor como default" antes de qualquer cruzamento de provedor. Quando os dois critérios apontam
   para candidatos DIFERENTES (ex.: um modelo de tier mais forte só existe em outro provedor, vs. um
   modelo do MESMO provedor mas de tier mais fraco), qual vence? Esta spec NÃO resolve — nomeada
   explicitamente como a decisão de desenho mais consequente desta fase, a ser fechada no Gate 3 (onde a
   pergunta padrão de egress-consent já é obrigatória a cada rodada) e ratificada no Gate 4 (ADR).
4. **Onde este pacote vive no monorepo.** A feature matrix (Fase 0, Gate 4) nomeia `extensions/model-router`/
   `packages/providers`, mas `extensions/` não existe nesta convenção real do repo (confirmado por `ls`),
   e `packages/providers` também não existe — a convenção real é `conductor-*` (`conductor-cli`,
   `conductor-config`, `conductor-diary`, `conductor-library`, `conductor-project`, `conductor-runtime`,
   `conductor-secrets`). Candidato provável: um novo `packages/conductor-providers`, ou uma extensão de
   `conductor-runtime`/`conductor-config` — não decidido aqui, mesmo padrão de "path mismatch flagrado, não
   silenciosamente adotado" já usado nesta sessão para outros achados. Gate 4.
5. **Mecanismo exato de health check** (polling periódico vs. sob-demanda no momento da resolução vs. cache
   com TTL) e o valor numérico de cooldown de fallback (edge case 6). Comportamento observável definido
   (Grupo G); o mecanismo é Gate 4/6.
6. **Pacote físico do ledger de custo** (estende `conductor-runtime`, vive no `conductor-providers` novo, ou
   é um `conductor-cost` dedicado) — a separação CONCEITUAL de `SharedBudget` está decidida (BR-6); o
   pacote físico não. Gate 4.
7. **`conductor auth` vs. `conductor models`: sobreposição de escopo.** `auth` relata credenciais por
   provedor; `models`/`models why` relatam resolução por gate. Existe uma pergunta análoga à "recall vs.
   search" já registrada na Fase 6 (§9 questão 1 daquela spec): os dois comandos podem, na prática,
   colapsar em um verbo com sub-flags, ou são genuinamente distintos porque "identidade de credencial" e
   "resolução de modelo por gate" são conceitos diferentes? Esta spec assume distintos como hipótese de
   trabalho (Grupos A e D), não decidida. Gate 4.
8. **A resolução PRIMÁRIA (não-fallback) também deve checar compatibilidade de ferramentas/contexto
   mínimo?** O plano lista essas duas restrições explicitamente para FALLBACK (§4.15); não fica claro se a
   resolução primária (Grupo B) também precisa validá-las, ou se a resolução primária confia inteiramente
   na configuração do projeto e só o fallback precisa dessas checagens adicionais como salvaguarda de um
   candidato escolhido automaticamente. Gate 4.

---

## Registro no diário

`cdt journal add --gate 1 --kind decision` e `--gate 2 --kind decision` registrados a partir de
`C:\development\source\projects\conductor\pi` ao final desta sessão, resumindo: 23 FRs em 8 grupos (A-H),
10 business rules, 9 edge cases, e 8 questões em aberto para os Gates 3/4 — a mais central sendo a
descoberta de 3 vocabulários de tier de modelo incompatíveis coexistindo neste monorepo (plano §4.15: 7
valores; `ModelRole` já commitado: 3 valores; `CLAUDE.md`'s model role per gate: 4 valores, eixo já
declaradamente distinto), com o tier `security` — usado no próprio exemplo canônico do critério de saída
do plano — sem equivalente em nenhum tipo de código existente hoje; e a tensão de desenho real entre "tier
mínimo" (ordem de prioridade do plano para fallback) e "piso do mesmo provedor" (BR6/egress-consent do
`CLAUDE.md`), nomeada e não resolvida, a decisão mais consequente para o Gate 3 desta fase.
