/**
 * `conductor chat` session scoping + resume resolution (docs/adr/0002-fase1-cli-foundation.md §6,
 * §7.4). Two concerns kept in one small module because they are two facets of the same requirement
 * ("sessão persistente" done as *scoped per-project*, not merely "persistence exists somewhere"):
 *
 *   1. WHERE sessions live: `.conductor/sessions/` inside the project, never Pi's global
 *      `~/.pi/agent/sessions/--<cwd>--/` default (ADR §6's "único ajuste real").
 *   2. WHICH session a given `conductor chat` invocation opens: fresh, the most recent, or one named
 *      explicitly by id -- `--resume [id]`.
 *
 * `resolveSessionManager` is deliberately a thin wrapper over Pi's own already-tested
 * `SessionManager.create`/`.continueRecent`/`.open`/`.list` (examples/sdk/11-sessions.ts) -- it picks
 * which one to call and, for `--resume <id>`, which file that id resolves to; it does not
 * reimplement "most recent" or file-format parsing itself (SOLID Design Principles -- Complete
 * Professional Guide §3.3: depend on the smallest role-shaped interface a caller actually needs,
 * applied here as "reuse the primitive Pi already built and proved, do not re-derive it").
 */

import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export function resolveConductorAgentDir(workspaceRoot: string): string {
	return join(workspaceRoot, ".conductor");
}

export function resolveConductorSessionsDir(workspaceRoot: string): string {
	return join(resolveConductorAgentDir(workspaceRoot), "sessions");
}

export type ResumeSelection = { kind: "fresh" } | { kind: "recent" } | { kind: "specific"; idOrPrefix: string };

export type ParseResumeArgsResult = { ok: true; resume: ResumeSelection } | { ok: false; error: string };

/**
 * Parses `conductor chat`'s own argv tail (everything after "chat"). Accepted forms:
 *   - []                      -> fresh
 *   - ["--resume"]            -> recent
 *   - ["--resume", "<id>"]    -> specific (an id/id-prefix, must not itself look like a flag)
 * Anything else is rejected with a clear, actionable message rather than silently guessing.
 */
export function parseResumeArgs(args: string[]): ParseResumeArgsResult {
	if (args.length === 0) {
		return { ok: true, resume: { kind: "fresh" } };
	}

	if (args[0] !== "--resume") {
		return {
			ok: false,
			error: `conductor chat: unrecognized argument(s): ${args.join(" ")}. Usage: conductor chat [--resume [session-id]]`,
		};
	}

	const rest = args.slice(1);
	if (rest.length === 0) {
		return { ok: true, resume: { kind: "recent" } };
	}

	const [idOrPrefix, ...extra] = rest;
	if (extra.length > 0) {
		return {
			ok: false,
			error: `conductor chat: unrecognized argument(s) after --resume: ${extra.join(" ")}. Usage: conductor chat [--resume [session-id]]`,
		};
	}
	if (idOrPrefix.startsWith("-")) {
		return {
			ok: false,
			error: `conductor chat: --resume expects a session id, not a flag ("${idOrPrefix}"). Usage: conductor chat [--resume [session-id]]`,
		};
	}

	return { ok: true, resume: { kind: "specific", idOrPrefix } };
}

export class SessionNotFoundError extends Error {
	constructor(idOrPrefix: string) {
		super(
			`no session matching id "${idOrPrefix}" found under .conductor/sessions/ -- run \`conductor chat\` with ` +
				"no arguments to start a fresh session, or omit the id to resume the most recent one",
		);
		this.name = "SessionNotFoundError";
	}
}

export interface ResolveSessionManagerOptions {
	workspaceRoot: string;
	sessionsDir: string;
	resume: ResumeSelection;
}

/** Finds the session file whose id starts with `idOrPrefix` (full id or a short, unambiguous
 * prefix -- the same convenience `git` gives for commit hashes). Throws SessionNotFoundError when
 * nothing matches, rather than silently falling back to a fresh session, so a typo'd id is never
 * confused with "start over". */
async function resolveSpecificSession(
	idOrPrefix: string,
	workspaceRoot: string,
	sessionsDir: string,
): Promise<SessionManager> {
	const sessions = await SessionManager.list(workspaceRoot, sessionsDir);
	const match = sessions.find((info) => info.id === idOrPrefix || info.id.startsWith(idOrPrefix));
	if (!match) {
		throw new SessionNotFoundError(idOrPrefix);
	}
	return SessionManager.open(match.path, sessionsDir, workspaceRoot);
}

export async function resolveSessionManager(options: ResolveSessionManagerOptions): Promise<SessionManager> {
	switch (options.resume.kind) {
		case "fresh":
			return SessionManager.create(options.workspaceRoot, options.sessionsDir);
		case "recent":
			return SessionManager.continueRecent(options.workspaceRoot, options.sessionsDir);
		case "specific":
			return resolveSpecificSession(options.resume.idOrPrefix, options.workspaceRoot, options.sessionsDir);
	}
}
