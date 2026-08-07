/**
 * FTS5 MATCH expression construction -- PURE (docs/adr/0006-fase5-library-and-grounding.md D12,
 * Apêndice §19).
 *
 * GATE 5 (test-first): `buildFtsMatchExpression` is a STUB that throws "not implemented" -- Gate 6
 * implements the body. This file ships the signature the rest of the package (corpus-store.ts's
 * search path, hybrid-search.ts's lexical stage) and test/fts-query.test.ts already compile and test
 * against.
 *
 * The finding this function exists to close (ADR §15.1, verified empirically against real
 * `node:sqlite` FTS5 this same Gate 4 session): binding a raw question string as the `MATCH ?`
 * parameter protects the SQL parser and NOT the FTS5 query-language parser -- they are two different
 * parsers. `NOT bulkhead` throws a syntax error; `title:secret` silently applies a column filter the
 * caller never asked for; `lea*`/`^circuit`/`"api key"` are silently reinterpreted as
 * prefix/column-anchor/phrase operators. A question in ordinary English or Portuguese ("does NOT
 * resolve", a quoted term) can carry any of these characters by accident -- this is simultaneously
 * an availability bug (T58/R39: a legitimate question derails the grounding channel with a thrown
 * syntax error) and a security one (R29: the enriched query concatenates repo-supplied project
 * type/stack, so a `title:`/`*`/`OR` there silently widens or narrows FR-4's filters without any
 * error surfaced, contradicting BR-8).
 *
 * The fix (ADR §15.2) is structural, not a stronger escape: tokenize the input by
 * `[^\p{L}\p{N}_]+` (discard every character that could be reinterpreted as an FTS5 operator or
 * punctuation), quote each surviving token as an FTS5 string literal (`"` doubled, wrapped in `"`),
 * and join them with an operator the RUNTIME chooses (`join`) -- never one smuggled in by the
 * caller's text. The caller only ever contributes VALUES; the QUERY STRUCTURE is authored here.
 * `buildFtsMatchExpression`'s own output is still passed to SQLite as a bound `MATCH ?` parameter --
 * binding remains necessary (it is what stops SQL-level injection into the surrounding statement) but
 * is not, by itself, sufficient for the FTS5 sub-language (ADR §15.1's own conclusion, and Web
 * Application Security -- Complete Professional Guide §1.12 "When not to reach for a bind parameter":
 * "the limit is on what a placeholder can carry ... the answer is a different structural control").
 */

/**
 * Builds an FTS5 `MATCH` expression from raw, untrusted question text: every token in `text` is
 * treated as inert data (a literal term to search for), never as FTS5 query syntax. `join` is chosen
 * by the caller (the runtime), never derived from `text` itself -- there is no way for `text` to
 * select `"AND"` over `"OR"` for its own tokens; every token is joined the same way.
 *
 * Returns a string meant to be passed to SQLite as a *bound* `MATCH ?` parameter (never concatenated
 * into the surrounding SQL statement -- that half of the defense is ordinary parameterization and is
 * the caller's job, same as any other bound value).
 */
export function buildFtsMatchExpression(text: string, join: "OR" | "AND"): string {
	const tokens = text.split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length > 0);
	const quoted = tokens.map((token) => `"${token.replace(/"/g, '""')}"`);
	return quoted.join(` ${join} `);
}
