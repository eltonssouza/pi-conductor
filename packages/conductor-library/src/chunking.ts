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

/**
 * Splits `text` into paragraph-packed chunks, never splitting a fenced (``` ... ```) code block
 * across two chunks, and labeling each chunk with the heading in effect for its own first paragraph.
 */
export function chunkMarkdown(text: string, options: ChunkMarkdownOptions = {}): MarkdownChunk[] {
	throw new Error("not implemented");
}
