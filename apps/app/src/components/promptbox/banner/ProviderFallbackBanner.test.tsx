import { describe, expect, it } from "vitest";
import { describeProviderFallback } from "./ProviderFallbackBanner";

describe("describeProviderFallback", () => {
  it("names both providers, the full window, and the reset time", () => {
    const text = describeProviderFallback({
      fallback: {
        providerId: "codex",
        fromProviderId: "claude-code",
        exhausted: {
          label: "Weekly limit",
          resetsAt: "2026-11-22T11:00:00.000Z",
        },
      },
      fromName: "Claude Code",
      toName: "Codex",
    });
    expect(text.title).toBe("Starts on Codex");
    expect(text.description).toMatch(
      /^Claude Code is out of usage \(Weekly limit\) until .+\.$/,
    );
  });

  it("leaves out an unknown reset time", () => {
    expect(
      describeProviderFallback({
        fallback: {
          providerId: "codex",
          fromProviderId: "claude-code",
          exhausted: { label: "Weekly limit", resetsAt: null },
        },
        fromName: "Claude Code",
        toName: "Codex",
      }).description,
    ).toBe("Claude Code is out of usage (Weekly limit).");
  });
});
