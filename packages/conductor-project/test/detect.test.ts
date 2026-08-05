import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detect } from "../src/detect.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject();
});

afterEach(() => {
	project.cleanup();
});

describe("detect — nothing recognized", () => {
	it("returns type unknown with no technologies/evidence for an empty directory", () => {
		expect(detect(project.root)).toEqual({ type: "unknown", technologies: [], evidence: [] });
	});
});

describe("detect — JS/TS frontend frameworks", () => {
	it("detects Angular via angular.json even with no matching dependency", () => {
		project.write("angular.json", "{}");
		const result = detect(project.root);
		expect(result.type).toBe("frontend");
		expect(result.technologies).toContain("Angular");
	});

	it("detects Angular via the @angular/core dependency", () => {
		project.writeJson("package.json", { dependencies: { "@angular/core": "^21.0.0" } });
		const result = detect(project.root);
		expect(result.type).toBe("frontend");
		expect(result.technologies).toContain("Angular");
	});

	it("detects plain React (no react-native) as frontend", () => {
		project.writeJson("package.json", { dependencies: { react: "^18.0.0" } });
		const result = detect(project.root);
		expect(result.type).toBe("frontend");
		expect(result.technologies).toEqual(["React"]);
	});

	it("detects React + react-native as mobile, not frontend, and does not also tag plain React", () => {
		project.writeJson("package.json", { dependencies: { react: "^18.0.0", "react-native": "^0.74.0" } });
		const result = detect(project.root);
		expect(result.type).toBe("mobile");
		expect(result.technologies).toContain("React Native");
		expect(result.technologies).not.toContain("React");
	});

	it("detects Vue, Svelte and Next.js as frontend", () => {
		project.writeJson("package.json", { dependencies: { vue: "^3.0.0", svelte: "^4.0.0", next: "^14.0.0" } });
		const result = detect(project.root);
		expect(result.type).toBe("frontend");
		expect(result.technologies).toEqual(expect.arrayContaining(["Vue", "Svelte", "Next.js"]));
	});

	it("detects Vite via its config file even when package.json declares no dependencies", () => {
		project.write("vite.config.ts", "export default {}\n");
		project.writeJson("package.json", {});
		const result = detect(project.root);
		expect(result.type).toBe("frontend");
		expect(result.technologies).toContain("Vite");
	});
});

describe("detect — Node.js backend", () => {
	it("detects NestJS as a Node.js backend", () => {
		project.writeJson("package.json", { dependencies: { "@nestjs/core": "^10.0.0" } });
		const result = detect(project.root);
		expect(result.type).toBe("backend");
		expect(result.technologies).toContain("Node.js");
	});

	it("detects Fastify as a Node.js backend", () => {
		project.writeJson("package.json", { dependencies: { fastify: "^4.0.0" } });
		expect(detect(project.root).type).toBe("backend");
	});

	it("detects Express as a Node.js backend on its own", () => {
		project.writeJson("package.json", { dependencies: { express: "^4.0.0" } });
		expect(detect(project.root).type).toBe("backend");
	});

	it("does NOT count Express as a separate backend when it is Angular's SSR server (@angular/ssr present)", () => {
		project.writeJson("package.json", {
			dependencies: { "@angular/core": "^21.0.0", "@angular/ssr": "^21.0.0", express: "^4.0.0" },
		});
		const result = detect(project.root);
		// A plain Angular Universal app must stay "frontend", not misclassify as fullstack because
		// its own SSR server also happens to be Express.
		expect(result.type).toBe("frontend");
		expect(result.technologies).not.toContain("Node.js");
	});

	it("does NOT count Express as a separate backend when @angular/core is present without @angular/ssr", () => {
		project.writeJson("package.json", { dependencies: { "@angular/core": "^21.0.0", express: "^4.0.0" } });
		expect(detect(project.root).type).toBe("frontend");
	});
});

describe("detect — non-JS backend manifests", () => {
	it("detects Java/Maven via pom.xml, with pom.xml recorded as evidence", () => {
		project.write("pom.xml", "<project></project>");
		const result = detect(project.root);
		expect(result.type).toBe("backend");
		expect(result.technologies).toContain("Java/Maven");
		expect(result.evidence).toContain("pom.xml");
	});

	it("detects Java/Gradle via build.gradle", () => {
		project.write("build.gradle", "");
		expect(detect(project.root).technologies).toContain("Java/Gradle");
	});

	it("detects Go via go.mod", () => {
		project.write("go.mod", "module example.com/x\n");
		expect(detect(project.root).technologies).toContain("Go");
	});

	it("detects Ruby via Gemfile", () => {
		project.write("Gemfile", "");
		expect(detect(project.root).technologies).toContain("Ruby");
	});

	it("detects PHP via composer.json", () => {
		project.write("composer.json", "{}");
		expect(detect(project.root).technologies).toContain("PHP");
	});

	it("detects Rust via Cargo.toml", () => {
		project.write("Cargo.toml", "");
		expect(detect(project.root).technologies).toContain("Rust");
	});

	it("detects Python via requirements.txt", () => {
		project.write("requirements.txt", "");
		expect(detect(project.root).technologies).toContain("Python");
	});

	it("detects Python via pyproject.toml when requirements.txt is absent", () => {
		project.write("pyproject.toml", "");
		expect(detect(project.root).technologies).toContain("Python");
	});

	it("detects Python via manage.py when neither manifest is present", () => {
		project.write("manage.py", "");
		expect(detect(project.root).technologies).toContain("Python");
	});

	it("detects .NET via a *.csproj file", () => {
		project.write("App.csproj", "<Project></Project>");
		expect(detect(project.root).technologies).toContain(".NET");
	});

	it("detects PHP via a loose *.php file when composer.json is absent", () => {
		project.write("index.php", "<?php\n");
		expect(detect(project.root).technologies).toContain("PHP");
	});

	it("classifies backend + frontend manifests together as fullstack", () => {
		project.write("pom.xml", "<project></project>");
		project.writeJson("package.json", { dependencies: { react: "^18.0.0" } });
		expect(detect(project.root).type).toBe("fullstack");
	});
});

describe("detect — mobile", () => {
	it("detects Flutter via pubspec.yaml", () => {
		project.write("pubspec.yaml", "name: x\n");
		const result = detect(project.root);
		expect(result.type).toBe("mobile");
		expect(result.technologies).toContain("Flutter");
	});

	it("detects a native Android+iOS pair", () => {
		project.mkdir("android");
		project.mkdir("ios");
		expect(detect(project.root).type).toBe("mobile");
	});

	it("does not classify mobile from android/ alone, without the matching ios/", () => {
		project.mkdir("android");
		expect(detect(project.root).type).toBe("unknown");
	});

	it("detects an Xcode project via *.xcodeproj", () => {
		project.mkdir("App.xcodeproj");
		const result = detect(project.root);
		expect(result.type).toBe("mobile");
		expect(result.technologies).toContain("iOS/Xcode");
	});

	it("mobile wins over a mixed front+back signal (mobile takes classification priority)", () => {
		project.write("pubspec.yaml", "name: x\n");
		project.write("pom.xml", "<project></project>");
		project.writeJson("package.json", { dependencies: { react: "^18.0.0" } });
		expect(detect(project.root).type).toBe("mobile");
	});
});

describe("detect — static HTML fallback", () => {
	it("classifies a hand-written site (index.html, no package.json anywhere) as frontend/Static HTML", () => {
		project.write("index.html", "<!doctype html>");
		const result = detect(project.root);
		expect(result.type).toBe("frontend");
		expect(result.technologies).toEqual(["Static HTML"]);
	});

	it("falls back to any *.html when index.html is absent", () => {
		project.write("about.html", "<!doctype html>");
		expect(detect(project.root).technologies).toContain("Static HTML");
	});

	it("does NOT tag Static HTML when a package.json with real deps already classified the project", () => {
		project.write("index.html", "<!doctype html>");
		project.writeJson("package.json", { dependencies: { react: "^18.0.0" } });
		const result = detect(project.root);
		expect(result.technologies).not.toContain("Static HTML");
		expect(result.technologies).toContain("React");
	});

	it("does NOT tag Static HTML when package.json declares an unrecognized (non-framework) dependency", () => {
		// The guard is on the merged dependencies/devDependencies map being non-empty, not on
		// "package.json exists" — a project depending only on, say, lodash has no framework signal
		// (`front` stays false) but must still not be mislabeled "Static HTML": it is exactly the
		// unbuilt-JS-app case the guard exists to exclude, even though nothing in its deps was
		// recognized as a specific framework.
		project.write("index.html", "<!doctype html>");
		project.writeJson("package.json", { dependencies: { lodash: "^4.17.21" } });
		const result = detect(project.root);
		expect(result.technologies).not.toContain("Static HTML");
		expect(result.type).toBe("unknown");
	});

	it("DOES still tag Static HTML when package.json exists but declares zero dependencies of any kind", () => {
		// A package.json with no "dependencies"/"devDependencies" keys at all merges to an empty
		// deps map — indistinguishable, for this guard, from package.json not existing.
		project.write("index.html", "<!doctype html>");
		project.writeJson("package.json", { name: "empty-shell" });
		const result = detect(project.root);
		expect(result.technologies).toContain("Static HTML");
	});
});

describe("detect — monorepo two-level walk (not an rglob-then-filter)", () => {
	it("detects a backend/ + frontend/ split as fullstack, with evidence relative to the monorepo root", () => {
		project.write("backend/pom.xml", "<project></project>");
		project.writeJson("frontend/package.json", { dependencies: { "@angular/core": "^21.0.0" } });
		const result = detect(project.root);
		expect(result.type).toBe("fullstack");
		expect(result.technologies).toEqual(expect.arrayContaining(["Java/Maven", "Angular"]));
		expect(result.evidence).toEqual(expect.arrayContaining(["backend/pom.xml", "frontend/package.json"]));
	});

	it("detects a manifest nested two levels deep (apps/api/pom.xml)", () => {
		project.write("apps/api/pom.xml", "<project></project>");
		const result = detect(project.root);
		expect(result.type).toBe("backend");
		expect(result.evidence).toContain("apps/api/pom.xml");
	});

	it("does not find a manifest nested three levels deep — MAX_DEPTH is a hard boundary, not a suggestion", () => {
		project.write("apps/api/deep/pom.xml", "<project></project>");
		expect(detect(project.root).type).toBe("unknown");
	});

	it("never descends into node_modules even when it holds thousands of nested package.json files", () => {
		// A single deeply-nested vendored package.json must never surface as evidence — proof that
		// the skip-list is applied while walking down, not filtered out of a full listing afterwards.
		project.writeJson("node_modules/some-lib/node_modules/nested-dep/package.json", {
			dependencies: { "@angular/core": "^1.0.0" },
		});
		const result = detect(project.root);
		expect(result.type).toBe("unknown");
		expect(result.evidence).toEqual([]);
	});
});

describe("detect — manifest robustness", () => {
	it("treats a malformed package.json as absent rather than throwing", () => {
		project.write("package.json", "{ not valid json");
		expect(() => detect(project.root)).not.toThrow();
		expect(detect(project.root).type).toBe("unknown");
	});

	it("tolerates a UTF-8 BOM in package.json", () => {
		const bom = String.fromCharCode(0xfeff);
		project.write("package.json", bom + JSON.stringify({ dependencies: { react: "^18.0.0" } }));
		expect(detect(project.root).technologies).toContain("React");
	});

	it("dedupes a technology contributed by more than one manifest, keeping first-occurrence order", () => {
		project.writeJson("package.json", { dependencies: { react: "^18.0.0" } });
		project.writeJson("apps/web/package.json", { dependencies: { react: "^18.0.0" } });
		const result = detect(project.root);
		expect(result.technologies.filter((t) => t === "React")).toHaveLength(1);
	});
});
