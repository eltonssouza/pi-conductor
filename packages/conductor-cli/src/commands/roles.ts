/**
 * `conductor roles list` (Gate 6, `feature/fase3-papeis-skills-e-subagentes`).
 *
 * Composes `skill-catalog.ts` (known skills) + `role-catalog.ts` (real on-disk role parsing) +
 * role-loader.ts's own `listRoles` -- no new listing logic here, this command is the thin CLI
 * surface over primitives that are already GREEN and already tested at the unit level.
 */

import { listRoles, type RoleListEntry } from "@conductor/config";
import { loadBuiltinRoleCatalog } from "./role-catalog.ts";
import { defaultProjectSkillsDir, loadBuiltinSkillCatalog } from "./skill-catalog.ts";

export interface RolesListOptions {
	cwd: string;
	/** Test-only overrides -- production callers never set these, matching doctor.ts's own
	 * injectable-collaborator pattern for testability without touching the real shipped templates. */
	agentsDir?: string;
	skillsDir?: string;
}

export interface RolesListReport {
	roles: RoleListEntry[];
	diagnostics: string[];
	generatedAt: string;
}

export async function runRolesList(options: RolesListOptions): Promise<RolesListReport> {
	const skillCatalog = loadBuiltinSkillCatalog({
		builtinSkillsDir: options.skillsDir,
		projectSkillsDir: defaultProjectSkillsDir(options.cwd),
	});
	const knownSkills = new Set(skillCatalog.skills.map((skill) => skill.name));

	const roleCatalog = loadBuiltinRoleCatalog({ agentsDir: options.agentsDir, knownSkills });
	const rows = listRoles(roleCatalog.registry).sort((a, b) => a.id.localeCompare(b.id));

	const diagnostics = [
		...roleCatalog.diagnostics.map((d) => `${d.kind}: ${d.roleId} -- ${d.detail}`),
		...skillCatalog.excluded.map((e) => `skill-excluded: ${e.name} -- ${e.reason}`),
	];

	return { roles: rows, diagnostics, generatedAt: new Date().toISOString() };
}

const TOOLS_NOTE =
	"Note: tools allowlists are not yet declared per built-in role (open architecture question, see " +
	"src/commands/role-catalog.ts's header) -- every role's ceiling is empty (fail-closed) until authored.";

export function formatRolesListReport(report: RolesListReport): string {
	const header = "SLUG                            AREA           PRIMARY SKILL                    MODEL ROLE   GATES";
	const rows = report.roles.map((role) => {
		const primarySkill = role.skills[0] ?? "-";
		const extra = role.skills.length > 1 ? ` (+${role.skills.length - 1})` : "";
		const gates = role.gates.length > 0 ? role.gates.join(",") : "-";
		return [
			role.id.padEnd(32),
			(role.area ?? "-").padEnd(15),
			`${primarySkill}${extra}`.padEnd(33),
			role.modelRole.padEnd(13),
			gates,
		].join("");
	});

	const lines = [header, ...rows, "", TOOLS_NOTE];

	if (report.diagnostics.length > 0) {
		lines.push("", "Diagnostics (excluded from the listing above):");
		for (const diagnostic of report.diagnostics) lines.push(`  - ${diagnostic}`);
	}

	lines.push("", `${report.roles.length} role(s). Generated at ${report.generatedAt} (UTC)`);
	return `${lines.join("\n")}\n`;
}
