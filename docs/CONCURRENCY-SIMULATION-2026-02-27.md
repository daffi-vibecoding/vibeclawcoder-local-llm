# Concurrency Simulation Report (2026-02-27)

## Goal

Find whether VibeClawCoder should run multiple developers in parallel on a single repo checkout, or serialize work to a single active worker.

## Method

Two stress simulations were run.

1. Workflow simulation (`scripts/simulate-concurrency.ts`)
- Randomized dispatch/completion interleavings across many seeds.
- Result: no invariant violations in either mode.
- Limitation: this simulation does not model low-level git workspace contention.

2. Shared-repo git contention simulation (`scripts/simulate-git-contention.sh`)
- 4 workers concurrently mutate/check out/commit in one shared git checkout (`4 x 120 loops`).
- Compare against one serialized worker with equivalent total operations (`1 x 480 loops`).

## Result

- Parallel shared checkout: `2469` failures
- Sequential single worker: `0` failures

Observed failure classes in parallel mode:
- `.git/index.lock` contention
- checkout failures
- commit failures
- branch mismatch events

## Decision

Use serialized execution as default:
- `roles.developer.maxWorkers: 1`
- `workflow.roleExecution: sequential`

This prioritizes deterministic progress and eliminates the dominant failure mode from shared-checkout contention.
