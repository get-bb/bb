import { describe, expect, it } from "vitest";
import {
  applySessionOptionSelectionPatch,
  coreThreadStateSchema,
  pendingSessionOptionSelections,
  type ThreadSessionOption,
} from "../src/thread-provider-state.js";

const options: ThreadSessionOption[] = [
  {
    type: "select",
    id: "mode",
    label: "Mode",
    value: "plan",
    values: [
      { id: "plan", label: "Plan" },
      { id: "build", label: "Build" },
    ],
  },
  { type: "boolean", id: "web", label: "Web search", value: false },
];

describe("session option selections", () => {
  it("keeps only choices the agent still offers and has not applied yet", () => {
    expect(
      pendingSessionOptionSelections(options, {
        mode: "build",
        web: false,
        gone: "anything",
      }),
    ).toEqual({ mode: "build" });
    expect(
      pendingSessionOptionSelections(options, { mode: "yolo", web: "true" }),
    ).toEqual({});
  });

  it("merges a patch into the existing choices, dropping cleared and already-current ones", () => {
    expect(
      applySessionOptionSelectionPatch({
        options,
        selections: { mode: "build" },
        patch: { web: true },
      }),
    ).toEqual({ ok: true, selections: { mode: "build", web: true } });
    expect(
      applySessionOptionSelectionPatch({
        options,
        selections: { mode: "build", web: true },
        patch: { mode: "plan", web: null },
      }),
    ).toEqual({ ok: true, selections: {} });
  });

  it("explains which options and values exist when a patch names one that does not", () => {
    expect(
      applySessionOptionSelectionPatch({
        options,
        selections: {},
        patch: { tone: "calm" },
      }),
    ).toEqual({
      ok: false,
      message:
        'This thread\'s agent has no session option "tone". Available options: mode, web.',
    });
    expect(
      applySessionOptionSelectionPatch({
        options,
        selections: {},
        patch: { mode: "yolo" },
      }),
    ).toEqual({
      ok: false,
      message:
        'Session option "mode" has no value "yolo". Available values: plan, build.',
    });
    expect(
      applySessionOptionSelectionPatch({
        options,
        selections: {},
        patch: { web: "true" },
      }),
    ).toEqual({
      ok: false,
      message: 'Session option "web" takes true or false.',
    });
    expect(
      applySessionOptionSelectionPatch({
        options: [],
        selections: {},
        patch: { mode: "plan" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("lets a provider write the live state kinds but not the server's selection kind", () => {
    expect(coreThreadStateSchema("bb/session-options")).not.toBeNull();
    expect(coreThreadStateSchema("bb/provider-commands")).not.toBeNull();
    expect(coreThreadStateSchema("bb/session-option-selections")).toBeNull();
    expect(coreThreadStateSchema("toString")).toBeNull();
  });
});
