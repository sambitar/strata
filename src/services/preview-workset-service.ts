import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type {
  PreviewSurfaceCandidate,
  PreviewSurfaceKind,
  PreviewTarget,
  PreviewWorkset,
} from "../models/preview-workset";
import type { Workspace } from "../models/workspace";
import { GitService } from "../git/git-service";

const APP_ROOT_NAMES: Record<string, PreviewSurfaceKind> = {
  web: "web",
  frontend: "web",
  client: "web",
  ui: "web",
  app: "web",
  mobile: "mobile",
  ios: "mobile",
  android: "mobile",
  backend: "backend",
  server: "backend",
  api: "backend",
};

const MANIFEST_NAMES = new Set([
  "package.json",
  "composer.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
]);

export class PreviewWorksetService {
  constructor(private readonly gitService = new GitService()) {}

  async resolve(workspace: Workspace): Promise<PreviewWorkset> {
    const repoPath = workspace.repoPath;
    const trunk = workspace.git.trunk;

    const [branchChanges, dirtyChanges] = await Promise.all([
      this.gitService.getChangedPathsSince(repoPath, trunk),
      this.gitService.getDirtyPaths(repoPath),
    ]);

    const changedFiles = [
      ...new Set([...branchChanges, ...dirtyChanges].map(normalizePath)),
    ].filter(Boolean);

    const openFiles = this.getOpenRepoFiles(repoPath);
    const featureScope = workspace.currentFeature?.scope ?? [];

    const allTouched = [
      ...new Set([...changedFiles, ...openFiles].map(normalizePath)),
    ];

    const surfaces = this.groupIntoSurfaces(repoPath, allTouched, {
      changedFiles,
      openFiles,
      featureScope,
    });

    const suggestedTargets = this.buildSuggestedTargets(surfaces);

    return {
      changedFiles,
      openFiles,
      featureScope,
      surfaces,
      suggestedTargets,
    };
  }

  async pickTargets(workset: PreviewWorkset): Promise<PreviewTarget[] | null> {
    const { surfaces, suggestedTargets } = workset;

    if (surfaces.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        "No changed files mapped to an app folder yet. The agent will discover what to preview from the repo.",
        "Continue",
        "Cancel",
      );
      return choice === "Continue" ? [] : null;
    }

    if (surfaces.length === 1) {
      const only = surfaces[0];
      const target = this.candidateToTarget(only, "Only app with activity in this work session");
      const confirm = await vscode.window.showInformationMessage(
        `Testing ${only.label} (${only.changedFiles.length} touched file(s) under ${only.root}/).`,
        "Continue",
        "Cancel",
      );
      return confirm === "Continue" ? [target] : null;
    }

    const suggestedRoots = new Set(suggestedTargets.map((t) => t.root));
    const suggestedLabels = suggestedTargets.map((t) => t.label).join(" + ");

    type PickItem = vscode.QuickPickItem & { targets: PreviewTarget[] };

    const options: PickItem[] = [];

    if (suggestedTargets.length > 0) {
      options.push({
        label: `$(sparkle) Recommended: ${suggestedLabels}`,
        description: "Preview everything you actually touched",
        detail: suggestedTargets
          .map((t) => `${t.label}: ${t.changedFiles.length} file(s)`)
          .join(" · "),
        targets: suggestedTargets,
      });
    }

    for (const surface of surfaces) {
      if (suggestedRoots.has(surface.root) && suggestedTargets.length > 1) {
        continue;
      }
      if (suggestedTargets.length === 1 && surface.root === suggestedTargets[0]?.root) {
        continue;
      }

      options.push({
        label: `$(folder) ${surface.label} only`,
        description: `\`${surface.root}/\` · ${surface.changedFiles.length} touched file(s)`,
        detail: surface.changedFiles.slice(0, 4).join(", ") || "No direct file hits — scope match",
        targets: [this.candidateToTarget(surface, surface.reasons.join("; "))],
      });
    }

    options.push({
      label: "$(list-selection) Choose multiple apps…",
      description: "Pick exactly which surfaces to preview",
      targets: [],
    });

    options.push({
      label: "$(search) Let agent discover (whole repo)",
      description: "No workset lock — agent decides from manifests",
      targets: [],
    });

    const picked = await vscode.window.showQuickPick(options, {
      title: "What are you testing?",
      placeHolder: "Only selected apps will be previewed — not the entire monorepo",
    });

    if (!picked) {
      return null;
    }

    if (picked.label.startsWith("$(list-selection)")) {
      return this.pickMultipleSurfaces(surfaces, suggestedTargets);
    }

    if (picked.label.startsWith("$(search)")) {
      return [];
    }

    return picked.targets;
  }

  formatWorksetForMission(
    workset: PreviewWorkset,
    targets: PreviewTarget[],
  ): {
    worksetSummary: string;
    changedFilesList: string;
    selectedTargets: string;
    previewRules: string;
  } {
    if (targets.length === 0) {
      return {
        worksetSummary:
          "No workset lock — discover preview targets from repo structure and manifests.",
        changedFilesList: this.formatFileList(workset.changedFiles),
        selectedTargets: "_Agent chooses based on discovery._",
        previewRules:
          "If multiple apps exist, prefer the one matching the active feature goal and recent git changes.",
      };
    }

    const targetLines = targets.map(
      (t) =>
        `- **${t.label}** (\`${t.root}/\`) — ${t.kind}\n  - Reason: ${t.reason}\n  - Touched: ${t.changedFiles.length} file(s)`,
    );

    const onlyRoots = new Set(targets.map((t) => t.root));
    const excluded = workset.surfaces
      .filter((s) => !onlyRoots.has(s.root))
      .map((s) => s.label);

    let previewRules = `Preview **ONLY** the selected target(s). Do not start dev servers for other apps in this monorepo.`;
    if (targets.length > 1) {
      previewRules +=
        "\n- Start **backend/API before web** when both are selected.\n- Open one browser tab per web surface, or explain what to open manually.";
    }
    if (excluded.length > 0) {
      previewRules += `\n- **Do NOT preview:** ${excluded.join(", ")} (not in this work session).`;
    }

    return {
      worksetSummary: targets.map((t) => t.label).join(" + "),
      changedFilesList: this.formatFileList(workset.changedFiles),
      selectedTargets: targetLines.join("\n"),
      previewRules,
    };
  }

  private async pickMultipleSurfaces(
    surfaces: PreviewSurfaceCandidate[],
    suggested: PreviewTarget[],
  ): Promise<PreviewTarget[] | null> {
    type MultiItem = vscode.QuickPickItem & { surface: PreviewSurfaceCandidate };

    const items: MultiItem[] = surfaces.map((surface) => ({
      label: surface.label,
      description: `${surface.changedFiles.length} file(s) · ${surface.root}/`,
      detail: surface.reasons.join(" · "),
      picked: suggested.some((t) => t.root === surface.root),
      surface,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "Select apps to preview",
      placeHolder: "Only checked apps get dev servers / browser tabs",
    });

    if (!picked || picked.length === 0) {
      return null;
    }

    return picked.map((item) =>
      this.candidateToTarget(item.surface, item.surface.reasons.join("; ")),
    );
  }

  private groupIntoSurfaces(
    repoPath: string,
    touchedFiles: string[],
    context: {
      changedFiles: string[];
      openFiles: string[];
      featureScope: string[];
    },
  ): PreviewSurfaceCandidate[] {
    const byRoot = new Map<string, PreviewSurfaceCandidate>();

    for (const file of touchedFiles) {
      const root = this.resolveAppRoot(repoPath, file);
      if (!root) {
        continue;
      }

      const existing = byRoot.get(root.key) ?? {
        root: root.key,
        label: root.label,
        kind: root.kind,
        changedFiles: [],
        score: 0,
        reasons: [],
      };

      if (!existing.changedFiles.includes(file)) {
        existing.changedFiles.push(file);
      }

      byRoot.set(root.key, existing);
    }

    for (const candidate of byRoot.values()) {
      const gitHits = candidate.changedFiles.filter((f) =>
        context.changedFiles.includes(f),
      ).length;
      const openHits = candidate.changedFiles.filter((f) =>
        context.openFiles.includes(f),
      ).length;
      const scopeHit = this.matchesFeatureScope(
        candidate.root,
        candidate.changedFiles,
        context.featureScope,
      );

      candidate.score = gitHits * 3 + openHits * 2 + (scopeHit ? 5 : 0);
      if (gitHits > 0) {
        candidate.reasons.push(`${gitHits} git-changed`);
      }
      if (openHits > 0) {
        candidate.reasons.push(`${openHits} open in editor`);
      }
      if (scopeHit) {
        candidate.reasons.push("feature scope");
      }
    }

    return [...byRoot.values()].sort((a, b) => b.score - a.score);
  }

  private buildSuggestedTargets(
    surfaces: PreviewSurfaceCandidate[],
  ): PreviewTarget[] {
    const active = surfaces.filter((s) => s.score > 0);
    if (active.length === 0 && surfaces.length > 0) {
      return [this.candidateToTarget(surfaces[0], "Most likely app root")];
    }

    return active.map((s) =>
      this.candidateToTarget(s, s.reasons.join("; ") || "Active in work session"),
    );
  }

  private candidateToTarget(
    candidate: PreviewSurfaceCandidate,
    reason: string,
  ): PreviewTarget {
    return {
      root: candidate.root,
      label: candidate.label,
      kind: candidate.kind,
      changedFiles: candidate.changedFiles,
      reason,
    };
  }

  private resolveAppRoot(
    repoPath: string,
    relativeFile: string,
  ): { key: string; label: string; kind: PreviewSurfaceKind } | null {
    const segments = relativeFile.split("/").filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    for (let i = segments.length - 1; i >= 0; i--) {
      const dir = path.join(repoPath, ...segments.slice(0, i));
      if (!fs.existsSync(dir)) {
        continue;
      }

      for (const manifest of MANIFEST_NAMES) {
        if (fs.existsSync(path.join(dir, manifest))) {
          const key =
            i === 0 ? "." : segments.slice(0, i).join("/").replace(/\\/g, "/");
          return {
            key,
            label: this.labelForRoot(key, dir, manifest),
            kind: this.kindForRoot(key, dir, manifest),
          };
        }
      }
    }

    const top = segments[0];
    if (APP_ROOT_NAMES[top]) {
      return {
        key: top,
        label: this.labelFromKind(APP_ROOT_NAMES[top], top),
        kind: APP_ROOT_NAMES[top],
      };
    }

    return null;
  }

  private labelForRoot(root: string, dir: string, manifest: string): string {
    if (manifest === "package.json") {
      const pkg = this.readJson<{ name?: string; engines?: { vscode?: string } }>(
        path.join(dir, manifest),
      );
      if (pkg?.engines?.vscode) {
        return "VS Code extension";
      }
      if (pkg?.name) {
        return pkg.name;
      }
    }
    return this.labelFromKind(this.kindForRoot(root, dir, manifest), root);
  }

  private kindForRoot(
    root: string,
    dir: string,
    manifest: string,
  ): PreviewSurfaceKind {
    const leaf = root === "." ? "" : root.split("/").pop() ?? root;
    if (APP_ROOT_NAMES[leaf]) {
      return APP_ROOT_NAMES[leaf];
    }

    if (manifest === "package.json") {
      const pkg = this.readJson<{ engines?: { vscode?: string } }>(
        path.join(dir, manifest),
      );
      if (pkg?.engines?.vscode) {
        return "extension";
      }
    }

    if (manifest === "composer.json" || manifest === "pyproject.toml") {
      return "backend";
    }

    if (leaf.includes("mobile")) {
      return "mobile";
    }

    return root === "." ? "unknown" : "shared";
  }

  private labelFromKind(kind: PreviewSurfaceKind, root: string): string {
    switch (kind) {
      case "web":
        return root === "." ? "Web app" : `Web (${root})`;
      case "mobile":
        return root === "." ? "Mobile app" : `Mobile (${root})`;
      case "backend":
        return root === "." ? "Backend API" : `Backend (${root})`;
      case "extension":
        return "VS Code extension";
      default:
        return root === "." ? "Project root" : root;
    }
  }

  private matchesFeatureScope(
    root: string,
    files: string[],
    scope: string[],
  ): boolean {
    if (scope.length === 0) {
      return false;
    }

    for (const pattern of scope) {
      const normalized = pattern.replace(/\\/g, "/");
      if (normalized.startsWith(root) || root.startsWith(normalized.replace(/\/\*\*$/, ""))) {
        return true;
      }
      for (const file of files) {
        if (this.simpleGlobMatch(file, normalized)) {
          return true;
        }
      }
    }

    return false;
  }

  private simpleGlobMatch(file: string, pattern: string): boolean {
    if (pattern.endsWith("/**")) {
      return file.startsWith(pattern.slice(0, -3));
    }
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return file.startsWith(prefix) && !file.slice(prefix.length + 1).includes("/");
    }
    return file === pattern || file.startsWith(`${pattern}/`);
  }

  private getOpenRepoFiles(repoPath: string): string[] {
    const prefix = repoPath.endsWith(path.sep) ? repoPath : repoPath + path.sep;
    return vscode.workspace.textDocuments
      .filter((doc) => !doc.isUntitled && doc.uri.fsPath.startsWith(prefix))
      .map((doc) => normalizePath(path.relative(repoPath, doc.uri.fsPath)))
      .filter(Boolean);
  }

  private formatFileList(files: string[]): string {
    if (files.length === 0) {
      return "_No git changes detected — agent may use open editors and feature scope._";
    }
    return files
      .slice(0, 40)
      .map((f) => `- \`${f}\``)
      .concat(files.length > 40 ? [`- _…and ${files.length - 40} more_`] : [])
      .join("\n");
  }

  private readJson<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
      return null;
    }
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").trim();
}
