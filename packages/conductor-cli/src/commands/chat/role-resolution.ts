/**
 * `conductor chat --role <slug>` resolution AND the real, file-backed Role Registry `conductor chat`
 * needs to wire `task` delegation for real (Gate 6 real-wiring loop-back; gate2-spec-fase3.md
 * FR-1/FR-2/Grupo D; ADR 0004 §12/§16 appendix). ADR 0004 §12's packaging table names this file as
 * exactly the seam that "compõe load+trust+validate+containment" -- mirrors how
 * `commands/chat/policy-resolution.ts` composes `@conductor/config`'s policy primitives for the
 * top-level session without `@conductor/runtime` ever importing `@conductor/config` itself (ADR 0002
 * §3.1 / ADR 0004 §12: "config ⊥ runtime" preserved via the structural `RoleRegistryView`/
 * `ConductorRoleView` interfaces `@conductor/runtime`'s own `tools/task.ts` already defines).
 *
 * ============================================================================================
 * INTEGRATION LANDED (this file used to ship an explicit `PLACEHOLDER_ROLES` catalog -- see git
 * history). The parallel Gate 6 stream that ported the real 37-role catalog
 * (`@conductor/config/src/{role-loader,role-trust-store,delegation-graph,builtin-roles-data}.ts`,
 * `@conductor/cli/src/commands/role-catalog.ts`) has landed, so this module now loads the REAL,
 * file-backed Role Registry instead of a hardcoded stand-in. This closes two gaps the orchestrator
 * found when checking the actual product, not just isolated unit tests:
 *
 *   1. GAP 1 -- `chat.ts`'s own call to `createConductorSession` never passed `taskDelegation`, so
 *      `task` was implemented and unit-tested (`@conductor/runtime`'s `tools/task.test.ts`,
 *      `test/tools/task-registration.acceptance.test.ts`) but never actually reachable by running
 *      `conductor chat` for real. `loadRealRoleRegistry`/`toTaskRoleRegistryView` below are what
 *      `chat.ts` now uses to build a REAL `RoleRegistryView` -- backed by the same 37 roles' real,
 *      ported `canSpawn` graph -- for that option.
 *   2. GAP 2 -- NONE of the 37 real built-in roles declare a `tools` allowlist yet
 *      (`role-catalog.ts`'s own header explains why: the data does not exist anywhere in
 *      `roles.py`, and inventing one here would be exactly the kind of silent, security-relevant
 *      reconciliation this phase's own instructions forbid). Before this change, `--role <slug>`
 *      resolved against a small hand-written placeholder catalog that DID declare non-empty tools
 *      for its two entries, so the empty-tools case never actually surfaced through the real CLI.
 *      Now that `--role` resolves against the real registry, EVERY real role hits it. `chat.ts`
 *      refuses `--role <slug>` outright when the resolved role's `tools` is empty, instead of
 *      silently opening a session with zero usable tools (not even `read`) -- see `chat.ts`'s own
 *      `prepareChat` for the refusal and its message.
 * ============================================================================================
 *
 * `ROOT_CALLER_ROLE_ID` (below): when `conductor chat` runs WITHOUT `--role`, the session keeps the
 * round A/B1 default, unrestricted tool set (`read`/`write`/`edit`/`bash`) -- there is no
 * `ConductorRole` entry in the 37-role catalog for "the human operator's own top-level session"
 * (every one of the 37 is a business role: `product-manager`, `backend-engineer`, ...). `chat.ts`
 * still has to give `task`'s `callerRole` SOME identity in that case, and `toTaskRoleRegistryView`'s
 * own `canSpawn` treats this sentinel specially: it may delegate to ANY role the registry actually
 * knows about, never gated by a role-by-role `canSpawn` allowlist. This is a grounded decision, not
 * an ad hoc convenience: a session that already holds unrestricted `bash`/`write`/`edit` (i.e.,
 * strictly more raw, DIRECT authority than any of the 37 roles' own -- currently empty -- tool
 * ceilings could ever grant it) gains no real protection from a SECOND, narrower gate on which roles
 * it may hand a sub-task to; layering that restriction on top would tighten a cosmetic slice of
 * authority while the actually-broader, already-open direct tool access sits right next to it,
 * completely unrestricted -- exactly the anti-pattern "Secure and Reliable Systems Design" §3.12
 * ("When not to tighten least privilege further", cdt library --gate 6 this session, top score
 * 0.593) names: effort spent measuring/tightening a privilege that is not the one actually reachable.
 * The mainline of the same chapter (§3.1/§3.3, "least privilege and blast-radius control", the same
 * sections `role-catalog.ts`'s own header already cites) is exactly why the 37 REAL, non-root roles
 * still get a real, per-role `canSpawn` check below -- a constrained role (anything other than the
 * trusted top-level operator) is precisely the case where reachable authority DOES need to be
 * enumerated and bounded.
 */

import { type ConductorRole, type RoleRegistry, resolveRole } from "@conductor/config";
import type { RoleRegistryView } from "@conductor/runtime";
import { loadBuiltinRoleCatalog } from "../role-catalog.ts";
import { type BuiltinSkillCatalog, defaultProjectSkillsDir, loadBuiltinSkillCatalog } from "../skill-catalog.ts";

/** Mirrors `@conductor/config`'s real `ConductorRole` -- kept as a distinct alias (not a bare
 * re-export) so this module's own callers (`chat.ts`) only ever need to know this file's name for
 * the shape `--role` resolves to. */
export type ChatRole = ConductorRole;

export type ResolveChatRoleResult =
	| { status: "found"; role: ChatRole }
	| { status: "not-found"; roleId: string; suggestion?: string };

/**
 * Sentinel `callerRole` identity for a `conductor chat` session opened WITHOUT `--role` -- see this
 * file's own header for the grounded reasoning. Deliberately NOT a slug shape any of the 37 built-in
 * roles could ever collide with (double-underscore-wrapped, unlike every real role's plain
 * kebab-case name) -- `registry.roles.has(ROOT_CALLER_ROLE_ID)` must always be `false`.
 */
export const ROOT_CALLER_ROLE_ID = "__conductor_chat_root__";

export interface LoadRealRoleRegistryOptions {
	/** The invoking `conductor chat`'s own cwd -- used to also pick up a project's own
	 * `.conductor/skills/` (mirrors `commands/roles.ts`'s identical convention), and overridable for
	 * tests the same way `role-catalog.ts`/`skill-catalog.ts` already allow. */
	cwd?: string;
	agentsDir?: string;
	skillsDir?: string;
}

export interface RealRoleRegistryAndSkills {
	registry: RoleRegistry;
	/**
	 * Gate 8 loop-back (G3/FR-5/FR-6): the SAME already-vetted (`filterSkillsWithinRoots`/R20)
	 * catalog used to compute `knownSkills` below -- `chat.ts` reuses this to build
	 * `createConductorSession`'s `additionalSkillPaths` instead of scanning the skill directories a
	 * second time.
	 */
	skillCatalog: BuiltinSkillCatalog;
}

/**
 * Loads the REAL, file-backed Role Registry (the same 37-role catalog `conductor roles list`
 * shows) AND the real, contained skill catalog (the same 44-skill catalog `conductor skills list`
 * shows) in a single scan -- `chat.ts`'s own `prepareChat` calls this exactly ONCE per invocation
 * and reuses the result for `--role` resolution, `task`'s `RoleRegistryView`, AND
 * `createConductorSession`'s `additionalSkillPaths` (Gate 8 loop-back closing G3/FR-5/FR-6), rather
 * than re-parsing every `templates/agents/<slug>.md` / `templates/skills/<name>/SKILL.md` file
 * multiple times per `conductor chat` run.
 */
export function loadRealRoleRegistryAndSkills(options: LoadRealRoleRegistryOptions = {}): RealRoleRegistryAndSkills {
	const skillCatalog = loadBuiltinSkillCatalog({
		builtinSkillsDir: options.skillsDir,
		projectSkillsDir: options.cwd ? defaultProjectSkillsDir(options.cwd) : undefined,
	});
	const knownSkills = new Set(skillCatalog.skills.map((skill) => skill.name));
	const { registry } = loadBuiltinRoleCatalog({ agentsDir: options.agentsDir, knownSkills });
	return { registry, skillCatalog };
}

/**
 * Convenience wrapper for callers that only need the registry (this module's own tests, and
 * `resolveChatRole`/`describeUnknownChatRole`'s own defaults below) -- `chat.ts`'s production path
 * uses `loadRealRoleRegistryAndSkills` directly so it never scans the skill directories twice.
 */
export function loadRealRoleRegistry(options: LoadRealRoleRegistryOptions = {}): RoleRegistry {
	return loadRealRoleRegistryAndSkills(options).registry;
}

/** FR-1/FR-2: resolves `roleId` against an already-loaded registry. An unknown id is never a generic
 * silent session -- it names the role that was not found so `chat.ts` can surface a clear CLI error
 * instead of starting an unrestricted session. Gate 8 fix: `@conductor/config`'s `resolveRole` already
 * computes a proximity `suggestion` (FR-2's own worked example: "backedn-engineer" -> suggest
 * "backend-engineer") and was tested in isolation (`role-loader.test.ts`), but this wrapper used to
 * discard it on the "not-found" branch, so the real CLI never surfaced it -- the exact
 * implemented-but-not-wired shape this Fase's own history (GAP 1/GAP 2/GAP-4) kept finding elsewhere.
 * Threaded through here instead of dropped. */
export function resolveChatRoleFromRegistry(registry: RoleRegistry, roleId: string): ResolveChatRoleResult {
	const result = resolveRole(registry, roleId);
	return result.status === "found"
		? { status: "found", role: result.role }
		: { status: "not-found", roleId: result.roleId, suggestion: result.suggestion };
}

/** Convenience wrapper that loads its own registry -- used by this module's own unit tests, which do
 * not need `chat.ts`'s single-load-per-invocation discipline (`loadRealRoleRegistry`'s own doc
 * comment). Production code (`chat.ts`) calls `loadRealRoleRegistry` once and
 * `resolveChatRoleFromRegistry` against that same result instead of this wrapper. */
export function resolveChatRole(roleId: string): ResolveChatRoleResult {
	return resolveChatRoleFromRegistry(loadRealRoleRegistry(), roleId);
}

/** `conductor chat --role`'s own error message for an unknown role id (FR-2: names the role, lists
 * what IS available so the fix is obvious without a separate `roles list` lookup, AND -- when the
 * registry has something close -- leads with a "Did you mean" hint naming it, per FR-2's own worked
 * example: "quando houver um nome próximo no registro (ex.: backend-engineer), sugere-o"). Accepts an
 * already-loaded `registry` so `chat.ts` never has to load a second one just to build this message. */
export function describeUnknownChatRole(
	roleId: string,
	registry: RoleRegistry = loadRealRoleRegistry(),
	suggestion?: string,
): string {
	const known = Array.from(registry.roles.keys()).sort().join(", ");
	const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
	return `conductor chat: unknown role "${roleId}".${hint} Known roles: ${known || "(none)"}.`;
}

/**
 * Adapts a real `@conductor/config` `RoleRegistry` into the structural `RoleRegistryView`
 * `@conductor/runtime`'s `task` tool needs (`get`/`canSpawn`) -- `@conductor/runtime` deliberately
 * never imports `@conductor/config` (ADR 0004 §12: "config ⊥ runtime"), so this adapter is the one
 * place the two real catalogs meet, in `@conductor/cli`'s own composition root (`chat.ts`).
 */
export function toTaskRoleRegistryView(registry: RoleRegistry): RoleRegistryView {
	return {
		get(roleId: string) {
			const role = registry.roles.get(roleId);
			if (!role) return undefined;
			return { name: role.name, tools: role.tools, canSpawn: role.canSpawn, modelRole: role.modelRole };
		},
		canSpawn(from: string, to: string): boolean {
			if (from === ROOT_CALLER_ROLE_ID) {
				// The unrestricted top-level session (no --role) -- see this file's header for why this is
				// grounded rather than a convenience escape hatch. May delegate to any role the registry
				// actually knows about; never to an arbitrary/unregistered name (still a real check, not a
				// blanket `true`).
				return registry.roles.has(to);
			}
			const caller = registry.roles.get(from);
			return caller ? caller.canSpawn.includes(to) : false;
		},
	};
}
