/**
 * Where the 37 built-in agent templates and 44 built-in skill directories ship WITH this package
 * (Gate 6, `feature/fase3-papeis-skills-e-subagentes` -- closing the orchestrator's finding that
 * `packages/conductor-cli` had zero role/skill data despite role-loader.ts/skill-containment.ts
 * being GREEN against synthetic fixtures).
 *
 * Ported verbatim from `conductor-main/conductor/templates/{agents,skills}` (copied, not
 * rewritten -- real, already-authored persona prose and skill instructions). Resolved relative to
 * `import.meta.url` rather than `process.cwd()` (quality-baseline category 4: no hardcoded
 * assumption that the CLI runs from its own package directory) -- the same reasoning
 * `packages/coding-agent/src/config.ts:getPackageDir()` documents for its own themes/assets dirs.
 * This package ships no `dist/` (`bin/conductor.js`'s own header: "no build step... consumed as
 * TypeScript source"), so there is no dist-vs-src branch to handle here, unlike `getThemesDir()`'s
 * Bun-binary/dist/src three-way switch.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** `packages/conductor-cli/` -- this file lives at `src/builtin-paths.ts`, one level below it. */
const PACKAGE_ROOT = join(__dirname, "..");

/** Directory of `<slug>.md` agent templates (frontmatter: `name`/`model`/`description` + persona body). */
export function getBuiltinAgentsDir(): string {
	return join(PACKAGE_ROOT, "templates", "agents");
}

/** Directory of `<skill-slug>/SKILL.md` skill trees -- the same directory-per-skill format
 * `@earendil-works/pi-coding-agent`'s own `loadSkillsFromDir` already scans natively. */
export function getBuiltinSkillsDir(): string {
	return join(PACKAGE_ROOT, "templates", "skills");
}
