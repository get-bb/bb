// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { ExperimentalFileLinkMenu } from "./ExperimentalFileLinkMenu";

const mocks = vi.hoisted(() => ({
  openPathInFileTarget: vi.fn(async () => true),
}));

vi.mock("@/hooks/useLiveFileOpenTargets", () => ({
  useLiveFileOpenTargets: () => ({
    canOpenExternally: false,
    fileOpenTargets: [
      {
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtColumn: false,
          openFileAtLine: false,
        },
        id: "finder",
        label: "Finder",
      },
    ],
    openPathInFileTarget: mocks.openPathInFileTarget,
    root: {
      hostId: "host_1",
      rootPath: "/workspace",
      status: "available",
    },
  }),
}));

vi.mock("@/lib/app-navigation-host", () => ({
  useAppNavigationHost: () => ({
    openFileExternally: vi.fn(),
    openFilePreview: vi.fn(),
  }),
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ fileOpeners: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExperimentalFileLinkMenu", () => {
  it("reveals an available file in Finder from the top-level menu", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>File</ContextMenuTrigger>
        <ContextMenuContent>
          <ExperimentalFileLinkMenu
            intent={{
              location: null,
              target: {
                environmentId: "env_1",
                kind: "workspace",
                path: "notes/todo.md",
              },
            }}
          />
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("File"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in Finder" }));

    expect(mocks.openPathInFileTarget).toHaveBeenCalledOnce();
    expect(mocks.openPathInFileTarget).toHaveBeenCalledWith({
      columnNumber: null,
      lineNumber: null,
      path: "/workspace/notes/todo.md",
      rememberTarget: false,
      targetId: "finder",
    });
  });
});
