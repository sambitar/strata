import * as vscode from "vscode";
import type { Workspace } from "../models/workspace";
import type { WorkspaceService } from "./workspace-service";

export type StructureEnforcementMode = "off" | "warn" | "block";

export function getStructureEnforcementMode(): StructureEnforcementMode {
  const mode = vscode.workspace
    .getConfiguration("strata")
    .get<string>("structureEnforcement", "warn");
  if (mode === "off" || mode === "block" || mode === "warn") {
    return mode;
  }
  return "warn";
}

/**
 * Gate create-feature / publish / start-work behind the structure contract.
 * Returns an up-to-date workspace, or null if the user cancelled / was blocked.
 */
export async function ensureStructureAllowsAction(
  workspaceService: WorkspaceService,
  workspace: Workspace,
  actionLabel: string,
): Promise<Workspace | null> {
  const mode = getStructureEnforcementMode();
  if (mode === "off") {
    return workspace;
  }

  const { workspace: synced } = workspaceService.syncStructureFromProject(
    workspace,
    "fill",
  );
  const structure = synced.structure;
  const validation = workspaceService.validateStructure(synced);
  const locked = structure?.status === "locked";

  if (locked && validation.ok) {
    return synced;
  }

  if (locked && !validation.ok) {
    const detail = validation.drift
      .slice(0, 5)
      .map((item) => item.message)
      .join("\n");

    if (mode === "block") {
      const choice = await vscode.window.showErrorMessage(
        `Structure contract drift blocks ${actionLabel}.\n${validation.summary}`,
        "Open Dashboard",
        "Re-detect & Lock",
      );
      if (choice === "Open Dashboard") {
        await vscode.commands.executeCommand("strata.openDashboard", synced.id);
      } else if (choice === "Re-detect & Lock") {
        const refreshed = workspaceService.syncStructureFromProject(
          synced,
          "overwrite",
        ).workspace;
        return workspaceService.lockStructure(refreshed);
      }
      return null;
    }

    const choice = await vscode.window.showWarningMessage(
      `Structure drift before ${actionLabel}: ${validation.summary}${detail ? `\n${detail}` : ""}`,
      "Continue anyway",
      "Open Dashboard",
      "Cancel",
    );
    if (choice === "Continue anyway") {
      return synced;
    }
    if (choice === "Open Dashboard") {
      await vscode.commands.executeCommand("strata.openDashboard", synced.id);
    }
    return null;
  }

  // Draft or missing
  if (mode === "block") {
    const choice = await vscode.window.showErrorMessage(
      `Lock a Structure Contract before ${actionLabel}. Strata detected ${structure?.services?.length ?? 0} service(s).`,
      "Lock Contract",
      "Open Dashboard",
      "Cancel",
    );
    if (choice === "Lock Contract") {
      try {
        return workspaceService.lockStructure(synced);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(message);
        return null;
      }
    }
    if (choice === "Open Dashboard") {
      await vscode.commands.executeCommand("strata.openDashboard", synced.id);
    }
    return null;
  }

  const choice = await vscode.window.showWarningMessage(
    `No locked Structure Contract before ${actionLabel}. Detected layout: ${structure?.layout ?? "unknown"} (${structure?.services?.length ?? 0} service(s)).`,
    "Lock Contract",
    "Continue without lock",
    "Open Dashboard",
    "Cancel",
  );

  if (choice === "Lock Contract") {
    try {
      return workspaceService.lockStructure(synced);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(message);
      return null;
    }
  }

  if (choice === "Continue without lock") {
    return synced;
  }

  if (choice === "Open Dashboard") {
    await vscode.commands.executeCommand("strata.openDashboard", synced.id);
  }

  return null;
}
