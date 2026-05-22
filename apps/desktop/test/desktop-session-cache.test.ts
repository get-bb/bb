import { describe, expect, it } from "vitest";
import {
  clearPackagedSessionHttpCache,
  type DesktopSessionHttpCache,
} from "../src/desktop-session-cache.js";

class DesktopSessionHttpCacheStub implements DesktopSessionHttpCache {
  clearCacheCalls = 0;

  async clearCache(): Promise<void> {
    this.clearCacheCalls += 1;
  }
}

describe("desktop session cache clearing", () => {
  it("clears Electron's HTTP cache for packaged launches", async () => {
    const session = new DesktopSessionHttpCacheStub();

    await clearPackagedSessionHttpCache({
      isPackaged: true,
      session,
    });

    expect(session.clearCacheCalls).toBe(1);
  });

  it("leaves the session cache alone in development", async () => {
    const session = new DesktopSessionHttpCacheStub();

    await clearPackagedSessionHttpCache({
      isPackaged: false,
      session,
    });

    expect(session.clearCacheCalls).toBe(0);
  });
});
