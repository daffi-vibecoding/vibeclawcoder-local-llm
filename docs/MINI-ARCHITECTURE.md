# VibeClawCoder Mini Architecture

## Core loops
1. 5-minute controller loop (`scripts/run-loop.mjs`): fills developer lanes from `To Do`.
2. Default DevClaw GitHub flow handles live commit/PR/review lifecycle per task.
3. 20-minute ticker (`scripts/run-ticker.mjs`): status-only reporting.

## Model policy
- Primary coding: local MiniMax 2.5 5bit
- Specialist review/escalation: Codex Mini / Codex 5.3

## Principles
- Minimal state graph
- Idempotent loops
- Local-first by default
- Explicit fallback behavior
