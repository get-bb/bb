// @vitest-environment jsdom
import { Suspense } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openPluginDetailsInWorkspace,
  PluginDetailOpenerBoundary,
  usePublishPluginDetailOpener,
  type PluginDetailOpener,
} from "./plugin-detail-opener";

const loading = new Promise<never>(() => {});
const docs = { pluginId: "docs", title: "Docs" };
const tasks = { pluginId: "tasks", title: "Tasks" };

function LoadedHost({
  open,
  focused,
}: {
  open: PluginDetailOpener;
  focused: boolean;
}) {
  usePublishPluginDetailOpener(open, focused);
  return null;
}

function LazyHost({
  ready,
  ...props
}: {
  ready: boolean;
  open: PluginDetailOpener;
  focused: boolean;
}) {
  if (!ready) throw loading;
  return <LoadedHost {...props} />;
}

function Workspace({
  ready,
  focused,
  open,
  workspace = "plugin-page",
}: {
  ready: boolean;
  focused: boolean;
  open: PluginDetailOpener;
  workspace?: string;
}) {
  return (
    <PluginDetailOpenerBoundary key={workspace} isFocused={focused}>
      <Suspense fallback={null}>
        <LazyHost ready={ready} focused={focused} open={open} />
      </Suspense>
    </PluginDetailOpenerBoundary>
  );
}

afterEach(cleanup);

describe("plugin detail requests while a workspace loads", () => {
  it("delivers early requests to their original pane even after focus moves", () => {
    const left = vi.fn(() => true);
    const right = vi.fn(() => true);
    const view = render(
      <>
        <Workspace ready={false} focused open={left} />
        <Workspace ready focused={false} open={right} />
      </>,
    );
    expect(openPluginDetailsInWorkspace(docs)).toBe(true);
    expect(openPluginDetailsInWorkspace(tasks)).toBe(true);
    expect(left).not.toHaveBeenCalled();
    view.rerender(
      <>
        <Workspace ready focused={false} open={left} />
        <Workspace ready focused open={right} />
      </>,
    );
    expect(left.mock.calls).toEqual([[docs], [tasks]]);
    expect(right).not.toHaveBeenCalled();
    expect(openPluginDetailsInWorkspace(docs)).toBe(true);
    expect(right).toHaveBeenCalledExactlyOnceWith(docs);
    expect(left).toHaveBeenCalledTimes(2);
  });

  it("discards pending requests when navigating to a different workspace", () => {
    const open = vi.fn(() => true);
    const view = render(<Workspace ready={false} focused open={open} />);
    expect(openPluginDetailsInWorkspace(docs)).toBe(true);
    view.rerender(
      <Workspace ready focused open={open} workspace="another-plugin-page" />,
    );
    expect(open).not.toHaveBeenCalled();
    expect(openPluginDetailsInWorkspace(tasks)).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(tasks);
    view.unmount();
    expect(openPluginDetailsInWorkspace(docs)).toBe(false);
  });
});
