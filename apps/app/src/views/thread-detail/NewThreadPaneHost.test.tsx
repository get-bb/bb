// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { PaneNode } from "@/lib/split-layout";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { NewThreadPaneHost, NewThreadPaneSlot } from "./NewThreadPaneHost";

vi.mock("@/views/RootComposeView", () => ({
  RootComposeView: ({ composerPaneId }: { composerPaneId: string }) => {
    const [project, setProject] = useState("");
    return (
      <input
        aria-label={composerPaneId}
        value={project}
        onChange={(event) => setProject(event.target.value)}
      />
    );
  },
}));

afterEach(cleanup);

const panes: PaneNode[] = ["composer-one", "composer-two"].map((paneId) => ({
  type: "pane",
  paneId,
  content: { kind: "new-thread" },
}));

function slot(paneId: string) {
  const context: PaneContextValue = {
    paneId,
    isFocused: true,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: null,
    isMaximized: false,
    onToggleMaximize: null,
    isBoundedPane: true,
    isTopRow: true,
    ownsWindowTopLeft: false,
    navigateInPane: () => {},
  };
  return (
    <PaneContext.Provider value={context}>
      <NewThreadPaneSlot />
    </PaneContext.Provider>
  );
}

it("keeps component-local selections when split hosts move, collapse, or hide in compact view", () => {
  const store = createStore();
  const view = (mode: "split" | "moved" | "compact") => (
    <Provider store={store}>
      <NewThreadPaneHost panes={panes} focusedPaneId="composer-one">
        {mode === "split" ? (
          <section>
            {slot("composer-one")}
            {slot("composer-two")}
          </section>
        ) : mode === "moved" ? (
          <article>
            <div>{slot("composer-two")}</div>
            <aside>{slot("composer-one")}</aside>
          </article>
        ) : (
          <main>{slot("composer-one")}</main>
        )}
      </NewThreadPaneHost>
    </Provider>
  );
  const { rerender } = render(view("split"));
  fireEvent.change(screen.getByLabelText("composer-one"), {
    target: { value: "Project one" },
  });
  fireEvent.change(screen.getByLabelText("composer-two"), {
    target: { value: "Project two" },
  });
  rerender(view("moved"));
  expect(screen.getByLabelText<HTMLInputElement>("composer-one").value).toBe(
    "Project one",
  );
  expect(screen.getByLabelText<HTMLInputElement>("composer-two").value).toBe(
    "Project two",
  );
  rerender(view("compact"));
  expect(screen.queryByLabelText("composer-two")).toBeNull();
  rerender(view("split"));
  expect(screen.getByLabelText<HTMLInputElement>("composer-one").value).toBe(
    "Project one",
  );
  expect(screen.getByLabelText<HTMLInputElement>("composer-two").value).toBe(
    "Project two",
  );
});
