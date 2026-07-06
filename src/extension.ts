import * as vscode from "vscode";
import { GitService } from "./git/git-service";
import { GitHubService } from "./github/github-service";
import { ConnectService } from "./services/connect-service";
import { MemoryService } from "./services/memory-service";
import { MissionService } from "./services/mission-service";
import { PreviewWorksetService } from "./services/preview-workset-service";
import { PublishService } from "./services/publish-service";
import { RulesService, ensureStrataHome } from "./services/rules-service";
import { StatusService } from "./services/status-service";
import { WorkspaceService } from "./services/workspace-service";
import { ThemeService } from "./theme/theme-service";
import { DashboardPanel } from "./ui/dashboard/dashboard-panel";
import { PublishPanel } from "./ui/publish/publish-panel";
import { WorkspaceTreeProvider } from "./ui/sidebar/workspace-tree";
import { StrataStatusBar } from "./ui/statusbar/status-bar";
import type { MemoryFileName, WorkspaceEnvironment } from "./models/workspace";
import { ENVIRONMENT_LABELS, defaultWorkBranchName } from "./models/workspace";

let treeProvider: WorkspaceTreeProvider;
let statusBar: StrataStatusBar;
let dashboardPanel: DashboardPanel;
let publishPanel: PublishPanel;
let workspaceService: WorkspaceService;
let statusService: StatusService;
let memoryService: MemoryService;
let gitService: GitService;
let rulesService: RulesService;
let missionService: MissionService;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    await activateStrata(context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Strata failed to activate: ${message}`);
    console.error("[Strata] activation error:", err);
  }
}

async function activateStrata(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel("Strata");
  output.appendLine("Strata v0.5.12 activated.");
  context.subscriptions.push(output);

  ensureStrataHome();
  rulesService = new RulesService(context);
  rulesService.ensureGlobalRules();

  gitService = new GitService();
  const githubService = new GitHubService();
  memoryService = new MemoryService();
  const themeService = new ThemeService();
  workspaceService = new WorkspaceService(
    gitService,
    memoryService,
    themeService,
    rulesService,
  );
  missionService = new MissionService(rulesService);
  const connectService = new ConnectService(
    gitService,
    githubService,
    workspaceService,
    context,
  );
  statusService = new StatusService(gitService, githubService);
  const publishService = new PublishService(
    gitService,
    githubService,
    memoryService,
  );

  treeProvider = new WorkspaceTreeProvider(
    workspaceService,
    statusService,
    gitService,
  );
  statusBar = new StrataStatusBar();
  dashboardPanel = new DashboardPanel(
    context,
    workspaceService,
    statusService,
    memoryService,
    gitService,
    missionService,
  );
  publishPanel = new PublishPanel(
    context,
    workspaceService,
    publishService,
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("strata.workspaces", treeProvider),
    statusBar,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("strata.createWorkspace", () =>
      createWorkspace(),
    ),
    vscode.commands.registerCommand(
      "strata.switchWorkspace",
      (workspaceId?: string) => switchWorkspace(workspaceId),
    ),
    vscode.commands.registerCommand("strata.openDashboard", (workspaceId?: string) =>
      openDashboard(workspaceId),
    ),
    vscode.commands.registerCommand("strata.publish", () => publishPanel.show()),
    vscode.commands.registerCommand(
      "strata.openMemory",
      (workspaceId: string, file: MemoryFileName) =>
        openMemory(workspaceId, file),
    ),
    vscode.commands.registerCommand("strata.refresh", () => refreshAll()),
    vscode.commands.registerCommand("strata.setEnvironment", () =>
      setEnvironment(),
    ),
    vscode.commands.registerCommand("strata.createFeature", () =>
      createFeature(),
    ),
    vscode.commands.registerCommand("strata.connectRepo", () =>
      connectRepo(connectService),
    ),
    vscode.commands.registerCommand(
      "strata.startWorkFromBranch",
      (
        workspaceId: string,
        sourceBranch: string,
        isRemote?: boolean,
        remote?: string,
      ) => branchWorkAction(workspaceId, sourceBranch, isRemote, remote),
    ),
    vscode.commands.registerCommand("strata.resumeWork", (workspaceId?: string) =>
      resumeWork(workspaceId),
    ),
    vscode.commands.registerCommand("strata.archiveWork", () => archiveWork()),
    vscode.commands.registerCommand("strata.syncRules", () => syncRules()),
    vscode.commands.registerCommand("strata.newRefresh", () => newRefresh()),
    vscode.commands.registerCommand("strata.archiveRefresh", () =>
      archiveRefresh(),
    ),
    vscode.commands.registerCommand("strata.runRetro", () => runRetro()),
    vscode.commands.registerCommand("strata.archiveRetro", () =>
      archiveRetro(),
    ),
    vscode.commands.registerCommand("strata.newFeatureRequest", () =>
      newFeatureRequest(),
    ),
    vscode.commands.registerCommand("strata.testInDevMode", () => testInDevMode()),
    vscode.commands.registerCommand("strata.archivePreview", () => archivePreview()),
  );

  await workspaceService.ensureActiveForOpenFolder();

  const pendingCloneId = context.globalState.get<string>(
    "strata.pendingCloneWorkspaceId",
  );
  if (pendingCloneId) {
    await context.globalState.update("strata.pendingCloneWorkspaceId", undefined);
    const pending = workspaceService
      .list()
      .find((workspace) => workspace.id === pendingCloneId);
    if (pending) {
      await workspaceService.switch(pending.id);
    }
  }

  await refreshAll();
  output.appendLine("Strata ready. Click the Strata icon in the LEFT activity bar (editor window).");

  const active = workspaceService.getActive();
  if (active) {
    await themeService.apply(active.environment);
    try {
      const status = await statusService.getStatus(active);
      if (status.safety.trunkLocked) {
        void vscode.window.showWarningMessage(
          status.safety.warning ??
            `You are on protected branch "${status.git.branch}". Start or resume work on a new branch.`,
          "Resume Work",
          "Open Dashboard",
        ).then((choice) => {
          if (choice === "Resume Work" && active.currentFeature) {
            void resumeWork(active.id);
          } else if (choice === "Open Dashboard") {
            void dashboardPanel.show(active.id);
          }
        });
      }
    } catch {
      // ignore status errors on startup
    }
    const openDashboard = vscode.workspace
      .getConfiguration("strata")
      .get<boolean>("openDashboardOnSwitch", true);
    const shouldOpenDashboard =
      openDashboard || Boolean(pendingCloneId && active.id === pendingCloneId);
    if (shouldOpenDashboard) {
      await dashboardPanel.show(active.id);
    }
  }

  const shown = context.globalState.get<boolean>("strata.welcomeShown");
  if (!shown) {
    void context.globalState.update("strata.welcomeShown", true);
    void vscode.window.showWarningMessage(
      "Strata is running. Switch to the EDITOR window (not this chat panel) and click the Strata icon on the far-left toolbar — or press Ctrl+Shift+P and run “Strata: Create Workspace”.",
      "Open Output",
    ).then((choice) => {
      if (choice === "Open Output") {
        output.show(true);
      }
    });
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}

async function createWorkspace(): Promise<void> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Select Git Repository",
  });

  if (!folders?.[0]) {
    return;
  }

  const repoPath = folders[0].fsPath;
  const name = await vscode.window.showInputBox({
    prompt: "Workspace name",
    value: repoPath.split("/").pop() ?? "My Workspace",
  });

  if (!name) {
    return;
  }

  const environment = await pickEnvironment("development");
  if (!environment) {
    return;
  }

  const goal = await vscode.window.showInputBox({
    prompt: "Current goal for this workspace",
    value: `Set up ${name}`,
  });

  try {
    await workspaceService.create({
      repoPath,
      name,
      environment,
      currentGoal: goal ?? `Set up ${name}`,
    });
    void vscode.window.showInformationMessage(`Workspace "${name}" created.`);
    await refreshAll();
    await dashboardPanel.show();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function switchWorkspace(workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    const workspaces = workspaceService.list();
    if (workspaces.length === 0) {
      void vscode.window.showWarningMessage("No workspaces yet.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      workspaces.map((w) => ({
        label: `${w.name} (${ENVIRONMENT_LABELS[w.environment]})`,
        description: w.repoPath,
        id: w.id,
      })),
      { placeHolder: "Switch workspace" },
    );

    if (!picked) {
      return;
    }
    workspaceId = picked.id;
  }

  try {
    await workspaceService.switch(workspaceId);
    await refreshAll();
    const openDashboard = vscode.workspace
      .getConfiguration("strata")
      .get<boolean>("openDashboardOnSwitch", true);
    if (openDashboard) {
      await dashboardPanel.show(workspaceId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function openDashboard(workspaceId?: string): Promise<void> {
  await dashboardPanel.show(workspaceId);
}

async function openMemory(
  workspaceId: string,
  file: MemoryFileName,
): Promise<void> {
  const workspace =
    workspaceService.list().find((w) => w.id === workspaceId) ??
    workspaceService.getActive();

  if (!workspace) {
    return;
  }

  const filePath = memoryService.getPath(workspace.repoPath, file);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
  workspaceService.touchAiActivity(workspace);
  await refreshAll();
}

async function createFeature(): Promise<void> {
  let workspace = workspaceService.getActive();

  if (!workspace) {
    try {
      workspace = await workspaceService.ensureWorkspaceForOpenFolder();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(message);
      return;
    }
  }

  if (!workspace) {
    void vscode.window.showWarningMessage(
      "Open a Git repo folder first, or create a workspace with Strata: Create Workspace.",
    );
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Feature name",
    placeHolder: "e.g. Stripe Webhooks",
    validateInput: (value) =>
      value.trim() ? null : "Feature name is required",
  });
  if (!name) {
    return;
  }

  const goal = await vscode.window.showInputBox({
    prompt: "What should this feature accomplish?",
    placeHolder: "e.g. Handle subscription webhook events",
    value: `Build ${name.trim()}`,
    validateInput: (value) =>
      value.trim() ? null : "Goal is required",
  });
  if (!goal) {
    return;
  }

  const scopeInput = await vscode.window.showInputBox({
    prompt: "File scope (optional, comma-separated globs)",
    placeHolder: "e.g. src/billing/**, tests/billing/**",
  });

  const scope = scopeInput
    ? scopeInput.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const defaultBranch = defaultWorkBranchName(name.trim(), workspace.git.trunk);

  const branch = await vscode.window.showInputBox({
    prompt: "New work branch (always a fresh branch — never overwrites existing)",
    value: defaultBranch,
    validateInput: (value) =>
      value.trim() ? null : "Branch name is required",
  });
  if (!branch) {
    return;
  }

  try {
    const updated = await workspaceService.createFeature(workspace, {
      name: name.trim(),
      goal: goal.trim(),
      scope,
      branch: branch.trim(),
    });

    void vscode.window.showInformationMessage(
      `Work started on new branch ${updated.currentFeature?.branch} (from ${workspace.git.trunk}). Original branches are untouched.`,
    );

    const todoPath = memoryService.getPath(updated.repoPath, "todo.md");
    const doc = await vscode.workspace.openTextDocument(todoPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    await refreshAll();
    await dashboardPanel.show(updated.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "Feature creation cancelled.") {
      void vscode.window.showErrorMessage(message);
    }
  }
}

async function connectRepo(connectService: ConnectService): Promise<void> {
  try {
    const workspace = await connectService.runConnectWizard();
    if (workspace) {
      await refreshAll();
      const reloaded = workspaceService.getActive();
      if (reloaded) {
        await dashboardPanel.show(reloaded.id);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function branchWorkAction(
  workspaceId: string,
  sourceBranch: string,
  isRemote = false,
  remote = "origin",
): Promise<void> {
  const workspace =
    workspaceService.list().find((item) => item.id === workspaceId) ??
    workspaceService.getActive();

  if (!workspace || sourceBranch === "(no branches)") {
    return;
  }

  const items: Array<{
    label: string;
    description?: string;
    action: "resume-current" | "resume-history" | "start-new";
    branch?: string;
  }> = [];

  if (workspace.currentFeature?.branch === sourceBranch) {
    items.push({
      label: `Resume "${workspace.currentFeature.name}"`,
      description: workspace.currentFeature.branch,
      action: "resume-current",
    });
  }

  const past = workspaceService.findWorkSession(workspace, sourceBranch);
  if (past && workspace.currentFeature?.branch !== sourceBranch) {
    items.push({
      label: `Resume archived "${past.name}"`,
      description: past.branch,
      action: "resume-history",
      branch: past.branch,
    });
  }

  items.push({
    label: `Start new work from ${sourceBranch}`,
    description: "Creates a fresh branch — original stays untouched",
    action: "start-new",
  });

  const picked =
    items.length === 1
      ? items[0]
      : await vscode.window.showQuickPick(items, {
          placeHolder: `Work on ${sourceBranch}`,
        });

  if (!picked) {
    return;
  }

  if (picked.action === "resume-current") {
    await resumeWork(workspaceId);
    return;
  }

  if (picked.action === "resume-history" && picked.branch) {
    await resumeWork(workspaceId, picked.branch);
    return;
  }

  await startWorkFromBranch(workspaceId, sourceBranch, isRemote, remote);
}

async function resumeWork(workspaceId?: string, branch?: string): Promise<void> {
  let workspace = workspaceId
    ? workspaceService.list().find((w) => w.id === workspaceId) ?? null
    : workspaceService.getActive();

  if (!workspace) {
    void vscode.window.showWarningMessage("No active workspace.");
    return;
  }

  if (!workspace.isActive) {
    workspace = await workspaceService.switch(workspace.id);
  }

  try {
    const updated = await workspaceService.resumeWork(workspace, branch);
    void vscode.window.showInformationMessage(
      `Resumed work on ${updated.currentFeature?.branch}.`,
    );
    await refreshAll();
    await dashboardPanel.show(updated.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function archiveWork(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace?.currentFeature) {
    void vscode.window.showWarningMessage("No active work session to archive.");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Archive "${workspace.currentFeature.name}" on ${workspace.currentFeature.branch}?`,
    "Archive",
    "Cancel",
  );
  if (confirm !== "Archive") {
    return;
  }

  try {
    await workspaceService.archiveWork(workspace);
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function syncRules(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace) {
    void vscode.window.showWarningMessage("No active workspace.");
    return;
  }

  try {
    const result = await rulesService.syncToRepo(workspace.repoPath, workspace);
    void vscode.window.showInformationMessage(
      `Synced ${result.synced} Cursor rule file(s) to .cursor/rules/`,
    );
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function newRefresh(): Promise<void> {
  const workspace = await requireActiveWorkspace();
  if (!workspace) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Refresh mission title",
    placeHolder: "e.g. Login timeout on slow networks",
    validateInput: (value) => (value.trim() ? null : "Title is required"),
  });
  if (!title) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: "Describe the persistent bug",
    placeHolder: "Symptoms, when it happens, what you tried",
    validateInput: (value) =>
      value.trim() ? null : "Description is required",
  });
  if (!description) {
    return;
  }

  try {
    await missionService.startRefresh(workspace, {
      title: title.trim(),
      description: description.trim(),
    });
    void vscode.window.showInformationMessage(
      `Refresh "${title.trim()}" started. Follow the RCA protocol in .strata/refresh/current.md`,
    );
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function archiveRefresh(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace?.activeRefresh) {
    void vscode.window.showWarningMessage("No active refresh mission.");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Archive refresh "${workspace.activeRefresh.title}"?`,
    "Archive",
    "Cancel",
  );
  if (confirm !== "Archive") {
    return;
  }

  try {
    await missionService.archiveRefresh(workspace);
    void vscode.window.showInformationMessage("Refresh archived.");
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function runRetro(): Promise<void> {
  const workspace = await requireActiveWorkspace();
  if (!workspace) {
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    "Start a retro session? The agent will analyze this session and evolve doctrine (rules/memory), not product code.",
    "Start Retro",
    "Cancel",
  );
  if (confirm !== "Start Retro") {
    return;
  }

  try {
    await missionService.startRetro(workspace);
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function archiveRetro(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace?.activeRetro) {
    void vscode.window.showWarningMessage("No active retro session.");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    "Archive this retro session?",
    "Archive",
    "Cancel",
  );
  if (confirm !== "Archive") {
    return;
  }

  try {
    await missionService.archiveRetro(workspace);
    void vscode.window.showInformationMessage("Retro archived.");
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function newFeatureRequest(): Promise<void> {
  const workspace = await requireActiveWorkspace();
  if (!workspace) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Feature request title",
    validateInput: (value) => (value.trim() ? null : "Title is required"),
  });
  if (!title) {
    return;
  }

  const goal = await vscode.window.showInputBox({
    prompt: "What should this feature accomplish?",
    validateInput: (value) => (value.trim() ? null : "Goal is required"),
  });
  if (!goal) {
    return;
  }

  const scope = await vscode.window.showInputBox({
    prompt: "Scope (optional)",
    placeHolder: "e.g. src/auth/**, tests/auth/**",
  });

  try {
    const filePath = await missionService.createFeatureRequest(workspace, {
      title: title.trim(),
      goal: goal.trim(),
      scope: scope?.trim() ?? "",
    });
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function requireActiveWorkspace(): Promise<
  import("./models/workspace").Workspace | null
> {
  let workspace = workspaceService.getActive();
  if (!workspace) {
    try {
      workspace = await workspaceService.ensureWorkspaceForOpenFolder();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(message);
      return null;
    }
  }

  if (!workspace) {
    void vscode.window.showWarningMessage(
      "Open a Git repo folder first, or create a workspace.",
    );
    return null;
  }

  return workspace;
}

async function startWorkFromBranch(
  workspaceId: string,
  sourceBranch: string,
  isRemote = false,
  remote = "origin",
): Promise<void> {
  const workspace =
    workspaceService.list().find((item) => item.id === workspaceId) ??
    workspaceService.getActive();

  if (!workspace || sourceBranch === "(no branches)") {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: `What are you building? (from ${sourceBranch})`,
    placeHolder: "e.g. Auth flow update",
    validateInput: (value) =>
      value.trim() ? null : "Work name is required",
  });
  if (!name) {
    return;
  }

  const goal = await vscode.window.showInputBox({
    prompt: "What should this accomplish?",
    value: `Build ${name.trim()}`,
    validateInput: (value) =>
      value.trim() ? null : "Goal is required",
  });
  if (!goal) {
    return;
  }

  const defaultBranch = defaultWorkBranchName(name.trim(), sourceBranch);
  const branch = await vscode.window.showInputBox({
    prompt: "New work branch on GitHub (never reuses an existing branch)",
    value: defaultBranch,
    validateInput: (value) =>
      value.trim() ? null : "Branch name is required",
  });
  if (!branch) {
    return;
  }

  try {
    let active =
      workspaceService.getActive()?.id === workspaceId
        ? workspaceService.getActive()!
        : await workspaceService.switch(workspace.id);

    const updated = await workspaceService.startWorkFromBranch(active, {
      sourceBranch,
      isRemote,
      remote,
      name: name.trim(),
      goal: goal.trim(),
      branch: branch.trim(),
    });

    void vscode.window.showInformationMessage(
      `Started work on new branch ${updated.currentFeature?.branch} (from ${sourceBranch}). Original branch is untouched.`,
    );

    const todoPath = memoryService.getPath(updated.repoPath, "todo.md");
    const doc = await vscode.workspace.openTextDocument(todoPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    await refreshAll();
    await dashboardPanel.show(updated.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "Work start cancelled.") {
      void vscode.window.showErrorMessage(message);
    }
  }
}

async function setEnvironment(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace) {
    void vscode.window.showWarningMessage("No active workspace.");
    return;
  }

  const environment = await pickEnvironment(workspace.environment);
  if (!environment) {
    return;
  }

  const updated = workspaceService.setEnvironment(workspace, environment);
  const themeService = new ThemeService();
  await themeService.apply(updated.environment);
  await refreshAll();
}

async function pickEnvironment(
  current: WorkspaceEnvironment,
): Promise<WorkspaceEnvironment | undefined> {
  const items: Array<{ label: string; value: WorkspaceEnvironment }> = [
    { label: "🔴 Production", value: "production" },
    { label: "🔵 Feature", value: "feature" },
    { label: "🟣 Experiment", value: "experiment" },
    { label: "🟢 Development", value: "development" },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select workspace environment",
  });

  return picked?.value ?? current;
}

async function testInDevMode(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace) {
    void vscode.window.showWarningMessage("No active workspace.");
    return;
  }

  const worksetService = new PreviewWorksetService();
  const workset = await worksetService.resolve(workspace);
  const targets = await worksetService.pickTargets(workset);
  if (targets === null) {
    return;
  }

  const targetHint =
    targets.length > 0
      ? targets.map((t) => t.label).join(" + ")
      : "whole repo (agent discovers)";

  const focus = await vscode.window.showInputBox({
    title: "Test in Dev Mode",
    prompt: `What to verify on ${targetHint}? (optional)`,
    placeHolder: workspace.currentFeature?.goal ?? workspace.currentGoal,
    value: workspace.currentFeature?.goal ?? "",
  });

  if (focus === undefined) {
    return;
  }

  try {
    await missionService.startPreviewTest(workspace, {
      focus,
      targets,
      workset,
    });
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function archivePreview(): Promise<void> {
  const workspace = workspaceService.getActive();
  if (!workspace?.activePreview) {
    void vscode.window.showWarningMessage("No active preview test to archive.");
    return;
  }

  try {
    await missionService.archivePreviewTest(workspace);
    await refreshAll();
    void vscode.window.showInformationMessage("Preview test archived.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
  }
}

async function refreshAll(): Promise<void> {
  treeProvider.refresh();

  const active = workspaceService.getActive();
  if (active) {
    try {
      const status = await statusService.getStatus(active);
      statusBar.update(active, status);
      await dashboardPanel.refresh();
    } catch {
      statusBar.update(active, null);
    }
  } else {
    statusBar.update(null, null);
  }
}
