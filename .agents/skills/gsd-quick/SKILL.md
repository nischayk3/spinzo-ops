---
name: gsd-quick
description: >-
  Fast-track GSD execution for small, well-defined tasks, bugfixes, or UI tweaks (1-3 files)
  without multi-phase planning overhead while keeping CodeGraph lookup, unit tests, tsc/vitest
  gates, and .planning/STATE.md sync. Mirrors Claude Code's gsd-quick skill.
---

# GSD Quick — Surgical Fast-Track Execution

Use `/gsd-quick` for focused bugfixes, small operational rule tweaks, or UI adjustments (1–3 files) where full roadmap planning is unnecessary overhead.

## Steps

1. **Locate & Understand**:
   - Read `.planning/STATE.md` and run `codegraph_explore` on the target symbol/screen/store.
   - Check `git diff` on target files so existing uncommitted edits are respected.

2. **Implement & Test**:
   - Make the minimal, surgical change following SpinZo Ops patterns (`AGENTS.md`).
   - Add or update unit tests in `src/utils/__tests__/` whenever business/filter/pricing/attendance logic changes.

3. **Verify**:
   - Run `npx tsc --noEmit` and `npm run test` (plus `node --check ops/functions/index.js` if backend was touched).

4. **Sync Disk State**:
   - Append a brief entry or summary under `.planning/quick/` (or directly in `.planning/STATE.md` under Recent Completed Work) so Claude Code and Antigravity stay in sync.

