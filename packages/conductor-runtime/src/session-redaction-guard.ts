/**
 * The T29/R12c write-path seam (docs/adr/0003-fase2-security-architecture.md §6.3;
 * docs/conductor/gate3-addendum-fase2.md §9 R12: "choke at the ONE handoff Conductor->Pi we own,
 * not spread across Pi's internal write points").
 *
 * WHY A PROTOTYPE PATCH, NOT A WRAPPER APPLIED WHERE CONDUCTOR CONSTRUCTS THE INSTANCE: session.ts's
 * createConductorSession() constructs the SessionManager Conductor hands to Pi's AgentSession, but
 * Conductor never calls `sessionManager.appendMessage(...)` itself in production -- that call lives
 * entirely inside Pi's own agent-session.ts (the message_end handler, recordBashResult,
 * _flushPendingBashMessages: three separate internal call sites, none of them Conductor's). A
 * wrapper applied only at construction time (e.g. returning a decorated object in place of what
 * `SessionManager.create()` produces) would intercept exactly those callers that go through that one
 * construction site -- it would silently miss `SessionManager.open()` (session resume/fork, used by
 * agent-session-runtime.ts) and any future acquisition path Pi adds, because each would still yield
 * an unwrapped instance whose `appendMessage` is the original.
 *
 * `appendMessage` is Pi's single PUBLIC, stable API for handing a message to be persisted (the
 * regression test's own header: "its appendMessage() API is public and stable, used the same way by
 * this package's own session.ts and by Pi's own test suite"). Patching *that one method's
 * prototype* -- once, idempotently, as early as possible -- is the actual choke point every one of
 * Pi's internal write paths funnels through, independent of which of them fires and independent of
 * how the particular SessionManager instance was constructed. This is why
 * test/session-redaction.regression.test.ts can call `SessionManager.create()` directly (bypassing
 * every bit of Conductor's own wiring in session.ts) and still observe redacted bytes on disk: the
 * patch lives on the shared class, not on any one Conductor-constructed instance.
 *
 * WHY NOT EDIT packages/coding-agent/src/core/session-manager.ts DIRECTLY: that file is Pi's own
 * source -- vendored into this monorepo for local dev per docs/adr/0001-adopt-pi-as-runtime.md
 * §2.1's anti-corruption-layer stance (depend on Pi's stable Agent/AgentSession surface, do not reach
 * into its internals; `@earendil-works/pi-coding-agent` is versioned and pinned in the lockfile as an
 * external dependency, source-aliased only for this checkout's dev convenience). conductor-* packages
 * own the conductor-* boundary; a patch applied from here, imported before any session is
 * constructed, is the anti-corruption layer's own mechanism for closing a gap in a dependency's
 * public API without forking the dependency -- and it keeps working across a Pi version bump as long
 * as `appendMessage` remains the public persistence entry point, which is exactly what R12c's
 * structural canary (re-run on every Pi upgrade, per the regression test's own header) exists to
 * verify rather than assume.
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { redactSessionEntryForPersistence } from "./redaction.ts";

// `SessionManager` used here as a TYPE (not `typeof SessionManager`) is already the instance type --
// InstanceType<typeof SessionManager> would additionally require a public `new (...) => any`
// signature, which SessionManager's own private constructor (by design: construction only through
// its own static create()/open() factories) does not satisfy.
type SessionManagerInstance = SessionManager;
type AppendMessageArg = Parameters<SessionManagerInstance["appendMessage"]>[0];

const INSTALL_MARKER = "__conductorSessionRedactionGuardInstalled";

/**
 * Idempotently wraps SessionManager.prototype.appendMessage so every message is passed through
 * redactSessionEntryForPersistence (R12a) before Pi's own, unmodified appendMessage persists it.
 * Safe to call multiple times (e.g. from both this module's own side-effecting import below and a
 * test setup file) and safe to call before any SessionManager instance exists, since it patches the
 * shared prototype, not an instance. Exported (rather than only run as a side effect) so a caller
 * that wants the installation to happen at an explicit, auditable point -- rather than as a side
 * effect of some transitive import -- can call it directly.
 */
export function installSessionRedactionGuard(): void {
	const markerHost = SessionManager.prototype as unknown as Record<string, boolean | undefined>;
	if (markerHost[INSTALL_MARKER]) return;

	const original = SessionManager.prototype.appendMessage;
	SessionManager.prototype.appendMessage = function patchedAppendMessage(
		this: SessionManagerInstance,
		message: AppendMessageArg,
	): string {
		return original.call(this, redactSessionEntryForPersistence(message));
	};

	markerHost[INSTALL_MARKER] = true;
}

// Installed as an import side effect so every real caller of this package's composition root
// (session.ts, which imports this module) gets the guard active before it ever constructs a
// SessionManager -- see session.ts's own import of this module for the production wiring, and
// test/setup/install-session-redaction-guard.ts for why the regression canary (which never imports
// conductor-runtime source at all) also needs this installed ahead of its own SessionManager.create() call.
installSessionRedactionGuard();
