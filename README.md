# Strata

Work in workspaces, not branches. Strata is a VS Code / Cursor extension that sits above Git — workspace identity, environment themes, AI memory, Cursor rules, agent missions, and a publish wizard.

**Workspace > Branch.** Git is one property of a workspace, not its identity.

---

## Features at a glance

| Area | What you get |
|------|----------------|
| **Workspaces** | Create, switch, and manage repos as Strata workspaces |
| **Environments** | Production (red), Feature (blue), Experiment (purple), Development (green) |
| **AI memory** | Per-repo `.strata/memory/` — summary, todo, architecture, decisions |
| **GitHub** | Connect, clone, create repos via `gh`; PR status and CI on dashboard |
| **Safe branching** | Fork work branches from any base; trunk lock; resume/archive sessions |
| **Publish** | Validate → preview → push → auto PR with memory-backed body |
| **Cursor rules** | Core engineering standards synced to `.cursor/rules/` on every workspace |
| **Agent missions** | Refresh (RCA), Retro, Feature Request — scoped agent protocols |
| **Tech stack** | Auto-detect from manifests (monorepo-aware); saved to workspace + architecture memory |

---

## v0.5 — Rules, missions & stack

### Cursor rules layer
- **Bundled core rules** — Senior Engineer Guidelines (research-first, autonomous execution, quality standards, etc.) split into focused `.mdc` files
- **Sync to repo** — `Strata: Sync Cursor Rules` or automatic on workspace create / GitHub connect
- **Install modes** — `strata.rulesInstallMode`: `copy` (default), `symlink`, or `off`
- **Workspace bridge rule** — Points agents at `.strata/memory/` and trunk-lock policy

### Agent missions
- **New Refresh (RCA)** — Root-cause analysis protocol (Phase 0–6); writes `.strata/refresh/current.md` and activates mission rules
- **Run Retro** — Session retro protocol for doctrine evolution after features ship
- **New Feature Request** — Feature spec protocol before implementation
- **Archive** — Archive refresh/retro sessions when done

### Technology stack
- **Auto-detect** — Scans `package.json`, `composer.json`, Python manifests; supports monorepos (`web/`, `backend/`, `mobile/`, etc.)
- **Dashboard editor** — View and save stack fields (frontend, backend, framework, database, ORM, auth, hosting, testing, …)
- **Memory sync** — Stack written to `.strata/workspace.json` and `.strata/memory/architecture.md`

### Dashboard UX (v0.5.5+)
- Streamlined **Actions** — Create Feature, Publish, Resume/Archive Work, Connect GitHub
- **Agent Missions** section — Refresh, Retro, Feature Request buttons
- Auto-detect stack on dashboard open

---

## v0.4 — Safe branching

- **Start Work From Branch** — Fork a new `work/…` branch from any local or remote branch without touching the source
- **Trunk lock** — Warns and blocks direct commits to protected trunk (`main` / `master`)
- **Resume Work** — Switch back to an in-progress feature or work session
- **Archive Work** — Close a session and record it in work history
- **Work history** — Past sessions stored in `workspace.json`

---

## v0.3 — Workspace dashboard & status

- **Rich dashboard** — Goal, git delta, GitHub remote panel, safety warnings, quick actions
- **Status bar** — Active workspace, environment, ahead/behind, AI last active
- **Sidebar** — Workspace list, memory files, environment indicators

---

## v0.2 — GitHub layer

- **Connect GitHub** — Link existing repo, clone from URL, or create repo on GitHub (`gh`)
- **Remote panel** — Repo link, PR status, CI checks on dashboard
- **Auto PR on publish** — Push then create/link PR with body from feature goal + memory
- **Feature ↔ GitHub** — Stores `prUrl`, last push sha, last synced time

---

## v0.1 — Foundation

- **Create Feature** — Auto branch, Feature theme (blue), goal, memory scaffold
- **Workspace sidebar** — List, create, switch workspaces
- **Environment themes** — Instant editor recolor on switch
- **AI memory** — `.strata/memory/{summary,todo,architecture,decisions}.md`
- **Publish wizard** — Validate, preview, push, open compare URL
- **Git abstraction** — All git ops via `GitService`

---

## Quick start

1. Open your project in the **classic editor** (`cursor --classic`)
2. Open **Strata** in the activity bar → **Create Workspace** (select your Git repo)
3. **Connect GitHub** if you want remote/PR features (`gh auth login` first)
4. **Create Feature** or **Start Work From Branch** to begin isolated work
5. Use the **Dashboard** for goal, stack, missions, and publish

### Commands (Command Palette)

| Command | Purpose |
|---------|---------|
| Strata: Create Workspace | Bind a repo as a workspace |
| Strata: Create Feature | New feature branch + goal + memory |
| Strata: Start Work From Branch | Fork work from any branch |
| Strata: Resume Work | Continue in-progress work |
| Strata: Archive Work | End and archive current session |
| Strata: Connect GitHub | Link, clone, or create remote repo |
| Strata: Publish | Push and optionally open/create PR |
| Strata: Sync Cursor Rules | Install/update `.cursor/rules/` |
| Strata: New Refresh (RCA) | Start root-cause debug mission |
| Strata: Run Retro | Start retro session |
| Strata: New Feature Request | Scaffold feature spec mission |
| Strata: Open Dashboard | Workspace dashboard webview |

---

## Data layout

**Global registry:** `~/.strata/workspaces.json`

**Global rules templates:** `~/.strata/rules/` (seeded from extension on first sync)

**Per repo:**

```
.strata/
├── workspace.json          # environment, goal, stack, feature, missions
├── memory/
│   ├── summary.md
│   ├── todo.md
│   ├── architecture.md
│   └── decisions.md
├── refresh/                # active RCA missions
├── retro/                  # retro sessions
└── requests/               # feature request specs

.cursor/rules/              # synced Cursor rules (when enabled)
```

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `strata.openFolderOnSwitch` | `true` | Open repo folder when switching workspaces |
| `strata.openDashboardOnSwitch` | `true` | Open dashboard when switching workspaces |
| `strata.autoCreatePr` | `true` | Create GitHub PR after publish (requires `gh`) |
| `strata.rulesInstallMode` | `copy` | How rules install: `copy`, `symlink`, or `off` |

---

## GitHub setup

```bash
# Install GitHub CLI
sudo apt install gh   # or https://cli.github.com/

# Authenticate once
gh auth login
```

Then in Strata: **Connect GitHub** (sidebar or dashboard) → link, clone, or create repo.

---

## Development

```bash
cd strata
npm install
npm run build
```

Press **F5** in VS Code to launch the Extension Development Host.

Install locally:

```bash
npm run package
cursor --install-extension strata-0.5.8.vsix --force
```

---

## Roadmap

- **v0.6** — Workspace cards, Docker/service detection, tasks
- **v1.0** — GitHub App, cloud sync, worktrees, team features
