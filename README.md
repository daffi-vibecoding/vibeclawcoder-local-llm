# VibeClawCoder (Local LLM)

A simplified, local-first fork of DevClaw for novice vibecoders.

## Why this exists

This fork is designed to keep the useful DevClaw core (task rails + GitHub live workflow + chat-driven control) while cutting complexity and cloud burn.

Target outcome:
- codex-like effectiveness and speed
- perpetual local coding usage
- low monthly cloud cost with a GPT Plus account (see setup here https://youtu.be/7DNlQgl2Kk0?si=yLVtA88A6Y38pXso)

Why fork now:
- Anthropic/Claude API-heavy workflows become cost-prohibitive for always-on vibecoding
- OpenAI Codex can be used selectively with OpenClaw while local MiniMax does most coding work
- this gives a Codex-like feel with much lower recurring cloud spend

## Hardware + model baseline

Primary build runtime:
- local MiniMax 2.5 5bit (`inferencer-local//mlx-community/MiniMax-M2.5-5bit`)
- running on an Apple Silicon Mac Studio (Ultra M3, 256GB RAM)

Specialist cloud assist:
- Codex account for review/hard fixes/security checks only

## Product positioning

Designed by a novice vibecoder for other novice vibecoders.

## Current fork stage

This repository is in a pruning phase:
- imported from upstream DevClaw
- non-essential docs/assets/release scaffolding removed
- next step is to add back only the minimal components needed for a stable local-first loop

## Planned minimal workflow

- simple coding loop (local-first)
- default DevClaw GitHub flow (live issue/PR lifecycle)
- lightweight status ticker
- minimal role/state complexity

No extra complexity unless it clearly improves reliability.

## Phase 2: Minimal files to keep/add back (design only)

### Keep from upstream core
- `index.ts` — plugin entrypoint
- `lib/` — only the minimum helpers needed for command routing + persistence
- `openclaw.plugin.json` — plugin registration metadata
- `package.json`, `tsconfig.json`, `build.mjs` — build/runtime scaffolding
- `LICENSE`, `.gitignore`, `.npmignore`

### Add back (new minimal layer)
- `mini/config.ts` — tiny config schema (models, intervals, repos, channel targets)
- `mini/state.ts` — tiny local state store (JSON file; current task, last sync, blockers)
- `mini/loop-controller.ts` — 5-minute controller loop (keep coding alive/resume on crash)
- `mini/sync-runner.ts` — 2-hour git sync loop (commit/push/pr-summary)
- `mini/status-ticker.ts` — 20-minute status emitter (read-only, concise output)
- `mini/tasks.ts` — tiny task queue contract (`todo/doing/done/blocked`) + GitHub mapper
- `scripts/run-loop.sh` — local launcher script
- `scripts/run-sync.sh` — local sync trigger
- `scripts/run-ticker.sh` — local status trigger
- `docs/MINI-ARCHITECTURE.md` — one-page design
- `docs/OPERATOR-RUNBOOK.md` — one-page daily usage + recovery guide

### Explicitly not re-adding (for now)
- multi-role level matrix (`junior/medior/senior`)
- deep workflow graph and extra state permutations
- high-frequency autonomous issue-creation churn
- heavy release/publishing/docs machinery

This phase is design-only until reviewed and approved.
