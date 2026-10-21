// @vitest-environment jsdom

import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import {
  fixedTabTargetAtomFamily,
  threadFixedTabTargetKey,
  useFixedTabSessionTarget,
  useThreadFixedTabTargetLifetime,
} from "./app-fixed-tab-navigation";

afterEach(cleanup);
it("does not revive an unconsumed tab target after navigating away and back", () => {
  const store = createStore();
  const tab = { ownerId: "plugin-thread:bb--git", tabId: "diff" };
  const key = threadFixedTabTargetKey("thread-a", tab);
  const owner = renderHook(
    ({ threadId }) => {
      useThreadFixedTabTargetLifetime(threadId);
      return useFixedTabSessionTarget(
        threadFixedTabTargetKey(threadId, tab),
        tab,
      );
    },
    {
      initialProps: { threadId: "thread-a" },
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
  act(() =>
    store.set(fixedTabTargetAtomFamily(key), {
      sequence: 1,
      target: { kind: "file", path: "left.ts" },
    }),
  );
  expect(owner.result.current?.target).toEqual({
    kind: "file",
    path: "left.ts",
  });
  owner.rerender({ threadId: "thread-b" });
  expect(owner.result.current).toBeNull();
  owner.rerender({ threadId: "thread-a" });
  expect(owner.result.current).toBeNull();
});
