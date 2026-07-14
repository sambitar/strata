import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function getStrataHome(): string {
  return path.join(os.homedir(), ".strata");
}

export function getRegistryPath(): string {
  return path.join(getStrataHome(), "workspaces.json");
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFileAtomic<T>(filePath: string, data: T): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

export function getWorkspaceConfigPath(repoPath: string): string {
  return path.join(repoPath, ".strata", "workspace.json");
}

export function getMemoryDir(repoPath: string): string {
  return path.join(repoPath, ".strata", "memory");
}

export function getGlobalRulesDir(): string {
  return path.join(getStrataHome(), "rules");
}

export function getRepoCursorRulesDir(repoPath: string): string {
  return path.join(repoPath, ".cursor", "rules");
}

export function getRefreshDir(repoPath: string): string {
  return path.join(repoPath, ".strata", "refresh");
}

export function getRetroDir(repoPath: string): string {
  return path.join(repoPath, ".strata", "retro");
}

export function getRequestsDir(repoPath: string): string {
  return path.join(repoPath, ".strata", "requests");
}

export function getPreviewDir(repoPath: string): string {
  return path.join(repoPath, ".strata", "preview");
}

export function getCrewDir(repoPath: string): string {
  return path.join(repoPath, ".strata", "crew");
}
