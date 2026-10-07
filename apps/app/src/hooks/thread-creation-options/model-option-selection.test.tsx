// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderModelOption } from "@bb/domain";
import { useModelOptionSelection } from "./model-option-selection";

const daybreak: ProviderModelOption = {
  id: "daybreak",
  label: "Daybreak",
  values: [
    { id: "off", label: "Off" },
    { id: "on", label: "On" },
  ],
  defaultValue: "off",
};
const codex = { id: "codex", experimental_modelOptions: [daybreak] };

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("useModelOptionSelection", () => {
  it("shows the thread's values and sends nothing until the user changes them", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) =>
        useModelOptionSelection({
          scope: "thread",
          provider: codex,
          initialValues: { daybreak: "on" },
          resetKey,
        }),
      { initialProps: { resetKey: "thr_1" } },
    );

    expect(result.current.values).toEqual({ daybreak: "on" });
    expect(result.current.requestValues).toBeUndefined();

    act(() => result.current.setValues({ daybreak: "off" }));
    expect(result.current.values).toEqual({ daybreak: "off" });
    expect(result.current.requestValues).toEqual({ daybreak: "off" });

    rerender({ resetKey: "thr_2" });
    expect(result.current.values).toEqual({ daybreak: "on" });
    expect(result.current.requestValues).toBeUndefined();
  });

  it("remembers a new-thread choice per provider and always sends it", () => {
    const first = renderHook(() =>
      useModelOptionSelection({ scope: "new-thread", provider: codex }),
    );
    expect(first.result.current.requestValues).toEqual({ daybreak: "off" });
    act(() => first.result.current.setValues({ daybreak: "on" }));
    first.unmount();

    const second = renderHook(() =>
      useModelOptionSelection({ scope: "new-thread", provider: codex }),
    );
    expect(second.result.current.values).toEqual({ daybreak: "on" });
    expect(second.result.current.requestValues).toEqual({ daybreak: "on" });
  });

  it("declares nothing and sends nothing for a provider without options", () => {
    const { result } = renderHook(() =>
      useModelOptionSelection({
        scope: "new-thread",
        provider: { id: "claude-code" },
        initialValues: { daybreak: "on" },
      }),
    );

    expect(result.current.declarations).toEqual([]);
    expect(result.current.values).toEqual({});
    expect(result.current.requestValues).toBeUndefined();
  });
});
