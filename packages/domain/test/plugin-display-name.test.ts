import { describe, expect, it } from "vitest";
import { splitPluginDisplayName } from "../src/plugin-display-name.js";

const experimental = { label: "Experimental", tone: "attention" };

describe("splitPluginDisplayName", () => {
  it.each([
    ["Account Pooler [Experimental]", "Account Pooler", experimental],
    ["Modal Sandbox [experimental]  ", "Modal Sandbox", experimental],
    [
      "ACP providers [New adapter]",
      "ACP providers",
      { label: "New adapter", tone: "neutral" },
    ],
    ["Lab[ Beta ]", "Lab", { label: "Beta", tone: "neutral" }],
    ["Storage & retention", "Storage & retention", null],
    ["[Experimental]", "[Experimental]", null],
    ["Lab []", "Lab []", null],
    ["Lab [Beta] x", "Lab [Beta] x", null],
    ["Lab [[Experimental]]", "Lab [[Experimental]]", null],
    ["Lab [constructor]", "Lab", { label: "constructor", tone: "neutral" }],
    [
      "Lab [a label that is far too long to show]",
      "Lab [a label that is far too long to show]",
      null,
    ],
  ])("splits %j", (displayName, name, tag) => {
    expect(splitPluginDisplayName(displayName)).toEqual({ name, tag });
  });

  it("stays linear on long whitespace runs", () => {
    const started = performance.now();
    splitPluginDisplayName(`a${" ".repeat(200_000)}x`);
    splitPluginDisplayName(`a${" ".repeat(200_000)}[Beta]`);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
