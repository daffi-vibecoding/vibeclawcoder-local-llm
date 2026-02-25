import type { Project } from "./projects.js";

export function getProjectOwnerAgentId(project: Project): string | undefined {
  if (project.ownerAgentId && project.ownerAgentId.trim()) {
    return project.ownerAgentId.trim();
  }

  const owners = Array.from(
    new Set(
      (project.channels ?? [])
        .map((c) => c.accountId?.trim())
        .filter((v): v is string => !!v),
    ),
  );
  return owners.length === 1 ? owners[0] : undefined;
}

export function projectOwnedByAgent(project: Project, agentId?: string): boolean {
  if (!agentId) return true;
  const owner = getProjectOwnerAgentId(project);
  // Backward compatibility for legacy configs with no explicit owner.
  if (!owner) return true;
  return owner === agentId;
}

export function assertProjectOwnedByAgent(
  project: Project,
  agentId: string | undefined,
  action: string,
): void {
  if (projectOwnedByAgent(project, agentId)) return;
  const owner = getProjectOwnerAgentId(project) ?? "unassigned";
  throw new Error(
    `${action} blocked: project "${project.slug}" is owned by agent "${owner}", ` +
    `current agent is "${agentId ?? "unknown"}".`,
  );
}
