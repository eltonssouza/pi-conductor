/**
 * Test-first (Gate 5) for `conductor library status|search|ingest|update` (src/commands/library.ts,
 * wired into src/cli.ts's runCli) -- ADR 0006 §19 "Superfície CLI", D5 (library import is a declared
 * Non-goal, not an omission).
 *
 * Same two-class split this repo's own Gate 5 precedent already established for `gate`
 * (test/commands/gate-cli.acceptance.test.ts's own header): argument-SHAPE validation (which
 * subcommands exist, which flags `search` recognizes) is ordinary CLI plumbing and is REAL,
 * tested GREEN today -- `parseLibrarySearchArgs`/`runLibraryCommand`'s subcommand switch in
 * commands/library.ts are not stubs. SUBSTANTIVE behavior (an actual search/status/ingest/update
 * against `@conductor/library`) is delegated to `run*` functions that ARE currently STUBS throwing
 * "not implemented" (Gate 6 wires them to the real engine) -- those tests are RED today, for that one
 * reason.
 */
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.ts";
import { parseLibrarySearchArgs } from "../../src/commands/library.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

describe("parseLibrarySearchArgs (ADR §19 Superfície CLI -- real, GREEN today)", () => {
	it("recognizes the full flag surface: --gate, --role, --category, --tech, --version, -k, --lexical-only, --code-aware, --rerank cross-encoder, --json", () => {
		const result = parseLibrarySearchArgs([
			"how to define a circuit breaker?",
			"--gate",
			"3",
			"--role",
			"security-engineer",
			"--category",
			"security_and_privacy",
			"--tech",
			"python",
			"--version",
			"3.13",
			"-k",
			"5",
			"--lexical-only",
			"--code-aware",
			"--rerank",
			"cross-encoder",
			"--json",
		]);

		expect(result).toEqual({
			ok: true,
			flags: {
				question: "how to define a circuit breaker?",
				gate: 3,
				role: "security-engineer",
				category: "security_and_privacy",
				tech: "python",
				version: "3.13",
				k: 5,
				lexicalOnly: true,
				codeAware: true,
				rerank: "cross-encoder",
				json: true,
			},
		});
	});

	it("degrades gracefully with only the question and none of the optional flags", () => {
		const result = parseLibrarySearchArgs(["what is a bulkhead?"]);

		expect(result).toEqual({
			ok: true,
			flags: {
				question: "what is a bulkhead?",
				gate: undefined,
				role: undefined,
				category: undefined,
				tech: undefined,
				version: undefined,
				k: undefined,
				lexicalOnly: false,
				codeAware: false,
				rerank: undefined,
				json: false,
			},
		});
	});

	it("requires a question -- refuses when only flags are given", () => {
		const result = parseLibrarySearchArgs(["--gate", "3"]);

		expect(result).toEqual({ ok: false, error: expect.stringMatching(/question/i) });
	});

	it("rejects an unrecognized flag rather than silently ignoring it", () => {
		const result = parseLibrarySearchArgs(["a question", "--not-a-real-flag"]);

		expect(result.ok).toBe(false);
	});

	it("rejects a --rerank value other than cross-encoder", () => {
		const result = parseLibrarySearchArgs(["a question", "--rerank", "some-other-model"]);

		expect(result).toEqual({ ok: false, error: expect.stringMatching(/cross-encoder/) });
	});
});

describe("conductor library (end-to-end dispatch) -- argument shape (real, GREEN today)", () => {
	let project: ScratchProject;

	it("rejects `library import` as an unknown subcommand -- D5: a declared Non-goal, not an oversight", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);

			const code = await runCli(["library", "import", "https://example.com/corpus.jsonl.gz"], io);

			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/unknown subcommand/);
		} finally {
			project.cleanup();
		}
	});

	it("rejects an unknown top-level `library` sibling subcommand the same way (proves `import` isn't special-cased as an error message, just genuinely absent)", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);

			const codeForImport = await runCli(["library", "import"], io);
			const { io: io2, stderr: stderr2 } = createCapturingIo(project.root);
			const codeForBogus = await runCli(["library", "bogus"], io2);

			expect(codeForImport).toBe(codeForBogus);
			expect(stderr()).toMatch(/unknown subcommand/);
			expect(stderr2()).toMatch(/unknown subcommand/);
		} finally {
			project.cleanup();
		}
	});

	it("recognizes `library status`/`search`/`ingest`/`update` as valid subcommands (they reach the STUB, not the unknown-subcommand refusal)", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);

			await runCli(["library", "status"], io);

			// Gate 6: status now genuinely succeeds (code 0) over an empty/freshly-created corpus -- the
			// invariant this test protects is "not unknown subcommand", not "throws not-implemented".
			expect(stderr()).not.toMatch(/unknown subcommand/);
		} finally {
			project.cleanup();
		}
	});

	it("rejects `library search` with no question, before ever reaching the not-implemented stub", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);

			const code = await runCli(["library", "search"], io);

			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/question/i);
		} finally {
			project.cleanup();
		}
	});
});

describe("conductor library (end-to-end dispatch) -- substantive behavior (RED until Gate 6 wires @conductor/library)", () => {
	let project: ScratchProject;

	it("`library status` is expected to report the indexed corpus once Gate 6 wires it -- fails today because run* is a stub", async () => {
		project = createScratchProject();
		try {
			const { io, stdout } = createCapturingIo(project.root);

			const code = await runCli(["library", "status"], io);

			// This is the actual FR-8 assertion Gate 6 must satisfy -- it fails today (exit 1, no
			// stdout) because runLibraryStatus is still "not implemented".
			expect(code).toBe(0);
			expect(stdout()).toMatch(/chunk/i);
		} finally {
			project.cleanup();
		}
	});

	it('`library search "..."` is expected to return cited passages once Gate 6 wires it -- fails today because run* is a stub', async () => {
		project = createScratchProject();
		try {
			const { io, stdout } = createCapturingIo(project.root);

			const code = await runCli(["library", "search", "how to define a circuit breaker?"], io);

			// FR-1/FR-6: a real search returns passages with a source/section/score. Fails today.
			expect(code).toBe(0);
			expect(stdout().length).toBeGreaterThan(0);
		} finally {
			project.cleanup();
		}
	});
});
