/**
 * Integration test (Gate 6 wiring closure) for `conductor journal add|recall|search|digest|supersede`
 * (src/commands/journal.ts, wired into src/cli.ts's runCli) -- ADR 0007 §16 "Superfície CLI"
 * (docs/adr/0007-fase6-diary-and-capture.md).
 *
 * No dedicated RED test existed for this wiring at Gate 5 (the same situation `commands-library.test.ts`
 * documents for `library`'s own Gate-6 wiring: the Group D/composition-root task writes its own coverage).
 *
 * TEST HYGIENE (per this task's own brief): the Diary's log is per-MACHINE
 * (`~/.conductor/diary/projects/<projectId>/entries.jsonl`, ADR D4/§6.1), never per-workspace --
 * `resolveJournalContext` inside journal.ts resolves that path from `os.homedir()` by default. A test
 * that called `runJournalAdd`/`runJournalSupersede` without overriding that would WRITE a real,
 * permanent entries.jsonl under this developer's actual home directory every time the suite runs (the
 * same caveat `commands-library.test.ts`'s own header names for `@conductor/library`'s
 * `resolveLibraryHome()`, except library.ts's own tests never exercise a WRITE path the way `journal
 * add`/`supersede` do here). journal.ts's every `Journal*Options` interface carries an optional
 * `homeDir` field for exactly this reason (a test seam mirroring `library-home.ts`'s own
 * `resolveLibraryHome(homeDir = homedir())` signature) -- every test below that performs a WRITE calls
 * the exported `run*` functions directly with `homeDir` pointed at a throwaway scratch directory,
 * cleaned up in `afterEach`, so this suite NEVER touches the real machine's `~/.conductor/diary`.
 *
 * The one exception, and why it is still safe: the "recognizes search/digest as valid subcommands"
 * dispatcher test below calls `runCli(["journal", "search"/"digest"], io)` with NO homeDir override
 * (matching commands-library.test.ts's own "library status" real-home precedent) -- `search`/`digest`
 * with no `--out` are READ-ONLY (`openJournalReader` never creates a file; a missing entries.jsonl
 * collapses to "no entries" per R44/T63's fail-closed reader contract) and `cwd` is always a fresh
 * scratch project directory, so the resolved `projectId` (a hash of that unique tmp path) has never
 * been written to on this machine -- the read is harmless and creates nothing.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.ts";
import {
	parseJournalAddArgs,
	parseJournalRecallArgs,
	parseJournalSearchArgs,
	parseJournalSupersedeArgs,
	runJournalAdd,
	runJournalDigest,
	runJournalRecall,
	runJournalSearch,
	runJournalSupersede,
} from "../../src/commands/journal.ts";
import { createCapturingIo } from "../support/io.ts";
import { createScratchProject, type ScratchProject } from "../support/scratch.ts";

const scratchHomeDirs: string[] = [];

function scratchHomeDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-cli-journal-home-"));
	scratchHomeDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (scratchHomeDirs.length > 0) {
		const dir = scratchHomeDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("parseJournalAddArgs (real, GREEN today -- ordinary CLI plumbing)", () => {
	it("requires --kind, naming the closed vocabulary when missing", () => {
		const result = parseJournalAddArgs(["some text"]);
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/--kind/) });
	});

	it("rejects a --kind value outside JOURNAL_KINDS, naming the valid values (FR-2/BR-7)", () => {
		const result = parseJournalAddArgs(["some text", "--kind", "not-a-real-kind"]);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected ok:false");
		expect(result.error).toMatch(/not-a-real-kind/);
		expect(result.error).toMatch(/reasoning/);
		expect(result.error).toMatch(/checkpoint/);
	});

	it("requires the positional text", () => {
		const result = parseJournalAddArgs(["--kind", "decision"]);
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/text/i) });
	});

	it("rejects a --gate outside 1-14", () => {
		const result = parseJournalAddArgs(["some text", "--kind", "decision", "--gate", "99"]);
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/gate number/i) });
	});

	it("accepts the full flag surface", () => {
		const result = parseJournalAddArgs(["some text", "--kind", "decision", "--gate", "6", "--session", "sess-1"]);
		expect(result).toEqual({
			ok: true,
			flags: { kind: "decision", text: "some text", gate: 6, sessionId: "sess-1" },
		});
	});
});

describe("parseJournalRecallArgs / parseJournalSearchArgs / parseJournalSupersedeArgs (real, GREEN today)", () => {
	it("recall requires a query", () => {
		const result = parseJournalRecallArgs(["--gate", "3"]);
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/query/i) });
	});

	it("recall rejects a --gate outside 1-14", () => {
		const result = parseJournalRecallArgs(["a question", "--gate", "0"]);
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/gate number/i) });
	});

	it("search splits a comma-separated --kind into an array, deferring validation to search.ts", () => {
		const result = parseJournalSearchArgs(["--kind", "decision,error", "--session", "sess-1"]);
		expect(result).toEqual({
			ok: true,
			flags: {
				kind: ["decision", "error"],
				gate: undefined,
				sessionId: "sess-1",
				since: undefined,
				until: undefined,
				text: undefined,
			},
		});
	});

	it("supersede requires --id, --mode, and the positional text", () => {
		expect(parseJournalSupersedeArgs(["texto"])).toEqual({ ok: false, error: expect.stringMatching(/--id/) });
		expect(parseJournalSupersedeArgs(["texto", "--id", "j-1"])).toEqual({
			ok: false,
			error: expect.stringMatching(/--mode/),
		});
		expect(parseJournalSupersedeArgs(["texto", "--id", "j-1", "--mode", "bogus"])).toEqual({
			ok: false,
			error: expect.stringMatching(/update.*forget.*invalidate/s),
		});
	});
});

describe("conductor journal (dispatcher wiring) -- argument shape (real, GREEN today, no fs writes)", () => {
	let project: ScratchProject;

	it("rejects an unknown journal subcommand", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);
			const code = await runCli(["journal", "bogus"], io);
			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/unknown subcommand/);
		} finally {
			project.cleanup();
		}
	});

	it("`journal add` with no --kind fails before ever touching the real diary", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);
			const code = await runCli(["journal", "add", "some text"], io);
			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/--kind/);
		} finally {
			project.cleanup();
		}
	});

	it("`journal recall` with no query fails fast", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);
			const code = await runCli(["journal", "recall"], io);
			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/query/i);
		} finally {
			project.cleanup();
		}
	});

	it("`journal supersede` with no --id/--mode fails fast", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);
			const code = await runCli(["journal", "supersede", "texto"], io);
			expect(code).not.toBe(0);
			expect(stderr()).toMatch(/--id/);
		} finally {
			project.cleanup();
		}
	});

	it("recognizes `search`/`digest` as valid subcommands (read-only against a never-before-seen project id -- see this file's header)", async () => {
		project = createScratchProject();
		try {
			const { io: io1, stderr: stderr1 } = createCapturingIo(project.root);
			const codeSearch = await runCli(["journal", "search"], io1);
			expect(stderr1()).not.toMatch(/unknown subcommand/);
			expect(codeSearch).toBe(0);

			const { io: io2, stderr: stderr2 } = createCapturingIo(project.root);
			const codeDigest = await runCli(["journal", "digest"], io2);
			expect(stderr2()).not.toMatch(/unknown subcommand/);
			expect(codeDigest).toBe(0);
		} finally {
			project.cleanup();
		}
	});

	it("`journal digest --out <path>` writes the Markdown to the workspace file, not stdout (D4: the only Diary artifact allowed in the workspace)", async () => {
		project = createScratchProject();
		try {
			const outPath = join(project.root, "digest.md");
			const { io, stdout } = createCapturingIo(project.root);

			const code = await runCli(["journal", "digest", "--out", outPath], io);

			expect(code).toBe(0);
			expect(stdout()).toMatch(/Digest written to/);
			// Even with zero entries, renderDigest's own deterministic header is written to the file.
			expect(readFileSync(outPath, "utf8")).toMatch(/# Diary digest/);
		} finally {
			project.cleanup();
		}
	});

	it("`journal ingest` is a declared, named stub -- reachable as a real subcommand, not 'unknown subcommand'", async () => {
		project = createScratchProject();
		try {
			const { io, stderr } = createCapturingIo(project.root);
			const code = await runCli(["journal", "ingest"], io);
			expect(code).not.toBe(0);
			expect(stderr()).not.toMatch(/unknown subcommand/);
			expect(stderr()).toMatch(/not implemented/);
		} finally {
			project.cleanup();
		}
	});
});

describe("conductor journal -- end-to-end against the real @conductor/diary engine (scratch homeDir, see this file's header)", () => {
	let project: ScratchProject;
	let homeDir: string;

	it("full cycle: add -> recall finds it -> search finds it -> digest includes it -> supersede corrects it", () => {
		project = createScratchProject();
		homeDir = scratchHomeDir();
		try {
			const addResult = runJournalAdd({
				cwd: project.root,
				kind: "decision",
				text: "usa JSONL append-only como fonte de verdade do diario",
				gate: 6,
				homeDir,
			});
			expect(addResult).toMatch(/Recorded journal entry/);
			const id = addResult.match(/Recorded journal entry (\S+)/)?.[1];
			expect(id).toBeTruthy();
			if (!id) throw new Error("expected an id in the confirmation message");

			// recall (D6, semantic/lexical scoring) finds the entry by its own text
			const recallResult = runJournalRecall({ cwd: project.root, query: "fonte de verdade do diario", homeDir });
			expect(recallResult).toMatch(/fonte de verdade do diario/);

			// search (D6, structured facet) finds it by kind+gate
			const searchResult = runJournalSearch({ cwd: project.root, kind: ["decision"], gate: 6, homeDir });
			expect(searchResult).toMatch(/fonte de verdade do diario/);

			// digest (G5) groups it under its own kind heading
			const digestResult = runJournalDigest({ cwd: project.root, homeDir });
			expect(digestResult.length).toBeGreaterThan(0);
			expect(digestResult).toMatch(/## decision/);
			expect(digestResult).toMatch(/fonte de verdade do diario/);

			// supersede (D7): an append-only correction, never a mutation
			const supersedeResult = runJournalSupersede({
				cwd: project.root,
				id,
				mode: "update",
				text: "texto corrigido apos revisao",
				homeDir,
			});
			expect(supersedeResult).toMatch(/Recorded correction/);
			expect(supersedeResult).toContain(id);

			// the correction replaces the original in the ACTIVE view search/recall read (D7/BR-5)
			const searchAfter = runJournalSearch({ cwd: project.root, homeDir });
			expect(searchAfter).toMatch(/texto corrigido apos revisao/);
			expect(searchAfter).not.toMatch(/fonte de verdade do diario/);

			// digest reads the RAW history (readAll) -- both the original and the correction still appear
			// (D7/§8.2: "log/digest/export leem o histórico bruto... AMBAS aparecem, em ordem, sempre")
			const digestAfter = runJournalDigest({ cwd: project.root, homeDir });
			expect(digestAfter).toMatch(/fonte de verdade do diario/);
			expect(digestAfter).toMatch(/texto corrigido apos revisao/);
		} finally {
			project.cleanup();
		}
	});

	it("recall reports 'no matching memory' explicitly rather than forcing an unrelated hit (FR-6)", () => {
		project = createScratchProject();
		homeDir = scratchHomeDir();
		try {
			runJournalAdd({ cwd: project.root, kind: "decision", text: "algo completamente sem relacao", homeDir });

			const result = runJournalRecall({ cwd: project.root, query: "circuit breaker bulkhead timeout", homeDir });

			expect(result).toMatch(/no matching memory/i);
		} finally {
			project.cleanup();
		}
	});

	it("search reports an unknown-facet error explicitly (FR-9/BR-8) instead of silently ignoring a bad --kind", () => {
		project = createScratchProject();
		homeDir = scratchHomeDir();
		try {
			expect(() => runJournalSearch({ cwd: project.root, kind: ["not-a-real-kind"] as never, homeDir })).toThrow(
				/unknown kind/i,
			);
		} finally {
			project.cleanup();
		}
	});

	it("supersede refuses an unknown id without throwing an fs error (the KeyError analogue, edge case 6)", () => {
		project = createScratchProject();
		homeDir = scratchHomeDir();
		try {
			expect(() =>
				runJournalSupersede({ cwd: project.root, id: "never-recorded-id", mode: "forget", text: "texto", homeDir }),
			).toThrow(/unknown entry id/);
		} finally {
			project.cleanup();
		}
	});
});
