/**
 * Provider factory — auto-detects GitHub vs GitLab from git remote.
 */
import type { IssueProvider } from "./provider.js";
import { GitLabProvider } from "./gitlab.js";
import { GitHubProvider } from "./github.js";
import { resolveRepoPath } from "../projects.js";
import { runCommand } from "../run-command.js";

export type ProviderOptions = {
  provider?: "gitlab" | "github";
  repo?: string;
  repoPath?: string;
  /** Optional git remote URL (preferred when available). */
  repoRemote?: string;
  /** Optional explicit owner/name slug for GitHub repos. */
  repoSlug?: string;
};

export type ProviderWithType = {
  provider: IssueProvider;
  type: "github" | "gitlab";
};

async function detectProvider(repoPath: string): Promise<"gitlab" | "github"> {
  try {
    const result = await runCommand(["git", "remote", "get-url", "origin"], { timeoutMs: 5_000, cwd: repoPath });
    return result.stdout.trim().includes("github.com") ? "github" : "gitlab";
  } catch {
    return "gitlab";
  }
}

/**
 * Parse owner/repo slug from a git remote URL.
 *
 * Supports:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - ssh://git@github.com/owner/repo.git
 */
export function parseGitHubRepoSlug(remote?: string): string | null {
  if (!remote) return null;
  const trimmed = remote.trim();
  if (!trimmed) return null;

  let match = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    match = trimmed.match(/^([^/]+)\/([^/]+)$/);
  }
  if (!match) return null;

  const owner = match[1]?.trim();
  const repo = match[2]?.trim();
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

export async function createProvider(opts: ProviderOptions): Promise<ProviderWithType> {
  const repoPath = opts.repoPath ?? (opts.repo ? resolveRepoPath(opts.repo) : null);
  if (!repoPath) throw new Error("Either repoPath or repo must be provided");
  const type = opts.provider ?? await detectProvider(repoPath);
  const repoSlug = opts.repoSlug ?? parseGitHubRepoSlug(opts.repoRemote) ?? undefined;
  const provider = type === "github"
    ? new GitHubProvider({ repoPath, repoSlug })
    : new GitLabProvider({ repoPath });
  return { provider, type };
}
