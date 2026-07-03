import { brotliCompressSync, gzipSync } from "node:zlib";
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
    const bundleBody = `console.log('${"fresh bundle ".repeat(600)}');`;
    const bundlePath = join(staticDir, "assets", "index-test.js");
    const brotliBundle = brotliCompressSync(Buffer.from(bundleBody));
    const gzipBundle = gzipSync(Buffer.from(bundleBody));
    await writeFile(bundlePath, bundleBody);
    await writeFile(`${bundlePath}.br`, brotliBundle);
    await writeFile(`${bundlePath}.gz`, gzipBundle);
    await writeFile(
      join(staticDir, "assets", "dynamic-only.js"),
      `console.log('${"dynamic bundle ".repeat(600)}');`,
    );
    await writeFile(
      join(staticDir, "manifest.webmanifest"),
      JSON.stringify({ name: "bb", icons: [] }),
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

      const brotliAssetResponse = await serverApp.app.request(
        "/assets/index-test.js",
        { headers: { "accept-encoding": "br, gzip" } },
      );
      expect(brotliAssetResponse.headers.get("content-encoding")).toBe("br");
      expect(
        brotliAssetResponse.headers
          .get("vary")
          ?.split(",")
          .map((value) => value.trim()),
      ).toContain("Accept-Encoding");
      expect(brotliAssetResponse.headers.get("content-length")).toBe(
        String(brotliBundle.length),
      );
      expect((await brotliAssetResponse.arrayBuffer()).byteLength).toBe(
        brotliBundle.length,
      );

      const gzipAssetResponse = await serverApp.app.request(
        "/assets/index-test.js",
        { headers: { "accept-encoding": "gzip" } },
      );
      expect(gzipAssetResponse.headers.get("content-encoding")).toBe("gzip");
      expect(gzipAssetResponse.headers.get("content-length")).toBe(
        String(gzipBundle.length),
      );

      const gzipPreferredAssetResponse = await serverApp.app.request(
        "/assets/index-test.js",
        { headers: { "accept-encoding": "br;q=0, gzip;q=1" } },
      );
      expect(gzipPreferredAssetResponse.headers.get("content-encoding")).toBe(
        "gzip",
      );

      const dynamicCompressedAssetResponse = await serverApp.app.request(
        "/assets/dynamic-only.js",
        { headers: { "accept-encoding": "gzip" } },
      );
      expect(
        dynamicCompressedAssetResponse.headers.get("content-encoding"),
      ).toBe("gzip");
      expect(dynamicCompressedAssetResponse.headers.has("content-length")).toBe(
        false,
      );

      const manifestResponse = await serverApp.app.request(
        "/manifest.webmanifest",
      );
      expect(manifestResponse.headers.get("content-type")).toBe(
        "application/manifest+json",
      );
      expect(manifestResponse.headers.get("cache-control")).toBe("no-store");

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
      plugins: false,
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
