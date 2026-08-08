/**
 * Workspace containment + protected-paths policy (pure functions, no I/O side effects beyond
 * fs.realpathSync/fs.existsSync reads).
 *
 * Binding requirements (docs/conductor/gate3-threat-model.md §4 T1/T2, §5 items 1/3):
 *   - Never do a lexical/string path check (see the naive examples/protected-paths.ts and
 *     examples/permission-gate.ts extensions shipped with Pi, which use `path.includes()` —
 *     exactly the anti-pattern this module replaces).
 *   - Canonicalize via fs.realpathSync, walking up to the nearest existing ancestor for paths
 *     that do not exist yet (so a not-yet-created file inside a workspace-escaping symlink chain
 *     is still caught).
 *   - A protected-paths deny-list is checked independently of (and before) workspace containment,
 *     so it still holds if the allowed roots are ever widened later.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface WorkspacePolicyOptions {
	/** Absolute path to the workspace root. Must already exist. */
	workspaceRoot: string;
	/** Extra absolute paths to deny, beyond defaultProtectedPaths(). */
	additionalProtectedPaths?: string[];
	/**
	 * FR-6 / Gate 8 loop-back (Fase 3, gate3-addendum-fase3.md R20; journal 2026-08-06 Gate 4
	 * decision): extra roots a path may resolve into and still be allowed, ADDITIONAL to
	 * `workspaceRoot` -- consulted ONLY by the `read` call path (permission-gate.ts's `decideToolCall`
	 * builds a SEPARATE `WorkspacePolicyOptions` value carrying this field for its `read` branch alone;
	 * the `write`/`edit` branches and the `bash` decision both keep using the plain options object with
	 * this field absent). `evaluateToolPath` itself does not know or care which tool is calling it --
	 * the read-only guarantee is a property of WHO populates this field, not of this function refusing
	 * to look at it, exactly like `additionalProtectedPaths` above is already "whichever list the
	 * caller assembles, evaluated exactly as given."
	 *
	 * Real motivation: Gate 8's second pass found that the 44 built-in skills a session's system prompt
	 * already discloses by name+description+`<location>` (FR-5) live OUTSIDE any user workspaceRoot by
	 * construction (packaged with the CLI, resolved via `import.meta.url` -- see
	 * `conductor-cli`'s `builtin-paths.ts`), so a model instructed to `read` one for its body (FR-6) was
	 * denied every single time -- announcing a location the system can never actually open is a
	 * contradiction between FR-5 and FR-6, not a security boundary anyone intended. These entries are
	 * expected to be paths that ALREADY passed `filterSkillsWithinRoots`/R20 before being disclosed to
	 * the model (`skill-catalog.ts`'s `loadBuiltinSkillCatalog`) -- this option never opens a NEW,
	 * unvetted directory to read access, it only stops re-denying locations a different mechanism
	 * already proved contained and already put in the prompt.
	 */
	additionalAllowedReadRoots?: string[];
}

export interface PathCheckResult {
	allowed: boolean;
	reason?: string;
	/** The canonicalized real path that was actually evaluated. */
	realPath?: string;
}

/**
 * Resolve `targetPath` (relative or absolute) to its canonical real path, resolving symlinks.
 * For a path that does not exist yet, walks up to the nearest existing ancestor, canonicalizes
 * that ancestor, and rejoins the non-existent remainder.
 */
export function resolveRealPath(targetPath: string, baseDir: string): string {
	const absolute = isAbsolute(targetPath) ? targetPath : resolve(baseDir, targetPath);

	const remainder: string[] = [];
	let current = absolute;
	// The filesystem root (e.g. "/" or "C:\") always exists, so this loop is guaranteed to
	// terminate: worst case, it walks all the way up to the root and canonicalizes that.
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) {
			// Reached the filesystem root and even that doesn't exist — a genuine I/O oddity.
			// Let the caller's fail-closed wrapper turn this into a deny.
			throw new Error(`resolveRealPath: no existing ancestor found while resolving "${targetPath}"`);
		}
		remainder.unshift(basename(current));
		current = parent;
	}

	const realAncestor = realpathSync(current);
	return remainder.length > 0 ? join(realAncestor, ...remainder) : realAncestor;
}

/** True when `candidateRealPath` is `rootRealPath` or a descendant of it. Both must already be real paths. */
export function isWithinRoot(candidateRealPath: string, rootRealPath: string): boolean {
	if (candidateRealPath === rootRealPath) return true;
	// Compare with a trailing separator so "/workspace-evil" cannot pass as being "within"
	// "/workspace" via a naive startsWith() substring match.
	const rootWithSep = rootRealPath.endsWith(sep) ? rootRealPath : rootRealPath + sep;
	return candidateRealPath.startsWith(rootWithSep);
}

/**
 * The default protected-paths list (plan §4.3 / gate3-threat-model.md §5 item 3): credential and
 * config directories that must never be reachable by write/edit/bash, independent of workspace
 * containment. Paths under the home directory do not need to exist to be protected — a tool must
 * not be able to *create* ~/.ssh either.
 *
 * When `workspaceRoot` is supplied, the list also includes `.conductor/config.json` and
 * `.conductor/policy.json` *inside that workspace* (Fase-1 Gate 3 addendum T13 —
 * docs/conductor/gate3-fase1-addendum.md §2 T13 / §3 secure default 9; docs/adr/0002-fase1-cli-foundation.md
 * §7.4): those two files hold the very policy this gate enforces (allowedRoots, protected paths,
 * provider consent). Because they live *inside* the workspace, workspace containment alone would
 * leave them writable by the write/edit tools this same gate governs — a confused-deputy where a
 * tool (possibly acting under prompt injection) widens its own authority by editing the file that
 * restricts it. Folding this into `defaultProtectedPaths()` itself — rather than requiring every
 * future caller (e.g. a future `conductor chat`) to remember to pass
 * `.conductor/{config,policy}.json` via `additionalProtectedPaths`) — makes the protection
 * secure-by-default: it cannot be omitted by a caller that forgets. The policy can still change, but
 * only out-of-band (a human editor, or a dedicated `conductor config` CLI command that never runs
 * through `pi.on("tool_call")` — ADR 0002 §7.3), never by the agent acting on itself. The
 * `workspaceRoot`-less overload keeps returning exactly the home-directory list it always has, so
 * existing callers (and this file's own unit tests) are unaffected.
 *
 * Fase 2 (ADR 0003 §7, gate3-addendum-fase2.md T25/T26/R9) extends the same reasoning to
 * `.conductor/audit.jsonl`: the audit trail must be unerasable by the very agent whose actions it
 * records, for the same confused-deputy reason as config.json/policy.json above. This closes the
 * write/edit half of T25 by construction; the `bash` half (an agent cannot achieve via free-text
 * shell what write/edit already can't) is the Command Classifier's job (command-classifier.ts
 * signal 8, which calls this same function — "one path authority, two callers", ADR §3.3).
 *
 * `.conductor/policy-trust.json` (ADR 0003 §5.3, R11(b), gate8-validation §7 loop-back): the
 * trust-on-first-use ledger `policy-trust-store.ts` reads is itself T26-like sensitive data — an
 * agent under prompt injection that could write/edit this file would "approve" its own hostile
 * policy.json grant by another door, reopening T18 through the very store meant to gate it (ADR
 * §5.3: "o ledger... é ele próprio um store sensível"). Folded in here for the same
 * secure-by-default reason as its three siblings above: no future caller can forget it.
 *
 * D10/S1 (Fase 7, ADR 0008-fase7-model-routing-and-providers.md §1.1 finding F3, §14.2, §15;
 * gate3-addendum-fase7.md secure-default 64): the vendor's own per-machine credential+catalog
 * directory, `getAgentDir()` (`~/.pi/agent/`, holding `auth.json` and `models.json` — a provider's
 * `baseUrl`/`apiKey`), was reachable by the agent's own read/write/edit/bash tools with no prior
 * fase protecting it — the SAME confused-deputy reasoning as `~/.conductor/{library,diary}` above,
 * now applied to a subtree this package does not own. The REAL exported vendor function is used
 * (never a hardcoded `join(homedir(), ".pi", "agent")` literal), so this stays correct under a
 * `PI_CODING_AGENT_DIR` override.
 *
 * D10/S2 (same ADR §14.2/§15; secure-default 65): the delegation child's own catalog/credential
 * directory (`tools/task.ts`'s `createGovernedChildSessionSpawner`, historically `agentDir =
 * join(workspaceRoot, ".conductor-agent")`) is the T73 attack surface — a hostile clone planting
 * `.conductor-agent/models.json` (an `openai-compatible` provider with an attacker `baseUrl` +
 * inline `apiKey`, both permitted by the vendor's schema) is closed here at the path-authority
 * layer, in DEFENSE IN DEPTH alongside `task.ts`'s own fix (the spawner no longer points the
 * child's model paths inside the workspace at all) — the subtree stays protected regardless of
 * whether some future call site reintroduces a workspace-scoped pointer into it.
 */
export function defaultProtectedPaths(workspaceRoot?: string): string[] {
	const home = homedir();
	const paths = [
		join(home, ".ssh"),
		join(home, ".aws"),
		join(home, ".gnupg"),
		join(home, ".kube"),
		join(home, ".docker"),
		join(home, ".config"),
		join(home, ".conductor", "credentials"),
		// D9 (ADR 0006 §12, Fase 5): the corpus, per-project code index, and grounding ledger must be as
		// unwritable by write/edit/bash as the audit trail and GateState store already are -- the same
		// confused-deputy reasoning as every other entry in this list, applied to the whole
		// ~/.conductor/library subtree (corpus.sqlite, projects/<projectId>/{code.sqlite,events.jsonl}).
		join(home, ".conductor", "library"),
		// D4 (ADR 0007 §6/§12.4, Fase 6): the diary's authoritative entries.jsonl (the log that feeds
		// runtimeRecordedJournalEntryIds, D2/G12) and its derived index.sqlite must be as unwritable by
		// write/edit/bash as the audit trail and GateState store already are -- same confused-deputy
		// reasoning as every other entry in this list, applied to the whole ~/.conductor/diary subtree.
		join(home, ".conductor", "diary"),
		// D10/S1 (Fase 7, secure-default 64) -- see this function's own doc comment above.
		getAgentDir(),
		// GATE 9 (pentest Fase 7, achado F-G9-2 / T73 / R54(ii)): the per-machine home of the model-policy
		// TOFU trust store (`~/.conductor/providers/projects/<projectId>/model-policy-trust.json`, see
		// conductor-cli's `resolveModelPolicyTrustStorePath`). This store decides whether a non-catalog
		// provider endpoint and a downward mandatory-gate remap are authorized at all, so an agent able to
		// write it could grant ITSELF the very trust the store exists to withhold -- the same
		// confused-deputy reasoning that already protects `policy-trust.json`, `audit.jsonl` and
		// `.conductor/gates/`, applied to the one trust store that was missing from this list.
		join(home, ".conductor", "providers"),
	];
	if (workspaceRoot) {
		paths.push(
			join(workspaceRoot, ".conductor", "config.json"),
			join(workspaceRoot, ".conductor", "policy.json"),
			join(workspaceRoot, ".conductor", "policy-trust.json"),
			// F-G9-2 (Gate 9 pentest, Fase 7): the LEGACY in-workspace location of the model-policy trust
			// store. The store itself moved per-machine (entry above) precisely because a repo-supplied pin
			// is no pin at all; this entry is defense in depth, so that a future call site reintroducing a
			// workspace-scoped pointer cannot also make the file agent-writable.
			join(workspaceRoot, ".conductor", "model-policy-trust.json"),
			join(workspaceRoot, ".conductor", "audit.jsonl"),
			// Fase 4 (ADR 0005 §9.1, gate3-addendum-fase4.md R28/T44): the GateState governance store
			// is a NEW security boundary the store's own on-disk location exposes, not a new
			// mechanism -- the SAME "unerasable/unwritable by the very agent whose acts it records"
			// reasoning as audit.jsonl above, now applied to a durable APPROVAL record rather than a
			// log. The WHOLE `.conductor/gates/` subtree is protected -- the `<demand>.json` envelopes
			// AND the `.lock` files sitting alongside them (isWithinRoot() below already makes this a
			// subtree match, not a single-file one, from this single entry) -- so the only way to
			// mutate a GateState is through the `gate *` commands (which route through
			// mutateGateState/GateStateStore, R22/R27), never a direct write/edit/bash on the file.
			join(workspaceRoot, ".conductor", "gates"),
			// D10/S2 (Fase 7, secure-default 65) -- see this function's own doc comment above.
			join(workspaceRoot, ".conductor-agent"),
		);
	}
	return paths;
}

/** Canonicalize a protected-path entry without requiring it to exist (see defaultProtectedPaths()). */
function realpathOfExistingAncestorOrLexical(candidatePath: string): string {
	try {
		return resolveRealPath(candidatePath, candidatePath);
	} catch {
		// Should not happen in practice (the filesystem root always exists), but if it does,
		// fall back to the lexical absolute path rather than throwing out of a protected-paths
		// check — under-protecting here would be worse than a purely lexical fallback.
		return candidatePath;
	}
}

/**
 * Evaluate whether a tool-supplied path is allowed: not in a protected location, and contained
 * within the workspace root. Never throws for an ordinary "path is outside" case — returns
 * `{ allowed: false, reason }` instead. May throw for a genuine I/O error, which callers must
 * handle fail-closed (see fail-closed.ts).
 */
export function evaluateToolPath(rawPath: string, options: WorkspacePolicyOptions): PathCheckResult {
	const workspaceReal = resolveRealPath(options.workspaceRoot, options.workspaceRoot);
	const targetReal = resolveRealPath(rawPath, options.workspaceRoot);

	const protectedRoots = [
		...defaultProtectedPaths(options.workspaceRoot),
		...(options.additionalProtectedPaths ?? []),
	];
	for (const protectedPath of protectedRoots) {
		const protectedReal = realpathOfExistingAncestorOrLexical(protectedPath);
		if (isWithinRoot(targetReal, protectedReal)) {
			return {
				allowed: false,
				reason: `"${rawPath}" resolves into a protected location (${protectedPath})`,
				realPath: targetReal,
			};
		}
	}

	if (isWithinRoot(targetReal, workspaceReal)) {
		return { allowed: true, realPath: targetReal };
	}

	// FR-6/Gate 8 loop-back: a path outside workspaceRoot may still be allowed if it resolves into one
	// of the already-vetted extra roots the caller supplied (see this field's own doc comment above for
	// why this can never widen write/edit/bash — only whichever caller populates the field decides
	// that). Checked AFTER workspace containment (the common case stays a single check) but the
	// protected-paths loop above still ran first regardless, so a protected path is never rescued by
	// being inside an allowed-read root either.
	for (const readRoot of options.additionalAllowedReadRoots ?? []) {
		const readRootReal = realpathOfExistingAncestorOrLexical(readRoot);
		if (isWithinRoot(targetReal, readRootReal)) {
			return { allowed: true, realPath: targetReal };
		}
	}

	return {
		allowed: false,
		reason: `"${rawPath}" resolves outside the workspace root`,
		realPath: targetReal,
	};
}
