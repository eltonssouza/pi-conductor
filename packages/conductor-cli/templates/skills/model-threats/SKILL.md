---
name: model-threats
description: "Use when assessing the security of a system or feature, by diagramming the system and trust boundaries, enumerating threats, evaluating risk, and proposing prioritized mitigations and secure defaults — grounding every non-trivial claim in the library via cdt library."
---

# Skill — model-threats

**When to use:** When assessing the security of a system or feature — at design time (Gate 3), before architecture decisions (Gate 4), and when scoping a pentest (Gates 9, 13, 14).

## How this skill uses the library (RAG)

This skill defines the **procedure** — what to do, in what order, and what questions
to ask. The **knowledge** — threat categories, risk scoring frameworks, current
attack techniques, and mitigation patterns — comes from the reference library.

**Pattern for every step below:**
1. Query the library for the current state of practice on that topic.
2. Apply the library's highest-scoring passage to your specific system.
3. Cite the book and passage in every journal entry.

The examples and framework names in this document are **illustrations** of what the
library should return. Always prefer the library's current answer over any hardcoded
reference here.

**Quick steps:**
1. Query the library for threat modeling methodology → diagram the system and trust boundaries.
2. Query the library for threat categories per element type → enumerate threats per trust boundary crossing.
3. Query the library for risk evaluation frameworks → score each threat (probability × impact).
4. Query the library for mitigation patterns per threat category → propose controls in priority order.
5. Query the library for detection and verification techniques → define how to verify each mitigation.

---

## Step 1 — Diagram the system and trust boundaries

**Library query:**
```bash
cdt library --gate 3 "threat modeling methodology: how to diagram a system and identify trust boundaries for security analysis"
```
**Expected direction:** The library should return passages from *Threat Modeling* (Shostack) covering Data Flow Diagrams, trust boundary identification, and the "what are we building / what can go wrong / what do we do about it / did we do a good job" framework. Apply the specific diagramming conventions from the book.

**Procedure (library-independent):**
- Draw a Data Flow Diagram (DFD) with: external entities, processes, data stores, data flows, and trust boundaries.
- Label every trust boundary explicitly. State assumptions.
- Deliverable: a text or Mermaid diagram with every trust boundary labeled.

---

## Step 2 — Enumerate threats per element

**Library query:**
```bash
cdt library --gate 3 "threat enumeration: STRIDE categories per element type crossing a trust boundary"
```
**Expected direction:** The library should return the STRIDE-per-element mapping from Shostack or similar. Use the exact threat categories the library provides — do not invent categories.

**Second query (if the system handles personal data):**
```bash
cdt library --gate 3 "privacy threat modeling: LINDDUN categories for personal data processing"
```
**Expected direction:** The library should return LINDDUN categories (Linkability, Identifiability, Non-repudiation, Detectability, Disclosure, Unawareness, Non-compliance). Apply these alongside STRIDE if PII is present.

**Third query (standing egress-consent question, BR6 — asked at every Gate 3, not case-by-case, regardless of whether PII is present):**
```bash
cdt library --gate 3 "secure defaults for content egress: fail-closed behavior and destination disclosure when a feature forwards reviewed content to another model or provider"
```
**Expected direction:** The library should return secure-by-default / fail-closed guidance (*Security Engineering Principles* §2.2/§2.9 — ship safe defaults, make insecurity an explicit opt-in choice) and why no single egress destination is safe for every deployment (§2.12) — apply these to resolve BR1–BR4 below for the feature in front of you. A positive answer feeds a concrete threat into the STRIDE table above (naturally Information Disclosure; secondarily Tampering/Repudiation when a second process alters the trust path or leaves no record).

**Procedure (egress-consent, library-independent):**
Standing question (egress-consent, BR6 — asked at every Gate 3, not case-by-case): does this
feature forward reviewed/user content to a model, provider, or process other than the one the
user is actively using? If yes:
  - disclose the real destination (BR1);
  - default to the same-provider floor (BR2);
  - fail closed if that floor is unreachable (BR3);
  - require explicit opt-in before any cross-provider egress proceeds (BR4).

Holds in attended (`/cdt`) and unattended (`/cdt-triage`) modes alike (BR5).

**Procedure (library-independent):**
- For every element crossing a trust boundary, enumerate threats using the categories from the library.
- Deliverable: threat table with `| ID | Element | Threat category | Description | Trust boundary |`.

---

## Step 3 — Evaluate risk

**Library query:**
```bash
cdt library --gate 3 "risk evaluation framework: how to score security threats by probability and impact"
```
**Expected direction:** The library should return risk scoring methodologies — DREAD, CVSS, or qualitative (Low/Medium/High/Critical) scales. Use the framework the library recommends for your context.

**Procedure (library-independent):**
- For each threat, apply the risk framework from the library.
- Rate probability and impact using the library's definitions for each level.
- Deliverable: risk matrix with `| ID | Threat | Likelihood | Impact | Risk Level | Priority |`.

---

## Step 4 — Propose mitigations

**Library query (one per high-priority threat category):**
```bash
cdt library --gate 3 "mitigation patterns for [threat category, e.g. injection / spoofing / information disclosure]"
```
**Expected direction:** The library should return specific control patterns — e.g., parameterized queries for injection, mTLS for spoofing, encryption + CSP for information disclosure. Propose controls in the library's recommended priority order (eliminate > engineering control > secure default > detective > compensating).

**Procedure (library-independent):**
- For each threat ≥ Medium priority, propose a mitigation using the pattern from the library.
- Each mitigation must specify: what, where (layer), how to verify, and residual risk.
- Deliverable: mitigation table.

---

## Step 5 — Define detection and lifecycle

**Library query:**
```bash
cdt library --gate 3 "how to verify security controls: detection and testing of mitigations"
```
**Expected direction:** The library should return approaches for verifying controls — automated tests, penetration testing cadence, canary tokens, audit logging, CSP reporting. Apply the verification method appropriate to each mitigation type.

**Procedure (library-independent):**
- For every mitigation: define detection (how you'd know it failed), verification cadence, and owner.
- Document as a living artifact in `.cdt/memory/records/decisions/threat-model-<system>.md`.
- Every security gate (3, 9, 13, 14) must re-read and update this document.

**Reference books expected from the library:** *Threat Modeling* (Shostack), *Security Engineering* (Anderson), *Building Secure and Reliable Systems* (Google), *The Art of Software Security Assessment* (Dowd), *MITRE ATT&CK Framework*.
