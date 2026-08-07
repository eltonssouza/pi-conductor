/**
 * Markdown chunking, by paragraph, respecting fenced code blocks -- PURE (docs/adr/0006-fase5-
 * library-and-grounding.md D8/§11.1: "chunking.ts -- parágrafo respeitando blocos de código -- PURA").
 *
 * GATE 5 (test-first): `chunkMarkdown` is a STUB that throws "not implemented" -- Gate 6 implements
 * the body. This file ships the signature test/chunking.test.ts and corpus-store.ts's ingestion path
 * already compile and test against.
 *
 * Reference behavior to MATCH OBSERVABLY, not to port (ADR §1.1's own framing: "referência de
 * comportamento, prior art e lista de defeitos"), is
 * `conductor-main/conductor/rag/core.py`'s `split_paragraphs`/`chunk_markdown`:
 *   - split on blank lines, EXCEPT while inside a ``` fence (`split_paragraphs`'s own fence-tracking
 *     loop -- "a listing with a blank line between two methods becomes two paragraphs... the opening
 *     ``` is embedded without its closing one" if this is ignored);
 *   - pack consecutive paragraphs into a chunk up to a target size (`CHUNK_TARGET_CHARS = 1500`),
 *     flush once the NEXT paragraph would exceed it, hard-cap a chunk at
 *     `CHUNK_MAX_CHARS = 2400`;
 *   - label a chunk with the heading in effect for its OWN FIRST paragraph, not the last heading seen
 *     anywhere inside it -- the reference's own docstring names the bug this avoids: "a chunk of
 *     front matter that happens to end with `### 1.1 Introduction` was embedded as if it were that
 *     introduction" (labeling at flush time, instead of when the chunk's first paragraph is
 *     appended, produces exactly that mislabel).
 */

/** One packed chunk of markdown, still carrying which heading was in effect when its OWN first
 * paragraph was appended (never a heading that only appears later, inside the same chunk). */
export interface MarkdownChunk {
	ordinal: number;
	/** The markdown heading in effect for this chunk's first paragraph; "" if none has been seen yet. */
	section: string;
	body: string;
}

export interface ChunkMarkdownOptions {
	/** Target chunk size in characters; a chunk is flushed once the next paragraph would exceed it. */
	targetChars?: number;
	/** Hard cap: a chunk is always flushed at or before this size. */
	maxChars?: number;
}

const FENCE_LINE = /^```/;
const HEADING_LINE = /^(#{1,6})\s+(.+)$/;

/** Splits `text` into paragraphs on blank lines, except while inside a ``` fence (a blank line
 * inside a fence is part of that paragraph, never a split point). */
function splitParagraphs(text: string): string[] {
	const lines = text.split("\n");
	const paragraphs: string[] = [];
	let current: string[] = [];
	let inFence = false;

	for (const line of lines) {
		if (FENCE_LINE.test(line.trim())) {
			inFence = !inFence;
			current.push(line);
			continue;
		}
		if (line.trim() === "" && !inFence) {
			if (current.length > 0) {
				paragraphs.push(current.join("\n"));
				current = [];
			}
			continue;
		}
		current.push(line);
	}
	if (current.length > 0) paragraphs.push(current.join("\n"));

	return paragraphs;
}

/** Extracts the heading text from a paragraph's OWN first line, e.g. "## Intro" -> "Intro"; `undefined`
 * if the paragraph's first line is not an ATX heading. */
function headingOf(paragraph: string): string | undefined {
	const firstLine = paragraph.split("\n", 1)[0]!.trim();
	const match = HEADING_LINE.exec(firstLine);
	return match ? match[2]!.trim().replace(/\s+#+$/, "") : undefined;
}

/**
 * Splits `text` into paragraph-packed chunks, never splitting a fenced (``` ... ```) code block
 * across two chunks, and labeling each chunk with the heading in effect for its own first paragraph.
 */
export function chunkMarkdown(text: string, options: ChunkMarkdownOptions = {}): MarkdownChunk[] {
	const targetChars = options.targetChars ?? 1500;
	const maxChars = options.maxChars ?? 2400;

	const paragraphs = splitParagraphs(text);
	const chunks: MarkdownChunk[] = [];

	let currentParagraphs: string[] = [];
	let currentLen = 0;
	let currentSection = "";
	let runningHeading = "";

	const flush = () => {
		if (currentParagraphs.length === 0) return;
		chunks.push({ ordinal: chunks.length, section: currentSection, body: currentParagraphs.join("\n\n") });
		currentParagraphs = [];
		currentLen = 0;
	};

	for (const paragraph of paragraphs) {
		const heading = headingOf(paragraph);
		if (heading !== undefined) runningHeading = heading;

		if (currentParagraphs.length > 0) {
			const wouldBeLen = currentLen + 2 + paragraph.length;
			if (wouldBeLen > targetChars) flush();
		}

		if (currentParagraphs.length === 0) {
			// The heading in effect for THIS chunk's first paragraph -- captured now, after this
			// paragraph's own heading-ness (if any) has already updated `runningHeading` above, but
			// never overwritten later by a heading that only appears further into the same chunk.
			currentSection = runningHeading;
			currentLen = paragraph.length;
		} else {
			currentLen = currentLen + 2 + paragraph.length;
		}
		currentParagraphs.push(paragraph);

		// Hard cap: a chunk is never carried past maxChars into the next paragraph decision, even if a
		// single atomic paragraph (never split) pushed it past the target.
		if (currentLen >= maxChars) flush();
	}
	flush();

	return chunks;
}
