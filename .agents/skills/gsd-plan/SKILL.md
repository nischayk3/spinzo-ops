---
name: gsd-plan
description: >-
  Break a roadmap phase or requirement batch into an atomic, file-level GSD execution plan
  (.planning/phases/<NN-slug>/<NN>-<MM>-PLAN.md) compatible with both Antigravity subagents
  and Claude Code. Use before executing multi-file or multi-step changes.
---

# GSD Plan — Atomic Wave Planning

Create concrete, zero-ambiguity execution plans so subagents (or Claude Code) can execute tasks in fresh context windows without guessing.

## Workflow

1. **Inspect Target Symbols**:
   - Read `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, and `.planning/ROADMAP.md`.
   - Call `codegraph_explore` on the exact files/symbols in scope for the phase. Read current diffs (`git diff` / `git diff --cached`) on any touched files.

2. **Group into Dependency Waves**:
   - **Wave 1 (Foundation / Pure Logic / Backend)**: Types (`src/types/`), pure business utilities (`src/utils/*.ts`) + Vitest unit tests (`src/utils/__tests__/*.test.ts`), Zustand store actions (`src/store/`), and `ops/functions/` handlers.
   - **Wave 2 (UI & Navigation Wiring)**: Screens (`src/screens/`), modals (`src/components/`), and navigation (`src/navigation/RootNavigator.tsx`).
   - Keep each task scoped to **2–5 files** max so context stays sharp. Parallelize independent tasks within the same wave only when they touch **disjoint files**.

3. **Write `.planning/phases/<NN-slug>/<NN>-<MM>-PLAN.md`**:
   Include for each task:
   - **Requirement IDs** covered (e.g., `R1.1`, `R3`)
   - **Files** (exact paths to create/modify)
   - **Implementation Spec** (exact functions, props, store state, edge cases, NativeWind tokens)
   - **Verification** (exact Vitest cases to add + `npx tsc --noEmit` + `npm run test`)

4. **Update `.planning/STATE.md`** with pointer to the generated plan file.

