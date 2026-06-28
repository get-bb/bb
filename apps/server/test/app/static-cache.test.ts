import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setExperiments } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("production static cache headers", () => {
  it("keeps index.html fresh while allowing immutable hashed assets", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "bb-server-static-"));
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await writeFile(
      join(staticDir, "index.html"),
      '<!doctype html><script type="module" src="/assets/index-test.js"></script>',
    );
    await writeFile(
      join(staticDir, "assets", "index-test.js"),
      "console.log('fresh bundle');",
    );

    const harness = await createTestAppHarness();
    const serverApp = createApp(harness.deps, { staticDir });
    try {
      const rootResponse = await serverApp.app.request("/");
      expect(rootResponse.headers.get("cache-control")).toBe("no-store");

      const fallbackResponse = await serverApp.app.request("/threads/thr_123");
      expect(fallbackResponse.headers.get("cache-control")).toBe("no-store");

      const assetResponse = await serverApp.app.request(
        "/assets/index-test.js",
      );
      expect(assetResponse.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );

      const apiMissResponse = await serverApp.app.request(
        "/api/v1/does-not-exist.js",
      );
      const apiMissBody = await apiMissResponse.text();
      expect(apiMissResponse.status).toBe(404);
      expect(apiMissResponse.headers.get("content-type")).toBe(
        "application/json",
      );
      expect(apiMissBody).not.toContain("index-test.js");
      expect(JSON.parse(apiMissBody)).toMatchObject({
        code: "not_found",
      });
    } finally {
      await serverApp.closeWebSockets();
      await harness.cleanup();
      await rm(staticDir, { force: true, recursive: true });
    }
  });

  it("does not enable UI-source recovery for shipped HTML", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "bb-server-static-"));
    await writeFile(
      join(staticDir, "index.html"),
      '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    );

    const harness = await createTestAppHarness();
    const serverApp = createApp(harness.deps, {
      staticDir,
      appDir: staticDir,
    });
    try {
      const response = await serverApp.app.request("/");
      const body = await response.text();

      expect(body).toContain("data-bb-recovery-shim");
      expect(body).toContain('data-bb-ui-source-recovery="disabled"');
      expect(body).toContain("var RECOVERY_ENABLED = false;");
    } finally {
      await serverApp.closeWebSockets();
      await harness.cleanup();
      await rm(staticDir, { force: true, recursive: true });
    }
  });

  it("enables UI-source recovery for active fork HTML", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "bb-server-static-"));
    await writeFile(
      join(staticDir, "index.html"),
      '<!doctype html><html><head></head><body>shipped</body></html>',
    );

    const harness = await createTestAppHarness();
    setExperiments(harness.db, {
      claudeCodeMockCliTraffic: false,
      popoutChat: false,
      popoutChatHotkey: "Alt+Space",
      uiForking: true,
    });
    const uiDir = join(harness.config.dataDir, "ui");
    await mkdir(join(uiDir, "dist"), { recursive: true });
    await writeFile(
      join(harness.config.dataDir, "ui-state.json"),
      JSON.stringify({ active: "fork", status: "ready" }),
      "utf8",
    );
    await writeFile(
      join(uiDir, "dist", "index.html"),
      '<!doctype html><html><head></head><body>fork</body></html>',
    );

    const serverApp = createApp(harness.deps, {
      staticDir,
      appDir: staticDir,
    });
    try {
      const response = await serverApp.app.request("/");
      const body = await response.text();

      expect(body).toContain("fork");
      expect(body).toContain('data-bb-ui-source-recovery="enabled"');
      expect(body).toContain("var RECOVERY_ENABLED = true;");
    } finally {
      await serverApp.closeWebSockets();
      await harness.cleanup();
      await rm(staticDir, { force: true, recursive: true });
    }
  });
});
