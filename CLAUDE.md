# CLAUDE.md

This file provides guidance to Claude Code (`claude.ai/code`) when working in this repository and keeps it synchronized with **Google Antigravity**.

@AGENTS.md

## Claude Code ↔ Antigravity Sync Notes

- **Shared Architecture & Contracts**: All SpinZo Ops architecture, Zustand stores, Firebase dual-SDK rules, Cloud Function boundaries, and verification gates live in `AGENTS.md` (imported above so both agents read one canonical ruleset).
- **Shared GSD State (`.planning/`)**:
  - `.planning/PROJECT.md` — Project profile
  - `.planning/REQUIREMENTS.md` — Active & completed requirement specs
  - `.planning/ROADMAP.md` — Dependency-ordered implementation phases
  - `.planning/STATE.md` — Live cross-agent handoff state (read first, update after every phase or `/gsd-quick` task)
  - `.planning/phases/` & `.planning/quick/` — Phase plans (`PLAN.md`) and execution summaries (`SUMMARY.md`)
- **Deep Repo Audit**: Refer to `docs/STATE.md` for structural risks and historical tooling notes.
