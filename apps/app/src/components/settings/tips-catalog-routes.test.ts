import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isSettingsSectionId } from "./settings-sections";

const catalogModuleSchema = z.object({
  TIP_CATALOG: z.array(
    z.object({
      id: z.string(),
      action: z.object({ kind: z.string(), path: z.string().optional() }),
    }),
  ),
});

const catalogPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../plugins/tips/catalog.ts",
);

describe("Tips catalog routes", () => {
  it("points every open-page tip at the plugin store or a core Settings route", async () => {
    const { TIP_CATALOG } = catalogModuleSchema.parse(
      await import(pathToFileURL(catalogPath).href),
    );
    for (const tip of TIP_CATALOG) {
      if (tip.action.kind !== "open-page") continue;
      const { pathname } = new URL(tip.action.path ?? "", "http://bb.local");
      if (pathname === "/plugins") continue;
      const [, root, section, pluginId] = pathname.split("/");
      expect(root, tip.id).toBe("settings");
      if (section === undefined) continue;
      expect(isSettingsSectionId(section), tip.id).toBe(true);
      if (section === "plugins") expect(pluginId, tip.id).toBeDefined();
    }
  });
});
