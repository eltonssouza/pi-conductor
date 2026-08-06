/**
 * Fail-closed wrapper for policy evaluation (gate3-threat-model.md §4 T3, §5 item 7):
 * "FAIL-CLOSED é a regra-mãe: sempre que a avaliação da política em si falhar (exceção, realpath
 * erra, política ilegível, ...), o resultado é DENY. Nenhum caminho de erro pode virar allow."
 *
 * The permission-gate's pi.on("tool_call") handler must never throw — Pi does not treat a
 * throwing handler as a block (recon §2: handlers either mutate event.input or return
 * {block, reason}; nothing in the framework converts an exception into a deny). Every internal
 * error is therefore caught here and converted into an explicit block.
 */

import { redactSecrets } from "./redaction.ts";

export interface PolicyDecision {
	block: boolean;
	reason?: string;
}

/**
 * Run `evaluate` and return its decision. If `evaluate` throws (sync or async), returns
 * `{ block: true, reason: "policy evaluation error — fail closed: <message>" }` instead of
 * propagating — this function itself never throws.
 *
 * T21 sink #5 / GAP-C (gate3-addendum-fase2.md; docs/adr/0003-fase2-security-architecture.md §6.2
 * sink #5; gate2-spec-fase2.md BR-12): the thrown error's own `message` can embed a secret-shaped
 * value (e.g. a path or command an upstream evaluator was processing when it failed) — this `reason`
 * string flows into the audit trail, the notify sink, and any log, so it is redacted here, at its own
 * source, independent of whether every downstream consumer also redacts (R6: "cada um redige
 * independente").
 */
export async function evaluatePolicyFailClosed(
	evaluate: () => Promise<PolicyDecision> | PolicyDecision,
): Promise<PolicyDecision> {
	try {
		return await evaluate();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { block: true, reason: redactSecrets(`policy evaluation error — fail closed: ${message}`) };
	}
}
