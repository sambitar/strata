import * as vscode from "vscode";
import type { WorkspaceEnvironment } from "../models/workspace";

interface EnvironmentTheme {
  activityBarBackground: string;
  statusBarBackground: string;
  titleBarBackground: string;
  accent: string;
}

const THEMES: Record<WorkspaceEnvironment, EnvironmentTheme> = {
  production: {
    activityBarBackground: "#3b1219",
    statusBarBackground: "#7f1d1d",
    titleBarBackground: "#450a0a",
    accent: "#ef4444",
  },
  feature: {
    activityBarBackground: "#172554",
    statusBarBackground: "#1e3a8a",
    titleBarBackground: "#1e3a8a",
    accent: "#3b82f6",
  },
  experiment: {
    activityBarBackground: "#3b0764",
    statusBarBackground: "#581c87",
    titleBarBackground: "#4c1d95",
    accent: "#a855f7",
  },
  development: {
    activityBarBackground: "#052e16",
    statusBarBackground: "#14532d",
    titleBarBackground: "#166534",
    accent: "#22c55e",
  },
};

export class ThemeService {
  private currentEnvironment: WorkspaceEnvironment | null = null;

  async apply(environment: WorkspaceEnvironment): Promise<void> {
    this.currentEnvironment = environment;
    const theme = THEMES[environment];
    const config = vscode.workspace.getConfiguration();

    await config.update(
      "workbench.colorCustomizations",
      {
        "activityBar.background": theme.activityBarBackground,
        "activityBar.foreground": "#ffffff",
        "statusBar.background": theme.statusBarBackground,
        "statusBar.foreground": "#ffffff",
        "titleBar.activeBackground": theme.titleBarBackground,
        "titleBar.activeForeground": "#ffffff",
        "statusBarItem.prominentBackground": theme.accent,
      },
      vscode.ConfigurationTarget.Global,
    );
  }

  async clear(): Promise<void> {
    this.currentEnvironment = null;
    const config = vscode.workspace.getConfiguration();
    await config.update(
      "workbench.colorCustomizations",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  }

  getCurrentEnvironment(): WorkspaceEnvironment | null {
    return this.currentEnvironment;
  }

  getAccent(environment: WorkspaceEnvironment): string {
    return THEMES[environment].accent;
  }
}
