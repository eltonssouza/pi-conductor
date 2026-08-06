import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonManifest, readTextManifest } from "./manifest.ts";
import type { StackProfile } from "./types.ts";
import { searchRoots } from "./walk.ts";

/**
 * `detect()` answers "what type"; `profile()` answers "what exactly" — the frameworks, versions,
 * datastores, build/test tooling and notable libraries. Ported from
 * conductor-main/conductor/detect.py's `profile(root)` and its `_parse_*` helpers, in full: pom.xml
 * (Spring Boot / Java), package.json (the JS/TS ecosystem), docker-compose/Dockerfile, Python
 * manifests, and go.mod. Nothing in `profile()` itself was disproportionately large enough to
 * warrant trimming — see this package's test report for what was deferred at the *module* level
 * instead (`recipes()`, `detect_ui_intent()`/`promote_type_for_ui()`, `library_stacks()`).
 */

const DATASTORE_IMAGE_LABELS: ReadonlyArray<readonly [string, string]> = [
	["pgvector", "PostgreSQL (pgvector)"],
	["postgres", "PostgreSQL"],
	["mariadb", "MariaDB"],
	["mysql", "MySQL"],
	["mongo", "MongoDB"],
	["redis", "Redis"],
	["minio", "MinIO / S3"],
	["keycloak", "Keycloak (auth)"],
	["elasticsearch", "Elasticsearch"],
	["opensearch", "OpenSearch"],
	["rabbitmq", "RabbitMQ"],
	["kafka", "Kafka"],
	["cassandra", "Cassandra"],
	["clickhouse", "ClickHouse"],
];

/** `^21.2.14` / `~5.9.2` -> `21.2.14`. */
function cleanVersion(v: unknown): string {
	return typeof v === "string" ? v.trim().replace(/^[\^~>=<\s]+/, "") : "";
}

function majorVersion(v: unknown): string {
	const cleaned = cleanVersion(v);
	const m = cleaned.match(/^(\d+)/);
	return m ? m[1] : cleaned;
}

function parsePom(text: string, prof: StackProfile): void {
	const springBoot = text.match(/spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)<\/version>/);
	if (springBoot) prof.frameworks.push(`Spring Boot ${springBoot[1]}`);

	const javaVersion =
		text.match(/<java\.version>([^<]+)<\/java\.version>/) ??
		text.match(/<maven\.compiler\.(?:source|release)>([^<]+)</);
	if (javaVersion) prof.languages.push(`Java ${javaVersion[1]}`);

	const artifactIds = new Set([...text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]));
	const hasArtifact = (...subs: string[]) => [...artifactIds].some((a) => subs.some((s) => a.includes(s)));

	if (hasArtifact("spring-boot-starter-webflux")) prof.frameworks.push("Spring WebFlux");
	else if (hasArtifact("spring-boot-starter-web")) prof.frameworks.push("Spring Web (REST)");
	if (hasArtifact("spring-boot-starter-data-jpa") || hasArtifact("hibernate"))
		prof.libraries.push("Spring Data JPA / Hibernate");
	if (hasArtifact("spring-boot-starter-security")) prof.libraries.push("Spring Security");
	if (hasArtifact("spring-boot-starter-validation")) prof.libraries.push("Bean Validation");
	if (hasArtifact("spring-boot-starter-mail")) prof.libraries.push("Spring Mail");
	if (hasArtifact("spring-boot-starter-actuator")) prof.libraries.push("Spring Actuator (observability)");
	if (hasArtifact("springdoc", "swagger")) prof.libraries.push("OpenAPI (springdoc/Swagger)");
	if (hasArtifact("micrometer")) prof.libraries.push("Micrometer (metrics)");
	if (hasArtifact("flyway")) prof.libraries.push("Flyway (migrations)");
	if (hasArtifact("liquibase")) prof.libraries.push("Liquibase (migrations)");
	if (hasArtifact("postgresql")) prof.datastores.push("PostgreSQL");
	if (hasArtifact("mysql-connector", "mariadb")) prof.datastores.push("MySQL/MariaDB");
	if (hasArtifact("spring-boot-starter-data-mongodb")) prof.datastores.push("MongoDB");
	if (hasArtifact("spring-boot-starter-data-redis")) prof.datastores.push("Redis");
	if (hasArtifact("jjwt", "java-jwt")) prof.libraries.push("JWT (jjwt)");
	if (hasArtifact("bucket4j")) prof.libraries.push("Bucket4j (rate limiting)");
	if (hasArtifact("lombok")) prof.libraries.push("Lombok");
	if (hasArtifact("awssdk", "aws-java-sdk") || artifactIds.has("s3")) prof.libraries.push("AWS SDK (S3)");
	if (hasArtifact("mapstruct")) prof.libraries.push("MapStruct");
	if (hasArtifact("spring-boot-starter-test")) prof.testing.push("Spring Boot Test (JUnit)");
	if (text.includes("testcontainers")) prof.testing.push("Testcontainers"); // groupId, not an artifactId
	prof.build.push("Maven");
}

const PKG_LIBRARY_DEPS: ReadonlyArray<readonly [string, string]> = [
	["bootstrap", "Bootstrap"],
	["@ng-bootstrap/ng-bootstrap", "ng-bootstrap"],
	["@angular/material", "Angular Material"],
	["@angular/cdk", "Angular CDK"],
	["@angular/localize", "Angular i18n (localize)"],
	["tailwindcss", "Tailwind CSS"],
	["rxjs", "RxJS"],
	["@ngrx/store", "NgRx"],
	["redux", "Redux"],
	["axios", "Axios"],
	["sharp", "sharp (image processing)"],
];

const PKG_TESTING_DEPS: ReadonlyArray<readonly [string, string]> = [
	["vitest", "Vitest"],
	["jest", "Jest"],
	["karma", "Karma"],
	["jasmine", "Jasmine"],
	["cypress", "Cypress"],
	["@playwright/test", "Playwright"],
	["playwright", "Playwright"],
];

const PKG_TOOLING_DEPS: ReadonlyArray<readonly [string, string]> = [
	["prettier", "Prettier"],
	["stylelint", "Stylelint"],
	["ng-packagr", "ng-packagr"],
	["husky", "Husky"],
	["storybook", "Storybook"],
];

function parsePkg(pkg: Record<string, unknown>, prof: StackProfile): void {
	const deps: Record<string, unknown> = {
		...(pkg.dependencies as Record<string, unknown> | undefined),
		...(pkg.devDependencies as Record<string, unknown> | undefined),
	};

	if ("@angular/core" in deps) {
		const ssr = "@angular/ssr" in deps ? " (SSR + Express)" : "";
		prof.frameworks.push(`Angular ${majorVersion(deps["@angular/core"])}${ssr}`);
	}
	if ("react" in deps && !("react-native" in deps)) prof.frameworks.push(`React ${majorVersion(deps.react)}`);
	if ("react-native" in deps) prof.frameworks.push(`React Native ${majorVersion(deps["react-native"])}`);
	if ("vue" in deps) prof.frameworks.push(`Vue ${majorVersion(deps.vue)}`);
	if ("next" in deps) prof.frameworks.push(`Next.js ${majorVersion(deps.next)}`);
	if ("svelte" in deps) prof.frameworks.push(`Svelte ${majorVersion(deps.svelte)}`);
	if ("@nestjs/core" in deps) {
		prof.frameworks.push(`NestJS ${majorVersion(deps["@nestjs/core"])}`);
	} else if ("express" in deps && !("@angular/ssr" in deps || "@angular/core" in deps)) {
		prof.frameworks.push(`Express ${majorVersion(deps.express)}`);
	} else if ("fastify" in deps) {
		prof.frameworks.push(`Fastify ${majorVersion(deps.fastify)}`);
	}
	if ("vite" in deps) prof.build.push(`Vite ${majorVersion(deps.vite)}`);
	if ("typescript" in deps) prof.languages.push(`TypeScript ${cleanVersion(deps.typescript)}`);

	for (const [name, label] of PKG_LIBRARY_DEPS) if (name in deps) prof.libraries.push(label);
	for (const [name, label] of PKG_TESTING_DEPS) if (name in deps) prof.testing.push(label);
	if (["@vitest/coverage-v8", "karma-coverage", "nyc"].some((k) => k in deps)) prof.testing.push("coverage");

	// tooling: lint / format / library packaging
	if (["eslint", "angular-eslint", "typescript-eslint", "@eslint/js"].some((k) => k in deps))
		prof.tooling.push("ESLint");
	for (const [name, label] of PKG_TOOLING_DEPS) if (name in deps) prof.tooling.push(label);

	const pm = pkg.packageManager;
	if (typeof pm === "string" && pm) prof.build.push(pm.replace("@", " "));
	else if ("@angular/cli" in deps) prof.build.push("npm (Angular CLI)");
}

function parseCompose(text: string, prof: StackProfile): void {
	for (const m of text.matchAll(/image:\s*['"]?([^\s'"]+)/g)) {
		const low = m[1].toLowerCase();
		for (const [key, label] of DATASTORE_IMAGE_LABELS) {
			if (low.includes(key)) {
				prof.datastores.push(label);
				break;
			}
		}
	}
}

function parsePython(blob: string, prof: StackProfile): void {
	const requiresPython = blob.match(/requires-python\s*=\s*["']([^"']+)/);
	if (requiresPython) prof.languages.push(`Python ${requiresPython[1]}`);
	const low = blob.toLowerCase();
	const frameworks: ReadonlyArray<readonly [string, string]> = [
		["django", "Django"],
		["fastapi", "FastAPI"],
		["flask", "Flask"],
	];
	for (const [key, label] of frameworks) if (low.includes(key)) prof.frameworks.push(label);
	if (low.includes("pytest")) prof.testing.push("pytest");
}

function emptyProfile(): StackProfile {
	return { languages: [], frameworks: [], datastores: [], build: [], testing: [], tooling: [], libraries: [] };
}

function dedupe(items: string[]): string[] {
	return [...new Set(items)];
}

/**
 * Extracts a filled stack profile from the manifests across `root`'s search tree. Best-effort and
 * never throws — unknown corners simply stay empty. Ported from
 * conductor-main/conductor/detect.py's `profile(root)`.
 */
export function profile(root: string): StackProfile {
	const prof = emptyProfile();
	let pyBlob = "";

	for (const r of searchRoots(root)) {
		const pom = join(r, "pom.xml");
		if (existsSync(pom)) parsePom(readTextManifest(pom), prof);

		if (existsSync(join(r, "build.gradle")) || existsSync(join(r, "build.gradle.kts"))) prof.build.push("Gradle");

		const pkgPath = join(r, "package.json");
		if (existsSync(pkgPath)) {
			const pkg = readJsonManifest(pkgPath);
			if (Object.keys(pkg).length > 0) parsePkg(pkg, prof);
		}

		for (const cf of ["docker-compose.yml", "docker-compose.yaml", "compose.yml"]) {
			const cp = join(r, cf);
			if (existsSync(cp)) {
				parseCompose(readTextManifest(cp), prof);
				prof.tooling.push("Docker Compose");
			}
		}
		if (existsSync(join(r, "Dockerfile"))) prof.tooling.push("Docker");

		for (const pf of ["pyproject.toml", "requirements.txt"]) {
			const pp = join(r, pf);
			if (existsSync(pp)) pyBlob += `${readTextManifest(pp)}\n`;
		}

		if (existsSync(join(r, "go.mod"))) prof.languages.push("Go");
	}

	if (pyBlob.trim()) parsePython(pyBlob, prof);

	return {
		languages: dedupe(prof.languages),
		frameworks: dedupe(prof.frameworks),
		datastores: dedupe(prof.datastores),
		build: dedupe(prof.build),
		testing: dedupe(prof.testing),
		tooling: dedupe(prof.tooling),
		libraries: dedupe(prof.libraries),
	};
}
