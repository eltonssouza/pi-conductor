import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Strips a leading UTF-8 BOM. Windows editors / PowerShell `Out-File` add one, which would
 * otherwise make `JSON.parse` throw and the manifest read as absent. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Tolerantly reads and parses a JSON manifest. Returns `{}` when the file is absent *or* fails to
 * parse — callers depend on that `{}` contract (mirrors conductor-main/conductor/detect.py's
 * `_read_json`) — but when the file exists and parsing genuinely fails, the reason is logged to
 * stderr rather than swallowed silently, so a malformed `package.json` doesn't just quietly vanish
 * from detection with no trace.
 */
export function readJsonManifest(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(stripBom(readFileSync(path, "utf-8")));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch (err) {
		console.error(`conductor-project: warning: could not parse ${path}: ${(err as Error).message}`);
		return {};
	}
}

/** Tolerantly reads a text manifest. Returns `""` when absent or unreadable — never throws. */
export function readTextManifest(path: string): string {
	if (!existsSync(path)) return "";
	try {
		return stripBom(readFileSync(path, "utf-8"));
	} catch (err) {
		console.error(`conductor-project: warning: could not read ${path}: ${(err as Error).message}`);
		return "";
	}
}

/** `path` relative to `root`, POSIX-separated so evidence entries look the same cross-platform. */
export function relativeToRoot(path: string, root: string): string {
	return relative(root, path).split(sep).join("/");
}

/** A simple `*.ext` / literal-name match within a single directory's entries — never recursive.
 * Every pattern `detect()` uses (`*.csproj`, `*.xcodeproj`, `*.php`, `*.html`, `vite.config.ts`) is
 * a flat, single-star (or star-less) pattern, so this needs no general glob engine. */
function matchInDir(names: string[], pattern: string): string | undefined {
	const starIndex = pattern.indexOf("*");
	if (starIndex === -1) {
		return names.includes(pattern) ? pattern : undefined;
	}
	const prefix = pattern.slice(0, starIndex);
	const suffix = pattern.slice(starIndex + 1);
	return [...names]
		.sort()
		.find((n) => n.startsWith(prefix) && n.endsWith(suffix) && n.length >= prefix.length + suffix.length);
}

/**
 * Manifest lookups bound to a project's search roots (root + subtree). Centralizes the search
 * primitives `detect()`'s phases share, so each phase stays a flat sequence of "does this manifest
 * exist?" checks. Ported from conductor-main/conductor/detect.py's `_Lookup`.
 */
export class ManifestLookup {
	private readonly root: string;
	private readonly roots: readonly string[];

	constructor(root: string, roots: readonly string[]) {
		this.root = root;
		this.roots = roots;
	}

	/** First search root containing `name`; returns its path relative to `root`, or `null`. */
	find(name: string): string | null {
		for (const r of this.roots) {
			const p = join(r, name);
			if (existsSync(p)) return relativeToRoot(p, this.root);
		}
		return null;
	}

	/** First file across the search roots whose name matches `pattern` (see `matchInDir`). */
	globFirst(pattern: string): string | null {
		for (const r of this.roots) {
			let names: string[];
			try {
				names = readdirSync(r);
			} catch {
				continue;
			}
			const match = matchInDir(names, pattern);
			if (match) return relativeToRoot(join(r, match), this.root);
		}
		return null;
	}

	/** Whether `name` exists at any search root — a file or a directory (mirrors the Python
	 * source's own slightly-loose naming: used for both a real directory, e.g. `android/`, and a
	 * file, e.g. `angular.json`). */
	hasDir(name: string): boolean {
		return this.find(name) !== null;
	}
}
