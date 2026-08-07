/**
 * Test-first (Gate 5) for `chunkMarkdown` (src/chunking.ts) -- ADR 0006 §11.1, reference behavior in
 * `conductor-main/conductor/rag/core.py`'s `split_paragraphs`/`chunk_markdown` (matched OBSERVABLY,
 * not ported -- see src/chunking.ts's own header).
 *
 * `chunkMarkdown` is currently a STUB that throws "not implemented" -- every test below fails RED for
 * that one reason today (Gate 6 implements the body).
 */
import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/chunking.ts";

describe("chunkMarkdown -- never splits a fenced code block across two chunks", () => {
	it("keeps a fenced block containing a BLANK LINE intact in a single chunk (the exact bug naive blank-line splitting produces)", () => {
		const text = [
			"Some introductory prose before the listing.",
			"",
			"```ts",
			"function a() {}",
			"",
			"function b() {}",
			"```",
			"",
			"Some closing prose after the listing.",
		].join("\n");

		const chunks = chunkMarkdown(text);

		const fenceOwner = chunks.find((c) => c.body.includes("function a()"));
		expect(fenceOwner).toBeDefined();
		// The WHOLE fence (both function a and function b) must land in the SAME chunk as the one
		// that opens it -- never torn apart by the blank line in the middle of the code block.
		expect(fenceOwner!.body).toContain("function b()");
		// And the fence markers themselves must be balanced within that one chunk (open AND close
		// together, never just the opener with its closer pushed into the next chunk).
		const fenceMarkerCount = (fenceOwner!.body.match(/```/g) ?? []).length;
		expect(fenceMarkerCount % 2).toBe(0);
		expect(fenceMarkerCount).toBeGreaterThanOrEqual(2);
	});

	it("labels a chunk with the heading in effect for its OWN first paragraph, never a heading that only appears later in the same chunk", () => {
		// Reproduces the exact bug conductor-main/conductor/rag/core.py's chunk_markdown docstring
		// names: "a chunk of front matter that happens to end with `### 1.1 Introduction` was embedded
		// as if it were that introduction." Both paragraphs below are small enough to land in ONE
		// chunk (well under any reasonable target size), with the second heading appearing only at
		// the very end.
		const text = ["## Intro", "", "Some short introductory text.", "", "### 1.1 Introduction"].join("\n");

		const chunks = chunkMarkdown(text, { targetChars: 1500, maxChars: 2400 });

		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0]!.section).toBe("Intro");
		expect(chunks[0]!.section).not.toBe("1.1 Introduction");
	});

	it("splits prose on blank lines OUTSIDE any fence, packing multiple short paragraphs into one chunk up to the target size", () => {
		// 8 paragraphs of 400 chars each (3200 total): with a 1500-char target, expect the packer to
		// flush well before all 8 land in a single chunk, but still group several paragraphs per
		// chunk rather than emitting one chunk per paragraph.
		const paragraph = (n: number) => `Paragraph ${n}: ${"x".repeat(390)}`;
		const paragraphs = Array.from({ length: 8 }, (_, i) => paragraph(i));
		const text = paragraphs.join("\n\n");

		const chunks = chunkMarkdown(text, { targetChars: 1500, maxChars: 2400 });

		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks.length).toBeLessThan(paragraphs.length);
		for (const chunk of chunks) {
			expect(chunk.body.length).toBeLessThanOrEqual(2400);
		}
		// No paragraph is lost or duplicated across the chunk boundaries.
		const combined = chunks.map((c) => c.body).join("\n");
		for (const p of paragraphs) {
			expect(combined).toContain(p);
		}
	});

	it("assigns ordinals starting at 0 and increasing by 1 with no gaps", () => {
		const paragraph = (n: number) => `Paragraph ${n}: ${"x".repeat(390)}`;
		const text = Array.from({ length: 6 }, (_, i) => paragraph(i)).join("\n\n");

		const chunks = chunkMarkdown(text, { targetChars: 1500, maxChars: 2400 });

		expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
	});
});
