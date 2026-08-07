/**
 * Direct unit coverage for deep-redact.ts, added at Gate 8 of Fase 6 when this fail-closed wrapper +
 * deep-walk moved here from `@conductor/runtime/src/redaction.ts` (FR-20: "a redação usa redactSecrets
 * (@conductor/runtime), nunca uma segunda implementação... nunca um detector de segredo próprio e
 * paralelo do Diary"). The behavior itself already had regression coverage at both call sites
 * (`packages/conductor-runtime/test/redaction.test.ts` via `redactSecrets`/`redactSessionEntryForPersistence`,
 * `packages/conductor-diary/test/journal-writer-redaction.test.ts` via `openJournalWriter`) -- this file
 * adds coverage at the true point of definition (Unit Testing Principles: test the smallest unit that
 * owns the behavior), it does not replace either of those.
 *
 * No mocking framework is used (matches this repo's existing convention -- see redaction.test.ts's own
 * header for the same call): `matchers.ts`'s `redactSecrets` is documented to never throw for a `string`
 * input, so the `onError`/placeholder fallback branch is exercised here only as a literal-constant check
 * plus a black-box "never throws" robustness sweep, same as the pre-move suite did.
 */

import { describe, expect, it } from "vitest";
import { deepRedact, redactSecretsOrPlaceholder, SECRET_SCAN_FAILED_PLACEHOLDER } from "../src/deep-redact.ts";

const FAKE_KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE";
const GIT_SHA = "4f3a9c1e7b2d6805f9e1c3a7b5d9f1032468acef"; // 40-char hex -- FR-15's exact false-positive shape

describe("redactSecretsOrPlaceholder", () => {
	it("masks a known-prefix secret, same as the raw matcher", () => {
		const result = redactSecretsOrPlaceholder(`key=${FAKE_KEY}`);
		expect(result).not.toContain(FAKE_KEY);
		expect(result).toContain("key=");
	});

	it("returns text unchanged when nothing secret-shaped is present", () => {
		expect(redactSecretsOrPlaceholder("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
	});

	it("does not flag a Git commit SHA (FR-15)", () => {
		const text = `commit ${GIT_SHA} pushed`;
		expect(redactSecretsOrPlaceholder(text)).toBe(text);
	});

	it.each(["", "no secret here", FAKE_KEY, "a".repeat(5000), "unicode: 🔒🔑"])(
		"never throws for input %#",
		(input) => {
			expect(() => redactSecretsOrPlaceholder(input)).not.toThrow();
		},
	);

	it("returns the exact literal fallback text ADR §6.1 specifies", () => {
		expect(SECRET_SCAN_FAILED_PLACEHOLDER).toBe("[REDACTED: secret-scan failed — content withheld]");
	});

	it("an onError callback that itself throws never escapes or changes the return value", () => {
		// The matcher never throws for a string input, so this exercises only that a caller-supplied
		// onError is never invoked on the happy path -- not the fallback branch itself (see file header).
		let called = false;
		const result = redactSecretsOrPlaceholder("nothing secret here", {
			onError: () => {
				called = true;
				throw new Error("should never propagate");
			},
		});
		expect(result).toBe("nothing secret here");
		expect(called).toBe(false);
	});
});

describe("deepRedact", () => {
	it("redacts every string leaf in a nested object/array structure", () => {
		const value = {
			role: "toolResult",
			content: [{ type: "text", text: `stdout leaked ${FAKE_KEY}` }],
		};

		const result = deepRedact(value);

		expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
	});

	it("does not mutate the original value (returns a new value)", () => {
		const value = { content: [{ type: "text", text: `leaked ${FAKE_KEY}` }] };
		const original = JSON.parse(JSON.stringify(value));

		deepRedact(value);

		expect(value).toEqual(original);
	});

	it("leaves non-secret fields and non-string primitives untouched", () => {
		const value = { role: "toolResult", count: 3, active: true, extra: null, text: "no secret here" };
		expect(deepRedact(value)).toEqual(value);
	});

	it("does NOT redact a Git commit SHA nested in a structure (FR-15)", () => {
		const value = { content: [{ type: "text", text: `commit ${GIT_SHA} pushed` }] };
		expect(JSON.stringify(deepRedact(value))).toContain(GIT_SHA);
	});
});
