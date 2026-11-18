// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { ThreadRowMetadata } from "@/components/plugin/ThreadRowMetadata";
import { toPluginSidebarThread } from "@/lib/plugin-sidebar-threads";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "./plugin-slots";
import { settleLazyModules } from "@/test/lazy-modules";

const renderRecorder = await vi.hoisted(async () => {
  const { installRenderRecorder } = await import("@/test/render-recorder");
  return installRenderRecorder();
});

vi.mock("@/lib/plugin-sidebar-hooks", () => ({
  useSidebarThreads: () => ({ threads: [] }),
}));

const THREADS = ["thr_a", "thr_b", "thr_c"].map((id) =>
  toPluginSidebarThread(makeThreadListEntry({ id })),
);

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("other-kind");
  removePluginSlotRegistrations("row-metadata");
  renderRecorder.reset();
});

afterAll(() => {
  renderRecorder.uninstall();
});

describe("per-kind plugin slot subscriptions", () => {
  it("leaves row consumers alone when a plugin registers another slot kind", async () => {
    render(
      <>
        {THREADS.map((thread) => (
          <ThreadRowMetadata key={thread.id} thread={thread} />
        ))}
      </>,
    );
    renderRecorder.reset();

    act(() => {
      setPluginSlotRegistrations(
        "other-kind",
        makePluginRegistrationSet({
          settingsSections: [
            { id: "settings", title: "Settings", component: () => null },
          ],
        }),
      );
    });
    expect(renderRecorder.propsOf("ThreadRowMetadata")).toEqual([]);

    act(() => {
      setPluginSlotRegistrations(
        "row-metadata",
        makePluginRegistrationSet({
          threadRowMetadata: [{ id: "meta", component: () => <span /> }],
        }),
      );
    });
    await settleLazyModules();
    expect(renderRecorder.propsOf("ThreadRowMetadata")).toHaveLength(
      THREADS.length,
    );
  });
});
