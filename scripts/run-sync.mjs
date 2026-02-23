#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const cfgPath = path.join(root, 'mini', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Missing mini/config.json (copy mini/config.example.json).');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd }).trim();
}

for (const p of cfg.repos) {
  const repoDir = path.join(path.dirname(root), p.slug); // convention: sibling checkout
  if (!fs.existsSync(repoDir)) {
    console.log(`${p.slug}: skipped (repo dir not found at ${repoDir})`);
    continue;
  }

  try {
    const status = sh('git', ['status', '--porcelain'], repoDir);
    if (!status) {
      console.log(`${p.slug}: no local deltas`);
      continue;
    }

    sh('git', ['add', '-A'], repoDir);
    const msg = `chore: local sync checkpoint (${new Date().toISOString()})`;
    sh('git', ['commit', '-m', msg], repoDir);
    sh('git', ['push', 'origin', 'HEAD'], repoDir);

    const sha = sh('git', ['rev-parse', '--short', 'HEAD'], repoDir);
    console.log(`${p.slug}: synced ✅ commit ${sha}`);
  } catch (e) {
    console.log(`${p.slug}: sync failed — ${String(e.message || e)}`);
  }
}
