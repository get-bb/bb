import fs from "node:fs/promises";
import path from "node:path";
import { appThemeSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { withHarness } from "../../helpers/harness.js";

const CUSTOM_CSS = ":root, .light { --canvas: oklch(0.98 0 0); }\n";

describe.sequential("theme resolve integration", () => {
  it("resolves a theme by id without activating it", () =>
    withHarness(async (harness) => {
      const themeDir = path.join(
        harness.server.config.dataDir,
        "theme",
        "preview-me",
      );
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(path.join(themeDir, "theme.css"), CUSTOM_CSS, "utf8");

      const builtIn = appThemeSchema.parse(
        await (
          await harness.api.settings.themes[":id"].$get({
            param: { id: "nord" },
          })
        ).json(),
      );
      expect(builtIn).toMatchObject({ themeId: "nord", customCss: null });
      expect(builtIn.resolvedCodeTheme.dark).not.toBe(
        appThemeSchema.parse(
          await (
            await harness.api.settings.themes[":id"].$get({
              param: { id: "default" },
            })
          ).json(),
        ).resolvedCodeTheme.dark,
      );

      const custom = appThemeSchema.parse(
        await (
          await harness.api.settings.themes[":id"].$get({
            param: { id: "preview-me" },
          })
        ).json(),
      );
      expect(custom).toMatchObject({
        themeId: "preview-me",
        customCss: CUSTOM_CSS,
      });

      const catalog = await (await harness.api.settings.themes.$get({})).json();
      expect(catalog.active.themeId).toBe("default");
    }));

  it("rejects unknown and malformed theme ids", () =>
    withHarness(async (harness) => {
      const missing = await harness.api.settings.themes[":id"].$get({
        param: { id: "no-such-theme" },
      });
      expect(missing.status).toBe(404);

      const malformed = await harness.api.settings.themes[":id"].$get({
        param: { id: "bad id" },
      });
      expect(malformed.status).toBe(400);
    }));
});
