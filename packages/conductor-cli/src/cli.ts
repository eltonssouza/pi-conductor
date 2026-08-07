/**
 * The `conductor` dispatcher (docs/adr/0002-fase1-cli-foundation.md §3.1 point 4, §7).
 *
 * CLI framework: a minimal hand-rolled `process.argv` dispatcher, matching this monorepo's own
 * convention rather than adding a new CLI-parsing dependency. packages/coding-agent's own `pi`
 * binary -- the closest and most authoritative precedent in this repo -- parses its (much larger)
 * argv surface with a hand-rolled `parseArgs()` (src/cli/args.ts), not a library, even though its
 * package.json already pulls in many other dependencies (chalk, minimatch, semver, yaml, ...); no
 * argument-parsing library (commander/yargs/citty/...) appears anywhere in this monorepo. For four
 * subcommands with a handful of flags each, a switch over argv is proportionate and consistent;
 * pulling in a parsing library here would be the one CLI in this monorepo that doesn't match its
 * sibling's own choice. (Library grounding: a fresh query this session -- "command-line interface
 * subcommand dispatch design: hand-rolled argument parsing vs a parsing library" -- returned only
 * generic tracer-code/interface-discovery material, top score 0.575, nothing CLI-specific; this
 * mirrors ADR 0002 §11's own honest finding that this project's library corpus does not cover
 * CLI-tool-specific design, so the decision is grounded in this repository's own established
 * convention instead, not forced onto a weak citation.)
 */

import { join } from "node:path";
import { TOTAL_FLOW_GATES, type ResolveEvidenceRefContext } from "@conductor/runtime";
import { runChat } from "./commands/chat.ts";
import { runConfigGet, runConfigSet, runConfigShow } from "./commands/config.ts";
import { doctorExitCode, formatDoctorReport, runDoctor } from "./commands/doctor.ts";
import {
	type EvidenceAttachment,
	type EvidenceRef,
	formatGateStatusReport,
	runGateApprove,
	runGateCalibrate,
	runGateEvidence,
	runGateReject,
	runGateStart,
	runGateStatus,
} from "./commands/gate.ts";
import { createPersistedGateStateStore, resolveGateGitContext } from "./commands/gate-store.ts";
import { describeInitOutcome, initExitCode, runInit } from "./commands/init.ts";
import { runLibraryCommand } from "./commands/library.ts";
import { formatRolesListReport, runRolesList } from "./commands/roles.ts";
import { formatSkillsListReport, runSkillsList } from "./commands/skills.ts";
import { gitCommitExistsSync } from "./git-status.ts";
import { resolveConfirmChannel, type TtyStreams } from "./tty-confirm.ts";

export interface CliWriter {
	write(chunk: string): void;
}

export interface CliIO {
	cwd: string;
	stdout: CliWriter;
	stderr: CliWriter;
	/**
	 * Real interactive TTY streams for `gate approve`/`gate calibrate`'s confirmation prompt (Gate 6,
	 * Fase 4 loop-back). Deliberately SEPARATE from `stdout`/`stderr` above (those are the minimal
	 * `CliWriter` capturing sink every other command already writes plain text through) — a `readline`
	 * prompt needs a real stream pair (`.isTTY`, `.on(...)`, `.write(...)`), a different, richer shape
	 * (`tty-confirm.ts`'s own `TtyStreams`). Optional and backward-compatible: every existing caller/test
	 * that never touches `gate approve`/`calibrate` keeps working unchanged; omitting it here means those
	 * two commands fall back to the headless, always-`false` channel (the fail-closed default is
	 * unaffected either way). Production wiring is `bin/conductor.js`, passing real
	 * `process.stdin`/`process.stdout`.
	 */
	tty?: TtyStreams;
}

const USAGE = `conductor -- Conductor CLI (Fase 1)

Usage:
  conductor init [--force]
  conductor doctor
  conductor config show
  conductor config get <key>
  conductor config set <key> <value>
  conductor chat
  conductor roles list
  conductor skills list
  conductor gate status  [--demand <id>]
  conductor gate start   <N> [--demand <id>]
  conductor gate evidence --gate <N> --kind <git-commit|file|journal-entry|test-run> --ref <sha|path|id>
                          [--note "..."] [--demand <id>]
  conductor gate approve [--gate <N>] [--demand <id>]
  conductor gate reject  --reason "..." [--gate <N>] [--demand <id>]
  conductor gate calibrate --collapse <N,M,...> [--demand <id>]
  conductor library status [--json]
  conductor library search "<question>" [--gate <N>] [--role <role>]
                          [--category <c>] [--tech <t>] [--version <v>]
                          [-k <N>] [--lexical-only] [--code-aware]
                          [--rerank cross-encoder] [--json]
  conductor library ingest
  conductor library update
  conductor --help

See docs/adr/0002-fase1-cli-foundation.md for the full command contract,
docs/adr/0004-fase3-roles-skills-subagents.md for roles/skills, and
docs/adr/0005-fase4-gate-state-machine.md for the gate state machine (gate * commands
run against the real, persisted, atomic, checksum-protected GateStateStore
(commands/gate-store.ts's createPersistedGateStateStore, under .conductor/gates/) --
state survives across separate CLI invocations, not just within one process).
`;

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Minimal `--flag value` parser shared by the `gate` subcommands (mirrors `runInitCommand`'s own
 * `args.includes("--force")` style, generalized to flags that take a value). Positional arguments
 * (e.g. `gate start <N>`) are returned separately from recognized/unrecognized flags. */
function parseFlags(
	args: string[],
	valueFlags: readonly string[],
): { positional: string[]; flags: Record<string, string>; unrecognized: string[] } {
	const positional: string[] = [];
	const flags: Record<string, string> = {};
	const unrecognized: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg?.startsWith("--")) {
			const name = arg.slice(2);
			if (!valueFlags.includes(name)) {
				unrecognized.push(arg);
				continue;
			}
			const value = args[i + 1];
			if (value === undefined) {
				unrecognized.push(arg); // dangling flag with no value -- refused, never silently "" (fail-closed)
				continue;
			}
			flags[name] = value;
			i++;
		} else if (arg !== undefined) {
			positional.push(arg);
		}
	}

	return { positional, flags, unrecognized };
}

function parseGateNumber(raw: string | undefined, label: string): number | { error: string } {
	if (raw === undefined) return { error: `${label}: a gate number is required` };
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > TOTAL_FLOW_GATES) {
		return { error: `${label}: "${raw}" is not a valid gate number (expected an integer 1-${TOTAL_FLOW_GATES})` };
	}
	return n;
}

const EVIDENCE_KINDS = ["git-commit", "file", "journal-entry", "test-run"] as const;

function parseEvidenceRef(kind: string | undefined, ref: string | undefined): EvidenceRef | { error: string } {
	if (!ref) return { error: "conductor gate evidence: --ref is required (a bare --note is not evidence, FR-5)" };
	switch (kind) {
		case "git-commit":
			return { kind: "git-commit", sha: ref };
		case "file":
			return { kind: "file", path: ref };
		case "journal-entry":
			return { kind: "journal-entry", id: ref };
		case "test-run":
			return { kind: "test-run", id: ref };
		default:
			return {
				error: `conductor gate evidence: --kind must be one of ${EVIDENCE_KINDS.join(", ")} (got "${kind ?? ""}")`,
			};
	}
}

async function runInitCommand(args: string[], io: CliIO): Promise<number> {
	const force = args.includes("--force");
	const unknown = args.filter((a) => a !== "--force");
	if (unknown.length > 0) {
		io.stderr.write(`conductor init: unrecognized argument(s): ${unknown.join(" ")}\n`);
		return 1;
	}

	const outcome = await runInit({ cwd: io.cwd, force });
	const message = describeInitOutcome(outcome);
	const code = initExitCode(outcome);
	(code === 0 ? io.stdout : io.stderr).write(message);
	return code;
}

async function runDoctorCommand(args: string[], io: CliIO): Promise<number> {
	if (args.length > 0) {
		io.stderr.write(`conductor doctor: unrecognized argument(s): ${args.join(" ")}\n`);
		return 1;
	}
	const report = await runDoctor({ cwd: io.cwd });
	io.stdout.write(formatDoctorReport(report));
	return doctorExitCode(report);
}

async function runConfigCommand(args: string[], io: CliIO): Promise<number> {
	const [sub, ...rest] = args;

	if (sub === "show") {
		if (rest.length > 0) {
			io.stderr.write(`conductor config show: unrecognized argument(s): ${rest.join(" ")}\n`);
			return 1;
		}
		const result = await runConfigShow({ cwd: io.cwd });
		if (!result.ok) {
			io.stderr.write(`conductor config show: ${result.reason}\n`);
			return 1;
		}
		io.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
		return 0;
	}

	if (sub === "get") {
		const [key, ...extra] = rest;
		if (!key || extra.length > 0) {
			io.stderr.write("conductor config get: usage: conductor config get <key>\n");
			return 1;
		}
		const result = await runConfigGet({ cwd: io.cwd, key });
		if (!result.ok) {
			io.stderr.write(`conductor config get: ${result.reason}\n`);
			return 1;
		}
		io.stdout.write(`${typeof result.value === "string" ? result.value : JSON.stringify(result.value)}\n`);
		return 0;
	}

	if (sub === "set") {
		const [key, value, ...extra] = rest;
		if (!key || value === undefined || extra.length > 0) {
			io.stderr.write("conductor config set: usage: conductor config set <key> <value>\n");
			return 1;
		}
		const result = await runConfigSet({ cwd: io.cwd, key, rawValue: value });
		if (!result.ok) {
			io.stderr.write(`conductor config set: ${result.reason}\n`);
			return 1;
		}
		io.stdout.write(
			`Set ${key} (${result.configPath}).${result.backupPath ? ` Previous file backed up to ${result.backupPath}.` : ""}\n`,
		);
		return 0;
	}

	io.stderr.write(
		`conductor config: unknown subcommand "${sub ?? ""}". Usage: show | get <key> | set <key> <value>\n`,
	);
	return 1;
}

async function runRolesCommand(args: string[], io: CliIO): Promise<number> {
	const [sub, ...rest] = args;

	if (sub === "list") {
		if (rest.length > 0) {
			io.stderr.write(`conductor roles list: unrecognized argument(s): ${rest.join(" ")}\n`);
			return 1;
		}
		try {
			const report = await runRolesList({ cwd: io.cwd });
			io.stdout.write(formatRolesListReport(report));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor roles list: ${describeError(error)}\n`);
			return 1;
		}
	}

	io.stderr.write(`conductor roles: unknown subcommand "${sub ?? ""}". Usage: list\n`);
	return 1;
}

async function runSkillsCommand(args: string[], io: CliIO): Promise<number> {
	const [sub, ...rest] = args;

	if (sub === "list") {
		if (rest.length > 0) {
			io.stderr.write(`conductor skills list: unrecognized argument(s): ${rest.join(" ")}\n`);
			return 1;
		}
		try {
			const report = await runSkillsList({ cwd: io.cwd });
			io.stdout.write(formatSkillsListReport(report));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor skills list: ${describeError(error)}\n`);
			return 1;
		}
	}

	io.stderr.write(`conductor skills: unknown subcommand "${sub ?? ""}". Usage: list\n`);
	return 1;
}

const DEFAULT_DEMAND_ID = "default";

/**
 * `conductor gate *` (Gate 6, Fase 4 "Gates e evidências"). Argument parsing/shape validation here is
 * ordinary CLI plumbing (mirrors `runRolesCommand`/`runConfigCommand`'s own style). Every subcommand's
 * substantive behavior is delegated to `commands/gate.ts`'s `run*` functions. `store` is the REAL,
 * persisted `GateStateStoreView` (`commands/gate-store.ts`'s `createPersistedGateStateStore`, backed by
 * `@conductor/runtime`'s `createGateStateStore` under `.conductor/gates/<cwd>`) -- constructed fresh on
 * every `conductor gate ...` invocation (a new OS process each time in real use), but the ON-DISK
 * envelope is what carries state between invocations, not this in-memory object (Gate 6 wiring
 * closure: the former `createInMemoryGateStateStore` lost everything once the process exited, which is
 * not what Fase 4 promises).
 *
 * `evidenceContext` is `gate evidence`'s own `resolveEvidenceRef` collaborator bundle (R25/T41,
 * `commands/gate.ts`'s `runGateEvidence`): `repoRoot`/`workspaceRoot` are `io.cwd` (this CLI's own
 * established convention -- no upward `.git` walk, same as `init.ts`/`doctor.ts`); `gitCommitExists` is
 * the real `git rev-parse --verify` check (`git-status.ts`); the two runtime-recorded id sets are
 * HONESTLY EMPTY -- no durable test-run/journal-entry ledger exists yet in this codebase (Fase 6 scope,
 * per `gate-evidence.ts`'s own header), so `--kind test-run`/`--kind journal-entry` refs correctly
 * refuse fail-closed today rather than pretending to have observed an id nothing actually recorded.
 */
async function runGateCommand(args: string[], io: CliIO): Promise<number> {
	const [sub, ...rest] = args;
	const gitContext = await resolveGateGitContext(io.cwd);
	const store = createPersistedGateStateStore({
		gatesDir: join(io.cwd, ".conductor", "gates"),
		repoId: gitContext.repoId,
		branch: gitContext.branch,
	});
	const evidenceContext: ResolveEvidenceRefContext = {
		repoRoot: io.cwd,
		workspaceRoot: io.cwd,
		gitCommitExists: gitCommitExistsSync,
		runtimeRecordedTestRunIds: new Set(),
		runtimeRecordedJournalEntryIds: new Set(),
	};

	if (sub === "status") {
		const { positional, flags, unrecognized } = parseFlags(rest, ["demand"]);
		if (positional.length > 0 || unrecognized.length > 0) {
			io.stderr.write(
				`conductor gate status: unrecognized argument(s): ${[...positional, ...unrecognized].join(" ")}\n`,
			);
			return 1;
		}
		try {
			const snapshot = runGateStatus({ cwd: io.cwd, demandId: flags.demand ?? DEFAULT_DEMAND_ID, store });
			io.stdout.write(formatGateStatusReport(snapshot));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor gate status: ${describeError(error)}\n`);
			return 1;
		}
	}

	if (sub === "start") {
		const { positional, flags, unrecognized } = parseFlags(rest, ["demand"]);
		if (unrecognized.length > 0) {
			io.stderr.write(`conductor gate start: unrecognized argument(s): ${unrecognized.join(" ")}\n`);
			return 1;
		}
		if (positional.length > 1) {
			io.stderr.write(`conductor gate start: unrecognized argument(s): ${positional.slice(1).join(" ")}\n`);
			return 1;
		}
		const gate = parseGateNumber(positional[0], "conductor gate start");
		if (typeof gate !== "number") {
			io.stderr.write(`${gate.error}\n`);
			return 1;
		}
		try {
			const snapshot = runGateStart({ cwd: io.cwd, demandId: flags.demand ?? DEFAULT_DEMAND_ID, store, gate });
			io.stdout.write(formatGateStatusReport(snapshot));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor gate start: ${describeError(error)}\n`);
			return 1;
		}
	}

	if (sub === "evidence") {
		const { positional, flags, unrecognized } = parseFlags(rest, ["demand", "gate", "kind", "ref", "note"]);
		if (positional.length > 0 || unrecognized.length > 0) {
			io.stderr.write(
				`conductor gate evidence: unrecognized argument(s): ${[...positional, ...unrecognized].join(" ")}\n`,
			);
			return 1;
		}
		const gate = parseGateNumber(flags.gate, "conductor gate evidence: --gate");
		if (typeof gate !== "number") {
			io.stderr.write(`${gate.error}\n`);
			return 1;
		}
		const ref = parseEvidenceRef(flags.kind, flags.ref);
		if ("error" in ref) {
			io.stderr.write(`${ref.error}\n`);
			return 1;
		}
		try {
			// `provenance` here is a placeholder -- runGateEvidence never trusts it; resolveEvidenceRef
			// (via evidenceContext) determines the REAL provenance, fail-closed if the ref does not resolve.
			const attachment: EvidenceAttachment = { ref, provenance: "author-declared", note: flags.note };
			const snapshot = runGateEvidence({
				cwd: io.cwd,
				demandId: flags.demand ?? DEFAULT_DEMAND_ID,
				store,
				gate,
				attachment,
				evidenceContext,
			});
			io.stdout.write(formatGateStatusReport(snapshot));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor gate evidence: ${describeError(error)}\n`);
			return 1;
		}
	}

	if (sub === "approve") {
		const { positional, flags, unrecognized } = parseFlags(rest, ["demand", "gate"]);
		if (positional.length > 0 || unrecognized.length > 0) {
			io.stderr.write(
				`conductor gate approve: unrecognized argument(s): ${[...positional, ...unrecognized].join(" ")}\n`,
			);
			return 1;
		}
		const gateArg =
			flags.gate === undefined ? undefined : parseGateNumber(flags.gate, "conductor gate approve: --gate");
		if (gateArg !== undefined && typeof gateArg !== "number") {
			io.stderr.write(`${gateArg.error}\n`);
			return 1;
		}
		try {
			// gate is resolved from currentGate by runGateApprove when --gate is omitted (Gate 6); 0 is
			// never a valid gate number and is used here only as an explicit "unset" sentinel the stub
			// signature still requires today.
			const snapshot = await runGateApprove({
				cwd: io.cwd,
				demandId: flags.demand ?? DEFAULT_DEMAND_ID,
				store,
				gate: gateArg ?? 0,
				// Gate 6 loop-back: a real TTY on both stdin+stdout (io.tty, production: bin/conductor.js's
				// process.stdin/process.stdout) gets a genuine interactive y/n prompt; anything else
				// (io.tty omitted, piped/redirected streams, CI, the autonomous loop) stays on the
				// headless, always-false channel -- never a second way to fabricate "human".
				confirm: resolveConfirmChannel(io.tty),
				source: "cli:gate-approve",
			});
			io.stdout.write(formatGateStatusReport(snapshot));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor gate approve: ${describeError(error)}\n`);
			return 1;
		}
	}

	if (sub === "reject") {
		const { positional, flags, unrecognized } = parseFlags(rest, ["demand", "gate", "reason"]);
		if (positional.length > 0 || unrecognized.length > 0) {
			io.stderr.write(
				`conductor gate reject: unrecognized argument(s): ${[...positional, ...unrecognized].join(" ")}\n`,
			);
			return 1;
		}
		if (!flags.reason) {
			io.stderr.write('conductor gate reject: usage: conductor gate reject --reason "..." [--gate <N>]\n');
			return 1;
		}
		const gateArg =
			flags.gate === undefined ? undefined : parseGateNumber(flags.gate, "conductor gate reject: --gate");
		if (gateArg !== undefined && typeof gateArg !== "number") {
			io.stderr.write(`${gateArg.error}\n`);
			return 1;
		}
		try {
			const snapshot = runGateReject({
				cwd: io.cwd,
				demandId: flags.demand ?? DEFAULT_DEMAND_ID,
				store,
				gate: gateArg ?? 0,
				reason: flags.reason,
			});
			io.stdout.write(formatGateStatusReport(snapshot));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor gate reject: ${describeError(error)}\n`);
			return 1;
		}
	}

	if (sub === "calibrate") {
		const { positional, flags, unrecognized } = parseFlags(rest, ["demand", "collapse"]);
		if (positional.length > 0 || unrecognized.length > 0) {
			io.stderr.write(
				`conductor gate calibrate: unrecognized argument(s): ${[...positional, ...unrecognized].join(" ")}\n`,
			);
			return 1;
		}
		if (!flags.collapse) {
			io.stderr.write("conductor gate calibrate: usage: conductor gate calibrate --collapse <N,M,...>\n");
			return 1;
		}
		const collapse = flags.collapse.split(",").map((s) => Number(s.trim()));
		if (collapse.some((n) => !Number.isInteger(n) || n < 1 || n > TOTAL_FLOW_GATES)) {
			io.stderr.write(
				`conductor gate calibrate: --collapse must be a comma-separated list of gate numbers 1-${TOTAL_FLOW_GATES} (got "${flags.collapse}")\n`,
			);
			return 1;
		}
		try {
			const snapshot = await runGateCalibrate({
				cwd: io.cwd,
				demandId: flags.demand ?? DEFAULT_DEMAND_ID,
				store,
				collapse,
				confirm: resolveConfirmChannel(io.tty),
				source: "cli:gate-calibrate",
			});
			io.stdout.write(formatGateStatusReport(snapshot));
			return 0;
		} catch (error) {
			io.stderr.write(`conductor gate calibrate: ${describeError(error)}\n`);
			return 1;
		}
	}

	io.stderr.write(
		`conductor gate: unknown subcommand "${sub ?? ""}". Usage: status | start <N> | evidence | approve | reject | calibrate\n`,
	);
	return 1;
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
	const [command, ...rest] = argv;

	try {
		switch (command) {
			case "init":
				return await runInitCommand(rest, io);
			case "doctor":
				return await runDoctorCommand(rest, io);
			case "config":
				return await runConfigCommand(rest, io);
			case "roles":
				return await runRolesCommand(rest, io);
			case "skills":
				return await runSkillsCommand(rest, io);
			case "gate":
				return await runGateCommand(rest, io);
			case "library":
				return await runLibraryCommand(rest, io);
			case "chat":
				return await runChat({ cwd: io.cwd, args: rest, stdout: io.stdout, stderr: io.stderr });
			case "--help":
			case "-h":
				io.stdout.write(USAGE);
				return 0;
			case undefined:
				io.stderr.write(USAGE);
				return 1;
			default:
				io.stderr.write(`conductor: unknown command "${command}"\n\n${USAGE}`);
				return 1;
		}
	} catch (error) {
		// Last-resort guard: no command implementation above should throw (each has its own
		// try/catch around external calls), but a dispatcher that could still crash the process on
		// an unanticipated error would defeat the point of returning exit codes at all.
		io.stderr.write(`conductor: unexpected error: ${describeError(error)}\n`);
		return 1;
	}
}
