# strata — Architecture

## Overview

Strata is a VS Code / Cursor extension that sits above Git: workspace identity, environment themes, AI memory, Cursor rules, agent missions, and a publish wizard. Cursor agents generate code; Strata shapes and enforces workspace contracts.

## Components

- Extension host (`src/extension.ts`) — commands, activation, structure gate
- Workspace / Git / GitHub services — repo lifecycle and publish
- Stack detection — technology signals from manifests
- Structure detection — durable layout contract (services, expected paths, CI)
- Multi-Agent Crew — lane derivation (`crew-lane-service`), mission briefs under `.strata/crew/`, clipboard prompts for Cursor Agents Window
- Dashboard + publish webviews
- Bundled Cursor rules under `rules/bundled/` (includes `crew/crew-protocol.mdc`)

## Structure

**Status:** Locked (2026-07-14)
**Layout:** monolith
**Sources:** package.json

### Services

- **strata** (`./`, extension)
  - Expected: `src`, `tsconfig.json`, `README.md`
  - Libraries: react, react-dom, @types/node, @types/react, @types/react-dom, @types/vscode, @vscode/vsce, typescript
  - Conventions: VS Code / Cursor extension — keep src/ extension entrypoints

### CI / workflows

- _None detected_

## Notes

VS Code / Cursor extension — keep product code under src/; leave generation to Cursor agents.

## Notes

VS Code / Cursor extension — keep product code under `src/`; leave generation to Cursor agents.

## Stack

- **Frontend:** React
- **Backend:** Node.js
- **Framework:** VS Code Extension
- **Language:** TypeScript
- **Runtime:** Node.js
- **Database:** _Decide during development_
- **ORM / Data:** _Decide during development_
- **API style:** _Decide during development_
- **Styling:** _Decide during development_
- **Auth:** _Decide during development_
- **Hosting:** _Decide during development_
- **Testing:** _Decide during development_

## Git

- Trunk: `main`
- Branch: `work/2026-07-14-multi-agent-crew-from-main`
