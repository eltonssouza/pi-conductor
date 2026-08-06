---
name: security-program
description: "Use for strategy and risk at the organizational level, by inventorying assets, evaluating against current frameworks (NIST/ISO/SOC2) as returned by the library, prioritizing treatment by risk × cost, and defining policies with measurable metrics — grounding framework choices in the library via cdt library."
---

# Skill — security-program

**When to use:** For strategy and risk at the organizational level — defining the security program (Gate 3 CISO role), compliance gap analysis, audit preparation, and incident response governance.

## How this skill uses the library (RAG)

This skill defines the **procedure** — the structure of a security program, the
categories of controls, and how to measure them. The **knowledge** — which framework
to use, what specific controls each framework requires, current compliance
thresholds, and policy templates — comes from the reference library.

Frameworks evolve (NIST CSF 2.0, ISO 27001:2022, new SOC 2 criteria). Do NOT use
hardcoded control lists. Query the library for the current version.

**Quick steps:**
1. Query the library for asset inventory and risk mapping methodology → catalog what to protect.
2. Query the library for security frameworks (NIST CSF, ISO 27001, SOC 2) → choose one and map gaps.
3. Query the library for risk treatment and cost-justification → prioritize by risk × cost.
4. Query the library for security metrics and policy templates → define measurable policies.
5. Query the library for incident response governance → define roles, severity, and communication.

---

## Step 1 — Inventory assets and map risks

**Library query:**
```bash
cdt library --gate 3 "security asset inventory methodology: how to classify assets by criticality and map threat actors"
```
**Expected direction:** The library should return asset classification approaches and threat actor profiling from *Security Engineering* (Anderson) or *Building Secure and Reliable Systems* (Google). Apply the library's classification scheme.

**Procedure (library-independent):**
- Build asset inventory with: class, examples, owner, criticality.
- Map threat actors with: capability level, motivation.
- Deliverable: risk register.

---

## Step 2 — Evaluate against a framework

**Library query:**
```bash
cdt library --gate 3 "security framework comparison: NIST CSF vs ISO 27001 vs SOC 2 — which to use for [organization type, e.g. SaaS startup / regulated enterprise]"
```
**Expected direction:** The library should return guidance on framework selection based on organization context. Choose the framework the library recommends.

**Second query (with chosen framework):**
```bash
cdt library --gate 3 "[chosen framework, e.g. NIST CSF 2.0] controls and assessment criteria"
```
**Expected direction:** The library should return the current control categories and requirements. Map your organization against these — using the library's current version, not a hardcoded list.

**Procedure (library-independent):**
- Select one primary framework based on library recommendation.
- Map each control: current state, gap, priority, remediation.
- Deliverable: gap analysis.

---

## Step 3 — Prioritize treatment by risk × cost

**Library query:**
```bash
cdt library --gate 3 "risk treatment methodology: how to choose between mitigate, transfer, avoid, and accept — with cost justification"
```
**Expected direction:** The library should return risk treatment decision frameworks and cost-justification methods (ALE, ROSI). Apply the library's methodology for each risk above threshold.

**Procedure (library-independent):**
- For each risk above acceptable threshold: evaluate treatment options.
- Cost-justify using the library's methodology.
- Deliverable: treatment plan with ROSI or equivalent.

---

## Step 4 — Define policies with measurable metrics

**Library query:**
```bash
cdt library --gate 3 "security program metrics: how to define measurable security policies with KPIs"
```
**Expected direction:** The library should return approaches for security metrics — what to measure, how to set targets, and how to verify compliance. Apply the library's metric framework.

**Procedure (library-independent):**
- For each policy area (access control, vuln management, IR, secure development, third-party risk, training, data protection): define requirement, metric, target, and measurement method.
- Use the library's guidance for target values — do not hardcode specific numbers.

---

## Step 5 — Incident response governance

**Library query:**
```bash
cdt library --gate 3 "incident response governance: roles, severity classification, and escalation paths"
```
**Expected direction:** The library should return IR governance structures from *Building Secure and Reliable Systems* (Google, ch. 17) or *Site Reliability Engineering* (Google, ch. 14). Apply the library's role definitions and severity classification.

**Procedure (library-independent):**
- Define IR roles (IC, Tech Lead, Comms Lead, Scribe, Legal, Exec Sponsor).
- Define severity classification using the library's criteria.
- Pre-fill communication templates.
- Document in `.cdt/memory/docs/operations/incident-response.md`.

**Reference books expected from the library:** *Security Engineering* (Anderson), *Building Secure and Reliable Systems* (Google), *NIST CSF* (current edition), *ISO 27001* (current edition), *The DevOps Handbook* (Kim et al.), *Site Reliability Engineering* (Google).
