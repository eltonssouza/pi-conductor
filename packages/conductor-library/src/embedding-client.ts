/**
 * Embedding client: HTTP to Ollama's local `/api/embed` (`bge-m3`, 1024-d) -- BORDA: local network
 * (docs/adr/0006-fase5-library-and-grounding.md D1/D8, §3.1, §11.1).
 *
 * GATE 5 (test-first) scope note: this file is part of D8's EXACT package layout (§11.1) and exists
 * so `packages/conductor-library/src/index.ts` exports a complete, structurally-consistent package --
 * but it has NO dedicated Gate-5 test file in this round, for the same reason `corpus-store.ts`
 * defers: it is real-HTTP integration surface (request/response shape against a live or fake Ollama
 * server), not pure policy, and is deferred to the round that wires the corpus store and the real
 * `library ingest/search` commands together (documented here, not silently dropped).
 */

export {};
