import { readFile } from "node:fs/promises";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { describe, expect, it } from "vitest";

describe("plugin SDK compatibility version", () => {
  it("keeps the package version aligned with the canonical compatibility version", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(packageJson.version).toBe(PLUGIN_SDK_VERSION);
    expect(PLUGIN_SDK_VERSION).toMatch(/^0\./u);
  });
});
