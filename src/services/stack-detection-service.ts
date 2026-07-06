import * as fs from "fs";
import * as path from "path";
import type { StackFieldKey, WorkspaceStack } from "../models/stack";
import { STACK_FIELD_DEFINITIONS, stackHasValues } from "../models/stack";

type StackSignals = Partial<Record<StackFieldKey, string>>;
type ProjectRole = "frontend" | "backend" | "mobile" | "any";

export interface StackDetectionResult {
  stack: WorkspaceStack;
  sources: string[];
  hasProjectCode: boolean;
}

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
]);

const SUBPROJECT_PATHS = [
  "web",
  "frontend",
  "client",
  "ui",
  "app",
  "backend",
  "server",
  "api",
  "mobile",
  "apps/web",
  "apps/frontend",
  "apps/client",
  "apps/backend",
  "apps/api",
  "apps/mobile",
  "packages/web",
  "packages/frontend",
  "packages/backend",
  "packages/api",
];

export class StackDetectionService {
  detect(repoPath: string): StackDetectionResult {
    const signals: StackSignals = {};
    const sources: string[] = [];

    const manifests = this.discoverManifests(repoPath);

    for (const manifest of manifests) {
      const label = manifest.relativePath;
      sources.push(label);

      switch (manifest.type) {
        case "npm":
          this.detectFromPackageJson(
            manifest.absoluteDir,
            signals,
            this.inferRole(manifest.relativePath),
          );
          break;
        case "composer":
          this.detectFromComposerJson(manifest.absolutePath, signals);
          break;
        case "python":
          this.detectFromPython(manifest.absoluteDir, signals);
          break;
      }
    }

    if (this.fileExists(repoPath, "tsconfig.json")) {
      if (!sources.includes("tsconfig.json")) {
        sources.push("tsconfig.json");
      }
      this.mergeSignal(signals, "language", "TypeScript");
    }

    if (this.fileExists(repoPath, "bun.lockb") || this.fileExists(repoPath, "bun.lock")) {
      sources.push("bun.lock");
      this.mergeSignal(signals, "runtime", "Bun");
    }

    if (this.fileExists(repoPath, "deno.json") || this.fileExists(repoPath, "deno.jsonc")) {
      sources.push("deno.json");
      this.mergeSignal(signals, "runtime", "Deno");
    }

    if (this.fileExists(repoPath, "go.mod")) {
      sources.push("go.mod");
      this.detectFromGo(signals);
    }

    if (this.fileExists(repoPath, "Cargo.toml")) {
      sources.push("Cargo.toml");
      this.detectFromRust(signals);
    }

    if (this.fileExists(repoPath, "Gemfile")) {
      sources.push("Gemfile");
      this.detectFromRuby(signals);
    }

    if (
      this.fileExists(repoPath, "docker-compose.yml") ||
      this.fileExists(repoPath, "docker-compose.yaml")
    ) {
      sources.push("docker-compose");
      this.detectFromDockerCompose(repoPath, signals);
    }

    if (this.fileExists(repoPath, "prisma/schema.prisma")) {
      sources.push("prisma/schema.prisma");
      this.mergeSignal(signals, "orm", "Prisma");
    }

    this.detectHostingHints(repoPath, signals, sources);

    const stack = this.toWorkspaceStack(signals);
    const uniqueSources = [...new Set(sources)];

    return {
      stack,
      sources: uniqueSources,
      hasProjectCode: uniqueSources.length > 0 && stackHasValues(stack),
    };
  }

  private discoverManifests(
    repoPath: string,
  ): Array<{
    type: "npm" | "composer" | "python";
    relativePath: string;
    absolutePath: string;
    absoluteDir: string;
  }> {
    const found = new Map<
      string,
      {
        type: "npm" | "composer" | "python";
        relativePath: string;
        absolutePath: string;
        absoluteDir: string;
      }
    >();

    const add = (
      type: "npm" | "composer" | "python",
      relativePath: string,
    ): void => {
      if (found.has(relativePath)) {
        return;
      }
      const absolutePath = path.join(repoPath, relativePath);
      if (!fs.existsSync(absolutePath)) {
        return;
      }
      found.set(relativePath, {
        type,
        relativePath,
        absolutePath,
        absoluteDir: path.dirname(absolutePath),
      });
    };

    add("npm", "package.json");
    add("composer", "composer.json");
    add("python", "pyproject.toml");
    add("python", "requirements.txt");

    for (const sub of SUBPROJECT_PATHS) {
      add("npm", path.join(sub, "package.json"));
      add("composer", path.join(sub, "composer.json"));
      add("python", path.join(sub, "pyproject.toml"));
      add("python", path.join(sub, "requirements.txt"));
    }

    this.walkForManifests(repoPath, repoPath, 0, 3, found);

    return [...found.values()];
  }

  private walkForManifests(
    repoPath: string,
    currentDir: string,
    depth: number,
    maxDepth: number,
    found: Map<
      string,
      {
        type: "npm" | "composer" | "python";
        relativePath: string;
        absolutePath: string;
        absoluteDir: string;
      }
    >,
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

      const absoluteDir = path.join(currentDir, entry.name);
      const relativePath = path.relative(repoPath, absoluteDir);

      const npmPath = path.join(relativePath, "package.json");
      const composerPath = path.join(relativePath, "composer.json");

      if (fs.existsSync(path.join(repoPath, npmPath))) {
        found.set(npmPath, {
          type: "npm",
          relativePath: npmPath,
          absolutePath: path.join(repoPath, npmPath),
          absoluteDir: path.join(repoPath, relativePath),
        });
      }

      if (fs.existsSync(path.join(repoPath, composerPath))) {
        found.set(composerPath, {
          type: "composer",
          relativePath: composerPath,
          absolutePath: path.join(repoPath, composerPath),
          absoluteDir: path.join(repoPath, relativePath),
        });
      }

      this.walkForManifests(repoPath, absoluteDir, depth + 1, maxDepth, found);
    }
  }

  private inferRole(relativeManifestPath: string): ProjectRole {
    const dir = path.dirname(relativeManifestPath).replace(/\\/g, "/").toLowerCase();
    if (dir === "." || dir === "") {
      return "any";
    }

    const segments = dir.split("/");
    const leaf = segments[segments.length - 1] ?? dir;

    if (leaf === "mobile" || leaf === "ios" || leaf === "android") {
      return "mobile";
    }

    if (leaf === "backend" || leaf === "server" || leaf === "api") {
      return "backend";
    }

    if (leaf === "web" || leaf === "frontend" || leaf === "client" || leaf === "ui") {
      return "frontend";
    }

    if (
      /(^|\/)mobile($|\/)|(^|\/)ios($|\/)|(^|\/)android($|\/)/.test(dir)
    ) {
      return "mobile";
    }
    if (
      /(^|\/)backend($|\/)|(^|\/)server($|\/)|(^|\/)api($|\/)/.test(dir)
    ) {
      return "backend";
    }
    if (
      /(^|\/)web($|\/)|(^|\/)frontend($|\/)|(^|\/)client($|\/)|(^|\/)ui($|\/)/.test(dir)
    ) {
      return "frontend";
    }

    return "any";
  }

  private detectFromPackageJson(
    projectDir: string,
    signals: StackSignals,
    role: ProjectRole,
  ): void {
    const pkgPath = path.join(projectDir, "package.json");
    const pkg = this.readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      engines?: Record<string, string>;
    }>(pkgPath);

    if (!pkg) {
      return;
    }

    const deps = this.collectDeps(pkg);
    const depText = [...deps].join(" ");

    if (pkg.engines?.node) {
      this.mergeSignal(signals, "runtime", "Node.js");
    }

    if (role === "mobile" || (role === "any" && deps.has("expo"))) {
      if (deps.has("expo") || deps.has("react-native")) {
        this.mergeSignal(signals, "frontend", "Expo / React Native");
      }
    }

    if (role !== "backend") {
      if (deps.has("next")) {
        this.mergeSignal(signals, "frontend", "Next.js");
        this.mergeSignal(signals, "framework", "Next.js");
      } else if (deps.has("nuxt") || deps.has("nuxt3")) {
        this.mergeSignal(signals, "frontend", "Nuxt");
        this.mergeSignal(signals, "framework", "Nuxt");
      } else if (deps.has("@remix-run/react") || deps.has("@remix-run/node")) {
        this.mergeSignal(signals, "frontend", "Remix");
        this.mergeSignal(signals, "framework", "Remix");
      } else if (deps.has("astro")) {
        this.mergeSignal(signals, "frontend", "Astro");
        this.mergeSignal(signals, "framework", "Astro");
      } else if (deps.has("@sveltejs/kit")) {
        this.mergeSignal(signals, "frontend", "SvelteKit");
        this.mergeSignal(signals, "framework", "SvelteKit");
      } else if (deps.has("svelte")) {
        this.mergeSignal(signals, "frontend", "Svelte");
      } else if (deps.has("vue")) {
        this.mergeSignal(signals, "frontend", "Vue");
      } else if (deps.has("@angular/core")) {
        this.mergeSignal(signals, "frontend", "Angular");
        this.mergeSignal(signals, "framework", "Angular");
      } else if (deps.has("react") || deps.has("react-dom")) {
        if (role !== "mobile") {
          this.mergeSignal(signals, "frontend", "React");
        }
      }
    }

    if (deps.has("vite") && role !== "mobile") {
      this.mergeSignal(signals, "framework", "Vite");
    }

    if (deps.has("vscode") || depText.includes("@types/vscode")) {
      this.mergeSignal(signals, "backend", "Node.js");
      this.mergeSignal(signals, "framework", "VS Code Extension");
    } else if (role === "backend" || role === "any") {
      if (deps.has("@nestjs/core")) {
        this.mergeSignal(signals, "backend", "Node.js");
        this.mergeSignal(signals, "framework", "NestJS");
      } else if (deps.has("fastify")) {
        this.mergeSignal(signals, "backend", "Node.js");
        this.mergeSignal(signals, "framework", "Fastify");
      } else if (deps.has("express")) {
        this.mergeSignal(signals, "backend", "Node.js");
        this.mergeSignal(signals, "framework", "Express");
      } else if (deps.has("hono")) {
        this.mergeSignal(signals, "backend", "Node.js");
        this.mergeSignal(signals, "framework", "Hono");
      } else if (role === "backend" && deps.has("laravel-vite-plugin")) {
        this.mergeSignal(signals, "framework", "Laravel");
      } else if (role === "any" && this.hasNodeBackendFiles(projectDir)) {
        this.mergeSignal(signals, "backend", "Node.js");
      }
    }

    if (deps.has("typescript")) {
      this.mergeSignal(signals, "language", "TypeScript");
    } else if (role !== "backend") {
      this.mergeSignal(signals, "language", "JavaScript");
    }

    if (
      !signals.runtime &&
      (signals.backend === "Node.js" || (role !== "backend" && deps.size > 0))
    ) {
      this.mergeSignal(signals, "runtime", "Node.js");
    }

    if (deps.has("prisma") || deps.has("@prisma/client")) {
      this.mergeSignal(signals, "orm", "Prisma");
    } else if (deps.has("drizzle-orm")) {
      this.mergeSignal(signals, "orm", "Drizzle");
    } else if (deps.has("typeorm")) {
      this.mergeSignal(signals, "orm", "TypeORM");
    } else if (deps.has("sequelize")) {
      this.mergeSignal(signals, "orm", "Sequelize");
    } else if (deps.has("mongoose")) {
      this.mergeSignal(signals, "orm", "Mongoose");
    } else if (deps.has("knex")) {
      this.mergeSignal(signals, "orm", "Knex");
    }

    if (deps.has("@trpc/server") || deps.has("@trpc/client")) {
      this.mergeSignal(signals, "api", "tRPC");
    } else if (deps.has("graphql") || deps.has("@apollo/server") || deps.has("apollo-server")) {
      this.mergeSignal(signals, "api", "GraphQL");
    } else if (deps.has("@grpc/grpc-js")) {
      this.mergeSignal(signals, "api", "gRPC");
    } else if (deps.has("socket.io") || deps.has("ws")) {
      this.mergeSignal(signals, "api", "WebSockets");
    } else if (deps.has("next")) {
      this.mergeSignal(signals, "api", "Server Actions");
    }

    if (deps.has("tailwindcss")) {
      this.mergeSignal(signals, "styling", "Tailwind CSS");
    } else if (deps.has("sass") || deps.has("node-sass")) {
      this.mergeSignal(signals, "styling", "Sass");
    } else if (deps.has("styled-components")) {
      this.mergeSignal(signals, "styling", "Styled Components");
    } else if (deps.has("bootstrap")) {
      this.mergeSignal(signals, "styling", "Bootstrap");
    } else if (deps.has("@mui/material")) {
      this.mergeSignal(signals, "styling", "Material UI");
    } else if (deps.has("@chakra-ui/react")) {
      this.mergeSignal(signals, "styling", "Chakra UI");
    }

    if (deps.has("@clerk/clerk-react") || deps.has("@clerk/nextjs")) {
      this.mergeSignal(signals, "auth", "Clerk");
    } else if (deps.has("next-auth") || deps.has("@auth/core")) {
      this.mergeSignal(signals, "auth", "NextAuth / Auth.js");
    } else if (deps.has("@auth0/nextjs-auth0")) {
      this.mergeSignal(signals, "auth", "Auth0");
    } else if (deps.has("passport") || deps.has("passport-local")) {
      this.mergeSignal(signals, "auth", "Passport.js");
    } else if (deps.has("firebase") || deps.has("firebase-admin")) {
      this.mergeSignal(signals, "auth", "Firebase Auth");
    }

    if (deps.has("@supabase/supabase-js")) {
      this.mergeSignal(signals, "database", "Supabase (Postgres)");
      this.mergeSignal(signals, "auth", "Supabase Auth");
    }

    if (deps.has("pg") || deps.has("postgres")) {
      this.mergeSignal(signals, "database", "PostgreSQL");
    } else if (deps.has("mysql2") || deps.has("mysql")) {
      this.mergeSignal(signals, "database", "MySQL");
    } else if (deps.has("better-sqlite3") || deps.has("sqlite3")) {
      this.mergeSignal(signals, "database", "SQLite");
    } else if (deps.has("mongodb")) {
      this.mergeSignal(signals, "database", "MongoDB");
    } else if (deps.has("ioredis") || deps.has("redis")) {
      this.mergeSignal(signals, "database", "Redis");
    }

    if (deps.has("vitest")) {
      this.mergeSignal(signals, "testing", "Vitest");
    } else if (deps.has("jest") || deps.has("@jest/globals")) {
      this.mergeSignal(signals, "testing", "Jest");
    } else if (deps.has("playwright") || deps.has("@playwright/test")) {
      this.mergeSignal(signals, "testing", "Playwright");
    } else if (deps.has("cypress")) {
      this.mergeSignal(signals, "testing", "Cypress");
    }
  }

  private detectFromComposerJson(composerPath: string, signals: StackSignals): void {
    const composer = this.readJson<{
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
    }>(composerPath);

    if (!composer) {
      return;
    }

    const req = {
      ...composer.require,
      ...composer["require-dev"],
    };
    const text = JSON.stringify(req).toLowerCase();

    if (text.includes("laravel/framework")) {
      this.mergeSignal(signals, "backend", "PHP");
      this.mergeSignal(signals, "language", "PHP");
      this.mergeSignal(signals, "framework", "Laravel");
      this.mergeSignal(signals, "api", "REST");
    } else if (text.includes("symfony/")) {
      this.mergeSignal(signals, "backend", "PHP");
      this.mergeSignal(signals, "language", "PHP");
      this.mergeSignal(signals, "framework", "Symfony");
    }

    if (text.includes("phpunit/phpunit")) {
      this.mergeSignal(signals, "testing", "PHPUnit");
    }
  }

  private detectFromPython(projectDir: string, signals: StackSignals): void {
    this.mergeSignal(signals, "backend", "Python");
    this.mergeSignal(signals, "language", "Python");
    this.mergeSignal(signals, "runtime", "Python 3");

    const reqPath = fs.existsSync(path.join(projectDir, "requirements.txt"))
      ? path.join(projectDir, "requirements.txt")
      : path.join(projectDir, "pyproject.toml");
    const text = this.readText(reqPath)?.toLowerCase() ?? "";

    if (text.includes("django")) {
      this.mergeSignal(signals, "framework", "Django");
      this.mergeSignal(signals, "orm", "Django ORM");
    } else if (text.includes("fastapi")) {
      this.mergeSignal(signals, "framework", "FastAPI");
    } else if (text.includes("flask")) {
      this.mergeSignal(signals, "framework", "Flask");
    }

    if (text.includes("sqlalchemy")) {
      this.mergeSignal(signals, "orm", "SQLAlchemy");
    }
    if (text.includes("pytest")) {
      this.mergeSignal(signals, "testing", "pytest");
    }
    if (text.includes("psycopg") || text.includes("postgresql")) {
      this.mergeSignal(signals, "database", "PostgreSQL");
    }
    if (text.includes("pymongo") || text.includes("mongodb")) {
      this.mergeSignal(signals, "database", "MongoDB");
    }
  }

  private detectFromGo(signals: StackSignals): void {
    this.mergeSignal(signals, "backend", "Go");
    this.mergeSignal(signals, "language", "Go");
    this.mergeSignal(signals, "framework", "Gin");
    this.mergeSignal(signals, "testing", "Go test");
  }

  private detectFromRust(signals: StackSignals): void {
    this.mergeSignal(signals, "backend", "Rust");
    this.mergeSignal(signals, "language", "Rust");
    this.mergeSignal(signals, "framework", "Actix");
  }

  private detectFromRuby(signals: StackSignals): void {
    this.mergeSignal(signals, "backend", "Ruby");
    this.mergeSignal(signals, "language", "Ruby");
    this.mergeSignal(signals, "framework", "Rails");
    this.mergeSignal(signals, "orm", "ActiveRecord");
    this.mergeSignal(signals, "testing", "RSpec");
  }

  private detectFromDockerCompose(repoPath: string, signals: StackSignals): void {
    const file = this.fileExists(repoPath, "docker-compose.yml")
      ? path.join(repoPath, "docker-compose.yml")
      : path.join(repoPath, "docker-compose.yaml");
    const text = this.readText(file)?.toLowerCase() ?? "";

    if (text.includes("postgres")) {
      this.mergeSignal(signals, "database", "PostgreSQL");
    } else if (text.includes("mysql") || text.includes("mariadb")) {
      this.mergeSignal(signals, "database", "MySQL");
    } else if (text.includes("mongo")) {
      this.mergeSignal(signals, "database", "MongoDB");
    } else if (text.includes("redis")) {
      this.mergeSignal(signals, "database", "Redis");
    }

    this.mergeSignal(signals, "runtime", "Docker");
  }

  private detectHostingHints(
    repoPath: string,
    signals: StackSignals,
    sources: string[],
  ): void {
    if (this.fileExists(repoPath, "vercel.json")) {
      sources.push("vercel.json");
      this.mergeSignal(signals, "hosting", "Vercel");
    }
    if (this.fileExists(repoPath, "netlify.toml")) {
      sources.push("netlify.toml");
      this.mergeSignal(signals, "hosting", "Netlify");
    }
    if (this.fileExists(repoPath, "fly.toml")) {
      sources.push("fly.toml");
      this.mergeSignal(signals, "hosting", "Fly.io");
    }
    if (this.fileExists(repoPath, "railway.json") || this.fileExists(repoPath, "railway.toml")) {
      sources.push("railway config");
      this.mergeSignal(signals, "hosting", "Railway");
    }
    if (this.fileExists(repoPath, "render.yaml")) {
      sources.push("render.yaml");
      this.mergeSignal(signals, "hosting", "Render");
    }
  }

  private hasNodeBackendFiles(projectDir: string): boolean {
    return (
      fs.existsSync(path.join(projectDir, "package.json")) &&
      (this.dirExists(path.join(projectDir, "src")) ||
        this.dirExists(path.join(projectDir, "server")) ||
        this.dirExists(path.join(projectDir, "api")))
    );
  }

  private mergeSignal(
    signals: StackSignals,
    key: StackFieldKey,
    value: string,
  ): void {
    const next = value.trim();
    if (!next) {
      return;
    }

    const current = signals[key]?.trim();
    if (!current) {
      signals[key] = next;
      return;
    }

    if (current === next) {
      return;
    }

    const parts = current.split(" · ").map((part) => part.trim());
    if (parts.includes(next)) {
      return;
    }

    signals[key] = `${current} · ${next}`;
  }

  private collectDeps(pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  }): Set<string> {
    const keys = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    return new Set(keys.map((key) => key.toLowerCase()));
  }

  private toWorkspaceStack(signals: StackSignals): WorkspaceStack {
    const stack: WorkspaceStack = {};
    for (const field of STACK_FIELD_DEFINITIONS) {
      stack[field.key] = signals[field.key]?.trim() || null;
    }
    return stack;
  }

  private fileExists(repoPath: string, relative: string): boolean {
    return fs.existsSync(path.join(repoPath, relative));
  }

  private dirExists(dirPath: string): boolean {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private readJson<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
      return null;
    }
  }

  private readText(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }
}
