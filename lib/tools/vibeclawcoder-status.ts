import fs from "node:fs";
import path from "node:path";
import { jsonResult } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ToolContext } from "../types.js";
import { readProjects, resolveRepoPath, type Project } from "../projects.js";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { runCommand } from "../run-command.js";
import { createProvider } from "../providers/index.js";
import { loadWorkflow, StateType } from "../workflow.js";
import { getProjectOwnerAgentId } from "../ownership.js";

type Scope = "all_agents" | "current_agent" | "project";

type AgentRef = { agentId: string; workspace: string };

type ProjectStatus = {
  agentId: string;
  workspace: string;
  projectSlug: string;
  projectName: string;
  ownerAgentId: string | null;
  ownerMatchesAgent: boolean;
  repo: string;
  branch: string | null;
  dirtyFileCount: number | null;
  openPrCount: number | null;
  queue: {
    doing: number | null;
    todo: number | null;
    refining: number | null;
  };
  activeWorkers: Array<{ role: string; level: string; issueId: number; slotIndex: number; sessionKey: string | null }>;
};

type Snapshot = {
  generatedAt: string;
  scope: Scope;
  projectFilter: string | null;
  projects: ProjectStatus[];
};

function hasProjects(workspace: string): boolean {
  return (
    fs.existsSync(path.join(workspace, DATA_DIR, "projects.json")) ||
    fs.existsSync(path.join(workspace, "projects.json")) ||
    fs.existsSync(path.join(workspace, "projects", "projects.json"))
  );
}

function discoverAgents(config: {
  agents?: {
    list?: Array<{ id: string; workspace?: string }>;
    defaults?: { workspace?: string };
  };
}): AgentRef[] {
  const seen = new Set<string>();
  const out: AgentRef[] = [];
  for (const a of config.agents?.list || []) {
    if (!a.workspace) continue;
    if (!hasProjects(a.workspace)) continue;
    if (seen.has(a.workspace)) continue;
    seen.add(a.workspace);
    out.push({ agentId: a.id, workspace: a.workspace });
  }
  const def = config.agents?.defaults?.workspace;
  if (def && !seen.has(def) && hasProjects(def)) {
    out.push({ agentId: "main", workspace: def });
  }
  return out;
}

function parseRepoSlug(remote: string | undefined): string | null {
  if (!remote) return null;
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

async function safeBranchAndDirty(repoPath: string): Promise<{ branch: string | null; dirtyFileCount: number | null }> {
  try {
    const branch = (await runCommand(["git", "branch", "--show-current"], { cwd: repoPath, timeoutMs: 8_000 })).stdout.trim() || null;
    const status = (await runCommand(["git", "status", "--porcelain"], { cwd: repoPath, timeoutMs: 8_000 })).stdout;
    const dirtyFileCount = status.split("\n").filter((l) => l.trim()).length;
    return { branch, dirtyFileCount };
  } catch {
    return { branch: null, dirtyFileCount: null };
  }
}

async function safeOpenPrCount(project: Project): Promise<number | null> {
  const repoPath = resolveRepoPath(project.repo);
  let repoSlug = parseRepoSlug(project.repoRemote);
  if (!repoSlug) {
    try {
      const remote = (await runCommand(["git", "remote", "get-url", "origin"], { cwd: repoPath, timeoutMs: 8_000 })).stdout.trim();
      repoSlug = parseRepoSlug(remote);
    } catch {
      repoSlug = null;
    }
  }
  if (!repoSlug) return null;
  try {
    const out = await runCommand(["gh", "pr", "list", "--repo", repoSlug, "--state", "open", "--json", "number"], {
      cwd: repoPath,
      timeoutMs: 12_000,
    });
    const rows = JSON.parse(out.stdout || "[]") as Array<{ number: number }>;
    return rows.length;
  } catch {
    return null;
  }
}

async function safeQueueCounts(workspaceDir: string, project: Project): Promise<{ doing: number | null; todo: number | null; refining: number | null }> {
  try {
    const { provider } = await createProvider({ repo: project.repo, provider: project.provider });
    const workflow = await loadWorkflow(workspaceDir, project.name);

    let doing = 0;
    let todo = 0;
    let refining = 0;
    for (const state of Object.values(workflow.states)) {
      const issues = await provider.listIssues({
        label: state.label,
        state: state.type === StateType.TERMINAL ? "closed" : "open",
      }).catch(() => []);

      if (state.type === StateType.ACTIVE) {
        doing += issues.length;
        continue;
      }
      if (state.type !== StateType.QUEUE) continue;
      const label = state.label.toLowerCase();
      if (label.includes("refin") || label.includes("improv")) {
        refining += issues.length;
      } else {
        todo += issues.length;
      }
    }
    return { doing, todo, refining };
  } catch {
    return { doing: null, todo: null, refining: null };
  }
}

function collectActiveWorkers(project: Project): ProjectStatus["activeWorkers"] {
  const out: ProjectStatus["activeWorkers"] = [];
  for (const [role, roleState] of Object.entries(project.workers ?? {})) {
    for (const [level, slots] of Object.entries(roleState.levels ?? {})) {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        if (!slot.active || !slot.issueId) continue;
        out.push({
          role,
          level,
          issueId: Number(slot.issueId),
          slotIndex: i,
          sessionKey: slot.sessionKey ?? null,
        });
      }
    }
  }
  return out;
}

function snapshotPath(scope: Scope, projectFilter: string | null): string {
  const safeScope = scope.replace(/[^a-z_]/gi, "_");
  const safeProject = (projectFilter ?? "all").replace(/[^a-z0-9_-]/gi, "_");
  return path.join(process.env.HOME || "", ".openclaw", "vibeclawcoder-status", `${safeScope}-${safeProject}.json`);
}

function ensureSnapshotDir(scope: Scope, projectFilter: string | null): void {
  fs.mkdirSync(path.dirname(snapshotPath(scope, projectFilter)), { recursive: true });
}

function readPreviousSnapshot(scope: Scope, projectFilter: string | null): Snapshot | null {
  try {
    const raw = fs.readFileSync(snapshotPath(scope, projectFilter), "utf-8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: Snapshot): void {
  ensureSnapshotDir(snapshot.scope, snapshot.projectFilter);
  fs.writeFileSync(snapshotPath(snapshot.scope, snapshot.projectFilter), JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

function diffSnapshots(current: Snapshot, previous: Snapshot | null): Record<string, unknown> {
  if (!previous) return { note: "No previous status snapshot found." };

  const key = (p: ProjectStatus) => `${p.agentId}:${p.projectSlug}`;
  const currMap = new Map(current.projects.map((p) => [key(p), p]));
  const prevMap = new Map(previous.projects.map((p) => [key(p), p]));

  const addedProjects = Array.from(currMap.keys()).filter((k) => !prevMap.has(k));
  const removedProjects = Array.from(prevMap.keys()).filter((k) => !currMap.has(k));

  const changed: Array<{
    project: string;
    dirtyDelta: number | null;
    activeIssuesAdded: number[];
    activeIssuesRemoved: number[];
    doingDelta: number | null;
  }> = [];

  for (const [k, curr] of currMap.entries()) {
    const prev = prevMap.get(k);
    if (!prev) continue;
    const currIssues = new Set(curr.activeWorkers.map((w) => w.issueId));
    const prevIssues = new Set(prev.activeWorkers.map((w) => w.issueId));
    const activeIssuesAdded = [...currIssues].filter((x) => !prevIssues.has(x)).sort((a, b) => a - b);
    const activeIssuesRemoved = [...prevIssues].filter((x) => !currIssues.has(x)).sort((a, b) => a - b);
    const dirtyDelta =
      curr.dirtyFileCount === null || prev.dirtyFileCount === null
        ? null
        : curr.dirtyFileCount - prev.dirtyFileCount;
    const doingDelta =
      curr.queue.doing === null || prev.queue.doing === null
        ? null
        : curr.queue.doing - prev.queue.doing;

    if (activeIssuesAdded.length || activeIssuesRemoved.length || dirtyDelta || doingDelta) {
      changed.push({
        project: k,
        dirtyDelta,
        activeIssuesAdded,
        activeIssuesRemoved,
        doingDelta,
      });
    }
  }

  return { addedProjects, removedProjects, changed };
}

export function createVibeClawCoderStatusTool(api: OpenClawPluginApi) {
  return (ctx: ToolContext) => ({
    name: "vibeclawcoder_status",
    label: "VibeClawCoder Status",
    description: "Global status across active VibeClawCoder agents/projects, including ownership and deltas since last snapshot.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all_agents", "current_agent", "project"],
          description: "Status scope. Defaults to all_agents.",
        },
        projectSlug: { type: "string", description: "Required when scope=project." },
        saveSnapshot: { type: "boolean", description: "Persist status snapshot for next diff. Defaults true." },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const scope = (params.scope as Scope | undefined) ?? "all_agents";
      const projectSlug = (params.projectSlug as string | undefined) ?? null;
      const saveSnapshot = (params.saveSnapshot as boolean | undefined) ?? true;

      if (scope === "project" && !projectSlug) {
        throw new Error("projectSlug is required when scope=project");
      }

      const agentRefs: AgentRef[] =
        scope === "current_agent"
          ? ctx.workspaceDir
            ? [{ agentId: ctx.agentId ?? "unknown", workspace: ctx.workspaceDir }]
            : []
          : discoverAgents(api.config);

      const projects: ProjectStatus[] = [];
      for (const { agentId, workspace } of agentRefs) {
        let data: Awaited<ReturnType<typeof readProjects>>;
        try {
          data = await readProjects(workspace);
        } catch {
          continue;
        }

        for (const project of Object.values(data.projects) as Project[]) {
          if (projectSlug && project.slug !== projectSlug) continue;
          const ownerAgentId = getProjectOwnerAgentId(project) ?? null;
          const ownerMatchesAgent = !ownerAgentId || ownerAgentId === agentId;
          const repoPath = resolveRepoPath(project.repo);
          const git = await safeBranchAndDirty(repoPath);
          const openPrCount = await safeOpenPrCount(project);
          const queue = await safeQueueCounts(workspace, project);
          const activeWorkers = collectActiveWorkers(project);

          projects.push({
            agentId,
            workspace,
            projectSlug: project.slug,
            projectName: project.name,
            ownerAgentId,
            ownerMatchesAgent,
            repo: project.repo,
            branch: git.branch,
            dirtyFileCount: git.dirtyFileCount,
            openPrCount,
            queue,
            activeWorkers,
          });
        }
      }

      const snapshot: Snapshot = {
        generatedAt: new Date().toISOString(),
        scope,
        projectFilter: projectSlug,
        projects,
      };
      const previous = readPreviousSnapshot(scope, projectSlug);
      const delta = diffSnapshots(snapshot, previous);
      if (saveSnapshot) writeSnapshot(snapshot);

      const ownerMismatches = projects
        .filter((p) => !p.ownerMatchesAgent)
        .map((p) => ({
          agentId: p.agentId,
          projectSlug: p.projectSlug,
          ownerAgentId: p.ownerAgentId,
        }));

      return jsonResult({
        success: true,
        generatedAt: snapshot.generatedAt,
        scope,
        projectFilter: projectSlug,
        agentsScanned: Array.from(new Set(projects.map((p) => p.agentId))),
        projects,
        ownerMismatches,
        delta,
        snapshotPath: snapshotPath(scope, projectSlug),
      });
    },
  });
}
