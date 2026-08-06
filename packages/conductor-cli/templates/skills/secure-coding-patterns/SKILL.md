---
name: secure-coding-patterns
description: "Use to apply concrete secure-coding patterns during implementation (Gate 6). This skill defines the PATTERN CATEGORIES to apply; the library provides the CURRENT code examples, language-specific APIs, and version-specific best practices via cdt library queries per pattern."
---

# Skill — secure-coding-patterns

**When to use:** During implementation (Gate 6), code review, and whenever a `review-app-security` finding requires a secure-coding fix.

## How this skill uses the library (RAG)

This skill defines **which patterns to apply** and in what order. The **knowledge** —
specific code examples, language-specific secure APIs, current library versions and
their secure defaults, and the latest OWASP Cheat Sheet recommendations — comes
from the reference library.

Language ecosystems evolve: new framework versions change default behaviors,
deprecated APIs are replaced, and new vulnerability classes emerge. Do NOT use
hardcoded code examples. For each pattern, query the library for the current
best practice in your language and framework version.

**Pattern for every pattern below:**
1. Query the library: `cdt library --gate 6 "secure [pattern name] in [language] [framework version]: current best practice with code example"`
2. Apply the library's code pattern — not a hardcoded example from this skill.
3. Cite the source in the code comment or commit message.

**Core patterns to apply (query the library for each):**
1. Input Validation — validate type, length, format, range, and ownership at every entry point.
2. SQL Injection Prevention — parameterized queries; for dynamic identifiers, whitelist mapping.
3. Output Encoding (XSS Prevention) — context-aware encoding for HTML, JS, CSS, URL.
4. Authentication & Session Security — password storage, session cookies, JWT, MFA.
5. Authorization (Access Control) — check on every request, server-side, deny by default.
6. Cryptography — encryption at rest and in transit, hashing, random generation.
7. Error Handling & Logging — safe error responses, security event audit trail, no secrets in logs.
8. File I/O — path traversal prevention, file type validation, upload security.
9. Secrets Management — vault/env, never in code, .gitignore, pre-commit scanning.
10. Concurrency & Race Conditions — atomic operations, idempotency, TOCTOU prevention.

---

## Philosophy (library-independent principles)

These principles are timeless and do not depend on specific library versions:

- **Validate at the boundary.** Trust nothing from outside the process.
- **Encode at the output.** Context-aware encoding prevents injection at rendering.
- **Fail securely.** Deny by default. Fail closed.
- **Least privilege.** Code runs with minimum permissions needed.
- **Defense in depth.** Never rely on a single control.

---

## Pattern 1 — Input Validation

**Library query:**
```bash
cdt library --gate 6 "input validation in [language] [framework]: current best practice for validating HTTP parameters, headers, body, file uploads including type/length/format/range checks"
```
**Expected direction:** The library should return framework-specific validation approaches — e.g., Bean Validation/Jakarta for Java, Pydantic for Python/FastAPI, Zod for TypeScript. Apply the library's recommended approach.

---

## Pattern 2 — SQL Injection Prevention

**Library query:**
```bash
cdt library --gate 6 "SQL injection prevention in [language] with [ORM/database library]: parameterized queries and safe dynamic query construction"
```
**Expected direction:** The library should return the ORM's parameter binding API and safe patterns for dynamic ORDER BY / GROUP BY. Apply the library's approach — never string-concatenate user input into SQL.

---

## Pattern 3 — Output Encoding (XSS Prevention)

**Library query:**
```bash
cdt library --gate 6 "XSS prevention in [frontend framework / template engine]: context-aware output encoding for HTML body, HTML attribute, JavaScript, CSS, and URL contexts"
```
**Expected direction:** The library should return the framework's auto-escaping behavior and the safe way to handle rich text (e.g., DOMPurify for React, th:text for Thymeleaf). Always use the framework's built-in encoding.

---

## Pattern 4 — Authentication & Session Security

**Library query:**
```bash
cdt library --gate 6 "password storage in [language]: current recommended algorithm (Argon2/bcrypt/scrypt) with appropriate cost factors and secure session cookie configuration (HttpOnly, Secure, SameSite)"
```
**Expected direction:** The library should return the current password hashing recommendation and session security configuration. Apply the library's algorithm and cost factor.

---

## Pattern 5 — Authorization

**Library query:**
```bash
cdt library --gate 6 "authorization and access control in [language] [framework]: how to enforce ownership checks, role-based access, and deny-by-default on every endpoint"
```
**Expected direction:** The library should return the framework's authorization mechanisms. Apply deny-by-default with explicit allow rules.

---

## Pattern 6 — Cryptography

**Library query:**
```bash
cdt library --gate 6 "cryptography best practice in [language]: current recommended algorithms for encryption at rest (AES mode), TLS configuration, hashing, and secure random generation"
```
**Expected direction:** The library should return current algorithm recommendations and their API usage. Never use custom crypto, deprecated algorithms (MD5, SHA-1, DES, ECB), or insecure random sources.

---

## Pattern 7 — Error Handling & Logging

**Library query:**
```bash
cdt library --gate 6 "secure error handling and logging in [language] [framework]: how to return safe error responses without information disclosure and log security events without leaking PII/secrets"
```
**Expected direction:** The library should return patterns for safe error responses (generic messages to client, details to server log) and structured logging with security event tracking.

---

## Pattern 8 — File I/O

**Library query:**
```bash
cdt library --gate 6 "secure file upload and path traversal prevention in [language] [framework]: file type validation by magic bytes, safe path resolution, storage outside web root, size limits"
```

---

## Pattern 9 — Secrets Management

**Library query:**
```bash
cdt library --gate 6 "secrets management best practice: how to inject secrets at runtime, config management, and pre-commit secret scanning"
```

---

## Pattern 10 — Concurrency & Race Conditions

**Library query:**
```bash
cdt library --gate 6 "race condition prevention in [language] [database]: atomic operations, SELECT FOR UPDATE, idempotency keys for write operations"
```

**Reference books expected from the library:** *Clean Code* (Martin), *Iron-Clad Java* (Manico/Detlefsen), *Secure by Design* (Deogun/Johnsson/Sawano), *OWASP Cheat Sheet Series* (current edition), *The Art of Software Security Assessment* (Dowd), *The Web Application Hacker's Handbook* (Stuttard/Pinto), *OWASP ASVS* (current edition).
