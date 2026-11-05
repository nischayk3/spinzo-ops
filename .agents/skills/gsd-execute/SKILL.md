---
name: gsd-execute
description: >-
  Execute a planned GSD phase (.planning/phases/...) using Tech Owner orchestration,
  isolated subagents to prevent context rot, pure-util unit testing, and strict verification.
  Use when ready to implement an approved plan or roadmap phase.
---

# GSD Execute — Tech Owner Wave Execution

Execute planned phases cleanly without context rot, regressions, or over-engineering.

## Execution Rules

1. **Choose Direct vs. Subagent Execution Smartly**:
   - **Tight Wave (≤ 3 files, single concern)**: Execute directly in the main session after checking `codegraph_explore`.
   - **Multi-Task Wave or Multi-Phase Batch**: Stay in the **Tech Owner** orchestrator role and launch isolated `self` subagents (`invoke_subagent`) with exact task specs from `PLAN.md`.
     - **Crucial Git Guardrail**: Only run parallel subagents in the shared workspace if their file sets are **100% disjoint**. If tasks touch overlapping files (`orderFeed.ts`, `SupervisorDashboardScreen.tsx`, `opsProcessStore.ts`), run them sequentially in dependency order!

2. **SpinZo Ops Implementation Standards**:
   - Extract non-trivial filtering, sorting, SLA, attendance/fine, or pricing math into pure functions in `src/utils/` and write/update Vitest tests in `src/utils/__tests__/`.
   - Use NativeWind semantic tokens (`bgDark`, `bgSurface`, `bgSurfaceLight`, `textPrimary`, `textSecondary`, `textMuted`, `primary`, `warning`, `error`, `info`) and `lucide-react-native` icons.
   - Preserve existing uncommitted changes in touched files.
   - If `ops/functions/` is modified, verify CommonJS syntax (`node --check ops/functions/index.js ops/functions/dispatch.js`) and explicitly note at the end that Cloud Functions require deployment (`firebase deploy --only functions`).

3. **Per-Wave Verification Gate**:
   - Run `npx tsc --noEmit` and `npm run test` after each wave. Fix any type or test failure immediately before advancing to the next wave.

4. **Record Summary & Sync State**:
   - Write `.planning/phases/<NN-slug>/<NN>-<MM>-SUMMARY.md` (files modified, requirement IDs satisfied, test counts, deploy notes).
   - Update `.planning/STATE.md` (and only create git commits when requested by the user or when the working tree is clean for atomic commits).

