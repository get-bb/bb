import { describe, expect, it } from "vitest";
import { withoutBridgeRuntimeEnv } from "./bridge-runtime-env.js";

describe("bridge runtime env", () => {
  it("removes bridge-only Electron runtime flags from child env", () => {
    const sourceEnv = {
      ELECTRON_RUN_AS_NODE: "1",
      PATH: "/usr/bin",
      BB_THREAD_ID: "thr_123",
    };

    expect(withoutBridgeRuntimeEnv(sourceEnv)).toEqual({
      PATH: "/usr/bin",
      BB_THREAD_ID: "thr_123",
    });
    expect(sourceEnv.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
