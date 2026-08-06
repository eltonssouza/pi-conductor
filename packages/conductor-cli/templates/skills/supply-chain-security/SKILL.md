---
name: supply-chain-security
description: "Use to assess and harden the software supply chain — dependencies, build pipeline, artifact integrity, and delivery. This skill defines the PROCEDURE (SBOM generation, scanning, build hardening, signing, monitoring); the library provides current tool versions, SLSA level criteria, policy thresholds, and CVE databases."
---

# Skill — supply-chain-security

**When to use:** At Gate 7 (CI + quality gate), before any release (Gate 10), and as part of the security review (Gate 3). Also retroactively on existing projects.

## How this skill uses the library (RAG)

This skill defines the **procedure** — the phases of supply-chain hardening and the
categories of checks. The **knowledge** — current tool names and versions, SLSA
framework levels, CVE severity thresholds for blocking CI, SBOM format standards,
and signing tool commands — comes from the reference library.

Supply-chain tooling evolves faster than any other security domain. Do NOT use
hardcoded tool commands, policy thresholds, or framework levels. Query the library
for current recommendations.

**Quick steps:**
1. Query the library for SBOM standards and generation tools → produce SBOM for every artifact.
2. Query the library for vulnerability scanning tools and thresholds → scan for known CVEs.
3. Query the library for dependency hygiene practices → pin, lock, review, and proxy dependencies.
4. Query the library for SLSA framework and build hardening → harden the CI pipeline.
5. Query the library for artifact signing and verification → sign and verify every release artifact.
6. Query the library for continuous monitoring → deploy Dependency-Track or equivalent.

---

## Step 1 — Generate an SBOM

**Library query:**
```bash
cdt library --gate 7 "SBOM generation: current standard (SPDX vs CycloneDX) and recommended tool for [language/ecosystem]"
```
**Expected direction:** The library should return the current SBOM format recommendation and tool (Syft, cyclonedx plugins, etc.). Use the library's recommended format and tool.

**Procedure (library-independent):**
- Generate SBOM for every artifact type (container image, JAR, wheel, npm package, binary).
- Choose format per library recommendation (SPDX or CycloneDX).
- The SBOM is the foundation — you cannot secure what you haven't inventoried.

---

## Step 2 — Scan for known vulnerabilities

**Library query:**
```bash
cdt library --gate 7 "dependency vulnerability scanning: current recommended tools and blocking thresholds for Critical and High CVEs in CI"
```
**Expected direction:** The library should return current tool recommendations (Grype, Trivy, OSV-Scanner) and policy thresholds. Use the library's threshold for what blocks CI.

**Procedure (library-independent):**
- Scan SBOM and lockfiles for known CVEs using the library's recommended tool.
- Define blocking policy using the library's thresholds (e.g., "Critical CVE with available fix blocks merge").
- Additional checks: license violations, dependency age, unmaintained packages — threshold from library.

---

## Step 3 — Dependency hygiene

**Library query:**
```bash
cdt library --gate 7 "dependency management best practice: version pinning, lockfiles, hash checking, private registries, and vendoring strategies"
```
**Expected direction:** The library should return current practices for pinning (digest vs tag), lockfile usage, and registry/proxy setup. Apply the library's recommendation for your stack.

**Procedure (library-independent):**
- Pin all dependencies (Docker images by digest, packages by hash).
- Use lockfiles. Review dependency changes on every PR.
- Set up private registry/proxy per library recommendation.
- Vendor critical dependencies if the library recommends it for your risk profile.

---

## Step 4 — Build pipeline hardening

**Library query:**
```bash
cdt library --gate 7 "SLSA framework: current levels, requirements per level, and how to achieve SLSA 2-3 for [CI platform]"
```
**Expected direction:** The library should return the current SLSA level definitions (slsa.dev). Apply the library's requirements for your target level.

**Procedure (library-independent):**
- Target SLSA level per library recommendation (typically 2 for most projects, 3 for critical).
- Implement: signed commits, branch protection, CI secrets in vault, isolated ephemeral builds, pipeline as code, pinned CI actions.
- Generate SLSA provenance using the library's recommended tool.
- Reproducible builds per the library's guidance.

---

## Step 5 — Sign and verify artifacts

**Library query:**
```bash
cdt library --gate 7 "artifact signing and verification: current recommended tools (Cosign/Sigstore) and admission control for [Kubernetes / deployment target]"
```
**Expected direction:** The library should return current signing tools and verification mechanisms. Apply the library's tool and verify at deploy time.

---

## Step 6 — Continuous monitoring

**Library query:**
```bash
cdt library --gate 7 "continuous vulnerability monitoring: current platform recommendation (Dependency-Track or equivalent) and VEX (Vulnerability Exploitability eXchange) standard"
```
**Expected direction:** The library should return monitoring platform recommendation and VEX format. Upload SBOMs on every build. Publish VEX for non-exploitable CVEs.

**Procedure (library-independent):**
- Deploy the monitoring platform from library recommendation.
- Upload SBOM on every build via API.
- Publish VEX statements for CVEs that don't affect your usage. Justify explicitly.

---

## Integration with Conductor gates

- **Gate 7:** SBOM generation + CVE scan + secrets scan + dependency review + artifact signing — all blocking merge per library thresholds.
- **Gate 10:** Verify SBOM uploaded, zero Critical CVEs, artifacts signed, SLSA provenance verifiable.

**Reference books expected from the library:** *Building Secure and Reliable Systems* (Google, ch. 13), *Continuous Delivery* (Humble/Farley), *The DevOps Handbook*, *SLSA Framework* (slsa.dev), *NIST SP 800-204D*, *CIS Software Supply Chain Security Guide*.
