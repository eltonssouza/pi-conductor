/**
 * Typed errors for conductor-config, so callers (conductor-cli's init/doctor/config commands) can
 * branch on failure kind instead of parsing a message string -- "not initialized yet" (doctor
 * should say "run conductor init"), "malformed JSON", "well-formed but schema-invalid", and "path
 * safety violation" are all meaningfully different outcomes for a caller to react to.
 */

export class ConfigValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigValidationError";
	}
}

export class ConfigNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigNotFoundError";
	}
}

export class ConfigParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigParseError";
	}
}

export class WorkspaceContainmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceContainmentError";
	}
}
