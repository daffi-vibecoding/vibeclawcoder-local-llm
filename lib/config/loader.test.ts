import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./loader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("loadConfig placeholder model fallback", () => {
  it("keeps registry default when workflow.yaml uses model placeholders", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-loader-test-"));
    tempDirs.push(workspaceDir);

    const dataDir = path.join(workspaceDir, "vibeclawcoder");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "workflow.yaml"),
      [
        "roles:",
        "  developer:",
        "    models:",
        "      standard: <GITHUB_APP_MODEL_DEVELOPER_STANDARD>",
        "  reviewer:",
        "    models:",
        "      standard: custom-provider/reviewer-model",
      ].join("\n") + "\n",
      "utf-8",
    );

    const resolved = await loadConfig(workspaceDir);

    assert.strictEqual(
      resolved.roles.developer?.models.standard,
      "inferencer-local//mlx-community/MiniMax-M2.5-5bit",
    );
    assert.strictEqual(
      resolved.roles.reviewer?.models.standard,
      "custom-provider/reviewer-model",
    );
  });
});