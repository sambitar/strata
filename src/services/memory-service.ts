import * as fs from "fs";
import * as path from "path";
import type { Feature, MemoryFileName, WorkspaceConfig } from "../models/workspace";
import { MEMORY_FILES } from "../models/workspace";
import type { WorkspaceStack } from "../models/stack";
import { formatStackForArchitecture } from "../models/stack";
import { ensureDir, getMemoryDir } from "../storage/paths";

function templateFor(file: MemoryFileName, config: WorkspaceConfig): string {
  switch (file) {
    case "summary.md":
      return `# ${config.name} — Summary

What this project is and why it exists.

## Purpose

Describe the core purpose of ${config.name}.

## Current focus

${config.currentGoal}
`;
    case "todo.md":
      return `# ${config.name} — Todo

## Now

- [ ] ${config.currentGoal}

## Next

- [ ]

## Later

- [ ]
`;
    case "architecture.md":
      return `# ${config.name} — Architecture

## Overview

High-level system design.

## Components

- Backend
- Frontend
- Database

## Git

- Trunk: \`${config.git.trunk}\`
- Branch: \`${config.git.branch}\`
`;
    case "decisions.md":
      return `# ${config.name} — Decisions

Record important technical decisions here.

## Template

### Decision title

- **Date:**
- **Status:** proposed | accepted | deprecated
- **Context:**
- **Decision:**
- **Consequences:**
`;
  }
}

export class MemoryService {
  scaffold(repoPath: string, config: WorkspaceConfig): void {
    const memoryDir = getMemoryDir(repoPath);
    ensureDir(memoryDir);

    for (const file of MEMORY_FILES) {
      const filePath = path.join(memoryDir, file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, templateFor(file, config), "utf8");
      }
    }
  }

  list(repoPath: string): MemoryFileName[] {
    const memoryDir = getMemoryDir(repoPath);
    if (!fs.existsSync(memoryDir)) {
      return [];
    }

    return MEMORY_FILES.filter((file) =>
      fs.existsSync(path.join(memoryDir, file)),
    );
  }

  getPath(repoPath: string, file: MemoryFileName): string {
    return path.join(getMemoryDir(repoPath), file);
  }

  touchAiActivity(config: WorkspaceConfig): WorkspaceConfig {
    return {
      ...config,
      ai: {
        lastActiveAt: new Date().toISOString(),
      },
    };
  }

  writeFeatureStart(
    repoPath: string,
    workspaceName: string,
    feature: Feature,
  ): void {
    ensureDir(getMemoryDir(repoPath));

    const todoPath = path.join(getMemoryDir(repoPath), "todo.md");
    const scopeLine =
      feature.scope.length > 0
        ? `\n## Scope\n\n${feature.scope.map((s) => `- \`${s}\``).join("\n")}\n`
        : "";

    const content = `# ${workspaceName} — Todo

## Feature: ${feature.name}

**Goal:** ${feature.goal}

**Branch:** \`${feature.branch}\` (new work branch)

**Based on:** \`${feature.sourceBranch ?? "main"}\`
${scopeLine}
## Now

- [ ] ${feature.goal}

## Next

- [ ]

## Done when

- [ ] Tests pass
- [ ] Ready to publish via Strata
`;

    fs.writeFileSync(todoPath, content, "utf8");

    const summaryPath = path.join(getMemoryDir(repoPath), "summary.md");
    if (fs.existsSync(summaryPath)) {
      const existing = fs.readFileSync(summaryPath, "utf8");
      if (!existing.includes("## Current feature")) {
        fs.writeFileSync(
          summaryPath,
          `${existing.trim()}\n\n## Current feature\n\n**${feature.name}** — ${feature.goal}\n`,
          "utf8",
        );
      }
    }
  }

  syncStackInArchitecture(
    repoPath: string,
    workspaceName: string,
    stack: WorkspaceStack,
  ): void {
    ensureDir(getMemoryDir(repoPath));
    const archPath = path.join(getMemoryDir(repoPath), "architecture.md");

    if (!fs.existsSync(archPath)) {
      fs.writeFileSync(
        archPath,
        `# ${workspaceName} — Architecture\n\n${formatStackForArchitecture(stack)}`,
        "utf8",
      );
      return;
    }

    const stackBlock = formatStackForArchitecture(stack);
    let content = fs.readFileSync(archPath, "utf8");
    const stackHeading = /^## Stack\b/m;

    if (stackHeading.test(content)) {
      content = content.replace(
        /^## Stack\b[\s\S]*?(?=^## |\Z)/m,
        stackBlock.trimEnd() + "\n\n",
      );
    } else {
      content = `${content.trim()}\n\n${stackBlock}`;
    }

    fs.writeFileSync(archPath, content, "utf8");
  }
}
