import { describe, expect, it } from "vitest";
import {
  applySessionOptionSelectionPatch,
  collectDeclaredSessionOptions,
  coreThreadStateSchema,
  describeSessionOptionConflict,
  effectiveSessionOptionSelections,
  modelSessionOptionConflict,
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

describe("options declared by a provider's models", () => {
  const daybreak = (value: boolean, fixed?: boolean): ThreadSessionOption => ({
    type: "boolean",
    id: "daybreak",
    label: "Daybreak",
    value,
    ...(fixed === undefined ? {} : { fixed }),
  });
  const mode = (ids: string[]): ThreadSessionOption => ({
    type: "select",
    id: "mode",
    label: "Mode",
    value: ids[0] ?? "",
    values: ids.map((id) => ({ id, label: id })),
  });
  const standardOnly = { sessionOptions: [daybreak(false, true)] };
  const either = { sessionOptions: [daybreak(false), mode(["build", "plan"])] };
  const daybreakOnly = { sessionOptions: [daybreak(true, true)] };
  const askOnly = { sessionOptions: [mode(["ask"])] };

  it("offers each option once, switchable when any model allows both values, with every value some model lists", () => {
    expect(
      collectDeclaredSessionOptions([
        standardOnly,
        either,
        daybreakOnly,
        askOnly,
      ]),
    ).toEqual([daybreak(false), mode(["build", "plan", "ask"])]);
    expect(collectDeclaredSessionOptions([daybreakOnly, standardOnly])).toEqual(
      [daybreak(false, false)],
    );
    expect(collectDeclaredSessionOptions([{}, { sessionOptions: [] }])).toEqual(
      [],
    );
  });

  it("names the choice that rules a model out, and nothing for a model that can run", () => {
    expect(modelSessionOptionConflict(either, { daybreak: true })).toBeNull();
    expect(modelSessionOptionConflict({}, { daybreak: true })).toBeNull();
    expect(modelSessionOptionConflict(standardOnly, {})).toBeNull();

    const on = modelSessionOptionConflict(standardOnly, { daybreak: true });
    expect(on).toMatchObject({ optionId: "daybreak", selected: true });
    expect(on && describeSessionOptionConflict(on)).toBe(
      "Turn off Daybreak to use this model",
    );
    const off = modelSessionOptionConflict(daybreakOnly, { daybreak: false });
    expect(off && describeSessionOptionConflict(off)).toBe(
      "Turn on Daybreak to use this model",
    );
    const select = modelSessionOptionConflict(askOnly, { mode: "plan" });
    expect(select && describeSessionOptionConflict(select)).toBe(
      "Not available with Mode set to plan",
    );
  });

  it("keeps only choices the declared options accept", () => {
    expect(
      effectiveSessionOptionSelections([daybreak(false), mode(["build"])], {
        daybreak: true,
        mode: "plan",
        gone: "x",
      }),
    ).toEqual({ daybreak: true });
  });
});
