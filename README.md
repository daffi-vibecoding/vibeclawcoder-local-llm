# VibeClawCoder (Local LLM)

A simplified, local-first fork of DevClaw for novice vibecoders.

## Quick Start (3 commands)

```bash
git clone git@github.com:daffi-vibecoding/vibeclawcoder-local-llm.git
cd vibeclawcoder-local-llm
npm install && npm run check && npm run build
```

Then:
1. Copy `mini/config.example.json` -> `mini/config.json`
2. Run local loop (dry-run): `npm run mini:loop`
3. Run ticker: `npm run mini:ticker`


## Attribution & License

This project is forked from `laurentenhoor/devclaw` and uses the upstream MIT license.
Original copyright and permission notice are retained in `LICENSE`.
Additional code and modifications in this fork are released under the same MIT terms by `daffi-vibecoding`.

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

## Model strategy (and why)

Default role model choices:
- **Developer (local build lane):** `inferencer-local//mlx-community/MiniMax-M2.5-5bit`
  - Why: lowest cloud cost, high throughput, supports near-perpetual coding on local hardware.
- **Reviewer (fast quality gate):** `openai-codex/gpt-5.1-codex-mini`
  - Why: quick and cheap review turnaround with strong code comprehension.
- **Architect/Strategy (hard decisions):** `openai-codex/gpt-5.3-codex`
  - Why: strongest reasoning for architecture, sequencing, and blocker resolution.

## Setup + Model Swaps (with agent routing safeguards)

### 0) Critical pre-setup: pick your operator agent (avoid fallback to `main`)

If you want a specific agent (e.g. `mr-robot`) to run your coding workflow, lock routing first.

Before running setup, ensure:
1. Project channel mapping includes the right `accountId` (e.g. `mr-robot`) in `projects.json`.
2. The target chat/group IDs are correct for each project channel.
3. The same agent has the expected channel binding in your OpenClaw runtime config.

Quick verification checklist:
- Start one task from your intended project channel.
- Confirm worker/session announcements come from the intended agent identity.
- If work appears under `main`, fix channel/account routing before continuing.

### 1) Configure default models

There are two places to update:

1) **Fork defaults (for new setups):**
- `defaults/devclaw/workflow.yaml`

2) **Role registry fallback defaults (runtime fallback):**
- `lib/roles/registry.ts`

Default local-first mapping in this fork:
- developer.standard -> `inferencer-local//mlx-community/MiniMax-M2.5-5bit`
- reviewer.standard -> `openai-codex/gpt-5.1-codex-mini`
- architect.standard -> `openai-codex/gpt-5.3-codex`

### 2) Swap models safely

1. Update model IDs in both files above.
2. Run type/build checks:
   ```bash
   npm run check
   npm run build
   ```
3. Commit with a clear message, e.g. `chore: update role model mapping`.
4. Test one developer dispatch + one reviewer dispatch in the intended project channel.
5. Re-confirm announcements/session ownership are still on the intended agent (not `main`).

## Product positioning

Designed by a novice vibecoder for other novice vibecoders.

## Current fork stage

✅ **MVP v1.0.0 (local-first) is live**

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
