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
});
