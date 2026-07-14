import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type {
  ActiveCrew,
  ActivePreview,
  ActiveRefresh,
  ActiveRetro,
  CrewLane,
  CrewLaneStatus,
  Workspace,
} from "../models/workspace";
import { ENVIRONMENT_LABELS } from "../models/workspace";
import type { PreviewTarget, PreviewWorkset } from "../models/preview-workset";
import { CrewLaneService } from "./crew-lane-service";
import { PreviewWorksetService } from "./preview-workset-service";
import {
  getCrewDir,
  getPreviewDir,
  getRefreshDir,
  getRetroDir,
  getRequestsDir,
  ensureDir,
} from "../storage/paths";
import { WorkspaceStore } from "../storage/workspace-store";
import { newMissionId, RulesService } from "./rules-service";

export class MissionService {
  private readonly workspaceStore = new WorkspaceStore();
  private readonly worksetService = new PreviewWorksetService();
  private readonly crewLaneService = new CrewLaneService();

  constructor(private readonly rulesService: RulesService) {}

  async startRefresh(
    workspace: Workspace,
    input: { title: string; description: string },
  ): Promise<Workspace> {
    if (workspace.activeRefresh) {
      throw new Error(
        `Refresh "${workspace.activeRefresh.title}" is already active. Archive it first.`,
      );
    }

    if (workspace.activeRetro) {
      throw new Error("A retro session is active. Archive it before starting a refresh.");
    }

    this.rulesService.ensureGlobalRules();

    const startedAt = new Date().toISOString();
    const refresh: ActiveRefresh = {
      id: newMissionId("refresh"),
      title: input.title.trim(),
      description: input.description.trim(),
      startedAt,
      phase: 0,
    };

    const refreshDir = getRefreshDir(workspace.repoPath);
    ensureDir(refreshDir);
    ensureDir(path.join(refreshDir, "archive"));

    const template = this.rulesService.getTemplatePath(
      "refresh/templates/bug-refresh.md",
    );
    const content = this.rulesService.renderTemplate(template, {
      title: refresh.title,
      startedAt,
      description: refresh.description,
    });

    const currentPath = path.join(refreshDir, "current.md");
    fs.writeFileSync(currentPath, content, "utf8");

    const updated = {
      ...workspace,
      activeRefresh: refresh,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    return updated;
  }

  async archiveRefresh(workspace: Workspace): Promise<Workspace> {
    if (!workspace.activeRefresh) {
      throw new Error("No active refresh to archive.");
    }

    const refreshDir = getRefreshDir(workspace.repoPath);
    const currentPath = path.join(refreshDir, "current.md");
    const archiveDir = path.join(refreshDir, "archive");

    if (fs.existsSync(currentPath)) {
      ensureDir(archiveDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = path.join(
        archiveDir,
        `${stamp}-${workspace.activeRefresh.id}.md`,
      );
      fs.renameSync(currentPath, archivePath);
    }

    const updated = {
      ...workspace,
      activeRefresh: null,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);
    return updated;
  }

  async startRetro(workspace: Workspace): Promise<Workspace> {
    if (workspace.activeRetro) {
      throw new Error("A retro session is already active. Archive it first.");
    }

    if (workspace.activeRefresh) {
      throw new Error("A refresh mission is active. Archive it before starting a retro.");
    }

    this.rulesService.ensureGlobalRules();

    const startedAt = new Date().toISOString();
    const retro: ActiveRetro = {
      id: newMissionId("retro"),
      startedAt,
      relatedFeatureId: workspace.currentFeature?.id ?? null,
    };

    const retroDir = getRetroDir(workspace.repoPath);
    ensureDir(retroDir);
    ensureDir(path.join(retroDir, "archive"));

    const template = this.rulesService.getTemplatePath(
      "retro/templates/session-retro.md",
    );
    const content = this.rulesService.renderTemplate(template, { startedAt });

    const currentPath = path.join(retroDir, "current.md");
    fs.writeFileSync(currentPath, content, "utf8");

    const updated = {
      ...workspace,
      activeRetro: retro,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    void vscode.window.showInformationMessage(
      "Retro started. Ask the agent to follow the Retro protocol and evolve doctrine.",
    );

    return updated;
  }

  async archiveRetro(workspace: Workspace): Promise<Workspace> {
    if (!workspace.activeRetro) {
      throw new Error("No active retro to archive.");
    }

    const retroDir = getRetroDir(workspace.repoPath);
    const currentPath = path.join(retroDir, "current.md");
    const archiveDir = path.join(retroDir, "archive");

    if (fs.existsSync(currentPath)) {
      ensureDir(archiveDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = path.join(
        archiveDir,
        `${stamp}-${workspace.activeRetro.id}.md`,
      );
      fs.renameSync(currentPath, archivePath);
    }

    const updated = {
      ...workspace,
      activeRetro: null,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);
    return updated;
  }

  async createFeatureRequest(
    workspace: Workspace,
    input: { title: string; goal: string; scope: string },
  ): Promise<string> {
    this.rulesService.ensureGlobalRules();

    const requestsDir = getRequestsDir(workspace.repoPath);
    ensureDir(path.join(requestsDir, "archive"));

    const createdAt = new Date().toISOString();
    const slug =
      input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "request";

    const template = this.rulesService.getTemplatePath(
      "requests/templates/feature-request.md",
    );
    const content = this.rulesService.renderTemplate(template, {
      title: input.title,
      createdAt,
      goal: input.goal,
      scope: input.scope,
    });

    const filePath = path.join(requestsDir, `${slug}.md`);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  async startPreviewTest(
    workspace: Workspace,
    input?: { focus?: string; targets?: PreviewTarget[]; workset?: PreviewWorkset },
  ): Promise<Workspace> {
    if (workspace.activePreview) {
      throw new Error(
        "A preview test mission is already active. Archive it first or continue in chat.",
      );
    }

    if (workspace.activeRefresh) {
      throw new Error("A refresh mission is active. Archive it before starting preview.");
    }

    if (workspace.activeRetro) {
      throw new Error("A retro session is active. Archive it before starting preview.");
    }

    this.rulesService.ensureGlobalRules();

    const startedAt = new Date().toISOString();
    const focus =
      input?.focus?.trim() ||
      workspace.currentFeature?.goal ||
      workspace.currentGoal ||
      "Manual testing of current work in dev mode";

    const preview: ActivePreview = {
      id: newMissionId("preview"),
      startedAt,
      focus,
      targets: (input?.targets ?? []).map((t) => ({
        root: t.root,
        label: t.label,
        kind: t.kind,
        changedFiles: t.changedFiles,
        reason: t.reason,
      })),
    };

    const previewDir = getPreviewDir(workspace.repoPath);
    ensureDir(previewDir);
    ensureDir(path.join(previewDir, "archive"));

    const targets = input?.targets ?? [];
    const workset = input?.workset ?? (await this.worksetService.resolve(workspace));
    const formatted = this.worksetService.formatWorksetForMission(workset, targets);

    const template = this.rulesService.getTemplatePath(
      "preview/templates/test-preview.md",
    );
    const content = this.rulesService.renderTemplate(template, {
      startedAt,
      workspaceName: workspace.name,
      branch: workspace.git.branch,
      environment: ENVIRONMENT_LABELS[workspace.environment],
      focus,
      featureSummary: workspace.currentFeature
        ? `${workspace.currentFeature.name} — ${workspace.currentFeature.goal} (branch: ${workspace.currentFeature.branch})`
        : "None — testing workspace as a whole",
      featureScope: workspace.currentFeature?.scope?.length
        ? workspace.currentFeature.scope.map((s) => `- \`${s}\``).join("\n")
        : "_No explicit scope globs — using git changes and open files._",
      stackSummary: this.formatStackSummary(workspace),
      manifestHints: this.discoverManifestHints(workspace.repoPath),
      worksetSummary: formatted.worksetSummary,
      changedFilesList: formatted.changedFilesList,
      selectedTargets: formatted.selectedTargets,
      previewRules: formatted.previewRules,
    });

    const currentPath = path.join(previewDir, "current.md");
    fs.writeFileSync(currentPath, content, "utf8");

    const updated = {
      ...workspace,
      activePreview: preview,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    await this.openPreviewAgentChat(focus, targets);

    return updated;
  }

  async archivePreviewTest(workspace: Workspace): Promise<Workspace> {
    if (!workspace.activePreview) {
      throw new Error("No active preview test to archive.");
    }

    const previewDir = getPreviewDir(workspace.repoPath);
    const currentPath = path.join(previewDir, "current.md");
    const archiveDir = path.join(previewDir, "archive");

    if (fs.existsSync(currentPath)) {
      ensureDir(archiveDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = path.join(
        archiveDir,
        `${stamp}-${workspace.activePreview.id}.md`,
      );
      fs.renameSync(currentPath, archivePath);
    }

    const updated = {
      ...workspace,
      activePreview: null,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);
    return updated;
  }

  async startMultiAgentCrew(workspace: Workspace): Promise<Workspace> {
    if (workspace.activeCrew) {
      throw new Error(
        "A multi-agent crew is already active. Archive it first.",
      );
    }

    if (workspace.activeRefresh) {
      throw new Error(
        "A refresh mission is active. Archive it before starting a crew.",
      );
    }

    if (workspace.activeRetro) {
      throw new Error(
        "A retro session is active. Archive it before starting a crew.",
      );
    }

    if (!workspace.structure || workspace.structure.status !== "locked") {
      throw new Error(
        "Lock a Structure Contract before starting a multi-agent crew.",
      );
    }

    this.rulesService.ensureGlobalRules();

    const startedAt = new Date().toISOString();
    const goal =
      workspace.currentFeature?.goal ||
      workspace.currentGoal ||
      "Implement the current feature with parallel Cursor agents";
    const lanes = this.crewLaneService.deriveLanes(workspace);

    const crew: ActiveCrew = {
      id: newMissionId("crew"),
      startedAt,
      featureId: workspace.currentFeature?.id ?? null,
      goal,
      phase: "plan",
      lanes,
    };

    const crewDir = getCrewDir(workspace.repoPath);
    const lanesDir = path.join(crewDir, "lanes");
    ensureDir(crewDir);
    ensureDir(path.join(crewDir, "archive"));
    ensureDir(lanesDir);

    this.writeCrewMissionFiles(workspace, crew);

    const updated = {
      ...workspace,
      activeCrew: crew,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);

    const currentPath = path.join(crewDir, "current.md");
    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    await this.copyCrewPromptAndNotify(
      this.buildPlannerPrompt(crew),
      "Multi-agent crew started — Planner prompt copied. Paste into chat (Plan mode OK). After the contract is filled, copy specialist prompts into separate Agents Window sessions (prefer worktrees).",
      true,
    );

    return updated;
  }

  async archiveCrew(workspace: Workspace): Promise<Workspace> {
    if (!workspace.activeCrew) {
      throw new Error("No active multi-agent crew to archive.");
    }

    const crewDir = getCrewDir(workspace.repoPath);
    const archiveDir = path.join(crewDir, "archive");
    ensureDir(archiveDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = `${stamp}-${workspace.activeCrew.id}`;

    for (const name of ["current.md", "contract.md"] as const) {
      const src = path.join(crewDir, name);
      if (fs.existsSync(src)) {
        fs.renameSync(src, path.join(archiveDir, `${prefix}-${name}`));
      }
    }

    const lanesDir = path.join(crewDir, "lanes");
    if (fs.existsSync(lanesDir)) {
      const laneArchive = path.join(archiveDir, `${prefix}-lanes`);
      ensureDir(laneArchive);
      for (const name of fs.readdirSync(lanesDir)) {
        fs.renameSync(
          path.join(lanesDir, name),
          path.join(laneArchive, name),
        );
      }
    }

    const updated = {
      ...workspace,
      activeCrew: null,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);
    return updated;
  }

  async setCrewLaneStatus(
    workspace: Workspace,
    laneId: string,
    status: CrewLaneStatus,
  ): Promise<Workspace> {
    if (!workspace.activeCrew) {
      throw new Error("No active multi-agent crew.");
    }

    const lanes = workspace.activeCrew.lanes.map((lane) =>
      lane.id === laneId ? { ...lane, status } : lane,
    );
    if (!lanes.some((lane) => lane.id === laneId)) {
      throw new Error(`Unknown crew lane: ${laneId}`);
    }

    const phase = this.crewLaneService.derivePhase(lanes);
    const crew: ActiveCrew = {
      ...workspace.activeCrew,
      lanes,
      phase,
    };

    this.writeCrewMissionFiles(workspace, crew);

    const updated = {
      ...workspace,
      activeCrew: crew,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    await this.rulesService.syncToRepo(workspace.repoPath, updated);
    return updated;
  }

  async copyCrewLanePrompt(
    workspace: Workspace,
    laneId: string,
  ): Promise<void> {
    if (!workspace.activeCrew) {
      throw new Error("No active multi-agent crew.");
    }

    const lane = workspace.activeCrew.lanes.find((l) => l.id === laneId);
    if (!lane) {
      throw new Error(`Unknown crew lane: ${laneId}`);
    }

    let prompt: string;
    if (lane.role === "planner") {
      prompt = this.buildPlannerPrompt(workspace.activeCrew);
    } else if (lane.role === "integrator") {
      prompt = this.buildIntegratorPrompt(workspace.activeCrew);
    } else {
      prompt = this.buildSpecialistPrompt(workspace.activeCrew, lane);
    }

    await this.copyCrewPromptAndNotify(
      prompt,
      `${lane.title} prompt copied — paste into a Cursor Agents Window session` +
        (lane.role !== "planner" && lane.role !== "integrator"
          ? " (prefer /worktree)."
          : "."),
      false,
    );
  }

  async copyCrewIntegratorPrompt(workspace: Workspace): Promise<void> {
    if (!workspace.activeCrew) {
      throw new Error("No active multi-agent crew.");
    }

    const integrator = workspace.activeCrew.lanes.find(
      (lane) => lane.role === "integrator",
    );
    if (!integrator) {
      throw new Error("Crew has no integrator lane.");
    }

    await this.copyCrewLanePrompt(workspace, integrator.id);
  }

  private writeCrewMissionFiles(
    workspace: Workspace,
    crew: ActiveCrew,
  ): void {
    const crewDir = getCrewDir(workspace.repoPath);
    const lanesDir = path.join(crewDir, "lanes");
    ensureDir(crewDir);
    ensureDir(lanesDir);

    const structure = workspace.structure!;
    const ownershipRows = crew.lanes
      .filter((lane) => lane.role !== "planner" && lane.role !== "integrator")
      .map((lane) => `| ${lane.title} | ${lane.id} | root \`${lane.root}\` |`)
      .join("\n");

    const missionTemplate = this.rulesService.getTemplatePath(
      "crew/templates/crew-mission.md",
    );
    const missionContent = this.rulesService.renderTemplate(missionTemplate, {
      startedAt: crew.startedAt,
      workspaceName: workspace.name,
      branch: workspace.git.branch,
      environment: ENVIRONMENT_LABELS[workspace.environment],
      phase: crew.phase,
      goal: crew.goal,
      featureSummary: workspace.currentFeature
        ? `${workspace.currentFeature.name} — ${workspace.currentFeature.goal} (branch: ${workspace.currentFeature.branch})`
        : "None — crew scoped to workspace goal",
      featureScope: workspace.currentFeature?.scope?.length
        ? workspace.currentFeature.scope.map((s) => `- \`${s}\``).join("\n")
        : "_No explicit scope globs._",
      structureLayout: structure.layout,
      structureServices: structure.services
        .map((s) => `- **${s.name}** (\`${s.id}\`) @ \`${s.root}\` — ${s.kind}`)
        .join("\n"),
      stackSummary: this.formatStackSummary(workspace),
      lanesTable: this.crewLaneService.formatLanesTable(crew.lanes),
      lanesDetail: this.crewLaneService.formatLaneList(crew.lanes),
    });
    fs.writeFileSync(path.join(crewDir, "current.md"), missionContent, "utf8");

    const contractPath = path.join(crewDir, "contract.md");
    if (!fs.existsSync(contractPath)) {
      const contractTemplate = this.rulesService.getTemplatePath(
        "crew/templates/contract-stub.md",
      );
      const contractContent = this.rulesService.renderTemplate(
        contractTemplate,
        {
          goal: crew.goal,
          startedAt: crew.startedAt,
          ownershipRows:
            ownershipRows || "| Shared | planner | Define before parallel |",
          acceptanceStub: crew.goal,
        },
      );
      fs.writeFileSync(contractPath, contractContent, "utf8");
    }

    const laneTemplate = this.rulesService.getTemplatePath(
      "crew/templates/lane.md",
    );
    for (const lane of crew.lanes) {
      const expectedPaths =
        lane.expectedPaths && lane.expectedPaths.length > 0
          ? lane.expectedPaths.map((p) => `- \`${p}\``).join("\n")
          : "- _none specified_";
      const conventions =
        lane.conventions && lane.conventions.length > 0
          ? lane.conventions.map((c) => `- ${c}`).join("\n")
          : "- _none specified_";

      const laneContent = this.rulesService.renderTemplate(laneTemplate, {
        laneTitle: lane.title,
        laneId: lane.id,
        laneRole: lane.role,
        laneRoot: lane.root,
        laneStatus: lane.status,
        promptHint: lane.promptHint ?? "_Follow crew protocol for this role._",
        expectedPaths,
        conventions,
        goal: crew.goal,
      });
      fs.writeFileSync(
        path.join(lanesDir, `${lane.id}.md`),
        laneContent,
        "utf8",
      );
    }
  }

  private buildPlannerPrompt(crew: ActiveCrew): string {
    return `Follow the Strata Multi-Agent Crew Protocol (crew-protocol.mdc).

You are the Planner for this crew. Read:
- .strata/crew/current.md
- .strata/crew/lanes/planner.md
- .strata/crew/contract.md (fill this — stub today)
- .strata/workspace.json → structure (locked)

Goal: ${crew.goal}
Phase: ${crew.phase}

Your job (serial — do NOT implement product features):
1. Prefer Cursor Plan mode.
2. Fill .strata/crew/contract.md with APIs, schemas, shared types, ownership, and acceptance criteria.
3. Keep specialists able to work in parallel without inventing shared interfaces.
4. Stop when the contract is ready. Ask the user to mark Planner done in the Strata Dashboard.`;
  }

  private buildSpecialistPrompt(crew: ActiveCrew, lane: CrewLane): string {
    return `Follow the Strata Multi-Agent Crew Protocol (crew-protocol.mdc).

You are the ${lane.title} specialist (\`${lane.id}\`, role \`${lane.role}\`).

Read:
- .strata/crew/current.md
- .strata/crew/contract.md (must already be filled by Planner)
- .strata/crew/lanes/${lane.id}.md
- Locked structure / strata-structure-contract.mdc

Goal: ${crew.goal}
Your root: \`${lane.root}\`
${lane.promptHint ? `Hint: ${lane.promptHint}` : ""}

Rules:
1. Run in a separate Agents Window agent — prefer /worktree so you do not collide with other lanes.
2. Edit ONLY your root and expected paths. Do not change the shared contract; stop and report if it must change.
3. Implement against the locked contract. Match project conventions.
4. When finished, ask the user to mark lane \`${lane.id}\` done in the Strata Dashboard.`;
  }

  private buildIntegratorPrompt(crew: ActiveCrew): string {
    const specialty = crew.lanes
      .filter((lane) => lane.role !== "planner" && lane.role !== "integrator")
      .map((lane) => `- ${lane.title} (\`${lane.id}\`): ${lane.status}`)
      .join("\n");

    return `Follow the Strata Multi-Agent Crew Protocol (crew-protocol.mdc).

You are the Integrator. Read:
- .strata/crew/current.md
- .strata/crew/contract.md
- Lane briefs under .strata/crew/lanes/
- Current diffs / worktrees from specialists

Goal: ${crew.goal}
Specialist lane status:
${specialty || "- (none)"}

Your job (serial):
1. Merge or apply specialist work; resolve conflicts.
2. Wire integration points to match the contract.
3. Run relevant tests/lints; fix end-to-end gaps.
4. Update .strata/memory/todo.md (and decisions/summary if significant).
5. Ask the user to mark Integrator done and archive the crew in Strata.`;
  }

  private async copyCrewPromptAndNotify(
    prompt: string,
    message: string,
    openChat: boolean,
  ): Promise<void> {
    await vscode.env.clipboard.writeText(prompt);

    if (openChat) {
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open");
      } catch {
        // chat may be unavailable in some hosts
      }
    }

    void vscode.window.showInformationMessage(message);
  }

  private formatStackSummary(workspace: Workspace): string {
    const stack = workspace.stack;
    if (!stack) {
      return "Not set — read manifests and architecture.md";
    }

    const lines = Object.entries(stack)
      .filter(([, value]) => value && String(value).trim())
      .map(([key, value]) => `- **${key}:** ${value}`);

    return lines.length > 0 ? lines.join("\n") : "Not set — read manifests and architecture.md";
  }

  private discoverManifestHints(repoPath: string): string {
    const hints: string[] = [];
    const skip = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      "vendor",
      ".strata",
      "coverage",
      ".next",
    ]);

    const walk = (dir: string, depth: number): void => {
      if (depth > 4 || hints.length > 24) {
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isFile()) {
          const name = entry.name;
          if (
            name === "package.json" ||
            name === "composer.json" ||
            name === "pyproject.toml" ||
            name === "requirements.txt" ||
            name === "Cargo.toml" ||
            name === "go.mod" ||
            name === "docker-compose.yml" ||
            name === "docker-compose.yaml"
          ) {
            const rel = path.relative(repoPath, path.join(dir, name)).replace(/\\/g, "/");
            hints.push(`- \`${rel}\``);
          }
          continue;
        }

        if (!entry.isDirectory() || skip.has(entry.name)) {
          continue;
        }

        walk(path.join(dir, entry.name), depth + 1);
      }
    };

    walk(repoPath, 0);

    if (hints.length === 0) {
      return "No common manifests found at shallow depth — explore the repo tree.";
    }

    const recipePath = path.join(getPreviewDir(repoPath), "recipe.md");
    if (fs.existsSync(recipePath)) {
      hints.unshift("- `.strata/preview/recipe.md` (previous successful preview — try this first)");
    }

    return hints.join("\n");
  }

  private async openPreviewAgentChat(
    focus: string,
    targets: PreviewTarget[],
  ): Promise<void> {
    const targetLine =
      targets.length > 0
        ? targets.map((t) => `${t.label} (\`${t.root}/\`)`).join(" + ")
        : "discover from repo (no workset lock)";

    const prompt = `Follow the Strata Preview Protocol. Read .strata/preview/current.md and preview-protocol.mdc.

Preview ONLY what I was working on — not the whole monorepo.

Selected targets: ${targetLine}
Focus: ${focus}

Your job:
1. Read the workset and selected targets in current.md — do NOT start dev servers for apps outside this list.
2. Start the correct server(s) in the correct directory (no double cd).
3. Open external browser for web/API surfaces.
4. If multiple targets (e.g. web + backend), start backend before web.
5. Save recipe to .strata/preview/recipe.md tagged by target root.`;

    await vscode.env.clipboard.writeText(prompt);

    try {
      await vscode.commands.executeCommand("workbench.action.chat.open");
    } catch {
      // chat may be unavailable in some hosts
    }

    void vscode.window.showInformationMessage(
      "Preview mission started — agent prompt copied to clipboard. Paste into chat, or ask the agent to follow .strata/preview/current.md",
    );
  }
}
