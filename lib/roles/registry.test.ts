/**
 * Tests for minimal centralized role registry.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ROLE_REGISTRY,
  getAllRoleIds,
  isValidRole,
  getLevelsForRole,
  getDefaultLevel,
  getDefaultModel,
  getCompletionResults,
  isValidResult,
} from "./index.js";

describe("minimal role registry", () => {
  it("has expected built-in roles", () => {
    const ids = getAllRoleIds();
    assert.deepStrictEqual(ids.sort(), ["architect", "developer", "reviewer", "tester"]);
    assert.strictEqual(isValidRole("tester"), true);
  });

  it("uses single standard level per role", () => {
    assert.deepStrictEqual([...getLevelsForRole("developer")], ["standard"]);
    assert.deepStrictEqual([...getLevelsForRole("reviewer")], ["standard"]);
    assert.deepStrictEqual([...getLevelsForRole("tester")], ["standard"]);
    assert.deepStrictEqual([...getLevelsForRole("architect")], ["standard"]);

    assert.strictEqual(getDefaultLevel("developer"), "standard");
    assert.strictEqual(getDefaultLevel("reviewer"), "standard");
    assert.strictEqual(getDefaultLevel("tester"), "standard");
    assert.strictEqual(getDefaultLevel("architect"), "standard");
  });

  it("maps models to design goals", () => {
    assert.strictEqual(
      getDefaultModel("developer", "standard"),
      "inferencer-local//mlx-community/MiniMax-M2.5-5bit",
    );
    assert.strictEqual(
      getDefaultModel("reviewer", "standard"),
      "openai-codex/gpt-5.1-codex-mini",
    );
    assert.strictEqual(
      getDefaultModel("tester", "standard"),
      "openai-codex/gpt-5.1-codex-mini",
    );
    assert.strictEqual(
      getDefaultModel("architect", "standard"),
      "openai-codex/gpt-5.3-codex",
    );
  });

  it("validates completion results", () => {
    assert.deepStrictEqual([...getCompletionResults("developer")], ["done", "blocked"]);
    assert.deepStrictEqual([...getCompletionResults("reviewer")], ["approve", "reject", "blocked"]);
    assert.deepStrictEqual([...getCompletionResults("tester")], ["pass", "fail", "refine", "blocked"]);
    assert.deepStrictEqual([...getCompletionResults("architect")], ["done", "blocked"]);

    assert.strictEqual(isValidResult("developer", "done"), true);
    assert.strictEqual(isValidResult("reviewer", "approve"), true);
    assert.strictEqual(isValidResult("tester", "pass"), true);
    assert.strictEqual(isValidResult("architect", "done"), true);
    assert.strictEqual(isValidResult("developer", "approve"), false);
  });

  it("registry entries are internally consistent", () => {
    for (const [id, config] of Object.entries(ROLE_REGISTRY)) {
      assert.strictEqual(config.id, id);
      assert.ok(config.levels.includes(config.defaultLevel));
      for (const level of config.levels) {
        assert.ok(config.models[level], `${id} missing model for ${level}`);
        assert.ok(config.emoji[level], `${id} missing emoji for ${level}`);
      }
    }
  });
});
