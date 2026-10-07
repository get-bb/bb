// @vitest-environment jsdom

import { use, useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk";
import type { PluginMessageMetadataSlot } from "@/lib/plugin-slots";
import { usePluginId } from "../../plugin/plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "../../plugin/PluginSlotMount";
import { MessageMetadata } from "./MessageMetadata";

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

function slot(
  id: string,
  component: PluginMessageMetadataSlot["component"],
): PluginMessageMetadataSlot {
  return {
    id,
    pluginId: "fixture",
    generation: 1,
    component,
  };
}

const message = {
  id: "msg_1",
  threadId: "thr_1",
  role: "user" as const,
  initiator: "agent" as const,
  turnId: "turn_1",
  createdAt: 1_700_000_000_123,
};

function metadata(
  slots: readonly PluginMessageMetadataSlot[],
  props = message,
) {
  return (
    <MemoryRouter>
      <MessageMetadata slots={slots} {...props} />
    </MemoryRouter>
  );
}

describe("MessageMetadata", () => {
  it("lets components skip roles and supplies origin, time, turn identity and plugin context", () => {
    const assistant = vi.fn(({ message }: ExperimentalMessageMetadataProps) =>
      message.role === "assistant" ? <span>Assistant metadata</span> : null,
    );
    function Identity({ message }: ExperimentalMessageMetadataProps) {
      const pluginId = usePluginId();
      return (
        <span title={String(message.createdAt)}>
          {pluginId}/{message.id}/{message.turnId}/
          {message.role === "user" ? message.initiator : "assistant"}
        </span>
      );
    }
    render(
      metadata([
        slot("first", () => <span>First</span>),
        slot("assistant", assistant),
        slot("identity", Identity),
      ]),
    );
    expect(screen.queryByText("Assistant metadata")).toBeNull();
    const identity = screen.getByText("fixture/msg_1/turn_1/agent");
    expect(identity.title).toBe("1700000000123");
    expect(screen.getByLabelText("Message metadata").textContent).toBe(
      "Firstfixture/msg_1/turn_1/agent",
    );
  });

  it("contains a crashing contribution without hiding sibling metadata", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("broken metadata");
    }
    render(
      metadata([
        slot("broken", Broken),
        slot("healthy", () => <span>Healthy metadata</span>),
      ]),
    );
    expect(screen.getByText("Healthy metadata")).toBeDefined();
    expect(screen.queryByText("plugin fixture crashed")).toBeNull();
  });

  it("keeps sibling contributions visible while asynchronous metadata suspends", async () => {
    let finish: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    function Deferred() {
      use(ready);
      return <span>Ready metadata</span>;
    }
    await act(async () => {
      render(
        metadata([
          slot("deferred", Deferred),
          slot("healthy", () => <span>Healthy metadata</span>),
        ]),
      );
    });
    expect(screen.getByText("Healthy metadata")).toBeDefined();
    expect(screen.queryByText("Ready metadata")).toBeNull();
    await act(async () => {
      finish?.();
      await ready;
    });
    expect(screen.getByText("Ready metadata")).toBeDefined();
  });

  it("supports React updates and cleans up mounted plugin effects", async () => {
    let deliver: ((value: string) => void) | undefined;
    const release = vi.fn();
    function LiveMetadata() {
      const [label, setLabel] = useState("Loading stats");
      useEffect(() => {
        deliver = setLabel;
        return release;
      }, []);
      return <button onClick={() => setLabel("Updated stats")}>{label}</button>;
    }
    const view = render(metadata([slot("live", LiveMetadata)]));
    await act(async () => {
      deliver?.("Fetched stats");
    });
    fireEvent.click(screen.getByRole("button", { name: "Fetched stats" }));
    expect(screen.getByText("Updated stats")).toBeDefined();
    view.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
