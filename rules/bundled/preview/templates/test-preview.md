# Test in Dev Mode

**Started:** {startedAt}
**Workspace:** {workspaceName}
**Branch:** {branch}
**Environment:** {environment}

## What we're testing

{focus}

## Preview scope (LOCKED — do not preview outside this)

**Selected:** {worksetSummary}

{previewRules}

### Selected targets

{selectedTargets}

## Active feature

{featureSummary}

### Feature scope globs

{featureScope}

## Files touched this session (git + open editors)

{changedFilesList}

## Stack (from workspace)

{stackSummary}

## Manifest hints (read only for selected targets)

{manifestHints}

---

## Mission

Follow **preview-protocol.mdc** (Strata Preview Protocol).

1. Preview **only** the selected target(s) above — this is a monorepo; other apps are out of scope.
2. Read manifests under each target root — discover commands from scripts, not assumptions.
3. Start server(s) in the correct **cwd** (terminal cwd = target root; no redundant `cd`).
4. If **web + backend** are selected: backend first, then web, then open external browser.
5. Save recipe to `.strata/preview/recipe.md` per target root.

Do not preview mobile, web, and backend unless they appear under **Selected targets**.
