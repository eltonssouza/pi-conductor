# quality-baseline — the six categories in full

Load this file when you are running the baseline. `SKILL.md` names the six
categories and the gate scope; this is the detail for each one.

**Pattern for every item below:**
1. Query the library for the current standard on that topic.
2. Apply the library's specific value/threshold/pattern to the code.
3. If the library returns nothing (gap), state it explicitly and apply general
   engineering judgment — but flag it as ungrounded.

Do NOT use hardcoded values for thresholds, entropy requirements, expiry times,
or specific OWASP categories. Query the library for the CURRENT recommendation.

---

## 1 — Input Validation

**Library query:**
```bash
cdt library --gate 6 "input validation requirements for [language] [framework]: type, length, format, range, and ownership checks — current ASVS or equivalent standard"
```
**Expected direction:** The library should return the current ASVS V5 requirements or equivalent. Apply the library's specific validation rules and regex patterns.

**Procedure (library-independent):**
- Check every external input against the library's validation standard.
- Verify: type, length, format, range, ownership, injection prevention, unicode handling.
- Red flags: raw input reaching DB, validation only on frontend, IDOR via path param, file upload without magic-byte check.

---

## 2 — Error Handling

**Library query:**
```bash
cdt library --gate 6 "error handling patterns in [language] [framework]: timeout, retry, circuit breaker, fallback, and logging — current best practice"
```
**Expected direction:** The library should return current patterns from *Release It!* (Nygard), *Clean Code* (Martin), or language-specific guides. Apply the library's timeout values and retry strategies.

**Procedure (library-independent):**
- For every external operation (DB, API, SMTP, file I/O): verify explicit error handling.
- Check: timeout configured, retry with backoff, circuit breaker, fallback or degrade, error logged with context.
- Red flags: swallowed exceptions, `return null` on error, no timeout, stack trace in HTTP response.

---

## 3 — Test Coverage

**Library query:**
```bash
cdt library --gate 6 "test coverage expectations and test pyramid: what should be tested at unit, integration, and e2e levels — current best practice"
```
**Expected direction:** The library should return test strategy guidance from *Agile Testing*, *xUnit Test Patterns*, or *Unit Testing* (Khorikov). Apply the library's pyramid distribution.

**Procedure (library-independent):**
- Verify: every Given/When/Then has a test, every error path has a test, tests are deterministic.
- Verify security tests: SQLi, XSS, path traversal, IDOR with malicious payload.
- Red flags: happy-path-only tests, manual-only verification, mocked-everything tests with no integration.

---

## 4 — No Hardcoded Assumptions

**Library query:**
```bash
cdt library --gate 6 "configuration management and environment-specific values: how to externalize timeouts, URLs, keys, limits from code — current best practice"
```
**Expected direction:** The library should return configuration patterns from *Continuous Delivery* or *The Pragmatic Programmer*. Apply the library's approach.

**Procedure (library-independent):**
- Verify: timeouts from config, URLs from env, secrets from vault, limits configurable, UTC everywhere, UTF-8 everywhere, forward-slash paths.
- Red flags: `localhost` in code, hardcoded ports, `new Date()` without UTC, `Thread.sleep`.

---

## 5 — Security Fundamentals

**Library query:**
```bash
cdt library --gate 6 "OWASP ASVS minimum security requirements: authentication, token security, user enumeration prevention, secrets hygiene — current requirements for [ASVS level]"
```
**Expected direction:** The library should return the current ASVS requirements for your chosen level. Apply the library's specific requirements for token entropy, expiry, rate limiting, and enumeration prevention. Do NOT use hardcoded values.

**Procedure (library-independent):**
- Verify: auth on every protected endpoint, authorization (ownership) on every resource access, tokens have library-specified entropy and expiry, tokens are single-use, user enumeration prevented (identical responses), rate limiting on auth endpoints, no secrets in code/logs/responses, HTTPS everywhere, CSP present (web), CORS not wildcard on auth endpoints.
- Red flags: password in log, token in URL path, SQL concatenation, different response for valid/invalid email, token without expiry, token reusable.

---

## 6 — Observability

**Library query:**
```bash
cdt library --gate 6 "observability and logging standards: what to log, at what level, with what context, and health check endpoint requirements — current best practice"
```
**Expected direction:** The library should return observability patterns from *Site Reliability Engineering*, *Observability Engineering*, or *Systems Performance*. Apply the library's logging structure and health check design.

**Procedure (library-independent):**
- Verify: every error logged with context (timestamp, endpoint, operation, trace_id — never PII/secrets), key user actions logged, health check endpoint, metrics exposed, trace_id propagated.
- Red flags: `console.log(error)`, no timestamp, no context, no health check, synchronous blocking logging.

---

**Reference books expected from the library:** *Clean Code* (Martin), *The Pragmatic Programmer* (Hunt/Thomas), *Building Secure and Reliable Systems* (Google), *OWASP ASVS* (current edition), *Release It!* (Nygard), *Site Reliability Engineering* (Google), *Continuous Delivery* (Humble/Farley).
