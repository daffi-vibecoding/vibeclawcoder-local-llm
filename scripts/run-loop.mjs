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
const apply = process.argv.includes('--apply');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function modelHealthy() {
  try {
    const out = sh('curl', ['-s', `${cfg.inferencerBaseUrl}/v1/models`]);
    const json = JSON.parse(out);
    const target = cfg.primaryModel.replace('inferencer-local//', '');
    return (json.data || []).some((m) => m.id === target || m.id === `/${target}`);
  } catch {
    return false;
  }
}

function listOpenIssues(repo) {
  const out = sh('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title,labels,url']);
  return JSON.parse(out);
}

function hasLabel(issue, label) {
  return (issue.labels || []).some((l) => l.name === label);
}

function promoteAndStart(repo, issue) {
  // move To Do -> Doing via labels
  sh('gh', ['issue', 'edit', String(issue.number), '--repo', repo, '--remove-label', 'To Do', '--add-label', 'Doing']);
  sh('gh', ['issue', 'comment', String(issue.number), '--repo', repo, '--body', '🤖 VibeClawCoder local loop picked this item into active coding (MiniMax lane).']);
}

if (!modelHealthy()) {
  console.log('Blocker: local MiniMax model unavailable; no dispatch performed.');
  process.exit(0);
}

for (const p of cfg.repos) {
  const issues = listOpenIssues(p.repo);
  const doing = issues.filter((i) => hasLabel(i, 'Doing'));
  const todo = issues.filter((i) => hasLabel(i, 'To Do'));

  console.log(`\\n🔧 ${p.slug} — Doing ${doing.length}/${cfg.maxConcurrentDevelopers}, To Do ${todo.length}`);

  const slots = Math.max(0, cfg.maxConcurrentDevelopers - doing.length);
  const picks = todo.slice(0, slots);

  if (!picks.length) {
    console.log('Actions: none');
    continue;
  }

  if (!apply) {
    console.log(`Actions (dry-run): would dispatch ${picks.map((x) => `#${x.number}`).join(', ')}`);
    continue;
  }

  for (const issue of picks) {
    try {
      promoteAndStart(p.repo, issue);
      console.log(`Dispatched: #${issue.number} ${issue.title}`);
    } catch (e) {
      console.log(`Dispatch failed for #${issue.number}: ${String(e.message || e)}`);
    }
  }
}
