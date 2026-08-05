/**
 * `conductor doctor` (docs/adr/0002-fase1-cli-foundation.md §7.2).
 *
 * Five checks, in the order ADR 0002 §7.2 lists them:
 *   1. .conductor/config.json presence + validity (same validator init/config use -- "validated on
 *      load, not a duplicate checker", ADR §7.2 item 1).
 *   2. Node version >= the monorepo's engines.node floor.
 *   3. Git repository state -- informational only, never blocking (ADR §7.2 item 3).
 *   4. Library (RAG) backend reachability -- SKIPPED for Fase 1: .conductor/config.json's schema
 *      (docs/adr/0002-fase1-cli-foundation.md §5.3) has no library/RAG field at all yet (introduced
 *      in Fase 5, per ADR §7.2 item 4's own "ausência não é falha" framing) -- there is no URL to
 *      read and inventing one is exactly what the task instructions warn against.
 *   5. Credential/model resolvable -- ADR §7.2 item 5's own addition beyond the base ask, kept here
 *      because it is the one check directly blocking for `conductor chat` (round B2): without it, a
 *      user only discovers a missing credential mid-chat instead of from `doctor`, which exists to
 *      surface exactly this kind of thing early.
 *
 * T12 (gate3-fase1-addendum.md secure default 10) applies to every check: status/presence/shape
 * only, never a secret's value. Every check is individually try/caught -- one failing check (e.g. a
 * corrupt config, or ModelRuntime.create() throwing on a broken auth.json) degrades that single
 * check to a warn/fail entry, never crashes the whole report (quality-baseline: explicit error
 * handling on every external call, degrade rather than throw).
 */

import {
	ConfigNotFoundError,
	ConfigParseError,
	ConfigValidationError,
	getConfigSummary,
	readConfig,
} from "@conductor/config";
import { DEFAULT_GIT_STATUS_TIMEOUT_MS, getGitStatus, resolveTimeoutMs } from "../git-status.ts";

/** Mirrors this monorepo's own `engines.node` floor (every package.json here declares the same
 * value) -- ADR 0002 §7.2 item 2 grounds this the same way: "same engines.node as every Pi
 * package.json", not a value read from any per-project config (there is nothing project-specific
 * about the runtime this CLI itself needs). */
const MIN_NODE_VERSION = "22.19.0";

/**
 * Quality-baseline category 4 ("no hardcoded assumptions" -- timeouts externalized): the git-check
 * timeout has a sane default but is overridable via `CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS` rather than
 * being a code-only constant, so a slow/unusual environment (a network filesystem, a huge repo) is
 * not stuck with a value baked into the binary. Exported for direct, deterministic unit testing
 * (rather than only indirectly through a real, potentially-flaky timing-based integration test).
 * Delegates to git-status.ts's shared `resolveTimeoutMs` (round B2 extracted the underlying git
 * subprocess calls into that module so `commands/chat`'s status line can reuse them) -- this
 * wrapper's name, signature, and env-var contract are unchanged so existing callers/tests of this
 * exact function keep working.
 */
export function resolveGitTimeoutMs(rawEnvValue: string | undefined): number {
	return resolveTimeoutMs(rawEnvValue, DEFAULT_GIT_STATUS_TIMEOUT_MS);
}

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
	name: string;
	status: CheckStatus;
	message: string;
}

export interface DoctorReport {
	checks: DoctorCheck[];
	/** True iff no check has status "fail". Missing config / dirty git / no credential are all non-blocking. */
	ok: boolean;
	/** ISO-8601 UTC timestamp the report was generated at (observability: ADR §7.2 frames a doctor
	 * report as "colável num chat de suporte ou anexado a uma issue" -- a pasteable artifact needs a
	 * timestamp to be useful after the fact, same as any other log). */
	generatedAt: string;
}

/** Minimal shape doctor needs from a ModelRuntime -- injectable for tests, defaults to the real
 * @earendil-works/pi-coding-agent ModelRuntime against Pi's global auth/model paths in production
 * (never a `.conductor/`-scoped path -- ADR 0002 §5.2: credentials never live inside the project). */
export interface DoctorModelRuntime {
	hasConfiguredAuth(providerId: string): boolean;
	getModel(providerId: string, modelId: string): unknown;
}

export interface DoctorOptions {
	cwd: string;
	createModelRuntime?: () => Promise<DoctorModelRuntime>;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function checkConductorConfig(cwd: string): DoctorCheck {
	const name = ".conductor/config.json";
	try {
		const summary = getConfigSummary(cwd); // redaction-safe view only -- never the raw config (T12)
		return {
			name,
			status: "pass",
			message: `valid (schema ${summary.schema}, project.type=${summary.project.type}, provider.model=${summary.provider.model})`,
		};
	} catch (error) {
		if (error instanceof ConfigNotFoundError) {
			return { name, status: "warn", message: "not initialized -- run `conductor init`" };
		}
		if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
			// error.message is already sanitized by @conductor/config (never raw file content -- see
			// read-config.ts's own header comment); safe to surface as-is.
			return { name, status: "fail", message: `invalid: ${error.message}` };
		}
		return { name, status: "fail", message: `could not check: ${describeError(error)}` };
	}
}

function parseNodeVersion(version: string): [number, number, number] {
	const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return [0, 0, 0];
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionAtLeast(actual: [number, number, number], required: [number, number, number]): boolean {
	for (let i = 0; i < 3; i++) {
		if (actual[i] > required[i]) return true;
		if (actual[i] < required[i]) return false;
	}
	return true;
}

function checkNodeVersion(): DoctorCheck {
	const name = "Node.js version";
	const actual = parseNodeVersion(process.version);
	const required = parseNodeVersion(MIN_NODE_VERSION);
	if (isVersionAtLeast(actual, required)) {
		return { name, status: "pass", message: `${process.version} >= required ${MIN_NODE_VERSION}` };
	}
	return {
		name,
		status: "fail",
		message: `${process.version} is older than the required ${MIN_NODE_VERSION} -- \`conductor chat\` may fail in confusing ways`,
	};
}

async function checkGitRepo(cwd: string): Promise<DoctorCheck> {
	const name = "git repository state";
	const timeout = resolveGitTimeoutMs(process.env.CONDUCTOR_DOCTOR_GIT_TIMEOUT_MS);
	const status = await getGitStatus(cwd, timeout);
	if (status.kind === "unavailable") {
		return { name, status: "warn", message: status.reason };
	}
	return {
		name,
		status: status.kind === "dirty" ? "warn" : "pass",
		message: `branch "${status.branch}"${status.kind === "dirty" ? ", working tree dirty" : ", working tree clean"}`,
	};
}

function checkLibraryBackend(): DoctorCheck {
	return {
		name: "library (RAG) backend",
		status: "skip",
		message:
			"not configured -- .conductor/config.json has no library field yet (introduced in Fase 5); nothing to check",
	};
}

function splitProviderModel(value: string): [string, string] {
	const slash = value.indexOf("/");
	if (slash === -1) return [value, ""];
	return [value.slice(0, slash), value.slice(slash + 1)];
}

async function defaultCreateModelRuntime(): Promise<DoctorModelRuntime> {
	const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
	// No authPath/modelsPath override: doctor checks the same global credential resolution
	// `conductor chat` will actually use (ADR 0002 §5.2) -- never a `.conductor/`-scoped path.
	return ModelRuntime.create({ allowModelNetwork: false });
}

async function checkModelResolution(
	cwd: string,
	createModelRuntime: () => Promise<DoctorModelRuntime>,
): Promise<DoctorCheck> {
	const name = "provider credential resolution";
	let providerModel: string;
	try {
		const config = readConfig(cwd);
		providerModel = config.provider.model;
	} catch {
		return { name, status: "skip", message: "skipped -- no valid provider.model to resolve yet" };
	}

	const [providerId] = splitProviderModel(providerModel);
	try {
		const runtime = await createModelRuntime();
		const configured = runtime.hasConfiguredAuth(providerId);
		return configured
			? { name, status: "pass", message: `provider "${providerId}": configured` }
			: {
					name,
					status: "warn",
					message: `provider "${providerId}": no credential configured yet -- \`conductor chat\` will fail to start until this is resolved`,
				};
	} catch (error) {
		// Never throws out of doctor -- a broken auth.json/models.json degrades this one check.
		return { name, status: "warn", message: `could not resolve model runtime: ${describeError(error)}` };
	}
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
	const createModelRuntime = options.createModelRuntime ?? defaultCreateModelRuntime;

	const checks: DoctorCheck[] = [
		checkConductorConfig(options.cwd),
		checkNodeVersion(),
		await checkGitRepo(options.cwd),
		checkLibraryBackend(),
		await checkModelResolution(options.cwd, createModelRuntime),
	];

	return { checks, ok: checks.every((check) => check.status !== "fail"), generatedAt: new Date().toISOString() };
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines = report.checks.map(
		(check) => `[${check.status.toUpperCase().padEnd(4)}] ${check.name}: ${check.message}`,
	);
	lines.push("", `Generated at ${report.generatedAt} (UTC)`, report.ok ? "Overall: OK" : "Overall: ISSUES FOUND");
	return `${lines.join("\n")}\n`;
}

export function doctorExitCode(report: DoctorReport): number {
	return report.ok ? 0 : 1;
}
