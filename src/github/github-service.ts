import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitHubAvailability {
  available: boolean;
  authenticated: boolean;
  username: string | null;
  error: string | null;
}

export interface GitHubPrInfo {
  url: string;
  number: number;
  state: string;
  checksState: "pending" | "success" | "failure" | "none";
  checksSummary: string;
}

export interface CreatePrInput {
  title: string;
  body: string;
  base: string;
  head: string;
}

export class GitHubService {
  async checkAvailability(): Promise<GitHubAvailability> {
    try {
      await execFileAsync("gh", ["--version"], { maxBuffer: 1024 * 1024 });
    } catch {
      return {
        available: false,
        authenticated: false,
        username: null,
        error: "GitHub CLI (gh) is not installed.",
      };
    }

    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["auth", "status", "--hostname", "github.com"],
        { maxBuffer: 1024 * 1024 },
      );
      const usernameMatch = stdout.match(/Logged in to github\.com account (\S+)/);
      return {
        available: true,
        authenticated: true,
        username: usernameMatch?.[1] ?? null,
        error: null,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Not authenticated with GitHub.";
      return {
        available: true,
        authenticated: false,
        username: null,
        error: message,
      };
    }
  }

  parseGitHubRepo(remoteUrl: string): string | null {
    const normalized = remoteUrl.trim();
    const patterns = [
      /^git@github\.com:(.+?)(?:\.git)?$/,
      /^https:\/\/github\.com\/(.+?)(?:\.git)?(?:\/.*)?$/,
      /^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?$/,
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        return match[1].replace(/\.git$/, "");
      }
    }

    return null;
  }

  toHttpsRepoUrl(githubRepo: string): string {
    return `https://github.com/${githubRepo}`;
  }

  async getPrForBranch(
    repoPath: string,
    branch: string,
  ): Promise<GitHubPrInfo | null> {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "pr",
          "list",
          "--head",
          branch,
          "--json",
          "url,number,state,statusCheckRollup",
          "--limit",
          "1",
        ],
        { cwd: repoPath, maxBuffer: 1024 * 1024 },
      );

      const items = JSON.parse(stdout || "[]") as Array<{
        url: string;
        number: number;
        state: string;
        statusCheckRollup?: Array<{ state?: string; name?: string }>;
      }>;

      const pr = items[0];
      if (!pr) {
        return null;
      }

      return this.mapPrInfo(pr);
    } catch {
      return null;
    }
  }

  async createPr(
    repoPath: string,
    input: CreatePrInput,
  ): Promise<GitHubPrInfo | null> {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "pr",
          "create",
          "--title",
          input.title,
          "--body",
          input.body,
          "--base",
          input.base,
          "--head",
          input.head,
        ],
        { cwd: repoPath, maxBuffer: 1024 * 1024 },
      );

      const url = stdout.trim();
      if (!url.startsWith("https://")) {
        return null;
      }

      const numberMatch = url.match(/\/pull\/(\d+)/);
      return {
        url,
        number: numberMatch ? parseInt(numberMatch[1], 10) : 0,
        state: "OPEN",
        checksState: "none",
        checksSummary: "No checks yet",
      };
    } catch {
      return null;
    }
  }

  async createRepo(
    repoPath: string,
    name: string,
    isPrivate: boolean,
    push = true,
  ): Promise<{ remoteUrl: string; githubRepo: string }> {
    const args = [
      "repo",
      "create",
      name,
      isPrivate ? "--private" : "--public",
      "--source",
      repoPath,
      "--remote",
      "origin",
    ];

    if (push) {
      args.push("--push");
    }

    const { stdout } = await execFileAsync("gh", args, {
      cwd: repoPath,
      maxBuffer: 1024 * 1024,
    });

    const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
    const remoteUrl = urlMatch?.[0]?.replace(/\.git$/, "") ?? "";
    const githubRepo = this.parseGitHubRepo(remoteUrl) ?? name;

    return { remoteUrl, githubRepo };
  }

  private mapPrInfo(pr: {
    url: string;
    number: number;
    state: string;
    statusCheckRollup?: Array<{ state?: string; name?: string }>;
  }): GitHubPrInfo {
    const rollup = pr.statusCheckRollup ?? [];
    let checksState: GitHubPrInfo["checksState"] = "none";
    let checksSummary = "No checks";

    if (rollup.length > 0) {
      const states = rollup.map((check) => check.state ?? "PENDING");
      if (states.every((state) => state === "SUCCESS" || state === "SKIPPED")) {
        checksState = "success";
        checksSummary = "Checks passed";
      } else if (states.some((state) => state === "FAILURE" || state === "ERROR")) {
        checksState = "failure";
        checksSummary = "Checks failed";
      } else {
        checksState = "pending";
        checksSummary = "Checks running";
      }
    }

    return {
      url: pr.url,
      number: pr.number,
      state: pr.state,
      checksState,
      checksSummary,
    };
  }
}
