import type { WorkspaceConfig } from "../models/workspace";
import {
  getWorkspaceConfigPath,
  readJsonFile,
  writeJsonFileAtomic,
} from "./paths";

export class WorkspaceStore {
  load(repoPath: string): WorkspaceConfig | null {
    const configPath = getWorkspaceConfigPath(repoPath);
    return readJsonFile<WorkspaceConfig | null>(configPath, null);
  }

  save(repoPath: string, config: WorkspaceConfig): void {
    writeJsonFileAtomic(getWorkspaceConfigPath(repoPath), config);
  }
}
