/**
 * `commands/chat/role-resolution.ts` (Gate 6, FR-1/FR-2, ADR 0004 §16 appendix). This module now
 * resolves against the REAL, file-backed Role Registry (role-resolution.ts's own header explains the
 * integration that landed here) -- these tests pin the WIRING contract (`resolveChatRole`'s
 * found/not-found shape, `describeUnknownChatRole`'s message, `toTaskRoleRegistryView`'s
 * `get`/`canSpawn` adapter) against the real 37-role catalog.
 */

import { describe, expect, it } from "vitest";
import {
	describeUnknownChatRole,
	loadRealRoleRegistry,
	ROOT_CALLER_ROLE_ID,
	resolveChatRole,
	toTaskRoleRegistryView,
} from "../../../src/commands/chat/role-resolution.ts";

describe("resolveChatRole", () => {
	it("resolves a known, real built-in role by exact name", () => {
		const result = resolveChatRole("backend-engineer");
		expect(result.status).toBe("found");
		if (result.status === "found") {
			expect(result.role.name).toBe("backend-engineer");
			expect(result.role.systemPrompt.length).toBeGreaterThan(0);
			// KNOWN GAP, documented not invented (role-catalog.ts's own header, Gap 2 of Gate 6's
			// real-wiring loop-back): no built-in role declares a tools allowlist yet, so every real
			// role's own ceiling is the empty array today -- `chat.ts` refuses to open a session for
			// this role BECAUSE of this, rather than silently starting one with zero usable tools. This
			// assertion is a deliberate tripwire: it should go RED the day a follow-up ADR lands real
			// per-role tools data, forcing this test (and chat.ts's own refusal) to be revisited.
			expect(result.role.tools).toEqual([]);
		}
	});

	it("returns not-found (never a silent fallback role) for an unknown id", () => {
		const result = resolveChatRole("role-that-does-not-exist");
		expect(result).toEqual({ status: "not-found", roleId: "role-that-does-not-exist" });
	});

	it("is case-sensitive -- a near-miss casing is still not-found, never silently normalized", () => {
		const result = resolveChatRole("Backend-Engineer");
		expect(result.status).toBe("not-found");
	});
});

describe("describeUnknownChatRole", () => {
	it("names the exact unknown role id in the message (FR-2)", () => {
		expect(describeUnknownChatRole("role-that-does-not-exist")).toContain('"role-that-does-not-exist"');
	});

	it("lists real known roles so the fix is obvious without a separate lookup", () => {
		const message = describeUnknownChatRole("bogus");
		expect(message).toContain("backend-engineer");
	});
});

describe("toTaskRoleRegistryView -- adapting the real registry for task's authorization checks", () => {
	it("get() returns the real role's own tools/canSpawn/modelRole, or undefined for an unknown id", () => {
		const registry = loadRealRoleRegistry();
		const view = toTaskRoleRegistryView(registry);

		const techLead = view.get("tech-lead");
		expect(techLead).toBeDefined();
		expect(techLead?.canSpawn).toContain("software-engineer");
		expect(view.get("role-that-does-not-exist")).toBeUndefined();
	});

	it("canSpawn() follows the real, ported roles.py graph for a real, constrained role", () => {
		const registry = loadRealRoleRegistry();
		const view = toTaskRoleRegistryView(registry);

		// tech-lead's real canSpawn includes software-engineer but not, say, ciso (roles.py's own
		// graph, transcribed verbatim in builtin-roles-data.ts).
		expect(view.canSpawn("tech-lead", "software-engineer")).toBe(true);
		expect(view.canSpawn("tech-lead", "ciso")).toBe(false);
		// business-analyst is a real leaf role (spawns: []) -- it can delegate to nobody.
		expect(view.canSpawn("business-analyst", "sdet")).toBe(false);
	});

	it("ROOT_CALLER_ROLE_ID may delegate to any REGISTERED role, but never to an unregistered name", () => {
		const registry = loadRealRoleRegistry();
		const view = toTaskRoleRegistryView(registry);

		expect(view.canSpawn(ROOT_CALLER_ROLE_ID, "business-analyst")).toBe(true);
		expect(view.canSpawn(ROOT_CALLER_ROLE_ID, "site-reliability-engineer")).toBe(true);
		expect(view.canSpawn(ROOT_CALLER_ROLE_ID, "role-that-does-not-exist")).toBe(false);
	});
});
