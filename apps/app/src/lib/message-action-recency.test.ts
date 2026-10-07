// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import {
  MESSAGE_ACTION_RECENCY_STORAGE_KEY,
  orderByRecency,
  recordMessageActionUse,
  resetMessageActionRecencyForTest,
  useMessageActionRecency,
} from "./message-action-recency";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetMessageActionRecencyForTest();
});

describe("message action recency", () => {
  it("puts used actions first and keeps unused actions in their default order", () => {
    expect(
      orderByRecency(
        ["copy", "edit", "summarize", "translate"],
        ["translate", "edit", "removed-plugin"],
        (id) => id,
      ),
    ).toEqual(["translate", "edit", "copy", "summarize"]);
  });

  it("tracks user and assistant message actions as separate lists", () => {
    recordMessageActionUse("assistant", "copy");
    recordMessageActionUse("assistant", "plugin/demo/summarize");
    recordMessageActionUse("user", "edit");
    recordMessageActionUse("assistant", "copy");

    const assistant = renderHook(() => useMessageActionRecency("assistant"));
    const user = renderHook(() => useMessageActionRecency("user"));

    expect(assistant.result.current).toEqual([
      "copy",
      "plugin/demo/summarize",
    ]);
    expect(user.result.current).toEqual(["edit"]);
    expect(
      JSON.parse(
        window.localStorage.getItem(MESSAGE_ACTION_RECENCY_STORAGE_KEY) ?? "",
      ),
    ).toEqual({ user: ["edit"], assistant: ["copy", "plugin/demo/summarize"] });
  });

  it("recovers each list independently from malformed storage", () => {
    window.localStorage.setItem(
      MESSAGE_ACTION_RECENCY_STORAGE_KEY,
      JSON.stringify({ user: ["edit"], assistant: "copy" }),
    );

    expect(
      renderHook(() => useMessageActionRecency("user")).result.current,
    ).toEqual(["edit"]);
    expect(
      renderHook(() => useMessageActionRecency("assistant")).result.current,
    ).toEqual([]);
  });
});
