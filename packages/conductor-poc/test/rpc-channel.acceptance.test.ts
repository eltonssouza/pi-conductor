/**
 * Fase-0 backfill — Gap 1 (CLI/RPC PoC), queued by gate8-validation.md §7 as the first item of
 * this continuation. plano_desenvolvimento.md §8 entregável 3 ("prova de conceito do CLI") was not
 * delivered at all in the prior pass: the whole existing PoC was built exclusively on the SDK-level
 * createAgentSession() API and never exercised Pi's own CLI/RPC channel
 * (docs/conductor/_recon-pi-architecture.md §5 "RPC / external control", §8 "CLI/TUI wiring").
 *
 * Proves the "another process can drive the agent externally" capability that plan §4.8 (RPC
 * execution mode) and §4.9 (session management) will build on later: spawns Pi's real, BUILT CLI
 * (packages/coding-agent/dist/cli.js) as a genuine child process in `--mode rpc` (strict
 * JSON-over-stdio, docs/rpc.md), drives it with Pi's own public RpcClient
 * (@earendil-works/pi-coding-agent, exported at packages/coding-agent/src/index.ts:340-341 — the
 * same class Pi's own suite uses for this, packages/coding-agent/test/rpc.test.ts:7,20-26), sends
 * exactly one request (`get_state`), and asserts a real structured response comes back over the
 * real transport.
 *
 * Deliberately sends `get_state`, not `prompt`: a `prompt` would actually call the model, which
 * would make this test either non-deterministic (needs a live network + real provider key, like
 * test/live-model.acceptance.test.ts) or require standing up a fake HTTP model server — disproportionate
 * for a Fase-0 walking skeleton whose job here is only to prove the CHANNEL works end-to-end (task
 * brief: "it does NOT need to reimplement Conductor's own RPC design, just prove Pi's existing
 * channel works end-to-end... keep it to the thinnest slice that proves the channel"). No part of
 * the transport itself is mocked: the child process is real, spawned from the real built CLI, and
 * the response is Pi's own, unmodified — only the *model* is a locally-declared stub that is never
 * actually contacted (see test/support/rpc-fixture.ts).
 *
 * Grounding: Outside-In Development — Complete Professional Guide §1.12 ("the walking skeleton
 * earns its cost where the thinnest real behaviour can be exercised end to end") — already cited
 * for this exact split (mock/stub the third-party network boundary, keep the process/transport
 * real) in acceptance.test.ts; applied identically here for the RPC transport.
 */

import { RpcClient } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolvePiCliPath, writeStubModelsConfig } from "./support/rpc-fixture.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;
let client: RpcClient | undefined;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(async () => {
	await client?.stop();
	client = undefined;
	workspace.cleanup();
});

it(
	"drives Pi's own RPC channel end-to-end: real CLI subprocess, one request, one real response",
	{ timeout: 30_000 },
	async () => {
		const { provider, model } = writeStubModelsConfig(workspace.agentDir);

		client = new RpcClient({
			cliPath: resolvePiCliPath(),
			cwd: workspace.root,
			env: { PI_CODING_AGENT_DIR: workspace.agentDir },
			provider,
			model,
			args: ["--no-session", "--offline"],
		});

		// Real subprocess spawn — not a mock. If the CLI fails to start (e.g. dist/ not built,
		// or the stub model doesn't resolve), this throws with the child's real stderr attached.
		await client.start();

		// The one request this PoC sends. get_state never calls the model — it only asks the
		// running agent process for its current state, which is exactly the "one round trip"
		// slice this gap needs to prove.
		const state = await client.getState();

		// A real, structured response came back over the real transport, reflecting the actual
		// server-side state (not an echo of what we sent) — proves the channel is bidirectional
		// and the CLI process really did resolve our stub model from models.json.
		expect(state.model).toBeDefined();
		expect(state.model?.provider).toBe(provider);
		expect(state.model?.id).toBe(model);
		expect(state.isStreaming).toBe(false);
		expect(state.messageCount).toBe(0);
	},
);
