/**
 * `conductor auth` (ADR 0008 "Fase 7 -- model routing e provedores" D8, §16 `runAuthStatus`;
 * gate2-spec-fase7.md FR-5, edge case 4; gate3-addendum-fase7.md T65/R46(ii), T69/R50).
 *
 * A thin, read-only status report: per known provider, `configured`/`not configured` and, when
 * configured, the exact `source` (`runtime`/`stored`/`environment`/...) `ModelRuntime.
 * getProviderAuthStatus` already resolves with the documented priority `runtime > stored >
 * environment` (D8/edge case 4) -- never re-derived here. R46(ii): an `environment`-sourced
 * credential is reported, not hidden -- visibility is part of the defense against T65 (the
 * `DEEPSEEK_API_KEY` incident class), even though the resolution pipeline (Grupo B/C, a sibling
 * stream's scope) never AUTHORIZES a gate to run on an environment credential alone. R50: only
 * status/source is ever rendered here, never a credential's value -- there is structurally nothing in
 * `AuthStatus` to leak (`{configured, source, label}`, no secret field).
 *
 * Deliberately distinct from `models`/`models why` (ADR §10.2, OQ#7): `auth` must work in a project
 * with NO model-routing policy at all (it is typically the first command anyone runs) -- fusing it
 * with the gate/role-aware `models` command would make "is my key seen?" fail on a policy error that
 * has nothing to do with the question being asked.
 */

import { sanitizeForTerminal } from "@conductor/runtime";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** See `login.ts`'s own header note on this local, duck-typed `CliIO` surface. */
export interface CliIO {
	stdout: { write(chunk: string): void };
}

export interface RunAuthStatusOptions {
	io: CliIO;
	modelRuntime: ModelRuntime;
}

/**
 * ADR 0008 §16 declares `runAuthStatus` as returning `Promise<number>` (symmetry with
 * `runLogin`/`runLogout`, which DO need to await network/interactive I/O). This implementation
 * happens to need none -- `getProviderAuthStatus` is synchronous, no I/O -- so it stays a plain
 * function wrapped in `Promise.resolve(...)` rather than a body-less `async` (which a linter would
 * flag as an async function with no `await`). A future change that DOES need to await something
 * (e.g. a live provider probe) is then a straightforward switch to `async`.
 */
export function runAuthStatus(options: RunAuthStatusOptions): Promise<number> {
	const { io, modelRuntime } = options;
	const providers = [...modelRuntime.getProviders()].sort((a, b) => a.id.localeCompare(b.id));

	const lines = providers.map((provider) => {
		const status = modelRuntime.getProviderAuthStatus(provider.id);
		if (!status.configured) {
			return `${provider.id}: not configured`;
		}
		return `${provider.id}: configured (source: ${sanitizeForTerminal(status.source ?? "unknown")})`;
	});

	io.stdout.write(`${lines.join("\n")}\n`);
	return Promise.resolve(0);
}
