import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #ccc);
    --muted: var(--vscode-descriptionForeground, #999);
    --border: var(--vscode-panel-border, #444);
    --accent: var(--vscode-button-background, #0e639c);
    --accent-fg: var(--vscode-button-foreground, #fff);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, system-ui);
    font-size: 13px;
    background: var(--bg);
    color: var(--fg);
    padding: 20px;
  }
  .wizard header { margin-bottom: 20px; }
  .wizard h1 { font-size: 18px; margin-bottom: 12px; }
  .steps { display: flex; gap: 8px; flex-wrap: wrap; }
  .step {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    background: var(--border);
    opacity: 0.6;
  }
  .step.active { background: var(--accent); color: var(--accent-fg); opacity: 1; }
  .step.done { opacity: 0.85; }
  section { margin: 20px 0; }
  section h2 { font-size: 14px; margin-bottom: 10px; }
  label { display: block; margin-bottom: 12px; }
  input, textarea {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 8px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--border);
    border-radius: 4px;
    font: inherit;
  }
  .muted { color: var(--muted); font-size: 12px; margin-top: 8px; }
  .error {
    background: #7f1d1d;
    color: #fecaca;
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px; }
  button {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font: inherit;
  }
  button.primary { background: var(--accent); color: var(--accent-fg); }
  button.secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  a { color: var(--vscode-textLink-foreground, #3794ff); }
  .loading { padding: 40px; text-align: center; color: var(--muted); }
`;
document.head.appendChild(style);

const container = document.createElement("div");
container.id = "root";
document.body.appendChild(container);

createRoot(container).render(<App />);
