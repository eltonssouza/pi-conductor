---
name: assess-privacy
description: "Use when analyzing personal data processing by mapping data flows, purpose, and legal basis as defined by current regulation (LGPD/GDPR/CCPA) in the library, checking minimization, retention, and transparency, conducting a DPIA/RIPD where high risk exists, defining privacy-by-design controls, and operationalizing data-subject rights — grounding every legal reference in the library via cdt library."
---

# Skill — assess-privacy

**When to use:** When analyzing personal data processing — at design time (Gate 3), before launching features that collect data, and when responding to a privacy incident.

## How this skill uses the library (RAG)

This skill defines the **procedure** — the structure of privacy analysis, the DPIA
template, and the data-subject rights operationalization. The **knowledge** —
specific legal bases, retention periods, fine amounts, regulatory articles, and
privacy-enhancing techniques — comes from the reference library.

Privacy regulations evolve (LGPD updates from ANPD, GDPR interpretations from CJEU,
new state laws like CCPA/CPRA amendments). Do NOT use hardcoded legal references.
Always query the library for the current regulation text applicable to your
jurisdiction.

**Quick steps:**
1. Query the library for the regulation applicable to your jurisdiction → identify legal basis per data element.
2. Query the library for data minimization and retention standards → check each element.
3. Query the library for DPIA/RIPD methodology → conduct impact assessment if high risk.
4. Query the library for privacy-by-design and PETs → define controls.
5. Query the library for data-subject rights and breach notification obligations → operationalize.

---

## Step 1 — Map data, purpose, and legal basis

**Library query:**
```bash
cdt library --gate 3 "data protection regulation [LGPD / GDPR / CCPA] legal bases for processing personal data: what are the valid bases and when does each apply"
```
**Expected direction:** The library should return the current legal bases from the applicable regulation — LGPD Art. 7º, GDPR Art. 6, etc. Use the library's EXACT article numbers and definitions. Do not cite articles from memory.

**Second query (if sensitive data is involved):**
```bash
cdt library --gate 3 "[LGPD / GDPR] special categories of personal data: what qualifies as sensitive and what additional requirements apply"
```

**Procedure (library-independent):**
- For every personal data element: document category, source, purpose, legal basis (using library's article), retention, recipients, and cross-border status.
- For consent-based processing: verify it's freely given, specific, informed, unambiguous.
- For legitimate interest: conduct Legitimate Interest Assessment (LIA).
- Deliverable: `data-mapping.md`.

---

## Step 2 — Minimization, retention, and transparency

**Library query:**
```bash
cdt library --gate 3 "data minimization principle: how to assess whether data collection is necessary and proportional under [LGPD / GDPR]"
```
**Expected direction:** The library should return the minimization and proportionality tests from the applicable regulation and guidance from data protection authorities.

**Second query:**
```bash
cdt library --gate 3 "[LGPD / GDPR] retention periods: what are the legal requirements and recommended practices for data retention scheduling"
```

**Procedure (library-independent):**
- For each data element: check necessity, intrusiveness, and alternatives.
- Define retention schedule using library's guidance (not hardcoded periods).
- Draft privacy notice using the library's transparency requirements.
- Flag any element failing minimization. Deliverable: retention schedule and privacy notice.

---

## Step 3 — Conduct a DPIA / RIPD

**Library query:**
```bash
cdt library --gate 3 "DPIA / RIPD methodology: when is it mandatory under [LGPD / GDPR] and what structure should it follow"
```
**Expected direction:** The library should return the DPIA triggers and structure from the applicable regulation and DPA guidance (ANPD for LGPD, EDPB for GDPR). Use the library's structure — not a hardcoded template.

**Procedure (library-independent):**
- Determine if DPIA is required using the library's trigger criteria.
- If required, fill the library's recommended structure: context, data mapping, necessity, risk assessment, mitigation, compliance, approval.
- Document in `.cdt/memory/records/decisions/RIPD-<slug>.md`.

---

## Step 4 — Define privacy controls

**Library query:**
```bash
cdt library --gate 3 "privacy by design principles and privacy-enhancing technologies: current techniques for [pseudonymization / anonymization / differential privacy / on-device processing]"
```
**Expected direction:** The library should return PbD principles (Cavoukian) and PETs applicable to your data types. Apply the specific techniques the library recommends for your use case.

**Procedure (library-independent):**
- Apply each PbD principle to the system using the library's guidance.
- Select PETs based on the library's recommendation for your data sensitivity and use case.
- Implement operational controls: access logging, data export, account deletion, consent dashboard.

---

## Step 5 — Operationalize data-subject rights

**Library query:**
```bash
cdt library --gate 3 "[LGPD Art. 18 / GDPR Art. 15-22] data subject rights: what are they and what are the operational requirements and response deadlines"
```
**Expected direction:** The library should return the current rights, their scope, and the legal deadlines. Use the library's exact deadlines — do not use hardcoded values.

**Second query:**
```bash
cdt library --gate 3 "breach notification requirements under [LGPD / GDPR]: deadlines, content, and authority notification procedure"
```

**Procedure (library-independent):**
- For each right: define operational procedure and SLA using the library's deadlines.
- Pre-fill breach notification templates with company and DPO details.
- Maintain ROPA (Record of Processing Activities) using the library's required fields.
- Review every 6 months or whenever processing changes.

**Reference books expected from the library:** *The EU GDPR — A Practical Guide* (Voigt), *Practical Data Privacy* (Kamara), *The Privacy Engineer's Manifesto* (Dennedy), *Privacy's Blueprint* (Hartzog), *Strategic Privacy by Design* (Cavoukian), regulation-specific commentaries for your jurisdiction.
