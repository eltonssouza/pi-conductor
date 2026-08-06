/**
 * Gate 5 (test-first) for @conductor/secrets -- derives FR-14/FR-15 (docs/conductor/gate2-spec-fase2.md)
 * plus the matcher-parity requirements ADR §6.1 states directly ("a mesma findSecretSpans... fecha
 * FR-14... e FR-15"). Every test below MUST fail RED right now: matchers.ts's exports are stubs that
 * throw "not implemented" (Gate 6 implements the bodies). Behavioral expectations are carried over
 * unchanged from the already-validated conductor-config/test/secret-detection.test.ts (Fase 1, T11 +
 * the gate8-validation-fase1.md §6.2 word-boundary fix) -- this package relocates, not reinvents, that
 * definition (see matchers.ts's header comment).
 */

import { describe, expect, it } from "vitest";
import {
	findSecretSpans,
	isSensitiveFieldName,
	looksHighEntropy,
	looksLikeEnvVarReference,
	looksSecretShaped,
	matchesKnownSecretPrefix,
	redactSecrets,
} from "../src/matchers.ts";

const FAKE_ANTHROPIC_KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE";
const FAKE_GITHUB_PAT = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const FAKE_HIGH_ENTROPY_BASE64 = "QW1vdW50T2ZFbnRyb3B5MTIzNDU2Nzg5MHFyc3R1dnd4eXo=";
const GIT_SHA = "4f3a9c1e7b2d6805f9e1c3a7b5d9f1032468acef"; // 40-char hex, FR-15's exact example shape

describe("matchesKnownSecretPrefix", () => {
	it.each([
		FAKE_ANTHROPIC_KEY,
		"sk-abcdefghijklmnopqrstuvwxyz0123456789",
		FAKE_GITHUB_PAT,
		"AKIAABCDEFGHIJKLMNOP",
		"xoxb-abcdefghij-klmnopqrst",
	])("recognizes %s as a known secret prefix", (value) => {
		expect(matchesKnownSecretPrefix(value)).toBe(true);
	});

	it("does not flag an ordinary provider/model identifier", () => {
		expect(matchesKnownSecretPrefix("anthropic/claude-sonnet-5")).toBe(false);
	});

	// FR-14 (gate2-spec-fase2.md §5 Grupo D): "a secret embedded as a substring is redacted wherever
	// it appears, not only when it is the whole field" -- the same T11 bypass fix
	// (gate8-validation-fase1.md §6.2) that secret-detection.ts already carries, now required of this
	// package too since it is the shared source both conductor-config and conductor-runtime import.
	describe("known prefix embedded mid-string (FR-14)", () => {
		it("recognizes a known secret prefix embedded after a 'provider/' segment", () => {
			expect(matchesKnownSecretPrefix(`anthropic/${FAKE_ANTHROPIC_KEY}`)).toBe(true);
		});

		it("does NOT flag a word that merely contains a prefix substring mid-word (not a token boundary)", () => {
			expect(matchesKnownSecretPrefix("desk-lamp-fixture-model")).toBe(false);
		});
	});
});

describe("looksHighEntropy", () => {
	it("is false for short strings even if random-looking", () => {
		expect(looksHighEntropy("aB3xQ9")).toBe(false);
	});

	it("is false for ordinary natural-language identifiers", () => {
		expect(looksHighEntropy("this-is-a-perfectly-normal-model-name")).toBe(false);
	});

	it("is true for a long, high-entropy base64-ish string", () => {
		expect(looksHighEntropy(FAKE_HIGH_ENTROPY_BASE64)).toBe(true);
	});

	// FR-15 (gate2-spec-fase2.md §5 Grupo D, edge case #8): a Git commit SHA (40 hex chars) must NOT
	// be treated as a secret -- the same charset/entropy distinction secret-detection.ts already uses
	// to avoid confusing a common hex identifier with a high-entropy secret.
	it("is false for a 40-char hex Git commit SHA (FR-15 -- must not false-positive)", () => {
		expect(looksHighEntropy(GIT_SHA)).toBe(false);
	});

	it("is false for a long but low-entropy repeated string", () => {
		expect(looksHighEntropy("a".repeat(48))).toBe(false);
	});
});

describe("looksSecretShaped", () => {
	it("is true for a known-prefix secret", () => {
		expect(looksSecretShaped(FAKE_ANTHROPIC_KEY)).toBe(true);
	});

	it("is true for a high-entropy blob", () => {
		expect(looksSecretShaped(FAKE_HIGH_ENTROPY_BASE64)).toBe(true);
	});

	it("is false for an ordinary identifier", () => {
		expect(looksSecretShaped("anthropic/claude-sonnet-5")).toBe(false);
	});

	// FR-15, edge case #8 restated at the looksSecretShaped level (not just looksHighEntropy),
	// since this is the function callers actually branch on.
	it("is false for a Git commit SHA (FR-15)", () => {
		expect(looksSecretShaped(GIT_SHA)).toBe(false);
	});
});

describe("isSensitiveFieldName", () => {
	it.each(["apiKey", "api_key", "token", "secret", "password", "credential", "privateKey"])(
		"flags %s as a sensitive field name",
		(name) => {
			expect(isSensitiveFieldName(name)).toBe(true);
		},
	);

	it.each(["model", "technologies", "workspaceRoot", "detectedAt"])("does not flag %s", (name) => {
		expect(isSensitiveFieldName(name)).toBe(false);
	});
});

describe("looksLikeEnvVarReference", () => {
	it("accepts an UPPER_SNAKE_CASE env var name", () => {
		expect(looksLikeEnvVarReference("ANTHROPIC_API_KEY")).toBe(true);
	});

	it("rejects a raw-looking value even if it happens to be uppercase", () => {
		expect(looksLikeEnvVarReference("SK-ANT-ABC-123")).toBe(false);
	});
});

describe("findSecretSpans", () => {
	it("returns an empty array for text with no secret-shaped content", () => {
		expect(findSecretSpans("anthropic/claude-sonnet-5 is the configured model")).toEqual([]);
	});

	it("finds a known-prefix span at the correct offset, with kind 'known-prefix'", () => {
		const text = `provider=anthropic key=${FAKE_ANTHROPIC_KEY} end`;
		const spans = findSecretSpans(text);
		expect(spans).toHaveLength(1);
		expect(spans[0].kind).toBe("known-prefix");
		expect(text.slice(spans[0].start, spans[0].end)).toBe(FAKE_ANTHROPIC_KEY);
	});

	// FR-14's exact repro: the prefix embedded after a "provider/" segment. The span must cover
	// only the secret itself, not the "anthropic/" prefix around it -- proving redactSecrets (below)
	// can mask the secret while leaving "anthropic/" legible.
	it("finds a known-prefix span embedded after a delimiter, excluding the delimiter from the span (FR-14)", () => {
		const text = `anthropic/${FAKE_ANTHROPIC_KEY}`;
		const spans = findSecretSpans(text);
		expect(spans).toHaveLength(1);
		expect(text.slice(spans[0].start, spans[0].end)).toBe(FAKE_ANTHROPIC_KEY);
		expect(text.slice(0, spans[0].start)).toBe("anthropic/");
	});

	it("finds a high-entropy span with kind 'high-entropy'", () => {
		const text = `blob: ${FAKE_HIGH_ENTROPY_BASE64}`;
		const spans = findSecretSpans(text);
		expect(spans).toHaveLength(1);
		expect(spans[0].kind).toBe("high-entropy");
	});

	it("finds multiple distinct spans in the same text, each at its own offset", () => {
		const text = `first=${FAKE_ANTHROPIC_KEY} second=${FAKE_GITHUB_PAT}`;
		const spans = findSecretSpans(text);
		expect(spans).toHaveLength(2);
		expect(text.slice(spans[0].start, spans[0].end)).toBe(FAKE_ANTHROPIC_KEY);
		expect(text.slice(spans[1].start, spans[1].end)).toBe(FAKE_GITHUB_PAT);
	});

	it("does NOT include a Git commit SHA as a span (FR-15)", () => {
		expect(findSecretSpans(`commit ${GIT_SHA} pushed`)).toEqual([]);
	});
});

describe("redactSecrets", () => {
	it("returns the text unchanged when no secret-shaped span is present", () => {
		expect(redactSecrets("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
	});

	// BR-7 (gate2-spec-fase2.md §7): the secret is replaced by a fixed, non-reversible placeholder --
	// never logged alongside a warning, never recoverable from the redacted sink. FR-12's own example
	// shape is "[REDACTED:api-key]"; asserted here as a pattern (label content is an implementation
	// choice) rather than the exact label string, per Unit Testing Principles §2.9 ("test behavior,
	// not implementation" -- cdt library "unit testing a pure merge function..." --gate 5, this
	// session) -- what's load-bearing is "masked, fixed-shape, non-reversible", not the exact word
	// chosen for the label.
	it("replaces a known-prefix secret with a fixed [REDACTED:...] placeholder (BR-7)", () => {
		const result = redactSecrets(`key=${FAKE_ANTHROPIC_KEY}`);
		expect(result).not.toContain(FAKE_ANTHROPIC_KEY);
		expect(result).toMatch(/\[REDACTED:[^\]]+\]/);
	});

	// FR-14's "the rest remains readable" half: masking must not swallow surrounding legitimate text.
	it("leaves surrounding non-secret text legible (FR-14)", () => {
		const result = redactSecrets(`anthropic/${FAKE_ANTHROPIC_KEY}`);
		expect(result.startsWith("anthropic/")).toBe(true);
		expect(result).not.toContain(FAKE_ANTHROPIC_KEY);
	});

	it("redacts every secret span independently when more than one is present", () => {
		const result = redactSecrets(`a=${FAKE_ANTHROPIC_KEY} b=${FAKE_GITHUB_PAT}`);
		expect(result).not.toContain(FAKE_ANTHROPIC_KEY);
		expect(result).not.toContain(FAKE_GITHUB_PAT);
		expect(result.startsWith("a=")).toBe(true);
	});

	// FR-15 restated for the masking function itself: a false positive here would corrupt legitimate
	// output (a Git SHA in a bash command's output must survive redaction unchanged).
	it("does NOT redact a Git commit SHA (FR-15)", () => {
		expect(redactSecrets(`commit ${GIT_SHA} pushed`)).toBe(`commit ${GIT_SHA} pushed`);
	});

	it("supports a custom placeholder function without ever receiving the matched value itself", () => {
		const seenLabels: string[] = [];
		const result = redactSecrets(`key=${FAKE_ANTHROPIC_KEY}`, {
			placeholder: (label) => {
				seenLabels.push(label);
				return `<<${label}>>`;
			},
		});
		expect(result).toContain("<<");
		expect(result).not.toContain(FAKE_ANTHROPIC_KEY);
		expect(seenLabels).toHaveLength(1);
	});
});
