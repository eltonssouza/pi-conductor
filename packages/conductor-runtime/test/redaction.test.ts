/**
 * Gate 5 (test-first) for redaction.ts -- derives FR-12/FR-13/FR-14/FR-15 and BR-7/BR-12
 * (docs/conductor/gate2-spec-fase2.md), the six-sink enumeration GAP-C fixed
 * (docs/conductor/gate3-addendum-fase2.md T21, ADR §6.2), and the task's non-negotiable #4:
 * "redaction tested at each of the six sinks individually -- a known secret fixture passed through
 * EACH sink does not appear in clear in that sink's output." Every test below MUST fail RED right
 * now: redactSecrets() and redactSessionEntryForPersistence() are stubs that throw
 * "not implemented" (Gate 6 implements the bodies).
 *
 * Sink #3 (session JSONL) has two guards, deliberately kept in separate files: this file's
 * redactSessionEntryForPersistence unit test (the transform in isolation) and the structural
 * canary in test/session-redaction.regression.test.ts (the real, unmocked SessionManager, R12c) --
 * see that file's header for why a passing unit test here is not, by itself, sufficient evidence.
 * Sink #6 (session export) is not built in this fase (ADR §6.2 item 6) -- see the `it.todo` below,
 * a documented gap rather than a silently-dropped one (gate2-spec-fase2.md §9 open question #4).
 *
 * No mocking framework is used anywhere in this file (matches this repo's existing convention --
 * no `vi.mock` appears anywhere under packages/conductor-runtime/test/ today -- and Unit Testing
 * Principles §3.12, "the real collaborator is cheap and in-process," grounded in this session's own
 * `cdt library` query). One consequence: the specific internal-matcher-throws branch that produces
 * SECRET_SCAN_FAILED_PLACEHOLDER is not forced via a mocked failure here; it is asserted only as a
 * literal-constant check plus a black-box "never throws" robustness sweep, which does not require
 * injecting a fault into a real, always-well-behaved collaborator.
 *
 * UPDATE (Fase 5, ADR 0006 §19 D6): the closed enumeration below was six sinks at Fase 2 (GAP-C) --
 * Fase 5 legitimately reopens it to SEVEN, adding "codeIndex" (redaction runs before chunk/embed/
 * upsert, D6 §9.1; see test/redaction-code-index-sink.test.ts for that sink's own dedicated test).
 * This is the same class of change as `Decision.kind` gaining `"rejection"` (D4 §6.3): a prior fase's
 * closed contract, extended by a later fase's own ADR, not a defect in this file.
 */

import { describe, expect, it } from "vitest";
import {
	REDACTION_SINKS,
	redactSecrets,
	redactSessionEntryForPersistence,
	SECRET_SCAN_FAILED_PLACEHOLDER,
} from "../src/redaction.ts";
import { sanitizeForTerminal } from "../src/terminal-sanitize.ts";

const FAKE_KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE";
const GIT_SHA = "4f3a9c1e7b2d6805f9e1c3a7b5d9f1032468acef"; // 40-char hex -- FR-15's exact false-positive shape

describe("REDACTION_SINKS — the closed sink enumeration (GAP-C, reopened by Fase 5 ADR 0006 D6)", () => {
	it("names exactly the seven sinks ADR §6.2/ADR 0006 D6 enumerates, no more, no fewer", () => {
		expect(REDACTION_SINKS).toHaveLength(7);
		expect(REDACTION_SINKS).toEqual(
			expect.arrayContaining([
				"transcript",
				"notify",
				"sessionJsonl",
				"auditTrail",
				"rethrownError",
				"sessionExport",
				"codeIndex",
			]),
		);
	});
});

describe("redactSecrets — sink #2 (notify/block-reason) and sink #5 (re-thrown error)", () => {
	// T21 item 5: permission-gate.ts's `ctx.ui.notify("Blocked ...: " + decision.reason)` can embed
	// model-controlled input (the path/command that failed), which can itself contain a secret.
	it("masks a secret embedded in a notify-shaped block-reason string (FR-12, T21 item 5)", () => {
		const notifyText = `Blocked bash: command echoed a credential (${FAKE_KEY}) -- denied by policy`;
		const result = redactSecrets(notifyText);
		expect(result).not.toContain(FAKE_KEY);
	});

	// T21 item 6: fail-closed.ts's re-thrown `reason` can embed the offending message, which can
	// itself contain a secret (e.g. a path or command echoed back into the error text).
	it("masks a secret embedded in a fail-closed re-thrown error message (FR-12, T21 item 6)", () => {
		const reason = `policy evaluation error — fail closed: unexpected token near "${FAKE_KEY}"`;
		const result = redactSecrets(reason);
		expect(result).not.toContain(FAKE_KEY);
	});
});

describe("redactSecrets — sink #4 (audit trail)", () => {
	it("masks a secret embedded in an audit-entry-shaped reason field (FR-12)", () => {
		const auditReason = `bash command output included ${FAKE_KEY} in its captured stdout`;
		expect(redactSecrets(auditReason)).not.toContain(FAKE_KEY);
	});
});

describe("redactSecrets — FR-13's exact repro and FR-15's false-positive guard", () => {
	it("masks the value after '=' in an env-var-assignment-shaped bash stdout line (FR-13)", () => {
		const stdout = "ANTHROPIC_API_KEY=sk-ant-api03-REALLOOKINGFAKEKEYVALUEHERE";
		const result = redactSecrets(stdout);
		expect(result).not.toContain("sk-ant-api03-REALLOOKINGFAKEKEYVALUEHERE");
		expect(result).toContain("ANTHROPIC_API_KEY=");
	});

	it("does NOT mask a Git commit SHA (FR-15)", () => {
		const text = `commit ${GIT_SHA} pushed to origin/main`;
		expect(redactSecrets(text)).toBe(text);
	});
});

describe("redactSecrets — fail-closed robustness", () => {
	it("returns the exact literal fallback text ADR §6.1 specifies", () => {
		expect(SECRET_SCAN_FAILED_PLACEHOLDER).toBe("[REDACTED: secret-scan failed — content withheld]");
	});

	it.each(["", "no secret here", FAKE_KEY, "a".repeat(5000), "unicode: 🔒🔑"])(
		"never throws for input %#",
		(input) => {
			expect(() => redactSecrets(input)).not.toThrow();
		},
	);
});

describe("redactSecrets composed with sanitizeForTerminal — sink #1 (transcript, FR-13)", () => {
	// T21 item 1 / gate8-validation-fase1.md §6.1's lesson, re-applied to a new sink: terminal
	// sanitization (T14) and secret redaction are TWO DIFFERENT defenses that must BOTH run on the
	// transcript funnel -- neither substitutes for the other. Order matters (ADR §6.2: redact BEFORE
	// sanitizeForTerminal, same funnel) so this test drives them in that order explicitly.
	it("strips both a secret and a raw ANSI escape from bash stdout destined for the live transcript", () => {
		const stdoutWithSecretAndAnsi = `\x1b[2Jtoken=${FAKE_KEY}\x1b[H`;
		const redacted = redactSecrets(stdoutWithSecretAndAnsi);
		const displayed = sanitizeForTerminal(redacted);

		expect(displayed).not.toContain(FAKE_KEY);
		expect(displayed).not.toContain("\x1b");
	});
});

describe("redactSessionEntryForPersistence — sink #3 (session JSONL), unit level", () => {
	it("redacts a secret nested inside a session-entry-shaped object's string fields", () => {
		const entry = {
			role: "toolResult",
			toolName: "bash",
			content: [{ type: "text", text: `stdout leaked ${FAKE_KEY}` }],
		};

		const result = redactSessionEntryForPersistence(entry);

		expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
	});

	it("does not mutate the original entry object (returns a new value)", () => {
		const entry = { content: [{ type: "text", text: `leaked ${FAKE_KEY}` }] };
		const original = JSON.parse(JSON.stringify(entry));

		redactSessionEntryForPersistence(entry);

		expect(entry).toEqual(original);
	});

	it("leaves non-secret fields (tool name, role, non-secret text) untouched", () => {
		const entry = { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "no secret here" }] };
		const result = redactSessionEntryForPersistence(entry);
		expect(result).toEqual(entry);
	});

	it("does NOT redact a Git commit SHA nested in a session entry (FR-15)", () => {
		const entry = { content: [{ type: "text", text: `commit ${GIT_SHA} pushed` }] };
		const result = redactSessionEntryForPersistence(entry);
		expect(JSON.stringify(result)).toContain(GIT_SHA);
	});
});

// Sink #6 (ADR §6.2 item 6): `session export` is not a built command in this fase
// (gate2-spec-fase2.md §3 Non-goals table does not list it among Fase 2's named deliverables, and
// §9 open question #4 explicitly defers the ship-now-vs-later call to Gate 4/6). BR-7's guarantee
// applies the moment it ships -- documented here as a TODO so the gap stays visible in every test
// run's summary, rather than vanishing because no file for it exists yet.
it.todo("redacts a secret in `session export` output once that command is built (FR-14, BR-7, ADR §6.2 sink #6)");
