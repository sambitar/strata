import React, { useEffect, useState } from "react";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();

interface WizardState {
  step: number;
  isClean: boolean;
  branch: string;
  remote: string;
  trunk: string;
  message: string;
  files: number;
  insertions: number;
  deletions: number;
  loading: boolean;
  error: string | null;
  compareUrl: string | null;
  prUrl: string | null;
  prNumber: number | null;
  prCreated: boolean;
  createPr: boolean;
  sourceBranch: string | null;
  safeToPush: boolean;
  safetyMessage: string | null;
  remoteBranchExists: boolean;
}

const STEPS = ["Safety", "Preview", "Push", "Done"];

function App() {
  const [state, setState] = useState<WizardState | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "state") {
        setState({
          ...event.data.payload,
          compareUrl: event.data.payload.result?.compareUrl ?? null,
          prUrl: event.data.payload.result?.prUrl ?? null,
          prNumber: event.data.payload.result?.prNumber ?? null,
          prCreated: event.data.payload.result?.prCreated ?? false,
          createPr: event.data.payload.createPr ?? true,
          sourceBranch: event.data.payload.sourceBranch ?? null,
          safeToPush: event.data.payload.safeToPush ?? true,
          safetyMessage: event.data.payload.safetyMessage ?? null,
          remoteBranchExists: event.data.payload.remoteBranchExists ?? false,
        });
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  if (!state) {
    return <div className="loading">Loading publish wizard...</div>;
  }

  return (
    <div className="wizard">
      <header>
        <h1>Publish Workspace</h1>
        <div className="steps">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`step ${i === state.step ? "active" : ""} ${i < state.step ? "done" : ""}`}
            >
              {label}
            </span>
          ))}
        </div>
      </header>

      {state.error && <div className="error">{state.error}</div>}

      {state.step === 0 && (
        <section>
          <h2>Safety Check</h2>
          {state.safeToPush ? (
            <p className="muted ok">
              Safe to publish. Only <strong>{state.branch}</strong> will be pushed.
              <strong> {state.trunk}</strong> will not be modified.
            </p>
          ) : (
            <div className="error">{state.safetyMessage}</div>
          )}
          <p>
            Worktree is{" "}
            <strong>{state.isClean ? "clean" : "modified"}</strong>.
            {!state.isClean && " Uncommitted changes will be included in the publish."}
          </p>
          <p>
            {state.files} files changed ({state.insertions}+ / {state.deletions}-)
          </p>
          {state.remoteBranchExists && state.safeToPush && (
            <p className="muted">Updating existing remote branch for this work session.</p>
          )}
        </section>
      )}

      {state.step === 1 && (
        <section>
          <h2>Preview</h2>
          <p className="muted">
            Pushes only to your new work branch. Protected branches like{" "}
            <strong>{state.trunk}</strong> are never modified.
          </p>
          {state.sourceBranch && (
            <p className="muted">Forked from: {state.sourceBranch}</p>
          )}
          <label>
            Work branch (new)
            <input value={state.branch} readOnly />
          </label>
          <label>
            Remote
            <input value={state.remote} readOnly />
          </label>
          <label>
            Commit message
            <textarea
              value={state.message}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                vscode.postMessage({ type: "setMessage", message: e.target.value })
              }
              rows={3}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={state.createPr}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                vscode.postMessage({ type: "setCreatePr", createPr: e.target.checked })
              }
            />
            Create pull request on GitHub when done
          </label>
          <p className="muted">
            Trunk: {state.trunk} · {state.files} files · +{state.insertions} -{state.deletions}
          </p>
        </section>
      )}

      {state.step === 2 && (
        <section>
          <h2>Push</h2>
          {state.loading ? (
            <p>Pushing to {state.remote}/{state.branch}...</p>
          ) : (
            <p>Ready to push branch <strong>{state.branch}</strong> to <strong>{state.remote}</strong>.</p>
          )}
        </section>
      )}

      {state.step === 3 && (
        <section>
          <h2>Done</h2>
          <p>Published <strong>{state.branch}</strong> successfully.</p>
          {state.prUrl && state.prNumber ? (
            <>
              <p>
                {state.prCreated ? "Created" : "Linked"} pull request{" "}
                <strong>#{state.prNumber}</strong>.
              </p>
              <a href={state.prUrl} target="_blank" rel="noreferrer">
                Open pull request on GitHub
              </a>
            </>
          ) : state.compareUrl && state.createPr ? (
            <>
              <p className="muted">Branch pushed. Open compare URL to create a PR.</p>
              <a href={state.compareUrl} target="_blank" rel="noreferrer">
                Create pull request
              </a>
            </>
          ) : (
            <p className="muted">Branch pushed to GitHub. No pull request created.</p>
          )}
        </section>
      )}

      <footer>
        {state.step > 0 && state.step < 3 && (
          <button className="secondary" onClick={() => vscode.postMessage({ type: "back" })} disabled={state.loading}>
            Back
          </button>
        )}
        {state.step < 2 && (
          <button className="primary" onClick={() => vscode.postMessage({ type: "next" })}>
            Next
          </button>
        )}
        {state.step === 2 && (
          <button className="primary" onClick={() => vscode.postMessage({ type: "push" })} disabled={state.loading || !state.safeToPush}>
            {state.loading ? "Pushing..." : "Push"}
          </button>
        )}
        {state.step === 3 && (
          <button className="primary" onClick={() => vscode.postMessage({ type: "close" })}>
            Close
          </button>
        )}
      </footer>
    </div>
  );
}

export default App;
