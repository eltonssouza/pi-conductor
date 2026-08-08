/**
 * `conductor logout <provider>` (ADR 0008 "Fase 7 -- model routing e provedores" D8, §16 `runLogout`;
 * gate2-spec-fase7.md FR-3/FR-4, BR-9, edge case 3; gate3-addendum-fase7.md T72/R50/R53).
 *
 * **F2 closed here, not in the vendor package.** `vendor-credential-substrate.test.ts`'s F2(b) proves
 * `RuntimeCredentials.removeRuntimeApiKey` (`packages/coding-agent/src/core/runtime-credentials.ts`)
 * only clears its in-memory overlay Map -- it never touches the wrapped, real `CredentialStore` --
 * and `ModelRuntime.removeRuntimeApiKey` delegates straight into that method. Composing `runLogout`
 * on `modelRuntime.removeRuntimeApiKey` ALONE would therefore reproduce exactly the "credencial-
 * fantasma" (ghost credential) T72/FR-3/BR-9 forbid: gone from the runtime's in-process view, still
 * on disk. This command instead calls `credentials.delete(provider)` DIRECTLY -- the real,
 * persistent removal path every `CredentialStore` (including the hardened `AuthStorage`, once
 * exported per D8's one-line vendor patch) already implements -- and only THEN, best-effort, asks
 * `modelRuntime` to drop its own in-process overlay too (ADR §10.1's own ordering: "remove do disco
 * -- e só então `removeRuntimeApiKey` para o overlay do processo"). The disk removal above is the
 * one that determines this command's success/failure; a failure syncing the runtime's transient view
 * afterwards is logged but never flips an already-successful logout to a failure -- the persisted
 * store is the source of truth BR-9 is about.
 */

import { sanitizeForTerminal } from "@conductor/runtime";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** See `login.ts`'s own header note on this local, duck-typed `CliIO` surface. */
export interface CliIO {
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
}

export interface RunLogoutOptions {
	provider: string;
	io: CliIO;
	credentials: CredentialStore;
	modelRuntime: ModelRuntime;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function runLogout(options: RunLogoutOptions): Promise<number> {
	const { provider, io, credentials, modelRuntime } = options;
	const safeProvider = sanitizeForTerminal(provider);

	let existing: Awaited<ReturnType<CredentialStore["read"]>>;
	try {
		existing = await credentials.read(provider);
	} catch (error) {
		io.stderr.write(
			`logout failed for ${safeProvider}: could not read the stored credential: ${describeError(error)}\n`,
		);
		return 1;
	}

	// FR-4/BR-9: report explicitly, never fake a success on nothing-to-remove -- this is a normal,
	// successful outcome (a caller checking "am I logged in?" should not have to treat it as an error).
	if (existing === undefined) {
		io.stdout.write(`${safeProvider}: nothing to remove -- no credential is stored for this provider.\n`);
		return 0;
	}

	try {
		// The real removal (F2 closed): the persisted store, never the runtime's in-memory overlay
		// alone. Whatever this throws (a lock timeout, a disk failure, an interrupted write) is the
		// one failure this command reports -- never swallowed, never re-labelled as success.
		await credentials.delete(provider);
	} catch (error) {
		io.stderr.write(`logout failed for ${safeProvider}: ${describeError(error)}\n`);
		return 1;
	}

	// Best-effort sync of the runtime's own in-process view (ADR §10.1's declared ordering: disk
	// first, overlay second). The disk deletion above already succeeded and IS the source of truth
	// for BR-9's "removed" guarantee -- a failure here (e.g. a composition/network hiccup while
	// ModelRuntime resynchronizes its snapshot) does not un-succeed an already-real logout, so it is
	// caught rather than propagated. Not silent: still worth a distinct message for whoever is
	// reading stderr, without changing the exit code the FR-3 "removed" test asserts on.
	try {
		await modelRuntime.removeRuntimeApiKey(provider);
	} catch (error) {
		io.stderr.write(
			`${safeProvider}: credential removed from storage, but the in-process runtime view could not resync: ${describeError(error)}\n`,
		);
	}

	io.stdout.write(`${safeProvider}: credential removed (logged out).\n`);
	return 0;
}
