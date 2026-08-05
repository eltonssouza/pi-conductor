import { detect } from "./detect.ts";
import { profile } from "./profile.ts";
import type { ProjectEnrollment } from "./types.ts";

/**
 * Runs stack detection + profiling for `root` and returns the payload `conductor-cli`'s `init`
 * command hands to `conductor-config`'s writer (docs/adr/0002-fase1-cli-foundation.md §5.3's
 * `.conductor/config.json` `project` shape). Pure: this package does no config I/O itself — ADR
 * 0002 §3.1's dependency graph has conductor-project depend on neither conductor-config nor
 * conductor-runtime, and vice versa, so each package stays testable against fixtures without
 * mocking the others.
 */
export function enrollProject(root: string): ProjectEnrollment {
	const detection = detect(root);
	const stackProfile = profile(root);
	return {
		project: {
			type: detection.type,
			technologies: detection.technologies,
			evidence: detection.evidence,
			detectedAt: new Date().toISOString(),
		},
		profile: stackProfile,
	};
}
