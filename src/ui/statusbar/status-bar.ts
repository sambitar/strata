import * as vscode from "vscode";
import type { Workspace, WorkspaceStatus } from "../../models/workspace";
import {
  ENVIRONMENT_ICONS,
  ENVIRONMENT_LABELS,
} from "../../models/workspace";

export class StrataStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = "strata.openDashboard";
    this.item.show();
  }

  update(workspace: Workspace | null, status: WorkspaceStatus | null): void {
    if (!workspace || !status) {
      this.item.text = "$(layers) Strata";
      this.item.tooltip = "No active workspace — create or switch one";
      this.item.backgroundColor = undefined;
      return;
    }

    const icon = ENVIRONMENT_ICONS[workspace.environment];
    const env = ENVIRONMENT_LABELS[workspace.environment];
    const gitDelta =
      status.git.ahead > 0
        ? `↑${status.git.ahead}`
        : status.git.behind > 0
          ? `↓${status.git.behind}`
          : "clean";

    const lockIcon = status.safety.trunkLocked ? "$(lock) " : "";
    const branchLabel = workspace.currentFeature?.branch ?? status.git.branch;

    this.item.text = `${lockIcon}${icon} ${workspace.name}  $(git-branch) ${branchLabel}  ${gitDelta}  $(hubot) ${status.ai.lastActiveLabel}`;
    this.item.tooltip = [
      `${workspace.name} (${env})`,
      workspace.currentFeature
        ? `Work: ${workspace.currentFeature.name} on ${workspace.currentFeature.branch}`
        : undefined,
      `Goal: ${workspace.currentGoal}`,
      `Git: ${status.git.branch} · ${gitDelta}`,
      status.safety.warning ?? undefined,
      status.safety.trunkLocked
        ? "TRUNK LOCKED — start or resume work on a new branch"
        : undefined,
      `Changes: ${status.changes.files} files`,
      `AI: ${status.ai.lastActiveLabel}`,
      "Click to open dashboard",
    ]
      .filter(Boolean)
      .join("\n");

    if (status.safety.trunkLocked) {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
    } else if (workspace.environment === "production") {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
