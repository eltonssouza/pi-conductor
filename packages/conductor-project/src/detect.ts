import { join } from "node:path";
import { ManifestLookup, readJsonManifest, relativeToRoot } from "./manifest.ts";
import type { DetectionResult, ProjectType } from "./types.ts";
import { searchRoots } from "./walk.ts";

/**
 * Best-effort project type + technology detection from root manifests. Ported from
 * conductor-main/conductor/detect.py — see that file's module docstring and
 * docs/adr/0002-fase1-cli-foundation.md §5.1 for why this is a TypeScript port rather than a
 * subprocess call into the Python original.
 */

interface Signals {
	techs: string[];
	evidence: string[];
	front: boolean;
	back: boolean;
	mobile: boolean;
}

function createSignals(): Signals {
	return { techs: [], evidence: [], front: false, back: false, mobile: false };
}

/** Conservative classification: mobile wins, then mixed front+back -> fullstack. Ported from
 * `_Signals.ptype`. */
function classify(sig: Signals): ProjectType {
	if (sig.mobile) return "mobile";
	if (sig.front && sig.back) return "fullstack";
	if (sig.front) return "frontend";
	if (sig.back) return "backend";
	return "unknown";
}

function dedupe(items: string[]): string[] {
	return [...new Set(items)];
}

/** Merges deps from every package.json across the tree; records them as evidence. Ported from
 * `_merge_js_deps`. */
function mergeJsDeps(root: string, roots: readonly string[], sig: Signals): Record<string, unknown> {
	const deps: Record<string, unknown> = {};
	const pkgPaths: string[] = [];
	for (const r of roots) {
		const p = join(r, "package.json");
		const pkg = readJsonManifest(p);
		if (Object.keys(pkg).length > 0) {
			Object.assign(deps, pkg.dependencies as Record<string, unknown> | undefined);
			Object.assign(deps, pkg.devDependencies as Record<string, unknown> | undefined);
			pkgPaths.push(relativeToRoot(p, root));
		}
	}
	if (pkgPaths.length > 0) sig.evidence.push(...pkgPaths);
	return deps;
}

/** JS/TS ecosystem signals from the merged package.json deps + config files. Ported from
 * `_detect_js`. */
function detectJs(lk: ManifestLookup, sig: Signals, deps: Record<string, unknown>): void {
	if (lk.hasDir("angular.json") || "@angular/core" in deps) {
		sig.front = true;
		sig.techs.push("Angular");
	}
	if ("react" in deps) {
		if ("react-native" in deps) {
			sig.mobile = true;
			sig.techs.push("React Native");
		} else {
			sig.front = true;
			sig.techs.push("React");
		}
	}
	if ("vue" in deps) {
		sig.front = true;
		sig.techs.push("Vue");
	}
	if ("svelte" in deps) {
		sig.front = true;
		sig.techs.push("Svelte");
	}
	if ("next" in deps) {
		sig.front = true;
		sig.techs.push("Next.js");
	}
	if (lk.find("vite.config.js") || lk.find("vite.config.ts")) {
		sig.front = true;
		sig.techs.push("Vite");
	}
	// Node backend. NestJS/Fastify are unambiguous. Express, however, also ships as the SSR server
	// of an Angular Universal app (@angular/ssr); in that case it is not a separate backend, so
	// only count it when no Angular SSR/Angular is present.
	if ("@nestjs/core" in deps || "fastify" in deps) {
		sig.back = true;
		sig.techs.push("Node.js");
	} else if ("express" in deps && !("@angular/ssr" in deps || "@angular/core" in deps)) {
		sig.back = true;
		sig.techs.push("Node.js");
	}
}

const NON_JS_BACKEND_MANIFESTS: ReadonlyArray<readonly [string, string]> = [
	["pom.xml", "Java/Maven"],
	["build.gradle", "Java/Gradle"],
	["go.mod", "Go"],
	["Gemfile", "Ruby"],
	["composer.json", "PHP"],
	["Cargo.toml", "Rust"],
];

/** Non-JS backend manifests (JVM, Go, Ruby, PHP, Rust, Python, .NET). Ported from
 * `_detect_backend`. */
function detectBackend(lk: ManifestLookup, sig: Signals): void {
	for (const [file, tech] of NON_JS_BACKEND_MANIFESTS) {
		const hit = lk.find(file);
		if (hit) {
			sig.back = true;
			sig.techs.push(tech);
			sig.evidence.push(hit);
		}
	}
	const py = lk.find("requirements.txt") ?? lk.find("pyproject.toml") ?? lk.find("manage.py");
	if (py) {
		sig.back = true;
		sig.techs.push("Python");
		sig.evidence.push(py);
	}
	const csproj = lk.globFirst("*.csproj");
	if (csproj) {
		sig.back = true;
		sig.techs.push(".NET");
		sig.evidence.push(csproj);
	}
	const php = lk.globFirst("*.php"); // composer.json is already handled above
	if (php) {
		sig.back = true;
		sig.techs.push("PHP");
		sig.evidence.push(php);
	}
}

/** Mobile manifests: Flutter, native Android+iOS pair, Xcode project. Ported from
 * `_detect_mobile`. */
function detectMobile(lk: ManifestLookup, sig: Signals): void {
	const flutter = lk.find("pubspec.yaml");
	if (flutter) {
		sig.mobile = true;
		sig.techs.push("Flutter");
		sig.evidence.push(flutter);
	}
	if (lk.hasDir("android") && lk.hasDir("ios")) {
		sig.mobile = true;
		sig.evidence.push("android/+ios/");
	}
	const xcode = lk.globFirst("*.xcodeproj");
	if (xcode) {
		sig.mobile = true;
		sig.techs.push("iOS/Xcode");
		sig.evidence.push(xcode);
	}
}

/** Hand-written static site: HTML present but no package.json anywhere (so it is not an unbuilt
 * JS app). Guarded by an empty `deps` so real frontend frameworks are never tagged "Static HTML".
 * Ported from `_detect_static_html`. */
function detectStaticHtml(lk: ManifestLookup, sig: Signals, deps: Record<string, unknown>): void {
	if (!sig.front && Object.keys(deps).length === 0) {
		const html = lk.find("index.html") ?? lk.globFirst("*.html");
		if (html) {
			sig.front = true;
			sig.techs.push("Static HTML");
			sig.evidence.push(html);
		}
	}
}

/**
 * Returns `{ type, technologies, evidence }` from `root` + subdir manifests.
 *
 * Conservative: mixed front+back signals -> fullstack; nothing recognized -> unknown, so the
 * caller/user can classify manually. Evidence entries are paths relative to the project root, so
 * monorepo locations are visible. Ported from conductor-main/conductor/detect.py's `detect(root)`
 * — deviates from it only in shape (a named object here vs. a Python tuple there), never in the
 * classification behavior itself.
 */
export function detect(root: string): DetectionResult {
	const roots = searchRoots(root);
	const lk = new ManifestLookup(root, roots);
	const sig = createSignals();

	const deps = mergeJsDeps(root, roots, sig); // JS/TS first: deps gate the later phases
	detectJs(lk, sig, deps);
	detectBackend(lk, sig);
	detectMobile(lk, sig);
	detectStaticHtml(lk, sig, deps);

	return {
		type: classify(sig),
		technologies: dedupe(sig.techs),
		evidence: dedupe(sig.evidence),
	};
}
