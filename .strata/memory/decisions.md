# strata — Decisions

Record important technical decisions here.

## Template

### Decision title

- **Date:**
- **Status:** proposed | accepted | deprecated
- **Context:**
- **Decision:**
- **Consequences:**

### Durable structure contract (Enforce Structure)

- **Date:** 2026-07-14
- **Status:** accepted
- **Context:** NL→software systems (e.g. DevOpsGPT) fail without an explicit layout. Strata should hold the contract, not own codegen.
- **Decision:** Persist `structure` on `workspace.json` (detect → lock → validate). Mirror into `architecture.md` and `strata-structure-contract.mdc`. Gate create-feature / start-work / publish via `strata.structureEnforcement` (`off` | `warn` | `block`).
- **Consequences:** Agents get durable service roots; users confirm before lock; Cursor remains the generator.

### Cursor-native Multi-Agent Crew

- **Date:** 2026-07-14
- **Status:** accepted
- **Context:** Features often need FE/BE/DB (or multi-service) work in parallel; a single chat serializes everything. External crews (CrewAI) and Cursor SDK spawners add runtimes Strata should not own.
- **Decision:** Add `activeCrew` mission: derive lanes from locked `structure` (+ monolith stack role expansion), write `.strata/crew/` briefs/contract, sync `crew-protocol.mdc` + `strata-active-crew.mdc`, expose dashboard/commands that **copy prompts** for Cursor Agents Window + worktrees. No SDK/CrewAI.
- **Consequences:** Users run parallel specialists natively; Strata owns contracts and lane ownership; gate crew start on structure lock like other start-work actions.
