// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { type ComponentProps } from "react";
import { DiffFilesPanel } from "./DiffFilesPanel.js";
import { useDiffFilesCollapseControls } from "./diffFilesStore.js";
import { DEFAULT_DIFF_FILE_FILTERS } from "./diff-file-filters.js";
import { gitRpcContract, parsePatchKey } from "./contract.js";
import { makeDiffFileEntry } from "../../apps/app/src/test/fixtures/diff-files.js";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    range: { startIndex: 0, endIndex: 1 },
    getVirtualItems: () =>
      [0, 1].map((index) => ({ index, start: index * 40 })),
    getTotalSize: () => 80,
    measureElement() {},
    scrollToIndex() {},
  }),
}));
afterEach(cleanup);
const contract = {
  viewed: gitRpcContract.viewed,
  setViewed: gitRpcContract.setViewed,
  patches: gitRpcContract.patches,
};
const files = [
  makeDiffFileEntry({ path: "a.ts", revision: "rev-a" }),
  makeDiffFileEntry({ path: "b.ts", revision: "rev-b-new" }),
];
function Panel(props: ComponentProps<typeof DiffFilesPanel>) {
  const collapse = useDiffFilesCollapseControls(
    props.diffIdentity,
    props.files,
    props.files.length,
  );
  return (
    <>
      <button onClick={collapse.toggleAllCollapsed}>Toggle all</button>
      <DiffFilesPanel {...props} />
    </>
  );
}
it("matches Viewed revisions, saves the current revision, and keeps collapse and filtering independent of review state", async () => {
  const marks = new Map([
    ["a.ts", "rev-a"],
    ["b.ts", "rev-b-old"],
  ]);
  const props: ComponentProps<typeof DiffFilesPanel> = {
    environmentId: "env-1",
    target: { type: "uncommitted" },
    diffIdentity: "env-1:uncommitted",
    files,
    filters: DEFAULT_DIFF_FILE_FILTERS,
    fileFilter: "",
    initialPatches: [],
    presentation: {
      view: "unified",
      overflow: "scroll",
      showLineNumbers: true,
    },
    ignoreWhitespace: false,
    isPanelOpen: true,
  };
  const view = renderSlot<
    ComponentProps<typeof DiffFilesPanel>,
    typeof contract
  >({ component: Panel }, props, {
    experimental_rpcContract: contract,
    rpc: {
      viewed: () => ({
        files: [...marks].map(([path, revision]) => ({ path, revision })),
      }),
      setViewed(input) {
        if (input.viewed) marks.set(input.path, input.revision);
        else marks.delete(input.path);
        return { ok: true };
      },
      patches: ({ keys }) =>
        Object.fromEntries(
          keys.map((key) => [
            key,
            { path: parsePatchKey(key).path, patch: "", truncated: false },
          ]),
        ),
    },
  });
  const a = await screen.findByRole("checkbox", { name: "Viewed a.ts" });
  const b = await screen.findByRole("checkbox", { name: "Viewed b.ts" });
  await waitFor(() => expect(a.getAttribute("aria-checked")).toBe("true"));
  expect(b.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(b);
  await waitFor(() => expect(b.getAttribute("aria-checked")).toBe("true"));
  expect(
    view.inspection.rpcCalls.find((call) => call.method === "setViewed")?.input,
  ).toEqual({
    environmentId: "env-1",
    target: props.target,
    path: "b.ts",
    revision: "rev-b-new",
    viewed: true,
  });
  view.lifecycle.rerender(
    <Panel
      {...props}
      files={[files[0]!, { ...files[1]!, revision: "rev-b-edited" }]}
    />,
  );
  await waitFor(() => expect(b.getAttribute("aria-checked")).toBe("false"));
  view.lifecycle.rerender(
    <Panel
      {...props}
      filters={{ ...DEFAULT_DIFF_FILE_FILTERS, showViewed: false }}
    />,
  );
  await screen.findByText("No changed files match the current filters.");
  view.lifecycle.rerender(<Panel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle all" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Viewed a.ts" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("checkbox", { name: "Viewed a.ts" })
        .getAttribute("aria-checked"),
    ).toBe("false"),
  );
  expect(marks.has("a.ts")).toBe(false);
});
