---
name: service-reliability
description: "Use to design, instrument, and maintain service reliability — from drafting SLIs/SLOs during architecture (Gate 4), through instrumentation and alerting (Gate 11), to blameless postmortems (Gate 12). This skill defines the PROCEDURE; the library provides current SLO targets, metric frameworks, alerting thresholds, and postmortem methodology."
---

# Skill — service-reliability

**When to use:** At Gate 4 (draft SLIs/SLOs during architecture), Gate 11 (instrument and operate), and Gate 12 (blameless postmortem). Also during incident response and reliability improvement sprints.

## How this skill uses the library (RAG)

This skill defines the **procedure** — the phases of reliability engineering and the
structure of SLOs, dashboards, alerts, and postmortems. The **knowledge** — specific
SLO targets, RED/USE metric definitions, alerting threshold formulas, error budget
policies, and postmortem templates — comes from the reference library.

SLO targets and alerting practices are context-dependent and evolve. Do NOT use
hardcoded SLO values (e.g., "99.9%"). Query the library for the appropriate
targets for your service's criticality and user expectations.

**Quick steps:**
1. Query the library for SLI/SLO methodology → draft SLIs per component at design time (Gate 4).
2. Query the library for error budget policy → define what happens when budget burns.
3. Query the library for observability instrumentation → implement metrics, logs, traces (Gate 11).
4. Query the library for alerting design → define actionable, symptom-based alerts with runbooks.
5. Query the library for blameless postmortem methodology → run postmortems and feed back to Gate 2 (Gate 12).

---

## Phase 1 — Design-time: SLIs and SLOs (Gate 4)

**Library query:**
```bash
cdt library --gate 4 "SLI and SLO methodology: how to identify user-facing service level indicators and set realistic objectives — current best practice from SRE"
```
**Expected direction:** The library should return the SLI/SLO framework from *Site Reliability Engineering* (Google, ch. 4–6). Apply the library's definitions: SLI = measurement, SLO = target, error budget = 100% − SLO.

**Procedure (library-independent):**
- Start from user-facing capabilities, not system internals. For each user action, identify an SLI candidate.
- Draft SLIs per architectural component boundary: availability, latency, throughput, correctness, quality.
- Propose SLOs using the library's guidance on what's realistic for your service type. Do NOT hardcode targets — query the library for your context.
- Anti-patterns: too many SLIs, SLO = 100%, SLIs measuring implementation not user experience, "we'll add monitoring later."

**Second query for error budget policy:**
```bash
cdt library --gate 4 "error budget policy: how to define spending thresholds and enforcement — what happens when the budget is 50%, 20%, 0% consumed"
```
**Expected direction:** The library should return error budget policy patterns. Apply the library's thresholds and enforcement actions.

Record: `cdt journal add --gate 4 --kind decision "SLOs drafted: <service> — SLIs: <list>, targets: <list> (per library guidance), error budget: <amount>"`.

---

## Phase 2 — Instrumentation (Gate 11)

**Library query:**
```bash
cdt library --gate 11 "observability instrumentation: RED and USE metrics, structured logging format, distributed tracing propagation, and dashboard design — current best practice"
```
**Expected direction:** The library should return instrumentation patterns from *Observability Engineering* (Majors/Fong-Jones/George) and *Site Reliability Engineering*. Apply the library's metric framework and logging structure.

**Procedure (library-independent):**
- Implement RED metrics (Rate, Errors, Duration) for every service and USE metrics (Utilization, Saturation, Errors) for every resource.
- Structured logging: JSON, with timestamp, level, message, service, trace_id. Never PII/secrets.
- Distributed tracing: trace_id generation/propagation, sampling strategy, error retention.
- Dashboards: 4 golden signals per service + business dashboard + SLO/error budget dashboard.
- Instrument what Gate 4 defined — this gate makes it measurable.

---

## Phase 3 — Alerting (Gate 11)

**Library query:**
```bash
cdt library --gate 11 "alerting design: how to create actionable, symptom-based alerts with appropriate thresholds, runbooks, and on-call rotation — current best practice"
```
**Expected direction:** The library should return alerting methodology from *Site Reliability Engineering* (ch. 11, Being On-Call). Apply the library's approach to alert on symptoms (user pain), not causes (CPU, memory).

**Procedure (library-independent):**
- Every alert: symptom-based, specific threshold, clear urgency (page vs ticket), runbook linked.
- Anti-patterns: alerting on CPU/memory instead of latency/errors, alerting on every 500 (rate-based instead), no runbook, alert fatigue (tune ruthlessly).

---

## Phase 4 — Postmortem and feedback (Gate 12)

**Library query:**
```bash
cdt library --gate 12 "blameless postmortem: structure, root cause analysis (5 Whys), action item tracking, and how to convert learnings into engineering improvements — current best practice"
```
**Expected direction:** The library should return postmortem culture guidance from *Site Reliability Engineering* (ch. 15) and *The DevOps Handbook*. Apply the library's structure.

**Procedure (library-independent):**
- Within 5 business days of any incident that triggered a page or exhausted error budget.
- Structure: summary, timeline (UTC), root cause (5 Whys), what went well/poorly, action items with owner + deadline.
- Each action → new spec requirement (Gate 2) or test (Gate 5).
- Quarterly SLO review: are targets still right? Post-feature review: new capability = new SLIs?
- Record: `cdt journal add --gate 12 --kind decision "Postmortem: {slug} — {N} actions → Gate 2"`.

**Reference books expected from the library:** *Site Reliability Engineering* (Google), *Observability Engineering* (Majors/Fong-Jones/George), *Systems Performance* (Gregg), *The DevOps Handbook* (Kim et al.), *Building Secure and Reliable Systems* (Google).
