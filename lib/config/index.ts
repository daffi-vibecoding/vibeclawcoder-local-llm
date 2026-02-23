/**
 * config/ — Unified VibeClawCoder configuration.
 *
 * Single workflow.yaml per workspace/project combining roles, models, and workflow.
 */
export type {
  VibeClawCoderConfig,
  RoleOverride,
  ResolvedConfig,
  ResolvedRoleConfig,
  ResolvedTimeouts,
  TimeoutConfig,
} from "./types.js";

export { loadConfig } from "./loader.js";
export { mergeConfig } from "./merge.js";
export { validateConfig, validateWorkflowIntegrity } from "./schema.js";
