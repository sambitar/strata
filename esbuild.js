const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  sourcemap: true,
  logLevel: "info",
  external: ["vscode"],
};

const extensionBuild = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
};

const publishBuild = {
  ...common,
  entryPoints: ["src/ui/publish/wizard/main.tsx"],
  outfile: "dist/publish-wizard.js",
  format: "iife",
  platform: "browser",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
  },
};

async function build() {
  await esbuild.build(extensionBuild);
  await esbuild.build(publishBuild);

  const dashboardSrc = path.join(__dirname, "src/ui/dashboard/dashboard.html");
  const dashboardDest = path.join(__dirname, "dist/dashboard.html");
  fs.mkdirSync(path.dirname(dashboardDest), { recursive: true });
  fs.copyFileSync(dashboardSrc, dashboardDest);

  console.log("Strata build complete.");
}

async function watchBuild() {
  const extCtx = await esbuild.context(extensionBuild);
  const pubCtx = await esbuild.context(publishBuild);
  await extCtx.watch();
  await pubCtx.watch();
  console.log("Watching for changes...");
}

if (watch) {
  watchBuild().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
