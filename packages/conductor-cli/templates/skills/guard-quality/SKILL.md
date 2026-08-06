---
name: guard-quality
description: "Use to guard a project's quality as it grows: author/extend browser-driven Playwright tests per screen or feature, detect console errors, failed network requests, and accessibility/standardization defects, run the full suite so a new feature never breaks existing behavior, and keep a living coverage registry."
---

# Skill — guard-quality

**When to use:** When a feature is added or changed, or on demand, to guarantee the screens still work, no new console/network errors appear, accessibility/standardization holds, and nothing regressed. Grows the project's test coverage instead of testing ad hoc.

**Steps:**
1. **Orient** — read `.cdt/stack/<type>.md` for the framework, `.cdt/qa/coverage.md` for what is already covered, and `cdt journal recall "what did QA already test/find here?"` for prior defects and decisions. Don't re-derive known coverage.
2. **Author/extend the spec** — for a UI screen/flow, add or grow a Playwright spec under `.cdt/e2e/tests/` (Page Object Model, stable `getByRole`/`data-testid`, seed via API/fixtures, wait on conditions). For a **service/API**, add an endpoint entry to `.cdt/api/tests/regression.spec.ts` asserting its contract (status + JSON shape).
3. **Attach the guards** — wire `e2e/support/monitors.ts`: a console monitor (`console` error + `pageerror`) asserting **zero** console errors, and a network monitor (`requestfailed` + `4xx/5xx`) asserting no unexpected failed requests on the affected screens.
4. **Scan accessibility/standardization** — run `@axe-core/playwright` on the new/changed screens; report contrast, role/label, focus, and touch-target violations, plus any divergence from the project's established components/states.
5. **Run the FULL suite** — `npx playwright test` (headless, `E2E_BASE_URL` set). The change is accepted only if every existing spec still passes AND there are zero new console errors, zero new failed requests, and no new a11y violations. A break or new error fails the gate.
6. **Record & grow** — update `.cdt/qa/coverage.md` (screens/features covered, smoke vs e2e status, gaps) and `cdt journal add --gate <N> --kind checkpoint "qa-guardian: <passed>/<total>, <defects> defect(s), <a11y> issue(s)"` so the coverage compounds across sessions.
