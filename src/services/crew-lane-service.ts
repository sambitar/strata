import type {
  CrewLane,
  CrewLaneRole,
  CrewPhase,
  Workspace,
  WorkspaceStack,
} from "../models/workspace";
import type { StructureService } from "../models/structure";

const ROLE_HINTS: Record<
  "frontend" | "backend" | "database",
  { title: string; hint: string }
> = {
  frontend: {
    title: "Frontend",
    hint: "UI, components, client-side routing/state. Do not change API contracts or schema.",
  },
  backend: {
    title: "Backend / API",
    hint: "Server routes, handlers, business logic against the locked contract. Do not change UI or schema ownership.",
  },
  database: {
    title: "Database",
    hint: "Schema, migrations, and data access only. Do not change UI or invent API shapes outside the contract.",
  },
};

function isStackValueSet(value: string | null | undefined): boolean {
  if (value == null) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return lower !== "none" && lower !== "none (static only)" && lower !== "decide later";
}

function nonToolingServices(services: StructureService[]): StructureService[] {
  return services.filter((service) => service.kind !== "tooling");
}

function makeLane(input: {
  id: string;
  role: CrewLaneRole;
  title: string;
  root: string;
  serviceId?: string;
  expectedPaths?: string[];
  conventions?: string[];
  promptHint?: string;
  status?: CrewLane["status"];
}): CrewLane {
  return {
    id: input.id,
    role: input.role,
    title: input.title,
    root: input.root,
    serviceId: input.serviceId,
    expectedPaths: input.expectedPaths ?? [],
    conventions: input.conventions ?? [],
    status: input.status ?? "pending",
    promptHint: input.promptHint,
  };
}

function roleLanesFromStack(
  service: StructureService,
  stack: WorkspaceStack | null | undefined,
): CrewLane[] {
  const roles: Array<"frontend" | "backend" | "database"> = [
    "frontend",
    "backend",
    "database",
  ];
  const lanes: CrewLane[] = [];

  for (const role of roles) {
    if (!isStackValueSet(stack?.[role])) {
      continue;
    }
    const meta = ROLE_HINTS[role];
    lanes.push(
      makeLane({
        id: `role-${role}`,
        role,
        title: meta.title,
        root: service.root,
        serviceId: service.id,
        expectedPaths: service.expectedPaths,
        conventions: service.conventions,
        promptHint: `${meta.hint} Stack signal: ${stack?.[role]}.`,
      }),
    );
  }

  return lanes;
}

function serviceLane(service: StructureService): CrewLane {
  return makeLane({
    id: `svc-${service.id}`,
    role: "service",
    title: service.name,
    root: service.root,
    serviceId: service.id,
    expectedPaths: service.expectedPaths,
    conventions: service.conventions,
    promptHint: `Implement only under \`${service.root}\` for service kind \`${service.kind}\`.`,
  });
}

/**
 * Derive planner → specialist → integrator lanes from the locked structure
 * contract (and stack role fields for single-service monoliths).
 */
export class CrewLaneService {
  deriveLanes(workspace: Workspace): CrewLane[] {
    const structure = workspace.structure;
    if (!structure || structure.status !== "locked") {
      throw new Error(
        "Lock a Structure Contract before starting a multi-agent crew.",
      );
    }

    const specialists = nonToolingServices(structure.services);
    if (specialists.length === 0) {
      throw new Error(
        "Structure contract has no non-tooling services to assign crew lanes.",
      );
    }

    const planner = makeLane({
      id: "planner",
      role: "planner",
      title: "Planner",
      root: ".",
      status: "pending",
      promptHint:
        "Fill `.strata/crew/contract.md` only. Do not implement product features.",
    });

    const integrator = makeLane({
      id: "integrator",
      role: "integrator",
      title: "Integrator",
      root: ".",
      status: "pending",
      promptHint:
        "Merge specialist work, wire integration points, run verification.",
    });

    let specialtyLanes: CrewLane[];

    const layout = structure.layout;
    const isMonolithSingle =
      (layout === "monolith" || layout === "unknown") &&
      specialists.length === 1;

    if (isMonolithSingle) {
      const only = specialists[0]!;
      const roles = roleLanesFromStack(only, workspace.stack);
      specialtyLanes = roles.length > 0 ? roles : [serviceLane(only)];
    } else {
      specialtyLanes = specialists.map(serviceLane);
    }

    return [planner, ...specialtyLanes, integrator];
  }

  /** Recompute mission phase from lane statuses. */
  derivePhase(lanes: CrewLane[]): CrewPhase {
    const planner = lanes.find((lane) => lane.role === "planner");
    const integrator = lanes.find((lane) => lane.role === "integrator");
    const specialists = lanes.filter(
      (lane) => lane.role !== "planner" && lane.role !== "integrator",
    );

    if (integrator?.status === "done") {
      return "done";
    }
    if (
      specialists.length > 0 &&
      specialists.every((lane) => lane.status === "done")
    ) {
      return "integrate";
    }
    if (planner?.status === "done") {
      return "parallel";
    }
    return "plan";
  }

  formatLanesTable(lanes: CrewLane[]): string {
    const header =
      "| Lane | Role | Root | Status |\n| --- | --- | --- | --- |";
    const rows = lanes.map(
      (lane) =>
        `| ${lane.title} | \`${lane.role}\` | \`${lane.root}\` | ${lane.status} |`,
    );
    return [header, ...rows].join("\n");
  }

  formatLaneList(lanes: CrewLane[]): string {
    return lanes
      .map((lane) => {
        const paths =
          lane.expectedPaths && lane.expectedPaths.length > 0
            ? lane.expectedPaths.map((p) => `\`${p}\``).join(", ")
            : "_none_";
        const conventions =
          lane.conventions && lane.conventions.length > 0
            ? lane.conventions.map((c) => `- ${c}`).join("\n")
            : "_none_";
        return (
          `### ${lane.title} (\`${lane.id}\`)\n` +
          `- **Role:** ${lane.role}\n` +
          `- **Root:** \`${lane.root}\`\n` +
          `- **Status:** ${lane.status}\n` +
          `- **Expected paths:** ${paths}\n` +
          `- **Conventions:**\n${conventions}\n` +
          (lane.promptHint ? `- **Hint:** ${lane.promptHint}\n` : "")
        );
      })
      .join("\n");
  }
}
