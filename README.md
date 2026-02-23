# VibeClawCoder (Local LLM)

A simplified, local-first fork of VibeClawCoder for novice vibecoders.

## Setup + Model Swaps (single walkthrough)

> **Important:** cloning this repo is not enough. You must also install/enable it as an OpenClaw plugin.

### Prerequisites
- **Node.js** >= 20
- **GitHub CLI** installed and authenticated (`gh auth login`)
- **Inferencer** (or compatible local server) running at `http://127.0.0.1:8081`
- Required repo labels created: `To Do`, `Doing`, `To Review`, `Reviewing`
- OpenClaw gateway running and accessible

### Agent-assisted install: questions to ask the user first
If an agent is installing this for someone else, ask these before touching config:
1. Which agent identity should own orchestration? (`<YOUR_OPERATOR_AGENT_ID>`)
2. Which repos should be managed? (`<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME_X>`)
3. Preferred max concurrent developers? (start with `1`, then `2`)
4. Should local MiniMax be primary coding model? (recommended: yes)
5. Which channels/groups should receive task updates?

### 1) Clone + build
```bash
git clone git@github.com:<YOUR_GITHUB_USERNAME>/vibeclawcoder-local-llm.git
cd vibeclawcoder-local-llm
npm install
npm run check
npm run build
```

### 2) Install plugin into OpenClaw (required)
Use one of the following:

```bash
# from local path
openclaw plugins install /absolute/path/to/vibeclawcoder-local-llm

# then enable by plugin id
openclaw plugins enable vibeclawcoder
```

Verify:
```bash
openclaw plugins list
openclaw plugins info vibeclawcoder
```

### 3) Configure project repos
1. Copy `mini/config.example.json` -> `mini/config.json`
2. Replace placeholders in `mini/config.json`:
   - `<YOUR_GITHUB_USERNAME>`
   - `<YOUR_REPO_NAME_1>`, `<YOUR_REPO_NAME_2>`
   - `<PROJECT_SLUG_1>`, `<PROJECT_SLUG_2>`
3. Set `maxConcurrentDevelopers` to `1` initially (move to `2` after stability)

### 4) Confirm local model runtime is healthy
- Ensure inferencer is running and exposes `/v1/models`
- Confirm `primaryModel` in config exists on inferencer
- If local model is unavailable, fix runtime before dispatch

### 5) Configure or swap role models (optional)
Update BOTH files if changing defaults:
1. `defaults/vibeclawcoder/workflow.yaml`
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

If announcements appear under `main`, fix routing before continuing.

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

This project is forked from `laurentenhoor/vibeclawcoder` and uses the upstream MIT license.
Original copyright and permission notice are retained in `LICENSE`.
Additional code and modifications in this fork are released under the same MIT terms by the fork maintainer.

Special thanks to Lauren ten Hoor (creator of VibeClawCoder) for building the foundation this fork is based on.

## Why this exists

This fork is designed to keep the useful VibeClawCoder core (task rails + GitHub live workflow + chat-driven control) while cutting complexity and cloud burn.

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

✅ **MVP v1.0.5 (local-first) is live**

This fork now includes:
- hard-cut 3-role model (`developer`, `reviewer`, `architect`)
- local-first MiniMax default coding lane
- Codex mini review lane + Codex 5.3 strategy lane
- minimal operator docs and runbook
- lean defaults restored for stable setup/scaffolding


## Planned minimal workflow

- simple coding loop (local-first)
- default VibeClawCoder GitHub flow (live issue/PR lifecycle)
- lightweight status ticker
- minimal role/state complexity

No extra complexity unless it clearly improves reliability.

## MVP scope (implemented)

- `scripts/run-loop.mjs` + `scripts/run-loop.sh` (local controller loop)
- `scripts/run-ticker.mjs` + `scripts/run-ticker.sh` (status ticker)
- `mini/config.example.json` (starter config)
- `docs/MINI-ARCHITECTURE.md`
- `docs/OPERATOR-RUNBOOK.md`

## Post-MVP roadmap (future enhancements)

- `mini/config.ts` — typed config schema with validation (currently plain JSON)
- `mini/state.ts` — persistent local state store for crash recovery
- stronger retry/backoff in controller loop for GitHub API hiccups
- optional webhook/event trigger mode for reduced polling
- optional metrics export for observability (task latency/completion rate)

### Explicitly out of scope
- multi-role level matrix (`junior/medior/senior`)
- deep workflow graph and extra state permutations
- high-frequency autonomous issue-creation churn
- heavy release/publishing/docs machinery
