import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type {
  Feature,
  WorkSession,
  Workspace,
  WorkspaceConfig,
  WorkspaceEnvironment,
  WorkspaceGitConfig,
  WorkspaceRegistryEntry,
} from "../models/workspace";
import { slugify, defaultWorkBranchName } from "../models/workspace";
import type { WorkspaceStack } from "../models/stack";
import {
  mergeStackFill,
  mergeStackOverwrite,
  normalizeStack,
  stacksEqual,
} from "../models/stack";
import type { StructureContract, StructureValidation } from "../models/structure";
import {
  normalizeStructure,
  structureHasServices,
  structuresEqual,
} from "../models/structure";
import { GitService } from "../git/git-service";
import { MemoryService } from "./memory-service";
import { RegistryStore } from "../storage/registry";
import { StackDetectionService, type StackDetectionResult } from "./stack-detection-service";
import {
  StructureDetectionService,
  type StructureDetectionResult,
} from "./structure-detection-service";
import { WorkspaceStore } from "../storage/workspace-store";
import { ThemeService } from "../theme/theme-service";
import type { RulesService } from "./rules-service";

export class WorkspaceService {
  private readonly registryStore = new RegistryStore();
  private readonly workspaceStore = new WorkspaceStore();
  private readonly stackDetectionService = new StackDetectionService();
  private readonly structureDetectionService = new StructureDetectionService();

  constructor(
    private readonly gitService: GitService,
    private readonly memoryService: MemoryService,
    private readonly themeService: ThemeService,
    private readonly rulesService?: RulesService,
  ) {}

  list(): Workspace[] {
    const registry = this.registryStore.load();
    return registry.workspaces
      .map((entry) => this.hydrate(entry, registry.activeWorkspaceId))
      .filter((workspace): workspace is Workspace => workspace !== null);
  }

  getActive(): Workspace | null {
    const registry = this.registryStore.load();
    if (!registry.activeWorkspaceId) {
      return null;
    }

    const entry = registry.workspaces.find(
      (item) => item.id === registry.activeWorkspaceId,
    );
    if (!entry) {
      return null;
    }

    return this.hydrate(entry, registry.activeWorkspaceId);
  }

  async create(
    input: {
      repoPath: string;
      name?: string;
      environment?: WorkspaceEnvironment;
      currentGoal?: string;
    },
    options?: { skipOpenFolder?: boolean },
  ): Promise<Workspace> {
    const repoPath = path.resolve(input.repoPath);

    if (!(await this.gitService.isRepo(repoPath))) {
      throw new Error("Selected folder is not a Git repository.");
    }

    const existing = this.list().find((item) => item.repoPath === repoPath);
    if (existing) {
      return await this.switch(existing.id);
    }

    const name = input.name?.trim() || path.basename(repoPath);
    const id = slugify(name) || `workspace-${Date.now()}`;
    const trunk = await this.gitService.resolveTrunk(repoPath);
    const branch = await this.gitService.getCurrentBranch(repoPath);
    const now = new Date().toISOString();

    const config: WorkspaceConfig = {
      id,
      name,
      environment: input.environment ?? "development",
      currentGoal: input.currentGoal ?? `Set up ${name}`,
      git: {
        trunk,
        branch,
        remote: "origin",
      },
      ai: {
        lastActiveAt: now,
      },
      createdAt: now,
    };

    fs.mkdirSync(path.join(repoPath, ".strata"), { recursive: true });
    this.workspaceStore.save(repoPath, config);
    this.memoryService.scaffold(repoPath, config);

    const registry = this.registryStore.load();
    const entry: WorkspaceRegistryEntry = {
      id,
      name,
      repoPath,
      lastOpenedAt: now,
    };

    registry.workspaces = [
      entry,
      ...registry.workspaces.filter((item) => item.id !== id),
    ];
    registry.activeWorkspaceId = id;
    this.registryStore.save(registry);

    const workspace = this.hydrate(entry, id);
    if (!workspace) {
      throw new Error("Failed to create workspace.");
    }

    await this.applySwitchEffects(workspace, options?.skipOpenFolder);
    await this.syncRules(workspace);
    const { workspace: withStack } = this.syncStackFromProject(workspace, "fill");
    const { workspace: withStructure } = this.syncStructureFromProject(
      withStack,
      "fill",
    );
    return withStructure;
  }

  async syncRules(workspace: Workspace): Promise<void> {
    if (!this.rulesService) {
      return;
    }
    await this.rulesService.syncToRepo(workspace.repoPath, workspace);
  }

  async syncGitFromRepo(workspace: Workspace): Promise<Workspace> {
    const branch = await this.gitService.getCurrentBranch(workspace.repoPath);
    const trunk = await this.gitService.resolveTrunk(
      workspace.repoPath,
      workspace.git.remote,
    );

    return this.updateGitConfig(workspace, {
      ...workspace.git,
      branch,
      trunk,
    });
  }

  async ensureActiveForOpenFolder(): Promise<Workspace | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return this.getActive();
    }

    const repoPath = path.resolve(folder.uri.fsPath);
    const match = this.list().find((item) => path.resolve(item.repoPath) === repoPath);
    if (!match) {
      return this.getActive();
    }

    if (!match.isActive) {
      return this.switch(match.id);
    }

    return this.syncGitFromRepo(match);
  }

  async switch(workspaceId: string): Promise<Workspace> {
    const registry = this.registryStore.load();
    const entry = registry.workspaces.find((item) => item.id === workspaceId);

    if (!entry) {
      throw new Error("Workspace not found.");
    }

    registry.activeWorkspaceId = workspaceId;
    entry.lastOpenedAt = new Date().toISOString();
    this.registryStore.save(registry);

    const workspace = this.hydrate(entry, workspaceId);
    if (!workspace) {
      throw new Error("Workspace configuration missing.");
    }

    await this.applySwitchEffects(workspace);
    return workspace;
  }

  updateGoal(workspace: Workspace, goal: string): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    const updated = {
      ...config,
      currentGoal: goal,
    };
    this.workspaceStore.save(workspace.repoPath, updated);
    return { ...workspace, ...updated, repoPath: workspace.repoPath, isActive: workspace.isActive };
  }

  touchAiActivity(workspace: Workspace): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      return workspace;
    }

    const updated = this.memoryService.touchAiActivity(config);
    this.workspaceStore.save(workspace.repoPath, updated);
    return { ...workspace, ...updated, repoPath: workspace.repoPath, isActive: workspace.isActive };
  }

  setEnvironment(
    workspace: Workspace,
    environment: WorkspaceEnvironment,
  ): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    const updated = { ...config, environment };
    this.workspaceStore.save(workspace.repoPath, updated);
    return { ...workspace, ...updated, repoPath: workspace.repoPath, isActive: workspace.isActive };
  }

  updateStack(workspace: Workspace, stack: WorkspaceStack): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    const normalized = normalizeStack(stack);
    const updated = { ...config, stack: normalized };
    this.workspaceStore.save(workspace.repoPath, updated);
    this.memoryService.syncStackInArchitecture(
      workspace.repoPath,
      config.name,
      normalized,
    );
    return { ...workspace, ...updated, repoPath: workspace.repoPath, isActive: workspace.isActive };
  }

  syncStackFromProject(
    workspace: Workspace,
    mode: "fill" | "overwrite" = "fill",
  ): {
    workspace: Workspace;
    detection: StackDetectionResult;
    persisted: boolean;
  } {
    const detection = this.stackDetectionService.detect(workspace.repoPath);
    if (!detection.hasProjectCode) {
      return { workspace, detection, persisted: false };
    }

    const merged =
      mode === "overwrite"
        ? mergeStackOverwrite(detection.stack)
        : mergeStackFill(workspace.stack, detection.stack);
    const normalized = normalizeStack(merged);

    if (!stacksEqual(workspace.stack, normalized)) {
      const updated = this.updateStack(workspace, normalized);
      return { workspace: updated, detection, persisted: true };
    }

    return {
      workspace: { ...workspace, stack: normalized },
      detection,
      persisted: false,
    };
  }

  detectStack(repoPath: string): StackDetectionResult {
    return this.stackDetectionService.detect(repoPath);
  }

  updateStructure(
    workspace: Workspace,
    structure: StructureContract,
  ): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    const normalized = normalizeStructure(structure);
    if (!normalized) {
      throw new Error("Invalid structure contract.");
    }

    const updated = { ...config, structure: normalized };
    this.workspaceStore.save(workspace.repoPath, updated);
    this.memoryService.syncStructureInArchitecture(
      workspace.repoPath,
      config.name,
      normalized,
    );

    const next = {
      ...workspace,
      ...updated,
      repoPath: workspace.repoPath,
      isActive: workspace.isActive,
    };

    if (this.rulesService) {
      void this.rulesService.syncToRepo(workspace.repoPath, next);
    }

    return next;
  }

  syncStructureFromProject(
    workspace: Workspace,
    mode: "fill" | "overwrite" = "fill",
  ): {
    workspace: Workspace;
    detection: StructureDetectionResult;
    persisted: boolean;
  } {
    const detection = this.structureDetectionService.detect(workspace.repoPath);
    if (!detection.hasProjectCode && !structureHasServices(workspace.structure)) {
      return { workspace, detection, persisted: false };
    }

    let nextStructure: StructureContract;
    if (mode === "overwrite") {
      const prior = normalizeStructure(workspace.structure);
      nextStructure = {
        ...detection.structure,
        status: prior?.status === "locked" ? "locked" : "draft",
        lockedAt: prior?.status === "locked" ? prior.lockedAt : null,
        notes: prior?.notes ?? "",
      };
    } else {
      nextStructure = this.structureDetectionService.mergePreserveLock(
        workspace.structure,
        detection.structure,
      );
    }

    const normalized = normalizeStructure(nextStructure);
    if (!normalized) {
      return { workspace, detection, persisted: false };
    }

    if (!structuresEqual(workspace.structure, normalized)) {
      const updated = this.updateStructure(workspace, normalized);
      return { workspace: updated, detection, persisted: true };
    }

    return {
      workspace: { ...workspace, structure: normalized },
      detection,
      persisted: false,
    };
  }

  lockStructure(workspace: Workspace): Workspace {
    const { workspace: synced } = this.syncStructureFromProject(workspace, "fill");
    const structure = normalizeStructure(synced.structure);
    if (!structure || structure.services.length === 0) {
      throw new Error(
        "No services detected to lock. Add a package manifest or src/ tree first.",
      );
    }

    const locked: StructureContract = {
      ...structure,
      status: "locked",
      lockedAt: new Date().toISOString(),
      detectedAt: structure.detectedAt || new Date().toISOString(),
    };

    return this.updateStructure(synced, locked);
  }

  unlockStructure(workspace: Workspace): Workspace {
    const structure = normalizeStructure(workspace.structure);
    if (!structure) {
      throw new Error("No structure contract to unlock.");
    }

    return this.updateStructure(workspace, {
      ...structure,
      status: "draft",
      lockedAt: null,
    });
  }

  validateStructure(workspace: Workspace): StructureValidation {
    return this.structureDetectionService.validate(
      workspace.repoPath,
      workspace.structure,
    );
  }

  detectStructure(repoPath: string): StructureDetectionResult {
    return this.structureDetectionService.detect(repoPath);
  }

  async createFeature(
    workspace: Workspace,
    input: { name: string; goal: string; scope?: string[]; branch?: string },
  ): Promise<Workspace> {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    return this.startWorkFromBranch(workspace, {
      sourceBranch: config.git.trunk,
      isRemote: false,
      name: input.name,
      goal: input.goal,
      scope: input.scope,
      branch: input.branch,
    });
  }

  async startWorkFromBranch(
    workspace: Workspace,
    input: {
      sourceBranch: string;
      isRemote?: boolean;
      remote?: string;
      name: string;
      goal: string;
      scope?: string[];
      branch?: string;
    },
  ): Promise<Workspace> {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    let activeConfig = config;

    const featureId = slugify(input.name) || `feature-${Date.now()}`;
    const branch =
      input.branch?.trim() ||
      defaultWorkBranchName(input.name, input.sourceBranch);
    const scope = input.scope ?? [];
    const now = new Date().toISOString();

    if (this.gitService.isProtectedBranch(branch, activeConfig.git.trunk)) {
      throw new Error(
        `"${branch}" is a protected branch. Choose a new work branch name.`,
      );
    }

    const status = await this.gitService.getStatus(
      workspace.repoPath,
      activeConfig.git.trunk,
    );
    if (!status.isClean) {
      await this.handleDirtyWorktree(
        workspace.repoPath,
        "before starting new work",
      );
    }

    if (activeConfig.currentFeature) {
      const replace = await vscode.window.showWarningMessage(
        `Archive current work "${activeConfig.currentFeature.name}" before starting new work?`,
        "Archive & Continue",
        "Cancel",
      );
      if (replace !== "Archive & Continue") {
        throw new Error("Work start cancelled.");
      }
      await this.archiveWork(workspace, { silent: true });
      const reloaded = this.getActive();
      if (reloaded) {
        workspace = reloaded;
        const reloadedConfig = this.workspaceStore.load(workspace.repoPath);
        if (reloadedConfig) {
          activeConfig = reloadedConfig;
        }
      }
    }

    await this.gitService.createWorkBranch(
      workspace.repoPath,
      branch,
      input.sourceBranch,
      {
        isRemote: input.isRemote,
        remote: input.remote ?? activeConfig.git.remote,
      },
    );

    const feature: Feature = {
      id: featureId,
      name: input.name.trim(),
      goal: input.goal.trim(),
      scope,
      branch,
      sourceBranch: input.sourceBranch,
      startedAt: now,
      status: "active",
    };

    const updated: WorkspaceConfig = {
      ...activeConfig,
      environment: "feature",
      currentGoal: feature.goal,
      currentFeature: feature,
      git: {
        ...activeConfig.git,
        branch,
      },
      ai: {
        lastActiveAt: now,
      },
    };

    this.workspaceStore.save(workspace.repoPath, updated);
    this.memoryService.writeFeatureStart(
      workspace.repoPath,
      activeConfig.name,
      feature,
    );
    await this.themeService.apply("feature");

    return {
      ...workspace,
      ...updated,
      repoPath: workspace.repoPath,
      isActive: workspace.isActive,
    };
  }

  async ensureWorkspaceForOpenFolder(): Promise<Workspace | null> {
    const active = this.getActive();
    if (active) {
      return active;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return null;
    }

    const repoPath = folder.uri.fsPath;
    if (!(await this.gitService.isRepo(repoPath))) {
      throw new Error("Open folder is not a Git repository.");
    }

    return this.create({
      repoPath,
      name: path.basename(repoPath),
      environment: "development",
      currentGoal: `Set up ${path.basename(repoPath)}`,
    });
  }

  updateGitConfig(workspace: Workspace, git: WorkspaceGitConfig): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    const updated = { ...config, git };
    this.workspaceStore.save(workspace.repoPath, updated);
    return { ...workspace, ...updated, repoPath: workspace.repoPath, isActive: workspace.isActive };
  }

  recordFeaturePublish(
    workspace: Workspace,
    input: { sha: string; prUrl: string | null },
  ): Workspace {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config?.currentFeature) {
      return workspace;
    }

    const now = new Date().toISOString();
    const updated: WorkspaceConfig = {
      ...config,
      currentFeature: {
        ...config.currentFeature,
        prUrl: input.prUrl ?? config.currentFeature.prUrl ?? null,
        lastPushSha: input.sha,
        lastSyncedAt: now,
        status: "published",
      },
      git: {
        ...config.git,
        branch: config.currentFeature.branch,
      },
    };

    this.workspaceStore.save(workspace.repoPath, updated);
    return { ...workspace, ...updated, repoPath: workspace.repoPath, isActive: workspace.isActive };
  }

  findWorkSession(
    workspace: Workspace,
    branch: string,
  ): WorkSession | null {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      return null;
    }
    if (config.currentFeature?.branch === branch) {
      return null;
    }
    return config.workHistory?.find((session) => session.branch === branch) ?? null;
  }

  async resumeWork(
    workspace: Workspace,
    branch?: string,
  ): Promise<Workspace> {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config) {
      throw new Error("Workspace configuration missing.");
    }

    const targetBranch = branch ?? config.currentFeature?.branch;
    if (!targetBranch) {
      throw new Error("No work session to resume.");
    }

    let feature: Feature | null = config.currentFeature ?? null;
    if (!feature || feature.branch !== targetBranch) {
      const session = config.workHistory?.find((s) => s.branch === targetBranch);
      if (!session) {
        throw new Error(`No work session found for branch "${targetBranch}".`);
      }
      feature = {
        id: session.id,
        name: session.name,
        goal: session.goal,
        scope: session.scope,
        branch: session.branch,
        sourceBranch: session.sourceBranch,
        startedAt: session.startedAt,
        prUrl: session.prUrl,
        lastPushSha: session.lastPushSha,
        lastSyncedAt: session.lastSyncedAt,
        status: session.status === "published" ? "published" : "active",
      };
    }

    await this.gitService.ensureOnBranch(workspace.repoPath, feature.branch);

    const updated: WorkspaceConfig = {
      ...config,
      environment: "feature",
      currentGoal: feature.goal,
      currentFeature: { ...feature, status: feature.status ?? "active" },
      git: {
        ...config.git,
        branch: feature.branch,
      },
      ai: {
        lastActiveAt: new Date().toISOString(),
      },
    };

    this.workspaceStore.save(workspace.repoPath, updated);
    await this.themeService.apply("feature");

    return {
      ...workspace,
      ...updated,
      repoPath: workspace.repoPath,
      isActive: workspace.isActive,
    };
  }

  async archiveWork(
    workspace: Workspace,
    options?: { silent?: boolean },
  ): Promise<Workspace> {
    const config = this.workspaceStore.load(workspace.repoPath);
    if (!config?.currentFeature) {
      if (!options?.silent) {
        throw new Error("No active work session to archive.");
      }
      return workspace;
    }

    const now = new Date().toISOString();
    const session: WorkSession = {
      id: config.currentFeature.id,
      name: config.currentFeature.name,
      goal: config.currentFeature.goal,
      branch: config.currentFeature.branch,
      sourceBranch: config.currentFeature.sourceBranch,
      scope: config.currentFeature.scope,
      startedAt: config.currentFeature.startedAt,
      archivedAt: now,
      prUrl: config.currentFeature.prUrl ?? null,
      lastPushSha: config.currentFeature.lastPushSha ?? null,
      lastSyncedAt: config.currentFeature.lastSyncedAt ?? null,
      status:
        config.currentFeature.status === "published" ? "published" : "archived",
    };

    const history = [
      session,
      ...(config.workHistory ?? []).filter((item) => item.branch !== session.branch),
    ].slice(0, 20);

    const updated: WorkspaceConfig = {
      ...config,
      environment: "development",
      currentFeature: null,
      currentGoal: `Set up ${config.name}`,
      workHistory: history,
    };

    this.workspaceStore.save(workspace.repoPath, updated);
    await this.themeService.apply("development");

    if (!options?.silent) {
      void vscode.window.showInformationMessage(
        `Archived work "${session.name}" on ${session.branch}.`,
      );
    }

    return {
      ...workspace,
      ...updated,
      repoPath: workspace.repoPath,
      isActive: workspace.isActive,
    };
  }

  private async handleDirtyWorktree(
    repoPath: string,
    context: string,
  ): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `You have uncommitted changes ${context}.`,
      "Stash & Continue",
      "Commit WIP",
      "Cancel",
    );

    if (choice === "Stash & Continue") {
      await this.gitService.stashDirtyWorktree(
        repoPath,
        `Strata: WIP ${context}`,
      );
      return;
    }

    if (choice === "Commit WIP") {
      await this.gitService.commitDirtyWorktree(
        repoPath,
        `wip: strata ${context}`,
      );
      return;
    }

    throw new Error("Work cancelled.");
  }

  remove(workspaceId: string): void {
    const registry = this.registryStore.load();
    registry.workspaces = registry.workspaces.filter(
      (item) => item.id !== workspaceId,
    );
    if (registry.activeWorkspaceId === workspaceId) {
      registry.activeWorkspaceId = registry.workspaces[0]?.id ?? null;
    }
    this.registryStore.save(registry);
  }

  private hydrate(
    entry: WorkspaceRegistryEntry,
    activeWorkspaceId: string | null,
  ): Workspace | null {
    if (!fs.existsSync(entry.repoPath)) {
      return null;
    }

    const config = this.workspaceStore.load(entry.repoPath);
    if (!config) {
      return null;
    }

    return {
      ...config,
      repoPath: entry.repoPath,
      isActive: entry.id === activeWorkspaceId,
    };
  }

  private async applySwitchEffects(
    workspace: Workspace,
    skipOpenFolder = false,
  ): Promise<void> {
    await this.themeService.apply(workspace.environment);

    if (skipOpenFolder) {
      return;
    }

    const config = vscode.workspace.getConfiguration("strata");
    const openFolder = config.get<boolean>("openFolderOnSwitch", true);

    if (openFolder) {
      const uri = vscode.Uri.file(workspace.repoPath);
      const currentRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (currentRoot !== workspace.repoPath) {
        await vscode.commands.executeCommand("vscode.openFolder", uri, {
          forceNewWindow: false,
        });
      }
    }
  }
}
