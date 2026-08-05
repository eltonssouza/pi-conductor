import { describe, expect, it } from "vitest";
import { ConfigValidationError } from "../src/errors.ts";
import { assertValidConfigShape } from "../src/schema-validation.ts";
import { validConfig } from "./support/fixtures.ts";

describe("assertValidConfigShape", () => {
	it("accepts a fully valid config", () => {
		expect(() => assertValidConfigShape(validConfig())).not.toThrow();
	});

	it("rejects a non-object", () => {
		expect(() => assertValidConfigShape("nope")).toThrow(ConfigValidationError);
		expect(() => assertValidConfigShape(null)).toThrow(ConfigValidationError);
	});

	it("rejects the wrong schema version", () => {
		expect(() => assertValidConfigShape({ ...validConfig(), schema: 2 })).toThrow(/schema/);
	});

	it("rejects an unrecognized project.type", () => {
		const config = validConfig();
		expect(() => assertValidConfigShape({ ...config, project: { ...config.project, type: "spaceship" } })).toThrow(
			/project\.type/,
		);
	});

	it("rejects project.technologies that is not a string array", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({ ...config, project: { ...config.project, technologies: "not-an-array" } }),
		).toThrow(/technologies/);
	});

	it("rejects project.evidence that is not a string array", () => {
		const config = validConfig();
		expect(() => assertValidConfigShape({ ...config, project: { ...config.project, evidence: [1, 2, 3] } })).toThrow(
			/evidence/,
		);
	});

	it("rejects a detectedAt that is not ISO-8601 UTC", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({ ...config, project: { ...config.project, detectedAt: "08/05/2026" } }),
		).toThrow(/detectedAt/);
	});

	it("accepts a detectedAt with fractional seconds", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({
				...config,
				project: { ...config.project, detectedAt: "2026-08-05T12:00:00.123Z" },
			}),
		).not.toThrow();
	});

	it("rejects an empty workspace.root", () => {
		const config = validConfig();
		expect(() => assertValidConfigShape({ ...config, workspace: { root: "" } })).toThrow(/workspace\.root/);
	});

	it("rejects workspace.additionalProtectedPaths that is not a string array", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({ ...config, workspace: { root: ".", additionalProtectedPaths: "nope" } }),
		).toThrow(/additionalProtectedPaths/);
	});

	it("accepts workspace.additionalProtectedPaths when present and valid", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({ ...config, workspace: { root: ".", additionalProtectedPaths: ["secrets/"] } }),
		).not.toThrow();
	});

	it("rejects a provider.model that is not shaped like provider/modelId", () => {
		const config = validConfig();
		expect(() => assertValidConfigShape({ ...config, provider: { model: "not-a-valid-shape" } })).toThrow(
			/provider\.model/,
		);
	});

	it("accepts provider.thinkingLevel when present", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({ ...config, provider: { model: "anthropic/claude-sonnet-5", thinkingLevel: "high" } }),
		).not.toThrow();
	});

	it("rejects a non-string provider.thinkingLevel", () => {
		const config = validConfig();
		expect(() =>
			assertValidConfigShape({ ...config, provider: { model: "anthropic/claude-sonnet-5", thinkingLevel: 5 } }),
		).toThrow(/thinkingLevel/);
	});

	// T12 (docs/conductor/gate3-fase1-addendum.md secure default 10) / OWASP ASVS V6.4: no secret
	// value in a log or error response. assertNoRawSecrets (secret-detection.ts) only runs inside
	// writeConfig -- readConfig's path (doctor/config show/get, or any future caller) never calls
	// it. That means a hand-edited config.json whose provider.model is BOTH secret-shaped AND fails
	// this function's own *structural* shape check (e.g. missing the "/" separator, so the
	// PROVIDER_MODEL_SHAPE regex rejects it before any secret-shape check would even run) must not
	// leak the raw value through this function's own thrown message -- the one place every caller
	// (doctor, config show/get, a bare try/catch anywhere) ultimately reads the failure from.
	it("never echoes a secret-shaped provider.model value in its own error message", () => {
		const config = validConfig();
		const rawSecret = "sk-ant-api03-thisShouldNeverAppearInAnErrorMessage0123456789";
		let caught: unknown;
		try {
			assertValidConfigShape({ ...config, provider: { model: rawSecret } });
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ConfigValidationError);
		expect((caught as ConfigValidationError).message).not.toContain(rawSecret);
	});

	it("never echoes a secret-shaped provider.thinkingLevel value in its own error message", () => {
		const config = validConfig();
		const rawSecret = "AKIAABCDEFGHIJKLMNOP";
		let caught: unknown;
		try {
			assertValidConfigShape({
				...config,
				provider: { model: "anthropic/claude-sonnet-5", thinkingLevel: 12345 as unknown as string },
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ConfigValidationError);
		// (thinkingLevel here is wrong-typed, not secret-shaped -- the real secret-shaped case is
		// the "not a string" branch never reached; this pins the sibling guarantee that a
		// *wrong-type* thinkingLevel error also never has cause to embed rawSecret-like content.)
		expect((caught as ConfigValidationError).message).not.toContain(rawSecret);
	});

	it("still names which field was wrong, even without echoing a free-text field's raw value", () => {
		const config = validConfig();
		expect(() => assertValidConfigShape({ ...config, provider: { model: "sk-ant-api03-notslashshaped" } })).toThrow(
			/provider\.model/,
		);
	});
});
