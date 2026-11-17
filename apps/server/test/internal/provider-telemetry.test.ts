import { describe, expect, it } from "vitest";
import { reportedProviderId } from "../../src/services/system/provider-telemetry.js";

describe("reportedProviderId", () => {
  it("reports shipped provider ids and redacts custom ones", () => {
    expect(reportedProviderId("claude-code")).toBe("claude-code");
    expect(reportedProviderId("acp-hermes-agent")).toBe("acp-hermes-agent");
    expect(reportedProviderId("acp-my-private-agent")).toBe("other");
  });
});
