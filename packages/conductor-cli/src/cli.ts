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
import {
	curateCaptureEvent,
	openJournalReader,
	openJournalWriter,
	readRecordedJournalEntryIds,
} from "@conductor/diary";
import { type ResolveEvidenceRefContext, TOTAL_FLOW_GATES } from "@conductor/runtime";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { runAuthStatus } from "./commands/auth.ts";
import { runAuto } from "./commands/auto.ts";
import { runChat } from "./commands/chat.ts";
import { runConfigGet, runConfigSet, runConfigShow } from "./commands/config.ts";
import { doctorExitCode, formatDoctorReport, runDoctor } from "./commands/doctor.ts";
import {
	type EvidenceAttachment,
	type EvidenceRef,
	formatGateStatusReport,
	type InteractivityWitness,
	runGateApprove,
	runGateCalibrate,
	runGateEvidence,
	runGateReject,
	runGateStart,
	runGateStatus,
} from "./commands/gate.ts";
import {
	createPersistedGateStateStore,
	defaultInteractivityWitness,
	resolveGateGitContext,
} from "./commands/gate-store.ts";
import { describeInitOutcome, initExitCode, runInit } from "./commands/init.ts";
import {
	DEFAULT_CAPTURE_CONFIG,
	generateSessionId,
	resolveJournalContext,
	runJournalCommand,
} from "./commands/journal.ts";
import { runLibraryCommand } from "./commands/library.ts";
import { runLogin } from "./commands/login.ts";
import { runLogout } from "./commands/logout.ts";
import {
	buildCliResolutionContext,
	createGateModelResolutionPort,
	defaultCreateCredentialStore,
	defaultCreateModelRuntime,
	resolveActiveProvider,
} from "./commands/model-context.ts";
import { runModelsList, runModelsWhy } from "./commands/models.ts";
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
	/**
	 * Gate 6 real-wiring loop-back (Grupo F "captura automática", ADR 0007 §7/D5, FR-14..18): a TEST
	 * SEAM ONLY, threaded straight through to `resolveJournalContext(io.cwd, io.homeDir)` inside
	 * `runGateCommand` -- mirrors `commands/journal.ts`'s own `Journal*Options.homeDir` convention and
	 * `commands/chat.ts`'s own new `ChatOptions.homeDir` (same rationale: the Diary's log is
	 * per-MACHINE, never per-workspace, so a test that never overrode this writes to this developer's
	 * REAL home directory). Optional and backward-compatible: every existing caller/test that never sets
	 * it keeps resolving against the real `os.homedir()`, unchanged (`resolveJournalContext`'s own
	 * default). Production wiring (`bin/conductor.js`) never sets it either.
	 */
	homeDir?: string;
	/**
	 * D3 layer 2 (Gate 8 loop-back, ADR 0009 §5.3, finding 5): a TEST SEAM ONLY, threaded straight
	 * through to `createPersistedGateStateStore`'s `isInteractive` option inside `runGateCommand` --
	 * mirrors `homeDir`/`tty` above's exact optional/backward-compatible shape. Production wiring
	 * (`bin/conductor.js`) never sets this, so it always falls back to the REAL production witness
	 * (`gate-store.ts`'s `defaultInteractivityWitness`, reading `process.stdin`/`process.stdout` directly).
	 *
	 * Why this exists, separate from `tty` above: `tty` is D3 LAYER 1 (which `ConfirmChannel` gets
	 * constructed -- an in-memory `TtyStreams` double is enough to simulate a real interactive prompt for
	 * that layer). `isInteractive` is the INDEPENDENT layer 2 witness, deliberately reading the real
	 * process's own TTY state rather than the injected `tty` streams (ADR §5.3's own "a code path
	 * distinct from `io.tty`" requirement) -- which means a test that only fakes `tty` (simulating a real
	 * human answering "y" at a real terminal) is, correctly, still blocked by layer 2 under a test runner
	 * that has no real TTY of its own (`process.stdin.isTTY` is `undefined` under `vitest`). A test whose
	 * SUBJECT is the genuine interactive happy path (not layer 2 itself) states that explicitly by passing
	 * `isInteractive: () => true` here -- the same "double a real, out-of-process dependency" discipline
	 * `createModelRuntime`/`createCredentialStore` below already establish, applied to a second
	 * per-process (not per-workspace) piece of real state.
	 */
	isInteractive?: InteractivityWitness;
	/**
	 * GATE 8 loop-back (Fase 7): TEST SEAMS ONLY for the four model/credential commands, in the exact
	 * optional/backward-compatible shape `tty`/`homeDir` above already established, and mirroring
	 * `ChatOptions.createModelRuntime` (`commands/chat.ts:106`) one-for-one. Production wiring
	 * (`bin/conductor.js`) never sets either, so both fall back to `commands/model-context.ts`'s real
	 * per-machine defaults (`ModelRuntime.create({allowModelNetwork:false})` and `AuthStorage.create()`
	 * -- D10/§8.1: credential and catalog are per-machine, NEVER read from the workspace).
	 *
	 * Without these, a dispatcher test for `conductor auth`/`login`/`logout` would construct a real
	 * `ModelRuntime` and read THIS developer's real `~/.pi/agent/auth.json` -- real credential I/O
	 * inside a test suite, which this project's own session memory records as unacceptable.
	 */
	createModelRuntime?: () => Promise<ModelRuntime>;
	createCredentialStore?: () => Promise<CredentialStore>;
}

const USAGE = `conductor -- Conductor CLI (Fase 1)

Usage:
  conductor init [--force]
  conductor doctor
  conductor config show
  conductor config get <key>
  conductor config set <key> <value>
  conductor chat
  conductor auto "<demand>" [--budget <N>] [--risk=low]
  conductor auto --continue <slug> [--budget <N>]
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
  conductor journal add     --kind <k> [--gate <N>] [--session <id>] "<text>"
  conductor journal recall  "<question>" [--gate <N>] [--role <role>]
  conductor journal search  [--kind k1,k2] [--gate <N>] [--session <id>]
                          [--since <date>] [--until <date>] [--text "<s>"]
  conductor journal digest  [--session <id>] [--out <path.md>]
  conductor journal supersede --id <id> --mode <update|forget|invalidate> "<text>"
  conductor login  [provider]
  conductor logout <provider>
  conductor auth
  conductor models
  conductor models why <N>
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
 * the real `git rev-parse --verify` check (`git-status.ts`).
 *
 * `runtimeRecordedJournalEntryIds` (Gate 6 wiring closure, Fase 6 "Diary e captura automática" -- ADR
 * 0007 §4.3/D2/G12/FR-25): now genuinely POPULATED, reusing `commands/journal.ts`'s own
 * `resolveJournalContext(io.cwd)` (the exact same path `journal add`/`journal supersede` write to) to
 * open a real `JournalReader` and read every id it has ever recorded via `@conductor/diary`'s
 * `readRecordedJournalEntryIds`. No extra try/catch is needed here: `openJournalReader`/
 * `readRecordedJournalEntryIds` are fail-closed BY CONTRACT (R44/T63 -- a missing/unreadable/corrupted
 * diary collapses to an empty `Set`, never throws), so a project with no diary yet degrades to exactly
 * the prior "honestly empty" behavior, and a corrupted diary can only make a `journal-entry` ref
 * resolve LESS often, never more (deleting the diary revokes evidence, it never fabricates it). This
 * closes the seam `gate-evidence.ts`'s own header named "a REAL source once wired" -- a `--kind
 * journal-entry` ref now resolves for a genuinely-recorded id instead of always refusing. It does NOT
 * relax R40/D2 (`hasSufficientEvidenceForMandatoryGate` still requires `ref.kind === "test-run"` on its
 * runtime-derived branch, unchanged): a resolved journal-entry proves only that the runtime observed a
 * WRITE (existence), never that it observed WORK, so it still cannot close a mandatory gate alone --
 * see `test/commands/gate-cli.acceptance.test.ts`'s own "closes the D2/G12/FR-25 seam" section for the
 * end-to-end proof of both halves together.
 *
 * `runtimeRecordedTestRunIds` remains HONESTLY EMPTY -- a durable test-run ledger is a DIFFERENT,
 * still-unbuilt scope (not this fase's; confirmed by re-reading this file's own prior comment and
 * `gate-evidence.ts`'s header before touching this line), so `--kind test-run` refs correctly keep
 * refusing fail-closed rather than pretending to have observed an id nothing actually recorded.
 */
async function runGateCommand(args: string[], io: CliIO): Promise<number> {
	const [sub, ...rest] = args;
	const gitContext = await resolveGateGitContext(io.cwd);
	// Fase 7 D4/D11 (ADR 0008 §6/§21): the REAL `ModelResolutionPort`, built here and passed
	// UNCONDITIONALLY -- `createPersistedGateStateStore` requires it, so `gate start`'s fail-closed
	// model precondition can never again be silently inert (the Gate-8 finding this loop-back closes).
	// Built once per invocation, beside the store it belongs to, for the same reason the store itself is
	// built here: this IS the composition root. `createGateModelResolutionPort` never throws -- a
	// broken model runtime degrades to a REFUSING port, never to an absent one (R49(iii)).
	const modelResolutionPort = await createGateModelResolutionPort({
		workspaceRoot: io.cwd,
		createModelRuntime: io.createModelRuntime ?? defaultCreateModelRuntime,
		// F-G9-2 (Gate 9 pentest): o trust store do pin TOFU mora POR-MÁQUINA agora, então este
		// caminho precisa do mesmo seam `homeDir` que o diário já usa -- em produção, o home real.
		...(io.homeDir !== undefined ? { homeDir: io.homeDir } : {}),
	});
	const store = createPersistedGateStateStore({
		gatesDir: join(io.cwd, ".conductor", "gates"),
		repoId: gitContext.repoId,
		branch: gitContext.branch,
		modelResolutionPort,
		// D3 layer 2 (Gate 8 loop-back finding 5): `io.isInteractive` (CliIO's own doc comment) is a TEST
		// SEAM ONLY -- production (`bin/conductor.js`) never sets it, so this always falls back to the
		// REAL production witness, reading the process's own TTY state via a code path distinct from
		// `io.tty`/`resolveConfirmChannel(io.tty)` above (layer 1).
		isInteractive: io.isInteractive ?? defaultInteractivityWitness,
	});
	// `io.homeDir` (test seam, CliIO's own header): defaults to the real per-machine home in production,
	// exactly like every other `resolveJournalContext` call site.
	const { entriesPath, projectId } = resolveJournalContext(io.cwd, io.homeDir);
	const journalReader = openJournalReader(entriesPath, projectId);
	const evidenceContext: ResolveEvidenceRefContext = {
		repoRoot: io.cwd,
		workspaceRoot: io.cwd,
		gitCommitExists: gitCommitExistsSync,
		runtimeRecordedTestRunIds: new Set(),
		runtimeRecordedJournalEntryIds: readRecordedJournalEntryIds(journalReader),
	};

	/**
	 * Gate 6 real-wiring loop-back (Grupo F "captura automática", FR-14/FR-16, ADR 0007 §7/D5):
	 * `curateCaptureEvent`'s `gate-concluded` variant was implemented and unit-tested at Gate 5 but
	 * never called from any production path -- this is that call site, mirroring `commands/chat.ts`'s
	 * own `scheduleCaptureEvent` (see that file's header for why a synchronous try/catch, with no
	 * `Promise`, already satisfies "never blocks the command" here: `curateCaptureEvent` and
	 * `JournalWriter.append` are both synchronous). `gate approve`/`gate reject` have no chat-session
	 * concept of their own -- each `conductor gate ...` invocation is a fresh OS process, the same
	 * reasoning `journal.ts`'s own `generateSessionId()` already documents for `journal add` -- so this
	 * reuses that exact generator rather than inventing a second one.
	 */
	function captureGateConcluded(gate: number, outcome: string): void {
		try {
			const curated = curateCaptureEvent(
				{ kind: "gate-concluded", gate, sessionId: generateSessionId(), outcome },
				DEFAULT_CAPTURE_CONFIG,
			);
			if (curated !== null) {
				openJournalWriter(entriesPath).append(curated);
			}
		} catch (error) {
			// Disk full, permission error, or any other genuine I/O failure: capture is best-effort
			// (FR-16) -- a `gate approve`/`reject` that already succeeded must never fail (or report a
			// misleading non-zero exit) over a diary write problem. The failure itself is still surfaced
			// (quality-baseline category 6, observability) as a one-line stderr note -- error message
			// only, never `outcome`/curated text -- so a persistent capture problem (e.g. a full disk)
			// does not go completely unnoticed just because the gate command itself still exits 0.
			io.stderr.write(`conductor gate: automatic capture (gate-concluded) failed: ${describeError(error)}\n`);
		}
	}

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
			// Gate 6 real-wiring loop-back (FR-14, gate-concluded): `approve`/`reject` never touch
			// `currentGate` (verified in gate-store.ts's own `approve`/`reject`), so the resolved gate is
			// safely readable from the POST-call snapshot here -- `gateArg` when `--gate` was given,
			// otherwise whatever `runGateApprove` itself resolved from `currentGate`. `outcome` reflects
			// the REAL persisted record status ("approved", or "needs-human" when `confirmResult` was
			// `false`, gate-store.ts's own `mintHumanApproval(...) === null` branch) -- never guessed from
			// this function's own local `confirmResult`-shaped state (there is none to guess from; the
			// store is the one source of truth for what actually got persisted).
			const approvedGate = gateArg ?? snapshot.currentGate;
			captureGateConcluded(approvedGate, snapshot.gates.find((g) => g.gate === approvedGate)?.status ?? "approved");
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
			// Gate 6 real-wiring loop-back (FR-14, gate-concluded): same post-call resolution as `approve`
			// above (`reject` never touches `currentGate` either). The reason is included in `outcome`
			// (never verbatim message/tool-result content -- it is the human/agent-authored rejection
			// reason itself, exactly the kind of decision text `curateCaptureEvent`'s own `/reject/`
			// keyword match expects to land as `kind:"decision"`, capture.ts's own header).
			const rejectedGate = gateArg ?? snapshot.currentGate;
			captureGateConcluded(rejectedGate, `rejected: ${flags.reason}`);
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

/**
 * GATE 8 loop-back (Fase 7): the composition root for the four model/credential commands. Kept here,
 * beside the dispatcher, for the same reason `runGateCommand` builds its own `GateStateStoreView`
 * here -- this IS the place where abstractions get wired to implementations (ADR 0008 §16's own
 * "wire implementations via a dependency-injection container at the composition root").
 *
 * `models`/`models why` are SYNCHRONOUS by contract (§16), so the async work (building the
 * `ModelRuntime` and the `ResolutionContext` snapshot) all happens here, at the border, before either
 * is called -- D3's "I/O nas bordas, política no meio", end to end.
 */
async function runModelCommand(rest: string[], io: CliIO): Promise<number> {
	const [command, ...args] = rest;
	const modelRuntime = await (io.createModelRuntime ?? defaultCreateModelRuntime)();

	if (command === "auth") {
		return await runAuthStatus({ io, modelRuntime });
	}

	if (command === "login" || command === "logout") {
		const credentials = await (io.createCredentialStore ?? (async () => defaultCreateCredentialStore()))();
		if (command === "logout") {
			const provider = args[0];
			if (!provider) {
				io.stderr.write("conductor logout: a provider is required. Usage: conductor logout <provider>\n");
				return 1;
			}
			return await runLogout({ provider, io, credentials, modelRuntime });
		}
		// FR-2: no provider argument is NOT an error -- `runLogin` lists the known providers instead.
		const provider = args[0];
		return await runLogin({ ...(provider ? { provider } : {}), io, credentials, modelRuntime });
	}

	const ctx = await buildCliResolutionContext({
		workspaceRoot: io.cwd,
		modelRuntime,
		...(io.homeDir !== undefined ? { homeDir: io.homeDir } : {}),
	});
	// F-G9-3 (Gate 9 pentest): `models`/`models why` tem que ancorar o piso do mesmo-provedor no
	// MESMO valor que `gate start` usa, senão o diagnostico mente sobre a decisao de autorizacao.
	const activeProvider = resolveActiveProvider(io.cwd);

	if (args[0] === "why") {
		const raw = args[1];
		// Edge case 8 is `runModelsWhy`'s own responsibility (it names the valid range) -- a
		// non-numeric argument, however, never reaches it as a number at all, so it is refused here.
		const gate = Number(raw);
		if (raw === undefined || !Number.isFinite(gate)) {
			io.stderr.write(`conductor models why: expected a gate number 1-${TOTAL_FLOW_GATES}, got "${raw ?? ""}".\n`);
			return 1;
		}
		return runModelsWhy({ io, ctx, gate, ...(activeProvider !== undefined ? { activeProvider } : {}) });
	}
	if (args.length > 0) {
		io.stderr.write(`conductor models: unknown subcommand "${args[0]}". Usage: models | models why <N>\n`);
		return 1;
	}
	return runModelsList({ io, ctx, ...(activeProvider !== undefined ? { activeProvider } : {}) });
}

/**
 * Fase 8 (ADR 0009-fase8-autonomous-mode.md §3.1/§16): `conductor auto <demand>` / `--continue [slug]`
 * / `--budget <N>` / `--risk=low` -- the composition root for `runAuto`, following this file's own
 * flag-parsing convention (`parseFlags`) with one addition: `--risk=low` uses `--flag=value` syntax
 * (matching the CLI grammar the ADR/spec locked, `--risk=low`, not `--risk low`), so it is parsed
 * separately from the space-separated flags `parseFlags` already handles.
 */
async function runAutoCommand(args: string[], io: CliIO): Promise<number> {
	let continueSlug: string | undefined;
	let budgetTokens: number | undefined;
	let riskLow = false;
	const demandParts: string[] = [];

	let index = 0;
	if (args[0] === "--continue") {
		const maybeSlug = args[1];
		if (maybeSlug === undefined || maybeSlug.startsWith("--")) {
			io.stderr.write("conductor auto: --continue requires a slug. Usage: conductor auto --continue <slug>\n");
			return 1;
		}
		continueSlug = maybeSlug;
		index = 2;
	}

	for (; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--budget") {
			const raw = args[index + 1];
			const parsed = raw === undefined ? Number.NaN : Number(raw);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				io.stderr.write(`conductor auto: --budget must be a positive number (got "${raw ?? ""}")\n`);
				return 1;
			}
			budgetTokens = parsed;
			index++;
		} else if (arg === "--risk=low") {
			riskLow = true;
		} else if (arg?.startsWith("--")) {
			io.stderr.write(`conductor auto: unrecognized flag "${arg}"\n`);
			return 1;
		} else if (arg !== undefined) {
			demandParts.push(arg);
		}
	}

	if (continueSlug === undefined && demandParts.length === 0) {
		io.stderr.write(
			'conductor auto: usage: conductor auto "<demand>" [--budget <N>] [--risk=low] | conductor auto --continue <slug> [--budget <N>]\n',
		);
		return 1;
	}

	try {
		return await runAuto({
			demand: demandParts.join(" "),
			...(budgetTokens !== undefined ? { budgetTokens } : {}),
			...(riskLow ? { riskLow: true } : {}),
			...(continueSlug !== undefined ? { continueSlug } : {}),
			io: { cwd: io.cwd, stdout: io.stdout, stderr: io.stderr, ...(io.tty !== undefined ? { tty: io.tty } : {}) },
		});
	} catch (error) {
		io.stderr.write(`conductor auto: ${describeError(error)}\n`);
		return 1;
	}
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
			case "auto":
				return await runAutoCommand(rest, io);
			case "library":
				return await runLibraryCommand(rest, io);
			case "journal":
				return await runJournalCommand(rest, io);
			// Fase 7 (Gate 8 loop-back): os 5 entregáveis literais da fase, agora alcançáveis pelo
			// binário real. `runModelCommand` recebe o verbo de volta como primeiro elemento para
			// manter um único composition root (um `ModelRuntime` construído uma vez, por comando).
			case "login":
			case "logout":
			case "auth":
			case "models":
				return await runModelCommand([command, ...rest], io);
			case "chat":
				// `io.homeDir` (CliIO's own test-seam doc comment): forwarded to ChatOptions.homeDir so
				// BOTH real dispatch entry points (`runCli(["chat"...])` and `runChat(...)` called
				// directly, as chat.test.ts's own capture tests do) resolve the Diary's per-machine path
				// consistently -- production wiring (bin/conductor.js) never sets io.homeDir, so this is a
				// no-op (`undefined`) in real use, exactly like every other homeDir seam in this package.
				return await runChat({
					cwd: io.cwd,
					args: rest,
					stdout: io.stdout,
					stderr: io.stderr,
					homeDir: io.homeDir,
				});
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
