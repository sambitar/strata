import simpleGit, { SimpleGit } from "simple-git";
import type { PublishPlan, PublishResult } from "../models/workspace";

export interface GitStatusSnapshot {
  branch: string;
  ahead: number;
  behind: number;
  isClean: boolean;
}

export interface GitChangeSummary {
  files: number;
  insertions: number;
  deletions: number;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remote: string | null;
  isProtected: boolean;
}

export class GitService {
  private git(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }

  async isRepo(repoPath: string): Promise<boolean> {
    try {
      return await this.git(repoPath).checkIsRepo();
    } catch {
      return false;
    }
  }

  async resolveTrunk(repoPath: string, remote = "origin"): Promise<string> {
    const git = this.git(repoPath);
    const branches = await git.branch(["-a"]);

    const candidates = [
      `${remote}/main`,
      `${remote}/master`,
      "main",
      "master",
    ];

    for (const candidate of candidates) {
      if (branches.all.includes(candidate)) {
        return candidate.replace(`${remote}/`, "");
      }
    }

    return branches.current || "main";
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const git = this.git(repoPath);
    const status = await git.status();
    return status.current || "main";
  }

  async fetchAll(repoPath: string): Promise<void> {
    const git = this.git(repoPath);
    await git.fetch(["--all", "--prune", "--quiet"]);
  }

  async listBranches(
    repoPath: string,
    remote = "origin",
    trunk?: string,
  ): Promise<GitBranchInfo[]> {
    const git = this.git(repoPath);
    await git.fetch(["--all", "--prune", "--quiet"]);
    const branches = await git.branch(["-a"]);
    const current = branches.current;
    const protectedName = trunk ?? (await this.resolveTrunk(repoPath, remote));
    const local: GitBranchInfo[] = [];
    const remoteOnly: GitBranchInfo[] = [];
    const localNames = new Set<string>();

    for (const name of branches.all) {
      if (name.startsWith("remotes/")) {
        continue;
      }
      localNames.add(name);
      local.push({
        name,
        isCurrent: name === current,
        isRemote: false,
        remote: null,
        isProtected: name === protectedName,
      });
    }

    for (const name of branches.all) {
      const prefix = `remotes/${remote}/`;
      if (!name.startsWith(prefix)) {
        continue;
      }
      const shortName = name.slice(prefix.length);
      if (shortName === "HEAD" || localNames.has(shortName)) {
        continue;
      }
      remoteOnly.push({
        name: shortName,
        isCurrent: false,
        isRemote: true,
        remote,
        isProtected: shortName === protectedName,
      });
    }

    local.sort((a, b) => {
      if (a.isCurrent) {
        return -1;
      }
      if (b.isCurrent) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    remoteOnly.sort((a, b) => a.name.localeCompare(b.name));

    return [...local, ...remoteOnly];
  }

  async createWorkBranch(
    repoPath: string,
    newBranchName: string,
    sourceBranch: string,
    options?: { isRemote?: boolean; remote?: string },
  ): Promise<string> {
    const git = this.git(repoPath);
    const remote = options?.remote ?? "origin";
    const local = await git.branchLocal();

    if (local.all.includes(newBranchName)) {
      throw new Error(
        `Branch "${newBranchName}" already exists. Pick a new name — Strata never overwrites existing branches.`,
      );
    }

    if (newBranchName === sourceBranch) {
      throw new Error(
        "Work branch must be a new branch. Strata never commits directly to an existing branch.",
      );
    }

    let sourceRef = sourceBranch;
    if (options?.isRemote) {
      sourceRef = `${remote}/${sourceBranch}`;
    } else {
      const all = await git.branch(["-a"]);
      if (!local.all.includes(sourceBranch)) {
        const remoteRef = `remotes/${remote}/${sourceBranch}`;
        if (all.all.includes(remoteRef)) {
          sourceRef = `${remote}/${sourceBranch}`;
        }
      }
    }

    await git.checkout(["-b", newBranchName, sourceRef]);
    return newBranchName;
  }

  async createFeatureBranch(
    repoPath: string,
    branchName: string,
    trunk: string,
  ): Promise<void> {
    await this.createWorkBranch(repoPath, branchName, trunk);
  }

  isProtectedBranch(branchName: string, trunk: string): boolean {
    return branchName === trunk || branchName === "main" || branchName === "master";
  }

  /** @deprecated Strata never checks out existing branches for editing. Use createWorkBranch. */
  async checkoutBranch(
    repoPath: string,
    branchName: string,
    options?: { isRemote?: boolean; remote?: string },
  ): Promise<string> {
    const git = this.git(repoPath);
    const remote = options?.remote ?? "origin";

    if (options?.isRemote) {
      await git.checkout(["-b", branchName, `${remote}/${branchName}`]);
    } else {
      await git.checkout(branchName);
    }

    return this.getCurrentBranch(repoPath);
  }

  async getStatus(repoPath: string, trunk = "main"): Promise<GitStatusSnapshot> {
    const git = this.git(repoPath);
    const status = await git.status();

    let ahead = 0;
    let behind = 0;

    try {
      await git.fetch(["--quiet"]);
      const rev = await git.raw([
        "rev-list",
        "--left-right",
        "--count",
        `${trunk}...HEAD`,
      ]);
      const parts = rev.trim().split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // Trunk comparison may fail on fresh repos
    }

    return {
      branch: status.current || trunk,
      ahead,
      behind,
      isClean: status.isClean(),
    };
  }

  async getRecentChanges(repoPath: string): Promise<GitChangeSummary> {
    const git = this.git(repoPath);
    const diffSummary = await git.diffSummary(["HEAD"]);

    return {
      files: diffSummary.files.length,
      insertions: diffSummary.insertions,
      deletions: diffSummary.deletions,
    };
  }

  async getChangedPathsSince(repoPath: string, trunk: string): Promise<string[]> {
    const git = this.git(repoPath);
    try {
      const output = await git.raw(["diff", "--name-only", `${trunk}...HEAD`]);
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async getDirtyPaths(repoPath: string): Promise<string[]> {
    const git = this.git(repoPath);
    const status = await git.status();
    return [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map((entry) => entry.to ?? entry.from),
      ...status.not_added,
    ].filter(Boolean);
  }

  async getRemoteUrl(repoPath: string, remote = "origin"): Promise<string | null> {
    try {
      const git = this.git(repoPath);
      const remotes = await git.getRemotes(true);
      const match = remotes.find((entry) => entry.name === remote);
      return match?.refs.fetch ?? match?.refs.push ?? null;
    } catch {
      return null;
    }
  }

  async branchExistsOnRemote(
    repoPath: string,
    branch: string,
    remote = "origin",
  ): Promise<boolean> {
    const git = this.git(repoPath);
    try {
      const result = await git.raw([
        "ls-remote",
        "--heads",
        remote,
        branch,
      ]);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  async ensureOnBranch(repoPath: string, branchName: string): Promise<string> {
    const git = this.git(repoPath);
    const local = await git.branchLocal();
    if (!local.all.includes(branchName)) {
      throw new Error(
        `Work branch "${branchName}" not found locally. Start new work from a source branch.`,
      );
    }
    if (local.current !== branchName) {
      await git.checkout(branchName);
    }
    return branchName;
  }

  async stashDirtyWorktree(repoPath: string, message: string): Promise<void> {
    const git = this.git(repoPath);
    const status = await git.status();
    if (!status.isClean()) {
      await git.stash(["push", "-u", "-m", message]);
    }
  }

  async commitDirtyWorktree(repoPath: string, message: string): Promise<void> {
    const git = this.git(repoPath);
    const status = await git.status();
    if (!status.isClean()) {
      await git.add(".");
      await git.commit(message);
    }
  }

  buildCompareUrl(
    remoteUrl: string | null,
    trunk: string,
    branch: string,
  ): string {
    if (!remoteUrl) {
      return "";
    }

    const https = remoteUrl
      .replace(/^git@github.com:/, "https://github.com/")
      .replace(/\.git$/, "");

    if (https.includes("github.com")) {
      return `${https}/compare/${trunk}...${branch}?expand=1`;
    }

    return https;
  }

  async publish(
    repoPath: string,
    plan: PublishPlan,
  ): Promise<PublishResult> {
    const git = this.git(repoPath);

    if (!(await git.checkIsRepo())) {
      throw new Error("Not a git repository");
    }

    if (this.isProtectedBranch(plan.branch, plan.trunk)) {
      throw new Error(
        `Cannot publish to protected branch "${plan.branch}". Start work from a branch first — Strata only pushes to your new work branch.`,
      );
    }

    const current = await this.getCurrentBranch(repoPath);
    if (current !== plan.branch) {
      const local = await git.branchLocal();
      if (!local.all.includes(plan.branch)) {
        throw new Error(
          `Work branch "${plan.branch}" is not checked out. Resume your feature or start new work.`,
        );
      }
      await git.checkout(plan.branch);
    }

    const status = await git.status();

    if (!status.isClean()) {
      await git.add(".");
      await git.commit(plan.message);
    }

    await git.push(plan.remote, plan.branch, ["--set-upstream"]);

    const log = await git.log({ maxCount: 1 });
    const sha = log.latest?.hash ?? "";
    const remoteUrl = await this.getRemoteUrl(repoPath, plan.remote);
    const compareUrl = this.buildCompareUrl(remoteUrl, plan.trunk, plan.branch);

    return {
      sha,
      compareUrl,
      branch: plan.branch,
      prUrl: null,
      prNumber: null,
      prCreated: false,
    };
  }
}
