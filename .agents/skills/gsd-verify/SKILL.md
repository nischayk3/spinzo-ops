---
name: gsd-verify
description: >-
  Run the full SpinZo Ops Tech Owner verification suite (TypeScript, Vitest, Cloud Functions
  syntax, Firebase dual-SDK parity, and user-facing requirement audit) and synchronize
  .planning/STATE.md for handoff between Antigravity and Claude Code.
---

# GSD Verify — Tech Owner Quality Gate & Sync

Verify user-facing outcomes and system invariants — never stop at "it compiles".

## Verification Checklist

1. **Automated Checks**:
   - `npx tsc --noEmit` — must exit 0.
   - `npm run test` — all Vitest suites must pass.
   - `node --check ops/functions/index.js ops/functions/dispatch.js` — must exit 0 whenever backend files were edited.

2. **SpinZo Ops Architectural Invariants**:
   - **Dual-SDK Check**: If `src/config/firebase.ts` changed, verify `src/config/firebase.native.ts` exports identical symbols.
   - **Contract Check**: Confirm `ServiceType` and `OrderStatus` values remain compatible with the Livfresh customer app and `ops/functions/`.
   - **Role Isolation Check**: Confirm modals/tabs/actions only fire for intended roles (`supervisor`, `helper`, `iron`, `rider`) and do not leak alerts across roles.
   - **Deploy Flag**: Explicitly call out if `ops/functions/` changed so backend deployment isn't forgotten before web/app rollout.

3. **Requirement-by-Requirement Audit**:
   - Walk through every active requirement in `.planning/REQUIREMENTS.md` and verify the actual user-visible behavior in code (empty states, sorting order, edge timestamps, error handling).

4. **Handoff Sync**:
   - Update `.planning/STATE.md` with latest test count, working tree status, completed phases/requirements, and any pending deploy steps.

