import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profile } from "../src/profile.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("profile — empty project", () => {
	it("returns every field as an empty array", () => {
		expect(profile(project.root)).toEqual({
			languages: [],
			frameworks: [],
			datastores: [],
			build: [],
			testing: [],
			tooling: [],
			libraries: [],
		});
	});
});

describe("profile — Java/Maven (pom.xml)", () => {
	const pom = `<project>
		<properties><java.version>21</java.version></properties>
		<parent><artifactId>spring-boot-starter-parent</artifactId><version>3.3.4</version></parent>
		<dependencies>
			<dependency><artifactId>spring-boot-starter-web</artifactId></dependency>
			<dependency><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
			<dependency><artifactId>spring-boot-starter-security</artifactId></dependency>
			<dependency><artifactId>postgresql</artifactId></dependency>
			<dependency><artifactId>lombok</artifactId></dependency>
			<dependency><artifactId>spring-boot-starter-test</artifactId></dependency>
		</dependencies>
	</project>`;

	it("extracts the Spring Boot version, Java version, and Web/JPA/Security/Postgres/Lombok/Test signals", () => {
		project.write("pom.xml", pom);
		const result = profile(project.root);
		expect(result.frameworks).toEqual(expect.arrayContaining(["Spring Boot 3.3.4", "Spring Web (REST)"]));
		expect(result.languages).toContain("Java 21");
		expect(result.libraries).toEqual(
			expect.arrayContaining(["Spring Data JPA / Hibernate", "Spring Security", "Lombok"]),
		);
		expect(result.datastores).toContain("PostgreSQL");
		expect(result.testing).toContain("Spring Boot Test (JUnit)");
		expect(result.build).toContain("Maven");
	});

	it("prefers WebFlux over Web (REST) when the webflux starter is present (elif priority)", () => {
		project.write("pom.xml", pom.replace("spring-boot-starter-web<", "spring-boot-starter-webflux<"));
		const result = profile(project.root);
		expect(result.frameworks).toContain("Spring WebFlux");
		expect(result.frameworks).not.toContain("Spring Web (REST)");
	});

	it("detects Testcontainers from a groupId mention, not just an artifactId", () => {
		project.write("pom.xml", `${pom}\n<!-- org.testcontainers:testcontainers -->`);
		expect(profile(project.root).testing).toContain("Testcontainers");
	});
});

describe("profile — JS/TS (package.json)", () => {
	it("marks Angular SSR + Express when @angular/ssr is present alongside @angular/core", () => {
		project.writeJson("package.json", {
			dependencies: { "@angular/core": "^21.2.14", "@angular/ssr": "^21.2.14", express: "^4.19.0" },
		});
		const result = profile(project.root);
		expect(result.frameworks).toContain("Angular 21 (SSR + Express)");
		expect(result.frameworks).not.toContain("Express 4");
	});

	it("extracts framework/language/build/testing/tooling/library signals from a representative frontend manifest", () => {
		project.writeJson("package.json", {
			dependencies: { react: "^18.3.0", axios: "^1.7.0", "@ngrx/store": "^17.0.0", tailwindcss: "^3.4.0" },
			devDependencies: {
				typescript: "^5.6.0",
				vite: "^5.4.0",
				vitest: "^2.1.0",
				eslint: "^9.0.0",
				prettier: "^3.3.0",
			},
			packageManager: "pnpm@9.9.0",
		});
		const result = profile(project.root);
		expect(result.frameworks).toContain("React 18");
		expect(result.languages).toContain("TypeScript 5.6.0");
		expect(result.build).toEqual(expect.arrayContaining(["Vite 5", "pnpm 9.9.0"]));
		expect(result.testing).toContain("Vitest");
		expect(result.tooling).toEqual(expect.arrayContaining(["ESLint", "Prettier"]));
		expect(result.libraries).toEqual(expect.arrayContaining(["Axios", "NgRx", "Tailwind CSS"]));
	});

	it("falls back to 'npm (Angular CLI)' as the build tool when no packageManager field is declared", () => {
		project.writeJson("package.json", { dependencies: { "@angular/core": "^21.0.0", "@angular/cli": "^21.0.0" } });
		expect(profile(project.root).build).toContain("npm (Angular CLI)");
	});

	it("records the coverage marker when a coverage package is present", () => {
		project.writeJson("package.json", { devDependencies: { vitest: "^2.1.0", "@vitest/coverage-v8": "^2.1.0" } });
		expect(profile(project.root).testing).toEqual(expect.arrayContaining(["Vitest", "coverage"]));
	});
});

describe("profile — docker-compose datastores", () => {
	it("maps known image names to datastore labels and records Docker Compose tooling", () => {
		project.write(
			"docker-compose.yml",
			["services:", "  db:", "    image: postgres:16", "  cache:", "    image: 'redis:7-alpine'"].join("\n"),
		);
		const result = profile(project.root);
		expect(result.datastores).toEqual(expect.arrayContaining(["PostgreSQL", "Redis"]));
		expect(result.tooling).toContain("Docker Compose");
	});

	it("records Docker tooling when a Dockerfile is present", () => {
		project.write("Dockerfile", "FROM node:22\n");
		expect(profile(project.root).tooling).toContain("Docker");
	});
});

describe("profile — Python", () => {
	it("extracts the Python version, a detected framework, and pytest from pyproject.toml", () => {
		project.write(
			"pyproject.toml",
			["[project]", 'requires-python = ">=3.12"', 'dependencies = ["fastapi", "pytest"]'].join("\n"),
		);
		const result = profile(project.root);
		expect(result.languages).toContain("Python >=3.12");
		expect(result.frameworks).toContain("FastAPI");
		expect(result.testing).toContain("pytest");
	});
});

describe("profile — Go", () => {
	it("records Go as a language when go.mod is present", () => {
		project.write("go.mod", "module example.com/x\n\ngo 1.23\n");
		expect(profile(project.root).languages).toContain("Go");
	});
});

describe("profile — monorepo aggregation and dedupe", () => {
	it("aggregates signals from backend/ and frontend/ subtrees, and dedupes a repeated signal", () => {
		project.write("backend/pom.xml", "<project><properties><java.version>21</java.version></properties></project>");
		project.writeJson("frontend/package.json", { dependencies: { react: "^18.0.0" } });
		project.writeJson("package.json", { dependencies: { react: "^18.0.0" } }); // duplicate signal at root
		const result = profile(project.root);
		expect(result.languages).toContain("Java 21");
		expect(result.frameworks.filter((f) => f === "React 18")).toHaveLength(1);
	});
});
