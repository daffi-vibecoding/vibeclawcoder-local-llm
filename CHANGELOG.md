# Changelog

## Unreleased

## v1.1.2 - 2026-02-26

- feat: enforce strict developer completion quality gate (`build` + `test`) before `work_finish(done)` transition
- feat: auto-enforce `review:human` routing for architecture-tagged issues (mandatory architecture review)
- feat: add heartbeat `worker_pattern_guard` to escalate repeated terminate/no-progress patterns to `Refining`
- feat: support placeholder model tokens in `workflow.yaml` defaults with runtime fallback to registry models
- docs: update default workflow/README model placeholders for GitHub app version templates

## v1.1.1 - 2026-02-26

- feat: add `refining_triage.humanNotifyThreshold` (default `5`) to alert project channels when HUMAN INPUT queue crosses threshold
- feat: include per-issue links and explicit human decision prompts in `humanInputQueue` notifications
- fix: add threshold-crossing alert state to prevent repeated spam while queue remains above threshold
- chore: expose `notifications.humanInputQueue` toggle in plugin config schema

## v1.0.11 - 2026-02-25

- feat: add `refining_triage` heartbeat pass (threshold default `10`) using reviewer-model lane to auto-move Refining issues to `To Do` or dock for `HUMAN INPUT`

## v1.0.10 - 2026-02-25

- feat: add global `vibeclawcoder_status` tool (cross-agent status + ownership mismatches + snapshot deltas)
- fix: enforce project owner guard in `work_start` and `work_finish` (non-owner agents cannot mutate)
- chore: persist project owner on registration (`ownerAgentId` and channel `accountId` propagation)
- fix: heartbeat startup now respects configured `work_heartbeat.intervalSeconds`
- feat: add scheduled `daily_status` reports (default local noon) with setup-time default channel/agent selection and project-level overrides
- fix: improve `vibeclawcoder_status` queue math for custom workflows and scope-specific snapshot deltas

## v1.0.8 - 2026-02-25

- fix: enforce single-scheduler project ownership in heartbeat via `channels[].accountId` filtering
- chore: require early PR linking during task execution (before completion step)
- docs: add explicit single-scheduler rule and operator guidance in README + runbook

## v1.0.7 - 2026-02-25

- feat: add `pr_ensure_linked` tool for explicit issue-PR linking preflight
- feat: auto-recover `work_finish(done)` when issue-linked PR is missing (auto-edit/create + recheck)
- feat: add branch preflight in `work_start` to move workers onto issue-scoped branches
- chore: add branch/issue mismatch sanity audit in dispatch flow
- docs: update developer prompt and README for PR discipline workflow

## v1.0.6 - 2026-02-23

- test: replace outdated tester session-key cases with reviewer (`d9d2241`)
- refactor: hard-rename internal namespace from devclaw to vibeclawcoder (`e7cd600`)
- chore: align runtime/plugin branding to VibeClawCoder local-first (`9c2c3a8`)

## v1.0.5

- Initial local-first MVP release.