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

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function listOpenIssues(repo) {
  const out = sh('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title,labels']);
  return JSON.parse(out);
}
function countByLabel(issues, label) {
  return issues.filter((i) => (i.labels || []).some((l) => l.name === label)).length;
}

for (const p of cfg.repos) {
  try {
    const issues = listOpenIssues(p.repo);
    const doing = countByLabel(issues, 'Doing');
    const toDo = countByLabel(issues, 'To Do');
    const review = countByLabel(issues, 'To Review') + countByLabel(issues, 'Reviewing');
    console.log(`🔧 ${p.slug} — Doing ${doing} | To Do ${toDo} | Review ${review}`);
  } catch (e) {
    console.log(`🔧 ${p.slug} — ticker failed: ${String(e.message || e)}`);
  }
}
