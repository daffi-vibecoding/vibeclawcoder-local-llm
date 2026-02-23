# VibeClawCoder Mini Architecture

## Core loops
1. 5-minute controller loop: keeps local coding lane alive and resumes work on crash.
2. 2-hour sync loop: commits/pushes local deltas and updates PR status.
3. 20-minute ticker: status-only reporting.

## Model policy
- Primary coding: local MiniMax 2.5 5bit
- Specialist review/escalation: Codex Mini / Codex 5.3

## Principles
- Minimal state graph
- Idempotent loops
- Local-first by default
- Explicit fallback behavior
