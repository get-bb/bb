// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";

const listPluginMetadata = vi.fn();
const sdk = { threads: { experimental_listPluginMetadata: listPluginMetadata } };

vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk }));

const { useSidebarSortKeys } = await import("./useSidebarSortKeys.js");

afterEach(() => {
  cleanup();
  listPluginMetadata.mockReset();
});

describe("useSidebarSortKeys", () => {
  it("reads each sectioned thread's key from its origin plugin's metadata", async () => {
    listPluginMetadata.mockImplementation(
      async ({ pluginId }: { pluginId: string }) => ({
        threads:
          pluginId === "calendar"
            ? [
                { threadId: "event", metadata: { sidebarSortKey: 1_000 } },
                { threadId: "no-key", metadata: { other: true } },
              ]
            : [{ threadId: "other", metadata: { sidebarSortKey: "soon" } }],
      }),
    );
    const threads = [
      makeSidebarThread({
        id: "event",
        originPluginId: "calendar",
        sectionId: "sec",
      }),
      makeSidebarThread({
        id: "no-key",
        originPluginId: "calendar",
        sectionId: "sec",
      }),
      makeSidebarThread({
        id: "other",
        originPluginId: "notes",
        sectionId: "sec",
      }),
      makeSidebarThread({
        id: "unsectioned",
        originPluginId: "calendar",
        sectionId: null,
      }),
      makeSidebarThread({ id: "user", originPluginId: null, sectionId: "sec" }),
    ];

    const { result } = renderHook(() => useSidebarSortKeys(threads));

    await waitFor(() =>
      expect(result.current).toEqual(new Map([["event", 1_000]])),
    );
    expect(listPluginMetadata).toHaveBeenCalledWith({
      pluginId: "calendar",
      threadIds: ["event", "no-key"],
    });
    expect(listPluginMetadata).toHaveBeenCalledWith({
      pluginId: "notes",
      threadIds: ["other"],
    });
    expect(listPluginMetadata).toHaveBeenCalledTimes(2);
  });

  it("makes no request when no sectioned thread came from a plugin", () => {
    const { result } = renderHook(() =>
      useSidebarSortKeys([
        makeSidebarThread({ id: "user", originPluginId: null, sectionId: "s" }),
      ]),
    );

    expect(result.current.size).toBe(0);
    expect(listPluginMetadata).not.toHaveBeenCalled();
  });
});
