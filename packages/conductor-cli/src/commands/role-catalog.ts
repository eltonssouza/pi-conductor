/**
 * Real, on-disk Role Registry loading for `conductor roles list` (Gate 6,
 * `feature/fase3-papeis-skills-e-subagentes` -- closes the gap the orchestrator found: role-loader.ts
 * was GREEN against synthetic `ConductorRole` fixtures, but nothing in this repo had ever parsed the
 * real `templates/agents/*.md` files or built a registry over them).
 *
 * Scope boundary (deliberate): this module is READ-ONLY discovery for `roles list` only. It is NOT
 * `@conductor/cli/src/commands/chat/role-resolution.ts` -- the seam ADR 0004 §12 names for composing
 * load+trust+validate+containment behind the interactive `--role` flag, owned by a parallel engineer
 * this Gate together with the `task` tool's registration (per this task's own instructions: do not
 * touch `chat.ts`, the `--role` flag, or the tool registry). Both will eventually want the same
 * "parse `templates/agents/*.md` into `ConductorRole[]`" step; deduplicating them is a follow-up once
 * `role-resolution.ts` exists with its own real requirements, not invented speculatively here.
 *
 * ============================================================================================
 * ARCHITECTURE GAP FOUND -- FLAGGED, NOT SILENTLY RECONCILED (per this task's own instructions)
 * ============================================================================================
 * `ConductorRole.tools: string[]` is REQUIRED (ADR 0004 §3.1 / FR-20: "OBRIGATÓRIO... nunca
 * 'undefined = tudo'"). But NEITHER of this fase's two sources of built-in role data declares a
 * per-role tools allowlist at all:
 *   - `conductor-main/conductor/roles.py`'s `Role` dataclass has exactly four fields --
 *     `slug`/`skill`/`area`/`extra_skills`/`spawns` -- no `tools`.
 *   - The 37 copied `templates/agents/*.md` files carry only `name`/`model`/`description` in
 *     frontmatter (confirmed against every one of them, e.g. `backend-engineer.md`) -- no `tools:`
 *     field, unlike the Pi's OWN subagent example format
 *     (`examples/extensions/subagent/agents.ts:AgentConfig.tools?: string[]`), which HAS a `tools`
 *     frontmatter convention but treats it as OPTIONAL, `undefined` meaning "no restriction" -- the
 *     exact "undefined = everything" shape ADR 0004 deliberately rejects for `ConductorRole`.
 *
 * Nobody has decided what tools each of the 37 built-in roles should actually have. Inventing a
 * plausible-looking allowlist per role here (e.g. "engineering roles get bash, product roles get
 * read-only") would be exactly the kind of consequential, security-relevant, currently-undecided
 * design call this Gate's own instructions say to stop and document rather than silently resolve.
 *
 * Chosen interim value: every built-in role loads with `tools: []` (the empty ceiling) until a real
 * decision is made (most likely: a `tools:` frontmatter field authored per role in a follow-up ADR).
 * `[]` over "all currently known tool names" because FR-20's own words are "never undefined = tudo"
 * -- spelling "everything" out as a literal array instead of the `undefined` sentinel is the same
 * anti-pattern by another name. `cdt library` grounding for choosing the empty/least-privilege
 * default specifically (this session, ungated query -- the `--gate 6` corpus itself scopes to
 * 04_engineering_and_practices and returned only generic hits, so this is grounded against the
 * security corpus directly): Secure and Reliable Systems Design §3.1/§3.3 ("least privilege --
 * minimum access in scope", top 0.678/0.657), Security Engineering Principles §1.2 (least privilege
 * as a first-class defense-in-depth layer, top 0.650), Prompt Engineering -- Principles Patterns and
 * Practice §9.4 ("capability you don't grant is [...] damage that can't happen", top 0.645).
 *
 * Low blast radius TODAY: `RoleListEntry` (role-loader.ts's own `listRoles()`) does not surface
 * `tools` in `roles list`'s output at all, so this placeholder changes nothing about what Gate 6
 * actually displays. It will matter the moment `role-resolution.ts` starts feeding these same
 * built-in `ConductorRole` values into real permission enforcement -- which is exactly why this is
 * called out this loudly now, in writing, instead of being silently discovered later as "why can no
 * built-in role use any tool at all".
 * ============================================================================================
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BUILTIN_ROLES,
	buildRoleRegistry,
	type ConductorRole,
	findBuiltinRole,
	gatesForBuiltinRole,
	type ModelRole,
	type RoleRegistry,
	skillsForBuiltinRole,
} from "@conductor/config";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getBuiltinAgentsDir } from "../builtin-paths.ts";

const VALID_MODEL_ROLES: ReadonlySet<string> = new Set<ModelRole>(["strategic", "standard", "lightweight"]);

/** Fail-closed placeholder ceiling -- see this file's header. Never `undefined` (FR-20). */
const NO_TOOLS_DECLARED_YET: readonly string[] = [];

export interface BuiltinRoleLoadDiagnostic {
	kind: "missing-template-file" | "invalid-frontmatter" | "unknown-skill";
	roleId: string;
	detail: string;
}

export interface BuiltinRoleCatalog {
	registry: RoleRegistry;
	diagnostics: BuiltinRoleLoadDiagnostic[];
}

export interface LoadBuiltinRoleCatalogOptions {
	/** Overridable for tests -- defaults to the real shipped `templates/agents/`. */
	agentsDir?: string;
	/** The skill catalog a role's `skills` are cross-checked against (BR-1/BR-2/R21/T39) -- normally
	 * `loadBuiltinSkillCatalog(...)`'s own skill names, passed in rather than loaded again here so
	 * `roles list` and `skills list` share exactly one skill scan per invocation. */
	knownSkills: ReadonlySet<string>;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface AgentFrontmatter {
	name?: string;
	model?: string;
	description?: string;
	[key: string]: unknown;
}

function loadAgentTemplate(
	slug: string,
	agentsDir: string,
): { role: ConductorRole } | { diagnostic: BuiltinRoleLoadDiagnostic } {
	const filePath = join(agentsDir, `${slug}.md`);
	let raw: Buffer;
	try {
		raw = readFileSync(filePath);
	} catch (error) {
		return { diagnostic: { kind: "missing-template-file", roleId: slug, detail: describeError(error) } };
	}

	const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(raw.toString("utf-8"));

	if (!frontmatter.name || !frontmatter.description) {
		return {
			diagnostic: {
				kind: "invalid-frontmatter",
				roleId: slug,
				detail: "frontmatter is missing name or description",
			},
		};
	}
	if (!frontmatter.model || !VALID_MODEL_ROLES.has(frontmatter.model)) {
		return {
			diagnostic: {
				kind: "invalid-frontmatter",
				roleId: slug,
				detail: `frontmatter model "${frontmatter.model ?? ""}" is not one of strategic/standard/lightweight`,
			},
		};
	}

	// Safe: only ever called for a slug drawn from BUILTIN_ROLES itself (see the loop below).
	const spec = findBuiltinRole(slug);
	if (!spec) {
		return { diagnostic: { kind: "missing-template-file", roleId: slug, detail: "not a known built-in role slug" } };
	}

	const contentHash = createHash("sha256").update(raw).digest("hex");

	const role: ConductorRole = {
		name: frontmatter.name,
		description: frontmatter.description,
		systemPrompt: body,
		tools: [...NO_TOOLS_DECLARED_YET], // see this file's header -- deliberate, not a guess
		modelRole: frontmatter.model as ModelRole,
		skills: skillsForBuiltinRole(spec),
		canSpawn: [...spec.spawns],
		gates: gatesForBuiltinRole(slug),
		source: "builtin",
		contentHash,
		filePath,
		area: spec.area,
	};
	return { role };
}

/**
 * Parses every `templates/agents/<slug>.md` named by `BUILTIN_ROLES`, cross-checks each role's
 * `skills` against `knownSkills` (BR-1/BR-2/R21/T39, via the already-GREEN `buildRoleRegistry`), and
 * returns the resulting registry plus every diagnostic along the way -- a role that fails to parse or
 * references an unknown skill is excluded with a named reason, never silently dropped and never
 * loaded partially (same fail-closed, non-partial discipline `role-loader.ts` already established).
 * Never throws: a missing/corrupt template degrades that one role to a diagnostic, exactly like
 * `doctor.ts`'s "one failing check never crashes the whole report".
 */
export function loadBuiltinRoleCatalog(options: LoadBuiltinRoleCatalogOptions): BuiltinRoleCatalog {
	const agentsDir = options.agentsDir ?? getBuiltinAgentsDir();
	const diagnostics: BuiltinRoleLoadDiagnostic[] = [];
	const roles: ConductorRole[] = [];

	for (const spec of BUILTIN_ROLES) {
		const result = loadAgentTemplate(spec.slug, agentsDir);
		if ("diagnostic" in result) {
			diagnostics.push(result.diagnostic);
			continue;
		}
		roles.push(result.role);
	}

	const registry = buildRoleRegistry(roles, options.knownSkills);
	for (const diagnostic of registry.diagnostics) {
		diagnostics.push({
			kind: "unknown-skill",
			roleId: diagnostic.roleId,
			detail: `references unknown skill "${diagnostic.skill}"`,
		});
	}

	return { registry, diagnostics };
}
