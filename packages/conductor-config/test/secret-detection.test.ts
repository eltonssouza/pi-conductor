import { describe, expect, it } from "vitest";
import { ConfigValidationError } from "../src/errors.ts";
import {
	assertNoRawSecrets,
	isSensitiveFieldName,
	looksHighEntropy,
	looksLikeEnvVarReference,
	looksSecretShaped,
	matchesKnownSecretPrefix,
} from "../src/secret-detection.ts";
import { validConfig } from "./support/fixtures.ts";

describe("matchesKnownSecretPrefix", () => {
	it.each([
		"sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
		"sk-abcdefghijklmnopqrstuvwxyz0123456789",
		"ghp_abcdefghijklmnopqrstuvwxyz0123456789",
		"github_pat_11ABCDEFGabcdefghijklmnop0123456789",
		"gho_abcdefghijklmnopqrstuvwxyz0123456789",
		"glpat-abcdefghijklmnopqrstuv",
		"xoxb-abcdefghij-klmnopqrst",
		"AKIAABCDEFGHIJKLMNOP",
		"AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz012345",
		"ya29.a0AbCdEfGhIjKlMnOpQrStUvWxYz",
	])("recognizes %s as a known secret prefix", (value) => {
		expect(matchesKnownSecretPrefix(value)).toBe(true);
	});

	it("does not flag an ordinary provider/model identifier", () => {
		expect(matchesKnownSecretPrefix("anthropic/claude-sonnet-5")).toBe(false);
	});

	it("does not flag a short human-typed word", () => {
		expect(matchesKnownSecretPrefix("backend")).toBe(false);
	});
});

describe("looksHighEntropy", () => {
	it("is false for short strings even if random-looking", () => {
		expect(looksHighEntropy("aB3xQ9")).toBe(false);
	});

	it("is false for ordinary natural-language identifiers", () => {
		expect(looksHighEntropy("anthropic/claude-sonnet-5")).toBe(false);
		expect(looksHighEntropy("this-is-a-perfectly-normal-model-name")).toBe(false);
	});

	it("is true for a long, high-entropy base64-ish string", () => {
		expect(looksHighEntropy("QW1vdW50T2ZFbnRyb3B5MTIzNDU2Nzg5MHFyc3R1dnd4eXo=")).toBe(true);
	});

	it("is true for a long, high-entropy hex string", () => {
		expect(looksHighEntropy("4f3a9c1e7b2d6805f9e1c3a7b5d9f1032468ace13579bdf")).toBe(true);
	});

	it("is false for a long but low-entropy repeated string", () => {
		expect(looksHighEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
	});
});

describe("looksSecretShaped", () => {
	it("is true for a known-prefix secret", () => {
		expect(looksSecretShaped("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
	});

	it("is true for a high-entropy blob", () => {
		expect(looksSecretShaped("QW1vdW50T2ZFbnRyb3B5MTIzNDU2Nzg5MHFyc3R1dnd4eXo=")).toBe(true);
	});

	it("is false for an ordinary identifier", () => {
		expect(looksSecretShaped("anthropic/claude-sonnet-5")).toBe(false);
	});

	it("is false for an empty string", () => {
		expect(looksSecretShaped("")).toBe(false);
	});
});

describe("isSensitiveFieldName", () => {
	it.each(["apiKey", "api_key", "token", "secret", "password", "passwd", "credential", "privateKey"])(
		"flags %s as a sensitive field name",
		(name) => {
			expect(isSensitiveFieldName(name)).toBe(true);
		},
	);

	it.each(["model", "technologies", "root", "detectedAt", "thinkingLevel"])(
		"does not flag %s as a sensitive field name",
		(name) => {
			expect(isSensitiveFieldName(name)).toBe(false);
		},
	);
});

describe("looksLikeEnvVarReference", () => {
	it("accepts an UPPER_SNAKE_CASE env var name", () => {
		expect(looksLikeEnvVarReference("ANTHROPIC_API_KEY")).toBe(true);
	});

	it("rejects a raw-looking value even if it happens to be uppercase", () => {
		expect(looksLikeEnvVarReference("SK-ANT-ABC-123")).toBe(false); // contains a hyphen, not env-var shaped
	});

	it("rejects a lowercase value", () => {
		expect(looksLikeEnvVarReference("anthropic_api_key")).toBe(false);
	});
});

describe("assertNoRawSecrets", () => {
	it("does not throw for a fully valid config", () => {
		expect(() => assertNoRawSecrets(validConfig())).not.toThrow();
	});

	it("throws when provider.model looks like a raw secret (T11 -- high-entropy value)", () => {
		const config = validConfig({
			provider: { model: "QW1vdW50T2ZFbnRyb3B5MTIzNDU2Nzg5MHFyc3R1dnd4eXo=" },
		});
		expect(() => assertNoRawSecrets(config)).toThrow(ConfigValidationError);
		expect(() => assertNoRawSecrets(config)).toThrow(/provider\.model/);
	});

	it("throws when provider.model matches a known secret prefix (T11)", () => {
		const config = validConfig({
			provider: { model: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" },
		});
		expect(() => assertNoRawSecrets(config)).toThrow(ConfigValidationError);
	});

	it("throws when a field literally named apiKey holds a raw string instead of an envVar reference (T11)", () => {
		// Simulates a hand-crafted or JSON.parse'd object that bypasses TypeScript's structural
		// typing -- exactly the shape a `conductor config set` dot-path merge could produce.
		const config = { ...validConfig(), provider: { model: "anthropic/claude-sonnet-5", apiKey: "not-an-env-var" } };
		expect(() => assertNoRawSecrets(config)).toThrow(ConfigValidationError);
		expect(() => assertNoRawSecrets(config)).toThrow(/provider\.apiKey/);
	});

	it("does NOT throw when a sensitive-named field holds an envVar-reference-shaped value", () => {
		const config = {
			...validConfig(),
			provider: { model: "anthropic/claude-sonnet-5", apiKeyEnv: "ANTHROPIC_API_KEY" },
		};
		expect(() => assertNoRawSecrets(config)).not.toThrow();
	});

	it("catches a secret nested arbitrarily deep, not just at the top level", () => {
		const config = {
			...validConfig(),
			workspace: { root: ".", nested: { deeper: { token: "not-an-env-var-value" } } },
		};
		expect(() => assertNoRawSecrets(config)).toThrow(ConfigValidationError);
	});

	it("does not flag ordinary technologies/evidence path-like strings", () => {
		const config = validConfig({
			project: {
				type: "fullstack",
				technologies: ["Java/Maven", "Angular 21"],
				evidence: ["pom.xml", "packages/web/angular.json"],
				detectedAt: "2026-08-05T12:00:00.000Z",
			},
		});
		expect(() => assertNoRawSecrets(config)).not.toThrow();
	});
});
