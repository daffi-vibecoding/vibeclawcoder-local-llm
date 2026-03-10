/**
 * Heartbeat tick — token-free queue processing.
 *
 * Runs automatically via plugin service (periodic execution).
 *
 * Logic:
 *   1. Health pass: auto-fix zombies, stale workers, orphaned state
 *   2. Tick pass: fill free worker slots by priority
 *
 * Zero LLM tokens — all logic is deterministic code + CLI calls.
 * Workers only consume tokens when they start processing dispatched tasks.
 */
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";
import fs from "node:fs";
import path from "node:path";
import { readProjects, getProject, type Project } from "../projects.js";
import { log as auditLog } from "../audit.js";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { upgradeWorkspaceIfNeeded } from "../upgrade.js";
import { readStalePrompts } from "../prompt-hashes.js";
import { loadInstanceName } from "../instance.js";
import {
  checkWorkerHealth,
  scanOrphanedLabels,
  fetchGatewaySessions,
  type SessionLookup,
} from "./health.js";
import { projectTick } from "./tick.js";
import { reviewPass } from "./review.js";
import { reviewSkipPass } from "./review-skip.js";
import { testSkipPass } from "./test-skip.js";
import { createProvider } from "../providers/index.js";
import { loadConfig } from "../config/index.js";
import type { ResolvedConfig } from "../config/types.js";
import { ExecutionMode, resolveNotifyChannel, StateType, getCurrentStateLabel } from "../workflow.js";
import { notify, getNotificationConfig } from "../notify.js";
import { projectOwnedByAgent } from "../ownership.js";
import { runCommand } from "../run-command.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeartbeatConfig = {
  enabled: boolean;
  intervalSeconds: number;
  maxPickupsPerTick: number;
};

type DailyStatusConfig = {
  enabled: boolean;
  hourLocal: number;
  minuteLocal: number;
  defaultChannelName: string;
  defaultAgentId?: string;
};

type RefiningTriageConfig = {
  enabled: boolean;
  threshold: number;
  maxPerTick: number;
  sessionKey: string;
  model?: string;
  humanInputLabel: string;
  humanNotifyThreshold: number;
};

type WorkerPatternGuardConfig = {
  enabled: boolean;
  terminateStrikeThreshold: number;
  noProgressStrikeThreshold: number;
  strikeWindowHours: number;
};

type Agent = {
  agentId: string;
  workspace: string;
};

type TickResult = {
  totalPickups: number;
  totalHealthFixes: number;
  totalPatternEscalations: number;
  totalSkipped: number;
  totalReviewTransitions: number;
  totalReviewSkipTransitions: number;
  totalTestSkipTransitions: number;
  totalRefiningTriaged: number;
};

type ServiceContext = {
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  config: {
    agents?: { list?: Array<{ id: string; workspace?: string }> };
  };
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const HEARTBEAT_DEFAULTS: HeartbeatConfig = {
  enabled: true,
  intervalSeconds: 60,
  maxPickupsPerTick: 4,
};

export const DAILY_STATUS_DEFAULTS: DailyStatusConfig = {
  enabled: true,
  hourLocal: 12,
  minuteLocal: 0,
  defaultChannelName: "primary",
};

export const REFINING_TRIAGE_DEFAULTS: RefiningTriageConfig = {
  enabled: true,
  threshold: 10,
  maxPerTick: 6,
  sessionKey: "vibeclawcoder-refining-triage",
  humanInputLabel: "human-input",
  humanNotifyThreshold: 5,
};

export const WORKER_PATTERN_GUARD_DEFAULTS: WorkerPatternGuardConfig = {
  enabled: true,
  terminateStrikeThreshold: 2,
  noProgressStrikeThreshold: 2,
  strikeWindowHours: 24,
};

export function resolveHeartbeatConfig(
  pluginConfig?: Record<string, unknown>,
): HeartbeatConfig {
  const raw = pluginConfig?.work_heartbeat as
    | Partial<HeartbeatConfig>
    | undefined;
  return { ...HEARTBEAT_DEFAULTS, ...raw };
}

export function resolveDailyStatusConfig(
  pluginConfig?: Record<string, unknown>,
): DailyStatusConfig {
  const raw = (pluginConfig?.daily_status ?? {}) as Partial<DailyStatusConfig>;
  return {
    ...DAILY_STATUS_DEFAULTS,
    ...raw,
    hourLocal: Math.max(0, Math.min(23, Number(raw.hourLocal ?? DAILY_STATUS_DEFAULTS.hourLocal))),
    minuteLocal: Math.max(0, Math.min(59, Number(raw.minuteLocal ?? DAILY_STATUS_DEFAULTS.minuteLocal))),
    defaultChannelName: String(raw.defaultChannelName ?? DAILY_STATUS_DEFAULTS.defaultChannelName),
    defaultAgentId: raw.defaultAgentId ? String(raw.defaultAgentId) : undefined,
  };
}

export function resolveRefiningTriageConfig(
  pluginConfig?: Record<string, unknown>,
): RefiningTriageConfig {
  const raw = (pluginConfig?.refining_triage ?? {}) as Partial<RefiningTriageConfig>;
  return {
    ...REFINING_TRIAGE_DEFAULTS,
    ...raw,
    threshold: Math.max(1, Number(raw.threshold ?? REFINING_TRIAGE_DEFAULTS.threshold)),
    maxPerTick: Math.max(1, Number(raw.maxPerTick ?? REFINING_TRIAGE_DEFAULTS.maxPerTick)),
    sessionKey: String(raw.sessionKey ?? REFINING_TRIAGE_DEFAULTS.sessionKey),
    humanInputLabel: String(raw.humanInputLabel ?? REFINING_TRIAGE_DEFAULTS.humanInputLabel),
    humanNotifyThreshold: Math.max(1, Number(raw.humanNotifyThreshold ?? REFINING_TRIAGE_DEFAULTS.humanNotifyThreshold)),
    model: raw.model ? String(raw.model) : undefined,
  };
}

export function resolveWorkerPatternGuardConfig(
  pluginConfig?: Record<string, unknown>,
): WorkerPatternGuardConfig {
  const raw = (pluginConfig?.worker_pattern_guard ?? {}) as Partial<WorkerPatternGuardConfig>;
  return {
    ...WORKER_PATTERN_GUARD_DEFAULTS,
    ...raw,
    terminateStrikeThreshold: Math.max(1, Number(raw.terminateStrikeThreshold ?? WORKER_PATTERN_GUARD_DEFAULTS.terminateStrikeThreshold)),
    noProgressStrikeThreshold: Math.max(1, Number(raw.noProgressStrikeThreshold ?? WORKER_PATTERN_GUARD_DEFAULTS.noProgressStrikeThreshold)),
    strikeWindowHours: Math.max(1, Number(raw.strikeWindowHours ?? WORKER_PATTERN_GUARD_DEFAULTS.strikeWindowHours)),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function registerHeartbeatService(api: OpenClawPluginApi) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  api.registerService({
    id: "vibeclawcoder-heartbeat",

    start: async (ctx: ServiceContext) => {
      const pluginConfig = api.pluginConfig as Record<string, unknown> | undefined;
      const { intervalSeconds } = resolveHeartbeatConfig(pluginConfig);

      // Config + agent discovery happen per-tick so the heartbeat automatically
      // picks up projects onboarded after the gateway starts — no restart needed.
      intervalId = setInterval(
        () => runHeartbeatTick(api, ctx.logger),
        intervalSeconds * 1000,
      );

      // Run an immediate tick shortly after startup so queued work is picked up
      // right away instead of waiting for the full interval (up to 60s).
      // The 2s delay lets the plugin and providers fully initialize first.
      setTimeout(() => runHeartbeatTick(api, ctx.logger), 2_000);
    },

    stop: async (ctx) => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        ctx.logger.info("work_heartbeat service stopped");
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Discover VibeClawCoder agents by scanning which agent workspaces have projects.
 * Self-discovering: any agent whose workspace contains projects.json is processed.
 * Also checks the default workspace (agents.defaults.workspace) for projects.
 */
function discoverAgents(config: {
  agents?: {
    list?: Array<{ id: string; workspace?: string }>;
    defaults?: { workspace?: string };
  };
}): Agent[] {
  const seen = new Set<string>();
  const agents: Agent[] = [];

  // Check explicit agent list
  for (const a of config.agents?.list || []) {
    if (!a.workspace) continue;
    try {
      if (hasProjects(a.workspace)) {
        agents.push({ agentId: a.id, workspace: a.workspace });
        seen.add(a.workspace);
      }
    } catch {
      /* skip */
    }
  }

  // Check default workspace (used when no explicit agents are registered)
  const defaultWorkspace = config.agents?.defaults?.workspace;
  if (defaultWorkspace && !seen.has(defaultWorkspace)) {
    try {
      if (hasProjects(defaultWorkspace)) {
        agents.push({ agentId: "main", workspace: defaultWorkspace });
      }
    } catch {
      /* skip */
    }
  }

  return agents;
}

/** Check if a workspace has a projects.json (new or old locations). */
function hasProjects(workspace: string): boolean {
  return (
    fs.existsSync(path.join(workspace, DATA_DIR, "projects.json")) ||
    fs.existsSync(path.join(workspace, "projects.json")) ||
    fs.existsSync(path.join(workspace, "projects", "projects.json"))
  );
}

/**
 * Run one heartbeat tick for all agents.
 * Re-reads config and re-discovers agents each tick so projects onboarded
 * after the gateway starts are picked up automatically — no restart needed.
 */
async function runHeartbeatTick(
  api: OpenClawPluginApi,
  logger: ServiceContext["logger"],
): Promise<void> {
  try {
    const pluginConfig = api.pluginConfig as
      | Record<string, unknown>
      | undefined;
    const config = resolveHeartbeatConfig(pluginConfig);
    if (!config.enabled) return;

    const agents = discoverAgents(api.config);
    if (agents.length === 0) return;

    const result = await processAllAgents(agents, config, pluginConfig, logger, api.runtime);
    logTickResult(result, logger);
  } catch (err) {
    logger.error(`work_heartbeat tick failed: ${err}`);
  }
}

/**
 * Process heartbeat tick for all agents and aggregate results.
 */
async function processAllAgents(
  agents: Agent[],
  config: HeartbeatConfig,
  pluginConfig: Record<string, unknown> | undefined,
  logger: ServiceContext["logger"],
  runtime?: PluginRuntime,
): Promise<TickResult> {
  const result: TickResult = {
    totalPickups: 0,
    totalHealthFixes: 0,
    totalPatternEscalations: 0,
    totalSkipped: 0,
    totalReviewTransitions: 0,
    totalReviewSkipTransitions: 0,
    totalTestSkipTransitions: 0,
    totalRefiningTriaged: 0,
  };

  // Auto-upgrade workspaces on version change (runs once per version stamp mismatch)
  const upgradedWorkspaces = new Set<string>();
  for (const { workspace } of agents) {
    if (upgradedWorkspaces.has(workspace)) continue;
    upgradedWorkspaces.add(workspace);
    try {
      const upgradeResult = await upgradeWorkspaceIfNeeded(workspace, logger);
      if (upgradeResult.upgraded) {
        logger.info(`Auto-upgraded workspace ${workspace}`);
      }
    } catch (err) {
      logger.warn(`Auto-upgrade failed for ${workspace}: ${(err as Error).message}`);
    }
  }

  // Check for stale prompt warnings (customized files not updated)
  for (const workspace of upgradedWorkspaces) {
    try {
      const stale = await readStalePrompts(path.join(workspace, DATA_DIR));
      if (stale && stale.length > 0) {
        logger.warn(
          `Customized prompt files not updated: ${stale.map(r => `${r}.md`).join(", ")}. Run reset_defaults to get the latest.`,
        );
      }
    } catch { /* ignore read errors */ }
  }

  // Fetch gateway sessions once for all agents/projects
  const sessions = await fetchGatewaySessions();

  for (const { agentId, workspace } of agents) {
    const agentResult = await tick({
      workspaceDir: workspace,
      agentId,
      config,
      pluginConfig,
      sessions,
      logger,
      runtime,
    });

    result.totalPickups += agentResult.totalPickups;
    result.totalHealthFixes += agentResult.totalHealthFixes;
    result.totalPatternEscalations += agentResult.totalPatternEscalations;
    result.totalSkipped += agentResult.totalSkipped;
    result.totalReviewTransitions += agentResult.totalReviewTransitions;
    result.totalReviewSkipTransitions += agentResult.totalReviewSkipTransitions;
    result.totalTestSkipTransitions += agentResult.totalTestSkipTransitions;
    result.totalRefiningTriaged += agentResult.totalRefiningTriaged;
  }

  return result;
}

/**
 * Log tick results if anything happened.
 */
function logTickResult(
  result: TickResult,
  logger: ServiceContext["logger"],
): void {
  if (
    result.totalPickups > 0 ||
    result.totalHealthFixes > 0 ||
    result.totalPatternEscalations > 0 ||
    result.totalReviewTransitions > 0 ||
    result.totalReviewSkipTransitions > 0 ||
    result.totalTestSkipTransitions > 0 ||
    result.totalRefiningTriaged > 0
  ) {
    logger.info(
      `work_heartbeat tick: ${result.totalPickups} pickups, ${result.totalHealthFixes} health fixes, ${result.totalPatternEscalations} pattern escalations, ${result.totalReviewTransitions} review transitions, ${result.totalReviewSkipTransitions} review skips, ${result.totalTestSkipTransitions} test skips, ${result.totalRefiningTriaged} refining triaged, ${result.totalSkipped} skipped`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tick (Main Heartbeat Loop)
// ---------------------------------------------------------------------------

export async function tick(opts: {
  workspaceDir: string;
  agentId?: string;
  config: HeartbeatConfig;
  pluginConfig?: Record<string, unknown>;
  sessions: SessionLookup | null;
  logger: { info(msg: string): void; warn(msg: string): void };
  runtime?: PluginRuntime;
}): Promise<TickResult> {
  const { workspaceDir, agentId, config, pluginConfig, sessions, runtime } = opts;

  // Load instance name for ownership filtering and auto-claiming
  const resolvedWorkspaceConfig = await loadConfig(workspaceDir);
  const instanceName = await loadInstanceName(workspaceDir, resolvedWorkspaceConfig.instanceName);

  const data = await readProjects(workspaceDir);
  const allSlugs = Object.keys(data.projects);
  const slugs = allSlugs.filter((slug) => {
    const project = data.projects[slug];
    if (!project) return false;
    const owned = projectOwnedByAgent(project, agentId);
    if (!owned) {
      opts.logger.info(
        `Skipping project ${slug} in agent ${agentId ?? "unknown"}: channel accountId ownership mismatch`,
      );
    }
    return owned;
  });

  if (slugs.length === 0) {
    return {
      totalPickups: 0,
      totalHealthFixes: 0,
      totalPatternEscalations: 0,
      totalSkipped: 0,
      totalReviewTransitions: 0,
      totalReviewSkipTransitions: 0,
      totalTestSkipTransitions: 0,
      totalRefiningTriaged: 0,
    };
  }

  const result: TickResult = {
    totalPickups: 0,
    totalHealthFixes: 0,
    totalPatternEscalations: 0,
    totalSkipped: 0,
    totalReviewTransitions: 0,
    totalReviewSkipTransitions: 0,
    totalTestSkipTransitions: 0,
    totalRefiningTriaged: 0,
  };

  const projectExecution =
    (pluginConfig?.projectExecution as string) ?? ExecutionMode.PARALLEL;
  let activeProjects = 0;

  for (const slug of slugs) {
    try {
      const project = data.projects[slug];
      if (!project) continue;

      const { provider } = await createProvider({
        repo: project.repo,
        provider: project.provider,
        repoRemote: project.repoRemote,
      });
      const resolvedConfig = await loadConfig(workspaceDir, project.name);

      await performDailyStatusReport(
        workspaceDir,
        project,
        provider,
        resolvedConfig,
        pluginConfig,
        runtime,
        agentId,
      );

      // Health pass: auto-fix zombies and stale workers
      const healthPass = await performHealthPass(
        workspaceDir,
        slug,
        project,
        sessions,
        provider,
        resolvedConfig,
        pluginConfig,
        resolvedConfig.timeouts.staleWorkerHours,
        instanceName,
      );
      result.totalHealthFixes += healthPass.fixedCount;
      result.totalPatternEscalations += healthPass.patternEscalations;

      // Review pass: transition issues whose PR check condition is met
      result.totalReviewTransitions += await performReviewPass(
        workspaceDir, slug, project, provider, resolvedConfig, pluginConfig, runtime,
      );

      // Review skip pass: auto-merge and transition review:skip issues through the review queue
      result.totalReviewSkipTransitions += await performReviewSkipPass(
        workspaceDir, slug, project, provider, resolvedConfig, pluginConfig, runtime,
      );

      // Test skip pass: auto-transition test:skip issues through the test queue
      result.totalTestSkipTransitions += await performTestSkipPass(
        workspaceDir, slug, provider, resolvedConfig,
      );

      result.totalRefiningTriaged += await performRefiningTriagePass(
        workspaceDir, project, provider, resolvedConfig, pluginConfig,
      );
      await performHumanInputQueueAlert(
        workspaceDir,
        project,
        provider,
        pluginConfig,
        runtime,
        agentId,
      );

      // Budget check: stop if we've hit the limit
      const remaining = config.maxPickupsPerTick - result.totalPickups;
      if (remaining <= 0) break;

      // Sequential project guard: don't start new projects if one is active
      const isProjectActive = await checkProjectActive(workspaceDir, slug);
      if (
        projectExecution === ExecutionMode.SEQUENTIAL &&
        !isProjectActive &&
        activeProjects >= 1
      ) {
        result.totalSkipped++;
        continue;
      }

      // Tick pass: fill free worker slots
      const tickResult = await projectTick({
        workspaceDir,
        projectSlug: slug,
        agentId,
        pluginConfig,
        maxPickups: remaining,
        instanceName,
      });

      result.totalPickups += tickResult.pickups.length;
      result.totalSkipped += tickResult.skipped.length;

      // Notifications now handled by dispatchTask
      if (isProjectActive || tickResult.pickups.length > 0) activeProjects++;
    } catch (err) {
      // Per-project isolation: one failing project doesn't crash the entire tick
      opts.logger.warn(
        `Heartbeat tick failed for project ${slug}: ${(err as Error).message}`,
      );
      result.totalSkipped++;
    }
  }

  await auditLog(workspaceDir, "heartbeat_tick", {
    projectsScanned: slugs.length,
    projectsSeen: allSlugs.length,
    healthFixes: result.totalHealthFixes,
    patternEscalations: result.totalPatternEscalations,
    reviewTransitions: result.totalReviewTransitions,
    reviewSkipTransitions: result.totalReviewSkipTransitions,
    testSkipTransitions: result.totalTestSkipTransitions,
    refiningTriaged: result.totalRefiningTriaged,
    pickups: result.totalPickups,
    skipped: result.totalSkipped,
  });

  return result;
}

type RefiningDecision = {
  decision: "todo" | "human_input";
  reason: string;
  confidence?: number;
};

function findRefiningLabel(workflow: ResolvedConfig["workflow"]): string | null {
  const explicit = Object.values(workflow.states).find(
    (s) => s.type === StateType.HOLD && s.label.toLowerCase().includes("refin"),
  );
  return explicit?.label ?? null;
}

function findTodoLabel(workflow: ResolvedConfig["workflow"]): string | null {
  const todo = Object.values(workflow.states).find(
    (s) => s.type === StateType.QUEUE && s.role === "developer" && s.label.toLowerCase().includes("to do"),
  );
  if (todo) return todo.label;
  const firstDevQueue = Object.values(workflow.states).find(
    (s) => s.type === StateType.QUEUE && s.role === "developer",
  );
  return firstDevQueue?.label ?? null;
}

function findHumanDockLabel(workflow: ResolvedConfig["workflow"]): string | null {
  const initial = workflow.states[workflow.initial];
  if (initial?.type === StateType.HOLD) return initial.label;
  const planning = Object.values(workflow.states).find(
    (s) => s.type === StateType.HOLD && s.label.toLowerCase().includes("plan"),
  );
  return planning?.label ?? null;
}

function parseAgentPayload(output: string): string {
  const lines = output.trim().split("\n");
  const jsonStart = lines.findIndex((line) => line.trim().startsWith("{"));
  if (jsonStart === -1) throw new Error("No JSON envelope found in agent output");
  const envelope = JSON.parse(lines.slice(jsonStart).join("\n"));
  const payloads = envelope.result?.payloads ?? envelope.payloads;
  if (!Array.isArray(payloads) || payloads.length === 0 || !payloads[0]?.text) {
    throw new Error("No payload text found in agent response");
  }
  return String(payloads[0].text);
}

function parseDecision(text: string): RefiningDecision {
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const raw = JSON.parse(clean) as Partial<RefiningDecision>;
  if (raw.decision !== "todo" && raw.decision !== "human_input") {
    throw new Error(`Invalid decision "${String(raw.decision)}"`);
  }
  return {
    decision: raw.decision,
    reason: String(raw.reason ?? "No reason provided"),
    confidence: raw.confidence != null ? Number(raw.confidence) : undefined,
  };
}

function heuristicDecision(issue: { title: string; description: string; labels: string[] }): RefiningDecision {
  const blob = `${issue.title}\n${issue.description}\n${issue.labels.join(" ")}`.toLowerCase();
  const humanSignals = [
    "human input",
    "needs decision",
    "awaiting",
    "waiting on",
    "product decision",
    "legal",
    "policy",
    "security review",
    "manual qa",
    "blocked by",
  ];
  const needsHuman = humanSignals.some((s) => blob.includes(s));
  if (needsHuman) {
    return { decision: "human_input", reason: "Heuristic fallback: issue indicates external/human decision dependency." };
  }
  return { decision: "todo", reason: "Heuristic fallback: no explicit human-dependency markers; safe to re-queue." };
}

function pickRefiningTriageModel(cfg: RefiningTriageConfig, resolvedConfig: ResolvedConfig): string | null {
  if (cfg.model) return cfg.model;
  const reviewer = resolvedConfig.roles.reviewer;
  if (reviewer) {
    const lvl = reviewer.defaultLevel ?? Object.keys(reviewer.models)[0];
    if (lvl && reviewer.models[lvl]) return reviewer.models[lvl];
  }
  const firstRole = Object.values(resolvedConfig.roles)[0];
  if (firstRole) {
    const lvl = firstRole.defaultLevel ?? Object.keys(firstRole.models)[0];
    if (lvl && firstRole.models[lvl]) return firstRole.models[lvl];
  }
  return null;
}

async function decideRefiningIssue(
  issue: import("../providers/provider.js").Issue,
  provider: import("../providers/provider.js").IssueProvider,
  cfg: RefiningTriageConfig,
  resolvedConfig: ResolvedConfig,
): Promise<RefiningDecision> {
  const comments = await provider.listComments(issue.iid).catch(() => []);
  const latestComments = comments.slice(-3).map((c) => `- ${c.author}: ${c.body}`).join("\n");
  const prompt = `You are triaging backlog issues currently in Refining.
Return ONLY JSON: {"decision":"todo"|"human_input","reason":"...","confidence":0.0-1.0}

Rules:
1) Use "todo" when this can be resumed by an engineer without new human decisions.
2) Use "human_input" only if blocked on product/legal/business/manual approval or missing required human clarification.
3) Bias toward "todo" to keep throughput high.

Issue #${issue.iid}: ${issue.title}
Labels: ${issue.labels.join(", ")}
Description:
${(issue.description ?? "").slice(0, 4000)}

Recent comments:
${latestComments || "(none)"}
`;

  try {
    const model = pickRefiningTriageModel(cfg, resolvedConfig);
    if (model) {
      await runCommand(
        ["openclaw", "gateway", "call", "sessions.patch", "--params", JSON.stringify({ key: cfg.sessionKey, model, label: "Refining Triage" })],
        { timeoutMs: 20_000 },
      );
    }
    const result = await runCommand(
      ["openclaw", "agent", "--session-id", cfg.sessionKey, "--message", prompt, "--json"],
      { timeoutMs: 60_000 },
    );
    return parseDecision(parseAgentPayload(result.stdout ?? ""));
  } catch {
    return heuristicDecision(issue);
  }
}

async function performRefiningTriagePass(
  workspaceDir: string,
  project: Project,
  provider: import("../providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
): Promise<number> {
  const cfg = resolveRefiningTriageConfig(pluginConfig);
  if (!cfg.enabled) return 0;

  const refiningLabel = findRefiningLabel(resolvedConfig.workflow);
  const todoLabel = findTodoLabel(resolvedConfig.workflow);
  if (!refiningLabel || !todoLabel) return 0;

  const refiningIssues = await provider.listIssues({ label: refiningLabel, state: "open" }).catch(() => []);
  if (refiningIssues.length < cfg.threshold) return 0;

  const humanDockLabel = findHumanDockLabel(resolvedConfig.workflow) ?? refiningLabel;
  const toProcess = refiningIssues.slice(0, cfg.maxPerTick);

  await provider.ensureLabel(cfg.humanInputLabel, "#95a5a6").catch(() => {});

  let moved = 0;
  for (const issue of toProcess) {
    try {
      const decision = await decideRefiningIssue(issue, provider, cfg, resolvedConfig);
      if (decision.decision === "todo") {
        await provider.transitionLabel(issue.iid, refiningLabel, todoLabel);
        await provider.removeLabels(issue.iid, [cfg.humanInputLabel]).catch(() => {});
        await provider.addComment(
          issue.iid,
          `Auto-triage (refining backlog): moved to **${todoLabel}**.\nReason: ${decision.reason}`,
        ).catch(() => {});
        moved++;
      } else {
        if (humanDockLabel !== refiningLabel) {
          await provider.transitionLabel(issue.iid, refiningLabel, humanDockLabel);
        }
        await provider.addLabel(issue.iid, cfg.humanInputLabel).catch(() => {});
        await provider.addComment(
          issue.iid,
          `Auto-triage (refining backlog): docked for **HUMAN INPUT**.\nReason: ${decision.reason}`,
        ).catch(() => {});
      }
    } catch (err) {
      await auditLog(workspaceDir, "refining_triage_error", {
        project: project.slug,
        issue: issue.iid,
        error: (err as Error).message ?? String(err),
      }).catch(() => {});
    }
  }

  if (toProcess.length > 0) {
    await auditLog(workspaceDir, "refining_triage", {
      project: project.slug,
      threshold: cfg.threshold,
      scanned: refiningIssues.length,
      processed: toProcess.length,
      movedToTodo: moved,
      dockLabel: humanDockLabel,
      humanInputLabel: cfg.humanInputLabel,
    }).catch(() => {});
  }

  return moved;
}

type DailyStatusState = {
  sent: Record<string, string>;
};

type HumanInputAlertState = {
  alerted: Record<string, boolean>;
};

type WorkerPatternStrikes = {
  terminate: number;
  noProgress: number;
  updatedAt: string;
};

type WorkerPatternState = {
  strikes: Record<string, WorkerPatternStrikes>;
};

function dailyStatusStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, DATA_DIR, "daily-status-state.json");
}

function humanInputAlertStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, DATA_DIR, "human-input-alert-state.json");
}

function workerPatternStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, DATA_DIR, "worker-pattern-state.json");
}

async function readDailyStatusState(workspaceDir: string): Promise<DailyStatusState> {
  try {
    const raw = await fs.promises.readFile(dailyStatusStatePath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as DailyStatusState;
    return parsed && typeof parsed === "object" && parsed.sent ? parsed : { sent: {} };
  } catch {
    return { sent: {} };
  }
}

async function writeDailyStatusState(workspaceDir: string, state: DailyStatusState): Promise<void> {
  const file = dailyStatusStatePath(workspaceDir);
  const tmp = file + ".tmp";
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await fs.promises.rename(tmp, file);
}

async function readHumanInputAlertState(workspaceDir: string): Promise<HumanInputAlertState> {
  try {
    const raw = await fs.promises.readFile(humanInputAlertStatePath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as HumanInputAlertState;
    return parsed && typeof parsed === "object" && parsed.alerted ? parsed : { alerted: {} };
  } catch {
    return { alerted: {} };
  }
}

async function writeHumanInputAlertState(workspaceDir: string, state: HumanInputAlertState): Promise<void> {
  const file = humanInputAlertStatePath(workspaceDir);
  const tmp = file + ".tmp";
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await fs.promises.rename(tmp, file);
}

async function readWorkerPatternState(workspaceDir: string): Promise<WorkerPatternState> {
  try {
    const raw = await fs.promises.readFile(workerPatternStatePath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as WorkerPatternState;
    return parsed && typeof parsed === "object" && parsed.strikes ? parsed : { strikes: {} };
  } catch {
    return { strikes: {} };
  }
}

async function writeWorkerPatternState(workspaceDir: string, state: WorkerPatternState): Promise<void> {
  const file = workerPatternStatePath(workspaceDir);
  const tmp = file + ".tmp";
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await fs.promises.rename(tmp, file);
}

function pruneWorkerPatternState(state: WorkerPatternState, windowHours: number): void {
  const cutoff = Date.now() - windowHours * 3_600_000;
  for (const [key, strike] of Object.entries(state.strikes)) {
    const ts = Date.parse(strike.updatedAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete state.strikes[key];
    }
  }
}

function workerPatternKey(projectSlug: string, role: string, issueId: string): string {
  return `${projectSlug}:${role}:${issueId}`;
}

function truncateSingleLine(text: string, max = 180): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Decide whether this can return to To Do or must stay blocked for human input.";
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

async function latestHumanDecisionReason(
  provider: import("../providers/provider.js").IssueProvider,
  issueId: number,
): Promise<string> {
  const comments = await provider.listComments(issueId).catch(() => []);
  for (let idx = comments.length - 1; idx >= 0; idx--) {
    const body = String(comments[idx]?.body ?? "");
    if (!body.toLowerCase().includes("human input")) continue;
    const match = body.match(/Reason:\s*([\s\S]*)$/i);
    if (match?.[1]) return truncateSingleLine(match[1]);
  }
  return "Decide whether this is still blocked on product/business/legal input, or can move back to To Do.";
}

async function performHumanInputQueueAlert(
  workspaceDir: string,
  project: Project,
  provider: import("../providers/provider.js").IssueProvider,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: PluginRuntime | undefined,
  runningAgentId?: string,
): Promise<void> {
  const cfg = resolveRefiningTriageConfig(pluginConfig);
  if (!cfg.enabled) return;

  const dailyCfg = resolveDailyStatusConfig(pluginConfig);
  const projectCfg = project.dailyStatus ?? {};
  const ownerAgent =
    projectCfg.agentId ??
    dailyCfg.defaultAgentId ??
    project.ownerAgentId ??
    project.channels[0]?.accountId;
  if (ownerAgent && runningAgentId && ownerAgent !== runningAgentId) return;

  const channelName = projectCfg.channelName ?? dailyCfg.defaultChannelName;
  const target = project.channels.find((ch) => ch.name === channelName) ?? project.channels[0];
  if (!target?.groupId) return;

  const issues = await provider.listIssues({ label: cfg.humanInputLabel, state: "open" }).catch(() => []);
  const key = `${project.slug}:${target.channel}:${target.groupId}:${cfg.humanInputLabel}:${cfg.humanNotifyThreshold}`;
  const state = await readHumanInputAlertState(workspaceDir);
  const alreadyAlerted = state.alerted[key] === true;

  if (issues.length < cfg.humanNotifyThreshold) {
    if (alreadyAlerted) {
      state.alerted[key] = false;
      await writeHumanInputAlertState(workspaceDir, state);
    }
    return;
  }

  if (alreadyAlerted) return;

  const top = issues.slice(0, 20);
  const details = await Promise.all(
    top.map(async (issue) => ({
      id: issue.iid,
      title: issue.title,
      url: issue.web_url,
      decision: await latestHumanDecisionReason(provider, issue.iid),
    })),
  );

  const notifyConfig = getNotificationConfig(pluginConfig);
  const sent = await notify(
    {
      type: "humanInputQueue",
      project: project.name,
      queueSize: issues.length,
      threshold: cfg.humanNotifyThreshold,
      label: cfg.humanInputLabel,
      issues: details,
    },
    {
      workspaceDir,
      config: notifyConfig,
      groupId: target.groupId,
      channel: target.channel,
      runtime,
      accountId: target.accountId,
    },
  );
  if (!sent) return;

  state.alerted[key] = true;
  await writeHumanInputAlertState(workspaceDir, state);
}

function localDateStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function scheduledWindowOpen(now: Date, cfg: DailyStatusConfig): boolean {
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const minsSchedule = cfg.hourLocal * 60 + cfg.minuteLocal;
  return minsNow >= minsSchedule;
}

function countActiveWorkers(project: Project): number {
  let active = 0;
  for (const roleState of Object.values(project.workers ?? {})) {
    for (const slots of Object.values(roleState.levels ?? {})) {
      for (const slot of slots) {
        if (slot.active) active++;
      }
    }
  }
  return active;
}

async function buildDailyStatusSummary(
  provider: import("../providers/provider.js").IssueProvider,
  workflow: ResolvedConfig["workflow"],
  project: Project,
): Promise<string> {
  let queue = 0;
  let active = 0;
  let closed = 0;
  const perState: Array<{ label: string; count: number }> = [];

  for (const state of Object.values(workflow.states)) {
    const issues = await provider.listIssues({
      label: state.label,
      state: state.type === StateType.TERMINAL ? "closed" : "open",
    }).catch(() => []);
    perState.push({ label: state.label, count: issues.length });
    if (state.type === StateType.QUEUE) queue += issues.length;
    if (state.type === StateType.ACTIVE) active += issues.length;
    if (state.type === StateType.TERMINAL) closed += issues.length;
  }

  const openIssues = await provider.listIssues({ state: "open" }).catch(() => []);
  const workerActive = countActiveWorkers(project);
  const stateSummary = perState
    .filter((s) => s.count > 0)
    .map((s) => `${s.label}: ${s.count}`)
    .join(" | ");

  return [
    `Open issues: ${openIssues.length}`,
    `Queue: ${queue} | Active: ${active} | Closed-labeled: ${closed}`,
    `Active workers: ${workerActive}`,
    stateSummary ? `By state: ${stateSummary}` : "By state: no labeled items",
  ].join("\n");
}

async function performDailyStatusReport(
  workspaceDir: string,
  project: Project,
  provider: import("../providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: PluginRuntime | undefined,
  runningAgentId?: string,
): Promise<void> {
  const cfg = resolveDailyStatusConfig(pluginConfig);
  const projectCfg = project.dailyStatus ?? {};
  const enabled = projectCfg.enabled ?? cfg.enabled;
  if (!enabled) return;

  const ownerAgent =
    projectCfg.agentId ??
    cfg.defaultAgentId ??
    project.ownerAgentId ??
    project.channels[0]?.accountId;

  if (ownerAgent && runningAgentId && ownerAgent !== runningAgentId) return;

  const now = new Date();
  if (!scheduledWindowOpen(now, cfg)) return;
  const today = localDateStamp(now);
  const channelName = projectCfg.channelName ?? cfg.defaultChannelName;
  const target = project.channels.find((ch) => ch.name === channelName) ?? project.channels[0];
  if (!target?.groupId) return;

  const key = `${project.slug}:${target.channel}:${target.groupId}`;
  const state = await readDailyStatusState(workspaceDir);
  if (state.sent[key] === today) return;

  const summary = await buildDailyStatusSummary(provider, resolvedConfig.workflow, project);
  const notifyConfig = getNotificationConfig(pluginConfig);
  const sent = await notify(
    {
      type: "dailyStatus",
      project: project.name,
      summary,
    },
    {
      workspaceDir,
      config: notifyConfig,
      groupId: target.groupId,
      channel: target.channel,
      runtime,
      accountId: target.accountId,
    },
  );

  if (sent) {
    state.sent[key] = today;
    await writeDailyStatusState(workspaceDir, state);
  }
}

async function applyWorkerPatternGuardForFixes(opts: {
  workspaceDir: string;
  projectSlug: string;
  projectName: string;
  role: string;
  workflow: ResolvedConfig["workflow"];
  provider: import("../providers/provider.js").IssueProvider;
  state: WorkerPatternState;
  cfg: WorkerPatternGuardConfig;
  fixes: Array<{ fixed: boolean; issue: { type: string; issueId?: string | null } }>;
}): Promise<number> {
  const { workspaceDir, projectSlug, projectName, role, workflow, provider, state, cfg, fixes } = opts;
  if (!cfg.enabled) return 0;

  let escalations = 0;
  const refiningLabel = findRefiningLabel(workflow) ?? findHumanDockLabel(workflow);
  if (!refiningLabel) return 0;

  for (const fix of fixes) {
    if (!fix.fixed) continue;
    const issueId = fix.issue.issueId ? String(fix.issue.issueId) : null;
    if (!issueId) continue;

    let kind: "terminate" | "noProgress" | null = null;
    if (fix.issue.type === "context_overflow" || fix.issue.type === "session_dead") {
      kind = "terminate";
    } else if (fix.issue.type === "stale_worker") {
      kind = "noProgress";
    }
    if (!kind) continue;

    const key = workerPatternKey(projectSlug, role, issueId);
    const strike = state.strikes[key] ?? {
      terminate: 0,
      noProgress: 0,
      updatedAt: new Date().toISOString(),
    };
    if (kind === "terminate") strike.terminate += 1;
    if (kind === "noProgress") strike.noProgress += 1;
    strike.updatedAt = new Date().toISOString();
    state.strikes[key] = strike;

    const shouldEscalate =
      strike.terminate >= cfg.terminateStrikeThreshold ||
      strike.noProgress >= cfg.noProgressStrikeThreshold;
    if (!shouldEscalate) continue;

    const issueNum = Number(issueId);
    if (!Number.isFinite(issueNum)) continue;

    try {
      const issue = await provider.getIssue(issueNum);
      const current = getCurrentStateLabel(issue.labels, workflow);
      if (current && current !== refiningLabel) {
        await provider.transitionLabel(issueNum, current, refiningLabel);
      }
      await provider.addComment(
        issueNum,
        `Auto-escalated by worker-pattern guard after repeated terminate/no-progress signals.\n` +
        `Counts: terminate=${strike.terminate}, no_progress=${strike.noProgress}.\n` +
        `Moved to ${refiningLabel} for human triage.`,
      ).catch(() => {});
      await auditLog(workspaceDir, "worker_pattern_escalated", {
        project: projectName,
        issueId: issueNum,
        role,
        terminateStrikes: strike.terminate,
        noProgressStrikes: strike.noProgress,
        targetLabel: refiningLabel,
      }).catch(() => {});
      escalations++;
    } catch {
      // Best-effort escalation.
    } finally {
      delete state.strikes[key];
    }
  }

  return escalations;
}

/**
 * Run health checks and auto-fix for a project.
 */
async function performHealthPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  sessions: SessionLookup | null,
  provider: import("../providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  staleWorkerHours?: number,
  instanceName?: string,
): Promise<{ fixedCount: number; patternEscalations: number }> {
  let fixedCount = 0;
  let patternEscalations = 0;

  const guardCfg = resolveWorkerPatternGuardConfig(pluginConfig);
  const patternState = await readWorkerPatternState(workspaceDir);
  pruneWorkerPatternState(patternState, guardCfg.strikeWindowHours);

  for (const role of Object.keys(project.workers)) {
    // Check worker health (session liveness, label consistency, etc)
    const healthFixes = await checkWorkerHealth({
      workspaceDir,
      projectSlug,
      project,
      role,
      sessions,
      autoFix: true,
      provider,
      staleWorkerHours,
      workflow: resolvedConfig.workflow,
    });
    fixedCount += healthFixes.filter((f) => f.fixed).length;

    // Escalate repeated terminate/no-progress patterns to avoid endless redispatch loops.
    patternEscalations += await applyWorkerPatternGuardForFixes({
      workspaceDir,
      projectSlug,
      projectName: project.name,
      role,
      workflow: resolvedConfig.workflow,
      provider,
      state: patternState,
      cfg: guardCfg,
      fixes: healthFixes,
    });

    // Scan for orphaned labels (active labels with no tracking worker)
    const orphanFixes = await scanOrphanedLabels({
      workspaceDir,
      projectSlug,
      project,
      role,
      autoFix: true,
      provider,
      instanceName,
      workflow: resolvedConfig.workflow,
    });
    fixedCount += orphanFixes.filter((f) => f.fixed).length;
  }

  await writeWorkerPatternState(workspaceDir, patternState).catch(() => {});
  return { fixedCount, patternEscalations };
}

/**
 * Run review pass for a project — transition issues whose PR check condition is met.
 */
async function performReviewPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: import("../providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime?: PluginRuntime,
): Promise<number> {
  const notifyConfig = getNotificationConfig(pluginConfig);

  return reviewPass({
    workspaceDir,
    projectName: projectSlug,
    workflow: resolvedConfig.workflow,
    provider,
    repoPath: project.repo,
    gitPullTimeoutMs: resolvedConfig.timeouts.gitPullMs,
    baseBranch: project.baseBranch,
    onMerge: (issueId, prUrl, prTitle, sourceBranch) => {
      provider
        .getIssue(issueId)
        .then((issue) => {
          const target = resolveNotifyChannel(
            issue.labels,
            project.channels,
          );
          notify(
            {
              type: "prMerged",
              project: project.name,
              issueId,
              issueUrl: issue.web_url,
              issueTitle: issue.title,
              prUrl: prUrl ?? undefined,
              prTitle,
              sourceBranch,
              mergedBy: "heartbeat",
            },
            {
              workspaceDir,
              config: notifyConfig,
              groupId: target?.groupId,
              channel: target?.channel ?? "telegram",
              runtime,
              accountId: target?.accountId,
            },
          ).catch(() => {});
        })
        .catch(() => {});
    },
    onFeedback: (issueId, reason, prUrl, issueTitle, issueUrl) => {
      const type =
        reason === "changes_requested"
          ? ("changesRequested" as const)
          : ("mergeConflict" as const);
      // No issue labels available in this callback — fall back to primary channel
      const target = project.channels[0];
      notify(
        {
          type,
          project: project.name,
          issueId,
          issueUrl,
          issueTitle,
          prUrl: prUrl ?? undefined,
        },
        {
          workspaceDir,
          config: notifyConfig,
          groupId: target?.groupId,
          channel: target?.channel ?? "telegram",
          runtime,
          accountId: target?.accountId,
        },
      ).catch(() => {});
    },
    onPrClosed: (issueId, prUrl, issueTitle, issueUrl) => {
      // No issue labels available in this callback — fall back to primary channel
      const target = project.channels[0];
      notify(
        {
          type: "prClosed",
          project: project.name,
          issueId,
          issueUrl,
          issueTitle,
          prUrl: prUrl ?? undefined,
        },
        {
          workspaceDir,
          config: notifyConfig,
          groupId: target?.groupId,
          channel: target?.channel ?? "telegram",
          runtime,
          accountId: target?.accountId,
        },
      ).catch(() => {});
    },
  });
}

/**
 * Run review skip pass for a project — auto-merge and transition review:skip issues through the review queue.
 */
async function performReviewSkipPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: import("../providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime?: PluginRuntime,
): Promise<number> {
  const notifyConfig = getNotificationConfig(pluginConfig);

  return reviewSkipPass({
    workspaceDir,
    projectName: projectSlug,
    workflow: resolvedConfig.workflow,
    provider,
    repoPath: project.repo,
    gitPullTimeoutMs: resolvedConfig.timeouts.gitPullMs,
    onMerge: (issueId, prUrl, prTitle, sourceBranch) => {
      provider
        .getIssue(issueId)
        .then((issue) => {
          const target = resolveNotifyChannel(
            issue.labels,
            project.channels,
          );
          notify(
            {
              type: "prMerged",
              project: project.name,
              issueId,
              issueUrl: issue.web_url,
              issueTitle: issue.title,
              prUrl: prUrl ?? undefined,
              prTitle,
              sourceBranch,
              mergedBy: "heartbeat",
            },
            {
              workspaceDir,
              config: notifyConfig,
              groupId: target?.groupId,
              channel: target?.channel ?? "telegram",
              runtime,
              accountId: target?.accountId,
            },
          ).catch(() => {});
        })
        .catch(() => {});
    },
  });
}

/**
 * Run test skip pass for a project — auto-transition test:skip issues through the test queue.
 */
async function performTestSkipPass(
  workspaceDir: string,
  projectSlug: string,
  provider: import("../providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
): Promise<number> {
  return testSkipPass({
    workspaceDir,
    projectName: projectSlug,
    workflow: resolvedConfig.workflow,
    provider,
  });
}

/**
 * Check if a project has any active worker.
 */
async function checkProjectActive(
  workspaceDir: string,
  slug: string,
): Promise<boolean> {
  const data = await readProjects(workspaceDir);
  const project = getProject(data, slug);
  if (!project) return false;
  return Object.values(project.workers).some((w) =>
    Object.values(w.levels).some(slots => slots.some(s => s.active)),
  );
}
