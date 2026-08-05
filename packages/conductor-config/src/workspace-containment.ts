/**
 * Path containment for `.conductor/config.json`.
 *
 * Deliberately re-implemented here rather than imported from conductor-runtime's
 * workspace-policy.ts -- ADR 0002 §3.1 keeps conductor-config, conductor-project and
 * conductor-runtime dependency-free of one another on purpose (each testable in isolation against
 * fixtures, no package needs to mock another). Same real-path-canonicalization discipline as
 * workspace-policy.ts's resolveRealPath/isWithinRoot (see that file's header comment for the full
 * rationale): never a lexical/string path check; canonicalize via fs.realpathSync, walking up to
 * the nearest existing ancestor for a path that does not exist yet, so a not-yet-created config
 * file behind a workspace-escaping symlink is still caught before any write happens.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { WorkspaceContainmentError } from "./errors.ts";

const CONDUCTOR_DIR_NAME = ".conductor";
const CONFIG_FILE_NAME = "config.json";

function resolveRealPath(targetPath: string, baseDir: string): string {
	const absolute = isAbsolute(targetPath) ? targetPath : resolve(baseDir, targetPath);

	const remainder: string[] = [];
	let current = absolute;
	// The filesystem root always exists, so this loop is guaranteed to terminate.
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) {
			throw new WorkspaceContainmentError(`no existing ancestor found while resolving "${targetPath}"`);
		}
		remainder.unshift(basename(current));
		current = parent;
	}

	const realAncestor = realpathSync(current);
	return remainder.length > 0 ? join(realAncestor, ...remainder) : realAncestor;
}

function isWithinRoot(candidateRealPath: string, rootRealPath: string): boolean {
	if (candidateRealPath === rootRealPath) return true;
	// Trailing separator so "/workspace-evil" cannot pass as "within" "/workspace" via a naive
	// startsWith() substring match.
	const rootWithSep = rootRealPath.endsWith(sep) ? rootRealPath : rootRealPath + sep;
	return candidateRealPath.startsWith(rootWithSep);
}

export interface ContainedConfigPath {
	/** Canonicalized real path to workspaceRoot. */
	workspaceRealPath: string;
	/** Canonicalized real path to .conductor/config.json, verified to be inside workspaceRealPath. */
	configRealPath: string;
	/** Canonicalized real path to .conductor/, verified to be inside workspaceRealPath. */
	conductorDirRealPath: string;
}

/**
 * Resolve and validate that `.conductor/config.json` under `workspaceRoot` is genuinely contained
 * within `workspaceRoot`. Rejects a `workspaceRoot` that is not an absolute, already-existing
 * directory, and rejects a `.conductor` that is (or is reached through) a symlink escaping the
 * workspace. Never performs a write itself -- callers use the returned real paths to do that.
 */
export function resolveContainedConfigPath(workspaceRoot: string): ContainedConfigPath {
	if (!isAbsolute(workspaceRoot)) {
		throw new WorkspaceContainmentError(`workspaceRoot must be an absolute path, got "${workspaceRoot}"`);
	}
	if (!existsSync(workspaceRoot)) {
		throw new WorkspaceContainmentError(`workspaceRoot does not exist: "${workspaceRoot}"`);
	}

	const workspaceRealPath = realpathSync(workspaceRoot);
	const lexicalConfigPath = join(workspaceRoot, CONDUCTOR_DIR_NAME, CONFIG_FILE_NAME);
	const configRealPath = resolveRealPath(lexicalConfigPath, workspaceRoot);

	if (!isWithinRoot(configRealPath, workspaceRealPath)) {
		throw new WorkspaceContainmentError(
			`"${CONDUCTOR_DIR_NAME}/${CONFIG_FILE_NAME}" resolves outside the workspace root (possible symlink escape): ${configRealPath}`,
		);
	}

	return {
		workspaceRealPath,
		configRealPath,
		// Derived from configRealPath (already validated), not a fresh lexical join -- correct even
		// if .conductor is itself a symlink pointing elsewhere *inside* the workspace (allowed).
		conductorDirRealPath: dirname(configRealPath),
	};
}
