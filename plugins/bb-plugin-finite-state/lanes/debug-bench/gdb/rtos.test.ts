import { describe, expect, it } from "vitest";
import { readRtosState, RtosTasksUnavailableError } from "./rtos.js";

describe("RTOS task discovery", () => {
  it("reports an honest server-produced empty list", async () => {
    await expect(readRtosState(async () => ({
      kind: "result",
      token: 1,
      class: "done",
      results: { threads: [] },
    }))).resolves.toEqual({ method: "server", tasks: [] });
  });

  it("surfaces unavailable when server awareness fails without a symbol walker", async () => {
    await expect(readRtosState(async () => {
      throw new Error("RTOS awareness unavailable");
    })).rejects.toBeInstanceOf(RtosTasksUnavailableError);
  });
});
