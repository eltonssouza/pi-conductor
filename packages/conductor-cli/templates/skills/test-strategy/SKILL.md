---
name: test-strategy
description: "Use when planning the quality strategy for a feature, deriving examples from acceptance criteria, mapping coverage across the 4 quadrants, listing edge cases and error flows, and reporting prioritized risks and defects."
---

# Skill — test-strategy

**When to use:** When planning the quality strategy for a feature.

**Steps:**
1. Derive examples from acceptance criteria.
2. Map coverage across the 4 quadrants.
3. For a UI feature, name the critical user journeys and split them: a small
   **smoke** set (must pass to merge) vs the fuller **e2e** set — both run via a
   portable CLI runner (Playwright), never a harness-exclusive browser plugin.
4. List *edge cases* and error flows.
5. Execute targeted exploratory tests.
6. Report prioritized risks and defects.
