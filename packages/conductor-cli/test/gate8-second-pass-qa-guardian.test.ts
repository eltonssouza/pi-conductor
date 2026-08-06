/**
 * INDEPENDENT Gate 8 re-verification (qa-guardian, second pass) of commit 2f3dcf31d ("gate 6
 * (loop-back de gate 8): fiacao real do composition root"). This file is deliberately NOT a copy of
 * `commands/chat/policy-resolution.test.ts` or `conductor-runtime/test/session-policy-wiring.test.ts`
 * -- different scratch project, different allowlist pattern/command, and it adds two checks neither
 * existing suite performs: (a) reading `.conductor/audit.jsonl` back off disk after a real decision
 * (both allow and deny), and (b) forcing a real audit-trail write failure and confirming the
 * operation it would have audited is DENIED, not silently allowed. Written from scratch by the
 * orchestrator's independent QA pass -- not trusting the implementer's report.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PolicyDocument } from "@conductor/config";
import { createConductorSession, defaultProtectedPaths, evaluateToolPath } from "@conductor/runtime";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { resolveEffectivePolicy } from "../src/commands/chat/policy-resolution.ts";
import { registerFakeModel } from "./support/fake-model.ts";
import { createCapturingIo } from "./support/io.ts";
import { createScratchProject, type ScratchProject } from "./support/scratch.ts";

function createFakeUiContext(confirmResult: boolean): ExtensionUIContext & { confirmCalls: unknown[] } {
	const confirmCalls: unknown[] = [];
	const partial = {
		confirmCalls,
		select: async () => undefined,
		confirm: async () => {
			confirmCalls.push({});
			return confirmResult;
		},
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
	};
	return partial as unknown as ExtensionUIContext & { confirmCalls: unknown[] };
}

let project: ScratchProject;

beforeEach(() => {
	project = createScratchProject("qa-guardian-gate8-");
});

afterEach(() => {
	project.cleanup();
});

function writePolicyDocument(doc: PolicyDocument): string {
	const raw = JSON.stringify(doc);
	project.write(join(".conductor", "policy.json"), raw);
	return createHash("sha256").update(raw, "utf8").digest("hex");
}

function writeTrustStore(entries: Array<{ kind: "project" | "user-global"; contentHash: string }>): void {
	project.writeJson(join(".conductor", "policy-trust.json"), {
		schema: 1,
		trusted: entries.map((e) => ({ ...e, grantedAt: new Date().toISOString() })),
	});
}

async function openSessionWithBashCall(command: string, extra: { policy?: ReturnType<typeof resolveEffectivePolicy> }) {
	const agentDir = join(project.root, ".conductor");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		allowModelNetwork: false,
	});
	const fakeModel = registerFakeModel(modelRuntime, "qa-guardian-fake", [
		{ toolCalls: [{ name: "bash", args: { command } }] },
		{ text: "done" },
	]);
	const decisions: Array<{ toolName: string; allowed: boolean; reason?: string }> = [];
	const conductorSession = await createConductorSession({
		workspaceRoot: project.root,
		model: fakeModel.model,
		modelRuntime,
		agentDir,
		onDecision: (d) => decisions.push(d),
		...extra,
	});
	const ui = createFakeUiContext(true);
	await conductorSession.session.bindExtensions({ uiContext: ui, mode: "print" });
	await conductorSession.session.prompt("do it");
	return { conductorSession, decisions, ui };
}

function readAuditLines(): Array<Record<string, unknown>> {
	const raw = readFileSync(join(project.root, ".conductor", "audit.jsonl"), "utf-8");
	return raw
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

describe("ITEM 1 -- FR-3: real policy.json + real policy-trust.json auto-approves a real bash call, no confirm()", () => {
	it("a fresh scratch project with a genuine on-disk allowlist grant, loaded via resolveEffectivePolicy, approves the matching command without ctx.ui.confirm()", async () => {
		const ALLOWED_COMMAND = "echo qa-guardian-independent-check-42";
		const contentHash = writePolicyDocument({
			schema: 1,
			allowlist: [{ pattern: ALLOWED_COMMAND, risk: "low" }],
		});
		writeTrustStore([{ kind: "project", contentHash }]);

		// Sanity: prove the trust store file really is what we think it is, read back off disk.
		const trustRaw = project.readJson<{ schema: number; trusted: Array<{ contentHash: string }> }>(
			join(".conductor", "policy-trust.json"),
		);
		expect(trustRaw.trusted[0]?.contentHash).toBe(contentHash);

		const policy = resolveEffectivePolicy(project.root);
		expect(policy.allowlist).toEqual([{ pattern: ALLOWED_COMMAND, risk: "low" }]);

		const { decisions, ui, conductorSession } = await openSessionWithBashCall(ALLOWED_COMMAND, { policy });

		expect(ui.confirmCalls).toHaveLength(0);
		expect(decisions.find((d) => d.toolName === "bash")).toMatchObject({ toolName: "bash", allowed: true });

		conductorSession.dispose();
	});

	it("negative control: the SAME on-disk grant, for a DIFFERENT command, still requires confirm() -- the allowlist is not a blanket bypass", async () => {
		const contentHash = writePolicyDocument({
			schema: 1,
			allowlist: [{ pattern: "echo qa-guardian-independent-check-42", risk: "low" }],
		});
		writeTrustStore([{ kind: "project", contentHash }]);
		const policy = resolveEffectivePolicy(project.root);

		const { decisions, ui, conductorSession } = await openSessionWithBashCall("echo something-else-entirely", {
			policy,
		});

		expect(ui.confirmCalls.length).toBeGreaterThan(0);
		expect(decisions.find((d) => d.toolName === "bash")).toMatchObject({ toolName: "bash", allowed: true }); // approved via confirm(true)
		conductorSession.dispose();
	});
});

describe("ITEM 2 -- FR-16/17/18: audit trail is really written to disk for both allow and deny, and a write failure denies the operation", () => {
	it("FR-16 (allow case): a real audit.jsonl entry is readable off disk after an approved allowlisted bash call", async () => {
		const ALLOWED_COMMAND = "echo qa-guardian-audit-allow-case";
		const contentHash = writePolicyDocument({ schema: 1, allowlist: [{ pattern: ALLOWED_COMMAND, risk: "low" }] });
		writeTrustStore([{ kind: "project", contentHash }]);
		const policy = resolveEffectivePolicy(project.root);

		const { conductorSession } = await openSessionWithBashCall(ALLOWED_COMMAND, { policy });
		conductorSession.dispose();

		const lines = readAuditLines();
		const entry = lines.find((l) => l.toolName === "bash");
		expect(entry).toBeTruthy();
		expect(entry).toMatchObject({
			toolName: "bash",
			decision: "allow",
			approvalMethod: "allowlist",
			permissionLevel: "exec",
			riskTier: "low",
		});
		expect(typeof entry?.timestamp).toBe("string");
		expect(new Date(entry?.timestamp as string).toISOString()).toBe(entry?.timestamp);
	});

	it("FR-16/FR-2 (deny case): a critical command is denied AND leaves its own real audit.jsonl entry", async () => {
		const { conductorSession, decisions } = await openSessionWithBashCall("rm -rf /", {});
		conductorSession.dispose();

		expect(decisions.find((d) => d.toolName === "bash")?.allowed).toBe(false);

		const lines = readAuditLines();
		const entry = lines.find((l) => l.toolName === "bash");
		expect(entry).toBeTruthy();
		expect(entry).toMatchObject({ toolName: "bash", decision: "deny", riskTier: "critical" });
	});

	it("FR-17: .conductor/audit.jsonl is itself a protected path -- write/edit/bash cannot reach it", () => {
		// Force the file to exist first so evaluateToolPath's real-path resolution has something concrete
		// to canonicalize (mirrors the file existing after any prior decision has been recorded).
		mkdirSync(join(project.root, ".conductor"), { recursive: true });
		project.write(join(".conductor", "audit.jsonl"), "");

		const auditPath = join(project.root, ".conductor", "audit.jsonl");
		const check = evaluateToolPath(auditPath, { workspaceRoot: project.root });
		expect(check.allowed).toBe(false);
		expect(check.reason).toContain("protected location");

		// Cross-check against the exported defaultProtectedPaths() list directly, not just the outcome.
		expect(defaultProtectedPaths(project.root)).toContain(auditPath);
	});

	it("FR-18: when the audit trail write itself fails (audit.jsonl path is blocked by a directory), the operation it would have audited is DENIED, not silently allowed", async () => {
		// Sabotage: put a DIRECTORY exactly where audit.jsonl needs to be a file. appendFileSync onto a
		// directory path throws (EISDIR / EPERM depending on OS) -- appendAuditEntry must propagate that
		// throw, and evaluatePolicyFailClosed must turn the whole decision into a deny.
		mkdirSync(join(project.root, ".conductor"), { recursive: true });
		mkdirSync(join(project.root, ".conductor", "audit.jsonl"), { recursive: true });

		// Use a command that would otherwise be an uncontested ALLOW (a real, trusted allowlist grant) so
		// a deny here can only be explained by the audit-write failure, not by any other policy branch.
		const ALLOWED_COMMAND = "echo qa-guardian-fail-closed-audit-check";
		const contentHash = writePolicyDocument({ schema: 1, allowlist: [{ pattern: ALLOWED_COMMAND, risk: "low" }] });
		writeTrustStore([{ kind: "project", contentHash }]);
		const policy = resolveEffectivePolicy(project.root);

		const { decisions, conductorSession } = await openSessionWithBashCall(ALLOWED_COMMAND, { policy });
		conductorSession.dispose();

		const bashDecision = decisions.find((d) => d.toolName === "bash");
		expect(bashDecision?.allowed).toBe(false); // fail-closed: audit write failure denies the operation
	});
});

describe("ITEM 3 -- FR-19/20/21: --yes really flows from real argv (runCli, the exact function bin/conductor.js calls), not from options constructed by hand", () => {
	it("runCli(['chat', '--yes', '--bogus']) -- driven exactly like bin/conductor.js drives it -- strips --yes and reports ONLY '--bogus' as unrecognized: proves --yes was actually consumed by parseResumeArgs's real-argv path, not left over or misparsed", async () => {
		await runCli(["init"], createCapturingIo(project.root).io);
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["chat", "--yes", "--bogus"], io);

		expect(code).not.toBe(0);
		const message = stderr();
		// The static usage suffix always mentions "[--yes]" -- that is NOT what's being checked here.
		// What matters is the reported unrecognized-argument LIST itself: it must name only "--bogus".
		expect(message).toMatch(/unrecognized argument\(s\): --bogus\b/);
		expect(message).not.toMatch(/unrecognized argument\(s\):[^.]*--yes/); // --yes must never appear IN the unrecognized-argument list
	});

	it("runCli(['chat', '--bogus', '--yes']) -- --yes in the OTHER position around the bad flag -- same result, proving position does not matter (mirrors parseResumeArgs's own documented contract)", async () => {
		await runCli(["init"], createCapturingIo(project.root).io);
		const { io, stderr } = createCapturingIo(project.root);

		const code = await runCli(["chat", "--bogus", "--yes"], io);

		expect(code).not.toBe(0);
		const message = stderr();
		expect(message).toMatch(/unrecognized argument\(s\): --bogus\b/);
		expect(message).not.toMatch(/unrecognized argument\(s\):[^.]*--yes/);
	});
});

describe("ITEM 4 -- R11(b): policy-trust.json is protected under its REAL filename (read from policy-trust-store.ts's own contract, not assumed)", () => {
	it("defaultProtectedPaths(workspaceRoot) includes exactly '.conductor/policy-trust.json' -- the filename policy-resolution.ts's resolveConductorPolicyTrustStorePath also targets", () => {
		const expected = join(project.root, ".conductor", "policy-trust.json");
		expect(defaultProtectedPaths(project.root)).toContain(expected);
	});

	it("a write/edit call targeting policy-trust.json is denied before any approval prompt, even for a not-yet-existing file", () => {
		const target = join(project.root, ".conductor", "policy-trust.json");
		const check = evaluateToolPath(target, { workspaceRoot: project.root });
		expect(check.allowed).toBe(false);
	});
});
