/**
 * pr_ensure_linked — Ensure an issue-linked PR exists for the active developer task.
 *
 * Useful as an explicit preflight step before work_finish(done) in autonomous runs.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import type { ToolContext } from "../types.js";
import { getRoleWorker, resolveRepoPath } from "../projects.js";
import { requireWorkspaceDir, resolveProject, resolveProvider } from "../tool-helpers.js";
import { ensurePrLinkedToIssue, extractIssueIdFromBranch } from "../pr-linking.js";

export function createPrEnsureLinkedTool(_api: OpenClawPluginApi) {
  return (ctx: ToolContext) => ({
    name: "pr_ensure_linked",
    label: "PR Ensure Linked",
    description: "Ensure the active developer issue has an issue-linked PR (`Closes #<id>`).",
    parameters: {
      type: "object",
      required: ["projectSlug"],
      properties: {
        projectSlug: { type: "string", description: "Project slug (e.g. 'my-webapp')." },
        issueId: { type: "number", description: "Optional issue ID override. Defaults to active developer slot issue." },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const slug = (params.projectSlug ?? params.projectGroupId) as string;
      const issueIdParam = params.issueId as number | undefined;
      const workspaceDir = requireWorkspaceDir(ctx);
      const { project } = await resolveProject(workspaceDir, slug);
      const { provider } = await resolveProvider(project);

      let issueId = issueIdParam;
      if (issueId === undefined) {
        const roleWorker = getRoleWorker(project, "developer");
        for (const slots of Object.values(roleWorker.levels)) {
          for (const slot of slots) {
            if (slot.active && slot.issueId) {
              issueId = Number(slot.issueId);
              break;
            }
          }
          if (issueId !== undefined) break;
        }
      }
      if (issueId === undefined) {
        throw new Error("No active developer issue found. Provide issueId explicitly or start work first.");
      }

      const repoPath = resolveRepoPath(project.repo);
      const ensured = await ensurePrLinkedToIssue(issueId, repoPath, provider);
      const branchIssueId = extractIssueIdFromBranch(ensured.branchName);

      return jsonResult({
        success: ensured.linked,
        issueId,
        branchName: ensured.branchName,
        branchIssueId,
        baseBranch: ensured.baseBranch,
        prUrl: ensured.prUrl,
        branchPr: ensured.branchPr,
        actions: ensured.actions,
      });
    },
  });
}
