import { describe, expect, it } from "vitest";
import {
  createSecretStreamRedactor,
  operationEnvironment,
} from "./operation-environment.js";

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
            secret: true,
          },
          {
            name: "PROXY",
            value: { serverPath: "/proxy" },
            source: { core: "machine-git" },
            reason: "Proxy",
            secret: false,
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

  it("redacts terminal secrets split at every possible chunk boundary", () => {
    const secret = "ghp_private-token";
    for (let split = 0; split <= secret.length; split += 1) {
      const redactor = createSecretStreamRedactor([secret]);
      const output =
        redactor.push(`before ${secret.slice(0, split)}`) +
        redactor.push(`${secret.slice(split)} after`) +
        redactor.flush();
      expect(output).toBe("before [redacted] after");
    }
  });
});
