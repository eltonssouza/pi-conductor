/**
 * Code-aware index: per-project, redacted, allowlisted, git-ignore-aware -- BORDA: fs/sqlite
 * (docs/adr/0006-fase5-library-and-grounding.md D6/D7, Apêndice §19; gate3-addendum-fase5.md
 * R31/R32/R37; gate2-spec-fase5.md FR-7).
 *
 * GATE 5 (test-first): every exported function below is a STUB that throws "not implemented" (or, for
 * the two pure helpers, deliberately still throws so a caller who wires them before Gate 6 gets a
 * loud failure, not a silent wrong answer) -- Gate 6 implements the bodies. This file ships the
 * signatures test/code-index.test.ts already compiles and tests against.
 *
 * Five separate concerns, deliberately kept as five small functions rather than one "index a project"
 * do-everything call, because each is independently testable without disk/SQLite (Managing Software
 * Complexity -- Complete Professional Guide's own "deep module" reasoning: a narrow, testable seam per
 * concern, not one wide one):
 *
 *   1. `openCodeIndex` -- D7's fail-closed manifest check + the D7 §10.3/R37 refusal to ever open an
 *      index found UNDER the workspace (that artifact has no legitimate producer after this ADR --
 *      it is a forgery indicator, not "someone's stale build output").
 *   2. `isAllowedCodeIndexExtension` -- D6 §9.2's ALLOWLIST (not denylist) of file extensions eligible
 *      for code-aware indexing at all.
 *   3. `filterIndexableCodeFiles` -- D6 §9.3's git-ignore exclusion, fail-closed when the check itself
 *      cannot be answered (never "index everything because git didn't respond").
 *   4. `prepareCodeChunkForEmbedding` -- D6's ordering invariant, "read -> redact -> chunk -> embed",
 *      calling the shared redaction seam's NEW 7th sink (`"codeIndex"`, `@conductor/runtime`'s
 *      `REDACTION_SINKS`, extended by the PARALLEL Gate 5 stream scoped to that package -- this file
 *      never imports that package; it depends on a locally-declared, structurally-compatible
 *      `CodeIndexRedactor` port instead, injected by whichever composition root wires the two
 *      packages together at Gate 6).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveLibraryHome } from "./library-home.ts";

/** The open per-project code index handle. Minimal on purpose at Gate 5 -- ingestion/search
 * operations are added when Gate 6 wires the real `node:sqlite` schema (D1/D7); this file's own test
 * only exercises `openCodeIndex`'s OPEN-time decisions (manifest match, refusal to open a
 * workspace-supplied artifact), never a query against the store's contents. */
export interface CodeIndexStore {
	close(): void;
}

export interface OpenCodeIndexOptions {
	/** Testability seam (Apêndice §19 marks its own contracts "illustrative, not production-ready" --
	 * this is the one place this package widens a two-arg contract with an optional third parameter):
	 * the resolved `~/.conductor/library/**` paths to use, so tests never touch the real OS home
	 * directory. Defaults to `resolveLibraryHome()` over the real home directory in production. */
	home?: import("./library-home.ts").LibraryHomePaths;
}

export type OpenCodeIndexResult =
	| { ok: true; store: CodeIndexStore }
	| { ok: false; reason: "project-mismatch" | "repo-supplied-path-refused" | "missing" | "corrupt" };

/** The `.conductor/library` path checked under a workspace, plus whether it exists — detection BY PATH
 * ALONE (R37/T56), the exact discipline `openCodeIndex` refuses on, factored out so the composition
 * root (`library status`) can reuse it to audit + escalate the same forgery indicator. */
export interface RepoSuppliedArtifactDetection {
	/** True iff a `.conductor/library` artifact exists under `workspaceRealPath` — after D7/D9 no
	 * legitimate build of this tool ever writes one there, so its presence is a forgery indicator. */
	detected: boolean;
	/** The `<workspaceRealPath>/.conductor/library` path that was checked — always present, so a caller
	 * can name it in an alert whether or not it was detected. */
	path: string;
}

/**
 * R37/T56 (gate3-addendum-fase5.md §8.3): detect a repo-supplied `.conductor/library` artifact under a
 * workspace BY PATH ALONE — never opening/parsing the (attacker-suppliable, possibly binary) file, the
 * one thing "never open it" avoids needing to do. `existsSync` is intentionally the whole check: the
 * trigger is the path existing, not the content. Shared by `openCodeIndex` (which refuses) and the
 * `library status` composition root (which additionally audits the detection as a security deny and
 * escalates it HIGH — R37's two additive requirements on top of §10.3's "never open, never delete").
 */
export function detectRepoSuppliedLibraryArtifact(workspaceRealPath: string): RepoSuppliedArtifactDetection {
	const path = join(workspaceRealPath, ".conductor", "library");
	return { detected: existsSync(path), path };
}

/**
 * Opens the per-project code index for `projectId` (D7 §10.2: `sha256(realpath(workspaceRoot))
 * .slice(0, 16)`, computed by the caller via `library-home.ts`'s `computeProjectId`).
 *
 * Fail-closed decisions, all made BEFORE any attempt to parse the on-disk SQLite file's contents:
 *   - `"repo-supplied-path-refused"`: a `.conductor/library` artifact (of ANY shape/content) found
 *     UNDER `workspaceRealPath` is refused by PATH ALONE, never opened -- D7 §10.3/R37: after this
 *     ADR, no legitimate build of this tool ever writes such an artifact under a workspace, so its
 *     mere presence in a clone is a forgery indicator (T56), and validating it would require parsing
 *     an attacker-suppliable binary format, which is the one thing "never open it" avoids needing to
 *     do at all.
 *   - `"project-mismatch"`: the per-machine index at `~/.conductor/library/projects/<projectId>/
 *     code.sqlite` exists and opens, but its own `meta.projectId` does not equal `projectId` --
 *     refused rather than silently trusted (defense in depth against a hand-edited/swapped file).
 *   - `"missing"` / `"corrupt"`: no per-machine index exists yet for this project, or it exists but
 *     fails to open as a well-formed database.
 */
export function openCodeIndex(
	projectId: string,
	workspaceRealPath: string,
	options: OpenCodeIndexOptions = {},
): OpenCodeIndexResult {
	// D7 §10.3/R37: refuse BY PATH ALONE, before ANY attempt to open/parse anything under the
	// workspace -- checked first, and unconditionally, so a forged artifact's bytes are never touched
	// regardless of whether a legitimate per-machine index also happens to exist for this project. Uses
	// the SAME detection primitive the `library status` composition root uses to audit + escalate it,
	// so the "what counts as a repo-supplied artifact" definition never drifts between the two.
	if (detectRepoSuppliedLibraryArtifact(workspaceRealPath).detected) {
		return { ok: false, reason: "repo-supplied-path-refused" };
	}

	const home = options.home ?? resolveLibraryHome();
	const dbPath = home.codeDatabase(projectId);

	if (!existsSync(dbPath)) {
		return { ok: false, reason: "missing" };
	}

	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath);
	} catch {
		// Exists but does not even open as a well-formed SQLite database (e.g. truncated/corrupted file).
		return { ok: false, reason: "corrupt" };
	}

	let storedProjectId: string | undefined;
	try {
		const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("projectId") as { value: string } | undefined;
		storedProjectId = row?.value;
	} catch {
		// Opens as SQLite but the expected `meta` manifest table/row is missing or malformed.
		db.close();
		return { ok: false, reason: "corrupt" };
	}

	if (storedProjectId === undefined) {
		db.close();
		return { ok: false, reason: "corrupt" };
	}

	if (storedProjectId !== projectId) {
		// Defense in depth: never silently trust a hand-edited/swapped file (D7 §10.2).
		db.close();
		return { ok: false, reason: "project-mismatch" };
	}

	return { ok: true, store: { close: () => db.close() } };
}

/**
 * D6 §9.2's ALLOWLIST (never a denylist) of extensions eligible for code-aware indexing at all --
 * deliberately excludes the file types the reference (`intelligence/code_aware_rag.py`) indexed and
 * that motivated T50: `.tf`/`.hcl`/`.json`/`.yaml`/`.yml`/`.sql`/`.sh`/`.toml`/`.xml`, plus
 * credential-shaped filenames (`.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.ppk`,
 * `id_rsa*`, `.netrc`, `.htpasswd`, `.tfvars`, `.tfstate`) named explicitly in the ADR so a future
 * addition to the allowlist is a conscious decision, never an oversight.
 */
/** D6 §9.2's exact allowlist -- copied verbatim from the ADR, not approximated, so an addition is a
 * conscious edit to this literal set rather than a guess at "common code extensions". */
const ALLOWED_CODE_INDEX_EXTENSIONS: ReadonlySet<string> = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
	".java",
	".kt",
	".scala",
	".rb",
	".php",
	".cs",
	".c",
	".h",
	".cpp",
	".hpp",
	".swift",
	".md",
]);

export function isAllowedCodeIndexExtension(path: string): boolean {
	const basename = path.split(/[/\\]/).pop() ?? path;
	const lastDot = basename.lastIndexOf(".");
	// No dot at all (e.g. `id_rsa`), or a dotfile whose only dot is its leading one (e.g. `.env`,
	// `.env.local`'s FIRST dot, `.netrc`, `.htpasswd`) -- neither has an extension this allowlist can
	// match, so both fail closed to denied. This is what keeps every credential-shaped filename D6
	// §9.2 names (`.env*`, `id_rsa*`, `.netrc`, `.htpasswd`) out WITHOUT a second, separate denylist:
	// they are denied for the same reason `.env.local` is (its own extension, `.local`, is simply
	// absent from the allowlist below) -- one mechanism, not two.
	if (lastDot <= 0) return false;
	const extension = basename.slice(lastDot).toLowerCase();
	return ALLOWED_CODE_INDEX_EXTENSIONS.has(extension);
}

export interface GitIgnoreChecker {
	/** Batch equivalent of `git check-ignore --stdin` (D6 §9.3). Returns the SUBSET of `paths` that
	 * are git-ignored, or `null` if the check itself could not be answered (git absent/timed out/
	 * errored) -- `null` is not "assume none are ignored", see `filterIndexableCodeFiles` below. */
	checkIgnored(paths: readonly string[]): string[] | null;
}

export type FilterIndexableCodeFilesResult = { ok: true; paths: string[] } | { ok: false; reason: "git-check-failed" };

/**
 * Removes git-ignored paths from `paths` (D6 §9.3). When `gitIgnore.checkIgnored` itself cannot
 * answer (returns `null`), this function refuses the WHOLE batch (`{ ok: false, reason:
 * "git-check-failed" }`) rather than indexing everything "to be safe" -- uncertainty here is about
 * CONFIDENTIALITY (is this file supposed to be excluded from version control, and likely secret-
 * bearing?), and the fail-closed direction for a confidentiality question is to withhold, the
 * opposite of `getGitStatus`'s own availability-flavored degrade-to-sentinel (ADR §9.3 draws this
 * distinction explicitly).
 */
export function filterIndexableCodeFiles(
	paths: readonly string[],
	gitIgnore: GitIgnoreChecker,
): FilterIndexableCodeFilesResult {
	const ignored = gitIgnore.checkIgnored(paths);
	if (ignored === null) {
		// The check itself could not be answered -- refuse the WHOLE batch (D6 §9.3: uncertainty about
		// confidentiality fails closed, never "index everything to be safe").
		return { ok: false, reason: "git-check-failed" };
	}
	const ignoredSet = new Set(ignored);
	return { ok: true, paths: paths.filter((path) => !ignoredSet.has(path)) };
}

/**
 * The literal placeholder `@conductor/secrets`' shared `redactSecrets` (via `@conductor/runtime`'s
 * `redactSecrets` wrapper) returns when the underlying matcher itself throws -- duplicated here as a
 * short, documented string constant (not imported from `@conductor/runtime`, to keep this package
 * decoupled from the PARALLEL Gate 5 stream editing that file concurrently) so
 * `prepareCodeChunkForEmbedding` can recognize it and skip indexing a scan-failure placeholder rather
 * than embedding it as if it were real content (ADR §9.1: "indexar um placeholder polui o índice sem
 * benefício"). MUST be kept byte-for-byte identical to `@conductor/runtime/src/redaction.ts`'s
 * `SECRET_SCAN_FAILED_PLACEHOLDER` -- a Gate 6 integration test (owned by whichever side wires the two
 * packages together) is the right place to assert the two never drift apart.
 */
export const SECRET_SCAN_FAILED_MARKER = "[REDACTED: secret-scan failed — content withheld]";

/** The shape this package needs from `@conductor/runtime`'s redaction seam (D6's new 7th sink,
 * `"codeIndex"`) -- a structurally-compatible PORT this package depends on, never a direct import of
 * `@conductor/runtime`'s redaction.ts (that file is in the PARALLEL Gate 5 stream's scope; Gate 6's
 * composition root is what actually wires a real `redactSecrets` call here). */
export interface CodeIndexRedactor {
	redact(text: string, sink: "codeIndex"): string;
}

/**
 * D6's ordering invariant: `rawContent` is redacted BEFORE it is chunked (never chunk-then-redact,
 * never embed-then-redact-on-output) -- an embedding computed over a secret remains recoverable by
 * semantic similarity even if the text shown to a user is later masked, so the fix has to happen
 * before the embed step exists at all, which this package enforces by never handing `chunk` anything
 * that has not already gone through `redactor.redact`.
 *
 * When the redactor reports a scan failure (`redactor.redact` returns
 * `SECRET_SCAN_FAILED_MARKER`), this function returns an EMPTY chunk list rather than chunking and
 * indexing the placeholder text (ADR §9.1) -- the caller is expected to count this file as
 * "not indexed" (surfaced by `library status`), not as "indexed with degraded content".
 */
export function prepareCodeChunkForEmbedding(
	rawContent: string,
	redactor: CodeIndexRedactor,
	chunk: (redactedText: string) => import("./chunking.ts").MarkdownChunk[],
): import("./chunking.ts").MarkdownChunk[] {
	// D6 §9.1's ordering invariant: redact BEFORE chunk, always -- `rawContent` itself is never passed
	// to `chunk`.
	const redacted = redactor.redact(rawContent, "codeIndex");
	if (redacted === SECRET_SCAN_FAILED_MARKER) {
		// A scan failure is not degraded content to index anyway -- it is nothing to index at all.
		return [];
	}
	return chunk(redacted);
}
