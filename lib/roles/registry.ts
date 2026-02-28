/**
 * roles/registry.ts — Minimal role registry for VibeClawCoder.
 *
 * Hard-cut design:
 * - developer (local-first coding)
 * - reviewer (cloud-light review)
 * - tester (QA gate, can inherit reviewer lane via workflow roleFallbacks)
 * - architect (strategy/escalation)
 *
 * Single level only: standard
 */
import type { RoleConfig } from "./types.js";

export const ROLE_REGISTRY: Record<string, RoleConfig> = {
  developer: {
    id: "developer",
    displayName: "DEVELOPER",
    levels: ["standard"],
    defaultLevel: "standard",
    models: {
      standard: "inferencer-local//mlx-community/MiniMax-M2.5-5bit",
    },
    emoji: {
      standard: "🤖",
    },
    fallbackEmoji: "🤖",
    completionResults: ["done", "blocked"],
    sessionKeyPattern: "developer",
    notifications: { onStart: true, onComplete: true },
  },

  reviewer: {
    id: "reviewer",
    displayName: "REVIEWER",
    levels: ["standard"],
    defaultLevel: "standard",
    models: {
      standard: "openai-codex/gpt-5.1-codex-mini",
    },
    emoji: {
      standard: "👁️",
    },
    fallbackEmoji: "👁️",
    completionResults: ["approve", "reject", "blocked"],
    sessionKeyPattern: "reviewer",
    notifications: { onStart: true, onComplete: true },
  },

  tester: {
    id: "tester",
    displayName: "TESTER",
    levels: ["standard"],
    defaultLevel: "standard",
    models: {
      standard: "openai-codex/gpt-5.1-codex-mini",
    },
    emoji: {
      standard: "🧪",
    },
    fallbackEmoji: "🧪",
    completionResults: ["pass", "fail", "refine", "blocked"],
    sessionKeyPattern: "tester",
    notifications: { onStart: true, onComplete: true },
  },

  architect: {
    id: "architect",
    displayName: "ARCHITECT",
    levels: ["standard"],
    defaultLevel: "standard",
    models: {
      standard: "openai-codex/gpt-5.3-codex",
    },
    emoji: {
      standard: "🏗️",
    },
    fallbackEmoji: "🏗️",
    completionResults: ["done", "blocked"],
    sessionKeyPattern: "architect",
    notifications: { onStart: true, onComplete: true },
  },
};
