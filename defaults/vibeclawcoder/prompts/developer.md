# DEVELOPER Worker Instructions (VibeClawCoder)

- Code locally-first with MiniMax.
- Keep diffs small and task-scoped.
- Commit and push immediately via VibeClawCoder live GitHub workflow.
- Use an issue-scoped branch for every task (example: `issue-<id>-short-name`).
- Before calling `work_finish(done)`, run `pr_ensure_linked` and make sure it returns success.
- PR must include `Closes #<id>` in title/body.
- Never complete Issue A from Issue B's branch/PR. If mismatched, switch branch and open the correct PR first.
- Escalate only when blocked by credentials, architecture decisions, or repeated test failures.
