/**
 * work_finish — Complete a task (DEV done, QA pass/fail/refine/blocked, architect done/blocked).
 *
 * Delegates side-effects to pipeline service: label transition, state update,
 * issue close/reopen, notifications, and audit logging.
 *
 * All roles (including architect) use the standard pipeline via executeCompletion.
 * Architect workflow: Researching → Done (done, closes issue), Researching → Refining (blocked).
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import type { ToolContext } from "../types.js";
import { getRoleWorker, resolveRepoPath } from "../projects.js";
import { executeCompletion, getRule } from "../services/pipeline.js";
import { log as auditLog } from "../audit.js";
import { requireWorkspaceDir, resolveProject, resolveProvider, getPluginConfig } from "../tool-helpers.js";
import { getAllRoleIds, isValidResult, getCompletionResults } from "../roles/index.js";
import { loadWorkflow } from "../workflow.js";
import { ensurePrLinkedToIssue, isBaseBranch, extractIssueIdFromBranch } from "../pr-linking.js";
import { assertProjectOwnedByAgent } from "../ownership.js";

/**
 * Validate that a developer has created a PR for their work.
 * Throws an error if no open (or merged) PR is found for the issue.
 *
 * How getPrStatus signals "no PR":
 *   - Returns `{ url: null }` when no open or merged PR is linked to the issue.
 *   - `url` is non-null for every found PR (open, approved, merged, etc.).
 *   - We check `url === null` rather than the state field to be explicit:
 *     a null URL unambiguously means "nothing found", regardless of state label.
 */
async function validatePrExistsForDeveloper(
  issueId: number,
  repoPath: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>["provider"],
): Promise<void> {
  try {
    const ensured = await ensurePrLinkedToIssue(issueId, repoPath, provider);
    const branchIssueId = extractIssueIdFromBranch(ensured.branchName);
    if (branchIssueId !== null && branchIssueId !== issueId) {
      throw new Error(
        `Cannot mark work_finish(done): branch mismatch.\n\n` +
        `Current branch: ${ensured.branchName} (issue #${branchIssueId})\n` +
        `Active slot issue: #${issueId}\n\n` +
        `Switch to the correct branch for issue #${issueId} and call work_finish again.`,
      );
    }

    // url is null when getPrStatus found no open or merged PR for this issue.
    if (!ensured.linked) {
      const branchMismatchHint = ensured.branchPr
        ? `\n\nAn open PR already exists for the current branch, but it is not linked to issue #${issueId}:\n` +
          `  #${ensured.branchPr.number} ${ensured.branchPr.url}\n` +
          `Likely causes: wrong branch for this issue, or PR body/title is missing "Closes #${issueId}".`
        : "";
      const recoveryNote = ensured.actions.length > 0
        ? `\n\nRecovery attempted:\n${ensured.actions.map((a) => `- ${a}`).join("\n")}`
        : "";

      throw new Error(
        `Cannot mark work_finish(done) without an open PR.\n\n` +
        `✗ No PR found for branch: ${ensured.branchName}\n\n` +
        (isBaseBranch(ensured.branchName)
          ? `You are on the base branch. Create/switch to an issue branch first (example: issue-${issueId}-short-name).\n\n`
          : "") +
        branchMismatchHint +
        recoveryNote +
        `\n\n` +
        `Please create a PR first:\n` +
        `  gh pr create --base ${ensured.baseBranch} --head ${ensured.branchName} --title "..." --body "Closes #${issueId}"\n\n` +
        `Then call work_finish again.`,
      );
    }

    // url is set — an open or merged PR exists and is linked to this issue.
    // getPrStatus locates PRs via the issue tracker's linked-PR API, so any
    // non-null url already implies the PR references the issue.

    // Mark PR as "seen" (with eyes emoji) if not already marked.
    // This helps distinguish system-created PRs from human responses.
    // Best-effort — don't block completion if this fails.
    try {
      const hasEyes = await provider.prHasReaction(issueId, "eyes");
      if (!hasEyes) {
        await provider.reactToPr(issueId, "eyes");
      }
    } catch {
      // Ignore errors — marking is cosmetic
    }
  } catch (err) {
    // Re-throw our own validation errors; swallow provider/network errors.
    // Swallowing keeps work_finish unblocked when the API is unreachable.
    if (err instanceof Error && err.message.startsWith("Cannot mark work_finish(done)")) {
      throw err;
    }
    console.warn(`PR validation warning for issue #${issueId}:`, err);
  }
}

export function createWorkFinishTool(api: OpenClawPluginApi) {
  return (ctx: ToolContext) => ({
    name: "work_finish",
    label: "Work Finish",
    description: `Complete a task: Developer done (PR created, goes to review) or blocked. Tester pass/fail/refine/blocked. Reviewer approve/reject/blocked. Architect done/blocked. Handles label transition, state update, issue close/reopen, notifications, and audit logging.`,
    parameters: {
      type: "object",
      required: ["role", "result", "projectSlug"],
      properties: {
        role: { type: "string", enum: getAllRoleIds(), description: "Worker role" },
        result: { type: "string", enum: ["done", "pass", "fail", "refine", "blocked", "approve", "reject"], description: "Completion result" },
        projectSlug: { type: "string", description: "Project slug (e.g. 'my-webapp')" },
        summary: { type: "string", description: "Brief summary" },
        prUrl: { type: "string", description: "PR/MR URL (auto-detected if omitted)" },
        createdTasks: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title", "url"],
            properties: {
              id: { type: "number", description: "Issue ID" },
              title: { type: "string", description: "Issue title" },
              url: { type: "string", description: "Issue URL" },
            },
          },
          description: "Tasks created during this work session (architect creates implementation tasks).",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const role = params.role as string;
      const result = params.result as string;
      const slug = (params.projectSlug ?? params.projectGroupId) as string;
      const summary = params.summary as string | undefined;
      const prUrl = params.prUrl as string | undefined;
      const createdTasks = params.createdTasks as Array<{ id: number; title: string; url: string }> | undefined;
      const workspaceDir = requireWorkspaceDir(ctx);

      // Validate role:result using registry
      if (!isValidResult(role, result)) {
        const valid = getCompletionResults(role);
        throw new Error(`${role.toUpperCase()} cannot complete with "${result}". Valid results: ${valid.join(", ")}`);
      }

      // Resolve project + worker
      const { project } = await resolveProject(workspaceDir, slug);
      assertProjectOwnedByAgent(project, ctx.agentId, "work_finish");
      const roleWorker = getRoleWorker(project, role);

      // Find the first active slot across all levels
      let slotIndex: number | null = null;
      let slotLevel: string | null = null;
      let issueId: number | null = null;

      for (const [level, slots] of Object.entries(roleWorker.levels)) {
        for (let i = 0; i < slots.length; i++) {
          if (slots[i]!.active && slots[i]!.issueId) {
            slotLevel = level;
            slotIndex = i;
            issueId = Number(slots[i]!.issueId);
            break;
          }
        }
        if (issueId !== null) break;
      }

      if (slotIndex === null || slotLevel === null || issueId === null) {
        throw new Error(`${role.toUpperCase()} worker not active on ${project.name}`);
      }

      const { provider } = await resolveProvider(project);
      const workflow = await loadWorkflow(workspaceDir, project.name);

      if (!getRule(role, result, workflow))
        throw new Error(`Invalid completion: ${role}:${result}`);

      const repoPath = resolveRepoPath(project.repo);
      const pluginConfig = getPluginConfig(api);

      // For developers marking work as done, validate that a PR exists
      if (role === "developer" && result === "done") {
        await validatePrExistsForDeveloper(issueId, repoPath, provider);
      }

      const completion = await executeCompletion({
        workspaceDir, projectSlug: project.slug, role, result, issueId, summary, prUrl, provider, repoPath,
        projectName: project.name,
        channels: project.channels,
        pluginConfig,
        level: slotLevel,
        slotIndex,
        runtime: api.runtime,
        workflow,
        createdTasks,
      });

      await auditLog(workspaceDir, "work_finish", {
        project: project.name, issue: issueId, role, result,
        summary: summary ?? null, labelTransition: completion.labelTransition,
      });

      return jsonResult({
        success: true, project: project.name, projectSlug: project.slug, issueId, role, result,
        ...completion,
      });
    },
  });
}
