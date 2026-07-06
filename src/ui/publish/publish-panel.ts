import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { PublishWizardMessage } from "../../models/messages";
import type { PublishPlan } from "../../models/workspace";
import { PublishService } from "../../services/publish-service";
import { WorkspaceService } from "../../services/workspace-service";

export class PublishPanel {
  private panel: vscode.WebviewPanel | undefined;
  private htmlLoaded = false;
  private plan: PublishPlan | null = null;
  private step = 0;
  private messageOverride: string | null = null;
  private createPr = true;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceService: WorkspaceService,
    private readonly publishService: PublishService,
  ) {}

  async show(): Promise<void> {
    const workspace = this.workspaceService.getActive();
    if (!workspace) {
      void vscode.window.showWarningMessage(
        "No active workspace. Create or switch to a workspace first.",
      );
      return;
    }

    this.plan = await this.publishService.prepare(workspace);
    this.messageOverride = this.plan.message;
    this.createPr = vscode.workspace
      .getConfiguration("strata")
      .get<boolean>("autoCreatePr", true);
    this.step = 0;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "strataPublish",
        "Strata Publish",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [
            vscode.Uri.file(path.join(this.context.extensionPath, "dist")),
          ],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.htmlLoaded = false;
        this.plan = null;
      });

      this.panel.webview.onDidReceiveMessage(async (msg: PublishWizardMessage & { type: string }) => {
        await this.handleMessage(msg);
      });
    }

    this.panel.title = `Publish — ${workspace.name}`;
    this.panel.reveal(vscode.ViewColumn.One);

    if (!this.htmlLoaded) {
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.htmlLoaded = true;
    }

    await this.pushState();
  }

  private async handleMessage(
    msg: PublishWizardMessage & { type: string },
  ): Promise<void> {
    if (msg.type === "ready") {
      await this.pushState();
      return;
    }

    if (msg.type === "setMessage" && this.plan) {
      this.messageOverride = msg.message;
      await this.pushState();
      return;
    }

    if (msg.type === "setCreatePr") {
      this.createPr = msg.createPr;
      await this.pushState();
      return;
    }

    if (msg.type === "back" && this.step > 0) {
      this.step -= 1;
      await this.pushState();
      return;
    }

    if (msg.type === "next" && this.step < 2) {
      this.step += 1;
      await this.pushState();
      return;
    }

    if (msg.type === "push" && this.plan) {
      await this.executePush();
      return;
    }

    if (msg.type === "close") {
      this.panel?.dispose();
    }
  }

  private async executePush(): Promise<void> {
    if (!this.plan) {
      return;
    }

    const workspace = this.workspaceService.getActive();
    if (!workspace) {
      return;
    }

    const plan = {
      ...this.plan,
      message: this.messageOverride ?? this.plan.message,
    };

    await this.pushState(true);

    try {
      const result = await this.publishService.execute(plan, workspace, {
        autoCreatePr: this.createPr,
      });
      this.workspaceService.recordFeaturePublish(workspace, {
        sha: result.sha,
        prUrl: result.prUrl,
      });
      this.step = 3;
      await this.pushState(false, null, result);

      const prNote = result.prCreated
        ? " Pull request created."
        : result.prUrl
          ? " Linked to existing PR."
          : "";
      void vscode.window.showInformationMessage(
        `Published ${result.branch} successfully.${prNote}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.pushState(false, message);
    }
  }

  private async pushState(
    loading = false,
    error: string | null = null,
    result: import("../../models/workspace").PublishResult | null = null,
  ): Promise<void> {
    if (!this.panel || !this.plan) {
      return;
    }

    const workspace = this.workspaceService.getActive();
    if (!workspace) {
      return;
    }

    const validation = await this.publishService.validate(this.plan, workspace);

    this.panel.webview.postMessage({
      type: "state",
      payload: {
        step: this.step,
        isClean: validation.isClean,
        branch: this.plan.branch,
        remote: this.plan.remote,
        trunk: this.plan.trunk,
        message: this.messageOverride ?? this.plan.message,
        files: validation.changes.files,
        insertions: validation.changes.insertions,
        deletions: validation.changes.deletions,
        loading,
        error,
        result,
        createPr: this.createPr,
        sourceBranch: workspace.currentFeature?.sourceBranch ?? null,
        safeToPush: validation.safeToPush,
        safetyMessage: validation.safetyMessage,
        remoteBranchExists: validation.remoteBranchExists,
      },
    } satisfies PublishWizardMessage);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, "dist", "publish-wizard.js"),
      ),
    );

    const csp = [
      "default-src 'none'",
      `script-src ${webview.cspSource} 'unsafe-inline'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Strata Publish</title>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
