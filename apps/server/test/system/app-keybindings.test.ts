import { describe, expect, it } from "vitest";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("app keybindings", () => {
  it("serves validated explicit defaults from system config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = systemConfigResponseSchema.parse(await readJson(response));
      expect(
        config.keybindings.find((binding) => binding.command === "thread.new"),
      ).toMatchObject({
        shortcut: { key: "n", mod: true, shift: false },
        when: { all: ["mainSurface"], none: ["modalOpen"] },
      });
      expect(
        config.keybindings.find((binding) => binding.command === "window.new"),
      ).toMatchObject({
        shortcut: { key: "n", mod: true, shift: true },
      });
    });
  });
});
