import * as vscode from "vscode";
import type { GitBranchInfo } from "../../git/git-service";
import { GitService } from "../../git/git-service";
import type { MemoryFileName, WorkSession, Workspace, WorkspaceStatus } from "../../models/workspace";
import {
  ENVIRONMENT_ICONS,
  ENVIRONMENT_LABELS,
  MEMORY_FILES,
} from "../../models/workspace";
import { StatusService } from "../../services/status-service";
import { WorkspaceService } from "../../services/workspace-service";

type TreeNode =
  | { kind: "create" }
  | { kind: "createFeature" }
  | { kind: "workspace"; workspace: Workspace; status?: WorkspaceStatus }
  | { kind: "branchGroup"; workspace: Workspace }
  | { kind: "branch"; workspace: Workspace; branch: GitBranchInfo }
  | { kind: "resumeWork"; workspace: Workspace }
  | { kind: "archiveWork"; workspace: Workspace }
  | { kind: "workHistoryGroup"; workspace: Workspace }
  | { kind: "workHistoryItem"; workspace: Workspace; session: WorkSession }
  | { kind: "memory"; workspace: Workspace; file: MemoryFileName }
  | { kind: "actions"; workspace: Workspace };

export class WorkspaceTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private statusCache = new Map<string, WorkspaceStatus>();
  private branchCache = new Map<string, GitBranchInfo[]>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly statusService: StatusService,
    private readonly gitService: GitService,
  ) {}

  refresh(): void {
    this.branchCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  async preloadStatuses(): Promise<void> {
    const workspaces = this.workspaceService.list();
    await Promise.all(
      workspaces.map(async (workspace) => {
        try {
          const status = await this.statusService.getStatus(workspace);
          this.statusCache.set(workspace.id, status);
        } catch {
          // Ignore git errors for missing repos
        }
      }),
    );
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "create":
        return this.createButton();
      case "createFeature":
        return this.createFeatureButton();
      case "workspace":
        return this.workspaceItem(element.workspace, element.status);
      case "branchGroup":
        return this.branchGroupItem(element.workspace);
      case "branch":
        return this.branchItem(element.workspace, element.branch);
      case "resumeWork":
        return this.resumeWorkItem(element.workspace);
      case "archiveWork":
        return this.archiveWorkItem(element.workspace);
      case "workHistoryGroup":
        return this.workHistoryGroupItem(element.workspace);
      case "workHistoryItem":
        return this.workHistoryItem(element.workspace, element.session);
      case "memory":
        return this.memoryItem(element.workspace, element.file);
      case "actions":
        return this.actionsItem(element.workspace);
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      await this.preloadStatuses();
      const workspaces = this.workspaceService.list();
      const nodes: TreeNode[] = workspaces.map((workspace) => ({
        kind: "workspace" as const,
        workspace,
        status: this.statusCache.get(workspace.id),
      }));
      nodes.push({ kind: "create" });
      if (workspaces.some((w) => w.isActive)) {
        nodes.push({ kind: "createFeature" });
      }
      return nodes;
    }

    if (element.kind === "workspace") {
      const memoryNodes = MEMORY_FILES.map((file) => ({
        kind: "memory" as const,
        workspace: element.workspace,
        file,
      }));
      const nodes: TreeNode[] = [
        { kind: "actions" as const, workspace: element.workspace },
      ];
      if (element.workspace.isActive && element.workspace.currentFeature) {
        nodes.push(
          { kind: "resumeWork" as const, workspace: element.workspace },
          { kind: "archiveWork" as const, workspace: element.workspace },
        );
      }
      nodes.push({ kind: "branchGroup" as const, workspace: element.workspace });
      if ((element.workspace.workHistory?.length ?? 0) > 0) {
        nodes.push({
          kind: "workHistoryGroup" as const,
          workspace: element.workspace,
        });
      }
      return [...nodes, ...memoryNodes];
    }

    if (element.kind === "workHistoryGroup") {
      return (element.workspace.workHistory ?? []).map((session) => ({
        kind: "workHistoryItem" as const,
        workspace: element.workspace,
        session,
      }));
    }

    if (element.kind === "branchGroup") {
      let branches = this.branchCache.get(element.workspace.id);
      if (!branches) {
        try {
          branches = await this.gitService.listBranches(
            element.workspace.repoPath,
            element.workspace.git.remote,
            element.workspace.git.trunk,
          );
          this.branchCache.set(element.workspace.id, branches);
        } catch {
          branches = [];
        }
      }

      if (branches.length === 0) {
        return [
          {
            kind: "branch" as const,
            workspace: element.workspace,
            branch: {
              name: "(no branches)",
              isCurrent: false,
              isRemote: false,
              remote: null,
              isProtected: false,
            },
          },
        ];
      }

      return branches.map((branch) => ({
        kind: "branch" as const,
        workspace: element.workspace,
        branch,
      }));
    }

    return [];
  }

  private createButton(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      "Create Workspace",
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("add");
    item.command = {
      command: "strata.createWorkspace",
      title: "Create Workspace",
    };
    return item;
  }

  private createFeatureButton(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      "Create Feature",
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("git-branch");
    item.command = {
      command: "strata.createFeature",
      title: "Create Feature",
    };
    return item;
  }

  private workspaceItem(
    workspace: Workspace,
    status?: WorkspaceStatus,
  ): vscode.TreeItem {
    const icon = ENVIRONMENT_ICONS[workspace.environment];
    const envLabel = ENVIRONMENT_LABELS[workspace.environment];
    const gitLabel = status
      ? status.git.ahead > 0
        ? `↑${status.git.ahead}`
        : status.git.behind > 0
          ? `↓${status.git.behind}`
          : workspace.currentFeature?.branch ?? status.git.branch
      : "";

    const item = new vscode.TreeItem(
      workspace.name,
      vscode.TreeItemCollapsibleState.Expanded,
    );

    item.description = workspace.isActive
      ? workspace.currentFeature
        ? `${workspace.currentFeature.name} · active`
        : `${envLabel} · ${gitLabel || "active"}`
      : envLabel;
    item.tooltip = [
      `${icon} ${workspace.name}`,
      `Environment: ${envLabel}`,
      workspace.currentFeature
        ? `Work: ${workspace.currentFeature.name} on ${workspace.currentFeature.branch}`
        : undefined,
      workspace.currentFeature
        ? `Based on: ${workspace.currentFeature.sourceBranch}`
        : undefined,
      `Goal: ${workspace.currentGoal}`,
      status
        ? `Git: ${status.git.branch} ${gitLabel}`
        : undefined,
      status?.github.connected
        ? `GitHub: ${status.github.githubRepo ?? "connected"}`
        : undefined,
      status?.github.prUrl ? `PR: ${status.github.prUrl}` : undefined,
      status ? `AI: ${status.ai.lastActiveLabel}` : undefined,
      workspace.repoPath,
    ]
      .filter(Boolean)
      .join("\n");

    item.contextValue = workspace.isActive
      ? "strata.workspace.active"
      : "strata.workspace";

    if (workspace.isActive) {
      item.iconPath = new vscode.ThemeIcon("circle-filled");
    } else {
      item.iconPath = new vscode.ThemeIcon("folder");
    }

    item.command = {
      command: "strata.switchWorkspace",
      title: "Switch Workspace",
      arguments: [workspace.id],
    };

    return item;
  }

  private branchGroupItem(workspace: Workspace): vscode.TreeItem {
    const branches = this.branchCache.get(workspace.id);
    const count = branches?.length;
    const item = new vscode.TreeItem(
      "Branches (click to fork new work)",
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.iconPath = new vscode.ThemeIcon("git-branch");
    item.description = count !== undefined ? String(count) : undefined;
    item.contextValue = "strata.branchGroup";
    item.tooltip =
      "Click any branch to start work on a new branch forked from it. Strata never edits existing branches.";
    return item;
  }

  private branchItem(workspace: Workspace, branch: GitBranchInfo): vscode.TreeItem {
    const isPlaceholder = branch.name === "(no branches)";
    const tags: string[] = [];
    if (branch.isProtected) {
      tags.push("protected");
    }
    if (branch.isRemote) {
      tags.push("remote");
    }

    const isActiveWorkBranch =
      workspace.isActive &&
      workspace.currentFeature?.branch === branch.name &&
      branch.isCurrent;

    const label = branch.name;

    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );

    if (isPlaceholder) {
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    item.iconPath = isActiveWorkBranch
      ? new vscode.ThemeIcon("check")
      : branch.isProtected
        ? new vscode.ThemeIcon("lock")
        : new vscode.ThemeIcon("repo-forked");

    item.description = isActiveWorkBranch
      ? "your work"
      : tags.length > 0
        ? tags.join(" · ")
        : undefined;

    item.tooltip = isActiveWorkBranch
      ? `Your active work branch. Publish saves here — never to ${workspace.git.trunk}.`
      : branch.isProtected
        ? `Protected branch. Click to fork new work from ${branch.name} without changing it.`
        : `Fork new work from ${branch.name}. Creates a fresh branch — original stays untouched.`;

    if (!isActiveWorkBranch) {
      item.command = {
        command: "strata.startWorkFromBranch",
        title: "Branch Work Action",
        arguments: [
          workspace.id,
          branch.name,
          branch.isRemote,
          branch.remote ?? workspace.git.remote,
        ],
      };
    }

    return item;
  }

  private resumeWorkItem(workspace: Workspace): vscode.TreeItem {
    const feature = workspace.currentFeature!;
    const item = new vscode.TreeItem(
      `Resume: ${feature.name}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("debug-start");
    item.description = feature.branch;
    item.command = {
      command: "strata.resumeWork",
      title: "Resume Work",
      arguments: [workspace.id],
    };
    return item;
  }

  private archiveWorkItem(workspace: Workspace): vscode.TreeItem {
    const item = new vscode.TreeItem(
      "Archive Work",
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("archive");
    item.description = workspace.currentFeature?.branch;
    item.command = {
      command: "strata.archiveWork",
      title: "Archive Work",
    };
    return item;
  }

  private workHistoryGroupItem(workspace: Workspace): vscode.TreeItem {
    const count = workspace.workHistory?.length ?? 0;
    const item = new vscode.TreeItem(
      "Work History",
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = new vscode.ThemeIcon("history");
    item.description = String(count);
    return item;
  }

  private workHistoryItem(
    workspace: Workspace,
    session: WorkSession,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      session.name,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("git-branch");
    item.description = `${session.branch} · ${session.status}`;
    item.tooltip = `${session.goal}\nBranch: ${session.branch}\nFrom: ${session.sourceBranch ?? "unknown"}`;
    item.command = {
      command: "strata.resumeWork",
      title: "Resume Work",
      arguments: [workspace.id, session.branch],
    };
    return item;
  }

  private memoryItem(
    workspace: Workspace,
    file: MemoryFileName,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      file,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("book");
    item.command = {
      command: "strata.openMemory",
      title: "Open Memory File",
      arguments: [workspace.id, file],
    };
    return item;
  }

  private actionsItem(workspace: Workspace): vscode.TreeItem {
    const item = new vscode.TreeItem(
      "Dashboard · Publish",
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("rocket");
    item.command = {
      command: "strata.openDashboard",
      title: "Open Dashboard",
      arguments: [workspace.id],
    };
    return item;
  }
}
