# VibeClawCoder Mini Architecture

## Core loops
1. 5-minute controller loop (`scripts/run-loop.mjs`): fills developer lanes from `To Do`.
2. 2-hour sync loop (`scripts/run-sync.mjs`): commits/pushes local deltas.
3. 20-minute ticker (`scripts/run-ticker.mjs`): status-only reporting.

## Model policy
- Primary coding: local MiniMax 2.5 5bit
- Specialist review/escalation: Codex Mini / Codex 5.3

## Principles
- Minimal state graph
- Idempotent loops
- Local-first by default
- Explicit fallback behavior
