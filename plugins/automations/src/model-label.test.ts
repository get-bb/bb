import { describe, expect, it } from "vitest";
import {
  formatAutomationModelLabel,
  formatAutomationProviderLabel,
} from "../lib/model-label.js";

describe("automation model labels", () => {
  it.each([
    ["codex", "gpt-5", "5"],
    ["codex", "gpt-5.6-sol", "5.6 Sol"],
    ["codex", "gpt-5.4-mini", "5.4 Mini"],
    ["claude-code", "claude-sonnet-4-6", "Sonnet 4.6"],
    ["claude-code", "claude-opus-5[1m]", "Opus 5 (1M)"],
    ["claude-code", "claude-opus-4-8[1m]", "Opus 4.8 (1M)"],
    ["claude-code", "claude-sonnet-4-6[200k]", "Sonnet 4.6 (200K)"],
    ["claude-code", "claude-opus-5[beta]", "Opus 5[beta]"],
    ["custom-provider", "custom-model-v2", "Custom Model v2"],
  ])("formats %s/%s as %s", (providerId, model, expected) => {
    expect(formatAutomationModelLabel(model, providerId)).toBe(expected);
  });

  it.each([
    ["codex", "Codex"],
    ["claude-code", "Claude"],
    ["openai-compatible", "OpenAI"],
    ["pi", "Pi"],
    ["acp-cursor", "Cursor"],
    ["custom-provider", "Custom-provider"],
  ])("formats provider %s as %s", (providerId, expected) => {
    expect(formatAutomationProviderLabel(providerId)).toBe(expected);
  });
});
