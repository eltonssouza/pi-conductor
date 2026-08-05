/**
 * The ONE real-provider integration test in this suite (per task instructions: "keep it to
 * exactly one small, cheap prompt/response in the whole test suite"). Everything else in
 * acceptance.test.ts and the unit tests uses the scripted fake provider (test/support/fake-model.ts)
 * so the suite stays fast, deterministic, and green in CI without a key.
 *
 * Skipped automatically when DEEPSEEK_API_KEY is not set (it.skipIf), per the task's explicit
 * requirement that the suite still runs green without one.
 *
 * Correction to the recon (docs/conductor/_recon-pi-architecture.md §7, "~34 built-in providers"
 * including DeepSeek): in THIS checkout, @earendil-works/pi-ai's built-in provider catalogs are
 * generated, gitignored data under packages/ai/src/providers/data/*.json (see
 * packages/ai/package.json's "generate-models" script) and were absent after
 * `npm install --ignore-scripts` — importing ANY built-in provider (including deepseek, and, more
 * importantly, ModelRuntime.create() itself, which unconditionally imports
 * @earendil-works/pi-ai/providers/all) threw `ERR_MODULE_NOT_FOUND` for the missing JSON. This
 * pre-dates and is unrelated to Conductor's own code — it reproduces identically on an existing
 * Pi test (packages/coding-agent/test/model-registry.test.ts) run standalone in this checkout.
 * Fixed here by running `npm run generate-models` (network fetch from models.dev, output is
 * gitignored — not a Pi source-code patch) once for this environment; a fresh checkout/CI runner
 * needs the same step before ANY test that constructs a real ModelRuntime, fake-model tests
 * included. Flagged explicitly for the orchestrator; see the final report.
 */

import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { it, vi } from "vitest";
import { createConductorSession } from "../src/session.ts";
import { createScratchWorkspace } from "./support/workspace.ts";

it.skipIf(!process.env.DEEPSEEK_API_KEY)(
	"calls the real DeepSeek provider once with a trivial prompt",
	{ timeout: 30_000 },
	async () => {
		vi.stubEnv("PI_OFFLINE", undefined); // this one test needs real network; the rest of the suite does not.

		const workspace = createScratchWorkspace();
		try {
			const modelRuntime = await ModelRuntime.create({
				authPath: join(workspace.agentDir, "auth.json"),
				modelsPath: join(workspace.agentDir, "models.json"),
				allowModelNetwork: false,
			});

			const model = modelRuntime.getModel("deepseek", "deepseek-v4-flash");
			if (!model) {
				throw new Error(
					'DeepSeek model "deepseek-v4-flash" not found in the catalog — run `npm run generate-models` ' +
						"in packages/ai (see the module comment above).",
				);
			}

			const conductorSession = await createConductorSession({
				workspaceRoot: workspace.root,
				model,
				modelRuntime,
				agentDir: workspace.agentDir,
			});

			try {
				await conductorSession.session.prompt("Reply with the single word OK and nothing else.");

				const entries = conductorSession.session.sessionManager.getEntries();
				const assistantTexts: string[] = [];
				for (const entry of entries) {
					if (entry.type !== "message" || entry.message.role !== "assistant") continue;
					const content = entry.message.content;
					if (!Array.isArray(content)) continue;
					for (const block of content) {
						if (block.type === "text") assistantTexts.push(block.text);
					}
				}

				const combined = assistantTexts.join(" ").trim();
				if (!/ok/i.test(combined)) {
					throw new Error(`expected the real DeepSeek response to contain "OK", got: ${JSON.stringify(combined)}`);
				}
			} finally {
				conductorSession.dispose();
			}
		} finally {
			workspace.cleanup();
		}
	},
);
