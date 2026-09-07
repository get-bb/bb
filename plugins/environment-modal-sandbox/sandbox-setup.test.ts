import { describe, expect, it } from "vitest";
import {
  providerAuthenticationScript,
  projectClonePath,
  shellQuote,
} from "./sandbox-setup.js";

describe("shellQuote", () => {
  it("keeps a single quote from ending the quoted word", () => {
    const quoted = shellQuote("it's; rm -rf /");
    expect(quoted).toBe(`'it'\\''s; rm -rf /'`);
  });

  it("neutralises substitution and command separators", () => {
    expect(shellQuote("$(id) `id` && echo x")).toBe("'$(id) `id` && echo x'");
  });
});

describe("providerAuthenticationScript", () => {
  it("authenticates Codex without putting its API key in the command", () => {
    const script = providerAuthenticationScript("codex", {
      OPENAI_API_KEY: "sk-secret",
    });

    expect(script).toContain(
      "printenv OPENAI_API_KEY | codex login --with-api-key",
    );
    expect(script).not.toContain("sk-secret");
  });

  it("prefers a Codex access token and leaves other providers alone", () => {
    expect(
      providerAuthenticationScript("codex", {
        CODEX_ACCESS_TOKEN: "access-secret",
        OPENAI_API_KEY: "sk-secret",
      }),
    ).toContain("codex login --with-access-token");
    expect(
      providerAuthenticationScript("claude-code", {
        ANTHROPIC_API_KEY: "secret",
      }),
    ).toBeNull();
  });
});

describe("projectClonePath", () => {
  it("slugs a name that is not a safe path segment", () => {
    expect(projectClonePath("BB / Core (main)")).toBe(
      "/workspace/bb-core-main",
    );
  });

  it("falls back when nothing survives slugging", () => {
    expect(projectClonePath("///")).toBe("/workspace/project");
  });
});
