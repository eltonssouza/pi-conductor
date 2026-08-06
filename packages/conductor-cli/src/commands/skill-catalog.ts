/**
 * Real, on-disk skill discovery for `conductor skills list` and for the built-in-role loader's
 * `knownSkills` cross-check (Gate 6, `feature/fase3-papeis-skills-e-subagentes`).
 *
 * Deliberately reuses two already-built primitives rather than writing a third skill parser:
 *   - `@earendil-works/pi-coding-agent`'s `loadSkillsFromDir` already scans the `<name>/SKILL.md`
 *     directory format natively (confirmed by reading its source for this task -- it recurses until
 *     it finds a `SKILL.md`, then stops, exactly the shape all 44 copied skill trees are in). This
 *     module does NOT reimplement that scan.
 *   - `@conductor/runtime`'s `filterSkillsWithinRoots` (already GREEN, Gate 5/6 of this same phase)
 *     proves every discovered skill's location canonicalizes inside a known skills root before it is
 *     trusted -- R20/T38's path-containment guarantee, reused here rather than a second
 *     canonicalization.
 *
 * `loadSkillsFromDir` is called directly on Conductor's OWN directories (the built-in
 * `templates/skills/` this package ships, and a project's `.conductor/skills/` if present) --
 * deliberately NOT `@earendil-works/pi-coding-agent`'s higher-level `loadSkills()`, which resolves
 * against the Pi tool's OWN global convention (`getAgentDir()` / `CONFIG_DIR_NAME`, driven by
 * `packages/coding-agent/package.json`'s `piConfig.configDir`, default `.pi`) -- a different tool's
 * directory convention than Conductor's own `.conductor/`. Using the low-level, format-only
 * `loadSkillsFromDir` avoids silently pointing this command at `~/.pi/agent/skills` instead of
 * Conductor's own catalog.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type ContainedSkillCatalogEntry,
	filterSkillsWithinRoots,
	type SkillCatalogEntry,
	type SkillContainmentViolation,
} from "@conductor/runtime";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { getBuiltinSkillsDir } from "../builtin-paths.ts";

export interface BuiltinSkillCatalogOptions {
	/** Overridable for tests -- defaults to the real shipped `templates/skills/`. */
	builtinSkillsDir?: string;
	/** A project's own skill directory, scanned in addition to the built-in catalog when present.
	 * Defaults to `<cwd>/.conductor/skills` -- undefined/absent is not an error, just "no project
	 * skills contributed" (mirrors `loadSkillsFromDir`'s own "directory absent -> empty result, never
	 * throws" contract). */
	projectSkillsDir?: string;
}

export interface BuiltinSkillCatalog {
	/** Every skill that passed containment (R20/T38) -- the set `conductor skills list` shows and
	 * `role-catalog.ts` treats as "known" for BR-1/BR-2 cross-checking. */
	skills: ContainedSkillCatalogEntry[];
	/** A skill whose location failed containment -- named, never silently dropped. */
	excluded: SkillContainmentViolation[];
	/** Diagnostics from the native Pi loader itself (invalid frontmatter, name collisions, ...),
	 * formatted as plain strings -- never a secret, never raw file content (only path + message). */
	loadDiagnostics: string[];
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatLoadDiagnostic(diagnostic: { type: string; message: string; path?: string }): string {
	return diagnostic.path
		? `${diagnostic.type}: ${diagnostic.message} (${diagnostic.path})`
		: `${diagnostic.type}: ${diagnostic.message}`;
}

/**
 * Loads and contains the built-in skill catalog (plus a project's own `.conductor/skills/`, when
 * present). Never throws: a missing/unreadable directory degrades to "contributes zero skills",
 * same discipline as every other external-I/O boundary in this CLI (doctor.ts's own header:
 * "explicit error handling on every external call, degrade rather than throw").
 */
export function loadBuiltinSkillCatalog(options: BuiltinSkillCatalogOptions = {}): BuiltinSkillCatalog {
	const builtinSkillsDir = options.builtinSkillsDir ?? getBuiltinSkillsDir();
	const projectSkillsDir = options.projectSkillsDir;

	const loadDiagnostics: string[] = [];
	const rawEntries: SkillCatalogEntry[] = [];
	const skillsRoots: string[] = [builtinSkillsDir];

	try {
		const builtinResult = loadSkillsFromDir({ dir: builtinSkillsDir, source: "builtin" });
		loadDiagnostics.push(...builtinResult.diagnostics.map(formatLoadDiagnostic));
		for (const skill of builtinResult.skills) {
			rawEntries.push({ name: skill.name, description: skill.description, location: skill.filePath });
		}
	} catch (error) {
		loadDiagnostics.push(`error: could not scan built-in skills directory: ${describeError(error)}`);
	}

	if (projectSkillsDir && existsSync(projectSkillsDir)) {
		skillsRoots.push(projectSkillsDir);
		try {
			const projectResult = loadSkillsFromDir({ dir: projectSkillsDir, source: "project" });
			loadDiagnostics.push(...projectResult.diagnostics.map(formatLoadDiagnostic));
			for (const skill of projectResult.skills) {
				rawEntries.push({ name: skill.name, description: skill.description, location: skill.filePath });
			}
		} catch (error) {
			loadDiagnostics.push(`error: could not scan project skills directory: ${describeError(error)}`);
		}
	}

	const { included, excluded } = filterSkillsWithinRoots(rawEntries, skillsRoots);

	return { skills: included, excluded, loadDiagnostics };
}

/** The default project skills directory this CLI looks at, given a project root -- mirrors
 * `.conductor/config.json`/`.conductor/policy.json`'s own convention (`CONFIG_DIR_NAME` in
 * `@conductor/config`'s sense, i.e. literally `.conductor`, not the Pi tool's own `.pi`). */
export function defaultProjectSkillsDir(cwd: string): string {
	return join(cwd, ".conductor", "skills");
}
