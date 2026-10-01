import { describe, expect, it } from "vitest";
import { parseBbAppManagedConfig } from "../src/bb-app-managed-config.js";

function parseWithWarnings(rawConfig: unknown) {
  const warnings: Record<string, unknown>[] = [];
  const parsed = parseBbAppManagedConfig(rawConfig, {
    logger: {
      warn(fields): void {
        warnings.push(fields);
      },
    },
  });
  return { parsed, warnings };
}

describe("parseBbAppManagedConfig", () => {
  it("drops the removed AI service keys with one warning", () => {
    const { parsed, warnings } = parseWithWarnings({
      config: {
        BB_APP_URL: "https://bb.example.test",
        BB_INFERENCE: "codex/gpt-5.6-luna",
        BB_TRANSCRIPTION: "openai/gpt-4o-mini-transcribe",
      },
    });

    expect(parsed.config).toEqual({ BB_APP_URL: "https://bb.example.test" });
    expect(warnings).toEqual([{ keys: ["BB_INFERENCE", "BB_TRANSCRIPTION"] }]);
  });

  it("parses shared user and project skill roots", () => {
    expect(
      parseBbAppManagedConfig({
        sharedSkillRoots: {
          user: [".agents/skills"],
          project: [".agents/skills"],
        },
      }).sharedSkillRoots,
    ).toEqual({
      user: [".agents/skills"],
      project: [".agents/skills"],
    });
  });

  it("parses custom models with a known provider", () => {
    const parsed = parseBbAppManagedConfig({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview[1m]",
          displayName: "Example Preview (1M)",
        },
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
    });

    expect(parsed.customModels).toHaveLength(2);
    expect(parsed.customModels?.[0]?.providerId).toBe("claude-code");
    expect(parsed.customModels?.[1]?.displayName).toBeUndefined();
  });

  it("parses custom models with dynamic ACP provider ids", () => {
    const parsed = parseBbAppManagedConfig({
      customModels: [
        {
          providerId: "acp-opencode",
          model: "my-proxy/custom-model",
          displayName: "My Proxy Custom Model",
        },
        { providerId: "acp-my-agent", model: "provider/model" },
      ],
    });

    expect(parsed.customModels).toHaveLength(2);
    expect(parsed.customModels?.[0]?.providerId).toBe("acp-opencode");
    expect(parsed.customModels?.[1]?.providerId).toBe("acp-my-agent");
  });

  it("drops malformed acp-* custom model provider ids with a warning", () => {
    for (const providerId of ["acp-", "acp-Bad-Agent", "acp--x"]) {
      const { parsed, warnings } = parseWithWarnings({
        customModels: [{ providerId, model: "provider/model" }],
      });
      expect(parsed.customModels).toEqual([]);
      expect(warnings).toHaveLength(1);
    }
  });

  it("drops invalid custom model entries with warnings at the config boundary", () => {
    const { parsed, warnings } = parseWithWarnings({
      customModels: [
        { providerId: "acp-opencode", model: "my-proxy/custom-model" },
        { providerId: "not-a-provider", model: "other-model" },
        { providerId: "claude-code", model: "" },
      ],
    });

    expect(parsed.customModels).toEqual([
      { providerId: "acp-opencode", model: "my-proxy/custom-model" },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.index)).toEqual([1, 2]);
  });

  it("drops custom models with an unknown provider", () => {
    const { parsed, warnings } = parseWithWarnings({
      customModels: [
        { providerId: "not-a-provider", model: "claude-example-preview" },
      ],
    });

    expect(parsed.customModels).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.index).toBe(0);
    expect(warnings[0]?.error).toMatch(/"providerId"/u);
  });

  it("drops custom models with an empty model id", () => {
    const { parsed, warnings } = parseWithWarnings({
      customModels: [{ providerId: "claude-code", model: "" }],
    });

    expect(parsed.customModels).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("loads a config that still carries the removed customAcpAgents array, drops it, and warns", () => {
    const { parsed, warnings } = parseWithWarnings({
      config: { BB_APP_URL: "https://bb.example.test" },
      customAcpAgents: [
        { id: "my-agent", displayName: "My Agent", command: "my-agent" },
        { id: "not a valid agent" },
      ],
      customModels: [{ providerId: "codex", model: "gpt-5.4" }],
    });

    expect(parsed).toEqual({
      config: { BB_APP_URL: "https://bb.example.test" },
      customModels: [{ providerId: "codex", model: "gpt-5.4" }],
    });
    expect(warnings).toEqual([{ key: "customAcpAgents" }]);
  });

  it("still rejects an unknown top-level key", () => {
    expect(() => parseBbAppManagedConfig({ customAgents: [] })).toThrow(
      /Unrecognized key/u,
    );
  });

  it("refuses the removed `absolute` side by name on sharedSkillRoots", () => {
    expect(() =>
      parseBbAppManagedConfig({
        sharedSkillRoots: { user: [], project: [], absolute: ["/srv/skills"] },
      }),
    ).toThrow(/Unrecognized key/u);
  });
});
