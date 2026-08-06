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

export type ParseResumeArgsResult =
	| { ok: true; resume: ResumeSelection; yesFlagActive: boolean; roleId?: string }
	| { ok: false; error: string };

const YES_FLAG = "--yes";
const ROLE_FLAG = "--role";
const USAGE = "Usage: conductor chat [--resume [session-id]] [--yes] [--role <role-id>]";

/**
 * Extracts `--role <role-id>` from `args`, position-independent like `--yes` below -- but (unlike
 * `--yes`) it takes a value, so it is pulled out as a `[flag, value]` pair rather than filtered by a
 * single string, mirroring how `--resume <id>` itself is parsed a few lines down. Returns the
 * remaining args with the pair removed, so the `--resume` shape below never has to know `--role`
 * exists.
 */
function extractRoleArg(args: string[]): { rest: string[]; roleId?: string; error?: string } {
	const idx = args.indexOf(ROLE_FLAG);
	if (idx === -1) return { rest: args };

	const value = args[idx + 1];
	if (value === undefined || value.startsWith("-")) {
		return {
			rest: args,
			error: `conductor chat: --role requires a role id (e.g. --role backend-engineer). ${USAGE}`,
		};
	}

	return { rest: [...args.slice(0, idx), ...args.slice(idx + 2)], roleId: value };
}

/**
 * Parses `conductor chat`'s own argv tail (everything after "chat"). Accepted forms (FR-19, ADR 0003
 * §4: "--yes só existe como flag explícita de invocação, nunca como default persistido" -- it is
 * parsed fresh from argv on every single invocation, never read from `.conductor/config.json` or any
 * other persisted state):
 *   - []                              -> fresh
 *   - ["--resume"]                    -> recent
 *   - ["--resume", "<id>"]            -> specific (an id/id-prefix, must not itself look like a flag)
 *   - "--yes" may additionally appear ANYWHERE in the above (e.g. ["--yes"], ["--yes", "--resume"],
 *     ["--resume", "--yes"], ["--resume", "<id>", "--yes"]) -- it is stripped out before the
 *     `--resume` shape is validated, so its position relative to `--resume`/the id never matters.
 *   - "--role <role-id>" (Fase 3, ADR 0004 §16 appendix / gate2-spec-fase3.md) may additionally
 *     appear ANYWHERE in the above, same position-independence as `--yes` -- extracted first, so its
 *     position relative to `--resume`/`--yes`/the id never matters either. Role RESOLUTION (does the
 *     id exist, FR-2) is deliberately NOT this function's job -- it only extracts the raw string;
 *     `chat.ts`'s own `prepareChat` resolves it via `role-resolution.ts`, the same "parse here,
 *     validate against real state one level up" split `--resume <id>` itself already uses
 *     (`resolveSessionManager` -- not this function -- is what can throw `SessionNotFoundError`).
 * Anything else (an unrecognized flag, extra positional arguments) is rejected with a clear,
 * actionable message rather than silently guessing.
 */
export function parseResumeArgs(args: string[]): ParseResumeArgsResult {
	const yesFlagActive = args.includes(YES_FLAG);
	const withoutYes = args.filter((arg) => arg !== YES_FLAG);

	const roleExtraction = extractRoleArg(withoutYes);
	if (roleExtraction.error) {
		return { ok: false, error: roleExtraction.error };
	}
	const rest = roleExtraction.rest;
	const roleId = roleExtraction.roleId;

	if (rest.length === 0) {
		return { ok: true, resume: { kind: "fresh" }, yesFlagActive, roleId };
	}

	if (rest[0] !== "--resume") {
		return {
			ok: false,
			error: `conductor chat: unrecognized argument(s): ${rest.join(" ")}. ${USAGE}`,
		};
	}

	const afterResume = rest.slice(1);
	if (afterResume.length === 0) {
		return { ok: true, resume: { kind: "recent" }, yesFlagActive, roleId };
	}

	const [idOrPrefix, ...extra] = afterResume;
	if (extra.length > 0) {
		return {
			ok: false,
			error: `conductor chat: unrecognized argument(s) after --resume: ${extra.join(" ")}. ${USAGE}`,
		};
	}
	if (idOrPrefix.startsWith("-")) {
		return {
			ok: false,
			error: `conductor chat: --resume expects a session id, not a flag ("${idOrPrefix}"). ${USAGE}`,
		};
	}

	return { ok: true, resume: { kind: "specific", idOrPrefix }, yesFlagActive, roleId };
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
