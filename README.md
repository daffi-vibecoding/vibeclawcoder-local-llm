# VibeClawCoder (Local LLM)

A simplified, local-first fork of DevClaw for novice vibecoders.

## Setup + Model Swaps (single walkthrough)

### 1) Install
```bash
git clone git@github.com:<YOUR_GITHUB_USERNAME>/vibeclawcoder-local-llm.git
cd vibeclawcoder-local-llm
npm install && npm run check && npm run build
```

### 2) Choose operator ownership first (avoid fallback-to-main)
- Pick one operator agent id (example: `<YOUR_OPERATOR_AGENT_ID>`).
- Decide if this operator owns coding dispatch + channel announcements.
- Do this before routing projects.

### 3) Configure project repos
1. Copy `mini/config.example.json` -> `mini/config.json`
2. Replace placeholders in `mini/config.json`:
   - `<YOUR_GITHUB_USERNAME>`
   - `<YOUR_REPO_NAME_1>`, `<YOUR_REPO_NAME_2>`
   - `<PROJECT_SLUG_1>`, `<PROJECT_SLUG_2>`
3. Set `maxConcurrentDevelopers` to `1` initially (move to `2` after stable runs).

### 4) Confirm local model runtime is healthy
- Ensure inferencer is running and exposes `/v1/models`
- Confirm `primaryModel` in config exists on the inferencer server
- If local model is unavailable, fix runtime before dispatch

### 5) Configure or swap role models (optional)
Update BOTH files if changing defaults:
1. `defaults/devclaw/workflow.yaml`
2. `lib/roles/registry.ts`

Recommended baseline:
- developer.standard -> `inferencer-local//mlx-community/MiniMax-M2.5-5bit`
- reviewer.standard -> `openai-codex/gpt-5.1-codex-mini`
- architect.standard -> `openai-codex/gpt-5.3-codex`

After any model change:
```bash
npm run check
npm run build
```

### 6) Route to your intended operator agent
Before first run, validate:
1. Project channel mapping uses correct `accountId` for your operator agent
2. Target chat/channel IDs are correct
3. A test dispatch announcement appears from intended operator identity

If it appears under `main`, fix routing before continuing.

### 7) First-run validation
```bash
npm run mini:loop
npm run mini:ticker
```

Expected first-run behavior:
- commands run cleanly
- no dispatch unless `To Do` exists
- ticker prints Doing / To Do / Review counts

### 8) Day-1 operating mode
- keep concurrency low (1-2 developers)
- watch ticker output
- intervene only on blockers >10 minutes
- scale up only after stable runs


## Attribution & License

This project is forked from `laurentenhoor/devclaw` and uses the upstream MIT license.
Original copyright and permission notice are retained in `LICENSE`.
Additional code and modifications in this fork are released under the same MIT terms by the fork maintainer.

Special thanks to Lauren ten Hoor (creator of DevClaw) for building the foundation this fork is based on.

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
- shoutout to xCreate on YouTube and his bleeding edge MLX AI research and app Inferencer for macOS, which enabled this entire project (see https://youtu.be/O_pQG6x9dvY?si=NJ-hLpez7idBUFGR)

Specialist cloud assist:
- Codex account for review/hard fixes/security checks only

## Model strategy (summary)

Model rationale is defined in the setup section above. In short:
- Developer: local MiniMax (cost + throughput)
- Reviewer: Codex Mini (fast review)
- Architect/Strategy: Codex 5.3 (best reasoning)

## Product positioning

Designed by a novice vibecoder for other novice vibecoders.

## Current fork stage

✅ **MVP v1.0.3 (local-first) is live**

This fork now includes:
- hard-cut 3-role model (`developer`, `reviewer`, `architect`)
- local-first MiniMax default coding lane
- Codex mini review lane + Codex 5.3 strategy lane
- minimal operator docs and runbook
- lean defaults restored for stable setup/scaffolding


## Planned minimal workflow

- simple coding loop (local-first)
- default DevClaw GitHub flow (live issue/PR lifecycle)
- lightweight status ticker
- minimal role/state complexity

No extra complexity unless it clearly improves reliability.

## MVP scope (implemented)

- `scripts/run-loop.mjs` + `scripts/run-loop.sh` (local controller loop)
- `scripts/run-ticker.mjs` + `scripts/run-ticker.sh` (status ticker)
- `mini/config.example.json` (starter config)
- `docs/MINI-ARCHITECTURE.md`
- `docs/OPERATOR-RUNBOOK.md`

## Post-MVP roadmap (optional)


### Keep from upstream core
- `index.ts` — plugin entrypoint
- `lib/` — only the minimum helpers needed for command routing + persistence
- `openclaw.plugin.json` — plugin registration metadata
- `package.json`, `tsconfig.json`, `build.mjs` — build/runtime scaffolding
- `LICENSE`, `.gitignore`, `.npmignore`

### Add back (new minimal layer)
- `mini/config.ts` — tiny config schema (models, repos, channel targets)
- `mini/state.ts` — tiny local state store (JSON file; current task, blockers)
- `mini/loop-controller.ts` — 5-minute controller loop (keep coding alive/resume on crash)
- `mini/status-ticker.ts` — 20-minute status emitter (read-only, concise output)
- `mini/tasks.ts` — tiny task queue contract (`todo/doing/done/blocked`) + GitHub mapper
- `scripts/run-loop.sh` — local launcher script
- `scripts/run-ticker.sh` — local status trigger
- `docs/MINI-ARCHITECTURE.md` — one-page design
- `docs/OPERATOR-RUNBOOK.md` — one-page daily usage + recovery guide

### Explicitly not re-adding (for now)
- multi-role level matrix (`junior/medior/senior`)
- deep workflow graph and extra state permutations
- high-frequency autonomous issue-creation churn
- heavy release/publishing/docs machinery

This phase is design-only until reviewed and approved.
