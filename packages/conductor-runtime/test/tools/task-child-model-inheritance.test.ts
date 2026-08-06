/**
 * GAP-5 (quality-baseline, Fase 3 checkpoint) -- the exact-location regression guard for the finding
 * documented at length in `tools/task.ts`'s own `SpawnChildSessionInput.model` and
 * `createGovernedChildSessionSpawner` doc comments: the REAL production collaborator
 * (`createGovernedChildSessionSpawner`) used to omit `model` entirely from its own call to the Pi SDK's
 * `createAgentSession`, which let Pi's own `findInitialModel` fallback (model-resolver.ts step 4,
 * "first available model with a valid API key") silently auto-discover and call ANY provider whose API
 * key env var happened to be set in the process -- confirmed in practice: an ambient `DEEPSEEK_API_KEY`
 * made a delegation child place a real network call to a live, paid model, with `allowModelNetwork:
 * false` set and no consent/audit trail, violating plano_desenvolvimento.md §4.3's "Network: requer
 * consentimento e registro".
 *
 * `test/tools/task.test.ts`'s own new "GAP-5" describe block already proves `runTask`'s PURE
 * orchestration forwards `options.model` into `SpawnChildSessionInput.model` unchanged -- but that test
 * exercises `runTask` against a FAKE `spawnChildSession`, so it cannot see whether the REAL
 * `createGovernedChildSessionSpawner` (the one place GAP-5 actually lived, T41's "sole constructor" of
 * a delegation child) still forwards that field into the real `createAgentSession` call. This file
 * closes that gap: it drives `createGovernedChildSessionSpawner` directly (the actual, exported
 * production collaborator, not a reimplementation of it) and intercepts ONLY the Pi SDK's own
 * `createAgentSession` -- every other export of `@earendil-works/pi-coding-agent` (`ModelRuntime`,
 * `DefaultResourceLoader`, `SessionManager`, ...) stays REAL, so this is still exercising the genuine
 * resourceLoader/permission-gate/session-manager wiring, only stopping short of a real model turn
 * (which `createAgentSession` would otherwise need to actually perform).
 *
 * Before the GAP-5 fix, the captured options below would have had `model: undefined` -- this is the
 * RED->GREEN this file documents (deliberately not by re-driving a real network call in CI, which
 * would be exactly the danger this fix removes; asserting the value that reaches the SDK boundary is
 * the safe, equivalent proof).
 */

import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuditTrailWriter } from "../../src/audit-trail.ts";
import { createSharedBudget } from "../../src/shared-budget.ts";
import { createScratchWorkspace, type ScratchWorkspace } from "../support/workspace.ts";

interface CapturedCreateAgentSessionOptions {
	model?: Model<any>;
	modelRuntime?: unknown;
	tools?: string[];
}

const state = vi.hoisted(() => ({
	captured: undefined as CapturedCreateAgentSessionOptions | undefined,
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		// The ONE seam this file needs: capture what createGovernedChildSessionSpawner actually hands
		// the Pi SDK, without needing a real, live model turn to complete. Every other export
		// (ModelRuntime, DefaultResourceLoader, SessionManager, ...) passes through to the real
		// implementation via `...actual`.
		createAgentSession: vi.fn(async (options: CapturedCreateAgentSessionOptions) => {
			state.captured = options;
			return {
				session: {
					prompt: async () => {},
					getSessionStats: () => ({ tokens: { input: 0, output: 0, total: 0 } }),
					getLastAssistantText: () => "done",
				},
				extensionsResult: { registeredTools: [], slashCommands: [] },
			};
		}),
	};
});

// Imported AFTER vi.mock (vitest hoists vi.mock calls above imports at transform time) so
// tools/task.ts's own `import { createAgentSession, ... } from "@earendil-works/pi-coding-agent"`
// binds to the mocked factory above.
const { createGovernedChildSessionSpawner } = await import("../../src/tools/task.ts");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");

const PARENT_MODEL = { provider: "conductor-fake", id: "conductor-fake-model-1", name: "Fake" } as Model<any>;

let workspace: ScratchWorkspace;

beforeEach(() => {
	workspace = createScratchWorkspace();
	state.captured = undefined;
});

afterEach(() => {
	workspace.cleanup();
	vi.clearAllMocks();
});

it(
	"createGovernedChildSessionSpawner passes the parent's own model to the real createAgentSession call, exactly, never leaving it undefined for Pi's own findInitialModel to auto-discover",
	async () => {
		const auditTrailWriter = createAuditTrailWriter(join(workspace.root, ".conductor", "audit.jsonl"));
		const sessionManager = SessionManager.create(workspace.root, join(workspace.agentDir, "sessions", "tasks"));

		const spawn = createGovernedChildSessionSpawner(createSharedBudget(100_000));
		await spawn({
			role: { name: "software-engineer", tools: ["read"], canSpawn: [], modelRole: "standard" },
			prompt: "do something self-contained",
			depth: 1,
			workspaceRoot: workspace.root,
			effectivePolicy: {},
			auditTrailWriter,
			additionalProtectedPaths: [],
			yesFlagActive: false,
			sessionManager,
			model: PARENT_MODEL,
		});

		expect(state.captured).toBeDefined();
		// The exact discriminator: not merely "some model object", not "a model with the same id" --
		// the SAME reference the caller passed in, and never `undefined` (undefined is precisely what
		// would re-arm Pi's own findInitialModel auto-discovery fallback, sdk.ts's `let model =
		// options.model` / `if (!model) { ... findInitialModel ... }`).
		expect(state.captured?.model).toBe(PARENT_MODEL);
		expect(state.captured?.model).not.toBeUndefined();
	},
	20_000,
);
