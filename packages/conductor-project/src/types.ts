/**
 * Shared types for stack detection + profiling.
 *
 * `ProjectType` mirrors conductor-main/conductor/detect.py's `VALID_TYPES`. Note that `detect()`'s
 * own classifier (see detect.ts's `classify`) can only ever produce "mobile" | "fullstack" |
 * "frontend" | "backend" | "unknown" — "library" and "data" are reserved for a human/manual
 * override via `conductor config set project.type`, exactly as in the Python source (they exist in
 * VALID_TYPES but never in detect()'s own conservative classification rule).
 */
export type ProjectType = "backend" | "frontend" | "mobile" | "fullstack" | "library" | "data" | "unknown";

/** Output of `detect()` — ported from conductor-main/conductor/detect.py's `detect(root)`. */
export interface DetectionResult {
	type: ProjectType;
	/** Deduped, first-occurrence order (mirrors Python's `dict.fromkeys`). */
	technologies: string[];
	/** Manifest paths relative to `root`, POSIX-separated, deduped in first-occurrence order. */
	evidence: string[];
}

/**
 * Output of `profile()` — ported from conductor-main/conductor/detect.py's `profile(root)`.
 * Every field is a deduped list (possibly empty); best-effort, never throws for a corner the
 * parsers don't recognize.
 */
export interface StackProfile {
	languages: string[];
	frameworks: string[];
	datastores: string[];
	build: string[];
	testing: string[];
	tooling: string[];
	libraries: string[];
}

/**
 * The payload `conductor-cli`'s `init` command hands to `conductor-config`'s writer — shaped to
 * match `.conductor/config.json`'s `project` field 1:1 (docs/adr/0002-fase1-cli-foundation.md §5.3).
 * This package never writes `.conductor/config.json` itself (ADR 0002 §3.1's package boundary:
 * conductor-project has zero dependency on conductor-config or conductor-runtime).
 */
export interface ProjectEnrollment {
	project: {
		type: ProjectType;
		technologies: string[];
		evidence: string[];
		/** ISO-8601, UTC (`Date.prototype.toISOString()`) — never a local offset. */
		detectedAt: string;
	};
	profile: StackProfile;
}
