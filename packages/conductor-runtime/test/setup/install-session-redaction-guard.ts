/**
 * Vitest setupFile (registered in ../../vitest.config.ts) so the T29/R12c write-path redaction guard
 * (../../src/session-redaction-guard.ts) is installed on SessionManager's shared prototype before
 * ANY test in this package runs -- in particular before
 * test/session-redaction.regression.test.ts's canary, which deliberately drives
 * `@earendil-works/pi-coding-agent`'s real SessionManager directly (SessionManager.create(...)) and
 * never imports conductor-runtime's own source, so it would never otherwise trigger session.ts's
 * production-path side-effecting import of the guard. Importing the guard module here (for its
 * install-on-import side effect) is what makes that regression test exercise the exact same guard
 * production code uses, not a test-only stand-in -- see session-redaction-guard.ts's own header for
 * why a prototype patch, rather than a per-instance wrapper, is the only interception point that
 * reaches a SessionManager constructed outside of session.ts's createConductorSession().
 */
import "../../src/session-redaction-guard.ts";
