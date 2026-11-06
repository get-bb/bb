import { describe, expect, it } from "vitest";
import {
  encodeProviderValue,
  parseEnvironmentValue,
} from "./environment-picker-value";

describe("provider environment values", () => {
  it("round-trips provider ids with dashes, underscores, and digits", () => {
    const value = encodeProviderValue("docker-sandbox");
    expect(value).toBe("provider:docker-sandbox");
    expect(parseEnvironmentValue(value)).toEqual({
      type: "provider",
      environmentProviderId: "docker-sandbox",
    });
    expect(parseEnvironmentValue(encodeProviderValue("wt_2"))).toEqual({
      type: "provider",
      environmentProviderId: "wt_2",
    });
  });

  it("rejects malformed provider values", () => {
    expect(parseEnvironmentValue("provider:")).toBeNull();
    expect(parseEnvironmentValue("provider:a/b")).toBeNull();
    expect(parseEnvironmentValue("provider:bad*id")).toBeNull();
    expect(parseEnvironmentValue(`provider:${"a".repeat(65)}`)).toBeNull();
  });
});
