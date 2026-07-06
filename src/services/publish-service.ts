import * as fs from "fs";
import type { PublishPlan, PublishResult, Workspace } from "../models/workspace";
import { slugify } from "../models/workspace";
import { GitService } from "../git/git-service";
import { GitHubService } from "../github/github-service";
import { MemoryService } from "./memory-service";

export class PublishService {
  constructor(
    private readonly gitService: GitService,
    private readonly githubService: GitHubService,
    private readonly memoryService: MemoryService,
  ) {}

  async prepare(workspace: Workspace, message?: string): Promise<PublishPlan> {
    const branch =
      workspace.currentFeature?.branch ||
      workspace.git.branch ||
      `work/${slugify(workspace.name) || workspace.id}`;

    if (this.gitService.isProtectedBranch(branch, workspace.git.trunk)) {
      throw new Error(
        `Cannot publish from protected branch "${branch}". Click a branch in the sidebar to start work on a new branch first.`,
      );
    }

    if (!workspace.currentFeature) {
      throw new Error(
        "No active work session. Click a branch in the sidebar to fork new work before publishing.",
      );
    }

    return {
      workspaceId: workspace.id,
      repoPath: workspace.repoPath,
      branch,
      remote: workspace.git.remote,
      trunk: workspace.git.trunk,
      message:
        message ||
        `feat(${slugify(workspace.currentFeature?.name ?? workspace.name)}): ${workspace.currentFeature?.goal ?? workspace.currentGoal ?? "publish workspace changes"}`,
    };
  }

  async validate(plan: PublishPlan, workspace: Workspace): Promise<{
    isClean: boolean;
    changes: Awaited<ReturnType<GitService["getRecentChanges"]>>;
    remoteBranchExists: boolean;
    safeToPush: boolean;
    safetyMessage: string | null;
  }> {
    const status = await this.gitService.getStatus(plan.repoPath, plan.trunk);
    const changes = await this.gitService.getRecentChanges(plan.repoPath);
    const remoteBranchExists = await this.gitService.branchExistsOnRemote(
      plan.repoPath,
      plan.branch,
      plan.remote,
    );

    let safeToPush = true;
    let safetyMessage: string | null = null;

    if (this.gitService.isProtectedBranch(plan.branch, plan.trunk)) {
      safeToPush = false;
      safetyMessage = `Cannot push to protected branch "${plan.branch}".`;
    }

    if (
      remoteBranchExists &&
      !workspace.currentFeature?.lastPushSha
    ) {
      safeToPush = false;
      safetyMessage = `Branch "${plan.branch}" already exists on GitHub. Start new work with a different branch name to avoid overwriting remote code.`;
    }

    return {
      isClean: status.isClean,
      changes,
      remoteBranchExists,
      safeToPush,
      safetyMessage,
    };
  }

  async execute(
    plan: PublishPlan,
    workspace: Workspace,
    options?: { autoCreatePr?: boolean },
  ): Promise<PublishResult> {
    const validation = await this.validate(plan, workspace);
    if (!validation.safeToPush) {
      throw new Error(validation.safetyMessage ?? "Publish blocked for safety.");
    }

    const result = await this.gitService.publish(plan.repoPath, plan);
    const autoCreatePr = options?.autoCreatePr ?? true;

    let prUrl: string | null = null;
    let prNumber: number | null = null;
    let prCreated = false;

    const gh = await this.githubService.checkAvailability();
    if (autoCreatePr && gh.available && gh.authenticated) {
      const existing = await this.githubService.getPrForBranch(
        plan.repoPath,
        plan.branch,
      );

      if (existing) {
        prUrl = existing.url;
        prNumber = existing.number;
      } else {
        const title = workspace.currentFeature?.name
          ? `feat: ${workspace.currentFeature.name}`
          : plan.message.split("\n")[0] ?? plan.message;
        const body = this.buildPrBody(workspace);

        const created = await this.githubService.createPr(plan.repoPath, {
          title,
          body,
          base: plan.trunk,
          head: plan.branch,
        });

        if (created) {
          prUrl = created.url;
          prNumber = created.number;
          prCreated = true;
        }
      }
    }

    if (!prUrl && result.compareUrl) {
      prUrl = result.compareUrl;
    }

    return {
      ...result,
      prUrl,
      prNumber,
      prCreated,
    };
  }

  private buildPrBody(workspace: Workspace): string {
    const parts: string[] = [];

    if (workspace.currentFeature) {
      parts.push(`## Goal`);
      parts.push(workspace.currentFeature.goal);
      parts.push("");

      if (workspace.currentFeature.scope.length > 0) {
        parts.push(`## Scope`);
        parts.push(workspace.currentFeature.scope.map((glob) => `- \`${glob}\``).join("\n"));
        parts.push("");
      }
    } else if (workspace.currentGoal) {
      parts.push(`## Goal`);
      parts.push(workspace.currentGoal);
      parts.push("");
    }

    const summaryPath = this.memoryService.getPath(workspace.repoPath, "summary.md");
    if (fs.existsSync(summaryPath)) {
      const summary = fs.readFileSync(summaryPath, "utf8").trim();
      if (summary) {
        parts.push(`## Summary`);
        parts.push(summary);
        parts.push("");
      }
    }

    parts.push("---");
    parts.push("*Published via Strata*");

    return parts.join("\n");
  }
}
