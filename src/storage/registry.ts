import type { WorkspaceRegistry } from "../models/workspace";
import {
  getRegistryPath,
  readJsonFile,
  writeJsonFileAtomic,
} from "./paths";

const EMPTY_REGISTRY: WorkspaceRegistry = {
  activeWorkspaceId: null,
  workspaces: [],
};

export class RegistryStore {
  load(): WorkspaceRegistry {
    return readJsonFile<WorkspaceRegistry>(getRegistryPath(), EMPTY_REGISTRY);
  }

  save(registry: WorkspaceRegistry): void {
    writeJsonFileAtomic(getRegistryPath(), registry);
  }
}
