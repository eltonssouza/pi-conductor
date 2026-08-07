/**
 * Embedding client: HTTP to Ollama's local `/api/embed` (`bge-m3`, 1024-d) -- BORDA: local network
 * (docs/adr/0006-fase5-library-and-grounding.md D1/D8, §3.1, §11.1).
 *
 * GATE 6: implements the body left as a stub at Gate 5. Request/response shape confirmed empirically
 * against a real local Ollama instance this same Gate 6 session (`bge-m3` installed, `POST
 * http://127.0.0.1:11434/api/embed` with body `{model, input}` -> `{embeddings: number[][], ...}` --
 * ALWAYS an array of vectors, even for a single string `input`, which is why `embed()` below reads
 * `embeddings[0]` rather than treating the response as a single flat vector).
 *
 * Deliberately NOT routed through `remote-endpoint.ts`'s `connectRemote` (that module's own header
 * says so explicitly): `connectRemote` is the SSRF guard for REMOTE endpoints resolved through
 * `@conductor/config`'s policy-grant chain (allowlist + DNS-rebinding pin), and it does not carry a
 * response body at all -- it only proves a connection to an allowlisted, safely-resolved address was
 * made. Ollama here is a FIXED localhost destination the caller supplies directly (never
 * attacker/repo-influenced -- see `library.ts`'s `resolveLibraryHome()`-anchored construction), so
 * there is no allowlist decision to make and a plain `fetch` is the right-sized tool -- reaching for
 * `connectRemote` here would need a fake response-carrying HTTP transport for a guard this call site
 * does not need in the first place.
 *
 * Timeout: the library does not cover HTTP client timeout/circuit-breaker specifics for this stack
 * (`cdt library "HTTP client timeout and error handling ... AbortController, stability patterns
 * Release It" --gate 6` returned only generic engineering-practice passages at ~0.53-0.55 relevance,
 * off-topic -- library does not cover this). `DEFAULT_TIMEOUT_MS` below is chosen defensively (an
 * embedding call to a local model should complete in well under this on ordinary hardware; a stuck
 * call must not hang `library search` forever) and is a caller-overridable option, never a bare
 * hardcoded value with no escape hatch (quality-baseline: "no hardcoded assumptions").
 */

/** Thrown for every expected failure mode of an embedding call (network error, non-2xx HTTP status,
 * malformed/unexpected JSON body) -- a typed exception the caller (`corpus-store.ts`'s search path,
 * or `library.ts`'s `runLibrarySearch`) can catch and degrade from, never letting an embedding-backend
 * outage propagate as an unhandled rejection out of the CLI (FR-17's "rag-unreachable" degrade path). */
export class EmbeddingClientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmbeddingClientError";
	}
}

export interface EmbeddingClient {
	/** Embeds `text`, returning its dense vector. Rejects with `EmbeddingClientError` (never a bare
	 * `Error`/raw fetch rejection) on any network failure, non-2xx response, or malformed body -- so a
	 * caller doing `catch (error) { if (error instanceof EmbeddingClientError) ... }` never has to
	 * guess the shape of what was thrown. */
	embed(text: string): Promise<number[]>;
}

export interface OllamaEmbeddingClientOptions {
	/** The embedding model Ollama should use; defaults to `"bge-m3"` (the model this ADR standardizes
	 * on, D1). */
	model?: string;
	/** Hard cap on how long a single embed call may take before it is aborted and rejected as an
	 * `EmbeddingClientError` -- see this file's header for why the number itself is not
	 * library-grounded. Caller-overridable, never a silently-bare constant. */
	timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "bge-m3";
const DEFAULT_TIMEOUT_MS = 30_000;

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Validates and extracts the first vector out of Ollama's `/api/embed` response body
 * (`{embeddings: number[][]}`), never trusting the parsed JSON's shape without checking it first --
 * the same "shape-check then trust" discipline `library-home.ts`'s sibling modules already apply to
 * their own parsed JSON. Returns `null` for anything that does not match. */
function extractFirstEmbedding(body: unknown): number[] | null {
	if (body === null || typeof body !== "object") return null;
	const embeddings = (body as { embeddings?: unknown }).embeddings;
	if (!Array.isArray(embeddings) || embeddings.length === 0) return null;
	const first = embeddings[0];
	if (!Array.isArray(first) || first.length === 0) return null;
	if (!first.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
	return first as number[];
}

/**
 * Creates an `EmbeddingClient` backed by a local Ollama server's `/api/embed` endpoint.
 *
 * `baseUrl` defaults to Ollama's standard local address (`http://127.0.0.1:11434`) -- a fixed,
 * caller-controlled default, never read from an environment variable (the same class of authority
 * `remote-endpoint.ts`'s header already documents as rejected for this ADR, D10 §13.1 point 1).
 */
export function createOllamaEmbeddingClient(baseUrl: string = DEFAULT_BASE_URL, options: OllamaEmbeddingClientOptions = {}): EmbeddingClient {
	const model = options.model ?? DEFAULT_MODEL;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const endpoint = `${baseUrl}/api/embed`;

	return {
		async embed(text: string): Promise<number[]> {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);

			let response: Response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ model, input: text }),
					signal: controller.signal,
				});
			} catch (error) {
				throw new EmbeddingClientError(`embedding request to "${endpoint}" failed: ${describeError(error)}`);
			} finally {
				clearTimeout(timer);
			}

			if (!response.ok) {
				throw new EmbeddingClientError(`embedding request to "${endpoint}" returned HTTP ${response.status} ${response.statusText}`);
			}

			let parsedBody: unknown;
			try {
				parsedBody = await response.json();
			} catch (error) {
				throw new EmbeddingClientError(`embedding response from "${endpoint}" was not valid JSON: ${describeError(error)}`);
			}

			const vector = extractFirstEmbedding(parsedBody);
			if (vector === null) {
				throw new EmbeddingClientError(`embedding response from "${endpoint}" had an unexpected shape (expected {embeddings: number[][]})`);
			}
			return vector;
		},
	};
}
