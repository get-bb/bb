import fs from "node:fs/promises";
import { formatBbAppConfigPath } from "@bb/config/bb-app-managed-config";
import { describe, expect, it } from "vitest";
import { getAvailableModels } from "../../helpers/api.js";
import { waitForHostConnected } from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import { DEFAULT_TIMEOUT_MS } from "./shared.js";

describe.sequential("custom provider models integration", () => {
  it("offers config-registered custom models after a config reload", () =>
    withHarness(async (harness) => {
      await waitForHostConnected(harness.api, DEFAULT_TIMEOUT_MS);

      await fs.writeFile(
        formatBbAppConfigPath(harness.server.config.dataDir),
        `${JSON.stringify({
          customModels: [
            {
              providerId: "claude-code",
              model: "claude-example-preview[1m]",
              displayName: "Example Preview (1M)",
            },
          ],
        })}\n`,
        "utf8",
      );
      const reloadResponse = await harness.api.system.config.reload.$post({});
      expect(reloadResponse.status).toBe(200);

      const models = await getAvailableModels(harness.api, {
        providerId: "claude-code",
      });
      const customModel = models.find(
        (model) => model.model === "claude-example-preview[1m]",
      );
      expect(customModel).toMatchObject({
        displayName: "Example Preview (1M)",
        defaultReasoningEffort: "medium",
        isDefault: false,
      });
      // The provider-reported catalog stays first (its default untouched);
      // custom models append at the end.
      expect(models[0]?.isDefault).toBe(true);
      expect(models[models.length - 1]?.model).toBe("claude-example-preview[1m]");
    }));

  it("rejects custom models with an unknown provider on reload", () =>
    withHarness(async (harness) => {
      await fs.writeFile(
        formatBbAppConfigPath(harness.server.config.dataDir),
        `${JSON.stringify({
          customModels: [
            { providerId: "not-a-provider", model: "claude-example-preview" },
          ],
        })}\n`,
        "utf8",
      );

      const reloadResponse = await harness.api.system.config.reload.$post({});
      expect(reloadResponse.status).toBe(422);
      // The schema-level enum failure names the offending field path.
      const body = await reloadResponse.text();
      expect(body).toContain("customModels");
      expect(body).toContain("providerId");
    }));
});
