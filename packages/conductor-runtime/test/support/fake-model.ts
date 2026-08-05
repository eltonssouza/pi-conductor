/**
 * A scripted, fully offline model provider for tests.
 *
 * Registered via the *public* `ModelRuntime.registerProvider()` API (same primitive
 * pi.registerProvider() uses under the hood — see
 * packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts for the pattern
 * this is adapted from). No network I/O of any kind: `streamSimple` synthesizes the assistant
 * message locally from a response script and returns it in a real AssistantMessageEventStream.
 *
 * This is deliberately a *small* reimplementation of the shape used internally by
 * packages/coding-agent/test/test-harness.ts's `createFauxStreamFn` (text + tool calls only, no
 * thinking blocks, no per-call delay) — that harness is private to coding-agent's own test suite
 * (imports `../src/...` and internal-only helpers such as AuthStorage that are not exported from
 * the package's public entrypoint), so a sibling package consuming only the public SDK surface
 * cannot import it directly and re-derives the minimum needed here instead.
 */

import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	type StopReason,
	type TextContent,
	type ToolCall,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ScriptedToolCall {
	id?: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ScriptedResponse {
	text?: string;
	toolCalls?: ScriptedToolCall[];
}

export interface FakeModelHandle {
	model: Model<"openai-completions">;
	callCount(): number;
}

let toolCallSeq = 0;

/**
 * Register a scripted provider on `modelRuntime` and return its resolved Model. The provider
 * cycles through `responses` in order (clamped to the last one once exhausted), letting a test
 * script an exact multi-turn tool-calling sequence deterministically.
 */
export function registerFakeModel(
	modelRuntime: ModelRuntime,
	providerId: string,
	responses: ScriptedResponse[],
): FakeModelHandle {
	if (responses.length === 0) {
		throw new Error("registerFakeModel requires at least one scripted response");
	}

	const modelId = "conductor-fake-1";
	let callCount = 0;

	modelRuntime.registerProvider(providerId, {
		baseUrl: "http://localhost:0",
		apiKey: "fake-key",
		api: "openai-completions",
		models: [
			{
				id: modelId,
				name: "Conductor Fake Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32000,
				maxTokens: 4096,
			},
		],
		streamSimple: (_model, _context, _options) => {
			const index = Math.min(callCount, responses.length - 1);
			const scripted = responses[index];
			callCount += 1;

			const content: (TextContent | ToolCall)[] = [];
			for (const call of scripted.toolCalls ?? []) {
				content.push({
					type: "toolCall",
					id: call.id ?? `fake_tc_${++toolCallSeq}`,
					name: call.name,
					arguments: call.args,
				});
			}
			if (scripted.text !== undefined) {
				content.push({ type: "text", text: scripted.text });
			}
			if (content.length === 0) {
				content.push({ type: "text", text: "" });
			}

			const stopReason: StopReason = scripted.toolCalls && scripted.toolCalls.length > 0 ? "toolUse" : "stop";

			const message: AssistantMessage = {
				role: "assistant",
				content,
				api: "openai-completions",
				provider: providerId,
				model: modelId,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason,
				timestamp: Date.now(),
			};

			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
				for (let i = 0; i < message.content.length; i++) {
					const block = message.content[i];
					if (block.type === "text") {
						stream.push({ type: "text_start", contentIndex: i, partial: message });
						stream.push({ type: "text_end", contentIndex: i, content: block.text, partial: message });
					} else if (block.type === "toolCall") {
						stream.push({ type: "toolcall_start", contentIndex: i, partial: message });
						stream.push({ type: "toolcall_end", contentIndex: i, toolCall: block, partial: message });
					}
				}
				stream.push({ type: "done", reason: stopReason, message });
				stream.end();
			});
			return stream;
		},
	});

	const model = modelRuntime.getModel(providerId, modelId);
	if (!model) {
		throw new Error(`registerFakeModel: provider "${providerId}" did not register model "${modelId}" as expected`);
	}

	return {
		model: model as Model<"openai-completions">,
		callCount: () => callCount,
	};
}
