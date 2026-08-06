---
name: automate-tests
description: "Use to create or stabilize test automation across the pyramid — unit, integration, and end-to-end/smoke — writing observable-behavior tests, eliminating flakiness and test smells, and integrating into CI as a fast gate. E2E/smoke run via a plain test-runner CLI (Playwright/Cypress), harness-agnostic, never a harness-exclusive browser plugin."
---

# Skill — automate-tests

**When to use:** To create or stabilize test automation, including end-to-end
(e2e) and smoke tests that drive the real UI.

**Steps:**
1. Choose the right level in the pyramid for each case — unit, integration, then
   a thin top layer of e2e/smoke for the critical user journeys only.
2. Write tests against observable behavior (public API, rendered UI), not
   implementation details.
3. For e2e/smoke, use a **CLI test runner that any harness can drive over the
   shell** — Playwright (`@playwright/test`) is the default; Cypress is fine.
   Do **not** depend on a harness-exclusive browser plugin/MCP: the runnable
   artifact must be `npx playwright test` (or equivalent), portable across Claude
   Code, Codex, OpenCode, and Pi. A browser MCP, when present, may *help author*
   tests but is never the way they run.
4. Make selectors stable: prefer `getByRole` / `data-testid` over CSS/text so the
   suite survives design changes; organize flows with the Page Object Model.
5. Keep e2e deterministic: seed data via API/fixtures, isolate state, wait on
   conditions (never sleeps) — no *flakiness*, no *test smells*.
6. Integrate into CI as a fast *gate*: run headless (`npx playwright test`),
   publish the trace/report on failure; smoke is the merge-blocking subset.
7. Evaluate the suite by the regressions it catches, not by raw coverage.
