/**
 * setup/config.ts — Plugin config writer (openclaw.json).
 *
 * Handles: tool restrictions, subagent cleanup, heartbeat defaults.
 * Models are stored in workflow.yaml (not openclaw.json).
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { HEARTBEAT_DEFAULTS } from "../services/heartbeat.js";
import type { ExecutionMode } from "../workflow.js";

export type DailyStatusSetupConfig = {
  enabled?: boolean;
  hourLocal?: number;
  minuteLocal?: number;
  defaultChannelName?: string;
  defaultAgentId?: string;
};

const DAILY_STATUS_DEFAULTS: Required<Omit<DailyStatusSetupConfig, "defaultAgentId">> = {
  enabled: true,
  hourLocal: 12,
  minuteLocal: 0,
  defaultChannelName: "primary",
};

/**
 * Write VibeClawCoder plugin config to openclaw.json plugins section.
 *
 * Configures:
 * - Tool restrictions (deny sessions_spawn, sessions_send) for VibeClawCoder agents
 * - Subagent cleanup interval (30 days) to keep development sessions alive
 * - Heartbeat defaults
 *
 * Read-modify-write to preserve existing config.
 * Note: models are NOT stored here — they live in workflow.yaml.
 */
export async function writePluginConfig(
  api: OpenClawPluginApi,
  agentId?: string,
  projectExecution?: ExecutionMode,
  dailyStatus?: DailyStatusSetupConfig,
): Promise<void> {
  const config = api.runtime.config.loadConfig() as Record<string, unknown>;

  ensurePluginStructure(config);

  if (projectExecution) {
    (config as any).plugins.entries.vibeclawcoder.config.projectExecution = projectExecution;
  }

  // Clean up legacy models from openclaw.json (moved to workflow.yaml)
  delete (config as any).plugins.entries.vibeclawcoder.config.models;

  ensureInternalHooks(config);
  ensureHeartbeatDefaults(config);
  ensureDailyStatusDefaults(config, dailyStatus, agentId);
  configureSubagentCleanup(config);
  ensureTelegramLinkPreviewDisabled(config);

  if (agentId) {
    addToolRestrictions(config, agentId);
  }

  await api.runtime.config.writeConfigFile(config as any);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function ensurePluginStructure(config: Record<string, unknown>): void {
  if (!config.plugins) config.plugins = {};
  const plugins = config.plugins as Record<string, unknown>;
  if (!plugins.entries) plugins.entries = {};
  const entries = plugins.entries as Record<string, unknown>;
  if (!entries.vibeclawcoder) entries.vibeclawcoder = {};
  const vibeclawcoder = entries.vibeclawcoder as Record<string, unknown>;
  if (!vibeclawcoder.config) vibeclawcoder.config = {};
}

function configureSubagentCleanup(config: Record<string, unknown>): void {
  if (!config.agents) config.agents = {};
  const agents = config.agents as Record<string, unknown>;
  if (!agents.defaults) agents.defaults = {};
  const defaults = agents.defaults as Record<string, unknown>;
  if (!defaults.subagents) defaults.subagents = {};
  (defaults.subagents as Record<string, unknown>).archiveAfterMinutes = 43200;
}

function addToolRestrictions(config: Record<string, unknown>, agentId: string): void {
  const agent = (config as any).agents?.list?.find((a: { id: string }) => a.id === agentId);
  if (agent) {
    if (!agent.tools) agent.tools = {};
    agent.tools.deny = ["sessions_spawn", "sessions_send"];
    delete agent.tools.allow;
  }
}

function ensureInternalHooks(config: Record<string, unknown>): void {
  if (!config.hooks) config.hooks = {};
  const hooks = config.hooks as Record<string, unknown>;
  if (!hooks.internal) hooks.internal = {};
  (hooks.internal as Record<string, unknown>).enabled = true;
}

function ensureHeartbeatDefaults(config: Record<string, unknown>): void {
  const vibeclawcoder = (config as any).plugins.entries.vibeclawcoder.config;
  if (!vibeclawcoder.work_heartbeat) {
    vibeclawcoder.work_heartbeat = { ...HEARTBEAT_DEFAULTS };
  }
  if (!vibeclawcoder.quality_gate) {
    vibeclawcoder.quality_gate = {
      enabled: true,
      buildCommand: "npm run build",
      testCommand: "npm test",
      timeoutMs: 1_200_000,
    };
  }
  if (!vibeclawcoder.worker_pattern_guard) {
    vibeclawcoder.worker_pattern_guard = {
      enabled: true,
      terminateStrikeThreshold: 2,
      noProgressStrikeThreshold: 2,
      strikeWindowHours: 24,
    };
  }
  if (!vibeclawcoder.refining_triage) {
    vibeclawcoder.refining_triage = {
      enabled: true,
      threshold: 10,
      maxPerTick: 6,
      sessionKey: "vibeclawcoder-refining-triage",
      humanInputLabel: "human-input",
      humanNotifyThreshold: 5,
    };
  }
}

function ensureDailyStatusDefaults(
  config: Record<string, unknown>,
  dailyStatus?: DailyStatusSetupConfig,
  setupAgentId?: string,
): void {
  const vibeclawcoder = (config as any).plugins.entries.vibeclawcoder.config;
  const existing = (vibeclawcoder.daily_status ?? {}) as DailyStatusSetupConfig;
  vibeclawcoder.daily_status = {
    ...DAILY_STATUS_DEFAULTS,
    ...existing,
    ...dailyStatus,
    defaultAgentId:
      dailyStatus?.defaultAgentId ??
      existing.defaultAgentId ??
      setupAgentId,
  };
}

/**
 * Disable Telegram link previews so notifications don't show URL preview cards.
 * Sets channels.telegram.linkPreview = false if the Telegram channel is configured.
 * Only sets if not already explicitly configured (respects user overrides).
 */
function ensureTelegramLinkPreviewDisabled(config: Record<string, unknown>): void {
  const channels = config.channels as Record<string, unknown> | undefined;
  if (!channels) return;
  const telegram = channels.telegram as Record<string, unknown> | undefined;
  if (!telegram) return;
  if (telegram.linkPreview === undefined) {
    telegram.linkPreview = false;
  }
}