/**
 * Shared git branch/dirty-state detection (docs/adr/0002-fase1-cli-foundation.md §7.2 item 3, §7.5
 * "Branch e dirty state"). Extracted from `commands/doctor.ts` (the original owner of this check) so
 * `commands/chat`'s status line can show the same branch/dirty state without a second, drifting
 * implementation of the underlying `git` subprocess calls -- the round B2 task's own instruction
 * ("git branch+dirty state via the same check pattern doctor.ts already has -- reuse it, don't
 * reimplement"). `doctor.ts` keeps its own `resolveGitTimeoutMs` export (unchanged name/signature,
 * so `test/commands/doctor.test.ts`'s existing imports keep working) as a thin wrapper over
 * `resolveTimeoutMs` here, so each caller can still have its own env-var override name (doctor:
 * `CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS`; chat: `CONDUCTOR_CHAT_GIT_TIMEOUT_MS`) -- quality-baseline
 * category 4 (no hardcoded timeouts) applies to both call sites independently, not just to doctor's.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_GIT_STATUS_TIMEOUT_MS = 5000;

/** Parses a raw env-var string into a positive timeout in ms, falling back to `fallback` for
 * anything unset, non-numeric, or non-positive -- never passes a bad value through to execFile. */
export function resolveTimeoutMs(rawEnvValue: string | undefined, fallback = DEFAULT_GIT_STATUS_TIMEOUT_MS): number {
	if (rawEnvValue === undefined) return fallback;
	const parsed = Number(rawEnvValue);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type GitStatusResult =
	| { kind: "clean"; branch: string }
	| { kind: "dirty"; branch: string }
	| { kind: "unavailable"; reason: string };

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `git status --porcelain` + `git branch --show-current` against `cwd`, bounded by `timeoutMs`.
 * Never throws: every failure (not a git repo, git not on PATH, timeout, anything else) degrades to
 * `{ kind: "unavailable", reason }` -- this check is informational only, never blocking (ADR 0002
 * §7.2 item 3), for both of its callers.
 */
export async function getGitStatus(cwd: string, timeoutMs: number): Promise<GitStatusResult> {
	try {
		const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: timeoutMs });
		const { stdout: branchOut } = await execFileAsync("git", ["branch", "--show-current"], {
			cwd,
			timeout: timeoutMs,
		});
		const branch = branchOut.trim() || "(detached HEAD)";
		const dirty = statusOut.trim().length > 0;
		return dirty ? { kind: "dirty", branch } : { kind: "clean", branch };
	} catch (error) {
		const message = describeError(error);
		if (/not a git repository/i.test(message)) {
			return { kind: "unavailable", reason: "not a git repository -- informational only, this is not required" };
		}
		if (/ENOENT/.test(message)) {
			return { kind: "unavailable", reason: "git executable not found on PATH -- informational only" };
		}
		return { kind: "unavailable", reason: `could not determine git state: ${message}` };
	}
}
