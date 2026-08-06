---
name: design-visual-interface
description: "Use to design a screen or visual component by starting from content and information hierarchy, grounding tokens in 15_templates_for_frontend (after choose-visual-direction when needed), applying spacing/typography/color with purpose, defining all states and responsiveness, and checking contrast and visual accessibility."
---

# Skill — design-visual-interface

**When to use:** To design a screen or visual component.

**Steps:**
1. Start from content and information hierarchy.
2. Ensure a project visual direction exists — read `.cdt/stack/*.md` →
   `## Visual direction`. If empty, run `choose-visual-direction` first.
3. Ground concrete patterns in the corpus:
   `cdt library --category 15_templates_for_frontend --design-system <ds> "<hero|type scale|surfaces|components|motion>"`
   Prefer the recorded primary/secondary extracts; cite design_system + project.
4. Apply spacing, typography, and color with purpose from the cited tokens.
5. Define all states and responsiveness.
6. Check contrast and visual accessibility.
7. Align with *design system* tokens and technical feasibility (hand off to
   `build-ui-component` for implementation).
