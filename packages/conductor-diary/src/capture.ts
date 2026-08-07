/**
 * @conductor/diary -- capture.ts (D5/G7, ADR 0007 §7 + §16 Apêndice;
 * docs/adr/0007-fase6-diary-and-capture.md).
 *
 * GATE 5 (test-first): `curateCaptureEvent` is a STUB that throws "not implemented" -- Gate 6
 * implements the body.
 *
 * PURA (§7.3: "a curadoria de um evento em JournalAddInput é uma função PURA -- ela decide O QUE POUCO
 * persistir; a ESCRITA (redação + append) é o JournalWriter. Pureza na decisão de minimização, I/O na
 * borda"): mapeia um evento de ciclo de vida do `pi` a NO MÁXIMO um `JournalAddInput` curado (ou
 * `null`). Nunca toca disco, nunca bloqueia o turno (FR-16/BR-6, §7.3) -- síncrona e barata; o sync
 * remoto (se algum dia configurado -- non-goal §3 da spec) é desacoplado a jusante.
 *
 * A MINIMIZAÇÃO NA ORIGEM vive aqui -- o controle PRIMÁRIO (R42/T61, §7.2; D8/redação é o
 * complementar, §10.2, "`redactSecrets` casa padrões conhecidos, não um segredo de negócio arbitrário
 * em prosa"): grava o MÍNIMO curado -- metadado estruturado (gate, `kind` inferido, sessão, timestamp)
 * + um RESUMO CURTO, NUNCA o corpo verbatim de mensagens/tool-calls. Só
 * `decision|error|solution|checkpoint` são auto-capturados (FR-14) -- não todo evento; um evento sem
 * conteúdo curável mapeia a `null` (nunca uma entrada vazia/lixo).
 *
 * Os 4 eventos discretos, alto sinal (D5 §7.1) -- NUNCA `message_update` (o stream bruto, raiz de T61):
 *   - `turn-end`: um turno completo pode conter uma decisão/erro/solução/checkpoint (uma unidade curável).
 *   - `agent-settled`: um subagente terminou; seu resultado é curável, ROTULADO com a sessão do
 *     subagente (FR-17 -- "nunca fundido sem rótulo na sessão do orquestrador; a separação de sessões
 *     da Fase 3 NÃO é reaberta aqui, é respeitada").
 *   - `session-shutdown`: um checkpoint de fim de sessão.
 *   - `gate-concluded`: o sinal que a máquina de gates (Fase 4) emite ao aprovar/rejeitar -> uma
 *     entrada decision/checkpoint amarrada ao gate.
 *
 * `cfg.captureHighRiskBodies` default FALSE (R42/T61 secure-default, §7.2: "a íntegra de um
 * tool-result, o corpo de uma mensagem -- capturá-los exige opt-in explícito... é uma decisão de
 * secure-default porque a captura, por observar, tem uma superfície maior que a escrita manual"). O
 * `text` curado resultante NUNCA amplia um `summary` em algo maior/mais verbatim -- esta função só tem
 * acesso ao `summary` já resumido por quem chamou (`CaptureEvent` não carrega um corpo bruto/tool-
 * result em nenhuma variante), então "não amplia" é uma propriedade estrutural do tipo de entrada, que
 * esta função não pode e não deve violar adicionando conteúdo que não veio de `summary`.
 *
 * Tool call rotulado distintamente de prosa (FR-15, §7.2) e multi-campo passa pela deep-redação de D8
 * (T62) -- ambos são responsabilidade do `JournalWriter` no ponto único de escrita (BR-2), não desta
 * função pura.
 *
 * `rawBufferLimit` (FR-18/T64/R45, §7.2): o buffer BRUTO é podado além do limite configurado; o diário
 * CURADO já promovido a entrada formal NUNCA é podado -- essa poda é responsabilidade de quem gerencia
 * o buffer bruto (fora do escopo desta função pura, que só cura UM evento por vez).
 *
 * DECIDED AMBIGUITY -- rótulo de subagente (FR-17, §7.1): `JournalAddInput` (journal-entry.ts) não tem
 * um campo dedicado `parentSessionId`. Este arquivo decide (Gate 5, documentado aqui para Gate 6 e
 * test/capture.test.ts confirmarem/ajustarem se necessário): o `JournalAddInput.sessionId` resultante
 * de um evento `agent-settled` é `event.sessionId` (a sessão do PRÓPRIO subagente -- NUNCA sobrescrita
 * por `event.parentSessionId`, preservando a separação de sessões da Fase 3), e o `text` carrega um
 * prefixo curto que nomeia `event.parentSessionId` (a única superfície disponível no tipo atual para
 * carregar esse segundo dado) -- nunca fundido silenciosamente sem esse rótulo.
 *
 * DECIDED AMBIGUITY -- quando retornar `null` (§16: "mapeia... a NO MÁXIMO um JournalAddInput curado
 * (OU null)", sem enumerar o caso exato): este arquivo decide, seguindo o exemplo que a própria tarefa
 * de Gate 5 sugeriu, que um `summary` vazio (string vazia após trim) não tem conteúdo curável -> `null`.
 * Gate 6 pode achar outros casos (Gate 6 decide o corpo real); este é o único que Gate 5 trava por teste.
 */

import type { JournalAddInput } from "./journal-entry.ts";

export interface CaptureConfig {
	/** default true (só para eventos curados). */
	enabled: boolean;
	/** default FALSE (R42/T61 secure-default): íntegra de tool-result/corpo de mensagem OFF por padrão. */
	captureHighRiskBodies: boolean;
	/** FR-18/T64/R45: buffer BRUTO podado além disto; o curado NUNCA é podado. */
	rawBufferLimit: number;
}

/** Os eventos de ciclo de vida do `pi` que a captura assina (D5) -- discretos, alto sinal; NUNCA
 *  `message_update` (o stream bruto). `agent-settled` carrega `parentSessionId` para o rótulo de
 *  subagente (FR-17). */
export type CaptureEvent =
	| { kind: "turn-end"; sessionId: string; summary: string; gate?: number }
	| { kind: "agent-settled"; sessionId: string; parentSessionId: string; summary: string; gate?: number }
	| { kind: "session-shutdown"; sessionId: string; summary: string }
	| { kind: "gate-concluded"; gate: number; sessionId: string; outcome: string };

export function curateCaptureEvent(_event: CaptureEvent, _cfg: CaptureConfig): JournalAddInput | null {
	throw new Error("not implemented");
}
