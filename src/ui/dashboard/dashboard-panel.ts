import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { GitService } from "../../git/git-service";
import type { DashboardMessage } from "../../models/messages";
import {
  ENVIRONMENT_ICONS,
  ENVIRONMENT_LABELS,
} from "../../models/workspace";
import { STACK_FIELD_DEFINITIONS, stackFieldSources } from "../../models/stack";
import { MemoryService } from "../../services/memory-service";
import { MissionService } from "../../services/mission-service";
import { StatusService } from "../../services/status-service";
import { WorkspaceService } from "../../services/workspace-service";

export class DashboardPanel {
  private panel: vscode.WebviewPanel | undefined;
  private htmlLoaded = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceService: WorkspaceService,
    private readonly statusService: StatusService,
    private readonly memoryService: MemoryService,
    private readonly gitService: GitService,
    private readonly missionService: MissionService,
  ) {}

  async show(workspaceId?: string): Promise<void> {
    let workspace = workspaceId
      ? this.workspaceService.list().find((w) => w.id === workspaceId) ?? null
      : this.workspaceService.getActive();

    if (!workspace && workspaceId) {
      workspace = await this.workspaceService.switch(workspaceId);
    }

    if (!workspace) {
      void vscode.window.showWarningMessage(
        "No workspace selected. Create or switch to a workspace first.",
      );
      return;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "strataDashboard",
        "Strata Dashboard",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [
            vscode.Uri.file(path.join(this.context.extensionPath, "dist")),
          ],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.htmlLoaded = false;
      });

      this.panel.webview.onDidReceiveMessage(async (msg: DashboardMessage) => {
        await this.handleMessage(msg);
      });
    }

    this.panel.title = `${workspace.name} — Dashboard`;
    this.panel.reveal(vscode.ViewColumn.One);

    if (!this.htmlLoaded) {
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.htmlLoaded = true;
    }

    await this.pushState(workspace);
  }

  async refresh(): Promise<void> {
    const workspace = this.workspaceService.getActive();
    if (workspace && this.panel) {
      await this.pushState(workspace);
    }
  }

  private async handleMessage(msg: DashboardMessage): Promise<void> {
    const workspace = this.workspaceService.getActive();
    if (!workspace) {
      return;
    }

    switch (msg.type) {
      case "ready":
      case "refresh":
        await this.pushState(workspace);
        break;
      case "openMemory":
        await vscode.commands.executeCommand(
          "strata.openMemory",
          workspace.id,
          msg.file,
        );
        break;
      case "continueWork":
        this.workspaceService.touchAiActivity(workspace);
        void vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
        break;
      case "openAiChat":
        this.workspaceService.touchAiActivity(workspace);
        await vscode.commands.executeCommand("workbench.action.chat.open");
        break;
      case "publish":
        await vscode.commands.executeCommand("strata.publish");
        break;
      case "createFeature":
        await vscode.commands.executeCommand("strata.createFeature");
        break;
      case "connectRepo":
        await vscode.commands.executeCommand("strata.connectRepo");
        break;
      case "startWorkFromBranch":
        await vscode.commands.executeCommand(
          "strata.startWorkFromBranch",
          workspace.id,
          msg.sourceBranch,
          msg.isRemote,
          msg.remote,
        );
        break;
      case "resumeWork":
        await vscode.commands.executeCommand(
          "strata.resumeWork",
          workspace.id,
          msg.branch,
        );
        break;
      case "archiveWork":
        await vscode.commands.executeCommand("strata.archiveWork");
        break;
      case "syncRules":
        await vscode.commands.executeCommand("strata.syncRules");
        break;
      case "newRefresh":
        await vscode.commands.executeCommand("strata.newRefresh");
        break;
      case "archiveRefresh":
        await vscode.commands.executeCommand("strata.archiveRefresh");
        break;
      case "runRetro":
        await vscode.commands.executeCommand("strata.runRetro");
        break;
      case "archiveRetro":
        await vscode.commands.executeCommand("strata.archiveRetro");
        break;
      case "saveStack": {
        const updated = this.workspaceService.updateStack(workspace, msg.stack);
        await this.pushState(updated);
        void vscode.window.showInformationMessage("Technology stack saved.");
        break;
      }
      case "detectStack": {
        const { workspace: updated, persisted } =
          this.workspaceService.syncStackFromProject(
            workspace,
            msg.overwrite ? "overwrite" : "fill",
          );
        await this.pushState(updated);
        void vscode.window.showInformationMessage(
          persisted
            ? "Stack detected from project files and saved."
            : "Stack detection complete — no new changes to save.",
        );
        break;
      }
      case "detectStructure": {
        const { workspace: updated, persisted } =
          this.workspaceService.syncStructureFromProject(
            workspace,
            msg.overwrite ? "overwrite" : "fill",
          );
        await this.pushState(updated);
        void vscode.window.showInformationMessage(
          persisted
            ? "Structure detected from the repo and saved as a draft contract."
            : "Structure detection complete — no new changes to save.",
        );
        break;
      }
      case "lockStructure": {
        try {
          const updated = this.workspaceService.lockStructure(workspace);
          await this.pushState(updated);
          void vscode.window.showInformationMessage(
            "Structure contract locked. Agents will treat service roots as durable.",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(message);
        }
        break;
      }
      case "unlockStructure": {
        try {
          const updated = this.workspaceService.unlockStructure(workspace);
          await this.pushState(updated);
          void vscode.window.showInformationMessage(
            "Structure contract unlocked (draft). Re-lock when ready.",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(message);
        }
        break;
      }
      case "testInDevMode":
        await vscode.commands.executeCommand("strata.testInDevMode");
        break;
      case "archivePreview":
        try {
          const updated = await this.missionService.archivePreviewTest(workspace);
          await this.pushState(updated);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(message);
        }
        break;
      case "startMultiAgentCrew":
        await vscode.commands.executeCommand("strata.startMultiAgentCrew");
        break;
      case "archiveCrew":
        try {
          const updated = await this.missionService.archiveCrew(workspace);
          await this.pushState(updated);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(message);
        }
        break;
      case "copyCrewLanePrompt":
        await vscode.commands.executeCommand(
          "strata.copyCrewLanePrompt",
          msg.laneId,
        );
        break;
      case "setCrewLaneStatus":
        await vscode.commands.executeCommand(
          "strata.setCrewLaneStatus",
          msg.laneId,
          msg.status,
        );
        break;
      case "copyCrewIntegratorPrompt":
        await vscode.commands.executeCommand("strata.copyCrewIntegratorPrompt");
        break;
    }
  }

  private async pushState(workspace: import("../../models/workspace").Workspace): Promise<void> {
    if (!this.panel) {
      return;
    }

    const savedStack = workspace.stack ?? {};
    const { workspace: synced, detection, persisted } =
      this.workspaceService.syncStackFromProject(workspace, "fill");
    workspace = synced;

    const {
      workspace: structureSynced,
      persisted: structureAutoSaved,
    } = this.workspaceService.syncStructureFromProject(workspace, "fill");
    workspace = structureSynced;
    const structureValidation =
      this.workspaceService.validateStructure(workspace);
    const structure = workspace.structure ?? null;

    const status = await this.statusService.getStatus(workspace);
    const memoryFiles = this.memoryService.list(workspace.repoPath);
    let branches: Awaited<ReturnType<GitService["listBranches"]>> = [];
    try {
      branches = await this.gitService.listBranches(
        workspace.repoPath,
        workspace.git.remote,
        workspace.git.trunk,
      );
    } catch {
      branches = [];
    }

    this.panel.webview.postMessage({
      type: "state",
      payload: {
        name: workspace.name,
        environment: workspace.environment,
        environmentLabel: ENVIRONMENT_LABELS[workspace.environment],
        environmentIcon: ENVIRONMENT_ICONS[workspace.environment],
        currentGoal: workspace.currentGoal,
        featureName: workspace.currentFeature?.name ?? null,
        featureBranch: workspace.currentFeature?.branch ?? null,
        featureScope: workspace.currentFeature?.scope ?? [],
        gitBranch: status.git.branch,
        gitAhead: status.git.ahead,
        gitBehind: status.git.behind,
        gitClean: status.git.isClean,
        changesFiles: status.changes.files,
        aiLastActive: status.ai.lastActiveLabel,
        memoryFiles,
        githubConnected: status.github.connected,
        githubRepo: status.github.githubRepo,
        githubRemoteUrl: status.github.remoteUrl,
        githubGhAvailable: status.github.ghAvailable,
        githubGhAuthenticated: status.github.ghAuthenticated,
        githubPrUrl: status.github.prUrl,
        githubPrNumber: status.github.prNumber,
        githubPrState: status.github.prState,
        githubChecksState: status.github.checksState,
        githubChecksSummary: status.github.checksSummary,
        featurePrUrl: workspace.currentFeature?.prUrl ?? null,
        featureLastSyncedAt: workspace.currentFeature?.lastSyncedAt ?? null,
        branches: branches.map((branch) => ({
          name: branch.name,
          isCurrent: branch.isCurrent,
          isRemote: branch.isRemote,
          isProtected: branch.isProtected,
        })),
        activeWorkBranch: workspace.currentFeature?.branch ?? null,
        safetyWarning: status.safety.warning,
        trunkLocked: status.safety.trunkLocked,
        workHistory: (workspace.workHistory ?? []).map((session) => ({
          name: session.name,
          branch: session.branch,
          sourceBranch: session.sourceBranch ?? null,
          status: session.status,
          prUrl: session.prUrl ?? null,
        })),
        activeRefresh: workspace.activeRefresh
          ? {
              title: workspace.activeRefresh.title,
              phase: workspace.activeRefresh.phase,
              startedAt: workspace.activeRefresh.startedAt,
            }
          : null,
        activeRetro: workspace.activeRetro
          ? { startedAt: workspace.activeRetro.startedAt }
          : null,
        activePreview: workspace.activePreview
          ? {
              focus: workspace.activePreview.focus,
              startedAt: workspace.activePreview.startedAt,
              targets: workspace.activePreview.targets.map((t) => ({
                root: t.root,
                label: t.label,
                kind: t.kind,
                fileCount: t.changedFiles.length,
              })),
            }
          : null,
        activeCrew: workspace.activeCrew
          ? {
              goal: workspace.activeCrew.goal,
              phase: workspace.activeCrew.phase,
              startedAt: workspace.activeCrew.startedAt,
              lanes: workspace.activeCrew.lanes.map((lane) => ({
                id: lane.id,
                title: lane.title,
                role: lane.role,
                root: lane.root,
                status: lane.status,
              })),
            }
          : null,
        stack: workspace.stack ?? {},
        stackFields: STACK_FIELD_DEFINITIONS.map((field) => ({
          key: field.key,
          label: field.label,
          placeholder: field.placeholder,
          options: field.options,
        })),
        stackDetectionSources: detection.sources,
        stackDetectedFromProject: detection.hasProjectCode,
        stackAutoSaved: persisted,
        stackFieldSources: stackFieldSources(savedStack, detection.stack),
        structure: {
          status: structure?.status ?? "none",
          layout: structure?.layout ?? "unknown",
          lockedAt: structure?.lockedAt ?? null,
          detectedAt: structure?.detectedAt ?? null,
          sources: structure?.sources ?? [],
          services: (structure?.services ?? []).map((service) => ({
            id: service.id,
            name: service.name,
            root: service.root,
            kind: service.kind,
            expectedPaths: service.expectedPaths,
            conventions: service.conventions,
            libraries: service.libraries,
          })),
          ciPaths: structure?.ciPaths ?? [],
          notes: structure?.notes ?? "",
          validationOk: structureValidation.ok,
          validationSummary: structureValidation.summary,
          drift: structureValidation.drift.map((item) => ({
            path: item.path,
            issue: item.issue,
            message: item.message,
          })),
          autoSaved: structureAutoSaved,
        },
      },
    } satisfies DashboardMessage);
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      "dist",
      "dashboard.html",
    );
    const raw = fs.readFileSync(htmlPath, "utf8");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    if (raw.includes("Content-Security-Policy")) {
      return raw.replace(
        /content="[^"]*"/,
        `content="${csp}"`,
      );
    }

    return raw.replace(
      "<head>",
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    );
  }
}
