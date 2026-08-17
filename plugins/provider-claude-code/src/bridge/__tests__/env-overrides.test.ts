import { describe, expect, it } from "vitest";
import { buildShellEnvironmentPolicyConfig } from "@get-bb/plugin-sdk/provider-bridge";
import { extractEnvOverrides } from "../env-overrides.js";

describe("extractEnvOverrides", () => {
  it("round-trips shell environment policy overrides", () => {
    expect(
      extractEnvOverrides(
        buildShellEnvironmentPolicyConfig({ API_URL: "https://example.com" }),
      ),
    ).toEqual({ API_URL: "https://example.com" });
  });
});
