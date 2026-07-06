export type StackFieldKey =
  | "frontend"
  | "backend"
  | "framework"
  | "language"
  | "runtime"
  | "database"
  | "orm"
  | "api"
  | "styling"
  | "auth"
  | "hosting"
  | "testing";

export type WorkspaceStack = Partial<Record<StackFieldKey, string | null>>;

export interface StackFieldDefinition {
  key: StackFieldKey;
  label: string;
  placeholder: string;
  options: string[];
}

export const STACK_FIELD_DEFINITIONS: StackFieldDefinition[] = [
  {
    key: "frontend",
    label: "Frontend",
    placeholder: "Decide later",
    options: [
      "React",
      "Next.js",
      "Vue",
      "Nuxt",
      "Angular",
      "Svelte",
      "SvelteKit",
      "Remix",
      "Astro",
      "SolidJS",
      "Qwik",
      "Vanilla JS",
      "None",
    ],
  },
  {
    key: "backend",
    label: "Backend",
    placeholder: "Decide later",
    options: [
      "Node.js",
      "Python",
      "Go",
      "Rust",
      "Java",
      "Kotlin",
      "Ruby",
      "PHP",
      "C# / .NET",
      "Elixir",
      "None (static only)",
    ],
  },
  {
    key: "framework",
    label: "Framework",
    placeholder: "Decide later",
    options: [
      "Express",
      "Fastify",
      "NestJS",
      "Hono",
      "Django",
      "FastAPI",
      "Flask",
      "Rails",
      "Spring Boot",
      "Laravel",
      "ASP.NET Core",
      "Phoenix",
      "Gin",
      "Actix",
    ],
  },
  {
    key: "language",
    label: "Language",
    placeholder: "Decide later",
    options: [
      "TypeScript",
      "JavaScript",
      "Python",
      "Go",
      "Rust",
      "Java",
      "Kotlin",
      "Ruby",
      "PHP",
      "C#",
      "Elixir",
      "Swift",
    ],
  },
  {
    key: "runtime",
    label: "Runtime",
    placeholder: "Decide later",
    options: [
      "Node.js",
      "Bun",
      "Deno",
      "Python 3",
      "JVM",
      "BEAM (Erlang/Elixir)",
      "Docker",
      "Serverless",
    ],
  },
  {
    key: "database",
    label: "Database",
    placeholder: "Decide later",
    options: [
      "PostgreSQL",
      "MySQL",
      "SQLite",
      "MongoDB",
      "Redis",
      "Supabase (Postgres)",
      "PlanetScale (MySQL)",
      "DynamoDB",
      "Firebase Firestore",
      "None",
    ],
  },
  {
    key: "orm",
    label: "ORM / Data",
    placeholder: "Decide later",
    options: [
      "Prisma",
      "Drizzle",
      "TypeORM",
      "Sequelize",
      "SQLAlchemy",
      "Django ORM",
      "ActiveRecord",
      "Mongoose",
      "Knex",
      "Raw SQL",
      "None",
    ],
  },
  {
    key: "api",
    label: "API style",
    placeholder: "Decide later",
    options: [
      "REST",
      "GraphQL",
      "tRPC",
      "gRPC",
      "WebSockets",
      "Server Actions",
      "None",
    ],
  },
  {
    key: "styling",
    label: "Styling",
    placeholder: "Decide later",
    options: [
      "Tailwind CSS",
      "CSS Modules",
      "Styled Components",
      "Sass",
      "Vanilla CSS",
      "Bootstrap",
      "Material UI",
      "Chakra UI",
      "shadcn/ui",
      "None",
    ],
  },
  {
    key: "auth",
    label: "Auth",
    placeholder: "Decide later",
    options: [
      "Clerk",
      "Auth0",
      "Supabase Auth",
      "Firebase Auth",
      "NextAuth / Auth.js",
      "Passport.js",
      "Devise",
      "Custom JWT",
      "None",
    ],
  },
  {
    key: "hosting",
    label: "Hosting",
    placeholder: "Decide later",
    options: [
      "Vercel",
      "Netlify",
      "AWS",
      "Google Cloud",
      "Azure",
      "Fly.io",
      "Railway",
      "Render",
      "DigitalOcean",
      "Self-hosted",
      "Undecided",
    ],
  },
  {
    key: "testing",
    label: "Testing",
    placeholder: "Decide later",
    options: [
      "Vitest",
      "Jest",
      "Playwright",
      "Cypress",
      "pytest",
      "RSpec",
      "Go test",
      "None yet",
    ],
  },
];

export function normalizeStack(input: WorkspaceStack): WorkspaceStack {
  const result: WorkspaceStack = {};
  for (const field of STACK_FIELD_DEFINITIONS) {
    const raw = input[field.key];
    const trimmed = raw?.trim();
    result[field.key] = trimmed ? trimmed : null;
  }
  return result;
}

export function mergeStackFill(
  saved: WorkspaceStack | null | undefined,
  detected: WorkspaceStack,
): WorkspaceStack {
  const result: WorkspaceStack = {};
  for (const field of STACK_FIELD_DEFINITIONS) {
    const savedVal = saved?.[field.key]?.trim();
    const detectedVal = detected[field.key]?.trim();
    result[field.key] = savedVal || detectedVal || null;
  }
  return result;
}

export function mergeStackOverwrite(detected: WorkspaceStack): WorkspaceStack {
  return normalizeStack(detected);
}

export function stacksEqual(
  a: WorkspaceStack | null | undefined,
  b: WorkspaceStack | null | undefined,
): boolean {
  for (const field of STACK_FIELD_DEFINITIONS) {
    const av = a?.[field.key]?.trim() ?? null;
    const bv = b?.[field.key]?.trim() ?? null;
    if (av !== bv) {
      return false;
    }
  }
  return true;
}

export function stackFieldSources(
  saved: WorkspaceStack | null | undefined,
  detected: WorkspaceStack,
): Partial<Record<StackFieldKey, "saved" | "detected">> {
  const sources: Partial<Record<StackFieldKey, "saved" | "detected">> = {};
  for (const field of STACK_FIELD_DEFINITIONS) {
    const savedVal = saved?.[field.key]?.trim();
    const detectedVal = detected[field.key]?.trim();
    if (savedVal) {
      sources[field.key] = "saved";
    } else if (detectedVal) {
      sources[field.key] = "detected";
    }
  }
  return sources;
}

export function stackHasValues(stack: WorkspaceStack | null | undefined): boolean {
  if (!stack) {
    return false;
  }
  return STACK_FIELD_DEFINITIONS.some((field) => Boolean(stack[field.key]?.trim()));
}

export function formatStackForArchitecture(stack: WorkspaceStack): string {
  const lines = STACK_FIELD_DEFINITIONS.map((field) => {
    const value = stack[field.key]?.trim();
    return `- **${field.label}:** ${value || "_Decide during development_"}`;
  });
  return `## Stack\n\n${lines.join("\n")}\n`;
}
