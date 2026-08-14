import { describe, expect, it, vi } from "vitest";
import {
  getConnectIsRemote,
  runWithConnectRemote,
} from "../../src/request-context.js";
import { deferAfterResponse } from "../../src/services/lib/response-deferral.js";

describe("response deferral", () => {
  it("does not carry Connect status into background work", async () => {
    const connectIsRemote = await new Promise<boolean>((resolve) => {
      runWithConnectRemote(true, () => {
        deferAfterResponse({
          config: { isDevelopment: false },
          logger: { warn: vi.fn() },
          name: "test work",
          work: async () => resolve(getConnectIsRemote()),
        });
      });
    });

    expect(connectIsRemote).toBe(false);
  });
});
