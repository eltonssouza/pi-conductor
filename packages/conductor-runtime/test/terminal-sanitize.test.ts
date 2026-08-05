/**
 * Unit tests for the T14 sanitizer itself (gate3-fase1-addendum.md §2 T14, §3 secure default 11),
 * isolated from confirmOrDeny's wiring — see confirm.test.ts's "terminal sanitization (T14)" describe
 * block for proof that confirmOrDeny actually applies this at its ctx.ui.confirm() sink, and
 * permission-gate.test.ts for proof at each of the gate's four approval call sites.
 */

import { describe, expect, it } from "vitest";
import { sanitizeForTerminal } from "../src/terminal-sanitize.ts";

describe("sanitizeForTerminal", () => {
	it("leaves plain text completely unchanged", () => {
		expect(sanitizeForTerminal("hello.txt")).toBe("hello.txt");
		expect(sanitizeForTerminal("rm -rf /tmp/build-cache")).toBe("rm -rf /tmp/build-cache");
	});

	it("preserves newline and tab", () => {
		expect(sanitizeForTerminal("line one\nline two")).toBe("line one\nline two");
		expect(sanitizeForTerminal("col1\tcol2")).toBe("col1\tcol2");
	});

	it("strips a CSI sequence with parameters (e.g. SGR color code)", () => {
		expect(sanitizeForTerminal("\x1b[31mred text\x1b[0m")).toBe("red text");
	});

	it("strips a CSI cursor-movement sequence", () => {
		expect(sanitizeForTerminal("safe\x1b[2K\x1b[1Gunsafe")).toBe("safeunsafe");
	});

	it("strips a CSI private-mode sequence (e.g. hide cursor, ESC [ ? params)", () => {
		expect(sanitizeForTerminal("\x1b[?25lhidden cursor\x1b[?25h")).toBe("hidden cursor");
	});

	it("strips an OSC sequence terminated by BEL", () => {
		expect(sanitizeForTerminal("before\x1b]0;fake title\x07after")).toBe("beforeafter");
	});

	it("strips an OSC sequence terminated by ST (ESC \\)", () => {
		expect(sanitizeForTerminal("before\x1b]8;;https://evil.example\x1b\\link text\x1b]8;;\x1b\\after")).toBe(
			"beforelink textafter",
		);
	});

	it("strips a bare two-byte Fe escape (e.g. ESC c full reset)", () => {
		expect(sanitizeForTerminal("before\x1bcafter")).toBe("beforeafter");
	});

	it("strips a lone/malformed ESC that no specific pattern recognizes (defense in depth)", () => {
		// An incomplete CSI sequence (no final byte before the string ends) does not match the CSI
		// pattern, but the leftover ESC byte itself must still never survive.
		const result = sanitizeForTerminal("before\x1b[9");
		expect(result).not.toContain("\x1b");
	});

	it("strips C0 control bytes other than tab/newline (e.g. NUL, BEL, vertical tab)", () => {
		expect(sanitizeForTerminal("a\x00b\x07c\x0bd")).toBe("abcd");
	});

	it("strips carriage return (line-overwrite vector, not in the tab/newline allowlist)", () => {
		expect(sanitizeForTerminal("SAFE COMMAND\rDANGEROUS COMMAND")).toBe("SAFE COMMANDDANGEROUS COMMAND");
	});

	it("strips DEL (0x7F)", () => {
		expect(sanitizeForTerminal("a\x7fb")).toBe("ab");
	});

	it("strips C1 control bytes (0x80-0x9F)", () => {
		expect(sanitizeForTerminal("a\x9bb")).toBe("ab");
	});

	it("is idempotent — sanitizing already-clean text is a no-op", () => {
		const clean = "already clean text with\nnewlines\tand\ttabs";
		expect(sanitizeForTerminal(clean)).toBe(clean);
		expect(sanitizeForTerminal(sanitizeForTerminal(clean))).toBe(clean);
	});

	it("handles an empty string without throwing", () => {
		expect(sanitizeForTerminal("")).toBe("");
	});

	it("never throws regardless of input shape", () => {
		const adversarial = `${"\x1b".repeat(50)}[${"9;".repeat(50)}${"m".repeat(10)}`;
		expect(() => sanitizeForTerminal(adversarial)).not.toThrow();
	});
});
