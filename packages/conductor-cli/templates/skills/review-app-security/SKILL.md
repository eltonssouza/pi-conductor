---
name: review-app-security
description: "Use to assess the security of an application, by mapping the attack surface, testing against current OWASP standards (ASVS/Top 10) as returned by the library, performing taint analysis, and delivering findings with severity, PoC, and concrete fix — grounding every check in the library via cdt library."
---

# Skill — review-app-security

**When to use:** To assess the security of an application — during code review (Gate 6), as a dedicated pentest (Gate 9), and when verifying fixes. Also the primary skill for Gates 13–14 (combined with `pentest-infrastructure`).

## How this skill uses the library (RAG)

This skill defines the **procedure** — the testing methodology, the structure of
findings, and what questions to ask. The **knowledge** — current OWASP standards,
specific test payloads, vulnerability classification, CVSS scoring methodology,
and current secure-coding patterns — comes from the reference library.

The ASVS levels, OWASP Top 10 categories, and specific test payloads referenced
below are **illustrations** of what the library should return at the time this
skill was written. The OWASP standards evolve (new Top 10 editions, ASVS updates).
Always query the library for the **current** version before testing.

**Quick steps:**
1. Query the library for current ASVS levels → choose the assessment level.
2. Query the library for attack surface mapping methodology → map every entry point.
3. Query the library for current OWASP Top 10 and ASVS controls → test each category.
4. Query the library for taint analysis techniques → trace source to sink.
5. Query the library for vulnerability scoring and reporting → deliver PoC with CVSS.
6. Query the library for secure fix patterns per vulnerability → provide remediation.

---

## Step 1 — Choose assessment level

**Library query:**
```bash
cdt library --gate 9 "OWASP ASVS levels: what each level requires and when to apply them"
```
**Expected direction:** The library should return the ASVS level definitions — Level 1 (opportunistic), Level 2 (standard, for apps with sensitive data), Level 3 (advanced, for critical apps). Apply the library's current criteria, not any hardcoded threshold here.

**Procedure (library-independent):**
- Ask the user which level (or state your assumption and why).
- Record: `cdt journal add --gate 9 --kind decision "ASVS level: <level> — reason: <why>"`.

---

## Step 2 — Map the attack surface

**Library query:**
```bash
cdt library --gate 9 "attack surface mapping: how to inventory entry points and trust boundaries in a web application"
```
**Expected direction:** The library should return methodology from *The Web Application Hacker's Handbook* or *The Art of Software Security Assessment*. Apply the mapping approach — inventory entry points, document data flows, note auth context per entry point.

**Procedure (library-independent):**
- Inventory every entry point: HTTP endpoints, file uploads, CLI args, message queues, webhooks.
- For each: document input → validation → processing → storage/output, and auth context.
- Deliverable: `attack-surface.md`.

---

## Step 3 — Test against current OWASP standards

**Library query (repeat per category):**
```bash
cdt library --gate 9 "OWASP ASVS [section, e.g. V2 Authentication] verification requirements and testing guide"
```
**Expected direction:** The library should return the current ASVS requirements for that section. Use the library's exact requirement IDs and descriptions. Do NOT use a hardcoded checklist from this skill — the ASVS version in the library may be newer.

**Procedure (library-independent):**
- For each ASVS category returned by the library: test the application against each requirement.
- Document: requirement ID, status (pass/fail/not applicable), evidence.
- Categories to query (repeat the library call for each): Authentication (V2), Session Management (V3), Access Control (V4), Input Validation (V5), Output Encoding (V6), Cryptography (V7), Error Handling & Logging (V8), Data Protection (V9), Communications (V10), Business Logic (V11), Files & Resources (V12), API & Web Services (V13), Configuration (V14).

**Additional query for the current Top 10:**
```bash
cdt library --gate 9 "OWASP Top 10 current edition: categories and testing approach"
```

---

## Step 4 — Taint analysis

**Library query:**
```bash
cdt library --gate 9 "taint analysis methodology: tracing user input from source to dangerous sink"
```
**Expected direction:** The library should return source→sink tracking methodology. Apply the library's approach for each user-controlled input.

**Procedure (library-independent):**
- For every user input: trace from where it enters (source) to where it's used dangerously (sink).
- Document as a table: source → sink → attack class → status.

---

## Step 5 — Findings: PoC and severity

**Library query:**
```bash
cdt library --gate 9 "vulnerability severity scoring: CVSS methodology and reporting standards"
```
**Expected direction:** The library should return the current CVSS version methodology. Use the library's scoring framework — not a hardcoded CVSS version from this skill.

**Procedure (library-independent):**
- For every finding, produce a structured report with: title, severity (using library's framework), CVSS vector (using library's version), CWE, affected component, description, steps to reproduce, PoC (request + response), remediation (see Step 6), and references.
- Record: `cdt journal add --gate 9 --kind error "F-XXX: <title> — <severity>"`.

---

## Step 6 — Remediation and CI integration

**Library query (per vulnerability class):**
```bash
cdt library --gate 9 "secure fix for [vulnerability, e.g. SQL injection / XSS / IDOR]: current best practice and code pattern"
```
**Expected direction:** The library should return the current secure-coding pattern for that vulnerability class. Apply the library's pattern — do not use a hardcoded pattern from this skill.

**Procedure (library-independent):**
- Provide the fix as a diff + reusable pattern (using the library's recommended approach).
- Verify: re-run PoC → confirm it no longer works. Run SAST → finding gone. Write regression test.
- Recommend CI integration: which tools (SAST/DAST/SCA) and at what blocking threshold. Query the library for current tool recommendations and thresholds.

**Reference books expected from the library:** *The Web Application Hacker's Handbook* (Stuttard/Pinto), *OWASP ASVS* (current edition), *OWASP Testing Guide*, *The Tangled Web* (Zalewski), *The Art of Software Security Assessment* (Dowd), *Iron-Clad Java* (Manico/Detlefsen), *Secure by Design* (Deogun/Johnsson/Sawano).
