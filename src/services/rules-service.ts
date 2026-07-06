import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ActivePreview, ActiveRefresh, ActiveRetro, WorkspaceConfig } from "../models/workspace";
import {
  ensureDir,
  getGlobalRulesDir,
  getPreviewDir,
  getRefreshDir,
  getRepoCursorRulesDir,
  getRetroDir,
  getStrataHome,
} from "../storage/paths";

export type RulesInstallMode = "copy" | "symlink" | "off";

const BRIDGE_REFRESH = "strata-active-refresh.mdc";
const BRIDGE_RETRO = "strata-active-retro.mdc";
const BRIDGE_PREVIEW = "strata-active-preview.mdc";

const SYNC_RULE_FILES = [
  { dir: "core", pattern: /\.mdc$/ },
  { file: "refresh/rca-protocol.mdc" },
  { file: "retro/retro-protocol.mdc" },
  { file: "requests/feature-spec-protocol.mdc" },
  { file: "preview/preview-protocol.mdc" },
];

export class RulesService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getBundledRulesDir(): string {
    return path.join(this.context.extensionPath, "rules", "bundled");
  }

  getInstallMode(): RulesInstallMode {
    return vscode.workspace
      .getConfiguration("strata")
      .get<RulesInstallMode>("rulesInstallMode", "copy");
  }

  ensureGlobalRules(): void {
    const bundled = this.getBundledRulesDir();
    const global = getGlobalRulesDir();

    if (!fs.existsSync(bundled)) {
      throw new Error(`Bundled rules not found at ${bundled}`);
    }

    ensureDir(global);
    this.mergeCopyDir(bundled, global);
  }

  async syncToRepo(
    repoPath: string,
    config?: WorkspaceConfig | null,
  ): Promise<{ synced: number }> {
    const mode = this.getInstallMode();
    if (mode === "off") {
      return { synced: 0 };
    }

    this.ensureGlobalRules();
    const global = getGlobalRulesDir();
    const dest = getRepoCursorRulesDir(repoPath);
    ensureDir(dest);

    let synced = 0;
    for (const entry of SYNC_RULE_FILES) {
      if ("file" in entry && entry.file) {
        const source = path.join(global, entry.file);
        if (fs.existsSync(source)) {
          this.installRuleFile(source, path.join(dest, path.basename(entry.file)), mode);
          synced += 1;
        }
        continue;
      }

      const coreDir = path.join(global, entry.dir);
      if (!fs.existsSync(coreDir)) {
        continue;
      }

      for (const name of fs.readdirSync(coreDir)) {
        if (!entry.pattern.test(name)) {
          continue;
        }
        this.installRuleFile(
          path.join(coreDir, name),
          path.join(dest, name),
          mode,
        );
        synced += 1;
      }
    }

    this.writeBridgeRules(dest, config ?? null);
    this.ensureAgentsMd(repoPath);
    return { synced };
  }

  writeBridgeRules(dest: string, config: WorkspaceConfig | null): void {
    const refreshPath = path.join(dest, BRIDGE_REFRESH);
    const retroPath = path.join(dest, BRIDGE_RETRO);
    const previewPath = path.join(dest, BRIDGE_PREVIEW);

    if (config?.activeRefresh) {
      fs.writeFileSync(
        refreshPath,
        this.buildRefreshBridge(config.activeRefresh),
        "utf8",
      );
    } else if (fs.existsSync(refreshPath)) {
      fs.unlinkSync(refreshPath);
    }

    if (config?.activeRetro) {
      fs.writeFileSync(
        retroPath,
        this.buildRetroBridge(config.activeRetro),
        "utf8",
      );
    } else if (fs.existsSync(retroPath)) {
      fs.unlinkSync(retroPath);
    }

    if (config?.activePreview) {
      fs.writeFileSync(
        previewPath,
        this.buildPreviewBridge(config.activePreview),
        "utf8",
      );
    } else if (fs.existsSync(previewPath)) {
      fs.unlinkSync(previewPath);
    }
  }

  renderTemplate(
    templatePath: string,
    vars: Record<string, string>,
  ): string {
    let content = fs.readFileSync(templatePath, "utf8");
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{${key}}`, value);
    }
    return content;
  }

  getTemplatePath(relativePath: string): string {
    return path.join(getGlobalRulesDir(), relativePath);
  }

  private buildRefreshBridge(refresh: ActiveRefresh): string {
    return `---
description: Active Strata Refresh — follow RCA protocol now
alwaysApply: true
---

# Active Refresh Mission

**Title:** ${refresh.title}
**Started:** ${refresh.startedAt}
**Current phase:** ${refresh.phase}

Read \`.strata/refresh/current.md\` for the full mission brief and phase ledger.

Follow \`rca-protocol.mdc\` (RCA Refresh protocol). Complete Phase 0 through Phase 6 before archiving this refresh.

Do not apply speculative fixes before reproduction and root cause analysis.
`;
  }

  private buildRetroBridge(retro: ActiveRetro): string {
    return `---
description: Active Strata Retro — evolve doctrine, not product code
alwaysApply: true
---

# Active Retro Session

**Started:** ${retro.startedAt}

Read \`.strata/retro/current.md\` for session scope.

Follow \`retro-protocol.mdc\` (Retro protocol). Update rules and memory — do not change product code unless fixing a rule file itself.

Complete Phase 0 through Phase 3 before archiving this retro.
`;
  }

  private buildPreviewBridge(preview: ActivePreview): string {
    const targets =
      preview.targets.length > 0
        ? preview.targets
            .map(
              (t) =>
                `- **${t.label}** (\`${t.root}/\`) — ${t.kind} — ${t.changedFiles.length} touched file(s)`,
            )
            .join("\n")
        : "- _No locked targets — discover from repo_";

    return `---
description: Active Strata Preview — agent decides dev-mode testing
alwaysApply: true
---

# Active Preview / Test Mission

**Started:** ${preview.startedAt}
**Focus:** ${preview.focus}

## Locked preview targets (ONLY these)

${targets}

Read \`.strata/preview/current.md\` for touched files, scope, and rules.

Follow \`preview-protocol.mdc\`. Do **not** start dev servers for apps outside the target list.

After success, save recipes to \`.strata/preview/recipe.md\` per target root.
`;
  }

  private ensureAgentsMd(repoPath: string): void {
    const agentsPath = path.join(repoPath, "AGENTS.md");
    if (fs.existsSync(agentsPath)) {
      return;
    }

    const content = `# AGENTS.md

Project context for AI agents. Managed by Strata.

## Before significant work

- \`.strata/workspace.json\` — workspace config, goals, active missions
- \`.strata/memory/\` — summary, todo, architecture, decisions
- \`.cursor/rules/\` — Strata-synced Cursor rules

## Branch safety

Never edit protected trunk branches directly. Strata forks new work branches.
`;

    fs.writeFileSync(agentsPath, content, "utf8");
  }

  private installRuleFile(
    source: string,
    dest: string,
    mode: RulesInstallMode,
  ): void {
    if (mode === "copy") {
      fs.copyFileSync(source, dest);
      return;
    }

    if (fs.existsSync(dest)) {
      const stat = fs.lstatSync(dest);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(dest);
      } else {
        fs.unlinkSync(dest);
      }
    }

    fs.symlinkSync(source, dest);
  }

  private mergeCopyDir(source: string, dest: string): void {
    ensureDir(dest);
    for (const name of fs.readdirSync(source)) {
      const srcPath = path.join(source, name);
      const destPath = path.join(dest, name);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        this.mergeCopyDir(srcPath, destPath);
        continue;
      }

      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        continue;
      }

      const destStat = fs.statSync(destPath);
      if (destStat.isFile() && destStat.mtimeMs < stat.mtimeMs) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

export function newMissionId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function ensureStrataHome(): void {
  ensureDir(getStrataHome());
}
