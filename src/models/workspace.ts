import type { WorkspaceStack } from "./stack";

export type { StackFieldKey, WorkspaceStack } from "./stack";

export type WorkspaceEnvironment =
  | "production"
  | "feature"
  | "experiment"
  | "development";

export interface WorkspaceGitConfig {
  trunk: string;
  branch: string;
  remote: string;
  remoteUrl?: string | null;
  githubRepo?: string | null;
}

export interface WorkspaceAiConfig {
  lastActiveAt: string | null;
}

export interface WorkspaceRegistryEntry {
  id: string;
  name: string;
  repoPath: string;
  lastOpenedAt: string | null;
}

export interface WorkspaceRegistry {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceRegistryEntry[];
}

export interface Feature {
  id: string;
  name: string;
  goal: string;
  scope: string[];
  branch: string;
  sourceBranch?: string;
  startedAt: string;
  prUrl?: string | null;
  lastPushSha?: string | null;
  lastSyncedAt?: string | null;
  status?: "active" | "published";
}

export interface WorkSession {
  id: string;
  name: string;
  goal: string;
  branch: string;
  sourceBranch?: string;
  scope: string[];
  startedAt: string;
  archivedAt: string;
  prUrl?: string | null;
  lastPushSha?: string | null;
  lastSyncedAt?: string | null;
  status: "published" | "archived";
}

export interface ActiveRefresh {
  id: string;
  title: string;
  description: string;
  startedAt: string;
  phase: number;
}

export interface ActiveRetro {
  id: string;
  startedAt: string;
  relatedFeatureId?: string | null;
}

export interface ActivePreview {
  id: string;
  startedAt: string;
  focus: string;
  targets: Array<{
    root: string;
    label: string;
    kind: string;
    changedFiles: string[];
    reason: string;
  }>;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  environment: WorkspaceEnvironment;
  currentGoal: string;
  stack?: WorkspaceStack | null;
  currentFeature?: Feature | null;
  workHistory?: WorkSession[];
  activeRefresh?: ActiveRefresh | null;
  activeRetro?: ActiveRetro | null;
  activePreview?: ActivePreview | null;
  git: WorkspaceGitConfig;
  ai: WorkspaceAiConfig;
  createdAt: string;
}

export interface Workspace extends WorkspaceConfig {
  repoPath: string;
  isActive: boolean;
}

export interface GitHubStatusSnapshot {
  connected: boolean;
  remoteUrl: string | null;
  githubRepo: string | null;
  ghAvailable: boolean;
  ghAuthenticated: boolean;
  prUrl: string | null;
  prNumber: number | null;
  prState: string | null;
  checksState: "pending" | "success" | "failure" | "none";
  checksSummary: string;
}

export interface WorkspaceStatus {
  git: {
    branch: string;
    ahead: number;
    behind: number;
    isClean: boolean;
  };
  changes: {
    files: number;
    insertions: number;
    deletions: number;
  };
  ai: {
    lastActiveAt: string | null;
    lastActiveLabel: string;
  };
  github: GitHubStatusSnapshot;
  safety: {
    onTrunk: boolean;
    onProtectedBranch: boolean;
    hasActiveWork: boolean;
    trunkLocked: boolean;
    warning: string | null;
  };
}

export interface PublishPlan {
  workspaceId: string;
  repoPath: string;
  branch: string;
  remote: string;
  trunk: string;
  message: string;
}

export interface PublishResult {
  sha: string;
  compareUrl: string;
  branch: string;
  prUrl: string | null;
  prNumber: number | null;
  prCreated: boolean;
}

export const MEMORY_FILES = [
  "summary.md",
  "todo.md",
  "architecture.md",
  "decisions.md",
] as const;

export type MemoryFileName = (typeof MEMORY_FILES)[number];

export const ENVIRONMENT_LABELS: Record<WorkspaceEnvironment, string> = {
  production: "Production",
  feature: "Feature",
  experiment: "Experiment",
  development: "Development",
};

export const ENVIRONMENT_ICONS: Record<WorkspaceEnvironment, string> = {
  production: "🔴",
  feature: "🔵",
  experiment: "🟣",
  development: "🟢",
};

export function defaultWorkBranchName(workName: string, sourceBranch: string): string {
  const work = slugify(workName) || "work";
  const source = slugify(sourceBranch.replace(/\//g, "-")) || "base";
  const date = new Date().toISOString().slice(0, 10);
  return `work/${date}-${work}-from-${source}`.slice(0, 60);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "Never";
  }

  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
