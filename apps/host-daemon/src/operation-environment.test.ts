import { describe, expect, it } from "vitest";
import { operationEnvironment } from "./operation-environment.js";

describe("operation environment", () => {
  it("resolves server-relative values without mutating the daemon environment", () => {
    const base = { BB_SERVER_URL: "https://server.example" };
    expect(
      operationEnvironment(
        [
          {
            name: "GH_TOKEN",
            value: "secret",
            source: { core: "machine-git" },
            reason: "Git",
          },
          {
            name: "PROXY",
            value: { serverPath: "/proxy" },
            source: { core: "machine-git" },
            reason: "Proxy",
          },
        ],
        base,
      ),
    ).toEqual({
      ...base,
      GH_TOKEN: "secret",
      PROXY: "https://server.example/proxy",
    });
    expect(base).not.toHaveProperty("GH_TOKEN");
  });
});
