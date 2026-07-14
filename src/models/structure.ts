export type StructureServiceKind =
  | "web"
  | "backend"
  | "mobile"
  | "extension"
  | "lib"
  | "tooling"
  | "other";

export type StructureLayout =
  | "monolith"
  | "monorepo"
  | "multi-service"
  | "unknown";

export type StructureContractStatus = "draft" | "locked";

export interface StructureService {
  id: string;
  name: string;
  root: string;
  kind: StructureServiceKind;
  manifests: string[];
  expectedPaths: string[];
  conventions: string[];
  libraries: string[];
}

export interface StructureDriftItem {
  serviceId: string | null;
  path: string;
  issue: "missing_root" | "missing_path" | "missing_ci";
  message: string;
}

export interface StructureContract {
  version: 1;
  status: StructureContractStatus;
  detectedAt: string;
  lockedAt: string | null;
  sources: string[];
  layout: StructureLayout;
  services: StructureService[];
  ciPaths: string[];
  notes: string;
}

export interface StructureValidation {
  ok: boolean;
  drift: StructureDriftItem[];
  summary: string;
}

export function emptyStructureContract(
  partial?: Partial<StructureContract>,
): StructureContract {
  return {
    version: 1,
    status: "draft",
    detectedAt: new Date().toISOString(),
    lockedAt: null,
    sources: [],
    layout: "unknown",
    services: [],
    ciPaths: [],
    notes: "",
    ...partial,
  };
}

export function normalizeStructure(
  input: StructureContract | null | undefined,
): StructureContract | null {
  if (!input) {
    return null;
  }

  return {
    version: 1,
    status: input.status === "locked" ? "locked" : "draft",
    detectedAt: input.detectedAt || new Date().toISOString(),
    lockedAt: input.lockedAt ?? null,
    sources: [...(input.sources ?? [])],
    layout: input.layout ?? "unknown",
    services: (input.services ?? []).map((service) => ({
      id: service.id,
      name: service.name,
      root: normalizeRoot(service.root),
      kind: service.kind,
      manifests: [...(service.manifests ?? [])],
      expectedPaths: [...(service.expectedPaths ?? [])],
      conventions: [...(service.conventions ?? [])],
      libraries: [...(service.libraries ?? [])],
    })),
    ciPaths: [...(input.ciPaths ?? [])],
    notes: input.notes?.trim() ?? "",
  };
}

export function normalizeRoot(root: string): string {
  const trimmed = root.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!trimmed || trimmed === ".") {
    return ".";
  }
  return trimmed.replace(/\/+$/, "");
}

export function structuresEqual(
  a: StructureContract | null | undefined,
  b: StructureContract | null | undefined,
): boolean {
  return JSON.stringify(normalizeStructure(a)) === JSON.stringify(normalizeStructure(b));
}

export function structureHasServices(
  structure: StructureContract | null | undefined,
): boolean {
  return Boolean(structure?.services?.length);
}

export function formatStructureForArchitecture(
  structure: StructureContract,
): string {
  const status =
    structure.status === "locked"
      ? `Locked${structure.lockedAt ? ` (${structure.lockedAt.slice(0, 10)})` : ""}`
      : "Draft — detect from repo, then Lock to enforce";

  const serviceLines =
    structure.services.length > 0
      ? structure.services
          .map((service) => {
            const libs =
              service.libraries.length > 0
                ? `\n  - Libraries: ${service.libraries.slice(0, 8).join(", ")}`
                : "";
            const expected =
              service.expectedPaths.length > 0
                ? `\n  - Expected: ${service.expectedPaths.map((p) => `\`${p}\``).join(", ")}`
                : "";
            const conventions =
              service.conventions.length > 0
                ? `\n  - Conventions: ${service.conventions.join("; ")}`
                : "";
            return `- **${service.name}** (\`${service.root}/\`, ${service.kind})${expected}${libs}${conventions}`;
          })
          .join("\n")
      : "- _No services detected yet_";

  const ci =
    structure.ciPaths.length > 0
      ? structure.ciPaths.map((p) => `- \`${p}\``).join("\n")
      : "- _None detected_";

  const notes = structure.notes.trim()
    ? `\n## Notes\n\n${structure.notes.trim()}\n`
    : "";

  return `## Structure

**Status:** ${status}
**Layout:** ${structure.layout}
**Sources:** ${structure.sources.length > 0 ? structure.sources.join(", ") : "_n/a_"}

### Services

${serviceLines}

### CI / workflows

${ci}
${notes}`;
}

export function formatStructureBridgeBody(structure: StructureContract): string {
  const services = structure.services
    .map(
      (s) =>
        `- **${s.name}** — root \`${s.root}/\` (${s.kind})` +
        (s.expectedPaths.length
          ? `\n  - Keep paths: ${s.expectedPaths.map((p) => `\`${p}\``).join(", ")}`
          : "") +
        (s.conventions.length
          ? `\n  - Conventions: ${s.conventions.join("; ")}`
          : ""),
    )
    .join("\n");

  const ci =
    structure.ciPaths.length > 0
      ? structure.ciPaths.map((p) => `- \`${p}\``).join("\n")
      : "- _(none)_";

  return `# Structure Contract (locked)

**Layout:** ${structure.layout}
**Locked:** ${structure.lockedAt ?? "yes"}

This workspace has a durable structure contract. Treat it as source of truth for where code belongs.

## Services

${services || "- _(none)_"}

## CI / workflows

${ci}

## Rules for agents

1. Read \`.strata/workspace.json\` → \`structure\` and \`.strata/memory/architecture.md\` → Structure.
2. Put new code under the matching service root — do not invent parallel top-level apps.
3. Respect \`expectedPaths\` and conventions per service.
4. If the repo shape has drifted from this contract, stop and ask the user to re-detect / re-lock in Strata rather than inventing a new layout.
5. Leave generation to the editor agent; Strata only enforces the contract.
`;
}
