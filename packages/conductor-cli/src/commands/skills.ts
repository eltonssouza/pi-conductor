/**
 * `conductor skills list` (Gate 6, `feature/fase3-papeis-skills-e-subagentes`).
 *
 * Thin CLI surface over `skill-catalog.ts` -- no listing logic of its own.
 */

import { defaultProjectSkillsDir, loadBuiltinSkillCatalog } from "./skill-catalog.ts";

export interface SkillsListOptions {
	cwd: string;
	/** Test-only override -- production callers never set this. */
	builtinSkillsDir?: string;
}

export interface SkillListEntry {
	name: string;
	description: string;
}

export interface SkillsListReport {
	skills: SkillListEntry[];
	diagnostics: string[];
	generatedAt: string;
}

export async function runSkillsList(options: SkillsListOptions): Promise<SkillsListReport> {
	const catalog = loadBuiltinSkillCatalog({
		builtinSkillsDir: options.builtinSkillsDir,
		projectSkillsDir: defaultProjectSkillsDir(options.cwd),
	});

	const skills = [...catalog.skills]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((skill) => ({ name: skill.name, description: skill.description }));

	const diagnostics = [
		...catalog.excluded.map((e) => `excluded: ${e.name} -- ${e.reason}`),
		...catalog.loadDiagnostics,
	];

	return { skills, diagnostics, generatedAt: new Date().toISOString() };
}

export function formatSkillsListReport(report: SkillsListReport): string {
	const lines = report.skills.map((skill) => `${skill.name.padEnd(32)} ${skill.description}`);

	if (report.diagnostics.length > 0) {
		lines.push("", "Diagnostics:");
		for (const diagnostic of report.diagnostics) lines.push(`  - ${diagnostic}`);
	}

	lines.push("", `${report.skills.length} skill(s). Generated at ${report.generatedAt} (UTC)`);
	return `${lines.join("\n")}\n`;
}
