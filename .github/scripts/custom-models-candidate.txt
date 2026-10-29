import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { registerConfiguredAcpProvider } from "../../../../apps/server/test/helpers/provider-registry.js";
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
      await registerConfiguredAcpProvider(harness.server.providerRegistry, {
        id: "custom-models",
        displayName: "Custom Models Fixture",
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL("../../fixtures/dynamic-acp-agent.mjs", import.meta.url),
          ),
        ],
        env: {},
      });

      await fs.writeFile(
        formatBbAppConfigPath(harness.server.config.dataDir),
        `${JSON.stringify({
          customModels: [
            {
              providerId: "acp-custom-models",
              model: "fixture-example-preview[1m]",
              displayName: "Example Preview (1M)",
            },
          ],
        })}\n`,
        "utf8",
      );
      const reloadResponse = await harness.api.system.config.reload.$post({});
      expect(reloadResponse.status).toBe(200);

      const models = await getAvailableModels(harness.api, {
        providerId: "acp-custom-models",
      });
      const customModel = models.find(
        (model) => model.model === "fixture-example-preview[1m]",
      );
      expect(customModel).toMatchObject({
        displayName: "Example Preview (1M)",
        defaultReasoningEffort: "medium",
        isDefault: false,
      });
      const defaultModel = models.find((model) => model.isDefault);
      expect(defaultModel).toBeDefined();
      expect(defaultModel?.model).not.toBe("fixture-example-preview[1m]");
      expect(models[models.length - 1]?.model).toBe(
        "fixture-example-preview[1m]",
      );
    }));
});
