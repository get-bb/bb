// @vitest-environment jsdom

import { TooltipProvider } from "@bb/shared-ui/tooltip";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { PluginThreadAction } from "@get-bb/plugin-sdk";
import { PluginThreadHeaderActions } from "./PluginThreadHeaderActions";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  removePluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { CoreWorkspaceHeaderContext } from "@/components/thread/core-thread-header-actions";
import type { ComponentProps } from "react";
import type { ThreadWorkspaceOpenButton } from "@/components/thread/ThreadWorkspaceOpenButton";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

function Host({
  overflow,
  threadId = "t1",
  workspace,
}: {
  overflow: boolean;
  threadId?: string;
  workspace?: ComponentProps<typeof ThreadWorkspaceOpenButton>;
}) {
  const content = (
    <PluginThreadHeaderActions threadId={threadId} projectId="p1">
      {({ actions, controls }) => (
        <>
          <div data-testid="controls">{controls(overflow)}</div>
          {overflow
            ? actions.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    void item.action.run({ requestRename: () => {} });
                  }}
                >
                  {item.action.label}
                </button>
              ))
            : null}
        </>
      )}
    </PluginThreadHeaderActions>
  );
  return (
    <TooltipProvider>
      {workspace ? (
        <CoreWorkspaceHeaderContext.Provider value={workspace}>
          {content}
        </CoreWorkspaceHeaderContext.Provider>
      ) : (
        content
      )}
    </TooltipProvider>
  );
}

describe("thread header overflow", () => {
  it.each(["core", "plugin"] as const)(
    "uses one registration for %s's wide control and ordered overflow actions",
    (owner) => {
      const run = vi.fn();
      const actions: PluginThreadAction[] = ["Preferred", "Other"].map(
        (label) => ({
          icon: "FolderOpen",
          label: `Open workspace in ${label}`,
          run: () => run(label),
        }),
      );
      const button = (
        <button onClick={() => run("Preferred")}>Open workspace</button>
      );
      if (owner === "plugin")
        setPluginSlotRegistrations(
          "header-fixture",
          collectPluginAppRegistrations(
            definePluginApp((app) => {
              app.slots.experimental_threadHeaderAction({
                id: "workspace",
                title: "Workspace",
                component: () => button,
                experimental_useOverflowActions: () => actions,
              });
            }),
          ),
        );
      const targets = ["Other", "Preferred"].map((label) => ({
        id: label,
        label,
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
        },
      }));
      const workspace =
        owner === "core"
          ? {
              preferredTarget: targets[1]!,
              targets,
              onOpenPreferredTarget: async () => {
                run("Preferred");
              },
              onOpenTarget: async (targetId: string) => {
                run(targetId);
              },
            }
          : undefined;
      const wideLabel =
        owner === "core" ? "Open workspace in Preferred" : "Open workspace";
      const view = render(<Host overflow={false} workspace={workspace} />);
      fireEvent.click(screen.getByRole("button", { name: wideLabel }));
      expect(run).toHaveBeenLastCalledWith("Preferred");
      expect(
        screen.queryByRole("button", { name: "Open workspace in Other" }),
      ).toBeNull();
      view.rerender(<Host overflow workspace={workspace} />);
      expect(
        within(screen.getByTestId("controls")).queryByRole("button", {
          name: wideLabel,
        }),
      ).toBeNull();
      expect(
        screen.getAllByRole("button").map((element) => element.textContent),
      ).toEqual(["Open workspace in Preferred", "Open workspace in Other"]);
      fireEvent.click(
        screen.getByRole("button", { name: "Open workspace in Other" }),
      );
      expect(run).toHaveBeenLastCalledWith("Other");
      view.rerender(<Host overflow={false} workspace={workspace} />);
      expect(screen.getByRole("button", { name: wideLabel })).toBeTruthy();
    },
  );

  it("updates hook data, drops actions on disable, and preserves legacy inline controls", () => {
    let update: (value: string) => void = () => {};
    setPluginSlotRegistrations(
      "header-fixture",
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.slots.experimental_threadHeaderAction({
            id: "live",
            title: "Live",
            component: () => <button>Live control</button>,
            experimental_useOverflowActions: function useActions({ threadId }) {
              const [label, setLabel] = useState("First");
              update = setLabel;
              return [
                { icon: "Check", label: `${threadId} ${label}`, run: () => {} },
              ];
            },
          });
          app.slots.experimental_threadHeaderAction({
            id: "legacy",
            title: "Legacy",
            component: () => <button>Legacy control</button>,
          });
        }),
      ),
    );
    const view = render(<Host overflow />);
    expect(screen.getByRole("button", { name: "t1 First" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Legacy control" })).toBeTruthy();
    act(() => update("Updated"));
    expect(screen.queryByRole("button", { name: "t1 First" })).toBeNull();
    expect(screen.getByRole("button", { name: "t1 Updated" })).toBeTruthy();
    view.rerender(<Host overflow threadId="t2" />);
    expect(screen.getByRole("button", { name: "t2 First" })).toBeTruthy();
    act(() => removePluginSlotRegistrations("header-fixture"));
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("drops previously published actions if their hook crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let crash: () => void = () => {};
    setPluginSlotRegistrations(
      "header-fixture",
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.slots.experimental_threadHeaderAction({
            id: "live",
            title: "Live",
            component: () => null,
            experimental_useOverflowActions: function useActions() {
              const [failed, setFailed] = useState(false);
              crash = () => setFailed(true);
              if (failed) throw new Error("fixture crash");
              return [{ icon: "Check", label: "Stale action", run: () => {} }];
            },
          });
        }),
      ),
    );
    render(<Host overflow />);
    expect(screen.getByRole("button", { name: "Stale action" })).toBeTruthy();
    act(crash);
    expect(screen.queryByRole("button", { name: "Stale action" })).toBeNull();
  });
});
