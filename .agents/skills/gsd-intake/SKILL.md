---
name: gsd-intake
description: >-
  Tech Owner requirement intake and spec-driven scoping (GSD Discuss + Spec phase).
  Use when the user presents new feature requests, operational changes, or bug batches
  to analyze impact via CodeGraph, resolve ambiguities, and update .planning/REQUIREMENTS.md
  and .planning/ROADMAP.md before coding.
---

# GSD Intake — Tech Owner Scoping & Spec Lock

Act as the **Tech Owner** who built SpinZo Ops. Never jump blindly into editing multiple screens/functions on ambiguous specs.

## Workflow

1. **Load Disk State**:
   - Read `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, and `.planning/ROADMAP.md`.
   - Run `git status -s` to check which files already have uncommitted edits so new plans integrate cleanly without clobbering in-flight work.

2. **Fast Codebase Impact Mapping (`CodeGraph` First)**:
   - Use `codegraph_explore` (or delegate a broad multi-area survey to a `research` subagent) to locate exact stores, screens, modals, pure utils, and `ops/functions/` handlers affected by each requested item.
   - Check SpinZo Ops critical invariants for every requirement:
     - **Contract safety**: Does it touch `ServiceType` or `OrderStatus` shared with the Livfresh customer app?
     - **Client vs. Backend**: Does it require a Cloud Function change in `ops/functions/` (which needs separate Firebase deploy) or is it pure client/Firestore state?
     - **Dual-SDK parity**: If touching `src/config/firebase.ts`, must `src/config/firebase.native.ts` also change?
     - **Firestore listener cost**: Does it affect `orderFeedStore` (`collectionGroup('orders')`) or `ops_process` fan-out?
     - **Testability**: Can core filter/pricing/SLA/eligibility logic be extracted into `src/utils/` and unit-tested with Vitest?

3. **Resolve Gray Areas (Only Real Decisions)**:
   - If any requirement has genuine product/ops ambiguity or edge-case conflict (e.g., role permissions between `supervisor`/`helper`/`iron`/`rider`, shift cutoff interactions, held queue flags), ask concise, targeted questions (using `ask_question` for structured choices or plain text for quick yes/no).
   - If everything is clear and unambiguous, state your technical decisions succinctly and proceed directly to locking the spec.

4. **Update `.planning/` Specs**:
   - Record crisp, numbered requirements (`R*`) with acceptance criteria in `.planning/REQUIREMENTS.md`.
   - Map them into dependency-ordered, atomic phases in `.planning/ROADMAP.md` (separating pure utility/store logic, backend `ops/functions/` changes, and UI wiring where appropriate).
   - Update `.planning/STATE.md` with the new active roadmap focus.

