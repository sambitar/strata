# Multi-Agent Crew

**Started:** {startedAt}
**Workspace:** {workspaceName}
**Branch:** {branch}
**Environment:** {environment}
**Phase:** {phase}

## Goal

{goal}

## Active feature

{featureSummary}

### Feature scope globs

{featureScope}

## Structure

**Layout:** {structureLayout}
**Services:** {structureServices}

## Stack

{stackSummary}

## Lanes

{lanesTable}

### Lane details

{lanesDetail}

## Shared contract

Fill and maintain: `.strata/crew/contract.md`

Per-lane briefs: `.strata/crew/lanes/<id>.md`

---

## How to run (Cursor-native)

1. **Planner** (serial) — copy Planner prompt from Strata; fill `contract.md` (Plan mode OK).
2. **Specialists** (parallel) — for each specialty lane, open a new Agents Window agent (prefer `/worktree`), paste that lane's prompt.
3. Mark lanes **done** in the Strata Dashboard as they finish.
4. **Integrator** (serial) — paste Integrator prompt; merge, wire, verify.
5. Archive the crew when finished.

Follow **crew-protocol.mdc**. Respect **strata-structure-contract.mdc** service roots.
