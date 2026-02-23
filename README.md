# VibeClawCoder (Local LLM)

A simplified, local-first fork of DevClaw for novice vibecoders.

## Why this exists

This fork is designed to keep the spirit of DevClaw (task rails + GitHub sync + chat-driven control) while cutting complexity and cloud burn.

Target outcome:
- codex-like effectiveness and speed
- perpetual local coding usage
- low monthly cloud cost with a Plus + Codex account

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

- simple coding loop (local)
- periodic sync loop (GitHub)
- lightweight status ticker
- minimal role/state complexity

No extra complexity unless it clearly improves reliability.
