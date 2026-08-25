import { describe, expect, it } from "vitest";
import {
  executionPickerOrderToken,
  executionPickerSubmission,
  findExecutionPickerEntry,
  mergePluginInputs,
  orderExecutionPickerValues,
  parseExecutionPickerOrderToken,
  type ExecutionPickerValue,
} from "./execution-picker-selection";
import type { PluginExecutionPickerEntrySlot } from "@/lib/plugin-slots";

function entry(
  pluginId: string,
  id: string,
  pluginInput: unknown = { route: "auto" },
): PluginExecutionPickerEntrySlot {
  return {
    pluginId,
    generation: 1,
    id,
    label: `${pluginId}/${id}`,
    pluginInput: pluginInput as PluginExecutionPickerEntrySlot["pluginInput"],
  };
}

describe("execution picker order tokens", () => {
  it("round-trips both arms", () => {
    const values: ExecutionPickerValue[] = [
      { kind: "provider", providerId: "codex" },
      { kind: "plugin-entry", pluginId: "model-router", entryId: "auto" },
    ];
    for (const value of values) {
      expect(
        parseExecutionPickerOrderToken(executionPickerOrderToken(value)),
      ).toEqual(value);
    }
  });

  it("namespaces plugin entries so they cannot collide with a provider id", () => {
    expect(
      executionPickerOrderToken({
        kind: "plugin-entry",
        pluginId: "model-router",
        entryId: "auto",
      }),
    ).toBe("plugin:model-router:auto");
  });

  it("rejects malformed tokens instead of guessing an entry", () => {
    // A wrong guess here would silently select a DIFFERENT plugin's entry.
    expect(parseExecutionPickerOrderToken("")).toBeNull();
    expect(parseExecutionPickerOrderToken("plugin:model-router")).toBeNull();
    expect(parseExecutionPickerOrderToken("plugin:a:b:c")).toBeNull();
    expect(parseExecutionPickerOrderToken("plugin::auto")).toBeNull();
    expect(parseExecutionPickerOrderToken("plugin:router:")).toBeNull();
    expect(parseExecutionPickerOrderToken("weird:thing")).toBeNull();
  });
});

describe("orderExecutionPickerValues", () => {
  const entries = [entry("zeta", "auto"), entry("alpha", "auto")];

  it("puts unpinned plugin entries after the providers, deterministically", () => {
    expect(
      orderExecutionPickerValues({
        providerIds: ["codex", "claude"],
        entries,
        providerOrder: [],
      }).map(executionPickerOrderToken),
    ).toEqual(["codex", "claude", "plugin:alpha:auto", "plugin:zeta:auto"]);
  });

  it("lets a pinned plugin entry lead the providers", () => {
    expect(
      orderExecutionPickerValues({
        providerIds: ["codex", "claude"],
        entries,
        providerOrder: ["plugin:zeta:auto", "claude"],
      }).map(executionPickerOrderToken),
    ).toEqual(["plugin:zeta:auto", "claude", "codex", "plugin:alpha:auto"]);
  });

  it("ignores pinned tokens that name nothing registered", () => {
    expect(
      orderExecutionPickerValues({
        providerIds: ["codex"],
        entries: [],
        providerOrder: ["plugin:gone:auto", "codex"],
      }).map(executionPickerOrderToken),
    ).toEqual(["codex"]);
  });

  it("keeps server provider order for everything unpinned", () => {
    expect(
      orderExecutionPickerValues({
        providerIds: ["a", "b", "c"],
        entries: [],
        providerOrder: ["c"],
      }).map(executionPickerOrderToken),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("executionPickerSubmission", () => {
  const entries = [entry("model-router", "auto", { mode: "rules" })];

  it("sends the provider and no plugin input for a provider selection", () => {
    expect(
      executionPickerSubmission({
        value: { kind: "provider", providerId: "codex" },
        entries,
        fallbackProviderId: "claude",
      }),
    ).toEqual({ providerId: "codex" });
  });

  it("omits providerId entirely for a live plugin entry", () => {
    const submission = executionPickerSubmission({
      value: { kind: "plugin-entry", pluginId: "model-router", entryId: "auto" },
      entries,
      fallbackProviderId: "claude",
    });
    // Omitted, not undefined-valued: the server must resolve the project
    // default so the gate's choice is what gets recorded.
    expect("providerId" in submission).toBe(false);
    expect(submission.pluginInputs).toEqual({
      "model-router": { mode: "rules" },
    });
  });

  it("falls back to the project default when the entry's plugin is gone", () => {
    expect(
      executionPickerSubmission({
        value: {
          kind: "plugin-entry",
          pluginId: "model-router",
          entryId: "auto",
        },
        entries: [],
        fallbackProviderId: "claude",
      }),
    ).toEqual({ providerId: "claude" });
  });

  it("does not match an entry id belonging to another plugin", () => {
    expect(
      findExecutionPickerEntry(
        { kind: "plugin-entry", pluginId: "other", entryId: "auto" },
        entries,
      ),
    ).toBeNull();
  });
});

describe("mergePluginInputs", () => {
  it("omits the field entirely when there is nothing to send", () => {
    expect(mergePluginInputs(undefined, undefined)).toBeUndefined();
    expect(mergePluginInputs({}, {})).toBeUndefined();
  });

  it("lets the picker entry win a collision with a composer control", () => {
    expect(
      mergePluginInputs({ router: "composer" }, { router: "picker" }),
    ).toEqual({ router: "picker" });
  });

  it("keeps inputs addressed to different plugins", () => {
    expect(mergePluginInputs({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });
});
