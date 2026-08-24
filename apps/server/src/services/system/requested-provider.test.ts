import { describe, expect, it } from "vitest";

import {
  CANONICAL_GROK_PROVIDER_ID,
  resolveRequestedProviderId,
} from "./requested-provider.js";

describe("resolveRequestedProviderId", () => {
  it("maps grok and xai onto the Grok Build ACP provider", () => {
    expect(resolveRequestedProviderId("grok")).toBe(CANONICAL_GROK_PROVIDER_ID);
    expect(resolveRequestedProviderId("xai")).toBe(CANONICAL_GROK_PROVIDER_ID);
    expect(resolveRequestedProviderId(" acp-grok ")).toBe(
      CANONICAL_GROK_PROVIDER_ID,
    );
  });

  it("leaves other provider ids unchanged", () => {
    expect(resolveRequestedProviderId("codex")).toBe("codex");
    expect(resolveRequestedProviderId("claude-code")).toBe("claude-code");
    expect(resolveRequestedProviderId("acp-opencode")).toBe("acp-opencode");
  });
});
