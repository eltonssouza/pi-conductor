/**
 * Read `.conductor/config.json` (docs/adr/0002-fase1-cli-foundation.md §5.3). Validated on load --
 * `conductor doctor`/`conductor config` share this one validator rather than each re-implementing
 * their own check (ADR 0002 §7.2: "usa o mesmo validador de conductor-config que init/config usam
 * -- validado no load, não um checker duplicado").
 */

import { existsSync, readFileSync } from "node:fs";
import { ConfigNotFoundError, ConfigParseError } from "./errors.ts";
import type { ConductorConfig } from "./schema.ts";
import { assertValidConfigShape } from "./schema-validation.ts";
import { resolveContainedConfigPath } from "./workspace-containment.ts";

export function readConfig(workspaceRoot: string): ConductorConfig {
	const { configRealPath } = resolveContainedConfigPath(workspaceRoot);

	if (!existsSync(configRealPath)) {
		throw new ConfigNotFoundError(
			`no .conductor/config.json found under "${workspaceRoot}" -- run \`conductor init\` first`,
		);
	}

	const raw = readFileSync(configRealPath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Deliberately no raw file content in the error (Gate 6 quality baseline, observability: an
		// error message must never carry PII/secrets -- a malformed config.json could contain a
		// hand-pasted secret alongside the syntax error that broke it).
		throw new ConfigParseError(`.conductor/config.json is not valid JSON (${configRealPath})`);
	}

	// assertValidConfigShape throws ConfigValidationError on a structurally invalid document; that
	// propagates as-is (distinct from ConfigParseError, which is specifically "not JSON at all").
	assertValidConfigShape(parsed);
	return parsed;
}
