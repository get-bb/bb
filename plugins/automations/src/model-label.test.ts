import { describe, expect, it } from "vitest";
import {
  formatAutomationModelLabel,
  formatAutomationProviderLabel,
} from "../lib/model-label.js";

describe("automation model labels", () => {
  it.each([
    ["codex", "gpt-5", "5"],
    ["codex", "gpt-5.4-mini", "5.4 Mini"],
    ["claude-code", "claude-sonnet-4-6", "Sonnet 4.6"],
    ["custom-provider", "custom-model-v2", "Custom Model v2"],
  ])("formats %s/%s as %s", (providerId, model, expected) => {
    expect(formatAutomationModelLabel(model, providerId)).toBe(expected);
  });

  it.each([
    ["codex", "Codex"],
    ["claude-code", "Claude"],
    ["openai-compatible", "OpenAI"],
    ["custom-provider", "Custom-provider"],
  ])("formats provider %s as %s", (providerId, expected) => {
    expect(formatAutomationProviderLabel(providerId)).toBe(expected);
  });
});
