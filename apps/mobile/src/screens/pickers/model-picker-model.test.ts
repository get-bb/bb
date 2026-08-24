import { describe, expect, it } from "vitest";
import type { ModelPickerOption } from "@/data/compose";
import {
  buildFuzzyRegex,
  filterModelOptions,
  showModelSearch,
} from "./model-picker-model";

const option = (
  value: string,
  label: string,
  routeProviderId?: string,
): ModelPickerOption => ({
  value,
  label,
  description: "",
  ...(routeProviderId ? { routeProviderId } : {}),
});

const fresh = [
  option("anthropic/claude-opus-5", "Claude Opus 5", "anthropic"),
  option("openai/gpt-5.6", "GPT-5.6", "openai"),
  option("openrouter/qwen3-coder", "Qwen3 Coder", "openrouter"),
  option("ollama/llama4", "Llama 4", "ollama"),
];
const retired = [option("openai/gpt-4-turbo", "GPT-4 Turbo", "openai")];

describe("buildFuzzyRegex", () => {
  it("matches characters in order with gaps", () => {
    expect(buildFuzzyRegex("gpt4").test("GPT-4 Turbo")).toBe(true);
    expect(buildFuzzyRegex("4gpt").test("GPT-4 Turbo")).toBe(false);
  });

  it("escapes regex metacharacters in the query", () => {
    expect(buildFuzzyRegex("5.6").test("GPT-5.6")).toBe(true);
    expect(() => buildFuzzyRegex("(")).not.toThrow();
  });
});

describe("filterModelOptions", () => {
  it("passes both lists through untouched for an empty query", () => {
    const result = filterModelOptions(fresh, retired, "   ");
    expect(result.isSearching).toBe(false);
    expect(result.modelOptions).toBe(fresh);
    expect(result.moreModelOptions).toBe(retired);
  });

  it("filters fresh and retired lists independently by label", () => {
    const result = filterModelOptions(fresh, retired, "gpt");
    expect(result.isSearching).toBe(true);
    expect(result.modelOptions.map((o) => o.value)).toEqual(["openai/gpt-5.6"]);
    expect(result.moreModelOptions.map((o) => o.value)).toEqual([
      "openai/gpt-4-turbo",
    ]);
  });

  it("matches the route provider so Pi sub-providers are searchable", () => {
    const result = filterModelOptions(fresh, retired, "openrouter");
    expect(result.modelOptions.map((o) => o.value)).toEqual([
      "openrouter/qwen3-coder",
    ]);
  });

  it("matches the raw model id when the label differs", () => {
    const result = filterModelOptions(fresh, retired, "llama4");
    expect(result.modelOptions.map((o) => o.value)).toEqual(["ollama/llama4"]);
  });
});

describe("showModelSearch", () => {
  it("counts fresh and retired models together against the threshold", () => {
    expect(showModelSearch(fresh, retired)).toBe(false);
    expect(showModelSearch(fresh, [...retired, option("x/y", "Y", "x")])).toBe(
      true,
    );
  });
});
