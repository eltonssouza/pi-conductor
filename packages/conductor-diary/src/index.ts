/**
 * `@conductor/diary` public surface (docs/adr/0007-fase6-diary-and-capture.md D1/§16).
 *
 * GATE 5 (test-first): every function re-exported here is a STUB throwing "not implemented" -- see
 * each module's own header for what Gate 6 implements. Two Gate-5 streams share this package:
 * journal-entry.ts/journal-writer.ts/journal-reader.ts (the fs edge: entries.jsonl source of truth) and
 * recall.ts/search.ts/digest.ts/capture.ts (recall/search/digest/automatic capture, PARALLEL Gate 5
 * work). Both import shared types from journal-entry.ts rather than redeclaring them (see that file's
 * own "TYPE-OWNERSHIP DECISION" header note).
 */

export * from "./capture.ts";
export * from "./digest.ts";
export * from "./journal-entry.ts";
export * from "./journal-reader.ts";
export * from "./journal-writer.ts";
export * from "./recall.ts";
export * from "./search.ts";
