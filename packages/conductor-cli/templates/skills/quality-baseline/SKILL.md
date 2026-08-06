---
name: quality-baseline
description: "Use as a mandatory checkpoint before closing any implementation gate (6, 7, 8, 10). This skill defines the PROCEDURE — the categories of checks every feature must pass. The library provides current thresholds, specific validation rules, secure-coding patterns, and logging standards via cdt library queries per category."
---

# Skill — quality-baseline

**When to use:** As a mandatory checkpoint before advancing past Gate 6 (Implementation), Gate 7 (CI), Gate 8 (Validation), and Gate 10 (Release Readiness). This skill exists to catch what the AI will NOT catch on its own — the silent gaps that "work" in a demo but fail in production.

## How this skill uses the library (RAG)

This skill defines the **checklist categories** and the questions to ask. The
**knowledge** — specific validation rules, current security thresholds (token
entropy, password requirements, rate limits), secure-coding patterns for your
stack, logging standards, and test coverage expectations — comes from the
reference library.

Do NOT use hardcoded values for thresholds, entropy requirements, expiry times, or
specific OWASP categories. Query the library for the CURRENT recommendation.

## The six categories

| # | Category | Verifies |
|---|----------|----------|
| 1 | **Input Validation** | Every external input: type, length, format, range, ownership, injection. |
| 2 | **Error Handling** | Every external operation: timeout, retry, circuit breaker, fallback, logging. |
| 3 | **Test Coverage** | Every acceptance criterion and every error path; security payloads. |
| 4 | **No Hardcoded Assumptions** | Timeouts, URLs, secrets, limits, timezone, encoding externalized. |
| 5 | **Security Fundamentals** | Auth, authorization, token entropy/expiry/single-use, enumeration, secrets hygiene. |
| 6 | **Observability** | Errors logged with context, health check, metrics, trace_id propagation. |

### Exit-blocker mutation testing (Category 3 — verified before Gate 8 closes)

**What an exit blocker is.** A requirement (FR/NFR/BR/SR/AC) that the demand's
own Gate-2 spec, Gate-3 threat model, or Gate-4 ADR explicitly names as an exit
blocker, "the crux," or an equivalent must-hold clause — self-declared per
demand, not a fixed taxonomy.

**The obligation.** Every exit blocker the demand declares is mutation-tested
before Gate 8 closes: edit the source so the guarantee would be false, watch the
named test go RED, revert the source, and confirm the test is GREEN again.

**Evidence, not assertion.** "Done" means a table in the demand's own
`docs/qa/<demand>-coverage.md` names, per exit blocker, the mutation applied and
the tests that went RED; a survivor (a mutation no test kills) is recorded under
"Divergences / survivors" and dispositioned. A prose sentence asserting mutation
testing was performed, with no such table, is not sufficient.

**No declared exit blocker** (typically a collapsed-depth demand): record
`N/A — no exit-blocker requirements declared for this demand's depth` explicitly,
rather than leaving the item silently absent.

## Steps

1. **Load the detail.** Read [`references/checklist.md`](references/checklist.md)
   — it carries, per category, the library query to run, the direction to expect
   back, the procedure, and the red flags. Do not run the baseline from the table
   above alone: the table names the categories, the reference is the checklist.
2. **Run each category in order.** For every one: query the library for the
   current standard, apply the library's specific value/threshold/pattern to the
   code, and record pass/fail with the citation.
3. **Report gaps honestly.** If the library returns nothing for a category, say
   so and apply general engineering judgment — but flag the item as ungrounded
   rather than silently inventing a threshold.
4. **Close or block the gate.** Any failing item means the gate is NOT complete.
   Fix and re-verify before advancing.
5. **Record the outcome** with the citations and anything corrected:
   `cdt journal add --gate <N> --kind checkpoint "quality-baseline: <M> pass, <N> fail — library citations: <list>, corrected: <list>"`.

## Gate integration

| Gate | Scope |
|------|-------|
| **6** | All 6 categories — the code must pass before the gate closes. |
| **7** | Category 3 (tests pass in CI) + Category 4 (config from env, not code). |
| **8** | All 6 categories re-verified against the built artifact. |
| **10** | Category 5 (security fundamentals) + Category 4 (config) re-verified. |

**Reference books expected from the library:** *Clean Code* (Martin), *The Pragmatic Programmer* (Hunt/Thomas), *Building Secure and Reliable Systems* (Google), *OWASP ASVS* (current edition), *Release It!* (Nygard), *Site Reliability Engineering* (Google), *Continuous Delivery* (Humble/Farley).
