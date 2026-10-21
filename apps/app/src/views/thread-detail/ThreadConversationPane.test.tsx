// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadConversationPaneProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ThreadConversationPane } from "./ThreadConversationPane";

function registerConversationPane(
  component: (
    props: ExperimentalThreadConversationPaneProps,
  ) => React.ReactNode,
) {
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      threadConversationPanes: [
        { id: "workspace", title: "Workspace", component },
      ],
    }),
  );
}

function renderConversationPane() {
  return render(
    <ThreadConversationPane threadId="thr_main">
      <div data-testid="conversation">conversation</div>
    </ThreadConversationPane>,
  );
}

beforeEach(() => {
  resetPluginSlotStoreForTest();
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("ThreadConversationPane", () => {
  it("renders the conversation unchanged without a registration", () => {
    const { container } = renderConversationPane();
    expect(container.innerHTML).toBe(
      '<div data-testid="conversation">conversation</div>',
    );
  });

  it("hands the thread and the conversation to the registered view", () => {
    const received: ExperimentalThreadConversationPaneProps[] = [];
    registerConversationPane((props) => {
      received.push(props);
      return (
        <section data-testid="plugin-view">
          <props.Original />
        </section>
      );
    });
    renderConversationPane();
    expect(
      screen
        .getByTestId("plugin-view")
        .contains(screen.getByTestId("conversation")),
    ).toBe(true);
    expect(received.at(-1)).toMatchObject({
      threadId: "thr_main",
      isCompactViewport: false,
    });
  });

  it("falls back to the conversation when the view crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerConversationPane(() => {
      throw new Error("boom");
    });
    renderConversationPane();
    expect(screen.getByTestId("conversation")).toBeTruthy();
  });

  it("keeps the conversation mounted while other plugin slots change", () => {
    let mounts = 0;
    let renders = 0;
    function Conversation() {
      useEffect(() => {
        renders += 1;
      });
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div data-testid="conversation">conversation</div>;
    }
    const { container } = render(
      <ThreadConversationPane threadId="thr_main">
        <Conversation />
      </ThreadConversationPane>,
    );
    const unrelated = makePluginRegistrationSet({
      threadLists: [{ id: "list", title: "List", component: () => null }],
    });
    act(() => setPluginSlotRegistrations("other", unrelated));
    act(() => removePluginSlotRegistrations("other"));
    expect(container.innerHTML).toBe(
      '<div data-testid="conversation">conversation</div>',
    );
    expect(mounts).toBe(1);
    expect(renders).toBe(1);
  });
});
