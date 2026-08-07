/**
 * Test-first (Gate 5) for the code-aware index (src/code-index.ts) -- ADR 0006 D6/D7, Apêndice §19;
 * gate3-addendum-fase5.md R31/R32/R37; gate2-spec-fase5.md FR-7.
 *
 * Every function under test is currently a STUB that throws "not implemented" -- every test below
 * fails RED for that one reason today (Gate 6 implements the bodies).
 *
 * `openCodeIndex`'s tests use a REAL scratch directory (never the developer's actual
 * `~/.conductor/library`) via the `home` testability seam `OpenCodeIndexOptions` adds on top of the
 * ADR's two-argument signature (see src/code-index.ts's own header for why).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownChunk } from "../src/chunking.ts";
import {
	type CodeIndexRedactor,
	filterIndexableCodeFiles,
	type GitIgnoreChecker,
	isAllowedCodeIndexExtension,
	openCodeIndex,
	prepareCodeChunkForEmbedding,
	SECRET_SCAN_FAILED_MARKER,
} from "../src/code-index.ts";
import type { LibraryHomePaths } from "../src/library-home.ts";

const scratchDirs: string[] = [];

function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (scratchDirs.length > 0) {
		const dir = scratchDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

/** A fake `LibraryHomePaths` rooted at a scratch directory -- never the developer's real home. */
function fakeHome(root: string): LibraryHomePaths {
	return {
		root,
		corpusDatabase: join(root, "corpus.sqlite"),
		projectDir: (projectId: string) => join(root, "projects", projectId),
		codeDatabase: (projectId: string) => join(root, "projects", projectId, "code.sqlite"),
		eventsLog: (projectId: string) => join(root, "projects", projectId, "events.jsonl"),
	};
}

function writeSqliteWithProjectId(path: string, projectId: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);");
	db.prepare("INSERT INTO meta(key, value) VALUES ('projectId', ?)").run(projectId);
	db.close();
}

describe("openCodeIndex -- D7 fail-closed manifest check", () => {
	it("refuses with project-mismatch when the on-disk meta.projectId differs from the requested projectId, never silently trusting it", () => {
		const home = fakeHome(scratchDir("conductor-library-home-"));
		const workspaceRealPath = scratchDir("conductor-workspace-");
		const requestedProjectId = "requested00000001";
		writeSqliteWithProjectId(home.codeDatabase(requestedProjectId), "some-other-stored-id");

		const result = openCodeIndex(requestedProjectId, workspaceRealPath, { home });

		expect(result).toEqual({ ok: false, reason: "project-mismatch" });
	});

	it("D7 §10.3/R37: refuses a .conductor/library artifact found UNDER the workspace by PATH ALONE, never opening/parsing it", () => {
		const home = fakeHome(scratchDir("conductor-library-home-"));
		const workspaceRealPath = scratchDir("conductor-workspace-");
		const repoSuppliedPath = join(workspaceRealPath, ".conductor", "library", "code.sqlite");
		mkdirSync(dirname(repoSuppliedPath), { recursive: true });
		// Deliberately NOT a valid SQLite file -- if openCodeIndex ever attempted to open this as a
		// database, DatabaseSync would throw a native "file is not a database" error instead of
		// returning this structured refusal. The test proves the refusal happens by PATH, before any
		// attempt to read the file's content.
		writeFileSync(repoSuppliedPath, "this is not a real sqlite database, corrupted on purpose");

		expect(() => openCodeIndex("any-project-id-000", workspaceRealPath, { home })).not.toThrow();
		const result = openCodeIndex("any-project-id-000", workspaceRealPath, { home });
		expect(result).toEqual({ ok: false, reason: "repo-supplied-path-refused" });
	});

	it('reports "missing" when no per-machine index exists yet for this project (not project-mismatch, not corrupt)', () => {
		const home = fakeHome(scratchDir("conductor-library-home-"));
		const workspaceRealPath = scratchDir("conductor-workspace-");

		const result = openCodeIndex("never-indexed-project", workspaceRealPath, { home });

		expect(result).toEqual({ ok: false, reason: "missing" });
	});
});

describe("isAllowedCodeIndexExtension (D6 §9.2: allowlist, never a denylist)", () => {
	const allowed = [
		"src/index.ts",
		"src/App.tsx",
		"lib/thing.js",
		"lib/thing.jsx",
		"esm/thing.mjs",
		"cjs/thing.cjs",
		"scripts/tool.py",
		"cmd/main.go",
		"src/lib.rs",
		"src/Main.java",
		"src/Main.kt",
		"src/Main.scala",
		"app/model.rb",
		"src/index.php",
		"src/Program.cs",
		"src/main.c",
		"src/header.h",
		"src/main.cpp",
		"src/header.hpp",
		"src/App.swift",
		"docs/README.md",
	];

	it.each(allowed)("allows %s (named in the ADR §9.2 allowlist)", (path) => {
		expect(isAllowedCodeIndexExtension(path)).toBe(true);
	});

	const denied = [
		"infra/main.tf",
		"infra/vars.hcl",
		"k8s/deployment.yaml",
		"k8s/deployment.yml",
		"config/service-account.json",
		"db/seed.sql",
		"scripts/deploy.sh",
		"scripts/deploy.bash",
		".env",
		".env.local",
		"certs/server.pem",
		"certs/server.key",
		"certs/bundle.p12",
		"certs/bundle.pfx",
		"certs/keystore.jks",
		"certs/keystore.keystore",
		"certs/id.ppk",
		"id_rsa",
		".netrc",
		".htpasswd",
		"infra/terraform.tfvars",
		"infra/terraform.tfstate",
		"config/app.toml",
		"config/app.xml",
	];

	it.each(denied)("denies %s (T50: secret-bearing file types excluded by default)", (path) => {
		expect(isAllowedCodeIndexExtension(path)).toBe(false);
	});
});

describe("filterIndexableCodeFiles (D6 §9.3: git-ignored exclusion, fail-closed when git cannot answer)", () => {
	it("removes paths the injected git-ignore checker reports as ignored", () => {
		const paths = ["src/index.ts", "dist/index.ts", "src/secret.local.ts"];
		const checker: GitIgnoreChecker = {
			checkIgnored: (candidates) => candidates.filter((p) => p.startsWith("dist/") || p.includes(".local.")),
		};

		const result = filterIndexableCodeFiles(paths, checker);

		expect(result).toEqual({ ok: true, paths: ["src/index.ts"] });
	});

	it("R31/§9.3: refuses the WHOLE batch when the git-ignore check itself cannot answer -- never 'index everything to be safe'", () => {
		const paths = ["src/index.ts", "src/other.ts"];
		const checker: GitIgnoreChecker = { checkIgnored: () => null };

		const result = filterIndexableCodeFiles(paths, checker);

		expect(result).toEqual({ ok: false, reason: "git-check-failed" });
	});
});

describe("prepareCodeChunkForEmbedding (D6 §9.1: read -> redact -> chunk, in that order, before embed)", () => {
	it('calls the redactor with sink "codeIndex" BEFORE chunking, and chunks the REDACTED text, never the raw content', () => {
		const rawContent = "const password = 'super-secret-value';";
		const redactedContent = "const password = '[REDACTED]';";
		const callOrder: string[] = [];

		const redactor: CodeIndexRedactor = {
			redact: (text, sink) => {
				callOrder.push("redact");
				expect(text).toBe(rawContent);
				expect(sink).toBe("codeIndex");
				return redactedContent;
			},
		};

		const sentinelChunks: MarkdownChunk[] = [{ ordinal: 0, section: "", body: redactedContent }];
		const chunk = (textToChunk: string): MarkdownChunk[] => {
			callOrder.push("chunk");
			expect(textToChunk).toBe(redactedContent);
			return sentinelChunks;
		};

		const result = prepareCodeChunkForEmbedding(rawContent, redactor, chunk);

		expect(callOrder).toEqual(["redact", "chunk"]);
		expect(result).toBe(sentinelChunks);
	});

	it("ADR §9.1: a secret-scan failure (the shared placeholder) is never indexed -- returns no chunks and never calls chunk()", () => {
		const rawContent = "const token = 'abcdef123456';";
		let chunkWasCalled = false;

		const redactor: CodeIndexRedactor = { redact: () => SECRET_SCAN_FAILED_MARKER };
		const chunk = (): MarkdownChunk[] => {
			chunkWasCalled = true;
			return [{ ordinal: 0, section: "", body: SECRET_SCAN_FAILED_MARKER }];
		};

		const result = prepareCodeChunkForEmbedding(rawContent, redactor, chunk);

		expect(chunkWasCalled).toBe(false);
		expect(result).toEqual([]);
	});
});
