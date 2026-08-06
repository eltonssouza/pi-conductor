---
name: incident-response
description: "Use when a security incident is declared, to contain, investigate, eradicate, and recover — then run a blameless postmortem (Gate 12). This skill defines the IR PROCEDURE and lifecycle phases; the library provides current severity classification, notification deadlines, forensic techniques, and postmortem methodology."
---

# Skill — incident-response

**When to use:** When a security incident is detected or declared. Works in tandem with `security-program` (which defines the IR governance structure) — this skill is the operational playbook.

## How this skill uses the library (RAG)

This skill defines the **procedure** — the phases of incident response from detection
through postmortem. The **knowledge** — severity classification criteria, breach
notification deadlines per regulation, forensic evidence handling standards, and
blameless postmortem methodology — comes from the reference library.

Regulatory deadlines and forensic best practices evolve. Do NOT use hardcoded
timeframes or notification templates. Query the library for the current
requirements applicable to your jurisdiction and incident type.

**Quick steps:**
1. Query the library for incident severity classification → declare severity.
2. Query the library for containment techniques per attack type → stop the bleeding.
3. Query the library for forensic investigation methodology → determine scope and timeline.
4. Query the library for eradication and recovery procedures → remove attacker and restore.
5. Query the library for breach notification requirements → notify authorities and subjects.
6. Query the library for blameless postmortem methodology → learn and feed back to Gate 2.

---

## Phase 1 — Detection & Declaration

**Library query:**
```bash
cdt library --gate 12 "security incident severity classification: how to categorize incidents by impact and urgency"
```
**Expected direction:** The library should return severity classification criteria from *Building Secure and Reliable Systems* (Google, ch. 17) or *Site Reliability Engineering* (Google, ch. 14). Use the library's criteria for SEV-1 through SEV-4.

**Procedure (library-independent):**
- Acknowledge immediately. Verify with 2+ independent sources.
- Declare severity using the library's criteria. If in doubt, escalate one level up.
- Open dedicated incident channel. Assign IC and Scribe. Start timeline.

---

## Phase 2 — Containment

**Library query:**
```bash
cdt library --gate 12 "incident containment techniques for [attack type: credential compromise / RCE / data exfiltration / ransomware / DDoS]"
```
**Expected direction:** The library should return containment procedures specific to the attack type. Apply the library's containment steps — do NOT use generic steps from memory.

**Procedure (library-independent):**
- Stop further damage WITHOUT destroying evidence. Snapshot before reimaging.
- Credential compromise → rotate immediately. RCE → isolate host (keep memory). Data exfiltration → block egress. Ransomware → isolate, do NOT pay. DDoS → enable mitigation.
- Preserve evidence with chain of custody: disk images (SHA-256), memory dumps, logs to immutable storage.

---

## Phase 3 — Investigation

**Library query:**
```bash
cdt library --gate 12 "security incident investigation methodology: how to reconstruct timeline, determine initial access vector, and assess scope of compromise"
```
**Expected direction:** The library should return forensic investigation methodology. Apply the library's approach for timeline reconstruction and scope determination.

**Procedure (library-independent):**
- Build minute-by-minute timeline from all sources: cloud audit, app logs, DB logs, container/K8s events, CI/CD, email, EDR.
- Answer: initial access vector, first access time, attacker actions, data accessed/exfiltrated, persistence mechanisms, current presence.
- Evidence labeling: `YYYYMMDD-HHMM-<hostname>-<type>-<hash>.ext`.

---

## Phase 4 — Eradication

**Library query:**
```bash
cdt library --gate 12 "eradication procedures: how to systematically remove attacker footholds and verify the system is clean"
```
**Expected direction:** The library should return eradication methodology. Apply the library's checklist for credential rotation, persistence removal, and rebuilding from known-good images.

**Procedure (library-independent):**
- Rotate ALL credentials. Kill persistence mechanisms (accounts, SSH keys, cron jobs, web shells, OAuth grants, IAM roles).
- Rebuild compromised hosts from known-good image — never "clean" in place.
- Patch root cause. Re-scan. Monitor for 48h at elevated logging. Deploy canary tokens.

---

## Phase 5 — Recovery

**Library query:**
```bash
cdt library --gate 12 "incident recovery procedures: how to safely restore service and verify integrity after a security incident"
```

**Procedure (library-independent):**
- Restore from clean backup. Deploy with increased monitoring. Run full test suite + smoke tests.
- Monitor for 30 days at elevated verbosity — attacker may re-attack.

---

## Phase 6 — External Communication

**Library query:**
```bash
cdt library --gate 12 "data breach notification requirements under [LGPD / GDPR / CCPA / PCI-DSS]: deadlines, required content, and authority notification procedure"
```
**Expected direction:** The library should return the current notification deadlines and required content. Use the library's EXACT deadlines and templates — regulations change.

**Procedure (library-independent):**
- Confirm scope with DPO and Legal before notifying.
- Use the library's notification deadlines and content requirements.
- Pre-fill templates NOW (before an incident), not during one.

---

## Phase 7 — Postmortem (Gate 12 → Gate 2)

**Library query:**
```bash
cdt library --gate 12 "blameless postmortem methodology: structure, root cause analysis techniques, and how to convert learnings into spec requirements"
```
**Expected direction:** The library should return postmortem structure from *Site Reliability Engineering* (Google, ch. 15) or *The DevOps Handbook*. Apply the library's structure and 5-Whys methodology.

**Procedure (library-independent):**
- Within 5 business days: blameless postmortem with summary, timeline, root cause (5 Whys), what went well/poorly, action items with owner + deadline.
- Each action item feeds into Gate 2 as a new spec requirement or test.
- Record: `cdt journal add --gate 12 --kind decision "Postmortem: {slug} — {N} actions → Gate 2"`.

**Reference books expected from the library:** *Site Reliability Engineering* (Google), *The DevOps Handbook* (Kim et al.), *Building Secure and Reliable Systems* (Google), *Security Engineering* (Anderson), current data protection regulations for your jurisdiction.
