# Changelog

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
