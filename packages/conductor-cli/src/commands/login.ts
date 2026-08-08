/**
 * `conductor login [provider]` (ADR 0008 "Fase 7 -- model routing e provedores" D8, §16 `runLogin`;
 * gate2-spec-fase7.md FR-1/FR-2, BR-1; gate3-addendum-fase7.md T65/T69/R46(ii)/R50).
 *
 * Composes headlessly over the SAME vendor substrate the interactive TUI login dialog already uses
 * (`provider.auth.oauth.login()` / `provider.auth.apiKey.login()`, both driven through an
 * `AuthInteraction` -- `packages/ai/src/auth/types.ts`) -- never a second OAuth/api-key-prompt
 * implementation (D8's own "composição antes de fork" mandate, restated at every prior Fase's Gate 4).
 * Persistence goes straight through the injected `CredentialStore` (`credentials.modify(...)`, the
 * hardened `AuthStorage` in production -- see `vendor-credential-substrate.test.ts`'s F2(a)) --
 * NEVER `ModelRuntime.setRuntimeApiKey` (an in-memory-only overlay, `runtime-credentials.ts`) and
 * NEVER a second parallel file (the `packages/ai/src/cli.ts` anti-pattern this fase's spec calls out
 * by name: `writeFileSync("auth.json", ...)` in the CWD, no lock, no `chmod`).
 *
 * `modelRuntime` supplies the composed provider catalog (`getProviders()`/`getProvider()`) --
 * `ModelRuntime`'s own composition already includes any registered extension providers alongside the
 * ~40 vendor built-ins, so this command never imports `builtinProviders()` directly and never risks
 * drifting from what the rest of the CLI actually sees as "configured".
 */

import { createInterface } from "node:readline";
import { sanitizeForTerminal } from "@conductor/runtime";
import type {
	AuthEvent,
	AuthPrompt,
	Credential,
	CredentialStore,
	ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { TtyStreams } from "../tty-confirm.ts";

/**
 * Minimal, LOCAL surface this command needs from the real `CliIO` (`src/cli.ts`) -- duck-typed rather
 * than imported directly, the same decoupling `commands/gate.ts`'s own header documents for
 * `GateStateStoreView`/`RoleRegistryView` ("never a concrete [cross-file] type directly", so this
 * command file never has to import the dispatcher that imports it back). Structurally identical to
 * the real `CliIO`, so both the real call site (`cli.ts`) and the test double
 * (`test/support/io.ts`'s `createCapturingIo`) satisfy it without a cast.
 */
export interface CliIO {
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
	tty?: TtyStreams;
}

export interface RunLoginOptions {
	/** Omitted -- FR-2: list known providers with their current status instead of a generic "provider
	 * required" error (a discoverability requirement, not a fallback for a missing arg). */
	provider?: string;
	io: CliIO;
	credentials: CredentialStore;
	modelRuntime: ModelRuntime;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Renders an `AuthPrompt` question, embedding `select` options -- the only variant with a nested
 * choice list. `signal`-only prompts (all four variants may carry a per-prompt `AuthPrompt.signal`)
 * are not rendered; cancellation is out of scope for this headless flow (no external cancel source
 * exists yet at this call site). */
function formatPromptQuestion(prompt: AuthPrompt): string {
	if (prompt.type === "select") {
		const options = prompt.options
			.map(
				(option, index) =>
					`  ${index + 1}. ${option.label}${option.description ? ` -- ${option.description}` : ""}`,
			)
			.join("\n");
		return `${prompt.message}\n${options}\nEnter a number`;
	}
	return prompt.message;
}

/**
 * Reads one answer for `prompt` over `streams`, the same `node:readline` composition
 * `tty-confirm.ts`'s `createTtyConfirmChannel` already uses (never a second interactive-prompt
 * mechanism) -- fail-closed on the stream closing/erroring before an answer arrives (rejects, never
 * resolves an empty/default value, matching that file's own "any uncertainty denies" discipline).
 */
function promptViaTty(streams: TtyStreams, prompt: AuthPrompt): Promise<string> {
	return new Promise((resolve, reject) => {
		const rl = createInterface({ input: streams.stdin, output: streams.stdout });
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			rl.close();
			fn();
		};
		rl.on("close", () => settle(() => reject(new Error("input closed before a value was entered"))));
		streams.stdin.on("error", (error) => settle(() => reject(error)));
		rl.question(`${formatPromptQuestion(prompt)}: `, (answer) => {
			if (prompt.type === "select") {
				const index = Number.parseInt(answer, 10) - 1;
				const option = prompt.options[index];
				settle(() => (option ? resolve(option.id) : reject(new Error(`invalid selection: "${answer}"`))));
				return;
			}
			settle(() => resolve(answer));
		});
	});
}

/** Human-readable rendering of a login-flow `AuthEvent` (info/auth_url/device_code/progress) --
 * secure-default 66 (S3): any provider-supplied text (a URL, an instructions string) is untrusted,
 * model-adjacent text and is sanitized before it ever reaches the terminal, the same discipline
 * `commands/models.ts` applies to `ResolutionTrace` rendering. */
function formatAuthEvent(event: AuthEvent): string {
	switch (event.type) {
		case "info":
			return sanitizeForTerminal(event.message);
		case "auth_url":
			return `Open this URL to continue: ${sanitizeForTerminal(event.url)}${event.instructions ? `\n${sanitizeForTerminal(event.instructions)}` : ""}`;
		case "device_code":
			return `Go to ${sanitizeForTerminal(event.verificationUri)} and enter code: ${sanitizeForTerminal(event.userCode)}`;
		case "progress":
			return sanitizeForTerminal(event.message);
	}
}

/**
 * Builds the `ProviderAuthInteraction` a vendor `login()` implementation drives (both
 * `envApiKeyAuth`'s `login` -- `packages/ai/src/auth/helpers.ts` -- and every `OAuthAuth.login`).
 * `prompt()` requires a real interactive TTY (`io.tty`) -- headless/no-TTY invocations (CI, the
 * autonomous loop) reject rather than hang or silently fabricate an answer, the same fail-closed
 * direction R47(iii) requires for the sibling cross-provider-consent seam ("sem TTY -> REFUSE").
 */
function createHeadlessAuthInteraction(io: CliIO): ProviderAuthInteraction {
	const controller = new AbortController();
	return {
		signal: controller.signal,
		async prompt(prompt) {
			if (!io.tty) {
				throw new Error("no interactive terminal available to prompt for login input");
			}
			return promptViaTty(io.tty, prompt);
		},
		notify(event) {
			io.stdout.write(`${formatAuthEvent(event)}\n`);
		},
	};
}

/** FR-2: no `provider` argument lists known providers (a stable, well-known subset always present in
 * the real vendor catalog) with their current status, instead of a generic "provider required" error. */
function listKnownProviders(options: RunLoginOptions): number {
	const { io, modelRuntime } = options;
	const providers = [...modelRuntime.getProviders()].sort((a, b) => a.id.localeCompare(b.id));
	const lines = providers.map((provider) => {
		const status = modelRuntime.getProviderAuthStatus(provider.id);
		const detail = status.configured
			? `configured (${sanitizeForTerminal(status.source ?? "unknown")})`
			: "not configured";
		return `  ${provider.id.padEnd(24)} ${detail}`;
	});
	io.stdout.write(
		`Known providers:\n${lines.join("\n")}\n\nRun \`conductor login <provider>\` to authenticate one of them.\n`,
	);
	return 0;
}

export async function runLogin(options: RunLoginOptions): Promise<number> {
	const { provider, io, credentials, modelRuntime } = options;

	if (!provider) {
		return listKnownProviders(options);
	}

	const target = modelRuntime.getProvider(provider);
	if (!target) {
		io.stderr.write(
			`Unknown provider "${sanitizeForTerminal(provider)}" -- run \`conductor login\` with no argument to see known providers.\n`,
		);
		return 1;
	}

	const interaction = createHeadlessAuthInteraction(io);
	try {
		let credential: Credential;
		if (target.auth.oauth) {
			credential = await target.auth.oauth.login(interaction);
		} else if (target.auth.apiKey?.login) {
			credential = await target.auth.apiKey.login(interaction);
		} else {
			// Ambient-only provider (env vars, AWS profiles, ADC files, ...): `conductor login` has
			// nothing to persist here -- R46(ii)'s own distinction ("environment habilita, nunca
			// autoriza sozinho") means this is not an error in the provider's configuration, just a
			// login command with no interactive step to run.
			io.stderr.write(
				`Provider "${provider}" has no interactive login -- it only supports ambient credentials (e.g. environment variables). Run \`conductor auth\` to see whether it is already configured.\n`,
			);
			return 1;
		}
		// D8/BR-1/R50: persists through the injected CredentialStore directly (the hardened
		// AuthStorage in production) -- never ModelRuntime.setRuntimeApiKey (an in-memory-only
		// overlay) and never a second parallel file.
		await credentials.modify(provider, async () => credential);
		io.stdout.write(`Logged in to ${provider}.\n`);
		return 0;
	} catch (error) {
		io.stderr.write(`login failed for ${provider}: ${describeError(error)}\n`);
		return 1;
	}
}
