/**
 * Gate 8 -> Gate 6 loop-back for `runLibrarySearch` (src/commands/library.ts) against real
 * divergences a Gate 8 validation found between gate2-spec-fase5.md and the Gate 6 implementation:
 *
 *   - FR-12: an unreachable embedding backend must fail the command EXPLICITLY (naming the backend
 *     and a corrective action), never degrade silently to a lexical-only result dressed up as a
 *     complete answer. The Gate 6 build did the opposite (caught the failure, wrote only an
 *     invisible ledger event, and returned exit 0) -- this file's first `describe` is RED against
 *     that defect until `runLibrarySearch` is fixed.
 *   - FR-7: `--code-aware` is parsed (commands-library.test.ts's own Gate-5 coverage) but was never
 *     read by `runLibrarySearch` at all -- the flag was silently ignored rather than either
 *     implemented or refused. This file's second `describe` is RED until it fails loudly instead,
 *     the same "loud stub" pattern `runLibraryIngest`/`runLibraryUpdate` already use for FR-9/FR-10.
 *
 * `runLibrarySearch` itself still resolves `resolveLibraryHome()` against the REAL OS home
 * directory and opens the real corpus store there (unchanged pre-existing behavior, matching
 * commands-library.test.ts's own end-to-end tests) -- these tests only inject a fake
 * `embeddingClient` via the new `deps` seam (Working Effectively with Legacy Code's "object seam":
 * depend on an interface so a test can supply a double, ch. 2.3/2.10 -- the same seam
 * `code-index.ts`'s `OpenCodeIndexOptions.home` and `remote-endpoint.ts`'s `ConnectRemoteDeps`
 * already use in this monorepo). They never touch the corpus's actual content, so they hold
 * regardless of whether the real corpus has been ingested on the machine running the suite.
 */
import type { EmbeddingClient } from "@conductor/library";
import { describe, expect, it } from "vitest";
import { type LibrarySearchOptions, runLibrarySearch } from "../../src/commands/library.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

function searchOptions(project: ScratchProject, overrides: Partial<LibrarySearchOptions> = {}): LibrarySearchOptions {
	return {
		cwd: project.root,
		question: "how to define a circuit breaker?",
		lexicalOnly: false,
		codeAware: false,
		json: false,
		...overrides,
	};
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Error) return error;
		throw new Error(`rejected with a non-Error value: ${String(error)}`);
	}
	throw new Error("expected the promise to reject, but it resolved");
}

describe("runLibrarySearch -- FR-12 loud failure on an unreachable embedding backend (Gate 8 loop-back)", () => {
	it("rejects, naming the backend and a corrective action, instead of silently degrading to lexical-only", async () => {
		const project = createScratchProject();
		try {
			const failingClient: EmbeddingClient = {
				embed: () => Promise.reject(new Error("ECONNREFUSED")),
			};

			const error = await captureRejection(
				runLibrarySearch(searchOptions(project), { embeddingClient: failingClient }),
			);

			expect(error.message).toMatch(/ollama/i);
			expect(error.message).toMatch(/unreachable/i);
			// A corrective action, not just a name -- FR-12's own "ação corretiva" requirement.
			expect(error.message).toMatch(/--lexical-only/);
		} finally {
			project.cleanup();
		}
	});

	it("still surfaces the original failure reason inside the thrown message, not just a generic label", async () => {
		const project = createScratchProject();
		try {
			const failingClient: EmbeddingClient = {
				embed: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:11434")),
			};

			const error = await captureRejection(
				runLibrarySearch(searchOptions(project), { embeddingClient: failingClient }),
			);

			expect(error.message).toMatch(/ECONNREFUSED/);
		} finally {
			project.cleanup();
		}
	});

	it("never attempts to embed, and never throws for that reason, when --lexical-only is set", async () => {
		const project = createScratchProject();
		try {
			let embedCalls = 0;
			const failingClient: EmbeddingClient = {
				embed: () => {
					embedCalls += 1;
					return Promise.reject(new Error("should never be called in --lexical-only mode"));
				},
			};

			const result = await runLibrarySearch(searchOptions(project, { lexicalOnly: true }), {
				embeddingClient: failingClient,
			});

			expect(embedCalls).toBe(0);
			expect(typeof result).toBe("string");
		} finally {
			project.cleanup();
		}
	});
});

describe("runLibrarySearch -- FR-7 --code-aware fails loudly as a named stub, never silently ignored (Gate 8 loop-back)", () => {
	it("rejects before running any search, naming code-aware and not-yet-implemented", async () => {
		const project = createScratchProject();
		try {
			const error = await captureRejection(runLibrarySearch(searchOptions(project, { codeAware: true })));

			expect(error.message).toMatch(/code-aware/i);
			expect(error.message).toMatch(/not yet implemented/i);
		} finally {
			project.cleanup();
		}
	});

	it("fails fast: an embeddingClient that would blow up if called is never reached when --code-aware is refused first", async () => {
		const project = createScratchProject();
		try {
			const unreachableClient: EmbeddingClient = {
				embed: () => Promise.reject(new Error("must never be called -- --code-aware must fail before this")),
			};

			// Would reject with the --code-aware message, never with the embed-failure message above --
			// proving the code-aware check runs BEFORE any embedding attempt (fail fast).
			const error = await captureRejection(
				runLibrarySearch(searchOptions(project, { codeAware: true, lexicalOnly: false }), {
					embeddingClient: unreachableClient,
				}),
			);

			expect(error.message).toMatch(/code-aware/i);
		} finally {
			project.cleanup();
		}
	});
});
