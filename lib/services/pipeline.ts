/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { StateLabel, IssueProvider } from "../providers/provider.js";
import { deactivateWorker, loadProjectBySlug, getRoleWorker } from "../projects.js";
import { runCommand } from "../run-command.js";
import { notify, getNotificationConfig } from "../notify.js";
import { log as auditLog } from "../audit.js";
import { loadConfig } from "../config/index.js";
import { detectStepRouting } from "./queue-scan.js";
import {
  DEFAULT_WORKFLOW,
  Action,
  getCompletionRule,
  getNextStateDescription,
  getCompletionEmoji,
  resolveNotifyChannel,
  STEP_ROUTING_COLOR,
  type CompletionRule,
  type WorkflowConfig,
} from "../workflow.js";
import type { Channel } from "../projects.js";

export type { CompletionRule };

export type CompletionOutput = {
  labelTransition: string;
  announcement: string;
  nextState: string;
  prUrl?: string;
  issueUrl?: string;
  issueClosed?: boolean;
  issueReopened?: boolean;
};

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 */
export function getRule(
  role: string,
  result: string,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): CompletionRule | undefined {
  return getCompletionRule(workflow, role, result) ?? undefined;
}

type QualityGateConfig = {
  enabled: boolean;
  buildCommand: string;
  testCommand: string;
  timeoutMs: number;
};

const QUALITY_GATE_DEFAULTS: QualityGateConfig = {
  enabled: true,
  buildCommand: "npm run build",
  testCommand: "npm test",
  timeoutMs: 20 * 60 * 1000,
};

const ARCHITECTURE_KEYWORDS = [
  "architecture",
  "architectural",
  "system-design",
  "infra",
  "infrastructure",
  "breaking-change",
] as const;

function resolveQualityGateConfig(
  pluginConfig?: Record<string, unknown>,
): QualityGateConfig {
  const raw = (pluginConfig?.quality_gate ?? {}) as Partial<QualityGateConfig>;
  return {
    enabled: raw.enabled ?? QUALITY_GATE_DEFAULTS.enabled,
    buildCommand: String(raw.buildCommand ?? QUALITY_GATE_DEFAULTS.buildCommand).trim(),
    testCommand: String(raw.testCommand ?? QUALITY_GATE_DEFAULTS.testCommand).trim(),
    timeoutMs: Math.max(5_000, Number(raw.timeoutMs ?? QUALITY_GATE_DEFAULTS.timeoutMs)),
  };
}

function summarizeOutput(stdout?: string, stderr?: string): string {
  const out = String(stdout ?? "").trim();
  const err = String(stderr ?? "").trim();
  const combined = [err, out].filter(Boolean).join("\n");
  if (!combined) return "No command output.";
  return combined.length > 1200 ? `${combined.slice(0, 1197)}...` : combined;
}

async function runQualityGateCommand(
  stage: "build" | "test",
  command: string,
  repoPath: string,
  timeoutMs: number,
): Promise<void> {
  const result = await runCommand(["sh", "-lc", command], {
    cwd: repoPath,
    timeoutMs,
  });
  const code = typeof result.code === "number" ? result.code : 0;
  if (code !== 0) {
    throw new Error(
      `Quality gate failed at ${stage} stage.\n` +
      `Command: ${command}\n` +
      `Exit code: ${code}\n\n` +
      summarizeOutput(result.stdout, result.stderr),
    );
  }
}

async function enforceDeveloperQualityGate(
  role: string,
  result: string,
  repoPath: string,
  pluginConfig: Record<string, unknown> | undefined,
): Promise<QualityGateConfig | null> {
  if (role !== "developer" || result !== "done") return null;
  const cfg = resolveQualityGateConfig(pluginConfig);
  if (!cfg.enabled) return cfg;

  if (!cfg.buildCommand || !cfg.testCommand) {
    throw new Error(
      "Quality gate is enabled but build/test commands are missing. " +
      "Set plugins.entries.vibeclawcoder.config.quality_gate.buildCommand and testCommand.",
    );
  }

  await runQualityGateCommand("build", cfg.buildCommand, repoPath, cfg.timeoutMs);
  await runQualityGateCommand("test", cfg.testCommand, repoPath, cfg.timeoutMs);
  return cfg;
}

function isArchitectureIssue(issue: { labels: string[] }): boolean {
  const labels = issue.labels.map((l) => l.toLowerCase());
  return ARCHITECTURE_KEYWORDS.some((kw) => labels.some((l) => l === kw || l.includes(kw)));
}

function detectReviewRouting(labels: string[]): string | null {
  const routing = labels.find((l) => l.toLowerCase().startsWith("review:"));
  return routing ? routing.toLowerCase() : null;
}

async function enforceArchitectureReviewRouting(opts: {
  role: string;
  result: string;
  issueId: number;
  issue: { labels: string[] };
  provider: IssueProvider;
  workspaceDir: string;
  projectName: string;
}): Promise<boolean> {
  const { role, result, issueId, issue, provider, workspaceDir, projectName } = opts;
  if (role !== "developer" || result !== "done") return false;
  if (!isArchitectureIssue(issue)) return false;

  const routing = detectReviewRouting(issue.labels);
  if (routing === "review:human") return false;

  const toRemove = issue.labels.filter((l) => l.toLowerCase().startsWith("review:") && l.toLowerCase() !== "review:human");
  await provider.ensureLabel("review:human", STEP_ROUTING_COLOR);
  if (toRemove.length > 0) {
    await provider.removeLabels(issueId, toRemove);
  }
  await provider.addLabel(issueId, "review:human");

  await auditLog(workspaceDir, "architecture_review_routing_enforced", {
    project: projectName,
    issueId,
    priorRouting: routing,
    enforcedRouting: "review:human",
  });

  return true;
}

/**
 * Execute the completion side-effects for a role:result pair.
 */
export async function executeCompletion(opts: {
  workspaceDir: string;
  projectSlug: string;
  role: string;
  result: string;
  issueId: number;
  summary?: string;
  prUrl?: string;
  provider: IssueProvider;
  repoPath: string;
  projectName: string;
  channels: Channel[];
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Tasks created during this work session (e.g. architect implementation tasks) */
  createdTasks?: Array<{ id: number; title: string; url: string }>;
  /** Level of the completing worker */
  level?: string;
  /** Slot index within the level's array */
  slotIndex?: number;
}): Promise<CompletionOutput> {
  const {
    workspaceDir, projectSlug, role, result, issueId, summary, provider,
    repoPath, projectName, channels, pluginConfig, runtime,
    workflow = DEFAULT_WORKFLOW,
    createdTasks,
  } = opts;

  const key = `${role}:${result}`;
  const rule = getCompletionRule(workflow, role, result);
  if (!rule) throw new Error(`No completion rule for ${key}`);

  const { timeouts } = await loadConfig(workspaceDir, projectName);
  const qualityGateConfig = await enforceDeveloperQualityGate(role, result, repoPath, pluginConfig);

  if (qualityGateConfig?.enabled) {
    await auditLog(workspaceDir, "quality_gate_passed", {
      project: projectName,
      issueId,
      role,
      buildCommand: qualityGateConfig.buildCommand,
      testCommand: qualityGateConfig.testCommand,
      timeoutMs: qualityGateConfig.timeoutMs,
    }).catch(() => {});
  }

  let prUrl = opts.prUrl;
  let mergedPr = false;
  let prTitle: string | undefined;
  let sourceBranch: string | undefined;

  // Execute pre-notification actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.GIT_PULL:
        try { await runCommand(["git", "pull"], { timeoutMs: timeouts.gitPullMs, cwd: repoPath }); } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "gitPull", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        }
        break;
      case Action.DETECT_PR:
        if (!prUrl) { try {
          // Try open PR first (developer just finished — MR is still open), fall back to merged
          const prStatus = await provider.getPrStatus(issueId);
          prUrl = prStatus.url ?? await provider.getMergedMRUrl(issueId) ?? undefined;
          prTitle = prStatus.title;
          sourceBranch = prStatus.sourceBranch;
        } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "detectPr", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        } }
        break;
      case Action.MERGE_PR:
        try {
          // Grab PR metadata before merging (the MR is still open at this point)
          if (!prTitle) {
            try {
              const prStatus = await provider.getPrStatus(issueId);
              prUrl = prUrl ?? prStatus.url ?? undefined;
              prTitle = prStatus.title;
              sourceBranch = prStatus.sourceBranch;
            } catch { /* best-effort */ }
          }
          await provider.mergePr(issueId);
          mergedPr = true;
        } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "mergePr", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        }
        break;
    }
  }

  // Get issue early (for URL in notification + channel routing)
  let issue = await provider.getIssue(issueId);
  const architectureReviewEnforced = await enforceArchitectureReviewRouting({
    role,
    result,
    issueId,
    issue: {
      labels: issue.labels,
    },
    provider,
    workspaceDir,
    projectName,
  });
  if (architectureReviewEnforced) {
    issue = await provider.getIssue(issueId);
  }
  const notifyTarget = resolveNotifyChannel(issue.labels, channels);

  // Get next state description from workflow
  const nextState = getNextStateDescription(workflow, role, result);

  // Retrieve worker name from project state (best-effort)
  let workerName: string | undefined;
  try {
    const project = await loadProjectBySlug(workspaceDir, projectSlug);
    if (project && opts.level !== undefined && opts.slotIndex !== undefined) {
      const roleWorker = getRoleWorker(project, role);
      const slot = roleWorker.levels[opts.level]?.[opts.slotIndex];
      workerName = slot?.name;
    }
  } catch {
    // Best-effort — don't fail notification if name retrieval fails
  }

  // Send notification early (before deactivation and label transition which can fail)
  const notifyConfig = getNotificationConfig(pluginConfig);
  notify(
    {
      type: "workerComplete",
      project: projectName,
      issueId,
      issueUrl: issue.web_url,
      role,
      level: opts.level,
      name: workerName,
      result: result as "done" | "pass" | "fail" | "refine" | "blocked",
      summary,
      nextState,
      prUrl,
      createdTasks,
    },
    {
      workspaceDir,
      config: notifyConfig,
      groupId: notifyTarget?.groupId,
      channel: notifyTarget?.channel ?? "telegram",
      runtime,
      accountId: notifyTarget?.accountId,
    },
  ).catch((err) => {
    auditLog(workspaceDir, "pipeline_warning", { step: "notify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
  });

  // Send merge notification when PR was merged during this completion
  if (mergedPr) {
    notify(
      {
        type: "prMerged",
        project: projectName,
        issueId,
        issueUrl: issue.web_url,
        issueTitle: issue.title,
        prUrl,
        prTitle,
        sourceBranch,
        mergedBy: "pipeline",
      },
      { workspaceDir, config: notifyConfig, groupId: notifyTarget?.groupId, channel: notifyTarget?.channel ?? "telegram", runtime, accountId: notifyTarget?.accountId },
    ).catch((err) => {
      auditLog(workspaceDir, "pipeline_warning", { step: "mergeNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
    });
  }

  // Transition label first (critical — if this fails, issue still has correct state)
  // Then execute post-transition actions (close/reopen)
  // Finally deactivate worker (last — ensures label is set even if deactivation fails)
  
  await provider.transitionLabel(issueId, rule.from as StateLabel, rule.to as StateLabel);

  // Execute post-transition actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.CLOSE_ISSUE:
        await provider.closeIssue(issueId);
        break;
      case Action.REOPEN_ISSUE:
        await provider.reopenIssue(issueId);
        break;
    }
  }

  // Deactivate worker last (non-critical — session cleanup)
  await deactivateWorker(workspaceDir, projectSlug, role, { level: opts.level, slotIndex: opts.slotIndex, issueId: String(issueId) });

  // Send review routing notification when developer completes
  if (role === "developer" && result === "done") {
    // Re-fetch issue to get labels after transition
    const updated = await provider.getIssue(issueId);
    const routing = detectStepRouting(updated.labels, "review") as "human" | "agent" | null;
    if (routing === "human" || routing === "agent") {
      notify(
        {
          type: "reviewNeeded",
          project: projectName,
          issueId,
          issueUrl: updated.web_url,
          issueTitle: updated.title,
          routing,
          prUrl,
        },
        {
          workspaceDir,
          config: notifyConfig,
          groupId: notifyTarget?.groupId,
          channel: notifyTarget?.channel ?? "telegram",
          runtime,
          accountId: notifyTarget?.accountId,
        },
      ).catch((err) => {
        auditLog(workspaceDir, "pipeline_warning", { step: "reviewNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
      });
    }
  }

  // Build announcement using workflow-derived emoji
  const emoji = getCompletionEmoji(role, result);
  const label = key.replace(":", " ").toUpperCase();
  let announcement = `${emoji} ${label} #${issueId}`;
  if (summary) announcement += ` — ${summary}`;
  announcement += `\n📋 [Issue #${issueId}](${issue.web_url})`;
  if (prUrl) announcement += `\n🔗 [PR](${prUrl})`;
  if (createdTasks && createdTasks.length > 0) {
    announcement += `\n📌 Created tasks:`;
    for (const t of createdTasks) {
      announcement += `\n  - [#${t.id}: ${t.title}](${t.url})`;
    }
  }
  announcement += `\n${nextState}.`;

  return {
    labelTransition: `${rule.from} → ${rule.to}`,
    announcement,
    nextState,
    prUrl,
    issueUrl: issue.web_url,
    issueClosed: rule.actions.includes(Action.CLOSE_ISSUE),
    issueReopened: rule.actions.includes(Action.REOPEN_ISSUE),
  };
}