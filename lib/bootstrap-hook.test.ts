/**
 * Tests for bootstrap hook session key parsing and instruction loading.
 * Run with: npx tsx --test lib/bootstrap-hook.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseVibeClawCoderSessionKey, loadRoleInstructions } from "./bootstrap-hook.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("parseVibeClawCoderSessionKey", () => {
  it("should parse a standard developer session key", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:my-project-developer-medior");
    assert.deepStrictEqual(result, { projectName: "my-project", role: "developer" });
  });

  it("should parse a reviewer session key", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:webapp-reviewer-junior");
    assert.deepStrictEqual(result, { projectName: "webapp", role: "reviewer" });
  });

  it("should handle project names with hyphens", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:my-cool-project-developer-junior");
    assert.deepStrictEqual(result, { projectName: "my-cool-project", role: "developer" });
  });

  it("should handle project names with multiple hyphens and reviewer role", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:a-b-c-d-reviewer-junior");
    assert.deepStrictEqual(result, { projectName: "a-b-c-d", role: "reviewer" });
  });

  it("should return null for non-subagent session keys", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:main");
    assert.strictEqual(result, null);
  });

  it("should return null for session keys without role", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:project-unknown-level");
    assert.strictEqual(result, null);
  });

  it("should return null for empty string", () => {
    const result = parseVibeClawCoderSessionKey("");
    assert.strictEqual(result, null);
  });

  it("should parse senior developer level", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:vibeclawcoder-developer-senior");
    assert.deepStrictEqual(result, { projectName: "vibeclawcoder", role: "developer" });
  });

  it("should parse simple project name", () => {
    const result = parseVibeClawCoderSessionKey("agent:vibeclawcoder:subagent:api-developer-junior");
    assert.deepStrictEqual(result, { projectName: "api", role: "developer" });
  });
});

describe("loadRoleInstructions", () => {
  it("should load project-specific instructions from vibeclawcoder/projects/<project>/prompts/", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibeclawcoder-test-"));
    const projectDir = path.join(tmpDir, "vibeclawcoder", "projects", "test-project", "prompts");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "developer.md"), "# Developer Instructions\nDo the thing.");

    const result = await loadRoleInstructions(tmpDir, "test-project", "developer");
    assert.strictEqual(result, "# Developer Instructions\nDo the thing.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should fall back to default instructions from vibeclawcoder/prompts/", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibeclawcoder-test-"));
    const promptsDir = path.join(tmpDir, "vibeclawcoder", "prompts");
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(path.join(promptsDir, "tester.md"), "# Tester Default\nReview carefully.");

    const result = await loadRoleInstructions(tmpDir, "nonexistent-project", "tester");
    assert.strictEqual(result, "# Tester Default\nReview carefully.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should return empty string when no instructions exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibeclawcoder-test-"));

    const result = await loadRoleInstructions(tmpDir, "missing", "developer");
    assert.strictEqual(result, "");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should prefer project-specific over default", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibeclawcoder-test-"));
    const projectPromptsDir = path.join(tmpDir, "vibeclawcoder", "projects", "my-project", "prompts");
    const defaultPromptsDir = path.join(tmpDir, "vibeclawcoder", "prompts");
    await fs.mkdir(projectPromptsDir, { recursive: true });
    await fs.mkdir(defaultPromptsDir, { recursive: true });
    await fs.writeFile(path.join(projectPromptsDir, "developer.md"), "Project-specific instructions");
    await fs.writeFile(path.join(defaultPromptsDir, "developer.md"), "Default instructions");

    const result = await loadRoleInstructions(tmpDir, "my-project", "developer");
    assert.strictEqual(result, "Project-specific instructions");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should fall back to old path for unmigrated workspaces", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibeclawcoder-test-"));
    const oldDir = path.join(tmpDir, "projects", "roles", "old-project");
    await fs.mkdir(oldDir, { recursive: true });
    await fs.writeFile(path.join(oldDir, "developer.md"), "Old layout instructions");

    const result = await loadRoleInstructions(tmpDir, "old-project", "developer");
    assert.strictEqual(result, "Old layout instructions");

    await fs.rm(tmpDir, { recursive: true });
  });
});
