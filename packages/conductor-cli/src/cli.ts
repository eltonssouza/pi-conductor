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

import { runChat } from "./commands/chat.ts";
import { runConfigGet, runConfigSet, runConfigShow } from "./commands/config.ts";
import { doctorExitCode, formatDoctorReport, runDoctor } from "./commands/doctor.ts";
import { describeInitOutcome, initExitCode, runInit } from "./commands/init.ts";

export interface CliWriter {
	write(chunk: string): void;
}

export interface CliIO {
	cwd: string;
	stdout: CliWriter;
	stderr: CliWriter;
}

const USAGE = `conductor -- Conductor CLI (Fase 1)

Usage:
  conductor init [--force]
  conductor doctor
  conductor config show
  conductor config get <key>
  conductor config set <key> <value>
  conductor chat
  conductor --help

See docs/adr/0002-fase1-cli-foundation.md for the full command contract.
`;

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
