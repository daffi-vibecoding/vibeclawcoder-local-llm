/**
 * roles/registry.ts — Single source of truth for all worker roles.
 *
 * Adding a new role? Just add an entry here. Everything else derives from this.
 *
 * Each role defines:
 * - Identity (id, displayName)
 * - Levels and models
 * - Emoji for announcements
 * - Valid completion results
 * - Session key matching
 * - Notification preferences
 */
import type { RoleConfig } from "./types.js";

export const ROLE_REGISTRY: Record<string, RoleConfig> = {
  developer: {
    id: "developer",
    displayName: "DEVELOPER",
    levels: ["junior", "medior", "senior", "standard"],
    defaultLevel: "medior",
    models: {
      junior: "anthropic/claude-haiku-4-5",
      medior: "anthropic/claude-sonnet-4-5",
      senior: "anthropic/claude-opus-4-6",
      standard: "inferencer-local//mlx-community/MiniMax-M2.5-5bit",
    },
    emoji: {
      junior: "⚡",
      medior: "🔧",
      senior: "🧠",
      standard: "🤖",
    },
    fallbackEmoji: "🔧",
    completionResults: ["done", "blocked"],
    sessionKeyPattern: "developer",
    notifications: { onStart: true, onComplete: true },
  },

  tester: {
    id: "tester",
    displayName: "TESTER",
    levels: ["junior", "medior", "senior", "standard"],
    defaultLevel: "medior",
    models: {
      junior: "anthropic/claude-haiku-4-5",
      medior: "anthropic/claude-sonnet-4-5",
      senior: "anthropic/claude-opus-4-6",
      standard: "openai-codex/gpt-5.1-codex-mini",
    },
    emoji: {
      junior: "⚡",
      medior: "🔍",
      senior: "🧠",
      standard: "🔍",
    },
    fallbackEmoji: "🔍",
    completionResults: ["pass", "fail", "refine", "blocked"],
    sessionKeyPattern: "tester",
    notifications: { onStart: true, onComplete: true },
  },

  architect: {
    id: "architect",
    displayName: "ARCHITECT",
    levels: ["junior", "senior", "standard"],
    defaultLevel: "junior",
    models: {
      junior: "anthropic/claude-sonnet-4-5",
      senior: "anthropic/claude-opus-4-6",
      standard: "openai-codex/gpt-5.3-codex",
    },
    emoji: {
      junior: "📐",
      senior: "🏗️",
      standard: "🏗️",
    },
    fallbackEmoji: "🏗️",
    completionResults: ["done", "blocked"],
    sessionKeyPattern: "architect",
    notifications: { onStart: true, onComplete: true },
  },

  reviewer: {
    id: "reviewer",
    displayName: "REVIEWER",
    levels: ["junior", "senior", "standard"],
    defaultLevel: "junior",
    models: {
      junior: "anthropic/claude-haiku-4-5",
      senior: "anthropic/claude-sonnet-4-5",
      standard: "openai-codex/gpt-5.1-codex-mini",
    },
    emoji: {
      junior: "👁️",
      senior: "🔬",
      standard: "👁️",
    },
    fallbackEmoji: "👁️",
    completionResults: ["approve", "reject", "blocked"],
    sessionKeyPattern: "reviewer",
    notifications: { onStart: true, onComplete: true },
  },
};
