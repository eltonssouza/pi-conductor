#!/usr/bin/env node
/**
 * `conductor` binary entry point.
 *
 * Imports `../src/cli.ts` directly -- no build step. None of this round's three sibling packages
 * (@conductor/config, @conductor/project, @conductor/runtime) ship a `dist/`; each is consumed as
 * TypeScript source via npm workspace symlinks (`main`/`types` both point at `./src/index.ts`),
 * consistent with ADR 0002 §2's "continuing inside the fork, source-level dependency on the Pi
 * workspace" stance. Relies on this monorepo's own `engines.node` floor (">=22.19.0", the same
 * floor every package.json here already declares -- see conductor-cli's own package.json and
 * src/commands/doctor.ts's MIN_NODE_VERSION) providing Node's built-in TypeScript type-stripping,
 * so a `.js` file can `import` a sibling `.ts` file with no transform step in between. Verified
 * directly in this session's dev environment (Node v26.5.0): a plain `.js` file importing a
 * sibling `.ts` file runs unmodified via `node file.js`. Not yet re-verified against the literal
 * 22.19.0 floor (only a newer Node was available to test against here) -- flagged honestly rather
 * than silently assumed; `conductor doctor`'s own Node-version check exists partly for this reason.
 *
 * `packages/coding-agent`'s own `bin` (pi -> dist/cli.js) points at a BUILT file instead, but that
 * package publishes to npm and needs a real dist; none of round A's three packages do either
 * (matches this same source-only precedent), so a build step here would be new, unneeded ceremony
 * for an unpublished, in-repo-only binary (ADR 0002 §1.3's "don't build more than the phase needs",
 * applied to tooling this time rather than to a package).
 */
import { runCli } from "../src/cli.ts";

runCli(process.argv.slice(2), {
	cwd: process.cwd(),
	stdout: { write: (chunk) => process.stdout.write(chunk) },
	stderr: { write: (chunk) => process.stderr.write(chunk) },
})
	.then((exitCode) => {
		process.exitCode = exitCode;
	})
	.catch((error) => {
		process.stderr.write(`conductor: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
