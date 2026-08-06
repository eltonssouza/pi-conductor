/**
 * Command Classifier (Fase 2, Gate 2 spec Grupo A / ADR 0003 §3 / gate3-addendum-fase2.md T17,
 * T23, R1, R2, GAP-A, GAP-D).
 *
 * Assigns a Risk Tier (low/medium/high/critical) to a `bash` command string BEFORE the Permission
 * Engine (permission-engine.ts) decides whether to auto-approve, ask a human, or deny outright.
 *
 * MECHANISM (ADR §3.1 — the crux decision, delegated to security-engineer, locked at Gate 4):
 * lexical heuristic, fail-closed, `tier = max(signals)`. A table of independent signal detectors
 * (below) each either raises the tier or contributes nothing — never lowers it. The ONLY path to
 * "low" is the built-in allowlist or a policy.json grant (ADR §3.2 signal 1), and only when NO
 * other signal fired anywhere in the command. Parse-AST is deliberately NOT used (ADR §3.1: parser
 * differential against the real /bin/sh sink; doesn't resolve encoded payloads either) — this is a
 * conservative denylist-of-danger-shapes + allowlist-of-known-safe, not an attempt to "understand
 * and permit" a command.
 *
 * Invariants this file must never violate (tested exhaustively in command-classifier.test.ts):
 *   - TOTAL: classifyCommand never throws, for any input (BR-1/BR-9/FR-4).
 *   - DIRECTIONAL: obfuscation/encoding/indirection can only RAISE the tier, never lower it (R1/T17).
 *   - REUSES workspace-policy.ts's evaluateToolPath for every path verdict (ADR §3.3, "one path
 *     authority, two callers") — this file does not reimplement protected-path/containment logic.
 *   - `provablyContained` defaults to false; only set true when every signal is affirmatively safe
 *     (R8 — the positive-proof requirement `isYesEligible` relies on).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { evaluateToolPath, type PathCheckResult, type WorkspacePolicyOptions } from "./workspace-policy.ts";

export type RiskTier = "low" | "medium" | "high" | "critical";

/** One of the mutation/removal/read operands the target-extractor pulls out of a bash string. */
export type ExtractedTargetVia = ">" | ">>" | "rm" | "mv" | "truncate" | "dd" | "tee" | "install" | "cp" | "read";

export interface ExtractedTarget {
	/** The raw operand text as it appeared in the command, before any resolution. */
	raw: string;
	via: ExtractedTargetVia;
	/** False when the operand could not be resolved to a concrete path statically (e.g. `$TARGET`, a subshell). */
	staticallyResolvable: boolean;
	/** Set only when staticallyResolvable — the workspace-policy.ts verdict for this target (T23/GAP-D). */
	containment?: PathCheckResult;
}

export interface TierSignal {
	/** Short machine-stable identifier for the signal that fired (e.g. "known-catastrophic", "decode-to-interpreter"). */
	kind: string;
	tier: RiskTier;
	/** Human-readable explanation surfaced to the approval UI / audit trail. */
	detail: string;
	target?: ExtractedTarget;
}

/**
 * Minimal shape of the allowlist grant this classifier consumes (ADR 0003 §3.2 signal 1, FR-3).
 * The real, trust-checked `EffectiveCommandPolicy` is assembled by policy-engine.ts (owned by the
 * parallel policy/secrets/redaction stream, per ADR 0003 §5/§9) — this local, minimal type is the
 * seam `ClassificationContext.policy` uses until a future gate reconciles the two. Per ADR §13.4
 * costura #1, whatever is passed here MUST already be the effective (trust + ceiling resolved)
 * policy — the classifier consumes it, it never merges sources itself.
 *
 * `pattern` is matched as an exact, literal string against the trimmed command (not a glob/regex):
 * the safest, least-ambiguous choice given ADR §15 left the exact syntax open to this gate, and it
 * avoids ReDoS/glob-escaping concerns for a grant mechanism whose whole point is narrow, deliberate
 * carve-outs (BR-8 already caps risk at low|medium; a fuzzy pattern would widen the grant's blast
 * radius in a way no test or ADR clause asked for).
 */
export interface ClassifierAllowlistEntry {
	pattern: string;
	risk: "low" | "medium";
}

export interface ClassificationContext {
	workspace: WorkspacePolicyOptions;
	policy?: {
		allowlist?: ClassifierAllowlistEntry[];
	};
}

export interface ClassificationResult {
	/** max() over every signal that fired; never below the highest-raising signal (R1). */
	tier: RiskTier;
	signals: TierSignal[];
	/** Default false (R8) — only true when every extracted target is proven contained AND no indirection/obfuscation fired. */
	provablyContained: boolean;
	/** True when some span of the command could not be lexed/decoded into a recognized token. */
	hasUnanalyzableSpan: boolean;
	/** The exact bytes shown to the human approver — must equal what was classified (R2, "classify-what-you-show"). */
	displayCommand: string;
}

const TIER_RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function maxTier(tiers: RiskTier[]): RiskTier {
	let best: RiskTier = "low";
	for (const tier of tiers) {
		if (TIER_RANK[tier] > TIER_RANK[best]) best = tier;
	}
	return best;
}

/** Signal kinds that mean "this specific finding is affirmatively safe" — every OTHER kind denies provablyContained (R8). */
const CONTAINMENT_SAFE_KINDS = new Set(["allowlisted", "policy-allowlist-grant", "mutation-contained"]);

/** Signal kinds that mean "part of this command could not be analyzed/resolved" (feeds hasUnanalyzableSpan). */
const UNANALYZABLE_KINDS = new Set([
	"malformed-input",
	"unrecognized-token",
	"target-unresolved-destructive",
	"target-unresolved-nondestructive",
	"target-resolution-error",
]);

// ---------------------------------------------------------------------------------------------
// Step 0 -- malformed/empty input (BR-1/BR-9/FR-4): fail closed before any lexing is attempted.
//
// IMPORTANT -- C0/DEL control bytes (e.g. a raw ESC from an embedded ANSI escape sequence) are
// DELIBERATELY NOT part of this check (Gate 4 decision, journal `gate 4`; grounding was weak --
// top ~0.57 -- reported honestly rather than forced, decided by direct code reading): this
// classifier evaluates EXECUTION risk, not DISPLAY risk. `terminal-sanitize.ts`'s
// `sanitizeForTerminal()` is the sole, already-total owner of the display concern -- it strips CSI,
// OSC, every other two-byte escape, AND a residual catch-all for every C0 (0x00-0x1F, tab/LF
// excepted) and C1 (0x7F-0x9F) control byte, at the confirm()/render sink (`confirm.ts`'s
// `confirmOrDeny()`), independent of this file. Re-flagging the same bytes here as "malformed" ->
// tier "critical" would (a) duplicate a responsibility that already has exactly one owner -- the
// same "one rule in one place" discipline this file already applies to path containment via
// `evaluateToolPath` (ADR section 3.3, "one path authority, two callers"; grounded via `cdt
// library "narrowing a regex character-class check to remove responsibility already owned by a
// downstream sanitization function" --gate 6`, top 0.583: Software Construction Practices --
// Complete Professional Guide section 2.12 "the interior is supposed to assume validity...
// re-checking adds branches that can never fire and a reader who can't tell which check is the
// real one", and section 1.12/3.3 on minimizing redundant paths); and (b) actively break BR-8's
// contract, because "critical" has NO approval path (`permission-engine.ts` denies it outright) --
// so a perfectly ordinary, otherwise-analyzable command (e.g. `echo` with a stray ESC byte inside
// one of its arguments) would be denied before a human ever sees the sanitized prompt, instead of
// the intended "sanitize for display, still let the human decide" behavior. A control/escape byte
// found elsewhere in an otherwise-lexable command therefore flows through the normal
// verb/target/allowlist pipeline below like any other byte -- it does not, by itself, raise the
// tier. (The narrow exception is `hasControlCharacterInLeadingToken`, further below -- a
// DIFFERENT, execution-risk-motivated guard: a control byte fused into the leading verb token can
// defeat verb RECOGNITION itself, not just its display. See that function's comment.)
//
// What DOES stay "malformed"/critical here -- reserved for what actually defeats semantic
// analysis, not display:
//   - empty/whitespace-only input
//   - Unicode noncharacters U+FFFE/U+FFFF (encoding-level ambiguity, not a display artifact)
//   - an unpaired UTF-16 surrogate (hasLoneSurrogate, unchanged)
// ---------------------------------------------------------------------------------------------

/**
 * True for the two Unicode noncharacters U+FFFE/U+FFFF only. Written as an explicit charCodeAt
 * comparison (matching hasLoneSurrogate's style just below) rather than a regex literal containing
 * the raw noncharacters themselves, to avoid embedding non-printable/non-renderable code points
 * directly in source (Clean Code: prefer explicit, grep-able intent over invisible characters).
 * C0/DEL control bytes were deliberately removed from this check -- see the block comment above.
 */
function hasDisallowedNoncharacter(command: string): boolean {
	for (let i = 0; i < command.length; i++) {
		const code = command.charCodeAt(i);
		if (code === 0xfffe || code === 0xffff) return true;
	}
	return false;
}

function hasLoneSurrogate(command: string): boolean {
	for (let i = 0; i < command.length; i++) {
		const code = command.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = command.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i++; // valid surrogate pair -- skip its low half
			} else {
				return true; // high surrogate with no matching low surrogate
			}
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true; // lone low surrogate
		}
	}
	return false;
}

function detectMalformedInput(command: string): string | null {
	if (command.trim().length === 0) return "empty or whitespace-only command";
	if (hasDisallowedNoncharacter(command)) return "disallowed Unicode noncharacter present";
	if (hasLoneSurrogate(command)) return "invalid/unpaired UTF-16 surrogate present";
	return null;
}

// ---------------------------------------------------------------------------------------------
// A small shell-ish tokenizer/segmenter. NOT a parser (ADR §3.1 rejects AST as the primary
// mechanism) — just enough structure to (a) keep `$(...)`/backtick/quoted spans atomic instead of
// splitting them on whitespace or pipes, and (b) find "command position" boundaries at `;`, `&&`,
// `||`, and `|` for per-segment leading-verb extraction.
// ---------------------------------------------------------------------------------------------

function consumeBalanced(command: string, start: number, open: string, close: string): number {
	let depth = 1;
	let i = start;
	while (i < command.length && depth > 0) {
		if (command[i] === open) depth++;
		else if (command[i] === close) depth--;
		i++;
	}
	return i;
}

function splitTopLevelSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let i = 0;
	while (i < command.length) {
		const ch = command[i];
		if (ch === '"' || ch === "'") {
			const quoteEnd = command.indexOf(ch, i + 1);
			const end = quoteEnd === -1 ? command.length : quoteEnd + 1;
			current += command.slice(i, end);
			i = end;
			continue;
		}
		if (ch === "$" && command[i + 1] === "(") {
			const end = consumeBalanced(command, i + 2, "(", ")");
			current += command.slice(i, end);
			i = end;
			continue;
		}
		if (ch === "`") {
			const closeIdx = command.indexOf("`", i + 1);
			const end = closeIdx === -1 ? command.length : closeIdx + 1;
			current += command.slice(i, end);
			i = end;
			continue;
		}
		if (ch === ";") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === "&" && command[i + 1] === "&") {
			segments.push(current);
			current = "";
			i += 2;
			continue;
		}
		if (ch === "|" && command[i + 1] === "|") {
			segments.push(current);
			current = "";
			i += 2;
			continue;
		}
		if (ch === "|") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	if (current.length > 0) segments.push(current);
	return segments;
}

function tokenizeSegment(rest: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let i = 0;
	const flush = () => {
		if (current.length > 0) {
			tokens.push(current);
			current = "";
		}
	};
	while (i < rest.length) {
		const ch = rest[i];
		if (/\s/.test(ch ?? "")) {
			flush();
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const quoteEnd = rest.indexOf(ch, i + 1);
			const end = quoteEnd === -1 ? rest.length : quoteEnd + 1;
			current += rest.slice(i, end);
			i = end;
			continue;
		}
		if (ch === "$" && rest[i + 1] === "(") {
			const end = consumeBalanced(rest, i + 2, "(", ")");
			current += rest.slice(i, end);
			i = end;
			continue;
		}
		if (ch === "`") {
			const closeIdx = rest.indexOf("`", i + 1);
			const end = closeIdx === -1 ? rest.length : closeIdx + 1;
			current += rest.slice(i, end);
			i = end;
			continue;
		}
		current += ch;
		i++;
	}
	flush();
	return tokens;
}

/** A token contains something the classifier cannot resolve statically (variable, substitution, glob). */
const UNRESOLVED_TOKEN_PATTERN = /\$\{?\w+\}?|\$\(|`|\*|\?/;
function containsUnresolvedToken(token: string): boolean {
	return UNRESOLVED_TOKEN_PATTERN.test(token);
}

function stripQuotes(token: string): string {
	if (token.length >= 2) {
		const first = token[0];
		const last = token[token.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return token.slice(1, -1);
		}
	}
	return token;
}

function expandTilde(target: string): string {
	if (target === "~") return homedir();
	if (target.startsWith("~/") || target.startsWith("~\\")) return join(homedir(), target.slice(2));
	return target;
}

function basenameVerb(token: string): string {
	const parts = token.split(/[/\\]/);
	return parts[parts.length - 1] ?? token;
}

// ---------------------------------------------------------------------------------------------
// Signals 4-7 — indirection-to-interpreter, decode-to-interpreter, command substitution, heredoc
// (ADR §3.2 rows 4-7; T17/GAP-A). Each is an independent whole-string regex: cheap, conservative,
// and — per ADR §3.1's explicit trade-off — a false positive (asks for approval unnecessarily) is
// the only failure mode, never a false negative that silently executes.
// ---------------------------------------------------------------------------------------------

const PIPE_TO_INTERPRETER_PATTERN = /\|\s*(sh|bash|zsh|python[0-9]?|node|perl|ruby)\b/;
const SHELL_DASH_C_PATTERN = /\b(sh|bash|zsh)\s+-c\b/;
const XARGS_TO_SHELL_PATTERN = /\bxargs\b[^|;&]*\b(sh|bash)\b/;
const EVAL_PATTERN = /\beval\b/;
const COMMAND_SUBSTITUTION_PATTERN = /\$\(|`[^`]*`/;
const HEREDOC_TO_SHELL_PATTERN = /<<<|<<-?\s*['"]?\w+/;
const DECODE_UTILITY_PATTERN = /\b(base64\s+(-d|--decode)|xxd\s+-r|openssl\s+enc\s+-d)\b/;
const INTERPRETER_NAME_PATTERN = /\b(sh|bash|zsh|python[0-9]?|node|perl|ruby)\b/;

function detectIndirectionSignals(command: string): TierSignal[] {
	const signals: TierSignal[] = [];

	if (
		PIPE_TO_INTERPRETER_PATTERN.test(command) ||
		SHELL_DASH_C_PATTERN.test(command) ||
		XARGS_TO_SHELL_PATTERN.test(command)
	) {
		signals.push({
			kind: "indirection-to-interpreter",
			tier: "high",
			detail:
				"command pipes or hands its output to a shell/language interpreter — floor 'high' independent of the visible verb (R1)",
		});
	}

	if (EVAL_PATTERN.test(command)) {
		signals.push({
			kind: "eval-indirection",
			tier: "high",
			detail: "command uses 'eval' — floor 'high' independent of the visible verb (R1)",
		});
	}

	if (COMMAND_SUBSTITUTION_PATTERN.test(command)) {
		signals.push({
			kind: "command-substitution",
			tier: "high",
			detail: "command contains $(...) or backtick substitution feeding another command — floor 'high' (R1)",
		});
	}

	if (HEREDOC_TO_SHELL_PATTERN.test(command)) {
		signals.push({
			kind: "heredoc-indirection",
			tier: "high",
			detail: "command uses a heredoc/here-string into a shell — floor 'high' (R1)",
		});
	}

	// Decode->interpreter (signal 5, T17's exact walkthrough): only raises when a decode utility's
	// output plausibly reaches an interpreter in the SAME command — decoding to a file with no
	// further execution is a narrower, undocumented case left as a residual rather than
	// over-flagged (ADR §3.1's usability sensitivity point: over-restriction pushes users to
	// --yes-everywhere, which is a worse security outcome).
	if (DECODE_UTILITY_PATTERN.test(command) && INTERPRETER_NAME_PATTERN.test(command)) {
		signals.push({
			kind: "decode-to-interpreter",
			tier: "high",
			detail:
				"a decode utility's output appears to reach an interpreter — treated as indirection, structure is analyzable even though the payload is opaque (R1/T17)",
		});
	}

	return signals;
}

// ---------------------------------------------------------------------------------------------
// Signal 12 — known-catastrophic patterns that have no extractable file target at all (a fork
// bomb, a filesystem-format command). `rm -rf /`, `rm -rf ~`, and `dd if=/dev/zero of=/dev/sda`
// are NOT listed here: they fall out naturally, and more precisely, from the target-extraction
// path below (their target resolves outside the workspace root).
// ---------------------------------------------------------------------------------------------

const FORK_BOMB_PATTERN = /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;
const MKFS_PATTERN = /\bmkfs(\.\w+)?\b/;

function detectCatastrophicSignal(command: string): TierSignal | null {
	if (FORK_BOMB_PATTERN.test(command)) {
		return { kind: "known-catastrophic", tier: "critical", detail: "recognized fork-bomb pattern" };
	}
	if (MKFS_PATTERN.test(command)) {
		return {
			kind: "known-catastrophic",
			tier: "critical",
			detail: "filesystem-format command targets a block device unconditionally",
		};
	}
	return null;
}

// ---------------------------------------------------------------------------------------------
// Signals 2/3/8/9/10/11 — target extraction for write/remove/read operations (T23/GAP-D). The
// classifier extracts operands; workspace-policy.ts's evaluateToolPath is the ONLY authority on
// whether a resolved target is protected or contained (ADR §3.3, "one path authority, two callers").
// ---------------------------------------------------------------------------------------------

const NON_DESTRUCTIVE_MUTATORS = new Set(["mv", "cp", "tee", "install"]);
const DESTRUCTIVE_SIMPLE_VERBS = new Set(["truncate"]);
const READ_VERBS = new Set(["cat", "less", "head", "tail"]);

function evaluateExtractedTarget(
	rawTarget: string,
	via: ExtractedTargetVia,
	destructive: boolean,
	workspace: WorkspacePolicyOptions,
): TierSignal {
	const cleaned = expandTilde(stripQuotes(rawTarget));
	let check: PathCheckResult;
	try {
		check = evaluateToolPath(cleaned, workspace);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			kind: "target-resolution-error",
			tier: "critical",
			detail: `${via}: target path could not be resolved — fail closed (${message})`,
			target: { raw: rawTarget, via, staticallyResolvable: false },
		};
	}
	if (!check.allowed) {
		return {
			kind: check.reason?.includes("protected location") ? "target-protected-path" : "target-outside-workspace",
			tier: "critical",
			detail: check.reason ?? `${via}: target is not allowed`,
			target: { raw: rawTarget, via, staticallyResolvable: true, containment: check },
		};
	}
	return {
		kind: "mutation-contained",
		tier: destructive ? "medium" : "medium",
		detail: `${via}: target is statically resolvable and contained within the workspace`,
		target: { raw: rawTarget, via, staticallyResolvable: true, containment: check },
	};
}

function evaluateUnresolvedOperand(rawOperands: string, via: ExtractedTargetVia, destructive: boolean): TierSignal {
	return {
		kind: destructive ? "target-unresolved-destructive" : "target-unresolved-nondestructive",
		tier: destructive ? "critical" : "high",
		detail: `${via}: an operand contains a variable/substitution/glob that cannot be statically resolved — ${
			destructive
				? "destructive verb with an opaque target degrades to critical"
				: "non-destructive mutation with an opaque target floors at high"
		} (residual fails up, never down)`,
		target: { raw: rawOperands, via, staticallyResolvable: false },
	};
}

function handleRedirectTargets(command: string, workspace: WorkspacePolicyOptions): TierSignal[] {
	const signals: TierSignal[] = [];
	const pattern = /(>{1,2})\s*(\S+)/g;
	for (const match of command.matchAll(pattern)) {
		const via = match[1] === ">>" ? ">>" : ">";
		const rawTarget = match[2];
		if (rawTarget === undefined) continue;
		signals.push(
			containsUnresolvedToken(rawTarget)
				? evaluateUnresolvedOperand(rawTarget, via, false)
				: evaluateExtractedTarget(rawTarget, via, false, workspace),
		);
	}
	return signals;
}

function handleRmVerb(rest: string, workspace: WorkspacePolicyOptions): TierSignal | null {
	const tokens = tokenizeSegment(rest);
	const flagTokens = tokens.filter((t) => t.startsWith("-"));
	const operands = tokens.filter((t) => !t.startsWith("-"));
	const destructive = flagTokens.some((f) => /[rf]/.test(f));
	if (operands.length === 0) return null;
	const target = operands[operands.length - 1];
	if (target === undefined) return null;
	return containsUnresolvedToken(target)
		? evaluateUnresolvedOperand(target, "rm", destructive)
		: evaluateExtractedTarget(target, "rm", destructive, workspace);
}

function handleDdVerb(rest: string, workspace: WorkspacePolicyOptions): TierSignal | null {
	const tokens = tokenizeSegment(rest);
	const ofToken = tokens.find((t) => t.startsWith("of="));
	if (!ofToken) return null; // no output target — nothing this classifier can extract
	const target = ofToken.slice(3);
	return containsUnresolvedToken(target)
		? evaluateUnresolvedOperand(target, "dd", true)
		: evaluateExtractedTarget(target, "dd", true, workspace);
}

function handleGenericMutator(
	rest: string,
	via: ExtractedTargetVia,
	destructive: boolean,
	workspace: WorkspacePolicyOptions,
): TierSignal | null {
	const tokens = tokenizeSegment(rest).filter((t) => !t.startsWith("-"));
	if (tokens.length === 0) return null;
	// Every operand (source AND destination) is checked: a resolvable-looking destination next to
	// an unresolvable source is still conservatively flagged, because the fallible step is
	// EXTRACTION itself — the residual fails up, never down (ADR §3.3).
	if (tokens.some(containsUnresolvedToken)) {
		return evaluateUnresolvedOperand(rest.trim(), via, destructive);
	}
	const target = tokens[tokens.length - 1];
	if (target === undefined) return null;
	return evaluateExtractedTarget(target, via, destructive, workspace);
}

function handleReadVerb(rest: string, workspace: WorkspacePolicyOptions): TierSignal | null {
	const tokens = tokenizeSegment(rest).filter((t) => !t.startsWith("-"));
	if (tokens.length === 0) return null;
	const target = tokens[tokens.length - 1];
	if (target === undefined || containsUnresolvedToken(target)) return null; // dynamic read target: not flagged here, residual
	const cleaned = expandTilde(stripQuotes(target));
	let check: PathCheckResult;
	try {
		check = evaluateToolPath(cleaned, workspace);
	} catch {
		return {
			kind: "target-resolution-error",
			tier: "high",
			detail: "read target could not be resolved — fail closed",
			target: { raw: target, via: "read", staticallyResolvable: false },
		};
	}
	if (!check.allowed) {
		return {
			kind: "read-protected-path",
			tier: "high",
			detail: `read of a protected/out-of-workspace location — exfiltration risk floor (signal 10): ${check.reason ?? ""}`,
			target: { raw: target, via: "read", staticallyResolvable: true, containment: check },
		};
	}
	return null; // ordinary contained read — no signal
}

function extractTargetSignals(command: string, workspace: WorkspacePolicyOptions): TierSignal[] {
	const signals: TierSignal[] = handleRedirectTargets(command, workspace);

	for (const segment of splitTopLevelSegments(command)) {
		const trimmedSegment = segment.trim();
		if (trimmedSegment.length === 0) continue;
		const leadingMatch = trimmedSegment.match(/^(\S+)\s*([\s\S]*)$/);
		if (!leadingMatch) continue;
		const verbToken = leadingMatch[1];
		const rest = leadingMatch[2] ?? "";
		if (verbToken === undefined) continue;
		const verb = basenameVerb(verbToken);

		let signal: TierSignal | null = null;
		if (verb === "rm") signal = handleRmVerb(rest, workspace);
		else if (verb === "dd") signal = handleDdVerb(rest, workspace);
		else if (NON_DESTRUCTIVE_MUTATORS.has(verb))
			signal = handleGenericMutator(rest, verb as ExtractedTargetVia, false, workspace);
		else if (DESTRUCTIVE_SIMPLE_VERBS.has(verb))
			signal = handleGenericMutator(rest, verb as ExtractedTargetVia, true, workspace);
		else if (READ_VERBS.has(verb)) signal = handleReadVerb(rest, workspace);

		if (signal) signals.push(signal);
	}

	return signals;
}

// ---------------------------------------------------------------------------------------------
// Signal 1 — allowlist (built-in known-safe shapes, or a policy.json grant). Only ever consulted
// when NOTHING else raised a signal (ADR §3.2's walkthrough: allowlist never masks an indirection
// signal firing elsewhere in the same command).
// ---------------------------------------------------------------------------------------------

/** Presence of any of these means "this is not a simple literal command" — never allowlisted. */
const COMPOSITION_METACHARACTERS = /[;&|$`<>\n]/;

const BUILTIN_ALLOWLIST_PATTERNS: RegExp[] = [/^ls\b/, /^pwd$/, /^git\s+(status|diff)\b/, /^grep\b/, /^echo\b/];

/**
 * Execution-risk guard -- NOT a display-risk one (see the Step-0 block comment above
 * detectMalformedInput): a leading command-position token that itself contains a raw control byte
 * cannot be a legitimate verb name (real executables are plain identifiers). Left unguarded, this
 * lets a control byte "smuggle" a dangerous command past the allowlist: JS regex `\b` treats ANY
 * non-word byte -- including a literal NUL -- as a boundary, same as a real space, so
 * `/^ls\b/.test("ls\0rm -rf /")` is true even though the actual leading token is `ls\0rm`, not
 * `ls`. Without this guard that command would wrongly resolve to the built-in "ls" allowlist
 * (tier "low") instead of falling through to the fail-closed "unrecognized-token" default (tier
 * "high", still analyzable, still has an approval path -- see command-classifier.test.ts's
 * "null byte embedded" case). This is unrelated to T14's display-sanitization concern: the byte
 * here is being used to defeat VERB recognition, not to manipulate what a human sees.
 */
const LEADING_TOKEN_PATTERN = /^\S+/;

function hasControlCharacterInLeadingToken(trimmedCommand: string): boolean {
	const leadingToken = trimmedCommand.match(LEADING_TOKEN_PATTERN)?.[0] ?? "";
	for (let i = 0; i < leadingToken.length; i++) {
		const code = leadingToken.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function matchesBuiltinAllowlist(trimmedCommand: string): boolean {
	if (COMPOSITION_METACHARACTERS.test(trimmedCommand)) return false;
	if (hasControlCharacterInLeadingToken(trimmedCommand)) return false;
	return BUILTIN_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(trimmedCommand));
}

function matchPolicyGrant(
	trimmedCommand: string,
	allowlist: ClassifierAllowlistEntry[] | undefined,
): ClassifierAllowlistEntry | null {
	if (!allowlist) return null;
	return allowlist.find((entry) => entry.pattern === trimmedCommand) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Puro, síncrono, TOTAL: nunca lança — falha interna vira tier:"critical" (BR-1/BR-9/FR-4).
 */
export function classifyCommand(command: string, ctx: ClassificationContext): ClassificationResult {
	const displayCommand = command; // R2 — classify-what-you-show, always the untouched raw bytes.

	const malformedReason = detectMalformedInput(command);
	if (malformedReason) {
		return {
			tier: "critical",
			signals: [{ kind: "malformed-input", tier: "critical", detail: malformedReason }],
			provablyContained: false,
			hasUnanalyzableSpan: true,
			displayCommand,
		};
	}

	const trimmed = command.trim();
	const signals: TierSignal[] = [];

	const catastrophic = detectCatastrophicSignal(command);
	if (catastrophic) signals.push(catastrophic);

	signals.push(...detectIndirectionSignals(command));
	signals.push(...extractTargetSignals(command, ctx.workspace));

	if (signals.length === 0) {
		const grant = matchPolicyGrant(trimmed, ctx.policy?.allowlist);
		if (grant) {
			signals.push({
				kind: "policy-allowlist-grant",
				tier: grant.risk,
				detail: `matched policy.json allowlist grant "${grant.pattern}" (FR-3)`,
			});
		} else if (matchesBuiltinAllowlist(trimmed)) {
			signals.push({ kind: "allowlisted", tier: "low", detail: "matches a built-in known-safe command shape" });
		} else {
			signals.push({
				kind: "unrecognized-token",
				tier: "high",
				detail: "command-position token does not map to a recognized verb — fail-closed lexical default (R1)",
			});
		}
	}

	const tier = maxTier(signals.map((s) => s.tier));
	const provablyContained = signals.every((s) => CONTAINMENT_SAFE_KINDS.has(s.kind));
	const hasUnanalyzableSpan = signals.some((s) => UNANALYZABLE_KINDS.has(s.kind));

	return { tier, signals, provablyContained, hasUnanalyzableSpan, displayCommand };
}
