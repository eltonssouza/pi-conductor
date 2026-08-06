# Skill authoring spec (load when writing a harvested skill)

Read this only when you are actually writing a skill (step 6 of `SKILL.md`). It is
the full spec the write brief points to: the exact shape a Conductor skill must
take, how to write each part well, and a self-validation checklist to run before
you finish.

## The shape (non-negotiable — the validator enforces it)

Conductor skills are validated by `tools/validate.py` (rules R2, R3, R6). A skill
that breaks the shape will not load and will fail CI. Match this exactly:

```markdown
---
name: <kebab-case>
description: "<single line, double-quoted, no unescaped internal quotes>"
---

# Skill — <name>

**When to use:** <one paragraph: the trigger — the situation that should make a
future agent reach for this skill>.

**Steps:**
1. <imperative step>
2. <imperative step>
...
```

Hard rules the shape must satisfy:

- **`name` == the directory name**, kebab-case only (`^[a-z0-9]+(-[a-z0-9]+)*$`):
  lowercase `a-z`/`0-9`/hyphens, no leading/trailing/doubled hyphens. A mismatch
  means the skill silently fails to load.
- **`description` is a single double-quoted line.** No YAML folded scalars (`>`),
  no multi-line blocks — Conductor's frontmatter parser is flat `key: value`.
  Escape any internal double-quote as `\"`, or reword to avoid it.
- **A `When to use` line** must be present (R6 matches `^\W*When to use`).
- **At least two numbered steps** (`1.`, `2.`, …). Fewer fails R6.

Extra sections after the steps are fine and encouraged: `## What didn't work`,
`## Gotchas`, `## Recognize the moment`, etc.

## Writing the `description` (this is what triggers the skill)

The harness selects a skill by matching the task against its `description`, so this
line is the single most important thing you write. Make it a **trigger**, not a
title:

- Lead with the outcomes and the situations that should fire it ("Use to … right
  after …, when …, whenever the user says …").
- Name concrete cues a future agent will recognize: error messages, command names,
  file types, the phrases a user would say.
- Keep it one line but dense. A vague description ("helps with testing") never
  fires; a specific one ("Use when a Playwright spec fails with a flaky timeout on
  CI but passes locally …") fires exactly when it should.

## Writing the `Steps` — procedures, not answers

Capture the **reusable procedure**, generalized to work next time — not the one-off
answer to this session's instance.

- ❌ "Join the `orders` table to `customers` filtering EMEA" — useless next time.
- ✅ "Find the fact table with `\dt *order*`, confirm the FK to the dimension, then
  build the query" — the skill.

Each step is imperative and concrete: the exact command, the file path, the env var
name, the required order. Record **what to verify** at the end (the passing check).

## Capture the failures — `## What didn't work`

The dead-ends you ruled out often save more time next session than the golden path.
For each: the approach, why it failed, and the signal that told you. This is a
required section for a promoted skill — see the promotion rule in `SKILL.md`.

## Secrets — the one rule you cannot break

Skills get committed and often open-sourced. **Never write a secret value** — no
passwords, tokens, connection strings, or keys. Record only **where** the secret
lives: the env var name, the selector/getter function, the MCP tool, the secret
manager path. Reproducing a secret into a skill file leaks it into git history.

## Keep it tight; push detail into `references/`

Keep `SKILL.md` under ~500 lines / ~5000 tokens. When a procedure needs a long
reference (a schema, a full command catalog, an API contract), put it in a
`references/<topic>.md` next to `SKILL.md` and tell the reader in the steps **when**
to load it — exactly as this file is loaded only at write time.

## Self-validation checklist (run before you finish)

- [ ] `name` frontmatter == the directory name, kebab-case, no bad hyphens.
- [ ] `description` is one double-quoted line, internal quotes escaped, framed as a
      trigger with concrete cues.
- [ ] A `**When to use:**` line is present.
- [ ] `**Steps:**` has >= 2 numbered, imperative, concrete steps.
- [ ] The promotion rule is satisfied and visible: the passing check is recorded, a
      failure pattern is named, and `## What didn't work` lists >= 1 ruled-out
      dead-end.
- [ ] No secret VALUES anywhere — only pointers to where they live.
- [ ] Not a duplicate — you checked existing skills + the diary and chose to write
      new rather than UPDATE an existing one.
- [ ] `SKILL.md` is tight; long detail lives in `references/`.

If any box is unchecked, fix it before reporting the skill done. If the promotion
box cannot be checked (nothing was actually verified), STOP — do not write the
skill; leave a `cdt journal add --kind decision "unverified: <lesson>"` note instead.
