import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TIP_TELEMETRY_IDS } from "@bb/server-contract";
import { BUILTIN_PLUGINS } from "../../../src/services/plugins/builtin-registry.js";

const catalogModuleSchema = z.object({
  TIP_CATALOG: z.array(
    z.object({
      id: z.string(),
      action: z.object({
        kind: z.string(),
        pluginId: z.string().optional(),
        path: z.string().optional(),
      }),
    }),
  ),
});

const catalogPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../plugins/tips/catalog.ts",
);

describe("Tips catalog targets", () => {
  it("points every open-plugin tip and plugin settings page at a built-in plugin", async () => {
    const { TIP_CATALOG } = catalogModuleSchema.parse(
      await import(pathToFileURL(catalogPath).href),
    );
    const builtinIds = new Set(
      BUILTIN_PLUGINS.map((plugin) => plugin.pluginId),
    );
    for (const tip of TIP_CATALOG) {
      if (tip.action.kind === "open-plugin") {
        expect(builtinIds.has(tip.action.pluginId ?? ""), tip.id).toBe(true);
      }
      const settingsPlugin = /^\/settings\/plugins\/([^/?#]+)/u.exec(
        tip.action.path ?? "",
      );
      if (settingsPlugin !== null) {
        expect(builtinIds.has(settingsPlugin[1] ?? ""), tip.id).toBe(true);
      }
    }
  });

  it("allows telemetry for exactly the tips in the catalog", async () => {
    const { TIP_CATALOG } = catalogModuleSchema.parse(
      await import(pathToFileURL(catalogPath).href),
    );
    expect([...TIP_TELEMETRY_IDS].sort()).toEqual(
      TIP_CATALOG.map((tip) => tip.id).sort(),
    );
  });
});
