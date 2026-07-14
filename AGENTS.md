# AGENTS.md

Project context for AI agents. Managed by Strata.

## Before significant work

- `.strata/workspace.json` — workspace config, goals, stack, structure contract, active missions
- `.strata/memory/` — summary, todo, architecture, decisions
- `.cursor/rules/` — Strata-synced Cursor rules
- If `structure.status` is `locked` (or `strata-structure-contract.mdc` is present), keep new code inside declared service roots
- If a Multi-Agent Crew is active (`strata-active-crew.mdc` / `.strata/crew/`), follow `crew-protocol.mdc` and stay in your lane roots

## Branch safety

Never edit protected trunk branches directly. Strata forks new work branches.
