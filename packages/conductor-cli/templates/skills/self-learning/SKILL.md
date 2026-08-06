---
name: self-learning
description: "Use to harvest a hard-won golden path from THIS session into a reusable Agent Skill, so future sessions start already knowing it: right after non-trivial debugging, after working out a multi-step operational workflow (how to reach the DB, deploy, run migrations, verify a change live), or after rediscovering project facts you didn't know up front; and whenever the user says remember this, save this as a skill, or don't make me re-explain this next time. Proactively harvest when a task took several attempts, used non-obvious tooling, or is likely to recur — without asking first. Also promotes a draft that 'cdt learn distill' auto-generated (source: learned) into a real, verified skill."
---

# Skill — self-learning

A *meta-skill*: it does not do the work, it captures **how** the work got done —
the proven procedure plus the dead-ends — so the next session (yours or a
teammate's) starts already knowing the route instead of rediscovering it.

It is harness-neutral: it works with any target Conductor emits to (Claude,
OpenCode, Codex, Pi), all of which load `SKILL.md` skills. Where a step differs by
harness, the generic version comes first and the tool-specific detail is an example.

**When to use:** When you just earned a reusable golden path — a task that only
worked after several tries, a non-obvious command/sequence, a project fact you
did not know up front, an operational workflow likely to recur — or when the user
says "remember this" / "save this as a skill". Also to **promote** a raw
`source: learned` draft that the `cdt learn distill` SessionEnd hook dropped: turn
it from a mechanical stub into a verified, reasoned skill.

**Steps:**
1. **Apply the promotion rule** (below). Passing check + named failure pattern +
   one ruled-out dead-end — or it is not a skill yet: leave an unverified note via
   `cdt journal add --kind decision "unverified: <lesson>"` and skip.
2. **Triage skill vs memory vs skip.** A multi-step reusable procedure → a skill.
   A single fact / one-line correction (an env var name, a path, one gotcha) → the
   diary instead: `cdt journal add --kind decision "<fact>"`. A genuine one-off →
   skip. Do not bloat the skills list with one-liners.
3. **Choose scope and name yourself** — do not stop to ask. Default to project
   scope; pick a clear kebab-case `name` (lowercase `a-z`/`0-9`/hyphens, no
   leading/trailing/doubled hyphens). `name` MUST equal the skill directory name.
4. **Dedupe.** List the skills dirs — project (`.claude/skills/`, `.opencode/skill/`,
   `.agents/skills/` per target) and the user-level one — and run
   `cdt journal recall "<topic>"`. If a near-identical skill or a `source: learned`
   draft already covers it, **UPDATE** that one instead of spawning a competitor.
5. **Distill the golden path from THIS conversation** while it is fresh: the exact
   working commands, file paths, env var names, the required order, and the
   dead-ends to avoid. This is the raw material — the conversation is the only place
   the path lives.
6. **Write the skill** (delegate to a subagent that inherits this conversation if
   the harness supports one — e.g. Claude Code `context: fork` — else inline). Follow
   the brief below. Capture the PROCEDURE, not a one-off answer, plus a
   `## What didn't work` section. NEVER write secret values.
7. **Verify it loads, then relay.** Confirm `name` == directory name and the
   frontmatter parses. Tell the user the new skill's path and, in one line, what it
   captured. Then record it: `cdt journal add --kind solution "learned skill: <name>"`.

## Recognize the moment

Any one of these is a cue to harvest — act on it immediately, do not ask permission:

- A task only worked **after several attempts**, wrong turns, or a user correction.
- You discovered **project facts the agent did not know up front**: where creds/env
  vars live, which selector/backend talks to a service, a required sequence, a gotcha.
- An **operational workflow likely to recur**: reach the dev/prod DB, deploy, run
  migrations, seed data, verify live, run one specific test path, tail the right logs.
- The user **signals it**: "remember this", "save this as a skill".

## Promotion rule — don't enshrine guesses

A skill is authoritative: the next session trusts it without re-deriving it. Only
write one when **all three** hold:

1. **A passing check.** The path was actually verified — a test passed, the command
   exited clean, the repro reproduced, a Conductor gate 7/8 was approved. Record what
   the check was. "Seemed to work" is not a passing check.
2. **A named failure pattern.** You can name the failure this path avoids (e.g.
   "stale build cache → phantom type errors"), not a vague "sometimes it breaks".
3. **At least one ruled-out dead-end** — a concrete approach you tried and eliminated,
   with the reason.

If any is missing it is not a skill yet — leave an unverified `cdt journal` note or
skip. In Conductor's 14-gate flow, a passed **gate 7 (delivery)** or **gate 8
(quality)** is the strongest passing check you can cite.

## The write brief

Hand this to the subagent, or work through it inline. It over-reaches by default —
box it in tightly:

> You are harvesting a skill. Your ONLY job is to write a new Agent Skill capturing
> the golden path we just worked out: **[one-line description]**.
> Hard rules:
> - Write ONLY under `[skills dir]/[skill-name]/`. Do NOT touch project source, run
>   builds, install anything, or resume the original task.
> - Author `SKILL.md` to Conductor's shape: single-line double-quoted `description`
>   frontmatter, a `**When to use:**` line, and numbered `**Steps:**` (>= 2).
> - Capture the PROCEDURE — commands, paths, required order, gotchas — generalized to
>   work next time, not a one-off answer.
> - Add a `## What didn't work` section: the approaches ruled out and why.
> - Enforce the promotion rule: record the passing check, name the failure pattern,
>   list one ruled-out dead-end. If any is missing, STOP and report it is not
>   promotable — leave a `cdt journal` note instead of writing the skill.
> - NEVER write secret VALUES (passwords, tokens, connection strings, keys). Record
>   only WHERE they live: the env var name, the selector, the MCP tool, the secret
>   manager. Reproducing a secret into a skill file leaks it.
> - Report back the absolute path written and a one-line summary, then STOP.

## Gotchas

- **Secrets never go in a skill file.** Skills get committed. Point to *where* the
  secret lives; never reproduce the value. This is the single most important rule.
- **`name` must equal the directory name** and be kebab-case, or the skill won't load.
- **Whoever writes over-reaches by default** (a subagent especially) — the brief
  forbids touching source or resuming the task. Keep it boxed to the skills dir.
- **Don't duplicate.** Update an existing skill (or a `source: learned` draft) rather
  than spawning a second one that competes to trigger.
- **Capture procedures, not answers.** "Join orders to customers for EMEA" is useless
  next time; "how to find the right tables and build the query" is the skill.
- **Keep `SKILL.md` tight** (< ~500 lines). Push detail into `references/` and tell
  the reader *when* to load each file.

For the full authoring spec — the exact frontmatter/section shape the validator
enforces, how to write a triggering `description`, and a self-validation checklist —
load [references/skill-authoring.md](references/skill-authoring.md) at write time (step 6).
