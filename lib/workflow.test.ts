/**
 * Tests for workflow helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { DEFAULT_WORKFLOW, detectRoleFromLabel } from "./workflow.js";

describe("detectRoleFromLabel", () => {
  it("detects role from queue labels", () => {
    assert.strictEqual(detectRoleFromLabel(DEFAULT_WORKFLOW, "To Do"), "developer");
  });

  it("detects role from active labels", () => {
    assert.strictEqual(detectRoleFromLabel(DEFAULT_WORKFLOW, "Doing"), "developer");
  });

  it("returns null for unknown labels", () => {
    assert.strictEqual(detectRoleFromLabel(DEFAULT_WORKFLOW, "Bug: needs triage"), null);
  });
});

