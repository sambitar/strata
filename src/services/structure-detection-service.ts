import * as fs from "fs";
import * as path from "path";
import type {
  StructureContract,
  StructureDriftItem,
  StructureLayout,
  StructureService,
  StructureServiceKind,
  StructureValidation,
} from "../models/structure";
import {
  emptyStructureContract,
  normalizeRoot,
  normalizeStructure,
} from "../models/structure";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  ".strata",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "out",
  ".venv",
  "venv",
  "__pycache__",
]);

const MANIFEST_NAMES = [
  "package.json",
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
] as const;

const KIND_BY_LEAF: Record<string, StructureServiceKind> = {
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
  packages: "lib",
  libs: "lib",
  lib: "lib",
  shared: "lib",
  common: "lib",
  tools: "tooling",
  scripts: "tooling",
  tooling: "tooling",
};

const EXPECTED_CANDIDATES = [
  "src",
  "lib",
  "app",
  "apps",
  "packages",
  "public",
  "static",
  "tests",
  "test",
  "__tests__",
  "components",
  "pages",
  "routes",
  "controllers",
  "models",
  "prisma",
  "migrations",
  "tsconfig.json",
  "README.md",
  ".eslintrc.js",
  ".eslintrc.cjs",
  "eslint.config.js",
  "eslint.config.mjs",
  "vitest.config.ts",
  "jest.config.js",
  "Dockerfile",
];

export interface StructureDetectionResult {
  structure: StructureContract;
  hasProjectCode: boolean;
}

export class StructureDetectionService {
  detect(repoPath: string): StructureDetectionResult {
    const now = new Date().toISOString();
    const sources: string[] = [];
    const services = this.discoverServices(repoPath, sources);
    const ciPaths = this.discoverCiPaths(repoPath, sources);
    const layout = this.inferLayout(services);

    const structure = emptyStructureContract({
      status: "draft",
      detectedAt: now,
      lockedAt: null,
      sources: [...new Set(sources)],
      layout,
      services,
      ciPaths,
      notes: "",
    });

    return {
      structure,
      hasProjectCode: services.length > 0 || ciPaths.length > 0,
    };
  }

  validate(
    repoPath: string,
    contract: StructureContract | null | undefined,
  ): StructureValidation {
    const normalized = normalizeStructure(contract);
    if (!normalized || normalized.services.length === 0) {
      return {
        ok: false,
        drift: [
          {
            serviceId: null,
            path: ".",
            issue: "missing_root",
            message: "No structure contract services defined.",
          },
        ],
        summary: "Structure contract missing or empty.",
      };
    }

    const drift: StructureDriftItem[] = [];

    for (const service of normalized.services) {
      const rootAbs =
        service.root === "."
          ? repoPath
          : path.join(repoPath, ...service.root.split("/"));

      if (!fs.existsSync(rootAbs)) {
        drift.push({
          serviceId: service.id,
          path: service.root,
          issue: "missing_root",
          message: `Service root "${service.root}" no longer exists.`,
        });
        continue;
      }

      for (const expected of service.expectedPaths) {
        const expectedAbs = path.join(rootAbs, ...expected.split("/"));
        if (!fs.existsSync(expectedAbs)) {
          drift.push({
            serviceId: service.id,
            path: service.root === "." ? expected : `${service.root}/${expected}`,
            issue: "missing_path",
            message: `Expected path missing for ${service.name}: ${expected}`,
          });
        }
      }
    }

    for (const ciPath of normalized.ciPaths) {
      if (!fs.existsSync(path.join(repoPath, ...ciPath.split("/")))) {
        drift.push({
          serviceId: null,
          path: ciPath,
          issue: "missing_ci",
          message: `CI path missing: ${ciPath}`,
        });
      }
    }

    if (drift.length === 0) {
      return {
        ok: true,
        drift: [],
        summary: `Structure OK — ${normalized.services.length} service(s), ${normalized.ciPaths.length} CI path(s).`,
      };
    }

    return {
      ok: false,
      drift,
      summary: `${drift.length} structure drift issue(s) vs locked contract.`,
    };
  }

  mergePreserveLock(
    saved: StructureContract | null | undefined,
    detected: StructureContract,
  ): StructureContract {
    const normalizedSaved = normalizeStructure(saved);
    if (!normalizedSaved) {
      return detected;
    }

    if (normalizedSaved.status === "locked") {
      return {
        ...normalizedSaved,
        detectedAt: detected.detectedAt,
        sources: detected.sources,
      };
    }

    return {
      ...detected,
      status: "draft",
      lockedAt: null,
      notes: normalizedSaved.notes || detected.notes,
      services:
        normalizedSaved.services.length > 0
          ? this.mergeServices(normalizedSaved.services, detected.services)
          : detected.services,
      ciPaths:
        normalizedSaved.ciPaths.length > 0
          ? [...new Set([...normalizedSaved.ciPaths, ...detected.ciPaths])]
          : detected.ciPaths,
      layout:
        normalizedSaved.layout !== "unknown"
          ? normalizedSaved.layout
          : detected.layout,
    };
  }

  private mergeServices(
    saved: StructureService[],
    detected: StructureService[],
  ): StructureService[] {
    const byRoot = new Map<string, StructureService>();
    for (const service of detected) {
      byRoot.set(normalizeRoot(service.root), service);
    }
    for (const service of saved) {
      const root = normalizeRoot(service.root);
      const incoming = byRoot.get(root);
      if (!incoming) {
        byRoot.set(root, service);
        continue;
      }
      byRoot.set(root, {
        ...incoming,
        name: service.name || incoming.name,
        conventions:
          service.conventions.length > 0
            ? service.conventions
            : incoming.conventions,
        expectedPaths:
          service.expectedPaths.length > 0
            ? service.expectedPaths
            : incoming.expectedPaths,
        libraries:
          service.libraries.length > 0 ? service.libraries : incoming.libraries,
      });
    }
    return [...byRoot.values()].sort((a, b) => a.root.localeCompare(b.root));
  }

  private discoverServices(repoPath: string, sources: string[]): StructureService[] {
    const manifestDirs = this.findManifestDirs(repoPath);
    const services: StructureService[] = [];

    for (const entry of manifestDirs) {
      sources.push(entry.manifestRel);
      const service = this.serviceFromManifest(repoPath, entry);
      if (service) {
        services.push(service);
      }
    }

    if (services.length === 0 && this.hasLooseSourceTree(repoPath)) {
      sources.push("src/");
      services.push({
        id: "root",
        name: path.basename(repoPath),
        root: ".",
        kind: "other",
        manifests: [],
        expectedPaths: this.captureExpected(repoPath),
        conventions: ["Single root source tree"],
        libraries: [],
      });
    }

    return this.dedupeServices(services);
  }

  private findManifestDirs(repoPath: string): Array<{
    rootRel: string;
    absDir: string;
    manifestRel: string;
    manifestName: string;
  }> {
    const found = new Map<
      string,
      {
        rootRel: string;
        absDir: string;
        manifestRel: string;
        manifestName: string;
      }
    >();

    const consider = (absDir: string, manifestName: string): void => {
      const manifestAbs = path.join(absDir, manifestName);
      if (!fs.existsSync(manifestAbs)) {
        return;
      }
      const rootRel = normalizeRoot(path.relative(repoPath, absDir) || ".");
      const key = `${rootRel}::${manifestName}`;
      if (found.has(key)) {
        return;
      }
      found.set(key, {
        rootRel,
        absDir,
        manifestRel:
          rootRel === "." ? manifestName : `${rootRel}/${manifestName}`,
        manifestName,
      });
    };

    for (const name of MANIFEST_NAMES) {
      consider(repoPath, name);
    }

    this.walk(repoPath, repoPath, 0, 3, (absDir) => {
      for (const name of MANIFEST_NAMES) {
        consider(absDir, name);
      }
    });

    return [...found.values()];
  }

  private walk(
    repoPath: string,
    currentDir: string,
    depth: number,
    maxDepth: number,
    visit: (absDir: string) => void,
  ): void {
    if (depth > maxDepth) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        continue;
      }
      const absDir = path.join(currentDir, entry.name);
      visit(absDir);
      this.walk(repoPath, absDir, depth + 1, maxDepth, visit);
    }
  }

  private serviceFromManifest(
    repoPath: string,
    entry: {
      rootRel: string;
      absDir: string;
      manifestRel: string;
      manifestName: string;
    },
  ): StructureService | null {
    const kind = this.inferKind(entry.rootRel, entry.absDir, entry.manifestName);
    const name = this.inferName(entry.rootRel, entry.absDir, entry.manifestName);
    const libraries = this.inferLibraries(entry.absDir, entry.manifestName);
    const conventions = this.inferConventions(kind, entry.rootRel);

    return {
      id: this.idForRoot(entry.rootRel),
      name,
      root: entry.rootRel,
      kind,
      manifests: [entry.manifestRel],
      expectedPaths: this.captureExpected(entry.absDir),
      conventions,
      libraries,
    };
  }

  private dedupeServices(services: StructureService[]): StructureService[] {
    const byRoot = new Map<string, StructureService>();

    for (const service of services) {
      const root = normalizeRoot(service.root);
      const existing = byRoot.get(root);
      if (!existing) {
        byRoot.set(root, service);
        continue;
      }
      byRoot.set(root, {
        ...existing,
        manifests: [...new Set([...existing.manifests, ...service.manifests])],
        libraries: [...new Set([...existing.libraries, ...service.libraries])],
        expectedPaths: [
          ...new Set([...existing.expectedPaths, ...service.expectedPaths]),
        ],
        conventions: [
          ...new Set([...existing.conventions, ...service.conventions]),
        ],
      });
    }

    const list = [...byRoot.values()];

    // Prefer child package roots over a root workspace when children exist.
    const hasChildren = list.some((s) => s.root !== ".");
    if (hasChildren) {
      const root = list.find((s) => s.root === ".");
      if (root && this.looksLikeWorkspaceRoot(root)) {
        root.kind = "tooling";
        if (!root.conventions.includes("Workspace root / package manager hub")) {
          root.conventions = [
            ...root.conventions,
            "Workspace root / package manager hub",
          ];
        }
      }
    }

    return list.sort((a, b) => a.root.localeCompare(b.root));
  }

  private looksLikeWorkspaceRoot(service: StructureService): boolean {
    return service.manifests.some((m) => m === "package.json" || m.endsWith("/package.json"));
  }

  private captureExpected(absDir: string): string[] {
    return EXPECTED_CANDIDATES.filter((candidate) =>
      fs.existsSync(path.join(absDir, ...candidate.split("/"))),
    );
  }

  private inferKind(
    rootRel: string,
    absDir: string,
    manifestName: string,
  ): StructureServiceKind {
    const leaf =
      rootRel === "."
        ? path.basename(absDir).toLowerCase()
        : (rootRel.split("/").pop() ?? rootRel).toLowerCase();

    if (KIND_BY_LEAF[leaf]) {
      return KIND_BY_LEAF[leaf];
    }

    if (manifestName === "package.json") {
      const pkg = this.readJson<{ engines?: { vscode?: string } }>(
        path.join(absDir, "package.json"),
      );
      if (pkg?.engines?.vscode) {
        return "extension";
      }
    }

    if (/(^|\/)(web|frontend|client|ui)($|\/)/.test(rootRel)) {
      return "web";
    }
    if (/(^|\/)(backend|server|api)($|\/)/.test(rootRel)) {
      return "backend";
    }
    if (/(^|\/)(mobile|ios|android)($|\/)/.test(rootRel)) {
      return "mobile";
    }
    if (/(^|\/)(packages|libs|lib|shared)($|\/)/.test(rootRel)) {
      return "lib";
    }

    return rootRel === "." ? "other" : "other";
  }

  private inferName(
    rootRel: string,
    absDir: string,
    manifestName: string,
  ): string {
    if (manifestName === "package.json") {
      const pkg = this.readJson<{ name?: string; engines?: { vscode?: string } }>(
        path.join(absDir, "package.json"),
      );
      if (pkg?.engines?.vscode) {
        return pkg.name || "VS Code extension";
      }
      if (pkg?.name) {
        return pkg.name;
      }
    }

    if (rootRel === ".") {
      return path.basename(absDir);
    }

    return rootRel.split("/").pop() || rootRel;
  }

  private inferLibraries(absDir: string, manifestName: string): string[] {
    if (manifestName !== "package.json") {
      return [];
    }
    const pkg = this.readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(absDir, "package.json"));
    if (!pkg) {
      return [];
    }

    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];

    const interesting = names.filter((name) =>
      /^(react|next|vue|nuxt|svelte|express|fastify|nestjs|hono|prisma|drizzle|vite|webpack|typescript|vscode)/i.test(
        name.replace(/^@[^/]+\//, ""),
      ) || name.startsWith("@"),
    );

    return [...new Set(interesting)].slice(0, 12);
  }

  private inferConventions(
    kind: StructureServiceKind,
    rootRel: string,
  ): string[] {
    const conventions: string[] = [];
    if (kind === "extension") {
      conventions.push("VS Code / Cursor extension — keep src/ extension entrypoints");
    } else if (kind === "web") {
      conventions.push("UI / client app — keep frontend code under this root");
    } else if (kind === "backend") {
      conventions.push("API / server — keep backend entrypoints under this root");
    } else if (kind === "mobile") {
      conventions.push("Mobile app surface");
    } else if (kind === "lib") {
      conventions.push("Shared library — import from apps, avoid app-specific UI here");
    } else if (kind === "tooling") {
      conventions.push("Tooling / workspace root — scripts and shared config");
    }

    if (rootRel !== ".") {
      conventions.push(`Primary root: ${rootRel}/`);
    }

    return conventions;
  }

  private discoverCiPaths(repoPath: string, sources: string[]): string[] {
    const paths: string[] = [];
    const workflowsDir = path.join(repoPath, ".github", "workflows");
    if (fs.existsSync(workflowsDir)) {
      sources.push(".github/workflows");
      try {
        for (const name of fs.readdirSync(workflowsDir)) {
          if (/\.(yml|yaml)$/i.test(name)) {
            paths.push(`.github/workflows/${name}`);
          }
        }
      } catch {
        // ignore
      }
    }

    for (const candidate of [
      ".gitlab-ci.yml",
      ".circleci/config.yml",
      "azure-pipelines.yml",
      "bitbucket-pipelines.yml",
      "Jenkinsfile",
    ]) {
      if (fs.existsSync(path.join(repoPath, ...candidate.split("/")))) {
        paths.push(candidate);
        sources.push(candidate);
      }
    }

    return paths.sort();
  }

  private inferLayout(services: StructureService[]): StructureLayout {
    if (services.length === 0) {
      return "unknown";
    }

    const nonTooling = services.filter((s) => s.kind !== "tooling");
    const roots = nonTooling.map((s) => s.root);

    if (roots.length <= 1 && (roots[0] === "." || roots.length === 0)) {
      return "monolith";
    }

    if (
      roots.some(
        (r) =>
          r.startsWith("apps/") ||
          r.startsWith("packages/") ||
          r.startsWith("services/"),
      )
    ) {
      return "monorepo";
    }

    if (roots.filter((r) => r !== ".").length >= 2) {
      return "multi-service";
    }

    return roots.length > 1 ? "multi-service" : "monolith";
  }

  private hasLooseSourceTree(repoPath: string): boolean {
    return (
      fs.existsSync(path.join(repoPath, "src")) ||
      fs.existsSync(path.join(repoPath, "lib")) ||
      fs.existsSync(path.join(repoPath, "app"))
    );
  }

  private idForRoot(root: string): string {
    if (root === ".") {
      return "root";
    }
    return root.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "service";
  }

  private readJson<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
      return null;
    }
  }
}
