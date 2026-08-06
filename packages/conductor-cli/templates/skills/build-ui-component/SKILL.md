---
name: build-ui-component
description: "Use to create or adjust a UI component by defining states (default, loading, error, empty, focus), querying 15_templates_for_frontend for matching markup/token patterns, writing semantic accessible HTML, applying a robust responsive style, and testing accessibility."
---

# Skill — build-ui-component

**When to use:** To create or adjust a UI component.

**Steps:**
1. Define states (default, loading, error, empty, focus).
2. Read `.cdt/stack/*.md` → `## Visual direction`. If missing, invoke
   `choose-visual-direction` and stop for user approval before coding visuals.
3. Query Frontend Templates for matching markup/token patterns:
   `cdt library --category 15_templates_for_frontend --design-system <ds> "<screen/component intent>"`
   (use the recorded `design_system` / primary project when set). Cite the extract.
4. Structure semantic and accessible HTML.
5. Apply a robust, responsive layout and style aligned to the cited tokens.
6. Wire data with the minimum necessary fetching.
7. Test accessibility (keyboard, screen reader, contrast) and summarize results.
8. Keep one responsibility per file — separate template, styles, component logic,
   and tests into dedicated files (e.g. Angular `templateUrl`/`styleUrls` +
   `.spec.ts`; React: component + CSS module + test). Inline template/styles only
   for trivial components (icon, spinner, badge); split them out as they grow.
