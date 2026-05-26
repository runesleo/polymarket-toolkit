# AI handoff template (MIT · strategy validation)

Use when handing work to Claude / Codex / Cursor across sessions.

```markdown
# Handoff: <title>

**Date:** YYYY-MM-DD · **Owner:** · **Status:** in_progress | blocked | done

## 1. Context
- Project / module
- Last session outcome (commit / link)
- Working tree: clean | dirty (list files)

## 2. Goal
- One sentence deliverable
- Why now (task / milestone)

## 3. Scope
- Files to touch
- Explicit out-of-scope
- Schema / config / migration?

## 4. Acceptance
- ≥3 verifiable done conditions
- Commands that must pass
- Expected output shape

## 5. Risk & boundary
- P0 never touch (keys, prod, live funds)
- Unknowns allowed to explore

## 6. Next action
- Single concrete step for the next agent/session

## 7. Links
- PR / issue / SSOT paths
```
