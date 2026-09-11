// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

function makeThread(
  id: string,
  parentThreadId: string | null,
): ThreadListEntry {
  return makeThreadListEntry({
    id,
    parentThreadId,
    projectId: "proj_mobile",
    title: id,
    titleFallback: id,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("separates the mobile hierarchy toggle from navigation with a 44px target", () => {
  render(
    <MemoryRouter>
      <RootComposeMobileRecents
        highlightedThreadId={null}
        projectNamesById={new Map()}
        providersById={new Map()}
        showCreatingRow={false}
        threads={[
          makeThread("thr_parent", null),
          makeThread("thr_child", "thr_parent"),
        ]}
      />
    </MemoryRouter>,
  );

  const toggle = screen.getByRole("button", {
    name: "Hide threads under thr_parent",
  });
  const row = toggle.closest("li");

  expect(toggle.className.split(" ")).toContain("size-11");
  expect(row?.className.split(" ")).toContain("gap-1");
});
