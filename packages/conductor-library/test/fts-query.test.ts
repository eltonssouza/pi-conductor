/**
 * Test-first (Gate 5) for `buildFtsMatchExpression` (src/fts-query.ts) -- ADR 0006 D12/§15,
 * gate3-addendum-fase5.md T58/R39.
 *
 * `buildFtsMatchExpression` is currently a STUB that throws "not implemented" -- every test below
 * fails RED for that one reason today (Gate 6 implements the body).
 *
 * These tests run against REAL `node:sqlite` with a REAL `fts5` virtual table, in-memory
 * (`:memory:`) -- this is the deliberate "cheap, in-process real collaborator" case (Unit Testing
 * Principles §3.12, cited by the orchestrator's own grounding query this session: "when NOT to use a
 * test double"): SQLite's FTS5 query parser is exactly the thing under test (does a caller-supplied
 * question ever get reinterpreted as FTS5 syntax?), so faking it would test nothing real. `node:sqlite`
 * is a Node builtin (no new dependency) and this monorepo already has an in-repo precedent for
 * exercising it directly in tests (`packages/session-backends/sqlite-node`).
 *
 * Each scenario below reproduces one row of the architect's own empirically-verified table (ADR
 * §15.1 "raw" vs §15.2 "escaped") as a single test: first a CONTROL assertion against the RAW,
 * unescaped string (documenting the exact bug/quirk `buildFtsMatchExpression` exists to close),
 * then the assertion against `buildFtsMatchExpression`'s output for the SAME input, which is the
 * half that fails today.
 */
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildFtsMatchExpression } from "../src/fts-query.ts";

interface Doc {
	title: string;
	body: string;
}

function createFtsDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec("CREATE VIRTUAL TABLE docs USING fts5(title, body);");
	return db;
}

function insertDocs(db: DatabaseSync, rows: Doc[]): void {
	const stmt = db.prepare("INSERT INTO docs(title, body) VALUES (?, ?)");
	for (const row of rows) stmt.run(row.title, row.body);
}

function matchTitles(db: DatabaseSync, matchExpression: string): string[] {
	return db
		.prepare("SELECT title FROM docs WHERE docs MATCH ? ORDER BY rowid")
		.all(matchExpression)
		.map((row) => String(row.title));
}

let db: DatabaseSync | undefined;

afterEach(() => {
	db?.close();
	db = undefined;
});

describe("buildFtsMatchExpression (D12/§15) -- real node:sqlite FTS5, not mocked", () => {
	it('neutralizes a leading "NOT" so a legitimate question never throws the FTS5 syntax error it does raw (ADR §15.1/§15.2, T58/R39)', () => {
		db = createFtsDb();
		insertDocs(db, [
			{ title: "Resilience Patterns", body: "A bulkhead isolates a failing dependency so it cannot cascade." },
		]);

		// Control: the raw FTS5 parser treats a bare "NOT" as its boolean operator -- a syntax error,
		// verified empirically in the ADR, and exactly the auto-DoS T58/R39 exist to close.
		expect(() => matchTitles(db!, "NOT bulkhead")).toThrow(/fts5|syntax/i);

		// buildFtsMatchExpression must turn "NOT bulkhead" into OR'd literal terms, so the same
		// question never throws and still finds the document (fails today: stub throws "not implemented").
		const expression = buildFtsMatchExpression("NOT bulkhead", "OR");
		expect(matchTitles(db!, expression)).toEqual(["Resilience Patterns"]);
	});

	it('neutralizes a dangling "AND"/unterminated quote instead of the raw "unterminated string" error (ADR §15.1/§15.2)', () => {
		db = createFtsDb();
		insertDocs(db, [{ title: "Resilience Patterns", body: "A bulkhead isolates a failing dependency." }]);

		// Control: the raw parser throws on an unterminated quoted string.
		expect(() => matchTitles(db!, 'bulkhead AND "')).toThrow(/fts5|unterminated|syntax/i);

		const expression = buildFtsMatchExpression('bulkhead AND "', "OR");
		expect(matchTitles(db!, expression)).toEqual(["Resilience Patterns"]);
	});

	it('neutralizes "column:term" so MATCH no longer recognizes "title:" as a column-filter operator (ADR §15.1/§15.2)', () => {
		db = createFtsDb();
		insertDocs(db, [
			// "secret" lives in the BODY, not the title -- disambiguates column-filtered search from
			// plain term search.
			{ title: "Incident Runbook", body: "Rotate the credential; a secret leaked last week." },
		]);

		// Control: raw "title:secret" searches ONLY the title column -- it does not contain "secret",
		// so the raw query finds nothing.
		expect(matchTitles(db!, "title:secret")).toEqual([]);

		// Escaped, "title:secret" becomes two OR'd literal terms ("title" OR "secret") searched across
		// ALL columns -- the row matches via "secret" in the body, proving no column-filter survived.
		const expression = buildFtsMatchExpression("title:secret", "OR");
		expect(matchTitles(db!, expression)).toEqual(["Incident Runbook"]);
	});

	it('treats a trailing "*" as literal text instead of the FTS5 prefix operator (ADR §15.1/§15.2)', () => {
		db = createFtsDb();
		insertDocs(db, [{ title: "Incident Runbook", body: "A credential was leaked last week." }]);

		// Control: raw "lea*" is a prefix query and matches "leaked" by prefix expansion.
		expect(matchTitles(db!, "lea*")).toEqual(["Incident Runbook"]);

		// Escaped, "lea*" becomes the literal exact term "lea", which does not prefix-match "leaked".
		const expression = buildFtsMatchExpression("lea*", "OR");
		expect(matchTitles(db!, expression)).toEqual([]);
	});

	it('treats a leading "^" as literal text instead of the FTS5 column-initial-token operator (ADR §15.1/§15.2)', () => {
		db = createFtsDb();
		insertDocs(db, [
			{ title: "Circuit Breakers", body: "Trips before cascading failure." },
			{ title: "Retry Storms", body: "After a timeout storm, a circuit is tripped downstream." },
		]);

		// Control: raw "^circuit" only matches a column whose FIRST token is "circuit" -- row 1's
		// title starts with "Circuit"; row 2's body does not start with "circuit".
		expect(matchTitles(db!, "^circuit")).toEqual(["Circuit Breakers"]);

		// Escaped, "^circuit" becomes the literal term "circuit" -- position no longer matters, so
		// both rows match.
		const expression = buildFtsMatchExpression("^circuit", "OR");
		expect(matchTitles(db!, expression).sort()).toEqual(["Circuit Breakers", "Retry Storms"]);
	});

	it("treats a quoted phrase as OR'd literal terms instead of the FTS5 adjacency phrase operator (ADR §15.1/§15.2)", () => {
		db = createFtsDb();
		insertDocs(db, [{ title: "Secret Handling", body: "Store the api credential; never log the key in plaintext." }]);

		// Control: raw '"api key"' requires "api" immediately followed by "key" -- not adjacent here.
		expect(matchTitles(db!, '"api key"')).toEqual([]);

		// Escaped, the phrase becomes "api" OR "key" -- either literal term alone is enough to match.
		const expression = buildFtsMatchExpression('"api key"', "OR");
		expect(matchTitles(db!, expression)).toEqual(["Secret Handling"]);
	});

	it('produces the same recall as a literal "OR" query without relying on the caller\'s text being parsed as an operator (ADR §15.1/§15.2)', () => {
		db = createFtsDb();
		insertDocs(db, [
			{ title: "Bulkhead Pattern", body: "Isolates a failing dependency." },
			{ title: "Incident Runbook", body: "A credential leaked last week." },
			{ title: "Unrelated", body: "Nothing to see here." },
		]);

		// Control: the raw parser happens to interpret "OR" as the boolean operator here too.
		expect(matchTitles(db!, "bulkhead OR leaked").sort()).toEqual(["Bulkhead Pattern", "Incident Runbook"]);

		// With the function, "OR" is just a third literal term ORed alongside "bulkhead"/"leaked" by
		// the RUNTIME-authored join -- same recall here, but "OR" can never smuggle in a different
		// operator on a different input.
		const expression = buildFtsMatchExpression("bulkhead OR leaked", "OR");
		expect(matchTitles(db!, expression).sort()).toEqual(["Bulkhead Pattern", "Incident Runbook"]);
	});

	it("still matches an ordinary single-term question normally (baseline, no operator characters involved)", () => {
		db = createFtsDb();
		insertDocs(db, [{ title: "Resilience Patterns", body: "A bulkhead isolates a failing dependency." }]);

		const expression = buildFtsMatchExpression("bulkhead", "OR");
		expect(matchTitles(db!, expression)).toEqual(["Resilience Patterns"]);
	});
});
