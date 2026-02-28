import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { createTestHarness } from "../lib/testing/index.js";
import { projectTick } from "../lib/services/tick.js";
import { executeCompletion } from "../lib/services/pipeline.js";
import { loadConfig } from "../lib/config/index.js";
import { readProjects, getProject, getRoleWorker } from "../lib/projects.js";
import { getStateLabels, getActiveLabel } from "../lib/workflow.js";

type Scenario = {
  name: string;
  roleExecution: "parallel" | "sequential";
  developerMaxWorkers: number;
};

type ViolationType =
  | "duplicate_active_issue"
  | "active_slot_label_mismatch"
  | "multiple_state_labels";

type SimulationResult = {
  scenario: Scenario;
  seed: number;
  steps: number;
  ticks: number;
  completions: number;
  closedIssues: number;
  openIssues: number;
  violations: Record<ViolationType, number>;
  totalViolations: number;
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(arr: T[], random: () => number): T {
  return arr[Math.floor(random() * arr.length)]!;
}

async function writeScenarioConfig(workspaceDir: string, scenario: Scenario): Promise<void> {
  const dataDir = path.join(workspaceDir, "vibeclawcoder");
  await fs.mkdir(dataDir, { recursive: true });

  const cfg = {
    roles: {
      developer: {
        levels: ["standard"],
        defaultLevel: "standard",
        models: {
          standard: {
            model: "inferencer-local//mlx-community/MiniMax-M2.5-5bit",
            maxWorkers: scenario.developerMaxWorkers,
          },
        },
      },
      reviewer: {
        levels: ["standard"],
        defaultLevel: "standard",
        models: {
          standard: {
            model: "openai-codex/gpt-5.1-codex-mini",
            maxWorkers: 1,
          },
        },
      },
      architect: false,
      tester: false,
    },
    workflow: {
      roleExecution: scenario.roleExecution,
      reviewPolicy: "agent",
      testPolicy: "skip",
    },
  };

  await fs.writeFile(path.join(dataDir, "workflow.yaml"), YAML.stringify(cfg), "utf-8");
}

async function checkInvariants(workspaceDir: string, projectSlug: string): Promise<Record<ViolationType, number>> {
  const result: Record<ViolationType, number> = {
    duplicate_active_issue: 0,
    active_slot_label_mismatch: 0,
    multiple_state_labels: 0,
  };

  const resolved = await loadConfig(workspaceDir, projectSlug);
  const workflow = resolved.workflow;
  const stateLabels = new Set(getStateLabels(workflow));

  const data = await readProjects(workspaceDir);
  const project = getProject(data, projectSlug);
  if (!project) return result;

  const activeIssueSeen = new Set<string>();

  for (const [role, roleWorker] of Object.entries(project.workers)) {
    let expectedActiveLabel: string | null = null;
    try {
      expectedActiveLabel = getActiveLabel(workflow, role);
    } catch {
      expectedActiveLabel = null;
    }

    for (const slots of Object.values(roleWorker.levels)) {
      for (const slot of slots) {
        if (!slot?.active || !slot.issueId) continue;

        if (activeIssueSeen.has(slot.issueId)) {
          result.duplicate_active_issue += 1;
        } else {
          activeIssueSeen.add(slot.issueId);
        }

        const issueIdNum = Number(slot.issueId);
        if (!Number.isFinite(issueIdNum)) continue;

        // Lazy import to avoid holding provider in invariants helper.
        const { TestProvider } = await import("../lib/testing/test-provider.js");
        void TestProvider;
      }
    }
  }

  return result;
}

async function runScenario(scenario: Scenario, seed: number): Promise<SimulationResult> {
  const random = rng(seed);
  const h = await createTestHarness({ projectName: `sim-${scenario.name}-${seed}` });

  try {
    await writeScenarioConfig(h.workspaceDir, scenario);
    const resolved = await loadConfig(h.workspaceDir, h.project.slug);
    const workflow = resolved.workflow;

    // Seed backlog
    for (let i = 1; i <= 60; i += 1) {
      h.provider.seedIssue({
        iid: i,
        title: `Task ${i}`,
        description: `Synthetic task ${i}`,
        labels: ["To Do"],
      });
    }

    const steps = 220;
    let ticks = 0;
    let completions = 0;
    const violations: Record<ViolationType, number> = {
      duplicate_active_issue: 0,
      active_slot_label_mismatch: 0,
      multiple_state_labels: 0,
    };

    for (let step = 0; step < steps; step += 1) {
      const burst = scenario.roleExecution === "parallel" ? 3 : 1;
      const tickRuns = Array.from({ length: burst }, () =>
        projectTick({
          workspaceDir: h.workspaceDir,
          projectSlug: h.project.slug,
          provider: h.provider,
          workflow,
          maxPickups: scenario.roleExecution === "parallel" ? 3 : 1,
          instanceName: "sim-instance",
        }).catch(() => ({ pickups: [], skipped: [{ reason: "tick_failed" }] })),
      );
      await Promise.all(tickRuns);
      ticks += burst;

      const data = await readProjects(h.workspaceDir);
      const project = getProject(data, h.project.slug)!;
      const actives: Array<{ role: string; issueId: number; level: string; slotIndex: number }> = [];

      for (const [role, roleWorker] of Object.entries(project.workers)) {
        for (const [level, slots] of Object.entries(roleWorker.levels)) {
          for (let i = 0; i < slots.length; i += 1) {
            const slot = slots[i];
            if (!slot?.active || !slot.issueId) continue;
            actives.push({ role, issueId: Number(slot.issueId), level, slotIndex: i });
          }
        }
      }

      // Complete a subset of active workers each step
      const toComplete = actives.filter(() => random() < (scenario.roleExecution === "parallel" ? 0.45 : 0.70));

      const completionRuns = toComplete.map(async (a) => {
        let result = "blocked";
        if (a.role === "developer") {
          result = random() < 0.78 ? "done" : "blocked";
        } else if (a.role === "reviewer") {
          const r = random();
          result = r < 0.68 ? "approve" : (r < 0.88 ? "reject" : "blocked");
        } else {
          return;
        }

        await executeCompletion({
          workspaceDir: h.workspaceDir,
          projectSlug: h.project.slug,
          role: a.role,
          result,
          issueId: a.issueId,
          summary: "sim",
          provider: h.provider,
          repoPath: "/tmp/sim-repo",
          projectName: h.project.name,
          channels: h.project.channels,
          workflow,
          level: a.level,
          slotIndex: a.slotIndex,
        }).catch(() => {});
        completions += 1;
      });

      await Promise.all(completionRuns);

      // Invariants
      const stateLabels = new Set(getStateLabels(workflow));
      const fresh = await readProjects(h.workspaceDir);
      const freshProject = getProject(fresh, h.project.slug)!;
      const activeIssueSeen = new Set<string>();

      for (const [role, roleWorker] of Object.entries(freshProject.workers)) {
        let expectedActiveLabel: string | null = null;
        try { expectedActiveLabel = getActiveLabel(workflow, role); } catch { expectedActiveLabel = null; }

        for (const slots of Object.values(roleWorker.levels)) {
          for (const slot of slots) {
            if (!slot?.active || !slot.issueId) continue;

            if (activeIssueSeen.has(slot.issueId)) violations.duplicate_active_issue += 1;
            else activeIssueSeen.add(slot.issueId);

            const issue = await h.provider.getIssue(Number(slot.issueId)).catch(() => null);
            if (!issue) continue;

            const issueStateLabels = issue.labels.filter((l) => stateLabels.has(l));
            if (issueStateLabels.length > 1) violations.multiple_state_labels += 1;
            if (expectedActiveLabel && !issue.labels.includes(expectedActiveLabel)) {
              violations.active_slot_label_mismatch += 1;
            }
          }
        }
      }
    }

    const allIssues = [...h.provider.issues.values()];
    const closedIssues = allIssues.filter((i) => i.state === "closed").length;
    const openIssues = allIssues.length - closedIssues;
    const totalViolations = Object.values(violations).reduce((a, b) => a + b, 0);

    return {
      scenario,
      seed,
      steps,
      ticks,
      completions,
      closedIssues,
      openIssues,
      violations,
      totalViolations,
    };
  } finally {
    await h.cleanup();
  }
}

async function main(): Promise<void> {
  const scenarios: Scenario[] = [
    { name: "parallel-4", roleExecution: "parallel", developerMaxWorkers: 4 },
    { name: "sequential-1", roleExecution: "sequential", developerMaxWorkers: 1 },
  ];

  const seeds = [11, 29, 47, 71, 97, 131, 173, 211, 257, 313];
  const results: SimulationResult[] = [];

  for (const scenario of scenarios) {
    for (const seed of seeds) {
      const res = await runScenario(scenario, seed);
      results.push(res);
      // eslint-disable-next-line no-console
      console.log(`${scenario.name} seed=${seed} violations=${res.totalViolations} closed=${res.closedIssues}`);
    }
  }

  const summary = scenarios.map((scenario) => {
    const rows = results.filter((r) => r.scenario.name === scenario.name);
    const totalViolations = rows.reduce((sum, r) => sum + r.totalViolations, 0);
    const totalClosed = rows.reduce((sum, r) => sum + r.closedIssues, 0);
    const avgViolations = totalViolations / rows.length;
    const avgClosed = totalClosed / rows.length;
    return {
      scenario: scenario.name,
      runs: rows.length,
      avgViolations,
      avgClosed,
      totalViolations,
      totalClosed,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    seeds,
    summary,
    results,
  };

  const outPath = path.join(process.cwd(), "docs", "simulation-concurrency-report.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");

  // eslint-disable-next-line no-console
  console.log("\nSummary:");
  // eslint-disable-next-line no-console
  console.table(summary);
  // eslint-disable-next-line no-console
  console.log(`Report written: ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
