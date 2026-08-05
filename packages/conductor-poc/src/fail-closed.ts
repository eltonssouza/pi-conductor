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

export interface PolicyDecision {
	block: boolean;
	reason?: string;
}

/**
 * Run `evaluate` and return its decision. If `evaluate` throws (sync or async), returns
 * `{ block: true, reason: "policy evaluation error — fail closed: <message>" }` instead of
 * propagating — this function itself never throws.
 */
export async function evaluatePolicyFailClosed(
	_evaluate: () => Promise<PolicyDecision> | PolicyDecision,
): Promise<PolicyDecision> {
	throw new Error("not implemented");
}
