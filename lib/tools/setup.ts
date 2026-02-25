/**
 * setup — Agent-driven VibeClawCoder setup.
 *
 * Creates agent, configures model levels, writes workspace files.
 * Thin wrapper around lib/setup/.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import type { ToolContext } from "../types.js";
import { runSetup, type SetupOpts } from "../setup/index.js";
import { getAllDefaultModels, getAllRoleIds, getLevelsForRole } from "../roles/index.js";
import { ExecutionMode } from "../workflow.js";

export function createSetupTool(api: OpenClawPluginApi) {
  return (ctx: ToolContext) => ({
    name: "setup",
    label: "Setup",
    description: `Execute VibeClawCoder setup. Creates AGENTS.md, HEARTBEAT.md, TOOLS.md, vibeclawcoder/projects.json, vibeclawcoder/prompts/, and model level config. Optionally creates a new agent with channel binding. Called after onboard collects configuration.`,
    parameters: {
      type: "object",
      properties: {
        newAgentName: {
          type: "string",
          description:
            "Create a new agent. Omit to configure current workspace.",
        },
        channelBinding: {
          type: "string",
          enum: ["telegram", "whatsapp"],
          description: "Channel to bind (optional, with newAgentName only).",
        },
        migrateFrom: {
          type: "string",
          description:
            "Agent ID to migrate channel binding from. Check openclaw.json bindings first.",
        },
        models: {
          type: "object",
          description: "Model overrides per role and level.",
          properties: Object.fromEntries(
            getAllRoleIds().map((role) => [role, {
              type: "object",
              description: `${role.toUpperCase()} level models`,
              properties: Object.fromEntries(
                getLevelsForRole(role).map((level) => [level, {
                  type: "string",
                  description: `Default: ${getAllDefaultModels()[role]?.[level] ?? "auto"}`,
                }]),
              ),
            }]),
          ),
        },
        projectExecution: {
          type: "string",
          enum: Object.values(ExecutionMode),
          description: "Project execution mode. Default: parallel.",
        },
        dailyStatusEnabled: {
          type: "boolean",
          description: "Enable scheduled daily project status reports. Default: true.",
        },
        dailyStatusHour: {
          type: "number",
          description: "Daily status local hour (0-23). Default: 12.",
        },
        dailyStatusMinute: {
          type: "number",
          description: "Daily status local minute (0-59). Default: 0.",
        },
        dailyStatusChannelName: {
          type: "string",
          description: "Default project channel name for daily status (e.g. 'primary').",
        },
        dailyStatusAgentId: {
          type: "string",
          description: "Default owning agent ID for daily status posting.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const result = await runSetup({
        api,
        newAgentName: params.newAgentName as string | undefined,
        channelBinding:
          (params.channelBinding as "telegram" | "whatsapp") ?? null,
        migrateFrom: params.migrateFrom as string | undefined,
        agentId: params.newAgentName ? undefined : ctx.agentId,
        workspacePath: params.newAgentName ? undefined : ctx.workspaceDir,
        models: params.models as SetupOpts["models"],
        projectExecution: params.projectExecution as
          | ExecutionMode
          | undefined,
        dailyStatus: {
          enabled: params.dailyStatusEnabled as boolean | undefined,
          hourLocal: params.dailyStatusHour as number | undefined,
          minuteLocal: params.dailyStatusMinute as number | undefined,
          defaultChannelName: params.dailyStatusChannelName as string | undefined,
          defaultAgentId: params.dailyStatusAgentId as string | undefined,
        },
      });

      const lines = [
        result.agentCreated
          ? `Agent "${result.agentId}" created`
          : `Configured "${result.agentId}"`,
        "",
      ];
      if (result.bindingMigrated) {
        lines.push(
          `✅ Binding migrated: ${result.bindingMigrated.channel} (${result.bindingMigrated.from} → ${result.agentId})`,
          "",
        );
      }
      lines.push("Models:");
      for (const [role, levels] of Object.entries(result.models)) {
        for (const [level, model] of Object.entries(levels)) {
          lines.push(`  ${role}.${level}: ${model}`);
        }
      }
      lines.push("");
      lines.push("Daily status schedule:");
      lines.push("  enabled: " + String(result.dailyStatus.enabled));
      lines.push("  time: " + String(result.dailyStatus.hourLocal).padStart(2, "0") + ":" + String(result.dailyStatus.minuteLocal).padStart(2, "0"));
      lines.push("  defaultChannel: " + result.dailyStatus.defaultChannelName);
      lines.push("  defaultAgent: " + (result.dailyStatus.defaultAgentId ?? result.agentId));
      lines.push("");

      lines.push("Files:", ...result.filesWritten.map((f) => `  ${f}`));

      if (result.warnings.length > 0)
        lines.push("", "Warnings:", ...result.warnings.map((w) => `  ${w}`));
      lines.push(
        "",
        "Next: register a project, then create issues and pick them up.",
      );

      return jsonResult({
        success: true,
        ...result,
        summary: lines.join("\n"),
      });
    },
  });
}
