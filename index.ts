import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createWorkStartTool } from "./lib/tools/work-start.js";
import { createWorkFinishTool } from "./lib/tools/work-finish.js";
import { createTaskCreateTool } from "./lib/tools/task-create.js";
import { createTaskUpdateTool } from "./lib/tools/task-update.js";
import { createTaskCommentTool } from "./lib/tools/task-comment.js";
import { createTaskEditBodyTool } from "./lib/tools/task-edit-body.js";
import { createTasksStatusTool } from "./lib/tools/tasks-status.js";
import { createHealthTool } from "./lib/tools/health.js";
import { createProjectRegisterTool } from "./lib/tools/project-register.js";
import { createSetupTool } from "./lib/tools/setup.js";
import { createOnboardTool } from "./lib/tools/onboard.js";
import { createAutoConfigureModelsTool } from "./lib/tools/autoconfigure-models.js";
import { createResearchTaskTool } from "./lib/tools/research-task.js";
import { createTaskListTool } from "./lib/tools/task-list.js";
import { createWorkflowGuideTool } from "./lib/tools/workflow-guide.js";
import { createResetDefaultsTool } from "./lib/tools/reset-defaults.js";
import { createSyncLabelsTool } from "./lib/tools/sync-labels.js";
import { createUpgradeTool } from "./lib/tools/upgrade.js";
import { createClaimOwnershipTool } from "./lib/tools/claim-ownership.js";
import { createPrEnsureLinkedTool } from "./lib/tools/pr-ensure-linked.js";
import { createVibeClawCoderStatusTool } from "./lib/tools/vibeclawcoder-status.js";
import { registerCli } from "./lib/cli.js";
import { registerHeartbeatService } from "./lib/services/heartbeat.js";
import { registerBootstrapHook } from "./lib/bootstrap-hook.js";
import { createTaskAttachTool } from "./lib/tools/task-attach.js";
import { registerAttachmentHook } from "./lib/attachment-hook.js";
import { initRunCommand } from "./lib/run-command.js";

const plugin = {
  id: "vibeclawcoder",
  name: "VibeClawCoder",
  description:
    "Local-first coding orchestration for OpenClaw (MiniMax primary, Codex specialist review/strategy).",
  configSchema: {
    type: "object",
    properties: {
      projectExecution: {
        type: "string",
        enum: ["parallel", "sequential"],
        description:
          "Plugin-level: parallel (each project independent) or sequential (one project at a time)",
        default: "parallel",
      },
      notifications: {
        type: "object",
        description:
          "Per-event-type notification toggles. All default to true — set to false to suppress.",
        properties: {
          workerStart: { type: "boolean", default: true },
          workerComplete: { type: "boolean", default: true },
          dailyStatus: { type: "boolean", default: true },
        },
      },
      daily_status: {
        type: "object",
        description:
          "Scheduled project status reports posted by heartbeat (defaults to local noon, one report per project per day).",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            description: "Enable scheduled daily status reporting.",
          },
          hourLocal: {
            type: "number",
            default: 12,
            description: "Local-hour schedule for the daily report (0-23).",
          },
          minuteLocal: {
            type: "number",
            default: 0,
            description: "Local-minute schedule for the daily report (0-59).",
          },
          defaultChannelName: {
            type: "string",
            default: "primary",
            description: "Default project channel name for daily status routing.",
          },
          defaultAgentId: {
            type: "string",
            description: "Default agent ID responsible for posting daily status reports.",
          },
        },
      },
      work_heartbeat: {
        type: "object",
        description:
          "Token-free interval-based heartbeat service. Runs health checks + queue dispatch automatically. Discovers all VibeClawCoder agents from openclaw.json and processes each independently.",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            description: "Enable automatic periodic heartbeat service.",
          },
          intervalSeconds: {
            type: "number",
            default: 60,
            description: "Seconds between automatic heartbeat ticks.",
          },
          maxPickupsPerTick: {
            type: "number",
            default: 4,
            description: "Max worker dispatches per agent per tick. Applied to each VibeClawCoder agent independently.",
          },
        },
      },
      refining_triage: {
        type: "object",
        description:
          "When Refining backlog gets large, run a dedicated model triage pass to move items back to To Do or dock for HUMAN INPUT.",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            description: "Enable automated refining backlog triage.",
          },
          threshold: {
            type: "number",
            default: 10,
            description: "Run triage when open Refining count is at least this value.",
          },
          maxPerTick: {
            type: "number",
            default: 6,
            description: "Max Refining issues triaged per heartbeat tick.",
          },
          model: {
            type: "string",
            description: "Optional dedicated model for triage; defaults to the reviewer role model.",
          },
          sessionKey: {
            type: "string",
            default: "vibeclawcoder-refining-triage",
            description: "Session key used for triage model calls.",
          },
          humanInputLabel: {
            type: "string",
            default: "human-input",
            description: "Non-state label added when issue is docked for human input.",
          },
        },
      },
    },
  },

  register(api: OpenClawPluginApi) {
    initRunCommand(api);

    // Worker lifecycle
    api.registerTool(createWorkStartTool(api), { names: ["work_start"] });
    api.registerTool(createWorkFinishTool(api), { names: ["work_finish"] });
    api.registerTool(createPrEnsureLinkedTool(api), { names: ["pr_ensure_linked"] });
    api.registerTool(createVibeClawCoderStatusTool(api), { names: ["vibeclawcoder_status"] });

    // Task management
    api.registerTool(createTaskCreateTool(api), { names: ["task_create"] });
    api.registerTool(createTaskUpdateTool(api), { names: ["task_update"] });
    api.registerTool(createTaskCommentTool(api), { names: ["task_comment"] });
    api.registerTool(createTaskEditBodyTool(api), { names: ["task_edit_body"] });
    api.registerTool(createTaskAttachTool(api), { names: ["task_attach"] });

    // Architect
    api.registerTool(createResearchTaskTool(api), { names: ["research_task"] });

    // Operations
    api.registerTool(createTasksStatusTool(api), { names: ["tasks_status"] });
    api.registerTool(createTaskListTool(api), { names: ["task_list"] });
    api.registerTool(createHealthTool(), { names: ["health"] });
    // Setup & config
    api.registerTool(createProjectRegisterTool(api), {
      names: ["project_register"],
    });
    api.registerTool(createSetupTool(api), { names: ["setup"] });
    api.registerTool(createOnboardTool(api), { names: ["onboard"] });
    api.registerTool(createAutoConfigureModelsTool(api), {
      names: ["autoconfigure_models"],
    });
    api.registerTool(createWorkflowGuideTool(), {
      names: ["workflow_guide"],
    });
    api.registerTool(createResetDefaultsTool(), {
      names: ["reset_defaults"],
    });
    api.registerTool(createSyncLabelsTool(), {
      names: ["sync_labels"],
    });
    api.registerTool(createUpgradeTool(), {
      names: ["upgrade"],
    });
    api.registerTool(createClaimOwnershipTool(api), {
      names: ["claim_ownership"],
    });

    // CLI
    api.registerCli(({ program }: { program: any }) => registerCli(program, api), {
      commands: ["vibeclawcoder"],
    });

    // Services
    registerHeartbeatService(api);

    // Bootstrap hooks for worker instruction injection (hybrid: internal + lifecycle)
    registerBootstrapHook(api);
    registerAttachmentHook(api);

    api.logger.info(
      "VibeClawCoder plugin registered (22 tools, 1 CLI command group, 1 service, 3 hooks)",
    );
  },
};

export default plugin;
