---
name: choose-visual-direction
description: "Use on greenfield or UI-first projects before inventing visuals: read the product description, query 15_templates_for_frontend for 2-3 candidate design-system extracts, ask the user to pick a primary and optional secondary reference, then record visual_direction in .cdt/stack and the journal."
---

# Skill — choose-visual-direction

**When to use:** Before the first screen/component is designed or coded on a
project that has (or will have) a UI — especially greenfield repos that only
have a description/PDF — or whenever `.cdt/stack/*.md` has no `## Visual
direction` block yet. Also when the user asks to pick/change the visual north
star or template bank (webflow / aura / mobbin / taskade).

**Steps:**
1. Load product intent: project notes under `AGENTS.md` (below the managed
   region), root `README*`, `*.pdf`, discovery/spec docs under
   `.cdt/memory/records/`, and `cdt journal recall "visual direction"`.
2. If `.cdt/config.json` has `"type": "unknown"` but the demand clearly has
   screens/UI, tell the user to promote the type (recommended: `fullstack`)
   via `cdt sync --type fullstack` so FE/UID/UX roles and e2e starter install;
   do not invent visuals until roles exist or the user explicitly declines.
3. Query the Frontend Templates corpus with product keywords (domain + UI
   shape: calculator, dashboard, CRM, form, pricing, landing, …):

   ```bash
   cdt library --category 15_templates_for_frontend -k 8 "<product keywords>"
   cdt library --category 15_templates_for_frontend --design-system taskade "<…>"
   cdt library --category 15_templates_for_frontend --design-system aura "<…>"
   cdt library --category 15_templates_for_frontend --design-system mobbin --collection screens "<…>"
   cdt library --category 15_templates_for_frontend --design-system webflow "<…>"
   ```

4. Present **2–3 candidates** to the user (design_system, project/slug, why it
   fits). Recommend one primary; optionally one secondary for contrast.
5. **HALT** for user approval of primary (+ optional secondary).
6. Write/update `## Visual direction` in the active stack file
   (`.cdt/stack/<type>.md`) using this shape:

   ```markdown
   ## Visual direction
   - **design_system:** <webflow|aura|mobbin|taskade>
   - **primary:** <project-slug from the extract>
   - **secondary:** <optional project-slug or _(none)_>
   - **rationale:** <one line>
   - **chosen:** <ISO date>
   ```

7. Record: `cdt journal add --gate <N> --kind decision "visual_direction: ds=<ds> primary=<slug> secondary=<slug|none>"`.
8. Later UI work (`design-visual-interface`, `build-ui-component`) MUST filter
   library queries with this `design_system` and bias toward the primary extract.
