import type { GitHubStatusSnapshot, Workspace, WorkspaceStatus } from "../models/workspace";
import { formatRelativeTime } from "../models/workspace";
import { GitService } from "../git/git-service";
import { GitHubService } from "../github/github-service";

export class StatusService {
  constructor(
    private readonly gitService: GitService,
    private readonly githubService: GitHubService,
  ) {}

  async getStatus(workspace: Workspace): Promise<WorkspaceStatus> {
    const git = await this.gitService.getStatus(
      workspace.repoPath,
      workspace.git.trunk,
    );
    const changes = await this.gitService.getRecentChanges(workspace.repoPath);
    const github = await this.getGitHubStatus(workspace);
    const safety = this.getSafetyStatus(workspace, git.branch);

    return {
      git,
      changes,
      ai: {
        lastActiveAt: workspace.ai.lastActiveAt,
        lastActiveLabel: formatRelativeTime(workspace.ai.lastActiveAt),
      },
      github,
      safety,
    };
  }

  private getSafetyStatus(
    workspace: Workspace,
    currentBranch: string,
  ): WorkspaceStatus["safety"] {
    const onTrunk = currentBranch === workspace.git.trunk;
    const onProtectedBranch = this.gitService.isProtectedBranch(
      currentBranch,
      workspace.git.trunk,
    );
    const hasActiveWork = Boolean(workspace.currentFeature);
    const onWorkBranch =
      hasActiveWork &&
      workspace.currentFeature?.branch === currentBranch;

    const trunkLocked = onProtectedBranch && !onWorkBranch;
    let warning: string | null = null;

    if (trunkLocked) {
      warning = `On protected branch "${currentBranch}". Start or resume work on a new branch — Strata will not publish here.`;
    } else if (hasActiveWork && !onWorkBranch) {
      warning = `Git is on "${currentBranch}" but active work is on "${workspace.currentFeature?.branch}". Resume work to switch back.`;
    }

    return {
      onTrunk,
      onProtectedBranch,
      hasActiveWork,
      trunkLocked,
      warning,
    };
  }

  private async getGitHubStatus(workspace: Workspace): Promise<GitHubStatusSnapshot> {
    const remoteUrl =
      workspace.git.remoteUrl ??
      (await this.gitService.getRemoteUrl(workspace.repoPath, workspace.git.remote));
    const githubRepo =
      workspace.git.githubRepo ??
      (remoteUrl ? this.githubService.parseGitHubRepo(remoteUrl) : null);

    const gh = await this.githubService.checkAvailability();
    const connected = Boolean(remoteUrl && githubRepo);

    let prUrl = workspace.currentFeature?.prUrl ?? null;
    let prNumber: number | null = null;
    let prState: string | null = null;
    let checksState: GitHubStatusSnapshot["checksState"] = "none";
    let checksSummary = "No PR";

    if (connected && gh.available && gh.authenticated) {
      const branch =
        workspace.currentFeature?.branch ??
        workspace.git.branch ??
        (await this.gitService.getCurrentBranch(workspace.repoPath));

      const pr = await this.githubService.getPrForBranch(workspace.repoPath, branch);
      if (pr) {
        prUrl = pr.url;
        prNumber = pr.number;
        prState = pr.state;
        checksState = pr.checksState;
        checksSummary = pr.checksSummary;
      }
    }

    return {
      connected,
      remoteUrl,
      githubRepo,
      ghAvailable: gh.available,
      ghAuthenticated: gh.authenticated,
      prUrl,
      prNumber,
      prState,
      checksState,
      checksSummary,
    };
  }
}
