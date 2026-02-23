# Operator Runbook (Minimal)

## One-time setup
1. Copy `mini/config.example.json` to `mini/config.json`
2. Update repo names and local checkout paths convention (sibling directories)
3. Ensure `gh auth status` works and local inferencer is reachable

## Start of day
- Dry-run controller: `npm run mini:loop`
- Start coding dispatch (apply mode): `npm run mini:loop -- --apply`
- Check status: `npm run mini:ticker`

## During day
- Every 20 min: run `npm run mini:ticker`
- VibeClawCoder handles live GitHub workflow (no 2h sync loop)
- Intervene only on blockers >10 minutes

## End of day
- Review open blockers and top 3 next tasks
- No manual sync needed — VibeClawCoder handles live GitHub workflow

## Recovery
- If MiniMax unavailable: restart inferencer and rerun `npm run mini:loop`
- If GitHub auth fails: re-auth with `gh auth login`
- If dispatch mistakes occur: relabel issue back to `To Do` and rerun loop
