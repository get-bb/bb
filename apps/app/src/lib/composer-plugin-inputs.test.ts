import { beforeEach, describe, expect, it } from "vitest";
import {
  clearComposerPluginInputsForPlugin,
  peekComposerPluginInputs,
  resetComposerPluginInputsForTest,
  setComposerPluginInput,
  takeComposerPluginInputs,
} from "./composer-plugin-inputs";

describe("composer plugin inputs", () => {
  beforeEach(() => {
    resetComposerPluginInputsForTest();
  });

  it("attaches a plugin's input to its own composer only", () => {
    setComposerPluginInput("thread:a", "router", { skip: true });
    expect(peekComposerPluginInputs("thread:a")).toEqual({
      router: { skip: true },
    });
    // A different composer must not inherit it — otherwise a control set on
    // one thread would silently steer a send from another.
    expect(peekComposerPluginInputs("thread:b")).toBeUndefined();
  });

  it("clears after the submit that consumed it", () => {
    setComposerPluginInput("thread:a", "router", { skip: true });
    expect(takeComposerPluginInputs("thread:a")).toEqual({
      router: { skip: true },
    });
    // The whole point of the transient store: the next message must not
    // silently carry the previous message's per-message choice.
    expect(takeComposerPluginInputs("thread:a")).toBeUndefined();
    expect(peekComposerPluginInputs("thread:a")).toBeUndefined();
  });

  it("replaces rather than accumulates a plugin's own value", () => {
    setComposerPluginInput("thread:a", "router", { mode: "one" });
    setComposerPluginInput("thread:a", "router", { mode: "two" });
    expect(peekComposerPluginInputs("thread:a")).toEqual({
      router: { mode: "two" },
    });
  });

  it("keeps different plugins' inputs side by side", () => {
    setComposerPluginInput("thread:a", "router", 1);
    setComposerPluginInput("thread:a", "sandbox", "large");
    expect(peekComposerPluginInputs("thread:a")).toEqual({
      router: 1,
      sandbox: "large",
    });
  });

  it("treats null as an explicit clear of just that plugin", () => {
    setComposerPluginInput("thread:a", "router", 1);
    setComposerPluginInput("thread:a", "sandbox", 2);
    setComposerPluginInput("thread:a", "router", null);
    expect(peekComposerPluginInputs("thread:a")).toEqual({ sandbox: 2 });
    setComposerPluginInput("thread:a", "sandbox", null);
    expect(peekComposerPluginInputs("thread:a")).toBeUndefined();
  });

  it("ignores writes with no composer to attach to", () => {
    setComposerPluginInput(null, "router", 1);
    expect(peekComposerPluginInputs(null)).toBeUndefined();
    expect(takeComposerPluginInputs(null)).toBeUndefined();
  });

  it("drops one plugin's inputs across every composer when it unloads", () => {
    setComposerPluginInput("thread:a", "router", 1);
    setComposerPluginInput("thread:b", "router", 2);
    setComposerPluginInput("thread:b", "sandbox", 3);
    clearComposerPluginInputsForPlugin("router");
    expect(peekComposerPluginInputs("thread:a")).toBeUndefined();
    expect(peekComposerPluginInputs("thread:b")).toEqual({ sandbox: 3 });
  });
});
