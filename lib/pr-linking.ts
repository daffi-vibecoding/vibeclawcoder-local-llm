import type { IssueProvider } from "./providers/provider.js";
import { runCommand } from "./run-command.js";

export type BranchPr = {
  number: number;
  url: string;
  title: string;
};

export type EnsurePrLinkedResult = {
  linked: boolean;
  issueId: number;
  branchName: string;
  baseBranch: string;
  prUrl: string | null;
  actions: string[];
  branchPr: BranchPr | null;
};

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const result = await runCommand(["git", "branch", "--show-current"], {
    timeoutMs: 5_000,
    cwd: repoPath,
  });
  return result.stdout.trim();
}

export async function getDefaultBaseBranch(repoPath: string): Promise<string> {
  try {
    const result = await runCommand(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      timeoutMs: 5_000,
      cwd: repoPath,
    });
    const ref = result.stdout.trim();
    if (ref.startsWith("origin/")) return ref.slice("origin/".length);
  } catch {
    // Keep fallback
  }
  return "main";
}

export function isBaseBranch(branchName: string): boolean {
  return branchName === "main" || branchName === "master";
}

export function extractIssueIdFromBranch(branchName: string): number | null {
  const match = /(?:^|[/-])issue[-/](\d+)(?:[-/]|$)|(?:^|[/-])issue-(\d+)(?:[-/]|$)/i.exec(branchName);
  const value = match?.[1] ?? match?.[2];
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function getOpenPrForBranch(
  repoPath: string,
  branchName: string,
): Promise<BranchPr | null> {
  try {
    const result = await runCommand(
      ["gh", "pr", "list", "--state", "open", "--head", branchName, "--json", "number,url,title", "--limit", "1"],
      { timeoutMs: 10_000, cwd: repoPath },
    );
    const rows = JSON.parse(result.stdout || "[]") as Array<BranchPr>;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function prMentionsIssueText(text: string, issueId: number): boolean {
  return new RegExp(`(^|\\W)#${issueId}(\\W|$)`, "i").test(text);
}

async function prMentionsIssue(repoPath: string, prNumber: number, title: string, issueId: number): Promise<boolean> {
  if (prMentionsIssueText(title, issueId)) return true;

  try {
    const result = await runCommand(
      ["gh", "pr", "view", String(prNumber), "--json", "title,body"],
      { timeoutMs: 10_000, cwd: repoPath },
    );
    const row = JSON.parse(result.stdout || "{}") as { title?: string; body?: string };
    return prMentionsIssueText(`${row.title ?? ""}\n${row.body ?? ""}`, issueId);
  } catch {
    return false;
  }
}

async function tryEnsureExistingBranchPrLinksIssue(
  repoPath: string,
  issueId: number,
  branchPr: BranchPr,
  actions: string[],
): Promise<void> {
  const alreadyLinked = await prMentionsIssue(repoPath, branchPr.number, branchPr.title, issueId);
  if (alreadyLinked) {
    actions.push(`PR #${branchPr.number} already references #${issueId}; waiting for provider linkage refresh.`);
    return;
  }

  await runCommand(
    ["gh", "pr", "edit", String(branchPr.number), "--add-body", `\n\nCloses #${issueId}`],
    { timeoutMs: 15_000, cwd: repoPath },
  );
  actions.push(`Added "Closes #${issueId}" to PR #${branchPr.number}.`);
}

async function tryCreateIssuePr(
  repoPath: string,
  issueId: number,
  branchName: string,
  baseBranch: string,
  actions: string[],
): Promise<void> {
  await runCommand(
    [
      "gh",
      "pr",
      "create",
      "--base",
      baseBranch,
      "--head",
      branchName,
      "--title",
      `Issue #${issueId}: implementation`,
      "--body",
      `Closes #${issueId}`,
    ],
    { timeoutMs: 20_000, cwd: repoPath },
  );
  actions.push(`Created PR for ${branchName} with "Closes #${issueId}".`);
}

export async function ensurePrLinkedToIssue(
  issueId: number,
  repoPath: string,
  provider: IssueProvider,
): Promise<EnsurePrLinkedResult> {
  const actions: string[] = [];
  let branchName = "current-branch";
  try {
    branchName = await getCurrentBranch(repoPath);
  } catch {
    actions.push("Failed to read current branch.");
  }

  const baseBranch = await getDefaultBaseBranch(repoPath);
  let branchPr = await getOpenPrForBranch(repoPath, branchName);

  let prStatus = await provider.getPrStatus(issueId);
  if (prStatus.url) {
    return { linked: true, issueId, branchName, baseBranch, prUrl: prStatus.url, actions, branchPr };
  }

  if (!isBaseBranch(branchName)) {
    if (branchPr) {
      try {
        await tryEnsureExistingBranchPrLinksIssue(repoPath, issueId, branchPr, actions);
      } catch {
        actions.push(
          `Could not edit PR #${branchPr.number}. Try: gh pr edit ${branchPr.number} --add-body "Closes #${issueId}"`,
        );
      }
    } else {
      try {
        await tryCreateIssuePr(repoPath, issueId, branchName, baseBranch, actions);
      } catch {
        actions.push(
          `Could not auto-create PR. Try: gh pr create --base ${baseBranch} --head ${branchName} --title "..." --body "Closes #${issueId}"`,
        );
      }
    }
  } else {
    actions.push(`Current branch is base branch (${branchName}).`);
  }

  try {
    prStatus = await provider.getPrStatus(issueId);
  } catch {
    actions.push("Failed to refresh provider PR status after recovery attempt.");
  }
  if (!branchPr) {
    branchPr = await getOpenPrForBranch(repoPath, branchName);
  }

  return {
    linked: !!prStatus.url,
    issueId,
    branchName,
    baseBranch,
    prUrl: prStatus.url ?? null,
    actions,
    branchPr,
  };
}

export async function ensureIssueBranch(
  repoPath: string,
  issueId: number,
): Promise<{ changed: boolean; branchName: string; previousBranch: string }> {
  const current = await getCurrentBranch(repoPath);
  const branchIssueId = extractIssueIdFromBranch(current);
  if (branchIssueId === issueId) {
    return { changed: false, branchName: current, previousBranch: current };
  }

  const target = `issue-${issueId}-autogen`;
  try {
    await runCommand(["git", "checkout", target], { timeoutMs: 15_000, cwd: repoPath });
  } catch {
    await runCommand(["git", "checkout", "-b", target], { timeoutMs: 15_000, cwd: repoPath });
  }

  return { changed: true, branchName: target, previousBranch: current };
}
