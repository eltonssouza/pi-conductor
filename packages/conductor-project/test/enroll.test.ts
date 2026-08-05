import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enrollProject } from "../src/enroll.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("enrollProject", () => {
	it("combines detect() and profile() into the .conductor/config.json project+profile shape (ADR 0002 §5.3)", () => {
		project.write(
			"pom.xml",
			[
				"<project>",
				"<properties><java.version>21</java.version></properties>",
				"<parent><artifactId>spring-boot-starter-parent</artifactId><version>3.3.4</version></parent>",
				"</project>",
			].join("\n"),
		);
		const result = enrollProject(project.root);

		expect(result.project.type).toBe("backend");
		expect(result.project.technologies).toContain("Java/Maven");
		expect(result.project.evidence).toContain("pom.xml");
		expect(result.profile.frameworks).toContain("Spring Boot 3.3.4");
		expect(result.profile.languages).toContain("Java 21");
	});

	it("stamps detectedAt as an ISO-8601 UTC timestamp bounded by the call", () => {
		const before = Date.now();
		const result = enrollProject(project.root);
		const after = Date.now();

		expect(result.project.detectedAt).toMatch(/Z$/); // UTC ('Z' suffix), never a local offset
		const parsed = Date.parse(result.project.detectedAt);
		expect(parsed).toBeGreaterThanOrEqual(before);
		expect(parsed).toBeLessThanOrEqual(after);
	});

	it("returns unknown type and empty profile fields for a directory with no recognizable manifests", () => {
		const result = enrollProject(project.root);
		expect(result.project.type).toBe("unknown");
		expect(result.project.technologies).toEqual([]);
		expect(result.project.evidence).toEqual([]);
		expect(result.profile).toEqual({
			languages: [],
			frameworks: [],
			datastores: [],
			build: [],
			testing: [],
			tooling: [],
			libraries: [],
		});
	});

	it("classifies a fullstack monorepo (backend/ Java + frontend/ Angular) end to end", () => {
		project.write("backend/pom.xml", "<project></project>");
		project.writeJson("frontend/package.json", { dependencies: { "@angular/core": "^21.0.0" } });

		const result = enrollProject(project.root);

		expect(result.project.type).toBe("fullstack");
		expect(result.project.evidence).toEqual(expect.arrayContaining(["backend/pom.xml", "frontend/package.json"]));
		expect(result.profile.build).toContain("Maven");
		expect(result.profile.frameworks).toContain("Angular 21");
	});
});
