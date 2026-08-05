/**
 * @regression -- the T29/R12c structural canary (docs/conductor/gate3-addendum-fase2.md §9;
 * docs/adr/0003-fase2-security-architecture.md §6.3). This is the task's non-negotiable #5, called
 * out as "the most important test of this gate":
 *
 *   "an integration test that seeds a REAL secret through the real Pi framework's SessionManager
 *   (not mocked), reads the resulting .jsonl file from disk, and asserts the secret does NOT appear
 *   in clear -- independent of which internal code path Pi used to write it."
 *
 * WHY THIS TEST IS DELIBERATELY DIFFERENT FROM test/redaction.test.ts's unit test of
 * redactSessionEntryForPersistence: that unit test proves the transform is correct in isolation, but
 * per Secure Code Review §2.12 ("a completed trace is evidence about that question and about
 * nothing else... not a coverage claim" -- cited at gate3-addendum-fase2.md §9 for exactly this
 * reason, and independently confirmed by this session's own `cdt library "black-box regression test
 * asserting on a persisted output file rather than the code path..." --gate 5` query, top 0.617,
 * Unit Testing Principles §2.9: "test through the public interface as a black box... cover behavior
 * and its failure paths, not mechanics"), a unit test of the transform only proves the ONE code path
 * this fase wired the transform into. `SessionManager` is a component of the Pi framework this
 * project depends on but does not own (ADR §6.3) -- if a future Pi upgrade adds a second internal
 * write path, or changes how `appendMessage` persists, a unit test of OUR transform keeps passing
 * while a secret starts landing on disk in clear. This test is the tripwire for exactly that
 * regression: it drives the REAL `SessionManager` from `@earendil-works/pi-coding-agent` --
 * unmocked, unstubbed -- and asserts on the actual bytes written to the actual `.jsonl` file.
 *
 * CURRENT STATUS (Gate 5, RED): this test is expected to FAIL right now, and for the correct
 * reason -- nothing in this fase has wired redactSessionEntryForPersistence (or an equivalent) into
 * the handoff between Conductor and `SessionManager.appendMessage()` yet (that wiring is Gate 6,
 * ADR §6.3's "ponto de integração exato... residual de verificação do Gate 6"). The test seeds the
 * secret through the UNMODIFIED real SessionManager on purpose, so today's failure demonstrates the
 * exact gap Gate 6 must close, not a mistake in the test itself.
 *
 * DIFFICULTY NOTED, NOT SILENTLY WORKED AROUND (per this task's explicit instruction): driving a
 * full `AgentSession` (model call + tool loop) end-to-end, the way test/acceptance.test.ts does,
 * would make this test slow and would couple it to the fake-model harness. `SessionManager` itself
 * is directly instantiable and its `appendMessage()` API is public and stable (used the same way by
 * this package's own session.ts and by Pi's own test suite -- see
 * packages/coding-agent/test/agent-session-stats.test.ts for the identical `ToolResultMessage`
 * shape used below), so this test calls `SessionManager.appendMessage()` directly rather than
 * through a full agent turn. This is the closest-to-real invocation that stays fast and
 * deterministic while still exercising the REAL, unmocked persistence code path (`_persist()` /
 * `_rewriteFile()` inside session-manager.ts) -- the mitigation closest to "real SessionManager"
 * available without paying for a full model-driven acceptance run for every CI execution of this
 * regression guard. Per R12c, this file's name and the `@regression` tag mark it as
 * merge-blocking and due for re-run on every Pi version bump (the lockfile already pins
 * `@earendil-works/pi-coding-agent`'s version -- see package.json).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createScratchWorkspace, type ScratchWorkspace } from "./support/workspace.ts";

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
});

afterEach(() => {
	workspace.cleanup();
});

// A fixture the shared @conductor/secrets matcher family is GUARANTEED to recognize (known-prefix,
// not merely high-entropy) -- see @conductor/secrets/test/matchers.test.ts's identical fixture.
// Obviously fake: never a real credential.
const CANARY_SECRET = "sk-ant-api03-CANARYCANARYCANARYCANARYCANARYCANARY";

it("@regression never persists a real secret in clear to the session .jsonl file, regardless of Pi's internal write path (T29/R12c)", () => {
	const sessionDir = join(workspace.agentDir, "sessions");
	const sessionManager = SessionManager.create(workspace.root, sessionDir);

	const userMessage: UserMessage = {
		role: "user",
		content: "run the diagnostic command",
		timestamp: Date.now(),
	};

	// Simulates a bash tool result whose captured stdout echoed a credential -- exactly T21's named
	// scenario ("a bash command's stdout can contain ANTHROPIC_API_KEY=sk-ant-...") landing in the
	// session transcript, sink #3 of the six closed sinks.
	const toolResultMessage: ToolResultMessage = {
		role: "toolResult",
		toolCallId: "canary-tool-call-1",
		toolName: "bash",
		content: [{ type: "text", text: `stdout: ANTHROPIC_API_KEY=${CANARY_SECRET}` }],
		isError: false,
		timestamp: Date.now(),
	};

	// SessionManager only performs its first full disk write once an assistant message exists
	// (session-manager.ts's `_persist()`: buffers everything until `hasAssistant` is true, to avoid
	// writing a file for a session that never produced a reply) -- this assistant turn is what
	// triggers the real, unmocked write of every buffered entry, including the tool result above.
	const assistantMessage: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "diagnostic complete" }],
		api: "messages",
		provider: "anthropic",
		model: "claude-sonnet-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};

	sessionManager.appendMessage(userMessage);
	sessionManager.appendMessage(toolResultMessage);
	sessionManager.appendMessage(assistantMessage);

	const sessionFile = sessionManager.getSessionFile();
	expect(sessionFile).toBeTruthy();

	// Read the RAW BYTES from disk -- not sessionManager.getEntries() (which would only prove the
	// in-memory model is clean, not what actually landed on disk; the whole point of R12c/GAP-E is
	// "redact-before-persist," so the assertion has to be against the persisted artifact itself).
	const persistedRaw = readFileSync(sessionFile as string, "utf-8");

	expect(persistedRaw).not.toContain(CANARY_SECRET);
});
