import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import * as vscode from "vscode";
import type { Workspace, WorkspaceGitConfig } from "../models/workspace";
import { GitService } from "../git/git-service";
import { GitHubService } from "../github/github-service";
import { WorkspaceService } from "./workspace-service";

export interface ConnectResult {
  remoteUrl: string;
  githubRepo: string;
  trunk: string;
}

export class ConnectService {
  constructor(
    private readonly gitService: GitService,
    private readonly githubService: GitHubService,
    private readonly workspaceService: WorkspaceService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  async runConnectWizard(): Promise<Workspace | null> {
    const items = [
      {
        label: "Link current folder",
        description: "Verify origin remote and sync GitHub metadata",
        action: "link" as const,
      },
      {
        label: "Clone from GitHub",
        description: "Clone a repo URL and create a workspace",
        action: "clone" as const,
      },
      {
        label: "Create repo on GitHub",
        description: "Create a new GitHub repo from your local folder",
        action: "create" as const,
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Connect to GitHub",
    });

    if (!picked) {
      return null;
    }

    switch (picked.action) {
      case "link":
        return this.linkCurrentFolder();
      case "clone":
        return this.cloneFromGitHub();
      case "create":
        return this.createOnGitHub();
    }
  }

  async linkWorkspace(workspace: Workspace): Promise<ConnectResult> {
    const remoteUrl = await this.gitService.getRemoteUrl(
      workspace.repoPath,
      workspace.git.remote,
    );

    if (!remoteUrl) {
      throw new Error(
        `No "${workspace.git.remote}" remote found. Create a GitHub repo first or run "Create repo on GitHub".`,
      );
    }

    const githubRepo = this.githubService.parseGitHubRepo(remoteUrl);
    if (!githubRepo) {
      throw new Error("Remote is not a GitHub repository.");
    }

    await this.gitService.fetchAll(workspace.repoPath);
    const trunk = await this.gitService.resolveTrunk(
      workspace.repoPath,
      workspace.git.remote,
    );
    const branch = await this.gitService.getCurrentBranch(workspace.repoPath);

    const git: WorkspaceGitConfig = {
      ...workspace.git,
      trunk,
      branch,
      remoteUrl,
      githubRepo,
    };

    this.workspaceService.updateGitConfig(workspace, git);

    const linked = this.workspaceService.getActive() ?? workspace;
    await this.workspaceService.syncRules(linked);
    this.workspaceService.syncStackFromProject(linked, "fill");

    return { remoteUrl, githubRepo, trunk };
  }

  private async linkCurrentFolder(): Promise<Workspace | null> {
    let workspace = this.workspaceService.getActive();

    if (!workspace) {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage("Open a folder first.");
        return null;
      }

      if (!(await this.gitService.isRepo(folder.uri.fsPath))) {
        void vscode.window.showWarningMessage("Open folder is not a Git repository.");
        return null;
      }

      workspace = await this.workspaceService.ensureWorkspaceForOpenFolder();
    }

    if (!workspace) {
      return null;
    }

    try {
      const result = await this.linkWorkspace(workspace);
      void vscode.window.showInformationMessage(
        `Connected to ${result.githubRepo} on GitHub.`,
      );
      return this.workspaceService.getActive();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(message);
      return null;
    }
  }

  private async cloneFromGitHub(): Promise<Workspace | null> {
    const url = await vscode.window.showInputBox({
      prompt: "GitHub repository URL",
      placeHolder: "https://github.com/owner/repo or git@github.com:owner/repo.git",
      validateInput: (value) =>
        value.trim() ? null : "Repository URL is required",
    });

    if (!url) {
      return null;
    }

    const folders = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Clone into this folder's parent",
    });

    if (!folders?.[0]) {
      return null;
    }

    const parentDir = folders[0].fsPath;
    const repoName =
      this.githubService.parseGitHubRepo(url.trim())?.split("/").pop() ??
      url.trim().split("/").pop()?.replace(/\.git$/, "") ??
      "repo";
    const targetPath = path.join(parentDir, repoName);

    if (fs.existsSync(targetPath)) {
      void vscode.window.showErrorMessage(`Folder already exists: ${targetPath}`);
      return null;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Cloning ${repoName}...`,
        cancellable: false,
      },
      async () => {
        await simpleGit().clone(url.trim(), targetPath);
        await simpleGit(targetPath).fetch(["--all", "--prune"]);
      },
    );

    const workspace = await this.workspaceService.create(
      {
        repoPath: targetPath,
        name: repoName,
        environment: "development",
        currentGoal: `Set up ${repoName}`,
      },
      { skipOpenFolder: true },
    );

    await this.linkWorkspace(workspace);
    await this.context.globalState.update(
      "strata.pendingCloneWorkspaceId",
      workspace.id,
    );
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(targetPath),
      { forceNewWindow: false },
    );

    void vscode.window.showInformationMessage(`Cloned and connected ${repoName}.`);
    return this.workspaceService.getActive();
  }

  private async createOnGitHub(): Promise<Workspace | null> {
    const gh = await this.githubService.checkAvailability();
    if (!gh.available) {
      void vscode.window.showErrorMessage(
        "Install GitHub CLI: https://cli.github.com/",
      );
      return null;
    }

    if (!gh.authenticated) {
      void vscode.window.showErrorMessage(
        "Run `gh auth login` in a terminal, then try again.",
      );
      return null;
    }

    let workspace = this.workspaceService.getActive();
    let repoPath: string;

    if (workspace) {
      repoPath = workspace.repoPath;
    } else {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage("Open a project folder first.");
        return null;
      }
      repoPath = folder.uri.fsPath;
    }

    const existingRemote = await this.gitService.getRemoteUrl(repoPath);
    if (existingRemote && this.githubService.parseGitHubRepo(existingRemote)) {
      const proceed = await vscode.window.showWarningMessage(
        "This folder already has a GitHub remote. Link it instead?",
        "Link Remote",
        "Cancel",
      );
      if (proceed !== "Link Remote") {
        return null;
      }

      if (!workspace) {
        workspace = await this.workspaceService.create({
          repoPath,
          name: path.basename(repoPath),
        });
      }

      await this.linkWorkspace(workspace);
      return this.workspaceService.getActive();
    }

    if (!(await this.gitService.isRepo(repoPath))) {
      await simpleGit(repoPath).init();
    }

    const defaultName = path.basename(repoPath);
    const name = await vscode.window.showInputBox({
      prompt: "GitHub repository name",
      value: defaultName,
      validateInput: (value) =>
        value.trim() ? null : "Repository name is required",
    });

    if (!name) {
      return null;
    }

    const visibility = await vscode.window.showQuickPick(
      [
        { label: "Private", value: true },
        { label: "Public", value: false },
      ],
      { placeHolder: "Repository visibility" },
    );

    if (!visibility) {
      return null;
    }

    let result: { remoteUrl: string; githubRepo: string } | undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating github.com/${gh.username}/${name.trim()}...`,
        cancellable: false,
      },
      async () => {
        result = await this.githubService.createRepo(
          repoPath,
          name.trim(),
          visibility.value,
          true,
        );
      },
    );

    if (!result) {
      return null;
    }

    if (!workspace) {
      workspace = await this.workspaceService.create({
        repoPath,
        name: name.trim(),
        environment: "development",
        currentGoal: `Set up ${name.trim()}`,
      });
    }

    await this.linkWorkspace(workspace);
    void vscode.window.showInformationMessage(
      `Created and connected ${result.githubRepo} on GitHub.`,
    );
    return this.workspaceService.getActive();
  }
}
